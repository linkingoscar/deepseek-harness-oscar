from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping

from .schema import JsonObject


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
