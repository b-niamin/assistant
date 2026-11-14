"""The worker (spec 002, "Background work"): runs the installed extensions' services and scheduled jobs.

One container for all of them, so installing an extension never needs a host step: this supervisor reads
extensions/installed.json and each extension's manifest every few seconds, starts what is new, restarts a
service whose code or manifest changed, stops what went away, and runs jobs on their schedule.

It runs as root only to hand out users: every extension's services and jobs run as that extension's own
uid (61000 and up), with an environment built from scratch (never this process's), in the extension's
folder (read-only), with a private writable folder in the `worker-data` volume (WORKER_DATA, HOME). This
process never runs extension code itself: it reads JSON and file metadata. The worker is the only
container that sees the host (/proc and /sys, read-only, see access.json and spec 004); a unit gets the
paths in its environment only when its manifest asks for them, and the settings page shows who asks.

  python worker.py                        the supervisor (the container's command)
  python worker.py run <ext> <unit> [cmd]  a unit's command (or another one, e.g. a login) with its user,
                                           folder and environment: `docker compose exec -it worker
                                           ext-run health garmin-sync python -m sync login` on the host,
                                           or `ext-run ...` in the app's terminal (through RUN_SOCKET)
  python worker.py unit                    (internal) prepares a unit's venv, then execs its command

Files: /worker/status.json (what the settings page shows), /worker/logs/<ext>.<unit>.log, requests from the
app in /worker/control/*.json (restart, run now), the terminal's `ext-run` socket /worker/run/ext-run.sock,
/data/uids.json and /data/jobs.json (state kept).
"""
from __future__ import annotations

import fcntl
import hashlib
import json
import os
import re
import signal
import pty
import select
import shutil
import socket
import struct
import subprocess
import sys
import termios
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

HERE = os.path.dirname(os.path.abspath(__file__))
# `import beni` for every unit (lib/beni: logging, settings, database, the loop).
LIB = os.path.join(HERE, "lib")
EXT = os.environ.get("WORKER_EXTENSIONS", "/extensions")
DATA = os.environ.get("WORKER_DATA_DIR", "/data")
STATE = os.environ.get("WORKER_STATE", "/worker")
LOGS = os.path.join(STATE, "logs")
CONTROL = os.path.join(STATE, "control")
# `ext-run` in the app's terminal (docker/terminal/ext-run) connects here; only HOST_UID may.
RUN_SOCKET = os.path.join(STATE, "run", "ext-run.sock")
UID_BASE = 61000
SCAN_SECONDS = 3
LOG_MAX = 4 * 1024 * 1024
LOG_KEEP = 512 * 1024

with open(os.path.join(HERE, "access.json"), encoding="utf-8") as _f:
    ACCESS: dict[str, Any] = json.load(_f)

# The same rules as apps/web/src/lib/ids.js (test_worker.py compares them).
ID_RE = re.compile(r"^[a-z][a-z0-9]*(-[a-z0-9]+)*$")
NAME_RE = re.compile(r"^[a-z][a-z0-9-]{0,39}$")
ENV_RE = re.compile(r"^[A-Z][A-Z0-9_]{0,63}$")
# Names a unit cannot set through "env": the worker sets them.
RESERVED_ENV = {"PATH", "HOME", "USER", "LOGNAME", "LANG", "TZ", "DATABASE_URL", "WORKER_DATA", "EXT_ID", "EXT_UNIT",
                "PYTHONUNBUFFERED", "PYTHONDONTWRITEBYTECODE", "PYTHONPATH"} | {a["env"] for a in ACCESS["host"].values()} | set(ACCESS["keys"])


def iso(t: float | None) -> str | None:
    return datetime.fromtimestamp(t, timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z") if t else None


def say(msg: str) -> None:
    print(f"{iso(time.time())} [worker] {msg}", flush=True)


# -- schedules --------------------------------------------------------------------------------------

def parse_duration(text: Any) -> int | None:
    """"30s", "5m", "2h", "1d" -> seconds."""
    m = re.fullmatch(r"(\d{1,5})([smhd])", text) if isinstance(text, str) else None
    return int(m.group(1)) * {"s": 1, "m": 60, "h": 3600, "d": 86400}[m.group(2)] if m else None


class Cron:
    """Five fields (minute hour day-of-month month day-of-week), each `*`, `*/n`, `a`, `a-b`, `a-b/n` or a
    list of those; in the app's time zone (TZ). Day-of-week 0 or 7 is Sunday."""

    RANGES = [(0, 59), (0, 23), (1, 31), (1, 12), (0, 7)]

    def __init__(self, text: str) -> None:
        parts = text.split()
        if len(parts) != 5:
            raise ValueError("a cron schedule has five fields: minute hour day month weekday")
        self.text = text
        self.sets = [self._field(p, lo, hi) for p, (lo, hi) in zip(parts, self.RANGES)]
        if 7 in self.sets[4]:
            self.sets[4] = self.sets[4] | {0}
        self.any_dom, self.any_dow = parts[2] == "*", parts[4] == "*"

    @staticmethod
    def _field(text: str, lo: int, hi: int) -> set[int]:
        out: set[int] = set()
        for part in text.split(","):
            m = re.fullmatch(r"(\*|\d+(?:-\d+)?)(?:/(\d+))?", part)
            if not m:
                raise ValueError(f"cannot read {part!r}")
            step = int(m.group(2) or 1)
            if m.group(1) == "*":
                a, b = lo, hi
            elif "-" in m.group(1):
                a, b = (int(x) for x in m.group(1).split("-"))
            else:
                a = b = int(m.group(1))
                if m.group(2):
                    b = hi
            if not (lo <= a <= b <= hi) or step < 1:
                raise ValueError(f"{part!r} is outside {lo}-{hi}")
            out.update(range(a, b + 1, step))
        return out

    def matches(self, t: time.struct_time) -> bool:
        minute, hour, dom, month, dow = self.sets
        if t.tm_min not in minute or t.tm_hour not in hour or t.tm_mon not in month:
            return False
        day_ok, wday_ok = t.tm_mday in dom, (t.tm_wday + 1) % 7 in dow
        # Like cron: when both day fields are restricted, either one matching is enough.
        if self.any_dom or self.any_dow:
            return day_ok and wday_ok
        return day_ok or wday_ok

    def next_after(self, after: float) -> float | None:
        t = (int(after) // 60 + 1) * 60
        for _ in range(366 * 24 * 60):
            if self.matches(time.localtime(t)):
                return float(t)
            t += 60
        return None


# -- manifests --------------------------------------------------------------------------------------

@dataclass
class Unit:
    ext: str
    name: str
    kind: str  # service | job
    dir: str  # absolute
    run: list[str]
    host: list[str] = field(default_factory=list)
    keys: list[str] = field(default_factory=list)
    env: dict[str, str] = field(default_factory=dict)
    description: str = ""
    every: int | None = None
    cron: Cron | None = None
    timeout: int = 600

    @property
    def key(self) -> str:
        return f"{self.ext}/{self.name}"

    def spec(self) -> dict[str, Any]:
        return {"ext": self.ext, "name": self.name, "kind": self.kind, "dir": self.dir, "run": self.run, "host": self.host,
                "keys": self.keys, "env": self.env, "every": self.every, "cron": self.cron.text if self.cron else None,
                "timeout": self.timeout}

    def schedule(self) -> str | None:
        if self.cron:
            return f"cron {self.cron.text}"
        return f"every {_human(self.every)}" if self.every else None


def _human(seconds: int | None) -> str:
    if not seconds:
        return ""
    for unit, size in (("d", 86400), ("h", 3600), ("m", 60)):
        if seconds % size == 0:
            return f"{seconds // size}{unit}"
    return f"{seconds}s"


def parse_unit(ext: str, root: str, raw: Any, kind: str) -> tuple[Unit | None, list[str]]:
    """One entry of a manifest's "services" or "jobs" list -> a Unit, or the problems with it."""
    label = raw.get("name") if isinstance(raw, dict) else repr(raw)
    where = f"{ext}: {kind} {label}"
    if not isinstance(raw, dict):
        return None, [f"{where}: must be an object"]
    errs: list[str] = []
    name = raw.get("name")
    if not isinstance(name, str) or not NAME_RE.match(name):
        errs.append(f"{where}: name must match {NAME_RE.pattern}")
        name = "?"
    run = raw.get("run")
    if not (isinstance(run, list) and run and len(run) <= 40 and all(isinstance(a, str) and a and len(a) <= 500 for a in run)):
        errs.append(f"{where}: run must be a list of strings, the command and its arguments")
    rel = raw.get("dir", f"services/{name}")
    folder = os.path.realpath(os.path.join(root, rel)) if isinstance(rel, str) else ""
    if not isinstance(rel, str) or os.path.isabs(rel) or not folder.startswith(os.path.realpath(root) + os.sep):
        errs.append(f"{where}: dir must be a folder inside the extension")
    elif not os.path.isdir(folder):
        errs.append(f"{where}: no folder {rel}")
    host = raw.get("host", [])
    if not (isinstance(host, list) and all(h in ACCESS["host"] for h in host)):
        errs.append(f"{where}: host may only list what the worker opens: {', '.join(ACCESS['host'])}")
        host = []
    keys = raw.get("keys", [])
    if not (isinstance(keys, list) and all(k in ACCESS["keys"] for k in keys)):
        errs.append(f"{where}: keys may only list {', '.join(ACCESS['keys'])}")
        keys = []
    env = raw.get("env", {})
    if not (isinstance(env, dict) and len(env) <= 30 and all(isinstance(k, str) and ENV_RE.match(k) and k not in RESERVED_ENV
                                                            and isinstance(v, str) and len(v) <= 500 for k, v in env.items())):
        errs.append(f"{where}: env must map NAMES to strings, without names the worker sets ({', '.join(sorted(RESERVED_ENV))})")
        env = {}
    desc = raw.get("description", "")
    if not isinstance(desc, str) or len(desc) > 160:
        errs.append(f"{where}: description is a string of at most 160 characters")
        desc = ""
    unit = Unit(ext, name, kind, folder, run if isinstance(run, list) else [], list(host), list(keys), dict(env), desc)
    if kind == "job":
        every, cron = raw.get("every"), raw.get("cron")
        if (every is None) == (cron is None):
            errs.append(f"{where}: a job has either \"every\" (30s, 5m, 2h, 1d) or \"cron\" (five fields)")
        elif every is not None:
            unit.every = parse_duration(every)
            if not unit.every or unit.every < 10:
                errs.append(f"{where}: every must be like 30s, 5m, 2h or 1d, at least 10s")
        else:
            try:
                unit.cron = Cron(cron if isinstance(cron, str) else "")
            except ValueError as e:
                errs.append(f"{where}: cron: {e}")
        timeout = parse_duration(raw.get("timeout", "10m"))
        if not timeout or timeout > 6 * 3600:
            errs.append(f"{where}: timeout must be like 30s, 10m or 2h, at most 6h")
        else:
            unit.timeout = timeout
    else:
        for k in ("every", "cron", "timeout"):
            if k in raw:
                errs.append(f"{where}: a service runs all the time; \"{k}\" is for jobs")
    known = {"name", "run", "dir", "host", "keys", "env", "description", "every", "cron", "timeout"}
    for k in raw:
        if k not in known:
            errs.append(f"{where}: unknown field {k!r}")
    return (None if errs else unit), errs


def read_extension(ext: str, root: str) -> tuple[list[Unit], list[str], list[str]]:
    """An installed extension's units, its problems, and the services it still runs from its own
    compose.yml (manifest "services" as plain names, the older way)."""
    try:
        with open(os.path.join(root, "extension.json"), encoding="utf-8") as f:
            m = json.load(f)
    except (OSError, ValueError) as e:
        return [], [f"{ext}: cannot read extension.json ({e.__class__.__name__})"], []
    units: list[Unit] = []
    problems: list[str] = []
    external: list[str] = []
    for kind, key in (("service", "services"), ("job", "jobs")):
        raw = m.get(key, [])
        if not isinstance(raw, list):
            problems.append(f"{ext}: \"{key}\" must be a list")
            continue
        for r in raw:
            if kind == "service" and isinstance(r, str):
                external.append(r)
                continue
            unit, errs = parse_unit(ext, root, r, kind)
            problems += errs
            if unit:
                if any(u.name == unit.name for u in units):
                    problems.append(f"{ext}: two services or jobs are called {unit.name}")
                else:
                    units.append(unit)
    return units, problems, external


def installed_ids(ext_dir: str | None = None) -> list[str]:
    try:
        with open(os.path.join(ext_dir or EXT, "installed.json"), encoding="utf-8") as f:
            reg = json.load(f)
        return [e["id"] for e in reg.get("extensions", []) if isinstance(e, dict) and ID_RE.match(str(e.get("id", "")))]
    except (OSError, ValueError, AttributeError):
        return []


def purged_ids(ext_dir: str | None = None) -> list[str]:
    """installed.json "purge" (`ext remove --data`): removed extensions whose data goes, unless installed again."""
    try:
        with open(os.path.join(ext_dir or EXT, "installed.json"), encoding="utf-8") as f:
            purge = json.load(f).get("purge", [])
    except (OSError, ValueError, AttributeError):
        return []
    installed = set(installed_ids(ext_dir))
    return [i for i in purge if isinstance(i, str) and ID_RE.match(i) and i not in installed] if isinstance(purge, list) else []


def fingerprint(unit: Unit) -> str:
    """Changes when the unit's manifest entry or any file in its folder does (code updates restart it)."""
    h = hashlib.sha256(json.dumps(unit.spec(), sort_keys=True).encode())
    for top, dirs, files in os.walk(unit.dir):
        dirs[:] = sorted(d for d in dirs if d not in ("__pycache__", "node_modules", ".pytest_cache", ".git"))
        for f in sorted(files):
            if f.endswith((".pyc", ".log")):
                continue
            try:
                st = os.lstat(os.path.join(top, f))
            except OSError:
                continue
            h.update(f"{os.path.relpath(os.path.join(top, f), unit.dir)}\0{st.st_size}\0{st.st_mtime_ns}\n".encode())
    return h.hexdigest()


# -- what a unit gets -------------------------------------------------------------------------------

def schema_of(ext: str) -> str:
    return ext.replace("-", "_")


def service_password(master: str, role: str) -> str:
    """Each extension's login role (ext_<id>_svc) has its own password, derived from SERVICES_DB_PASSWORD;
    db/migrate.sh sets the same. A unit gets only its own, so it cannot log in as another extension."""
    return hashlib.sha256(f"{master}:{role}".encode()).hexdigest()


def unit_env(unit: Unit, ext_root: str, source: dict[str, str] | None = None) -> dict[str, str]:
    """The environment of a unit, from scratch: never the supervisor's own (which holds the master password)."""
    src = os.environ if source is None else source
    home = os.path.join(DATA, "ext", unit.ext)
    env = {
        "PATH": "/usr/local/bin:/usr/bin:/bin",
        "HOME": home,
        "WORKER_DATA": home,
        "LANG": "C.UTF-8",
        "TZ": src.get("TZ", "UTC"),
        "EXT_ID": unit.ext,
        "EXT_UNIT": unit.name,
        "PYTHONUNBUFFERED": "1",
        "PYTHONDONTWRITEBYTECODE": "1",
        "PYTHONPATH": LIB,
    }
    master = src.get("SERVICES_DB_PASSWORD", "")
    if master and os.path.isdir(os.path.join(ext_root, "db")):
        role = f"ext_{schema_of(unit.ext)}_svc"
        env["DATABASE_URL"] = f"postgresql://{role}:{service_password(master, role)}@{src.get('DB_HOST', 'db')}:5432/{src.get('POSTGRES_DB', 'assistant')}"
    for h in unit.host:
        env[ACCESS["host"][h]["env"]] = ACCESS["host"][h]["path"]
    for k in unit.keys:
        if src.get(k):
            env[k] = src[k]
    env.update(unit.env)
    return env


class Uids:
    """One uid per extension (its services and jobs share its data, venv and database role), kept across
    restarts so its files stay its own."""

    def __init__(self, path: str) -> None:
        self.path = path
        try:
            with open(path, encoding="utf-8") as f:
                self.map: dict[str, int] = {k: int(v) for k, v in json.load(f).items() if ID_RE.match(k)}
        except (OSError, ValueError, AttributeError):
            self.map = {}

    def of(self, ext: str) -> int:
        if ext not in self.map:
            used = set(self.map.values())
            uid = UID_BASE
            while uid in used:
                uid += 1
            self.map[ext] = uid
            _write_json(self.path, self.map, 0o600)
        return self.map[ext]


def _write_json(path: str, data: Any, mode: int = 0o644) -> None:
    tmp = f"{path}.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=1)
    os.chmod(tmp, mode)
    os.replace(tmp, path)


def ext_home(ext: str, uid: int) -> str:
    """/data/ext/<id>: the extension's own folder (mode 700), created for its uid."""
    home = os.path.join(DATA, "ext", ext)
    os.makedirs(home, exist_ok=True)
    st = os.stat(home)
    if st.st_uid != uid or st.st_gid != uid:
        # A uid that was handed out before (an extension removed and another installed): take its files over.
        for top, dirs, files in os.walk(home):
            for n in dirs + files:
                os.lchown(os.path.join(top, n), uid, uid)
        os.chown(home, uid, uid)
    os.chmod(home, 0o700)
    return home


# -- the supervisor ---------------------------------------------------------------------------------

@dataclass
class Running:
    unit: Unit
    fp: str
    pending_fp: str | None = None
    proc: subprocess.Popen | None = None
    started: float | None = None
    state: str = "starting"
    restarts: int = 0
    backoff: float = 1.0
    retry_at: float = 0.0
    last_exit: int | None = None
    last_exit_at: float | None = None
    rss: int | None = None
    # jobs
    next_run: float | None = None
    last_start: float | None = None
    last_end: float | None = None
    last_duration: float | None = None
    kill_at: float | None = None
    run_reason: str = ""


class Supervisor:
    def __init__(self) -> None:
        self.units: dict[str, Running] = {}
        self.problems: list[dict[str, str]] = []
        self.external: list[dict[str, str]] = []
        self.uids = Uids(os.path.join(DATA, "uids.json"))
        self.jobs_file = os.path.join(DATA, "jobs.json")
        try:
            with open(self.jobs_file, encoding="utf-8") as f:
                self.job_history: dict[str, dict[str, Any]] = json.load(f)
        except (OSError, ValueError):
            self.job_history = {}
        self.started = time.time()
        self.stopping = False
        self.last_status = ""
        self.status_at = 0.0
        self.rss_at = 0.0

    # files and folders
    def prepare(self) -> None:
        for d, mode in ((DATA, 0o755), (os.path.join(DATA, "ext"), 0o755), (STATE, 0o755), (LOGS, 0o755)):
            os.makedirs(d, exist_ok=True)
            os.chown(d, 0, 0)
            os.chmod(d, mode)
        # The web app (HOST_UID) leaves its requests here; the units (other uids) cannot.
        os.makedirs(CONTROL, exist_ok=True)
        host_uid = int(os.environ.get("HOST_UID", "1000"))
        os.chown(CONTROL, host_uid, host_uid)
        os.chmod(CONTROL, 0o755)

    def log_path(self, unit: Unit) -> str:
        return os.path.join(LOGS, f"{unit.ext}.{unit.name}.log")

    def unit_log(self, unit: Unit, msg: str) -> None:
        try:
            with open(self.log_path(unit), "a", encoding="utf-8") as f:
                f.write(f"{iso(time.time())} [worker] {msg}\n")
        except OSError:
            pass
        say(f"{unit.key}: {msg}")

    # scanning
    def scan(self) -> None:
        wanted: dict[str, tuple[Unit, str]] = {}
        problems: list[dict[str, str]] = []
        external: list[dict[str, str]] = []
        for ext in installed_ids():
            root = os.path.join(EXT, ext)
            if not os.path.isfile(os.path.join(root, "extension.json")):
                continue
            units, errs, ext_services = read_extension(ext, root)
            problems += [{"ext": ext, "message": e} for e in errs]
            external += [{"ext": ext, "name": n} for n in ext_services]
            for u in units:
                try:
                    wanted[u.key] = (u, fingerprint(u))
                except OSError as e:
                    problems.append({"ext": ext, "message": f"{u.key}: {e}"})
        self.problems, self.external = problems, external
        for key in list(self.units):
            if key not in wanted:
                r = self.units.pop(key)
                self.unit_log(r.unit, "removed from the manifest or uninstalled: stopping")
                self.stop(r)
        # Removed with its data: its own folder goes too (its units were stopped just above).
        for ext in purged_ids():
            home = os.path.join(DATA, "ext", ext)
            if os.path.isdir(home):
                say(f"{ext}: removed with its data: deleting {home}")
                shutil.rmtree(home, ignore_errors=True)
        now = time.time()
        for key, (unit, fp) in wanted.items():
            r = self.units.get(key)
            if r is None:
                r = self.units[key] = Running(unit, fp)
                if unit.kind == "job":
                    r.state = "idle"
                    self.schedule(r, now, first=True)
                continue
            if fp == r.fp:
                r.pending_fp = None
                continue
            # Files are still being copied (ext update): act once the folder looks the same twice.
            if r.pending_fp != fp:
                r.pending_fp = fp
                continue
            schedule_changed = unit.schedule() != r.unit.schedule()
            r.unit, r.fp, r.pending_fp = unit, fp, None
            if unit.kind == "service":
                self.unit_log(unit, "code or manifest changed: restarting")
                self.stop(r)
                r.retry_at, r.backoff, r.state = 0.0, 1.0, "starting"
            elif schedule_changed:
                self.schedule(r, now)

    def schedule(self, r: Running, now: float, first: bool = False) -> None:
        u = r.unit
        if first:
            h = self.job_history.get(u.key, {})
            r.last_start, r.last_end = h.get("start"), h.get("end")
            r.last_exit, r.last_duration = h.get("exit"), h.get("duration")
        if u.cron:
            r.next_run = u.cron.next_after(now)
        else:
            last = r.last_start or 0
            # Overdue (or never run): soon, not all at once when the worker starts.
            r.next_run = max(last + u.every, now + 10) if u.every else None

    # running
    def spawn(self, r: Running, why: str) -> None:
        u = r.unit
        try:
            uid = self.uids.of(u.ext)
            ext_home(u.ext, uid)
            env = unit_env(u, os.path.join(EXT, u.ext))
            log = open(self.log_path(u), "ab")
        except OSError as e:
            self.cannot_start(r, e)
            return
        try:
            r.proc = subprocess.Popen(
                [sys.executable, os.path.join(HERE, "worker.py"), "unit"],
                cwd=u.dir, env={**env, "WORKER_UNIT": json.dumps(u.spec())}, user=uid, group=uid, extra_groups=[],
                umask=0o077, stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT, start_new_session=True,
                close_fds=True,
            )
        except OSError as e:
            self.cannot_start(r, e)
            return
        finally:
            log.close()
        r.started = time.time()
        r.state = "running"
        self.unit_log(u, f"{'run' if u.kind == 'job' else 'started'} ({why}), pid {r.proc.pid}, uid {uid}")

    def cannot_start(self, r: Running, e: OSError) -> None:
        """A service tries again later (backing off like a crash); a job waits for its next run."""
        self.unit_log(r.unit, f"cannot start: {e}")
        if r.unit.kind == "service":
            r.backoff = min(r.backoff * 2, 60.0)
            r.retry_at, r.state = time.time() + r.backoff, "backoff"
        else:
            r.state = "failed"

    def stop(self, r: Running, wait: float = 10.0) -> None:
        p = r.proc
        if not p or p.poll() is not None:
            r.proc = None
            return
        try:
            os.killpg(p.pid, signal.SIGTERM)
            p.wait(wait)
        except subprocess.TimeoutExpired:
            os.killpg(p.pid, signal.SIGKILL)
            p.wait()
        except ProcessLookupError:
            pass
        r.proc = None

    def tick(self) -> None:
        now = time.time()
        for r in self.units.values():
            u, p = r.unit, r.proc
            if p and p.poll() is not None:
                code = p.returncode
                r.proc, r.last_exit, r.last_exit_at = None, code, now
                if u.kind == "job":
                    r.last_end = now
                    r.last_duration = round(now - (r.last_start or now), 1)
                    r.state, r.kill_at = "idle", None
                    self.unit_log(u, f"run ended: exit {code} after {r.last_duration} s")
                    self.job_history[u.key] = {"start": r.last_start, "end": r.last_end, "exit": code, "duration": r.last_duration}
                    _write_json(self.jobs_file, self.job_history, 0o600)
                else:
                    ran = now - (r.started or now)
                    r.backoff = 1.0 if ran > 60 else min(r.backoff * 2, 60.0)
                    r.retry_at, r.state, r.restarts = now + r.backoff, "backoff", r.restarts + 1
                    self.unit_log(u, f"exited with {code} after {round(ran)} s: restarting in {round(r.backoff)} s")
            if u.kind == "service" and not r.proc and r.state in ("starting", "backoff") and now >= r.retry_at:
                self.spawn(r, "restart" if r.restarts else "start")
            if u.kind == "job":
                if r.proc and r.kill_at and now >= r.kill_at:
                    self.unit_log(u, f"run took longer than {_human(u.timeout)}: stopping it")
                    try:
                        os.killpg(r.proc.pid, signal.SIGTERM if now < r.kill_at + 10 else signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                elif not r.proc and r.next_run and now >= r.next_run:
                    self.run_job(r, "schedule")

    def run_job(self, r: Running, why: str) -> None:
        if r.proc:
            return
        now = time.time()
        r.last_start, r.kill_at, r.run_reason = now, now + r.unit.timeout, why
        self.spawn(r, why)
        self.schedule(r, now)

    def handle_requests(self) -> None:
        try:
            names = sorted(os.listdir(CONTROL))
        except OSError:
            return
        for n in names:
            if not n.endswith(".json"):  # a request being written (.json.tmp)
                continue
            path = os.path.join(CONTROL, n)
            try:
                if os.path.getsize(path) > 2048:
                    continue
                with open(path, encoding="utf-8") as f:
                    req = json.load(f)
            except (OSError, ValueError):
                req = None
            finally:
                try:
                    os.unlink(path)
                except OSError:
                    pass
            if not isinstance(req, dict):
                continue
            r = self.units.get(str(req.get("unit", "")))
            action = req.get("action")
            if not r:
                continue
            if action == "restart" and r.unit.kind == "service":
                self.unit_log(r.unit, "restart asked in the app")
                self.stop(r)
                r.retry_at, r.backoff, r.state, r.restarts = 0.0, 1.0, "starting", r.restarts + 1
            elif action == "run" and r.unit.kind == "job":
                self.run_job(r, "asked in the app")

    # status
    def measure(self) -> None:
        """Memory of each unit: the resident size of its process group (from the worker's own /proc)."""
        page = os.sysconf("SC_PAGE_SIZE")
        groups: dict[int, int] = {}
        for d in os.listdir("/proc"):
            if not d.isdigit():
                continue
            try:
                with open(f"/proc/{d}/stat", encoding="utf-8", errors="replace") as f:
                    rest = f.read().rsplit(")", 1)[1].split()
                groups[int(rest[2])] = groups.get(int(rest[2]), 0) + int(rest[21]) * page
            except (OSError, IndexError, ValueError):
                continue
        for r in self.units.values():
            r.rss = groups.get(r.proc.pid) if r.proc else None

    def status(self) -> dict[str, Any]:
        units = sorted(self.units.values(), key=lambda r: r.unit.key)
        used = lambda pred: [r.unit.key for r in units if pred(r.unit)]  # noqa: E731
        access = []
        for name, a in ACCESS["host"].items():
            try:
                readonly = bool(os.statvfs(a["path"]).f_flag & os.ST_RDONLY) and os.path.ismount(a["path"])
                mounted = os.path.ismount(a["path"])
            except OSError:
                readonly = mounted = False
            access.append({"name": name, "path": a["path"], "source": a["source"], "what": a["what"], "mounted": mounted,
                           "readonly": readonly, "used_by": used(lambda u, n=name: n in u.host)})
        keys = [{"name": k, "what": what, "set": bool(os.environ.get(k)), "used_by": used(lambda u, k=k: k in u.keys)}
                for k, what in ACCESS["keys"].items()]
        out = []
        for r in units:
            u = r.unit
            out.append({
                "key": u.key, "ext": u.ext, "name": u.name, "kind": u.kind, "description": u.description,
                "run": " ".join(u.run), "dir": os.path.relpath(u.dir, os.path.join(EXT, u.ext)),
                "host": u.host, "keys": u.keys, "env": sorted(u.env), "uid": self.uids.map.get(u.ext),
                "state": r.state, "pid": r.proc.pid if r.proc else None, "since": iso(r.started) if r.proc else None,
                "restarts": r.restarts, "last_exit": r.last_exit, "last_exit_at": iso(r.last_exit_at), "rss": r.rss,
                "schedule": u.schedule(), "timeout": _human(u.timeout) if u.kind == "job" else None,
                "next_run": iso(r.next_run) if u.kind == "job" else None,
                "last_run": {"start": iso(r.last_start), "end": iso(r.last_end), "exit": r.last_exit, "duration": r.last_duration}
                if u.kind == "job" and r.last_start else None,
                "log": os.path.basename(self.log_path(u)),
            })
        return {
            "version": 1,
            "hostname": socket.gethostname(),
            "started_at": iso(self.started),
            "access": access,
            "keys": keys,
            "database": bool(os.environ.get("SERVICES_DB_PASSWORD")),
            "units": out,
            "external": self.external,
            "problems": self.problems,
        }

    def write_status(self) -> None:
        body = self.status()
        text = json.dumps(body, sort_keys=True)
        now = time.time()
        # Written when something changed, and every 20 s anyway: `at` tells the app the worker is alive.
        if text == self.last_status and now - self.status_at < 20:
            return
        self.last_status, self.status_at = text, now
        _write_json(os.path.join(STATE, "status.json"), {**body, "at": iso(now)})

    def rotate_logs(self) -> None:
        for n in os.listdir(LOGS):
            path = os.path.join(LOGS, n)
            try:
                if not n.endswith(".log") or os.path.getsize(path) <= LOG_MAX:
                    continue
                with open(path, "r+b") as f:
                    f.seek(-LOG_KEEP, os.SEEK_END)
                    keep = f.read()
                    keep = keep[keep.find(b"\n") + 1:]
                    f.seek(0)
                    f.write(keep)
                    f.truncate()
            except OSError:
                continue

    def main(self) -> None:
        self.prepare()
        signal.signal(signal.SIGTERM, lambda *_: setattr(self, "stopping", True))
        signal.signal(signal.SIGINT, lambda *_: setattr(self, "stopping", True))
        say(f"supervising the extensions in {EXT} (host access: {', '.join(ACCESS['host'])})")
        threading.Thread(target=serve_ext_run, args=(int(os.environ.get("HOST_UID", "1000")),), daemon=True).start()
        next_scan = 0.0
        while not self.stopping:
            now = time.time()
            if now >= next_scan:
                next_scan = now + SCAN_SECONDS
                try:
                    self.scan()
                except Exception as e:  # noqa: BLE001 - a bad manifest must never stop the others
                    say(f"scan failed: {e!r}")
                self.handle_requests()
                if now - self.rss_at >= 15:
                    self.rss_at = now
                    self.measure()
                    self.rotate_logs()
            self.tick()
            self.write_status()
            time.sleep(1)
        say("stopping every unit")
        for r in self.units.values():
            if r.proc:
                try:
                    os.killpg(r.proc.pid, signal.SIGTERM)
                except ProcessLookupError:
                    pass
        deadline = time.time() + 8
        for r in self.units.values():
            if r.proc:
                try:
                    r.proc.wait(max(0.1, deadline - time.time()))
                except subprocess.TimeoutExpired:
                    os.killpg(r.proc.pid, signal.SIGKILL)


# -- `ext-run` from the app's terminal ------------------------------------------------------------------
# The terminal container cannot reach Docker, so it cannot `docker compose exec` into this one. Its
# `ext-run` (docker/terminal/ext-run) connects to RUN_SOCKET instead, and this runs `worker.py run ...` on a
# pseudo-terminal, as the unit runs, relaying the keys and the output. The socket answers only HOST_UID (the
# terminal's user): the same reach it already has, since it can edit the extensions this process runs.
# Frames both ways: one type byte, a 4-byte big-endian length, the payload. Terminal -> worker: "o" (open,
# JSON {ext, unit, argv, rows, cols, term}, first), "d" (keys), "w" (window size, JSON {rows, cols}).
# Worker -> terminal: "d" (output), "x" (the exit code, as text, last).

def send_frame(sock: socket.socket, kind: bytes, payload: bytes) -> None:
    sock.sendall(kind + struct.pack(">I", len(payload)) + payload)


def recv_exact(sock: socket.socket, n: int) -> bytes | None:
    buf = b""
    while len(buf) < n:
        chunk = sock.recv(n - len(buf))
        if not chunk:
            return None
        buf += chunk
    return buf


def recv_frame(sock: socket.socket, limit: int = 65536) -> tuple[bytes, bytes] | None:
    head = recv_exact(sock, 5)
    if not head:
        return None
    size = struct.unpack(">I", head[1:])[0]
    if size > limit:
        return None
    body = recv_exact(sock, size) if size else b""
    return None if body is None else (head[:1], body)


def set_winsize(fd: int, size: Any) -> None:
    if isinstance(size, dict):
        rows, cols = size.get("rows"), size.get("cols")
        if isinstance(rows, int) and isinstance(cols, int) and 0 < rows < 1000 and 0 < cols < 1000:
            fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))


def open_request(raw: bytes) -> dict[str, Any] | None:
    """The "o" frame, checked: an installed-looking id, a unit name, a short argument list."""
    try:
        req = json.loads(raw)
    except ValueError:
        return None
    argv = req.get("argv", []) if isinstance(req, dict) else None
    if not (isinstance(req, dict) and isinstance(req.get("ext"), str) and ID_RE.match(req["ext"])
            and isinstance(req.get("unit"), str) and NAME_RE.match(req["unit"])
            and isinstance(argv, list) and len(argv) <= 40 and all(isinstance(a, str) and len(a) <= 500 for a in argv)):
        return None
    term = req.get("term")
    req["term"] = term if isinstance(term, str) and re.fullmatch(r"[A-Za-z0-9._+-]{1,40}", term) else "xterm"
    return req


def relay_session(conn: socket.socket, host_uid: int) -> None:
    proc = None
    master = -1
    try:
        _pid, uid, _gid = struct.unpack("3i", conn.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, struct.calcsize("3i")))
        if uid != host_uid:
            return
        conn.settimeout(10)
        first = recv_frame(conn)
        req = open_request(first[1]) if first and first[0] == b"o" else None
        if not req:
            send_frame(conn, b"d", b"ext-run: the request could not be read\r\n")
            send_frame(conn, b"x", b"2")
            return
        conn.settimeout(None)
        master, slave = pty.openpty()
        set_winsize(master, req)
        say(f"ext-run from the terminal: {req['ext']}/{req['unit']} {' '.join(req['argv'])}".rstrip())
        # setsid -c: a session of its own with this pty as its terminal (getpass reads /dev/tty).
        proc = subprocess.Popen(
            ["setsid", "-c", sys.executable, os.path.join(HERE, "worker.py"), "run", req["ext"], req["unit"], "--", *req["argv"]],
            stdin=slave, stdout=slave, stderr=slave, env={**os.environ, "TERM": req["term"]}, close_fds=True)
        os.close(slave)
        while True:
            ready, _, _ = select.select([conn, master], [], [])
            if master in ready:
                try:
                    out = os.read(master, 65536)
                except OSError:  # EIO: every process on the pty is gone
                    out = b""
                if not out:
                    break
                send_frame(conn, b"d", out)
            if conn in ready:
                frame = recv_frame(conn)
                if frame is None:  # the terminal went away: end the command like a closed terminal would
                    os.killpg(proc.pid, signal.SIGHUP)
                    break
                if frame[0] == b"d":
                    os.write(master, frame[1])
                elif frame[0] == b"w":
                    try:
                        set_winsize(master, json.loads(frame[1]))
                    except ValueError:
                        pass
        code = proc.wait()
        send_frame(conn, b"x", str(code if code >= 0 else 128 - code).encode())
    except (OSError, ValueError) as e:
        say(f"ext-run session ended: {e!r}")
    finally:
        if proc and proc.poll() is None:
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except OSError:
                pass
            proc.wait()
        if master >= 0:
            os.close(master)
        conn.close()


def serve_ext_run(host_uid: int) -> None:
    try:
        os.makedirs(os.path.dirname(RUN_SOCKET), exist_ok=True)
        os.chmod(os.path.dirname(RUN_SOCKET), 0o755)
        if os.path.lexists(RUN_SOCKET):
            os.unlink(RUN_SOCKET)
        srv = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        srv.bind(RUN_SOCKET)
        os.chown(RUN_SOCKET, host_uid, host_uid)
        os.chmod(RUN_SOCKET, 0o600)
        srv.listen(4)
    except OSError as e:
        say(f"ext-run for the terminal is off: {e!r}")
        return
    while True:
        try:
            conn, _ = srv.accept()
        except OSError:
            continue
        threading.Thread(target=relay_session, args=(conn, host_uid), daemon=True).start()


# -- inside a unit (its own uid) --------------------------------------------------------------------

def unit_main(spec: dict[str, Any], argv: list[str] | None = None) -> None:
    """Runs as the extension's uid in the unit's folder: a venv for requirements.txt (in WORKER_DATA,
    rebuilt when the file or Python changes), then the command."""
    env = dict(os.environ)
    env.pop("WORKER_UNIT", None)
    here = spec.get("dir") or os.getcwd()
    if not os.access(here, os.R_OK | os.X_OK):
        # Python would only say "No module named ..." (the folder cannot be listed).
        sys.exit(f"{iso(time.time())} [worker] cannot read {here} as uid {os.getuid()}: the extension's files must be "
                 "readable by others. On the host: sudo ./beni.sh fix-permissions")
    req = os.path.join(here, "requirements.txt")
    if os.path.isfile(req):
        venv = os.path.join(env["WORKER_DATA"], "venv", hashlib.sha256(os.getcwd().encode()).hexdigest()[:12])
        os.makedirs(os.path.dirname(venv), exist_ok=True)
        with open(f"{venv}.lock", "w") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)  # a service and a job of one folder share the venv
            with open(req, "rb") as f:
                want = f"{sys.version_info[0]}.{sys.version_info[1]} {hashlib.sha256(f.read()).hexdigest()}"
            stamp = os.path.join(venv, ".worker-stamp")
            try:
                with open(stamp, encoding="utf-8") as f:
                    have = f.read().strip()
            except OSError:
                have = ""
            if have != want:
                print(f"{iso(time.time())} [worker] installing requirements.txt into {venv}", flush=True)
                subprocess.run([sys.executable, "-m", "venv", "--clear", venv], check=True)
                subprocess.run([os.path.join(venv, "bin", "pip"), "install", "-q", "--disable-pip-version-check",
                                "--no-cache-dir", "-r", req], check=True)
                with open(stamp, "w", encoding="utf-8") as f:
                    f.write(want)
        env["PATH"] = f"{venv}/bin:{env['PATH']}"
        env["VIRTUAL_ENV"] = venv
    cmd = argv or spec["run"]
    os.execvpe(cmd[0], cmd, env)


def run_as(ext: str, name: str, argv: list[str]) -> None:
    """`ext-run <ext> <unit> [cmd...]`: a unit's command, or another (a login, a one-off), as the unit runs
    it, in this terminal. For the owner on the host (`docker compose exec -it worker ext-run ...`)."""
    root = os.path.join(EXT, ext)
    if ext not in installed_ids() or not ID_RE.match(ext):
        sys.exit(f"ext-run: {ext} is not installed")
    units, problems, _ = read_extension(ext, root)
    unit = next((u for u in units if u.name == name), None)
    if not unit:
        sys.exit(f"ext-run: {ext} has no service or job {name}" + (f" ({'; '.join(problems)})" if problems else ""))
    uid = Uids(os.path.join(DATA, "uids.json")).of(ext)
    ext_home(ext, uid)
    env = {**unit_env(unit, root), "TERM": os.environ.get("TERM", "xterm")}
    os.chdir(unit.dir)
    os.setgroups([])
    os.setgid(uid)
    os.setuid(uid)
    os.umask(0o077)
    os.environ.clear()
    os.environ.update(env)
    unit_main(unit.spec(), argv or None)


if __name__ == "__main__":
    args = sys.argv[1:]
    if args[:1] == ["unit"]:
        try:
            unit_main(json.loads(os.environ["WORKER_UNIT"]))
        except (OSError, subprocess.CalledProcessError) as e:
            sys.exit(f"{iso(time.time())} [worker] cannot start: {e}")
    elif args[:1] == ["run"] and len(args) >= 3:
        rest = args[3:]
        run_as(args[1], args[2], rest[1:] if rest[:1] == ["--"] else rest)
    elif not args:
        Supervisor().main()
    else:
        sys.exit(__doc__)
