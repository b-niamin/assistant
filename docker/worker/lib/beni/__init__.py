"""What every extension service needs from the assistant, so none writes it again (audit R12).

The worker puts this on PYTHONPATH of every unit (`import beni`); an extension's tests get it from the
core checkout (its CI sets PYTHONPATH=<core>/docker/worker/lib). Standard library only: psycopg is the
extension's own requirement, imported when `connect()` is first called.

    from beni import env_int, log, connect, every

    log("collector: started")                      # one line, local time (TZ), flushed: /worker/logs/<id>.<unit>.log
    interval = env_int("MONITOR_INTERVAL_SECONDS", 30, minimum=5)
    conn = connect()                               # DATABASE_URL: the extension's own login (ext_<id>_svc)
    every(interval, one_pass)                      # until the worker stops the unit (SIGTERM)
"""
from __future__ import annotations

import logging
import os
import signal
import threading
import time
from datetime import datetime
from typing import Any, Callable

__all__ = ["log", "logger", "env", "env_int", "database_url", "connect", "stopping", "every"]

_FORMAT = "%(asctime)s %(levelname)s %(name)s %(message)s"


def log(msg: str) -> None:
    """One line with the local time (the worker sets TZ to the app's time zone), flushed at once."""
    print(f"{datetime.now().astimezone().isoformat(timespec='seconds')} {msg}", flush=True)


def logger(name: str) -> logging.Logger:
    """A `logging` logger in the same format as log(), LOG_LEVEL from the environment (default INFO)."""
    root = logging.getLogger()
    if not root.handlers:
        h = logging.StreamHandler()
        h.setFormatter(logging.Formatter(_FORMAT, datefmt="%Y-%m-%dT%H:%M:%S%z"))
        root.addHandler(h)
        root.setLevel(os.environ.get("LOG_LEVEL", "INFO").upper())
    return logging.getLogger(name)


def env(name: str, default: str = "") -> str:
    """A setting from the environment (the manifest's "env", the worker's own), stripped; default when unset or empty."""
    v = os.environ.get(name, "").strip()
    return v or default


def env_int(name: str, default: int, minimum: int | None = None, maximum: int | None = None) -> int:
    """A whole number from the environment, the default when unset or not a number, kept within the bounds."""
    try:
        v = int(env(name, str(default)))
    except ValueError:
        v = default
    if minimum is not None:
        v = max(minimum, v)
    if maximum is not None:
        v = min(maximum, v)
    return v


def database_url() -> str:
    """The extension's database login. Empty when the extension has no db/ folder or the install has no
    SERVICES_DB_PASSWORD."""
    return env("DATABASE_URL")


def connect(**kwargs: Any) -> Any:
    """A psycopg connection as the extension's own role, autocommit unless told otherwise."""
    import psycopg  # the extension's requirement, not the worker's

    url = database_url()
    if not url:
        raise RuntimeError("no DATABASE_URL: the extension needs a db/ folder and the install SERVICES_DB_PASSWORD")
    kwargs.setdefault("autocommit", True)
    return psycopg.connect(url, **kwargs)


_stop = threading.Event()


def _on_term(signum: int, _frame: Any) -> None:
    _stop.set()


def stopping() -> threading.Event:
    """Set when the worker asks the unit to stop (SIGTERM, SIGINT); wait on it instead of time.sleep."""
    if threading.current_thread() is threading.main_thread():
        for s in (signal.SIGTERM, signal.SIGINT):
            if signal.getsignal(s) in (signal.SIG_DFL, signal.default_int_handler):
                signal.signal(s, _on_term)
    return _stop


def every(seconds: float, fn: Callable[[], Any], on_error: Callable[[BaseException], Any] | None = None) -> None:
    """Calls fn now and then every `seconds` (from the start of one call to the next) until the unit is
    asked to stop. An exception is handed to on_error (default: logged) and the loop goes on."""
    stop = stopping()
    while not stop.is_set():
        started = time.monotonic()
        try:
            fn()
        except Exception as e:  # noqa: BLE001: a pass that fails must not end the service
            (on_error or (lambda err: log(f"error: {type(err).__name__}: {err}")))(e)
        stop.wait(max(0.0, seconds - (time.monotonic() - started)))
