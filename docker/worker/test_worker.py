"""The worker's pure parts: manifests, schedules, environments, fingerprints, passwords.
Run: cd docker/worker && python3 -m unittest -q"""
from __future__ import annotations

import json
import os
import subprocess
import tempfile
import time
import unittest

import worker


def ext_tree(manifest: dict, files: dict[str, str] | None = None) -> str:
    root = tempfile.mkdtemp(prefix="worker-test-")
    ext = os.path.join(root, manifest["id"])
    os.makedirs(ext)
    with open(os.path.join(ext, "extension.json"), "w") as f:
        json.dump(manifest, f)
    for rel, text in (files or {}).items():
        os.makedirs(os.path.dirname(os.path.join(ext, rel)), exist_ok=True)
        with open(os.path.join(ext, rel), "w") as f:
            f.write(text)
    with open(os.path.join(root, "installed.json"), "w") as f:
        json.dump({"extensions": [{"id": manifest["id"]}, {"id": "../etc"}]}, f)
    return root


MONITOR = {
    "id": "monitor",
    "services": [{"name": "collector", "dir": "services/collector", "run": ["python", "-m", "collector", "loop"], "host": ["proc", "sys"]}],
    "jobs": [{"name": "prune", "dir": "services/collector", "run": ["python", "-m", "collector", "prune"], "cron": "15 3 * * *"}],
}


class Manifests(unittest.TestCase):
    def test_services_and_jobs(self) -> None:
        root = ext_tree(MONITOR, {"services/collector/collector/__init__.py": "", "db/migrations/001.sql": ""})
        self.assertEqual(worker.installed_ids(root), ["monitor"])
        units, problems, external = worker.read_extension("monitor", os.path.join(root, "monitor"))
        self.assertEqual(problems, [])
        self.assertEqual(external, [])
        self.assertEqual([(u.name, u.kind) for u in units], [("collector", "service"), ("prune", "job")])
        self.assertEqual(units[1].schedule(), "cron 15 3 * * *")
        self.assertEqual(units[1].timeout, 600)

    def test_names_only_are_services_from_compose(self) -> None:
        root = ext_tree({"id": "health", "services": ["garmin-sync"]})
        units, problems, external = worker.read_extension("health", os.path.join(root, "health"))
        self.assertEqual((units, problems, external), ([], [], ["garmin-sync"]))

    def test_refusals(self) -> None:
        bad = {
            "id": "x",
            "services": [
                {"name": "a", "dir": "../../etc", "run": ["sh"]},
                {"name": "b", "dir": "s", "run": ["sh"], "host": ["proc", "docker.sock"]},
                {"name": "c", "dir": "s", "run": ["sh"], "keys": ["POSTGRES_PASSWORD"]},
                {"name": "d", "dir": "s", "run": ["sh"], "env": {"DATABASE_URL": "x"}},
                {"name": "e", "dir": "s", "run": "sh -c x"},
                {"name": "f", "dir": "s", "run": ["sh"], "every": "5m"},
                {"name": "g", "dir": "s", "run": ["sh"], "privileged": True},
            ],
            "jobs": [
                {"name": "h", "dir": "s", "run": ["sh"]},
                {"name": "i", "dir": "s", "run": ["sh"], "every": "5s"},
                {"name": "j", "dir": "s", "run": ["sh"], "cron": "61 * * * *"},
                {"name": "k", "dir": "s", "run": ["sh"], "every": "1h", "timeout": "7h"},
            ],
        }
        root = ext_tree(bad, {"s/x.py": ""})
        units, problems, _ = worker.read_extension("x", os.path.join(root, "x"))
        self.assertEqual(units, [])
        text = "\n".join(problems)
        for needle in ("a: dir must be a folder inside", "b: host may only list", "c: keys may only list", "d: env must map",
                       "e: run must be a list", "f: a service runs all the time", "g: unknown field 'privileged'",
                       "h: a job has either", "i: every must be", "j: cron:", "k: timeout must be"):
            self.assertIn(needle, text)


class SameRulesAsTheWebApp(unittest.TestCase):
    def test_ids_match_ids_js(self) -> None:
        """apps/web/src/lib/ids.js is where the web app and `ext check` read these rules (audit R10)."""
        here = os.path.dirname(os.path.abspath(__file__))
        with open(os.path.join(here, "../../apps/web/src/lib/ids.js")) as f:
            js = f.read()
        for name, rx in (("EXTENSION_ID_RE", worker.ID_RE), ("UNIT_NAME_RE", worker.NAME_RE)):
            src = js.split(f"export const {name} = /", 1)[1].split("/;", 1)[0]
            self.assertEqual(src, rx.pattern, name)


class Schedules(unittest.TestCase):
    def test_durations(self) -> None:
        self.assertEqual([worker.parse_duration(x) for x in ("30s", "5m", "2h", "1d", "5", "1w", 5)], [30, 300, 7200, 86400, None, None, None])

    def test_cron_next(self) -> None:
        os.environ["TZ"] = "UTC"
        time.tzset()
        base = 1_794_470_400.0  # 2026-11-12 08:00:00 UTC, a Thursday
        self.assertEqual(worker.Cron("15 3 * * *").next_after(base), base + 19 * 3600 + 15 * 60)
        self.assertEqual(worker.Cron("*/20 * * * *").next_after(base), base + 20 * 60)
        self.assertEqual(worker.Cron("0 9 * * 1-5").next_after(base), base + 3600)
        self.assertEqual(worker.Cron("0 9 * * 0").next_after(base), base + 3 * 86400 + 3600)  # Sunday
        self.assertEqual(worker.Cron("0 9 * * 7").next_after(base), base + 3 * 86400 + 3600)
        self.assertEqual(worker.Cron("0 0 1 * *").next_after(base), 1_796_083_200.0)  # 1 Dec
        for bad in ("* * * *", "60 * * * *", "a * * * *", "*/0 * * * *"):
            with self.assertRaises(ValueError):
                worker.Cron(bad)

    def test_job_schedule_keeps_history(self) -> None:
        s = worker.Supervisor.__new__(worker.Supervisor)
        s.job_history = {"x/j": {"start": 1000.0, "end": 1001.0, "exit": 0, "duration": 1.0}}
        u = worker.Unit("x", "j", "job", "/", ["true"], every=3600)
        r = worker.Running(u, "fp")
        s.schedule(r, 2000.0, first=True)
        self.assertEqual((r.last_exit, r.next_run), (0, 4600.0))
        s.schedule(r, 9000.0)  # overdue: soon, not at once
        self.assertEqual(r.next_run, 9010.0)


class Environment(unittest.TestCase):
    def test_built_from_scratch(self) -> None:
        root = ext_tree(MONITOR, {"services/collector/x.py": "", "db/migrations/001.sql": ""})
        units, _, _ = worker.read_extension("monitor", os.path.join(root, "monitor"))
        src = {"SERVICES_DB_PASSWORD": "master", "POSTGRES_DB": "assistant", "TZ": "Europe/Warsaw", "TOKEN_ENCRYPTION_KEY": "k",
               "POSTGRES_PASSWORD": "never"}
        env = worker.unit_env(units[0], os.path.join(root, "monitor"), src)
        pw = worker.service_password("master", "ext_monitor_svc")
        self.assertEqual(env["DATABASE_URL"], f"postgresql://ext_monitor_svc:{pw}@db:5432/assistant")
        self.assertEqual((env["HOST_PROC"], env["HOST_SYS"], env["TZ"]), ("/host/proc", "/host/sys", "Europe/Warsaw"))
        self.assertNotIn("TOKEN_ENCRYPTION_KEY", env)  # not asked for
        self.assertNotIn("SERVICES_DB_PASSWORD", env)
        self.assertNotIn("master", json.dumps(env))
        self.assertNotIn("never", json.dumps(env))

    def test_password_matches_migrate_sh(self) -> None:
        # db/migrate.sh: printf '%s:%s' "$SERVICES_DB_PASSWORD" "$svc" | sha256sum
        out = subprocess.run(["sh", "-c", "printf '%s:%s' 'p@ss w' ext_health_svc | sha256sum | cut -d' ' -f1"],
                             capture_output=True, text=True, check=True).stdout.strip()
        self.assertEqual(out, worker.service_password("p@ss w", "ext_health_svc"))


class Fingerprints(unittest.TestCase):
    def test_changes_with_code_not_with_caches(self) -> None:
        root = ext_tree(MONITOR, {"services/collector/a.py": "1"})
        units, _, _ = worker.read_extension("monitor", os.path.join(root, "monitor"))
        fp = worker.fingerprint(units[0])
        os.makedirs(os.path.join(units[0].dir, "__pycache__"))
        with open(os.path.join(units[0].dir, "__pycache__", "a.pyc"), "w") as f:
            f.write("x")
        self.assertEqual(worker.fingerprint(units[0]), fp)
        with open(os.path.join(units[0].dir, "a.py"), "w") as f:
            f.write("22")
        self.assertNotEqual(worker.fingerprint(units[0]), fp)


class Supervising(unittest.TestCase):
    """scan() and tick() with spawning faked: what starts, restarts, stops and runs."""

    def setUp(self) -> None:
        self.root = ext_tree(MONITOR, {"services/collector/a.py": "1"})
        self.old = worker.EXT, worker.LOGS
        worker.EXT, worker.LOGS = self.root, tempfile.mkdtemp()
        self.s = worker.Supervisor.__new__(worker.Supervisor)
        self.s.units, self.s.job_history, self.s.jobs_file = {}, {}, os.path.join(worker.LOGS, "jobs.json")
        self.events: list[tuple[str, str]] = []
        self.s.spawn = lambda r, why: (self.events.append((r.unit.key, why)), setattr(r, "state", "running"))  # type: ignore[method-assign]
        self.s.stop = lambda r, wait=10.0: self.events.append((r.unit.key, "stop"))  # type: ignore[method-assign]

    def tearDown(self) -> None:
        worker.EXT, worker.LOGS = self.old

    def test_start_restart_on_change_and_stop_on_removal(self) -> None:
        self.s.scan()
        self.s.tick()
        self.assertEqual(self.events, [("monitor/collector", "start")])
        self.assertEqual(self.s.units["monitor/prune"].state, "idle")
        with open(os.path.join(self.root, "monitor", "services", "collector", "a.py"), "w") as f:
            f.write("22")
        self.s.scan()  # changed once: maybe still being copied
        self.assertEqual(len(self.events), 1)
        self.s.scan()  # the same twice: restart
        self.s.tick()
        self.assertEqual(self.events[1:], [("monitor/collector", "stop"), ("monitor/collector", "start")])
        with open(os.path.join(self.root, "installed.json"), "w") as f:
            json.dump({"extensions": []}, f)
        self.s.scan()
        self.assertEqual(self.s.units, {})
        self.assertEqual(sorted(self.events[3:]), [("monitor/collector", "stop"), ("monitor/prune", "stop")])

    def test_a_job_runs_when_due(self) -> None:
        self.s.scan()
        r = self.s.units["monitor/prune"]
        r.next_run = time.time() - 1
        self.s.tick()
        self.assertIn(("monitor/prune", "schedule"), self.events)
        self.assertGreater(r.next_run, time.time())


class Access(unittest.TestCase):
    def test_compose_mounts_what_access_json_opens(self) -> None:
        compose = open(os.path.join(os.path.dirname(__file__), "..", "..", "docker-compose.yml")).read()
        block = compose.split("\n  worker:\n", 1)[1].split("\n\n", 1)[0]
        for a in worker.ACCESS["host"].values():
            self.assertIn(f"- {a['source']}:{a['path']}:ro", block)
        self.assertNotIn("docker.sock", block)
        self.assertNotIn("ports:", block)
        self.assertNotIn("env_file", block)
        self.assertNotIn("logs:/logs", block)  # the updater's control file lives there (spec 004)


if __name__ == "__main__":
    unittest.main()
