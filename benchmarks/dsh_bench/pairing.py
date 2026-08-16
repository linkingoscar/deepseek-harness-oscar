from __future__ import annotations

from typing import Sequence

from .schema import JsonObject, ResultKey
from .validation import result_label, validated_index


def paired_indexes(
    baseline: Sequence[JsonObject],
    candidate: Sequence[JsonObject],
    *,
    allow_partial: bool = False,
    baseline_source: str = "baseline",
    candidate_source: str = "candidate",
) -> tuple[dict[ResultKey, JsonObject], dict[ResultKey, JsonObject], list[ResultKey], list[ResultKey], list[ResultKey]]:
    base_by_key = validated_index(baseline, source=baseline_source)
    candidate_by_key = validated_index(candidate, source=candidate_source)
    base_keys = set(base_by_key)
    candidate_keys = set(candidate_by_key)
    common = sorted(base_keys & candidate_keys)
    baseline_only = sorted(base_keys - candidate_keys)
    candidate_only = sorted(candidate_keys - base_keys)
    if (baseline_only or candidate_only) and not allow_partial:
        fragments: list[str] = []
        if baseline_only:
            fragments.append("baseline-only=" + ", ".join(result_label(key) for key in baseline_only))
        if candidate_only:
            fragments.append("candidate-only=" + ", ".join(result_label(key) for key in candidate_only))
        raise ValueError("paired result sets are incomplete; pass --allow-partial to compare the intersection: " + "; ".join(fragments))
    if not common:
        raise ValueError("paired result sets have no common (task_id, repetition) keys")
    pair_errors: list[str] = []
    for key in common:
        before = base_by_key[key]
        after = candidate_by_key[key]
        if before.get("task_fingerprint") != after.get("task_fingerprint"):
            pair_errors.append(f"{result_label(key)} has different task_fingerprint values")
        if before.get("scored") != after.get("scored"):
            pair_errors.append(f"{result_label(key)} changes scored status across the pair")
    if pair_errors:
        detail = "\n".join(f"- {error}" for error in pair_errors)
        raise ValueError(f"inconsistent paired results:\n{detail}")
    return base_by_key, candidate_by_key, common, baseline_only, candidate_only
