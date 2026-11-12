"""The `beni` helpers that extension services import. Run: cd docker/worker && python3 -m unittest -q"""
from __future__ import annotations

import io
import os
import sys
import unittest
from contextlib import redirect_stdout
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib"))
import beni  # noqa: E402


class Env(unittest.TestCase):
    def test_numbers_with_bounds(self) -> None:
        with mock.patch.dict(os.environ, {"A": "3", "B": "x", "C": " "}):
            self.assertEqual(beni.env_int("A", 30, minimum=5), 5)
            self.assertEqual(beni.env_int("B", 30), 30)
            self.assertEqual(beni.env_int("C", 30, maximum=10), 10)
            self.assertEqual(beni.env("C", "d"), "d")

    def test_connect_needs_a_url(self) -> None:
        with mock.patch.dict(os.environ, {"DATABASE_URL": ""}):
            with self.assertRaises(Exception):
                beni.connect()


class Loop(unittest.TestCase):
    def test_every_goes_on_after_an_error_and_stops(self) -> None:
        calls = []

        def one() -> None:
            calls.append(1)
            if len(calls) == 1:
                raise ValueError("boom")
            if len(calls) == 3:
                beni.stopping().set()

        out = io.StringIO()
        with redirect_stdout(out):
            beni.every(0, one)
        beni.stopping().clear()
        self.assertEqual(len(calls), 3)
        self.assertIn("error: ValueError: boom", out.getvalue())


class Worker(unittest.TestCase):
    def test_units_get_it_on_their_path(self) -> None:
        import worker

        unit = worker.Unit("monitor", "collector", "service", "/x", ["python3"])
        self.assertEqual(worker.unit_env(unit, "/nonexistent", {})["PYTHONPATH"], worker.LIB)
