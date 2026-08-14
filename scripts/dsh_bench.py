#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import statistics
import subprocess
import sys
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

JsonObject = dict[str, Any]
REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SHELL_NATIVE_CORDIS = REPO_ROOT / "examples/jsonrpc-agent/minimal.cordis.yml"
DEFAULT_SHELL_CODE_CORDIS = REPO_ROOT / "examples/jsonrpc-agent/minimal-code.cordis.yml"
DEFAULT_FS_NATIVE_CORDIS = REPO_ROOT / "examples/jsonrpc-agent/minimal-fs.cordis.yml"
DEFAULT_FS_CODE_CORDIS = REPO_ROOT / "examples/jsonrpc-agent/minimal-fs-code.cordis.yml"
MODE_CORDIS_PAIRS = {
    "fs": (DEFAULT_FS_NATIVE_CORDIS, DEFAULT_FS_CODE_CORDIS),
    "shell": (DEFAULT_SHELL_NATIVE_CORDIS, DEFAULT_SHELL_CODE_CORDIS),
}


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


def require_non_empty_string(value: JsonObject, key: str, source: str) -> str:
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


def compact_json_chars(value: object) -> tuple[str, int]:
    serialized = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    return serialized, len(serialized)


def event_metrics(events: Iterable[JsonObject]) -> JsonObject:
    metrics: JsonObject = {
        "turns": 0,
        "steps": 0,
        # Model-visible top-level calls. In Code Mode this includes run_code,
        # not the SDK sub-dispatches hidden from model history.
        "tool_calls": 0,
        "tool_errors": 0,
        "run_code_calls": 0,
        "code_subcalls": 0,
        "code_subcall_errors": 0,
        "input_tokens": 0,
        "output_tokens": 0,
        "cache_read_tokens": 0,
        "cache_write_tokens": 0,
        "reasoning_tokens": 0,
        # Exact reconstructable request-envelope surface. These are character
        # counts from durable request/header facts, deliberately not token estimates.
        "request_headers": 0,
        "prompt_envelope_changes": 0,
        "max_system_chars": 0,
        "max_tool_schema_json_chars": 0,
        "max_prompt_envelope_chars": 0,
        "max_tool_count": 0,
        "prompt_envelope_growth_chars": 0,
        "max_prompt_envelope_step_growth_chars": 0,
    }
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
    # Operational leaf calls exclude the run_code transport itself and include
    # the native tools it dispatches. Native mode therefore equals tool_calls.
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
        }
    except subprocess.TimeoutExpired as exc:
        return {
            "exit_code": None,
            "seconds": time.perf_counter() - started,
            "stdout_tail": text_tail(exc.stdout),
            "stderr_tail": text_tail(exc.stderr),
            "timed_out": True,
        }


def text_tail(value: str | bytes | None) -> str:
    if value is None:
        return ""
    text = value.decode(errors="replace") if isinstance(value, bytes) else value
    return text[-4000:]


def slug(value: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9_.-]+", "-", value).strip("-.")
    return cleaned[:80] or "task"


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
            row: JsonObject = {
                "task_id": task.id,
                "repetition": repetition,
                "workspace": str(task.workspace),
                "provider": args.provider,
                "model": args.model,
                "status": "prepare-failed",
                "success": False,
                "scored": task.check is not None,
                "prepare": prepare,
            }
            if variant is not None:
                row["variant"] = variant
            return row

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

    with DeepSeekHarness(**harness_kwargs) as harness:
        started = time.perf_counter()
        result = harness.run(task.prompt, session_id=session_id)
        agent_seconds = time.perf_counter() - started

    check = None
    if task.check is not None:
        check = run_command(task.check, cwd=task.workspace, timeout_seconds=args.command_timeout)
    success = check is not None and check["exit_code"] == 0
    metrics = event_metrics(result.events)
    row = {
        "task_id": task.id,
        "repetition": repetition,
        "workspace": str(task.workspace),
        "provider": args.provider,
        "model": args.model,
        "status": "completed",
        "success": success if task.check is not None else None,
        "scored": task.check is not None,
        "finish_reason": result.finish_reason,
        "agent_seconds": agent_seconds,
        "session_id": result.session_id,
        "session_root": result.session_root,
        "final_response": result.final_response,
        "prepare": prepare,
        "check": check,
        **metrics,
    }
    if variant is not None:
        row["variant"] = variant
    return row


def numeric(values: Iterable[JsonObject], field: str) -> list[float]:
    result: list[float] = []
    for value in values:
        item = value.get(field)
        if isinstance(item, (int, float)) and not isinstance(item, bool):
            result.append(float(item))
    return result


def summarize(results: list[JsonObject]) -> JsonObject:
    scored = [row for row in results if row.get("scored") is True]
    passed = sum(row.get("success") is True for row in scored)
    seconds = numeric(results, "agent_seconds")
    summary: JsonObject = {
        "runs": len(results),
        "scored_runs": len(scored),
        "passed": passed,
        "pass_rate": passed / len(scored) if scored else None,
        "median_agent_seconds": statistics.median(seconds) if seconds else None,
    }
    for field in (
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
    ):
        values = numeric(results, field)
        summary[f"total_{field}"] = int(sum(values)) if values else 0
        summary[f"median_{field}"] = statistics.median(values) if values else None
    for field in (
        "max_system_chars",
        "max_tool_schema_json_chars",
        "max_prompt_envelope_chars",
        "max_tool_count",
        "prompt_envelope_growth_chars",
        "max_prompt_envelope_step_growth_chars",
    ):
        values = numeric(results, field)
        summary[f"median_{field}"] = statistics.median(values) if values else None
    return summary


def load_results(path: Path) -> list[JsonObject]:
    rows: list[JsonObject] = []
    with path.open("r", encoding="utf-8") as handle:
        for line_number, raw in enumerate(handle, 1):
            if not raw.strip():
                continue
            value = json.loads(raw)
            if not isinstance(value, dict):
                raise ValueError(f"{path}:{line_number}: result row must be an object")
            rows.append(value)
    return rows


def result_key(row: JsonObject) -> tuple[str, int] | None:
    task_id = row.get("task_id")
    repetition = row.get("repetition")
    if isinstance(task_id, str) and isinstance(repetition, int) and not isinstance(repetition, bool):
        return task_id, repetition
    return None


def compare_results(baseline: list[JsonObject], candidate: list[JsonObject]) -> JsonObject:
    base_by_key = {key: row for row in baseline if (key := result_key(row)) is not None}
    candidate_by_key = {key: row for row in candidate if (key := result_key(row)) is not None}
    common = sorted(base_by_key.keys() & candidate_by_key.keys())
    regressions: list[str] = []
    improvements: list[str] = []
    for key in common:
        before = base_by_key[key].get("success")
        after = candidate_by_key[key].get("success")
        label = f"{key[0]}#{key[1]}"
        if before is True and after is False:
            regressions.append(label)
        elif before is False and after is True:
            improvements.append(label)

    base_summary = summarize([base_by_key[key] for key in common])
    candidate_summary = summarize([candidate_by_key[key] for key in common])
    delta: JsonObject = {}
    for field in (
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
    ):
        before = base_summary.get(field)
        after = candidate_summary.get(field)
        if isinstance(before, (int, float)) and isinstance(after, (int, float)):
            delta[field] = after - before
        else:
            delta[field] = None
    return {
        "paired_runs": len(common),
        "baseline": base_summary,
        "candidate": candidate_summary,
        "delta_candidate_minus_baseline": delta,
        "regressions": regressions,
        "improvements": improvements,
    }


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
                results.append(row)
                output.write(json.dumps(row, ensure_ascii=False) + "\n")
                output.flush()
                state = "PASS" if row.get("success") is True else "FAIL" if row.get("success") is False else "UNSCORED"
                print(f"{prefix}[{task.id} #{repetition}] {state}", file=sys.stderr, flush=True)
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


def command_compare(args: argparse.Namespace) -> int:
    comparison = compare_results(load_results(args.baseline), load_results(args.candidate))
    print(json.dumps(comparison, ensure_ascii=False, indent=2))
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
    comparison = compare_results(native, code)
    comparison.update({
        "baseline_variant": "native",
        "candidate_variant": "code",
        "toolset": args.toolset,
        "native_cordis": str(native_cordis.resolve()),
        "code_cordis": str(code_cordis.resolve()),
    })
    comparison_path = args.output_dir / "comparison.json"
    comparison_path.write_text(json.dumps(comparison, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
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


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(description="Run and compare DeepSeek Harness benchmark tasks.")
    commands = root.add_subparsers(dest="command", required=True)

    run = commands.add_parser("run", help="run a JSONL task set and write JSONL results")
    run.add_argument("tasks", type=Path)
    run.add_argument("--output", type=Path, required=True)
    run.add_argument("--cordis", type=Path)
    add_harness_options(run)
    run.set_defaults(handler=command_run)

    compare = commands.add_parser("compare", help="compare two JSONL result files on paired task runs")
    compare.add_argument("baseline", type=Path)
    compare.add_argument("candidate", type=Path)
    compare.set_defaults(handler=command_compare)

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
    # Kept for run_one's common selection path; compare-modes always supplies
    # an explicit per-variant composition.
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
