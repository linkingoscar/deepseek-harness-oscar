from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Sequence

from .comparison import compare_results
from .schema import FIXTURE_KIND, FIXTURE_SCHEMA_VERSION, JsonObject
from .validation import validated_index


def canonical_rows(results: Sequence[JsonObject], *, source: str) -> list[JsonObject]:
    indexed = validated_index(results, source=source)
    return [indexed[key] for key in sorted(indexed)]


def result_digest(results: Sequence[JsonObject]) -> str:
    payload = json.dumps(results, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return "sha256:" + hashlib.sha256(payload).hexdigest()


def create_fixture(
    baseline: Sequence[JsonObject],
    candidate: Sequence[JsonObject],
    *,
    allow_partial: bool = False,
    baseline_source: str = "baseline",
    candidate_source: str = "candidate",
) -> JsonObject:
    baseline_rows = canonical_rows(baseline, source=baseline_source)
    candidate_rows = canonical_rows(candidate, source=candidate_source)
    comparison = compare_results(
        baseline_rows,
        candidate_rows,
        allow_partial=allow_partial,
        baseline_source="fixture.baseline_results",
        candidate_source="fixture.candidate_results",
    )
    return {
        "schema_version": FIXTURE_SCHEMA_VERSION,
        "kind": FIXTURE_KIND,
        "allow_partial": allow_partial,
        "baseline_digest": result_digest(baseline_rows),
        "candidate_digest": result_digest(candidate_rows),
        "baseline_results": baseline_rows,
        "candidate_results": candidate_rows,
        "expected_comparison": comparison,
    }


def load_json_object(path: Path) -> JsonObject:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ValueError(f"{path}: invalid JSON: {exc.msg}") from exc
    if not isinstance(value, dict):
        raise ValueError(f"{path}: expected a JSON object")
    return value
