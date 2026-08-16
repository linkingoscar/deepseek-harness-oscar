from __future__ import annotations

import json
from collections.abc import Iterable

from .schema import JsonObject

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
