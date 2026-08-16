from __future__ import annotations

import argparse
import json
import sys
import uuid
from pathlib import Path

from .comparison import compare_results, summarize
from .fixtures import create_fixture, load_json_object, result_digest
from .replay import replay_fixture
from .reporting import render_markdown_report, validate_comparison, write_report
from .runner import run_task_set
from .schema import VALIDATION_KIND, VALIDATION_SCHEMA_VERSION, JsonObject
from .tasks import load_tasks
from .validation import load_results, validated_index

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SHELL_NATIVE_CORDIS = REPO_ROOT / "examples/jsonrpc-agent/minimal.cordis.yml"
DEFAULT_SHELL_CODE_CORDIS = REPO_ROOT / "examples/jsonrpc-agent/minimal-code.cordis.yml"
DEFAULT_FS_NATIVE_CORDIS = REPO_ROOT / "examples/jsonrpc-agent/minimal-fs.cordis.yml"
DEFAULT_FS_CODE_CORDIS = REPO_ROOT / "examples/jsonrpc-agent/minimal-fs-code.cordis.yml"
MODE_CORDIS_PAIRS = {
    "fs": (DEFAULT_FS_NATIVE_CORDIS, DEFAULT_FS_CODE_CORDIS),
    "shell": (DEFAULT_SHELL_NATIVE_CORDIS, DEFAULT_SHELL_CODE_CORDIS),
}


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


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
    root = argparse.ArgumentParser(
        prog="dsh_bench.py",
        description="Run, validate, replay, and compare DeepSeek Harness benchmark tasks.",
    )
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
