from __future__ import annotations

import argparse
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import dsh_bench_compare_modes_offline as offline


class OfflineCompareModesTests(unittest.TestCase):
    def test_runs_pairs_counterbalanced_and_writes_outputs(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            output_dir = root / "out"
            tasks = [
                offline.bench.Task(id="a", workspace=root, prompt="a"),
                offline.bench.Task(id="b", workspace=root, prompt="b"),
            ]
            args = argparse.Namespace(
                tasks=root / "tasks.jsonl",
                output_dir=output_dir,
                toolset="fs",
                native_cordis=root / "native.yml",
                code_cordis=root / "code.yml",
                provider="test-provider",
                model="test-model",
                max_tokens=None,
                repeat=2,
                command_timeout=1.0,
                session_root=root / "sessions",
                run_id="test-run",
                cordis=None,
            )
            calls: list[tuple[str, int]] = []

            def fake_run_one(task, _args, repetition, _run_id, _sessions_dir, *, cordis, variant):
                calls.append((variant, repetition))
                return {
                    "task_id": task.id,
                    "repetition": repetition,
                    "variant": variant,
                    "scored": True,
                    "success": True,
                    "agent_seconds": 1.0,
                }

            with patch.object(offline.bench, "load_tasks", return_value=tasks), patch.object(
                offline.bench, "run_one", side_effect=fake_run_one
            ):
                self.assertEqual(offline.run(args), 0)

            self.assertEqual(
                calls,
                [
                    ("native", 1),
                    ("code", 1),
                    ("code", 1),
                    ("native", 1),
                    ("code", 2),
                    ("native", 2),
                    ("native", 2),
                    ("code", 2),
                ],
            )
            native_rows = [json.loads(line) for line in (output_dir / "native.jsonl").read_text().splitlines()]
            code_rows = [json.loads(line) for line in (output_dir / "code.jsonl").read_text().splitlines()]
            comparison = json.loads((output_dir / "comparison.json").read_text())
            self.assertEqual(len(native_rows), 4)
            self.assertEqual(len(code_rows), 4)
            self.assertEqual(comparison["paired_runs"], 4)
            self.assertEqual(comparison["run_order"], "counterbalanced-paired")


if __name__ == "__main__":
    unittest.main()
