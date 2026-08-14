#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
import uuid
from pathlib import Path

import dsh_bench as bench
from dsh_bench_plan import build_counterbalanced_mode_plan


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(
        description="Run paired native/Code Mode benchmark observations in a counterbalanced order."
    )
    root.add_argument("tasks", type=Path)
    root.add_argument("--output-dir", type=Path, required=True)
    root.add_argument("--toolset", choices=tuple(bench.MODE_CORDIS_PAIRS), default="fs")
    root.add_argument("--native-cordis", type=Path)
    root.add_argument("--code-cordis", type=Path)
    root.add_argument("--provider", default="deepseek-official")
    root.add_argument("--model", default="deepseek-v4-flash")
    root.add_argument("--max-tokens", type=int)
    root.add_argument("--repeat", type=int, default=1)
    root.add_argument("--command-timeout", type=float, default=900.0)
    root.add_argument("--session-root", type=Path)
    root.add_argument("--run-id")
    root.set_defaults(cordis=None)
    return root


def validate(args: argparse.Namespace) -> None:
    if args.repeat < 1:
        raise ValueError("--repeat must be >= 1")
    if args.max_tokens is not None and args.max_tokens < 1:
        raise ValueError("--max-tokens must be >= 1")
    if args.command_timeout <= 0:
        raise ValueError("--command-timeout must be > 0")


def run(args: argparse.Namespace) -> int:
    validate(args)
    tasks = bench.load_tasks(args.tasks)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    run_id = args.run_id or uuid.uuid4().hex[:12]
    sessions_root = (args.session_root or args.output_dir / "sessions").resolve()
    sessions_root.mkdir(parents=True, exist_ok=True)

    default_native, default_code = bench.MODE_CORDIS_PAIRS[args.toolset]
    cordis_by_variant = {
        "native": args.native_cordis or default_native,
        "code": args.code_cordis or default_code,
    }
    output_paths = {
        "native": args.output_dir / "native.jsonl",
        "code": args.output_dir / "code.jsonl",
    }
    results: dict[str, list[bench.JsonObject]] = {"native": [], "code": []}

    handles = {
        variant: path.open("w", encoding="utf-8")
        for variant, path in output_paths.items()
    }
    try:
        for scheduled in build_counterbalanced_mode_plan(tasks, args.repeat):
            task = scheduled.task
            variant = scheduled.variant
            prefix = f"[{variant}] [{task.id} #{scheduled.repetition}]"
            print(f"{prefix} running", file=sys.stderr, flush=True)
            row = bench.run_one(
                task,
                args,
                scheduled.repetition,
                run_id,
                sessions_root / variant,
                cordis=cordis_by_variant[variant],
                variant=variant,
            )
            results[variant].append(row)
            handles[variant].write(json.dumps(row, ensure_ascii=False) + "\n")
            handles[variant].flush()
            state = "PASS" if row.get("success") is True else "FAIL" if row.get("success") is False else "UNSCORED"
            print(f"{prefix} {state}", file=sys.stderr, flush=True)
    finally:
        for handle in handles.values():
            handle.close()

    comparison = bench.compare_results(results["native"], results["code"])
    comparison.update(
        {
            "baseline_variant": "native",
            "candidate_variant": "code",
            "toolset": args.toolset,
            "run_order": "counterbalanced-paired",
            "native_cordis": str(cordis_by_variant["native"].resolve()),
            "code_cordis": str(cordis_by_variant["code"].resolve()),
        }
    )
    comparison_path = args.output_dir / "comparison.json"
    comparison_path.write_text(json.dumps(comparison, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(comparison, ensure_ascii=False, indent=2))
    return 0


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    try:
        return run(args)
    except (ValueError, RuntimeError, OSError, json.JSONDecodeError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
