from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import time
from pathlib import Path

from .metrics import event_metrics
from .schema import RESULT_KIND, RESULT_SCHEMA_VERSION, JsonObject
from .tasks import Task, task_fingerprint
from .validation import validate_result_row


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
