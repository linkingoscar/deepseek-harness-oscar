from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Mapping, Sequence

from .metrics import COUNT_METRIC_FIELDS, SIGNED_METRIC_FIELDS
from .schema import FAILURE_KINDS, OUTCOMES, RESULT_KIND, RESULT_SCHEMA_VERSION, STATUSES, JsonObject, ResultKey


def load_results(path: Path) -> list[JsonObject]:
    rows: list[JsonObject] = []
    with path.open("r", encoding="utf-8") as handle:
        for line_number, raw in enumerate(handle, 1):
            if not raw.strip():
                continue
            try:
                value = json.loads(raw)
            except json.JSONDecodeError as exc:
                raise ValueError(f"{path}:{line_number}: invalid JSON: {exc.msg}") from exc
            if not isinstance(value, dict):
                raise ValueError(f"{path}:{line_number}: result row must be an object")
            rows.append(value)
    if not rows:
        raise ValueError(f"{path}: no benchmark results found")
    return rows


def result_key(row: Mapping[str, object]) -> ResultKey | None:
    task_id = row.get("task_id")
    repetition = row.get("repetition")
    if (
        isinstance(task_id, str)
        and task_id.strip()
        and isinstance(repetition, int)
        and not isinstance(repetition, bool)
        and repetition >= 1
    ):
        return task_id, repetition
    return None


def is_number(value: object) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def validate_command_result(value: object, *, source: str) -> list[str]:
    errors: list[str] = []
    if not isinstance(value, dict):
        return [f"{source} must be an object"]
    exit_code = value.get("exit_code")
    timed_out = value.get("timed_out")
    seconds = value.get("seconds")
    if exit_code is not None and (not isinstance(exit_code, int) or isinstance(exit_code, bool)):
        errors.append(f"{source}.exit_code must be an integer or null")
    if not isinstance(timed_out, bool):
        errors.append(f"{source}.timed_out must be a boolean")
    spawn_error = value.get("spawn_error")
    if spawn_error is not None and (
        not isinstance(spawn_error, dict)
        or not isinstance(spawn_error.get("type"), str)
        or not isinstance(spawn_error.get("message"), str)
    ):
        errors.append(f"{source}.spawn_error must be null or contain type/message strings")
    if not is_number(seconds) or float(seconds) < 0:
        errors.append(f"{source}.seconds must be a non-negative number")
    if timed_out is True and exit_code is not None:
        errors.append(f"{source}: timed_out=true requires exit_code=null")
    if spawn_error is not None and exit_code is not None:
        errors.append(f"{source}: spawn_error requires exit_code=null")
    if timed_out is True and spawn_error is not None:
        errors.append(f"{source}: timed_out and spawn_error are mutually exclusive")
    if exit_code is None and timed_out is False and spawn_error is None:
        errors.append(f"{source}: command result must record exit_code, timeout, or spawn_error")
    return errors


def validate_result_row(row: Mapping[str, object], *, source: str) -> list[str]:
    errors: list[str] = []
    if row.get("schema_version") != RESULT_SCHEMA_VERSION:
        errors.append(f"{source}.schema_version must equal {RESULT_SCHEMA_VERSION}")
    if row.get("kind") != RESULT_KIND:
        errors.append(f"{source}.kind must equal {RESULT_KIND!r}")
    if result_key(row) is None:
        errors.append(f"{source}: task_id must be non-empty and repetition must be an integer >= 1")
    fingerprint = row.get("task_fingerprint")
    if not isinstance(fingerprint, str) or not re.fullmatch(r"sha256:[0-9a-f]{64}", fingerprint):
        errors.append(f"{source}.task_fingerprint must be a sha256 digest")
    for field in ("provider", "model"):
        value = row.get(field)
        if not isinstance(value, str) or not value.strip():
            errors.append(f"{source}.{field} must be a non-empty string")
    variant = row.get("variant")
    if variant is not None and (not isinstance(variant, str) or not variant.strip()):
        errors.append(f"{source}.variant must be a non-empty string when present")
    status = row.get("status")
    if status not in STATUSES:
        errors.append(f"{source}.status must be one of {STATUSES}")
    outcome = row.get("outcome")
    if outcome not in OUTCOMES:
        errors.append(f"{source}.outcome must be one of {OUTCOMES}")
    scored = row.get("scored")
    if not isinstance(scored, bool):
        errors.append(f"{source}.scored must be a boolean")
    success = row.get("success")
    if success is not None and not isinstance(success, bool):
        errors.append(f"{source}.success must be a boolean or null")
    failure_kind = row.get("failure_kind")
    if failure_kind is not None and failure_kind not in FAILURE_KINDS:
        errors.append(f"{source}.failure_kind must be null or one of {FAILURE_KINDS}")

    if outcome == "passed":
        if scored is not True or success is not True or failure_kind is not None or status != "completed":
            errors.append(f"{source}: passed requires scored=true, success=true, completed status, and no failure_kind")
    elif outcome == "unscored":
        if scored is not False or success is not None or failure_kind is not None or status != "completed":
            errors.append(f"{source}: unscored requires scored=false, success=null, completed status, and no failure_kind")
    elif outcome == "failed":
        if scored is True and success is not False:
            errors.append(f"{source}: failed scored results require success=false")
        if scored is False and success is not None:
            errors.append(f"{source}: failed unscored results require success=null")
        if failure_kind is None:
            errors.append(f"{source}: failed results require failure_kind")

    prepare = row.get("prepare")
    if prepare is not None:
        errors.extend(validate_command_result(prepare, source=f"{source}.prepare"))
    check = row.get("check")
    if check is not None:
        errors.extend(validate_command_result(check, source=f"{source}.check"))

    if status == "prepare-failed":
        if failure_kind not in ("prepare-timeout", "prepare-exec-error", "prepare-nonzero"):
            errors.append(f"{source}: prepare-failed requires a prepare failure_kind")
        if prepare is None:
            errors.append(f"{source}: prepare-failed requires prepare diagnostics")
        elif isinstance(prepare, dict):
            if failure_kind == "prepare-timeout" and prepare.get("timed_out") is not True:
                errors.append(f"{source}: prepare-timeout requires prepare.timed_out=true")
            if failure_kind == "prepare-exec-error" and prepare.get("spawn_error") is None:
                errors.append(f"{source}: prepare-exec-error requires prepare.spawn_error")
            if failure_kind == "prepare-nonzero" and (
                not isinstance(prepare.get("exit_code"), int)
                or isinstance(prepare.get("exit_code"), bool)
                or prepare.get("exit_code") == 0
            ):
                errors.append(f"{source}: prepare-nonzero requires a non-zero prepare.exit_code")
        if check is not None:
            errors.append(f"{source}: prepare-failed must not contain check diagnostics")
    elif status == "agent-failed":
        if failure_kind != "agent-exception":
            errors.append(f"{source}: agent-failed requires failure_kind='agent-exception'")
        error = row.get("error")
        if not isinstance(error, dict) or not isinstance(error.get("type"), str) or not isinstance(error.get("message"), str):
            errors.append(f"{source}: agent-failed requires error.type and error.message strings")
        if check is not None:
            errors.append(f"{source}: agent-failed must not contain check diagnostics")
    elif status == "completed":
        if not is_number(row.get("agent_seconds")) or float(row.get("agent_seconds", -1)) < 0:
            errors.append(f"{source}.agent_seconds must be a non-negative number for completed results")
        if scored is True and check is None:
            errors.append(f"{source}: completed scored results require check diagnostics")
        if scored is False and check is not None:
            errors.append(f"{source}: completed unscored results must not contain check diagnostics")
        if failure_kind in ("check-timeout", "check-exec-error", "check-nonzero") and scored is not True:
            errors.append(f"{source}: check failures require scored=true")
        if isinstance(check, dict):
            if outcome == "passed" and (check.get("exit_code") != 0 or check.get("timed_out") is not False or check.get("spawn_error") is not None):
                errors.append(f"{source}: passed requires a successful check command")
            if failure_kind == "check-timeout" and check.get("timed_out") is not True:
                errors.append(f"{source}: check-timeout requires check.timed_out=true")
            if failure_kind == "check-exec-error" and check.get("spawn_error") is None:
                errors.append(f"{source}: check-exec-error requires check.spawn_error")
            if failure_kind == "check-nonzero" and (
                not isinstance(check.get("exit_code"), int)
                or isinstance(check.get("exit_code"), bool)
                or check.get("exit_code") == 0
            ):
                errors.append(f"{source}: check-nonzero requires a non-zero check.exit_code")
        for field in COUNT_METRIC_FIELDS:
            value = row.get(field)
            if not isinstance(value, int) or isinstance(value, bool) or value < 0:
                errors.append(f"{source}.{field} must be a non-negative integer for completed results")
        for field in SIGNED_METRIC_FIELDS:
            value = row.get(field)
            if not isinstance(value, int) or isinstance(value, bool):
                errors.append(f"{source}.{field} must be an integer for completed results")
        tool_calls = row.get("tool_calls")
        run_code_calls = row.get("run_code_calls")
        code_subcalls = row.get("code_subcalls")
        leaf_tool_calls = row.get("leaf_tool_calls")
        if all(isinstance(value, int) and not isinstance(value, bool) for value in (tool_calls, run_code_calls, code_subcalls, leaf_tool_calls)):
            expected_leaf = int(tool_calls) - int(run_code_calls) + int(code_subcalls)
            if leaf_tool_calls != expected_leaf:
                errors.append(f"{source}.leaf_tool_calls must equal tool_calls - run_code_calls + code_subcalls")
        input_tokens = row.get("input_tokens")
        cache_read = row.get("cache_read_tokens")
        cache_write = row.get("cache_write_tokens")
        billed = row.get("billed_input_tokens")
        if all(isinstance(value, int) and not isinstance(value, bool) for value in (input_tokens, cache_read, cache_write, billed)):
            expected_billed = int(input_tokens) + int(cache_read) + int(cache_write)
            if billed != expected_billed:
                errors.append(f"{source}.billed_input_tokens must equal input_tokens + cache_read_tokens + cache_write_tokens")
    return errors


def validated_index(results: Sequence[JsonObject], *, source: str) -> dict[ResultKey, JsonObject]:
    errors: list[str] = []
    indexed: dict[ResultKey, JsonObject] = {}
    for index, row in enumerate(results, 1):
        row_source = f"{source}:{index}"
        row_errors = validate_result_row(row, source=row_source)
        errors.extend(row_errors)
        key = result_key(row)
        if key is not None:
            if key in indexed:
                errors.append(f"{row_source}: duplicate result key {result_label(key)}")
            else:
                indexed[key] = row
    if indexed:
        providers = {row.get("provider") for row in indexed.values()}
        models = {row.get("model") for row in indexed.values()}
        variants = {row.get("variant") for row in indexed.values()}
        if len(providers) > 1:
            errors.append(f"{source}: result file mixes multiple providers")
        if len(models) > 1:
            errors.append(f"{source}: result file mixes multiple models")
        if len(variants) > 1:
            errors.append(f"{source}: result file mixes variant values or variant presence")
        repetitions_by_task: dict[str, set[int]] = {}
        for task_id, repetition in indexed:
            repetitions_by_task.setdefault(task_id, set()).add(repetition)
        for task_id, repetitions in sorted(repetitions_by_task.items()):
            expected = set(range(1, max(repetitions) + 1))
            if repetitions != expected:
                missing = sorted(expected - repetitions)
                errors.append(f"{source}: task {task_id!r} has non-contiguous repetitions; missing {missing}")
    if errors:
        detail = "\n".join(f"- {error}" for error in errors)
        raise ValueError(f"invalid benchmark results in {source}:\n{detail}")
    return indexed


def result_label(key: ResultKey) -> str:
    return f"{key[0]}#{key[1]}"
