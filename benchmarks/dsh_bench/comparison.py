from __future__ import annotations

import statistics
from collections.abc import Iterable, Mapping, Sequence

from .metrics import METRIC_FIELDS
from .pairing import paired_indexes
from .schema import COMPARISON_KIND, COMPARISON_SCHEMA_VERSION, FAILURE_KINDS, PAIR_KIND, JsonObject, ResultKey
from .validation import is_number, result_label

SUMMARY_TOTAL_FIELDS = (
    "turns",
    "steps",
    "tool_calls",
    "tool_errors",
    "run_code_calls",
    "code_subcalls",
    "code_subcall_errors",
    "leaf_tool_calls",
    "input_tokens",
    "output_tokens",
    "cache_read_tokens",
    "cache_write_tokens",
    "reasoning_tokens",
    "billed_input_tokens",
    "request_headers",
    "prompt_envelope_changes",
)
SUMMARY_MEDIAN_ONLY_FIELDS = (
    "max_system_chars",
    "max_tool_schema_json_chars",
    "max_prompt_envelope_chars",
    "max_tool_count",
    "prompt_envelope_growth_chars",
    "max_prompt_envelope_step_growth_chars",
)
SUMMARY_DELTA_FIELDS = (
    "passed",
    "failed_runs",
    "unscored_runs",
    "pass_rate",
    "median_agent_seconds",
    "median_turns",
    "median_steps",
    "median_tool_calls",
    "median_leaf_tool_calls",
    "median_code_subcalls",
    "median_billed_input_tokens",
    "median_output_tokens",
    "median_request_headers",
    "median_prompt_envelope_changes",
    "median_max_system_chars",
    "median_max_tool_schema_json_chars",
    "median_max_prompt_envelope_chars",
    "median_max_tool_count",
    "median_prompt_envelope_growth_chars",
    "median_max_prompt_envelope_step_growth_chars",
)
PAIR_DELTA_FIELDS = ("agent_seconds",) + METRIC_FIELDS


def numeric(values: Iterable[JsonObject], field: str) -> list[float]:
    result: list[float] = []
    for value in values:
        item = value.get(field)
        if isinstance(item, (int, float)) and not isinstance(item, bool):
            result.append(float(item))
    return result


def summarize(results: Sequence[JsonObject]) -> JsonObject:
    scored = [row for row in results if row.get("scored") is True]
    passed = sum(row.get("success") is True for row in scored)
    failures = sum(row.get("outcome") == "failed" for row in results)
    unscored = sum(row.get("outcome") == "unscored" for row in results)
    seconds = numeric(results, "agent_seconds")
    failure_counts = {kind: 0 for kind in FAILURE_KINDS}
    for row in results:
        failure_kind = row.get("failure_kind")
        if isinstance(failure_kind, str) and failure_kind in failure_counts:
            failure_counts[failure_kind] += 1
    summary: JsonObject = {
        "runs": len(results),
        "scored_runs": len(scored),
        "passed": passed,
        "failed_runs": failures,
        "unscored_runs": unscored,
        "pass_rate": passed / len(scored) if scored else None,
        "median_agent_seconds": statistics.median(seconds) if seconds else None,
        "failure_counts": failure_counts,
    }
    for field in SUMMARY_TOTAL_FIELDS:
        values = numeric(results, field)
        summary[f"total_{field}"] = int(sum(values)) if values else 0
        summary[f"median_{field}"] = statistics.median(values) if values else None
    for field in SUMMARY_MEDIAN_ONLY_FIELDS:
        values = numeric(results, field)
        summary[f"median_{field}"] = statistics.median(values) if values else None
    return summary


def result_view(row: Mapping[str, object]) -> JsonObject:
    view: JsonObject = {
        "status": row.get("status"),
        "outcome": row.get("outcome"),
        "success": row.get("success"),
        "failure_kind": row.get("failure_kind"),
        "provider": row.get("provider"),
        "model": row.get("model"),
    }
    if "variant" in row:
        view["variant"] = row.get("variant")
    for field in PAIR_DELTA_FIELDS:
        if field in row:
            view[field] = row.get(field)
    return view


def numeric_delta(before: object, after: object) -> float | int | None:
    if not is_number(before) or not is_number(after):
        return None
    delta = after - before
    if isinstance(before, int) and isinstance(after, int):
        return int(delta)
    return float(delta)


def paired_result(key: ResultKey, baseline: JsonObject, candidate: JsonObject) -> JsonObject:
    deltas = {field: numeric_delta(baseline.get(field), candidate.get(field)) for field in PAIR_DELTA_FIELDS}
    base_failure = baseline.get("failure_kind") or "none"
    candidate_failure = candidate.get("failure_kind") or "none"
    return {
        "schema_version": COMPARISON_SCHEMA_VERSION,
        "kind": PAIR_KIND,
        "task_id": key[0],
        "repetition": key[1],
        "task_fingerprint": baseline.get("task_fingerprint"),
        "baseline": result_view(baseline),
        "candidate": result_view(candidate),
        "outcome_transition": f"{baseline.get('outcome')}->{candidate.get('outcome')}",
        "failure_transition": f"{base_failure}->{candidate_failure}",
        "delta_candidate_minus_baseline": deltas,
    }


def compare_results(
    baseline: Sequence[JsonObject],
    candidate: Sequence[JsonObject],
    *,
    allow_partial: bool = False,
    baseline_source: str = "baseline",
    candidate_source: str = "candidate",
) -> JsonObject:
    base_by_key, candidate_by_key, common, baseline_only, candidate_only = paired_indexes(
        baseline,
        candidate,
        allow_partial=allow_partial,
        baseline_source=baseline_source,
        candidate_source=candidate_source,
    )
    baseline_paired = [base_by_key[key] for key in common]
    candidate_paired = [candidate_by_key[key] for key in common]
    pairs = [paired_result(key, base_by_key[key], candidate_by_key[key]) for key in common]
    regressions: list[str] = []
    improvements: list[str] = []
    failure_transitions: dict[str, int] = {}
    for key, pair in zip(common, pairs):
        before = base_by_key[key].get("success")
        after = candidate_by_key[key].get("success")
        label = result_label(key)
        if before is True and after is False:
            regressions.append(label)
        elif before is False and after is True:
            improvements.append(label)
        transition = str(pair["failure_transition"])
        failure_transitions[transition] = failure_transitions.get(transition, 0) + 1

    base_summary = summarize(baseline_paired)
    candidate_summary = summarize(candidate_paired)
    delta: JsonObject = {
        field: numeric_delta(base_summary.get(field), candidate_summary.get(field))
        for field in SUMMARY_DELTA_FIELDS
    }
    return {
        "schema_version": COMPARISON_SCHEMA_VERSION,
        "kind": COMPARISON_KIND,
        "paired_runs": len(common),
        "pairing": {
            "complete": not baseline_only and not candidate_only,
            "baseline_runs": len(base_by_key),
            "candidate_runs": len(candidate_by_key),
            "baseline_only": [result_label(key) for key in baseline_only],
            "candidate_only": [result_label(key) for key in candidate_only],
        },
        "pairs": pairs,
        "baseline": base_summary,
        "candidate": candidate_summary,
        "delta_candidate_minus_baseline": delta,
        "regressions": regressions,
        "improvements": improvements,
        "failure_transitions": dict(sorted(failure_transitions.items())),
    }
