from __future__ import annotations

from typing import Any

JsonObject = dict[str, Any]
ResultKey = tuple[str, int]

RESULT_SCHEMA_VERSION = 1
COMPARISON_SCHEMA_VERSION = 1
FIXTURE_SCHEMA_VERSION = 1
VALIDATION_SCHEMA_VERSION = 1
RESULT_KIND = "benchmark-result"
PAIR_KIND = "benchmark-pair"
COMPARISON_KIND = "benchmark-comparison"
FIXTURE_KIND = "benchmark-paired-fixture"
VALIDATION_KIND = "benchmark-validation"

FAILURE_KINDS = (
    "prepare-timeout",
    "prepare-exec-error",
    "prepare-nonzero",
    "agent-exception",
    "check-timeout",
    "check-exec-error",
    "check-nonzero",
)
OUTCOMES = ("passed", "failed", "unscored")
STATUSES = ("prepare-failed", "agent-failed", "completed")
