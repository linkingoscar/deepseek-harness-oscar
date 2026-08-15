from __future__ import annotations

import importlib.util
import json
import subprocess
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
        "schema_version": MODULE.RESULT_SCHEMA_VERSION,
        "kind": MODULE.RESULT_KIND,
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
        for field in MODULE.COUNT_METRIC_FIELDS:
            row[field] = metric
        row["run_code_calls"] = 0
        row["code_subcalls"] = 0
        row["leaf_tool_calls"] = row["tool_calls"]
        row["input_tokens"] = metric
        row["cache_read_tokens"] = metric
        row["cache_write_tokens"] = metric
        row["billed_input_tokens"] = metric * 3
        for field in MODULE.SIGNED_METRIC_FIELDS:
            row[field] = metric
    return row


class BenchmarkValidationTests(unittest.TestCase):
    def test_duplicate_result_keys_are_rejected(self) -> None:
        row = result_row()
        with self.assertRaisesRegex(ValueError, "duplicate result key task#1"):
            MODULE.validated_index([row, dict(row)], source="fixture")

    def test_derived_metrics_are_validated(self) -> None:
        row = result_row()
        row["leaf_tool_calls"] = 99
        with self.assertRaisesRegex(ValueError, "leaf_tool_calls"):
            MODULE.validated_index([row], source="fixture")

    def test_non_contiguous_repetitions_are_rejected(self) -> None:
        first = result_row(repetition=1)
        third = result_row(repetition=3)
        with self.assertRaisesRegex(ValueError, "non-contiguous repetitions"):
            MODULE.validated_index([first, third], source="fixture")

    def test_incomplete_pairs_are_strict_by_default(self) -> None:
        baseline = [result_row(task_id="a"), result_row(task_id="b")]
        candidate = [result_row(task_id="a", metric=2)]
        with self.assertRaisesRegex(ValueError, "paired result sets are incomplete"):
            MODULE.compare_results(baseline, candidate)

        comparison = MODULE.compare_results(baseline, candidate, allow_partial=True)
        self.assertFalse(comparison["pairing"]["complete"])
        self.assertEqual(comparison["pairing"]["baseline_only"], ["b#1"])
        self.assertEqual(comparison["paired_runs"], 1)

    def test_task_fingerprint_mismatch_is_rejected(self) -> None:
        baseline = [result_row(fingerprint="sha256:" + "a" * 64)]
        candidate = [result_row(fingerprint="sha256:" + "b" * 64)]
        with self.assertRaisesRegex(ValueError, "different task_fingerprint"):
            MODULE.compare_results(baseline, candidate)

    def test_failure_taxonomy_and_transitions_are_reported(self) -> None:
        baseline = [result_row(success=True, metric=1)]
        candidate = [
            result_row(
                success=False,
                failure_kind="check-nonzero",
                outcome="failed",
                metric=2,
            )
        ]
        comparison = MODULE.compare_results(baseline, candidate)
        self.assertEqual(comparison["regressions"], ["task#1"])
        self.assertEqual(comparison["failure_transitions"], {"none->check-nonzero": 1})
        pair = comparison["pairs"][0]
        self.assertEqual(pair["outcome_transition"], "passed->failed")
        self.assertEqual(pair["delta_candidate_minus_baseline"]["turns"], 1)

    def test_fixture_replay_is_deterministic(self) -> None:
        baseline = [result_row(metric=1)]
        candidate = [result_row(metric=2)]
        fixture = MODULE.create_fixture(baseline, candidate)
        replayed = MODULE.replay_fixture(fixture, source="fixture")
        self.assertEqual(replayed, fixture["expected_comparison"])

        fixture["expected_comparison"]["paired_runs"] = 999
        with self.assertRaisesRegex(ValueError, "deterministic replay differs"):
            MODULE.replay_fixture(fixture, source="fixture")

    def test_fixture_digest_detects_observation_edits(self) -> None:
        fixture = MODULE.create_fixture([result_row(metric=1)], [result_row(metric=2)])
        fixture["candidate_results"][0]["final_response"] = "edited"
        with self.assertRaisesRegex(ValueError, "candidate_digest"):
            MODULE.replay_fixture(fixture, source="fixture")

    def test_markdown_report_is_neutral_and_contains_failure_counts(self) -> None:
        comparison = MODULE.compare_results(
            [result_row(success=True, metric=1)],
            [result_row(success=False, failure_kind="check-nonzero", outcome="failed", metric=2)],
        )
        report = MODULE.render_markdown_report(comparison)
        self.assertIn("does not infer which agent composition or execution mode is better", report)
        self.assertIn("`check-nonzero`", report)
        self.assertIn("Pass → fail: task#1", report)

    def test_cli_fixture_and_replay_round_trip(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            baseline = root / "baseline.jsonl"
            candidate = root / "candidate.jsonl"
            fixture = root / "fixture.json"
            baseline.write_text(json.dumps(result_row(metric=1)) + "\n", encoding="utf-8")
            candidate.write_text(json.dumps(result_row(metric=2)) + "\n", encoding="utf-8")

            self.assertEqual(MODULE.main(["fixture", str(baseline), str(candidate), "--output", str(fixture)]), 0)
            self.assertEqual(MODULE.main(["replay", str(fixture)]), 0)


if __name__ == "__main__":
    unittest.main()
