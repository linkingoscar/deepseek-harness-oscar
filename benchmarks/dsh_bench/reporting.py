from __future__ import annotations

from pathlib import Path
from typing import Mapping

from .schema import COMPARISON_KIND, COMPARISON_SCHEMA_VERSION, FAILURE_KINDS


def validate_comparison(value: Mapping[str, object], *, source: str) -> None:
    if value.get("schema_version") != COMPARISON_SCHEMA_VERSION:
        raise ValueError(f"{source}.schema_version must equal {COMPARISON_SCHEMA_VERSION}")
    if value.get("kind") != COMPARISON_KIND:
        raise ValueError(f"{source}.kind must equal {COMPARISON_KIND!r}")
    if not isinstance(value.get("paired_runs"), int) or isinstance(value.get("paired_runs"), bool):
        raise ValueError(f"{source}.paired_runs must be an integer")
    pairing = value.get("pairing")
    if not isinstance(pairing, dict) or not isinstance(pairing.get("complete"), bool):
        raise ValueError(f"{source}.pairing.complete must be a boolean")
    pairs = value.get("pairs")
    if not isinstance(pairs, list):
        raise ValueError(f"{source}.pairs must be an array")


def format_number(value: object) -> str:
    if value is None:
        return "—"
    if isinstance(value, float):
        return f"{value:.6g}"
    return str(value)


def render_markdown_report(comparison: Mapping[str, object]) -> str:
    validate_comparison(comparison, source="comparison")
    pairing = comparison["pairing"]
    assert isinstance(pairing, dict)
    baseline = comparison.get("baseline")
    candidate = comparison.get("candidate")
    delta = comparison.get("delta_candidate_minus_baseline")
    if not isinstance(baseline, dict) or not isinstance(candidate, dict) or not isinstance(delta, dict):
        raise ValueError("comparison summaries must be objects")
    lines = [
        "# Benchmark comparison report",
        "",
        "This report summarizes recorded observations only. It does not infer which agent composition or execution mode is better.",
        "",
        "## Pairing",
        "",
        f"- Paired runs: {comparison['paired_runs']}",
        f"- Complete pairing: {'yes' if pairing.get('complete') is True else 'no'}",
        f"- Baseline runs: {pairing.get('baseline_runs')}",
        f"- Candidate runs: {pairing.get('candidate_runs')}",
    ]
    baseline_only = pairing.get("baseline_only")
    candidate_only = pairing.get("candidate_only")
    if isinstance(baseline_only, list) and baseline_only:
        lines.append("- Baseline-only keys: " + ", ".join(str(item) for item in baseline_only))
    if isinstance(candidate_only, list) and candidate_only:
        lines.append("- Candidate-only keys: " + ", ".join(str(item) for item in candidate_only))

    lines.extend([
        "",
        "## Outcomes",
        "",
        "| Metric | Baseline | Candidate | Candidate - baseline |",
        "| --- | ---: | ---: | ---: |",
    ])
    outcome_rows = (
        ("Pass rate", "pass_rate"),
        ("Passed", "passed"),
        ("Failed runs", "failed_runs"),
        ("Unscored runs", "unscored_runs"),
        ("Median agent seconds", "median_agent_seconds"),
    )
    for label, field in outcome_rows:
        lines.append(
            f"| {label} | {format_number(baseline.get(field))} | {format_number(candidate.get(field))} | "
            f"{format_number(delta.get(field)) if field in delta else '—'} |"
        )

    lines.extend([
        "",
        "## Diagnostic medians",
        "",
        "| Metric | Baseline | Candidate | Candidate - baseline |",
        "| --- | ---: | ---: | ---: |",
    ])
    diagnostic_rows = (
        ("Turns", "median_turns"),
        ("Steps", "median_steps"),
        ("Model-visible tool calls", "median_tool_calls"),
        ("Leaf tool calls", "median_leaf_tool_calls"),
        ("Code sub-dispatches", "median_code_subcalls"),
        ("Billed input tokens", "median_billed_input_tokens"),
        ("Output tokens", "median_output_tokens"),
        ("Request headers", "median_request_headers"),
        ("Prompt envelope changes", "median_prompt_envelope_changes"),
        ("Max prompt envelope chars", "median_max_prompt_envelope_chars"),
    )
    for label, field in diagnostic_rows:
        lines.append(
            f"| {label} | {format_number(baseline.get(field))} | {format_number(candidate.get(field))} | "
            f"{format_number(delta.get(field))} |"
        )

    lines.extend(["", "## Failure taxonomy", ""])
    base_failures = baseline.get("failure_counts")
    candidate_failures = candidate.get("failure_counts")
    if not isinstance(base_failures, dict) or not isinstance(candidate_failures, dict):
        raise ValueError("comparison failure_counts must be objects")
    lines.extend([
        "| Failure kind | Baseline | Candidate |",
        "| --- | ---: | ---: |",
    ])
    for kind in FAILURE_KINDS:
        lines.append(f"| `{kind}` | {base_failures.get(kind, 0)} | {candidate_failures.get(kind, 0)} |")

    regressions = comparison.get("regressions")
    improvements = comparison.get("improvements")
    lines.extend(["", "## Paired outcome transitions", ""])
    lines.append("- Pass → fail: " + (", ".join(str(item) for item in regressions) if isinstance(regressions, list) and regressions else "none"))
    lines.append("- Fail → pass: " + (", ".join(str(item) for item in improvements) if isinstance(improvements, list) and improvements else "none"))
    transitions = comparison.get("failure_transitions")
    if isinstance(transitions, dict) and transitions:
        lines.extend(["", "### Failure transitions", "", "| Transition | Runs |", "| --- | ---: |"])
        for transition, count in transitions.items():
            lines.append(f"| `{transition}` | {count} |")
    return "\n".join(lines) + "\n"


def write_report(path: Path, comparison: Mapping[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(render_markdown_report(comparison), encoding="utf-8")
