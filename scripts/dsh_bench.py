#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import re
import statistics
import subprocess
import sys
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence

JsonObject = dict[str, Any]
ResultKey = tuple[str, int]

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SHELL_NATIVE_CORDIS = REPO_ROOT / "examples/jsonrpc-agent/minimal.cordis.yml"
DEFAULT_SHELL_CODE_CORDIS = REPO_ROOT / "examples/jsonrpc-agent/minimal-code.cordis.yml"
DEFAULT_FS_NATIVE_CORDIS = REPO_ROOT / "examples/jsonrpc-agent/minimal-fs.cordis.yml"
DEFAULT_FS_CODE_CORDIS = REPO_ROOT / "examples/jsonrpc-agent/minimal-fs-code.cordis.yml"
MODE_CORDIS_PAIRS = {
    "fs": (DEFAULT_FS_NATIVE_CORDIS, DEFAULT_FS_CODE_CORDIS),
    "shell": (DEFAULT_SHELL_NATIVE_CORDIS, DEFAULT_SHELL_CODE_CORDIS),
}

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

COUNT_METRIC_FIELDS = (
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
    "max_system_chars",
    "max_tool_schema_json_chars",
    "max_prompt_envelope_chars",
    "max_tool_count",
)
SIGNED_METRIC_FIELDS = (
    "prompt_envelope_growth_chars",
    "max_prompt_envelope_step_growth_chars",
)
METRIC_FIELDS = COUNT_METRIC_FIELDS + SIGNED_METRIC_FIELDS
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


@dataclass(frozen=True, slots=True)
class Task:
    id: str
    workspace: Path
    prompt: str
    prepare: tuple[str, ...] | None = None
    check: tuple[str, ...] | None = None

    @classmethod
    def from_json(cls, value: JsonObject, *, source: str) -> "Task":
        task_id = require_non_empty_string(value, "id", source)
        workspace = Path(require_non_empty_string(value, "workspace", source)).expanduser().resolve()
        prompt = require_non_empty_string(value, "prompt", source)
        return cls(
            id=task_id,
            workspace=workspace,
            prompt=prompt,
            prepare=optional_command(value.get("prepare"), source=f"{source}.prepare"),
            check=optional_command(value.get("check"), source=f"{source}.check"),
        )


def require_non_empty_string(value: Mapping[str, object], key: str, source: str) -> str:
    field = value.get(key)
    if not isinstance(field, str) or not field.strip():
        raise ValueError(f"{source}: {key} must be a non-empty string")
    return field


def optional_command(value: object, *, source: str) -> tuple[str, ...] | None:
    if value is None:
        return None
    if not isinstance(value, list) or not value or not all(isinstance(part, str) and part for part in value):
        raise ValueError(f"{source} must be a non-empty JSON array of non-empty strings")
    return tuple(value)


def load_tasks(path: Path) -> list[Task]:
    tasks: list[Task] = []
    seen: set[str] = set()
    with path.open("r", encoding="utf-8") as handle:
        for line_number, raw in enumerate(handle, 1):
            if not raw.strip():
                continue
            source = f"{path}:{line_number}"
            try:
                value = json.loads(raw)
            except json.JSONDecodeError as exc:
                raise ValueError(f"{source}: invalid JSON: {exc.msg}") from exc
            if not isinstance(value, dict):
                raise ValueError(f"{source}: each JSONL row must be an object")
            task = Task.from_json(value, source=source)
            if task.id in seen:
                raise ValueError(f"{source}: duplicate task id {task.id!r}")
            seen.add(task.id)
            tasks.append(task)
    if not tasks:
        raise ValueError(f"{path}: no benchmark tasks found")
    return tasks


def task_fingerprint(task: Task) -> str:
    payload = {
        "id": task.id,
        "prompt": task.prompt,
        "prepare": list(task.prepare) if task.prepare is not None else None,
        "check": list(task.check) if task.check is not None else None,
    }
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return "sha256:" + hashlib.sha256(encoded).hexdigest()


def compact_json_chars(value: object) -> tuple[str, int]:
    serialized = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    return serialized, len(serialized)


def event_metrics(events: Iterable[JsonObject]) -> JsonObject:
    metrics: JsonObject = {field: 0 for field in METRIC_FIELDS}
    token_targets = {
        "inputTokens": "input_tokens",
        "outputTokens": "output_tokens",
        "cacheReadTokens": "cache_read_tokens",
        "cacheWriteTokens": "cache_write_tokens",
        "reasoningTokens": "reasoning_tokens",
    }
    first_envelope_chars: int | None = None
    previous_envelope_chars: int | None = None
    previous_envelope: tuple[str, str] | None = None
    last_envelope_chars: int | None = None
    for event in events:
        kind = event.get("type")
        if kind == "turn/end":
            metrics["turns"] += 1
        elif kind == "step/end":
            metrics["steps"] += 1
        elif kind == "request/header":
            data = event.get("data")
            header = data.get("header") if isinstance(data, dict) else None
            if not isinstance(header, dict):
                continue
            system = header.get("system")
            system_text = system if isinstance(system, str) else ""
            tools = header.get("tools")
            tool_catalog = tools if isinstance(tools, list) else []
            tools_json, tools_chars = compact_json_chars(tool_catalog)
            envelope_chars = len(system_text) + tools_chars
            metrics["request_headers"] += 1
            metrics["max_system_chars"] = max(metrics["max_system_chars"], len(system_text))
            metrics["max_tool_schema_json_chars"] = max(metrics["max_tool_schema_json_chars"], tools_chars)
            metrics["max_prompt_envelope_chars"] = max(metrics["max_prompt_envelope_chars"], envelope_chars)
            metrics["max_tool_count"] = max(metrics["max_tool_count"], len(tool_catalog))
            envelope = (system_text, tools_json)
            if previous_envelope is not None and envelope != previous_envelope:
                metrics["prompt_envelope_changes"] += 1
            if previous_envelope_chars is not None:
                metrics["max_prompt_envelope_step_growth_chars"] = max(
                    metrics["max_prompt_envelope_step_growth_chars"],
                    envelope_chars - previous_envelope_chars,
                )
            if first_envelope_chars is None:
                first_envelope_chars = envelope_chars
            previous_envelope = envelope
            previous_envelope_chars = envelope_chars
            last_envelope_chars = envelope_chars
        elif kind == "tool/call":
            metrics["tool_calls"] += 1
            data = event.get("data")
            if isinstance(data, dict) and data.get("name") == "run_code":
                metrics["run_code_calls"] += 1
        elif kind == "tool/result":
            data = event.get("data")
            if isinstance(data, dict) and isinstance(data.get("error"), dict):
                metrics["tool_errors"] += 1
        elif kind == "tool/code-dispatch":
            metrics["code_subcalls"] += 1
            data = event.get("data")
            if isinstance(data, dict) and data.get("isError") is True:
                metrics["code_subcall_errors"] += 1
        elif kind == "assistant/message":
            data = event.get("data")
            usage = data.get("usage") if isinstance(data, dict) else None
            if not isinstance(usage, dict):
                continue
            for wire_name, target in token_targets.items():
                count = usage.get(wire_name)
                if isinstance(count, int) and not isinstance(count, bool) and count >= 0:
                    metrics[target] += count
    metrics["leaf_tool_calls"] = metrics["tool_calls"] - metrics["run_code_calls"] + metrics["code_subcalls"]
    metrics["billed_input_tokens"] = (
        metrics["input_tokens"] + metrics["cache_read_tokens"] + metrics["cache_write_tokens"]
    )
    if first_envelope_chars is not None and last_envelope_chars is not None:
        metrics["prompt_envelope_growth_chars"] = last_envelope_chars - first_envelope_chars
    return metrics


def run_command(command: tuple[str, ...], *, cwd: Path, timeout_seconds: float) -> JsonObject:
    started = time.perf_counter()
    try:
        completed = subprocess.run(
            command,
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=timeout_seconds,
            check=False,
        )
        return {
            "exit_code": completed.returncode,
            "seconds": time.perf_counter() - started,
            "stdout_tail": completed.stdout[-4000:],
            "stderr_tail": completed.stderr[-4000:],
            "timed_out": False,
            "spawn_error": None,
        }
    except subprocess.TimeoutExpired as exc:
        return {
            "exit_code": None,
            "seconds": time.perf_counter() - started,
            "stdout_tail": text_tail(exc.stdout),
            "stderr_tail": text_tail(exc.stderr),
            "timed_out": True,
            "spawn_error": None,
        }
    except OSError as exc:
        return {
            "exit_code": None,
            "seconds": time.perf_counter() - started,
            "stdout_tail": "",
            "stderr_tail": "",
            "timed_out": False,
            "spawn_error": {"type": type(exc).__name__, "message": str(exc)},
        }


def text_tail(value: str | bytes | None) -> str:
    if value is None:
        return ""
    text = value.decode(errors="replace") if isinstance(value, bytes) else value
    return text[-4000:]


def slug(value: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9_.-]+", "-", value).strip("-.")
    return cleaned[:80] or "task"


def base_result_row(task: Task, args: argparse.Namespace, repetition: int, variant: str | None) -> JsonObject:
    row: JsonObject = {
        "schema_version": RESULT_SCHEMA_VERSION,
        "kind": RESULT_KIND,
        "task_id": task.id,
        "repetition": repetition,
        "workspace": str(task.workspace),
        "provider": args.provider,
        "model": args.model,
        "scored": task.check is not None,
        "task_fingerprint": task_fingerprint(task),
    }
    if variant is not None:
        row["variant"] = variant
    return row


def failed_result_row(
    task: Task,
    args: argparse.Namespace,
    repetition: int,
    variant: str | None,
    *,
    status: str,
    failure_kind: str,
    prepare: JsonObject | None = None,
    error: JsonObject | None = None,
) -> JsonObject:
    row = base_result_row(task, args, repetition, variant)
    row.update({
        "status": status,
        "outcome": "failed",
        "success": False if task.check is not None else None,
        "failure_kind": failure_kind,
        "prepare": prepare,
    })
    if error is not None:
        row["error"] = error
    return row


def run_one(
    task: Task,
    args: argparse.Namespace,
    repetition: int,
    run_id: str,
    sessions_dir: Path,
    *,
    cordis: Path | None = None,
    variant: str | None = None,
) -> JsonObject:
    if not task.workspace.is_dir():
        raise ValueError(f"task {task.id!r}: workspace does not exist or is not a directory: {task.workspace}")

    prepare = None
    if task.prepare is not None:
        prepare = run_command(task.prepare, cwd=task.workspace, timeout_seconds=args.command_timeout)
        if prepare["exit_code"] != 0:
            if prepare.get("timed_out") is True:
                failure_kind = "prepare-timeout"
            elif prepare.get("spawn_error") is not None:
                failure_kind = "prepare-exec-error"
            else:
                failure_kind = "prepare-nonzero"
            return failed_result_row(
                task,
                args,
                repetition,
                variant,
                status="prepare-failed",
                failure_kind=failure_kind,
                prepare=prepare,
            )

    try:
        from deepseek_harness import DeepSeekHarness
    except ImportError as exc:
        raise RuntimeError(
            "deepseek-harness-sdk is required for `run`; install it with "
            "`python -m pip install deepseek-harness-sdk`"
        ) from exc

    variant_fragment = f"-{slug(variant)}" if variant else ""
    session_id = f"bench-{slug(run_id)}{variant_fragment}-{slug(task.id)}-{repetition}"
    harness_kwargs: JsonObject = {
        "provider": args.provider,
        "model": args.model,
        "cwd": str(task.workspace),
        "session_root": str(sessions_dir),
    }
    if args.max_tokens is not None:
        harness_kwargs["max_tokens"] = args.max_tokens
    selected_cordis = cordis if cordis is not None else args.cordis
    if selected_cordis is not None:
        harness_kwargs["cordis"] = str(selected_cordis.resolve())

    try:
        with DeepSeekHarness(**harness_kwargs) as harness:
            started = time.perf_counter()
            result = harness.run(task.prompt, session_id=session_id)
            agent_seconds = time.perf_counter() - started
    except Exception as exc:
        return failed_result_row(
            task,
            args,
            repetition,
            variant,
            status="agent-failed",
            failure_kind="agent-exception",
            prepare=prepare,
            error={"type": type(exc).__name__, "message": str(exc)},
        )

    check = None
    if task.check is not None:
        check = run_command(task.check, cwd=task.workspace, timeout_seconds=args.command_timeout)
    if task.check is None:
        outcome = "unscored"
        success = None
        failure_kind = None
    elif check is not None and check["exit_code"] == 0:
        outcome = "passed"
        success = True
        failure_kind = None
    else:
        outcome = "failed"
        success = False
        if check is not None and check.get("timed_out") is True:
            failure_kind = "check-timeout"
        elif check is not None and check.get("spawn_error") is not None:
            failure_kind = "check-exec-error"
        else:
            failure_kind = "check-nonzero"

    metrics = event_metrics(result.events)
    row = base_result_row(task, args, repetition, variant)
    row.update({
        "status": "completed",
        "outcome": outcome,
        "success": success,
        "failure_kind": failure_kind,
        "finish_reason": result.finish_reason,
        "agent_seconds": agent_seconds,
        "session_id": result.session_id,
        "session_root": result.session_root,
        "final_response": result.final_response,
        "prepare": prepare,
        "check": check,
        **metrics,
    })
    return row


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


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def write_report(path: Path, comparison: Mapping[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(render_markdown_report(comparison), encoding="utf-8")


def run_task_set(
    tasks: list[Task],
    args: argparse.Namespace,
    *,
    output_path: Path,
    run_id: str,
    sessions_dir: Path,
    cordis: Path | None = None,
    variant: str | None = None,
) -> list[JsonObject]:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    sessions_dir.mkdir(parents=True, exist_ok=True)
    results: list[JsonObject] = []
    with output_path.open("w", encoding="utf-8") as output:
        for repetition in range(1, args.repeat + 1):
            for task in tasks:
                prefix = f"[{variant}] " if variant else ""
                print(f"{prefix}[{task.id} #{repetition}] running", file=sys.stderr, flush=True)
                row = run_one(
                    task,
                    args,
                    repetition,
                    run_id,
                    sessions_dir,
                    cordis=cordis,
                    variant=variant,
                )
                errors = validate_result_row(row, source=f"generated {task.id}#{repetition}")
                if errors:
                    detail = "\n".join(f"- {error}" for error in errors)
                    raise RuntimeError(f"benchmark runner generated an invalid result row:\n{detail}")
                results.append(row)
                output.write(json.dumps(row, ensure_ascii=False) + "\n")
                output.flush()
                outcome = str(row.get("outcome", "unknown")).upper()
                print(f"{prefix}[{task.id} #{repetition}] {outcome}", file=sys.stderr, flush=True)
    return results


def command_run(args: argparse.Namespace) -> int:
    tasks = load_tasks(args.tasks)
    run_id = args.run_id or uuid.uuid4().hex[:12]
    sessions_dir = (args.session_root or args.output.parent / f"{args.output.stem}-sessions").resolve()
    results = run_task_set(
        tasks,
        args,
        output_path=args.output,
        run_id=run_id,
        sessions_dir=sessions_dir,
    )
    print(json.dumps(summarize(results), ensure_ascii=False, indent=2))
    return 0


def command_validate(args: argparse.Namespace) -> int:
    files: list[JsonObject] = []
    for path in args.results:
        rows = load_results(path)
        indexed = validated_index(rows, source=str(path))
        files.append({
            "path": str(path),
            "rows": len(rows),
            "unique_pairs": len(indexed),
            "digest": result_digest([indexed[key] for key in sorted(indexed)]),
        })
    report = {
        "schema_version": VALIDATION_SCHEMA_VERSION,
        "kind": VALIDATION_KIND,
        "files": files,
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


def command_compare(args: argparse.Namespace) -> int:
    comparison = compare_results(
        load_results(args.baseline),
        load_results(args.candidate),
        allow_partial=args.allow_partial,
        baseline_source=str(args.baseline),
        candidate_source=str(args.candidate),
    )
    if args.output is not None:
        write_json(args.output, comparison)
    if args.report is not None:
        write_report(args.report, comparison)
    print(json.dumps(comparison, ensure_ascii=False, indent=2))
    return 0


def command_fixture(args: argparse.Namespace) -> int:
    fixture = create_fixture(
        load_results(args.baseline),
        load_results(args.candidate),
        allow_partial=args.allow_partial,
        baseline_source=str(args.baseline),
        candidate_source=str(args.candidate),
    )
    write_json(args.output, fixture)
    print(json.dumps({
        "fixture": str(args.output),
        "baseline_digest": fixture["baseline_digest"],
        "candidate_digest": fixture["candidate_digest"],
        "paired_runs": fixture["expected_comparison"]["paired_runs"],
    }, ensure_ascii=False, indent=2))
    return 0


def command_replay(args: argparse.Namespace) -> int:
    comparison = replay_fixture(load_json_object(args.fixture), source=str(args.fixture))
    if args.output is not None:
        write_json(args.output, comparison)
    if args.report is not None:
        write_report(args.report, comparison)
    print(json.dumps(comparison, ensure_ascii=False, indent=2))
    return 0


def command_report(args: argparse.Namespace) -> int:
    comparison = load_json_object(args.comparison)
    validate_comparison(comparison, source=str(args.comparison))
    report = render_markdown_report(comparison)
    if args.output is None:
        print(report, end="")
    else:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(report, encoding="utf-8")
    return 0


def command_compare_modes(args: argparse.Namespace) -> int:
    tasks = load_tasks(args.tasks)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    run_id = args.run_id or uuid.uuid4().hex[:12]
    sessions_root = (args.session_root or args.output_dir / "sessions").resolve()
    default_native, default_code = MODE_CORDIS_PAIRS[args.toolset]
    native_cordis = args.native_cordis or default_native
    code_cordis = args.code_cordis or default_code
    native_output = args.output_dir / "native.jsonl"
    code_output = args.output_dir / "code.jsonl"

    native = run_task_set(
        tasks,
        args,
        output_path=native_output,
        run_id=run_id,
        sessions_dir=sessions_root / "native",
        cordis=native_cordis,
        variant="native",
    )
    code = run_task_set(
        tasks,
        args,
        output_path=code_output,
        run_id=run_id,
        sessions_dir=sessions_root / "code",
        cordis=code_cordis,
        variant="code",
    )
    comparison = compare_results(native, code, baseline_source=str(native_output), candidate_source=str(code_output))
    comparison.update({
        "baseline_variant": "native",
        "candidate_variant": "code",
        "toolset": args.toolset,
        "native_cordis": str(native_cordis.resolve()),
        "code_cordis": str(code_cordis.resolve()),
    })
    comparison_path = args.output_dir / "comparison.json"
    report_path = args.output_dir / "report.md"
    write_json(comparison_path, comparison)
    write_report(report_path, comparison)
    print(json.dumps(comparison, ensure_ascii=False, indent=2))
    return 0


def add_harness_options(command: argparse.ArgumentParser) -> None:
    command.add_argument("--provider", default="deepseek-official")
    command.add_argument("--model", default="deepseek-v4-flash")
    command.add_argument("--max-tokens", type=int)
    command.add_argument("--repeat", type=int, default=1)
    command.add_argument("--command-timeout", type=float, default=900.0)
    command.add_argument("--session-root", type=Path)
    command.add_argument("--run-id")


def add_pair_options(command: argparse.ArgumentParser) -> None:
    command.add_argument("baseline", type=Path)
    command.add_argument("candidate", type=Path)
    command.add_argument(
        "--allow-partial",
        action="store_true",
        help="compare only the intersection when one result file is missing paired keys",
    )


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(description="Run, validate, replay, and compare DeepSeek Harness benchmark tasks.")
    commands = root.add_subparsers(dest="command", required=True)

    run = commands.add_parser("run", help="run a JSONL task set and write versioned JSONL results")
    run.add_argument("tasks", type=Path)
    run.add_argument("--output", type=Path, required=True)
    run.add_argument("--cordis", type=Path)
    add_harness_options(run)
    run.set_defaults(handler=command_run)

    validate = commands.add_parser("validate", help="validate result schemas, derived metrics, and duplicate pair keys")
    validate.add_argument("results", type=Path, nargs="+")
    validate.set_defaults(handler=command_validate)

    compare = commands.add_parser("compare", help="strictly compare two JSONL result files on paired task runs")
    add_pair_options(compare)
    compare.add_argument("--output", type=Path, help="write the comparison JSON")
    compare.add_argument("--report", type=Path, help="write a neutral Markdown report")
    compare.set_defaults(handler=command_compare)

    fixture = commands.add_parser(
        "fixture",
        help="capture validated observed result pairs and their expected comparison for offline replay",
    )
    add_pair_options(fixture)
    fixture.add_argument("--output", type=Path, required=True)
    fixture.set_defaults(handler=command_fixture)

    replay = commands.add_parser("replay", help="deterministically replay and verify an observed-result fixture")
    replay.add_argument("fixture", type=Path)
    replay.add_argument("--output", type=Path, help="write the replayed comparison JSON")
    replay.add_argument("--report", type=Path, help="write a neutral Markdown report")
    replay.set_defaults(handler=command_replay)

    report = commands.add_parser("report", help="render a Markdown report from a comparison JSON")
    report.add_argument("comparison", type=Path)
    report.add_argument("--output", type=Path)
    report.set_defaults(handler=command_report)

    modes = commands.add_parser(
        "compare-modes",
        help="run the same tasks under native and Code Mode compositions",
    )
    modes.add_argument("tasks", type=Path)
    modes.add_argument("--output-dir", type=Path, required=True)
    modes.add_argument(
        "--toolset",
        choices=tuple(MODE_CORDIS_PAIRS),
        default="fs",
        help="checked-in native/code composition pair (default: fs)",
    )
    modes.add_argument("--native-cordis", type=Path, help="override the selected toolset's native composition")
    modes.add_argument("--code-cordis", type=Path, help="override the selected toolset's Code Mode composition")
    modes.set_defaults(cordis=None)
    add_harness_options(modes)
    modes.set_defaults(handler=command_compare_modes)
    return root


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    if getattr(args, "repeat", 1) < 1:
        raise SystemExit("--repeat must be >= 1")
    if getattr(args, "max_tokens", None) is not None and args.max_tokens < 1:
        raise SystemExit("--max-tokens must be >= 1")
    if getattr(args, "command_timeout", 1.0) <= 0:
        raise SystemExit("--command-timeout must be > 0")
    try:
        return args.handler(args)
    except (ValueError, RuntimeError, OSError, json.JSONDecodeError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
