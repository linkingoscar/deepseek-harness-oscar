from __future__ import annotations

from typing import Mapping

from .comparison import compare_results
from .fixtures import canonical_rows, result_digest
from .schema import FIXTURE_KIND, FIXTURE_SCHEMA_VERSION, JsonObject


def replay_fixture(fixture: Mapping[str, object], *, source: str) -> JsonObject:
    if fixture.get("schema_version") != FIXTURE_SCHEMA_VERSION:
        raise ValueError(f"{source}.schema_version must equal {FIXTURE_SCHEMA_VERSION}")
    if fixture.get("kind") != FIXTURE_KIND:
        raise ValueError(f"{source}.kind must equal {FIXTURE_KIND!r}")
    allow_partial = fixture.get("allow_partial")
    if not isinstance(allow_partial, bool):
        raise ValueError(f"{source}.allow_partial must be a boolean")
    baseline = fixture.get("baseline_results")
    candidate = fixture.get("candidate_results")
    expected = fixture.get("expected_comparison")
    if not isinstance(baseline, list) or not all(isinstance(row, dict) for row in baseline):
        raise ValueError(f"{source}.baseline_results must be an array of result objects")
    if not isinstance(candidate, list) or not all(isinstance(row, dict) for row in candidate):
        raise ValueError(f"{source}.candidate_results must be an array of result objects")
    if not isinstance(expected, dict):
        raise ValueError(f"{source}.expected_comparison must be an object")
    baseline_rows = canonical_rows(baseline, source=f"{source}.baseline_results")
    candidate_rows = canonical_rows(candidate, source=f"{source}.candidate_results")
    baseline_digest = result_digest(baseline_rows)
    candidate_digest = result_digest(candidate_rows)
    if fixture.get("baseline_digest") != baseline_digest:
        raise ValueError(f"{source}: baseline_digest does not match baseline_results")
    if fixture.get("candidate_digest") != candidate_digest:
        raise ValueError(f"{source}: candidate_digest does not match candidate_results")
    actual = compare_results(
        baseline_rows,
        candidate_rows,
        allow_partial=allow_partial,
        baseline_source=f"{source}.baseline_results",
        candidate_source=f"{source}.candidate_results",
    )
    if actual != expected:
        raise ValueError(f"{source}: deterministic replay differs from expected_comparison")
    return actual
