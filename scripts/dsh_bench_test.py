from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path

MODULE_PATH = Path(__file__).with_name("dsh_bench.py")
SPEC = importlib.util.spec_from_file_location("dsh_bench", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


class BenchMetricsTests(unittest.TestCase):
    def test_event_metrics_sum_usage_and_code_mode_trajectory(self) -> None:
        events = [
            {"type": "turn/end", "data": {}},
            {"type": "step/end", "data": {}},
            {"type": "tool/call", "data": {"name": "run_code"}},
            {"type": "tool/result", "data": {}},
            {"type": "tool/code-dispatch-start", "data": {"name": "bash"}},
            {"type": "tool/code-dispatch", "data": {"name": "bash", "isError": False}},
            {"type": "tool/code-dispatch", "data": {"name": "str_replace_editor", "isError": True}},
            {
                "type": "assistant/message",
                "data": {
                    "usage": {
                        "inputTokens": 10,
                        "outputTokens": 3,
                        "cacheReadTokens": 5,
                        "cacheWriteTokens": 2,
                        "reasoningTokens": 4,
                    }
                },
            },
        ]

        metrics = MODULE.event_metrics(events)

        self.assertEqual(metrics["turns"], 1)
        self.assertEqual(metrics["steps"], 1)
        self.assertEqual(metrics["tool_calls"], 1)
        self.assertEqual(metrics["run_code_calls"], 1)
        self.assertEqual(metrics["code_subcalls"], 2)
        self.assertEqual(metrics["code_subcall_errors"], 1)
        self.assertEqual(metrics["leaf_tool_calls"], 2)
        self.assertEqual(metrics["tool_errors"], 0)
        self.assertEqual(metrics["input_tokens"], 10)
        self.assertEqual(metrics["output_tokens"], 3)
        self.assertEqual(metrics["reasoning_tokens"], 4)
        self.assertEqual(metrics["billed_input_tokens"], 17)

    def test_native_leaf_calls_equal_model_tool_calls(self) -> None:
        metrics = MODULE.event_metrics([
            {"type": "tool/call", "data": {"name": "bash"}},
            {"type": "tool/call", "data": {"name": "str_replace_editor"}},
        ])
        self.assertEqual(metrics["tool_calls"], 2)
        self.assertEqual(metrics["leaf_tool_calls"], 2)
        self.assertEqual(metrics["run_code_calls"], 0)
        self.assertEqual(metrics["code_subcalls"], 0)

    def test_compare_pairs_by_task_and_repetition(self) -> None:
        baseline = [
            {
                "task_id": "a",
                "repetition": 1,
                "scored": True,
                "success": True,
                "agent_seconds": 2.0,
                "turns": 1,
                "steps": 1,
                "tool_calls": 2,
                "leaf_tool_calls": 2,
                "code_subcalls": 0,
                "billed_input_tokens": 100,
                "output_tokens": 20,
            },
            {"task_id": "baseline-only", "repetition": 1, "scored": True, "success": True},
        ]
        candidate = [
            {
                "task_id": "a",
                "repetition": 1,
                "scored": True,
                "success": False,
                "agent_seconds": 3.0,
                "turns": 2,
                "steps": 2,
                "tool_calls": 1,
                "leaf_tool_calls": 3,
                "code_subcalls": 3,
                "billed_input_tokens": 120,
                "output_tokens": 25,
            },
            {"task_id": "candidate-only", "repetition": 1, "scored": True, "success": True},
        ]

        comparison = MODULE.compare_results(baseline, candidate)

        self.assertEqual(comparison["paired_runs"], 1)
        self.assertEqual(comparison["regressions"], ["a#1"])
        self.assertEqual(comparison["improvements"], [])
        self.assertEqual(comparison["delta_candidate_minus_baseline"]["pass_rate"], -1.0)
        self.assertEqual(comparison["delta_candidate_minus_baseline"]["median_tool_calls"], -1.0)
        self.assertEqual(comparison["delta_candidate_minus_baseline"]["median_leaf_tool_calls"], 1.0)
        self.assertEqual(comparison["delta_candidate_minus_baseline"]["median_code_subcalls"], 3.0)


class TaskLoadingTests(unittest.TestCase):
    def test_duplicate_ids_are_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            tasks = root / "tasks.jsonl"
            row = {"id": "same", "workspace": str(root), "prompt": "Do work"}
            tasks.write_text(json.dumps(row) + "\n" + json.dumps(row) + "\n", encoding="utf-8")

            with self.assertRaisesRegex(ValueError, "duplicate task id"):
                MODULE.load_tasks(tasks)

    def test_command_must_be_argv_array(self) -> None:
        with self.assertRaisesRegex(ValueError, "non-empty JSON array"):
            MODULE.optional_command("pytest -q", source="task.check")


class ParserTests(unittest.TestCase):
    def test_compare_modes_defaults_to_checked_in_compositions(self) -> None:
        parsed = MODULE.parser().parse_args([
            "compare-modes",
            "tasks.jsonl",
            "--output-dir",
            ".bench/code-mode",
        ])
        self.assertEqual(parsed.toolset, "fs")
        self.assertIsNone(parsed.native_cordis)
        self.assertIsNone(parsed.code_cordis)
        self.assertEqual(MODULE.MODE_CORDIS_PAIRS["fs"], (MODULE.DEFAULT_FS_NATIVE_CORDIS, MODULE.DEFAULT_FS_CODE_CORDIS))
        self.assertEqual(parsed.repeat, 1)

    def test_compare_modes_can_select_shell_pair(self) -> None:
        parsed = MODULE.parser().parse_args([
            "compare-modes",
            "tasks.jsonl",
            "--output-dir",
            ".bench/code-mode",
            "--toolset",
            "shell",
        ])
        self.assertEqual(parsed.toolset, "shell")


if __name__ == "__main__":
    unittest.main()
