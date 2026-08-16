from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
import types
import unittest
from pathlib import Path

from benchmarks.dsh_bench.cli import main
from benchmarks.dsh_bench.comparison import compare_results
from benchmarks.dsh_bench.fixtures import create_fixture
from benchmarks.dsh_bench.metrics import COUNT_METRIC_FIELDS, SIGNED_METRIC_FIELDS, event_metrics
from benchmarks.dsh_bench.replay import replay_fixture
from benchmarks.dsh_bench.reporting import render_markdown_report
from benchmarks.dsh_bench.runner import run_one
from benchmarks.dsh_bench.schema import RESULT_KIND, RESULT_SCHEMA_VERSION
from benchmarks.dsh_bench.tasks import Task, task_fingerprint
from benchmarks.dsh_bench.validation import validated_index

ROOT = Path(__file__).resolve().parents[3]
SCRIPT = ROOT / "scripts/dsh_bench.py"


def command_result(exit_code: int = 0) -> dict[str, object]:
    return {
        "exit_code": exit_code,
        "seconds": 0.1,
        "stdout_tail": "",
        "stderr_tail": "",
        "timed_out": False,
        "spawn_error": None,
    }


def result_row(
    *,
    task_id: str = "task",
    repetition: int = 1,
    fingerprint: str = "sha256:" + "a" * 64,
    success: bool | None = True,
    failure_kind: str | None = None,
    status: str = "completed",
    outcome: str = "passed",
    scored: bool = True,
    metric: int = 1,
) -> dict[str, object]:
    row: dict[str, object] = {
        "schema_version": RESULT_SCHEMA_VERSION,
        "kind": RESULT_KIND,
        "task_id": task_id,
        "repetition": repetition,
        "task_fingerprint": fingerprint,
        "workspace": "/tmp/workspace",
        "provider": "provider",
        "model": "model",
        "status": status,
        "outcome": outcome,
        "success": success,
        "scored": scored,
        "failure_kind": failure_kind,
        "prepare": None,
    }
    if status == "completed":
        row.update({
            "finish_reason": "stop",
            "agent_seconds": float(metric),
            "session_id": "session",
            "session_root": "/tmp/sessions",
            "final_response": "response",
            "check": command_result(0 if success is True else 1) if scored else None,
        })
        for field in COUNT_METRIC_FIELDS:
            row[field] = metric
        row["run_code_calls"] = 0
        row["code_subcalls"] = 0
        row["leaf_tool_calls"] = row["tool_calls"]
        row["input_tokens"] = metric
        row["cache_read_tokens"] = metric
        row["cache_write_tokens"] = metric
        row["billed_input_tokens"] = metric * 3
        for field in SIGNED_METRIC_FIELDS:
            row[field] = metric
    return row


class BenchmarkRefactorTests(unittest.TestCase):
    def test_duplicate_result_keys_are_rejected(self) -> None:
        row = result_row()
        with self.assertRaisesRegex(ValueError, "duplicate result key task#1"):
            validated_index([row, dict(row)], source="fixture")

    def test_derived_metrics_are_validated(self) -> None:
        row = result_row()
        row["leaf_tool_calls"] = 99
        with self.assertRaisesRegex(ValueError, "leaf_tool_calls"):
            validated_index([row], source="fixture")

    def test_non_contiguous_repetitions_are_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "non-contiguous repetitions"):
            validated_index([result_row(repetition=1), result_row(repetition=3)], source="fixture")

    def test_invalid_fingerprint_is_rejected(self) -> None:
        row = result_row(fingerprint="not-a-digest")
        with self.assertRaisesRegex(ValueError, "task_fingerprint"):
            validated_index([row], source="fixture")

    def test_incomplete_pairs_are_strict_by_default(self) -> None:
        baseline = [result_row(task_id="a"), result_row(task_id="b")]
        candidate = [result_row(task_id="a", metric=2)]
        with self.assertRaisesRegex(ValueError, "paired result sets are incomplete"):
            compare_results(baseline, candidate)
        comparison = compare_results(baseline, candidate, allow_partial=True)
        self.assertFalse(comparison["pairing"]["complete"])
        self.assertEqual(comparison["pairing"]["baseline_only"], ["b#1"])
        self.assertEqual(comparison["paired_runs"], 1)

    def test_task_fingerprint_mismatch_is_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "different task_fingerprint"):
            compare_results(
                [result_row(fingerprint="sha256:" + "a" * 64)],
                [result_row(fingerprint="sha256:" + "b" * 64)],
            )

    def test_failure_taxonomy_and_transitions_are_reported(self) -> None:
        comparison = compare_results(
            [result_row(success=True, metric=1)],
            [result_row(success=False, failure_kind="check-nonzero", outcome="failed", metric=2)],
        )
        self.assertEqual(comparison["regressions"], ["task#1"])
        self.assertEqual(comparison["failure_transitions"], {"none->check-nonzero": 1})
        pair = comparison["pairs"][0]
        self.assertEqual(pair["outcome_transition"], "passed->failed")
        self.assertEqual(pair["delta_candidate_minus_baseline"]["turns"], 1)

    def test_fixture_replay_is_deterministic(self) -> None:
        fixture = create_fixture([result_row(metric=1)], [result_row(metric=2)])
        self.assertEqual(replay_fixture(fixture, source="fixture"), fixture["expected_comparison"])
        fixture["expected_comparison"]["paired_runs"] = 999
        with self.assertRaisesRegex(ValueError, "deterministic replay differs"):
            replay_fixture(fixture, source="fixture")

    def test_fixture_digest_detects_observation_edits(self) -> None:
        fixture = create_fixture([result_row(metric=1)], [result_row(metric=2)])
        fixture["candidate_results"][0]["final_response"] = "edited"
        with self.assertRaisesRegex(ValueError, "candidate_digest"):
            replay_fixture(fixture, source="fixture")

    def test_markdown_report_is_neutral_and_contains_failure_counts(self) -> None:
        comparison = compare_results(
            [result_row(success=True, metric=1)],
            [result_row(success=False, failure_kind="check-nonzero", outcome="failed", metric=2)],
        )
        report = render_markdown_report(comparison)
        self.assertIn("does not infer which agent composition or execution mode is better", report)
        self.assertIn("`check-nonzero`", report)
        self.assertIn("Pass → fail: task#1", report)

    def test_event_metrics_preserve_leaf_and_token_accounting(self) -> None:
        metrics = event_metrics([
            {"type": "tool/call", "data": {"name": "run_code"}},
            {"type": "tool/code-dispatch", "data": {"isError": False}},
            {"type": "tool/code-dispatch", "data": {"isError": True}},
            {"type": "assistant/message", "data": {"usage": {
                "inputTokens": 5, "cacheReadTokens": 2, "cacheWriteTokens": 3, "outputTokens": 4
            }}},
        ])
        self.assertEqual(metrics["leaf_tool_calls"], 2)
        self.assertEqual(metrics["billed_input_tokens"], 10)
        self.assertEqual(metrics["code_subcall_errors"], 1)

    def test_task_fingerprint_uses_semantic_fields_not_workspace(self) -> None:
        left = Task("x", Path("/tmp/a"), "prompt", ("echo", "x"), ("true",))
        right = Task("x", Path("/tmp/b"), "prompt", ("echo", "x"), ("true",))
        self.assertEqual(task_fingerprint(left), task_fingerprint(right))

    def test_prepare_failure_taxonomy_is_unchanged(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            task = Task("prepare", Path(directory), "prompt", (sys.executable, "-c", "raise SystemExit(7)"), ("true",))
            args = argparse.Namespace(provider="p", model="m", command_timeout=5.0, max_tokens=None, cordis=None)
            row = run_one(task, args, 1, "run", Path(directory) / "sessions")
            self.assertEqual(row["status"], "prepare-failed")
            self.assertEqual(row["failure_kind"], "prepare-nonzero")
            self.assertEqual(row["outcome"], "failed")

    def test_agent_failure_taxonomy_is_unchanged(self) -> None:
        class Harness:
            def __init__(self, **_: object) -> None: pass
            def __enter__(self): return self
            def __exit__(self, *args: object) -> None: return None
            def run(self, *args: object, **kwargs: object): raise RuntimeError("boom")
        previous = sys.modules.get("deepseek_harness")
        sys.modules["deepseek_harness"] = types.SimpleNamespace(DeepSeekHarness=Harness)
        try:
            with tempfile.TemporaryDirectory() as directory:
                task = Task("agent", Path(directory), "prompt", None, ("true",))
                args = argparse.Namespace(provider="p", model="m", command_timeout=5.0, max_tokens=None, cordis=None)
                row = run_one(task, args, 1, "run", Path(directory) / "sessions")
                self.assertEqual(row["status"], "agent-failed")
                self.assertEqual(row["failure_kind"], "agent-exception")
        finally:
            if previous is None:
                sys.modules.pop("deepseek_harness", None)
            else:
                sys.modules["deepseek_harness"] = previous

    def test_check_failure_taxonomy_is_unchanged(self) -> None:
        class Result:
            events: list[dict[str, object]] = []
            finish_reason = "stop"
            session_id = "s"
            session_root = "/tmp/s"
            final_response = "ok"
        class Harness:
            def __init__(self, **_: object) -> None: pass
            def __enter__(self): return self
            def __exit__(self, *args: object) -> None: return None
            def run(self, *args: object, **kwargs: object): return Result()
        previous = sys.modules.get("deepseek_harness")
        sys.modules["deepseek_harness"] = types.SimpleNamespace(DeepSeekHarness=Harness)
        try:
            with tempfile.TemporaryDirectory() as directory:
                task = Task("check", Path(directory), "prompt", None, (sys.executable, "-c", "raise SystemExit(9)"))
                args = argparse.Namespace(provider="p", model="m", command_timeout=5.0, max_tokens=None, cordis=None)
                row = run_one(task, args, 1, "run", Path(directory) / "sessions")
                self.assertEqual(row["status"], "completed")
                self.assertEqual(row["failure_kind"], "check-nonzero")
                self.assertFalse(row["success"])
        finally:
            if previous is None:
                sys.modules.pop("deepseek_harness", None)
            else:
                sys.modules["deepseek_harness"] = previous

    def test_cli_fixture_and_replay_round_trip(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            baseline, candidate, fixture = root / "baseline.jsonl", root / "candidate.jsonl", root / "fixture.json"
            baseline.write_text(json.dumps(result_row(metric=1)) + "\n", encoding="utf-8")
            candidate.write_text(json.dumps(result_row(metric=2)) + "\n", encoding="utf-8")
            self.assertEqual(main(["fixture", str(baseline), str(candidate), "--output", str(fixture)]), 0)
            self.assertEqual(main(["replay", str(fixture)]), 0)

    def test_script_and_module_help_are_identical(self) -> None:
        script = subprocess.run([sys.executable, str(SCRIPT), "--help"], cwd=ROOT, capture_output=True, text=True)
        module = subprocess.run([sys.executable, "-m", "benchmarks.dsh_bench", "--help"], cwd=ROOT, capture_output=True, text=True)
        self.assertEqual(script.returncode, 0)
        self.assertEqual((script.stdout, script.stderr), (module.stdout, module.stderr))
        self.assertTrue(script.stdout.startswith("usage: dsh_bench.py"))

    def test_script_wrapper_stays_under_50_lines(self) -> None:
        self.assertLess(len(SCRIPT.read_text(encoding="utf-8").splitlines()), 50)

    def test_invalid_cli_input_preserves_exit_code_2(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "bad.jsonl"
            path.write_text("{}\n", encoding="utf-8")
            completed = subprocess.run([sys.executable, str(SCRIPT), "validate", str(path)], cwd=ROOT, capture_output=True, text=True)
            self.assertEqual(completed.returncode, 2)
            self.assertTrue(completed.stderr.startswith("error: invalid benchmark results"))


if __name__ == "__main__":
    unittest.main()
