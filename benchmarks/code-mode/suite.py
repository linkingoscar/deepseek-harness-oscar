#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import shutil
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

JsonObject = dict[str, Any]
SCRIPT_PATH = Path(__file__).resolve()


@dataclass(frozen=True, slots=True)
class Case:
    id: str
    prompt: str
    files: dict[str, str]
    expected_text: dict[str, str] = field(default_factory=dict)
    expected_json: dict[str, object] = field(default_factory=dict)

    def final_text(self) -> dict[str, str]:
        values = dict(self.files)
        values.update(self.expected_text)
        return values


def service_file(name: str, region: str, tier: str, replicas: int, enabled: bool) -> str:
    return (
        f"name={name}\n"
        f"region={region}\n"
        f"tier={tier}\n"
        f"replicas={replicas}\n"
        f"enabled={'true' if enabled else 'false'}\n"
    )


def ts_file(name: str, owner: str, timeout_ms: int, *, critical: bool) -> str:
    marker = "// @critical\n" if critical else "// routine\n"
    return (
        f"{marker}"
        f"export const service = {json.dumps(name)}\n"
        f"export const owner = {json.dumps(owner)}\n"
        f"export const timeoutMs = {timeout_ms}\n"
    )


def component_file(name: str, channel: str, risk: str, retries: int) -> str:
    return f"name={name}\nchannel={channel}\nrisk={risk}\nretries={retries}\n"


def module_file(name: str, owner: str, deps: list[str]) -> str:
    return json.dumps({"name": name, "owner": owner, "deps": deps}, indent=2, sort_keys=True) + "\n"


CASES: tuple[Case, ...] = (
    Case(
        id="aggregate-services",
        prompt=(
            "Inspect every services/*/service.conf file. Consider only services with enabled=true. "
            "Write report.json containing exactly three fields: enabled_services (sorted service names), "
            "replicas_by_region (sum of replicas for enabled services, keyed by region), and "
            "total_enabled_replicas. Derive the answer from the files; do not guess."
        ),
        files={
            "services/alpha/service.conf": service_file("alpha", "us-east", "gold", 3, True),
            "services/bravo/service.conf": service_file("bravo", "eu-west", "silver", 2, True),
            "services/charlie/service.conf": service_file("charlie", "us-east", "bronze", 1, False),
            "services/delta/service.conf": service_file("delta", "ap-south", "gold", 4, True),
            "services/echo/service.conf": service_file("echo", "eu-west", "gold", 5, True),
            "services/foxtrot/service.conf": service_file("foxtrot", "us-east", "silver", 2, True),
            "services/golf/service.conf": service_file("golf", "ap-south", "bronze", 1, False),
            "services/hotel/service.conf": service_file("hotel", "eu-west", "silver", 3, True),
            "services/india/service.conf": service_file("india", "us-east", "gold", 4, True),
            "services/juliet/service.conf": service_file("juliet", "ap-south", "silver", 2, True),
        },
        expected_json={
            "report.json": {
                "enabled_services": ["alpha", "bravo", "delta", "echo", "foxtrot", "hotel", "india", "juliet"],
                "replicas_by_region": {"ap-south": 6, "eu-west": 10, "us-east": 9},
                "total_enabled_replicas": 25,
            }
        },
    ),
    Case(
        id="critical-timeouts",
        prompt=(
            "Find every TypeScript file under src/ marked with // @critical. Read those files to obtain "
            "their owner and timeoutMs values. Write audit.json with critical_files (sorted relative paths), "
            "timeout_ms_by_owner (sum per owner), and max_timeout_file (the relative path with the largest timeout). "
            "Ignore routine files."
        ),
        files={
            "src/auth.ts": ts_file("auth", "identity", 1200, critical=True),
            "src/billing.ts": ts_file("billing", "money", 2500, critical=True),
            "src/cache.ts": ts_file("cache", "platform", 800, critical=False),
            "src/checkout.ts": ts_file("checkout", "money", 1800, critical=True),
            "src/gateway.ts": ts_file("gateway", "edge", 900, critical=True),
            "src/images.ts": ts_file("images", "media", 1600, critical=False),
            "src/ledger.ts": ts_file("ledger", "money", 3200, critical=True),
            "src/mail.ts": ts_file("mail", "comms", 1100, critical=False),
            "src/profile.ts": ts_file("profile", "identity", 1400, critical=True),
            "src/search.ts": ts_file("search", "discovery", 2100, critical=True),
            "src/webhook.ts": ts_file("webhook", "edge", 1700, critical=True),
            "src/worker.ts": ts_file("worker", "platform", 2800, critical=False),
        },
        expected_json={
            "audit.json": {
                "critical_files": [
                    "src/auth.ts",
                    "src/billing.ts",
                    "src/checkout.ts",
                    "src/gateway.ts",
                    "src/ledger.ts",
                    "src/profile.ts",
                    "src/search.ts",
                    "src/webhook.ts",
                ],
                "max_timeout_file": "src/ledger.ts",
                "timeout_ms_by_owner": {"discovery": 2100, "edge": 2600, "identity": 2600, "money": 7500},
            }
        },
    ),
    Case(
        id="beta-retry-migration",
        prompt=(
            "Inspect every components/*.conf file. For components where channel=beta AND risk=high, change only "
            "the retries value to 5. Leave every other byte of every component file unchanged. Write changed.json "
            "as a JSON array of the relative paths you changed, sorted lexicographically."
        ),
        files={
            "components/api.conf": component_file("api", "beta", "high", 2),
            "components/billing.conf": component_file("billing", "stable", "high", 2),
            "components/catalog.conf": component_file("catalog", "beta", "low", 2),
            "components/ingest.conf": component_file("ingest", "beta", "high", 1),
            "components/notify.conf": component_file("notify", "beta", "medium", 3),
            "components/search.conf": component_file("search", "beta", "high", 4),
            "components/web.conf": component_file("web", "beta", "low", 2),
            "components/worker.conf": component_file("worker", "stable", "low", 1),
        },
        expected_text={
            "components/api.conf": component_file("api", "beta", "high", 5),
            "components/ingest.conf": component_file("ingest", "beta", "high", 5),
            "components/search.conf": component_file("search", "beta", "high", 5),
        },
        expected_json={
            "changed.json": [
                "components/api.conf",
                "components/ingest.conf",
                "components/search.conf",
            ]
        },
    ),
    Case(
        id="dependency-closure",
        prompt=(
            "Read roots.json, then follow deps through modules/*.json to compute the transitive dependency closure "
            "including the roots themselves. Do not include unrelated modules. Write closure.json with modules "
            "(sorted module names) and owner_counts (number of modules in the closure per owner)."
        ),
        files={
            "roots.json": json.dumps({"roots": ["api", "worker"]}, indent=2) + "\n",
            "modules/api.json": module_file("api", "edge", ["auth", "catalog"]),
            "modules/auth.json": module_file("auth", "identity", ["crypto", "profile"]),
            "modules/billing.json": module_file("billing", "money", ["ledger", "profile"]),
            "modules/catalog.json": module_file("catalog", "commerce", ["search"]),
            "modules/crypto.json": module_file("crypto", "security", []),
            "modules/ledger.json": module_file("ledger", "money", ["storage"]),
            "modules/mail.json": module_file("mail", "comms", []),
            "modules/metrics.json": module_file("metrics", "observability", ["storage"]),
            "modules/profile.json": module_file("profile", "identity", ["storage"]),
            "modules/queue.json": module_file("queue", "platform", ["storage"]),
            "modules/search.json": module_file("search", "discovery", ["storage"]),
            "modules/storage.json": module_file("storage", "platform", []),
            "modules/worker.json": module_file("worker", "platform", ["queue", "billing"]),
        },
        expected_json={
            "closure.json": {
                "modules": [
                    "api",
                    "auth",
                    "billing",
                    "catalog",
                    "crypto",
                    "ledger",
                    "profile",
                    "queue",
                    "search",
                    "storage",
                    "worker",
                ],
                "owner_counts": {
                    "commerce": 1,
                    "discovery": 1,
                    "edge": 1,
                    "identity": 2,
                    "money": 2,
                    "platform": 3,
                    "security": 1,
                },
            }
        },
    ),
)

CASE_BY_ID = {case.id: case for case in CASES}


def require_case(case_id: str) -> Case:
    try:
        return CASE_BY_ID[case_id]
    except KeyError as exc:
        known = ", ".join(sorted(CASE_BY_ID))
        raise ValueError(f"unknown case {case_id!r}; expected one of: {known}") from exc


def reset_case(case: Case, workspace: Path) -> None:
    workspace = workspace.resolve()
    if workspace.exists():
        shutil.rmtree(workspace)
    workspace.mkdir(parents=True)
    for relative, content in case.files.items():
        target = workspace / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")


def check_case(case: Case, workspace: Path) -> list[str]:
    workspace = workspace.resolve()
    errors: list[str] = []
    expected_text = case.final_text()
    expected_paths = set(expected_text) | set(case.expected_json)
    actual_paths = {
        path.relative_to(workspace).as_posix()
        for path in workspace.rglob("*")
        if path.is_file()
    }
    for unexpected in sorted(actual_paths - expected_paths):
        errors.append(f"unexpected file: {unexpected}")
    for missing in sorted(expected_paths - actual_paths):
        errors.append(f"missing file: {missing}")

    for relative, expected in expected_text.items():
        target = workspace / relative
        if not target.is_file():
            continue
        actual = target.read_text(encoding="utf-8")
        if actual != expected:
            errors.append(f"content mismatch: {relative}")

    for relative, expected in case.expected_json.items():
        target = workspace / relative
        if not target.is_file():
            continue
        try:
            actual = json.loads(target.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            errors.append(f"invalid JSON in {relative}: {exc}")
            continue
        if actual != expected:
            errors.append(
                f"JSON mismatch in {relative}: expected {json.dumps(expected, sort_keys=True)}, "
                f"got {json.dumps(actual, sort_keys=True)}"
            )
    return errors


def materialize(output: Path, work_root: Path) -> None:
    output = output.resolve()
    work_root = work_root.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    work_root.mkdir(parents=True, exist_ok=True)
    rows: list[JsonObject] = []
    for case in CASES:
        workspace = work_root / case.id
        reset_case(case, workspace)
        rows.append({
            "id": case.id,
            "workspace": str(workspace),
            "prompt": case.prompt,
            "prepare": [sys.executable, str(SCRIPT_PATH), "reset", case.id, str(workspace)],
            "check": [sys.executable, str(SCRIPT_PATH), "check", case.id, str(workspace)],
        })
    with output.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(description="Materialize and verify the Code Mode micro-eval suite.")
    commands = root.add_subparsers(dest="command", required=True)

    make = commands.add_parser("materialize", help="create clean workspaces and emit benchmark JSONL")
    make.add_argument("--output", type=Path, required=True)
    make.add_argument("--work-root", type=Path, required=True)

    reset = commands.add_parser("reset", help="restore one suite workspace")
    reset.add_argument("case", choices=tuple(CASE_BY_ID))
    reset.add_argument("workspace", type=Path)

    check = commands.add_parser("check", help="verify one suite workspace")
    check.add_argument("case", choices=tuple(CASE_BY_ID))
    check.add_argument("workspace", type=Path)
    return root


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    try:
        if args.command == "materialize":
            materialize(args.output, args.work_root)
            return 0
        case = require_case(args.case)
        if args.command == "reset":
            reset_case(case, args.workspace)
            return 0
        errors = check_case(case, args.workspace)
        if errors:
            for error in errors:
                print(error, file=sys.stderr)
            return 1
        return 0
    except (OSError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
