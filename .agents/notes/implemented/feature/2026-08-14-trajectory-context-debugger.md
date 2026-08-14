# Agent Note: Request-envelope Context Debugger in Trajectory

Status: implemented

English | [中文](2026-08-14-trajectory-context-debugger.zh.md)

## Problem

Trajectory already reconstructs request timing, token usage, request options, system-prompt changes, tool-schema changes, and the event ledger, but those facts are optimized for inspecting one selected record. It is difficult to answer a different debugging question across a session window: which request prompt envelopes are growing, whether growth came from the system prompt or tool schemas, which tool schema dominates the surface, and whether the provider-reported input moved with that change.

A naive implementation could estimate tokens from character counts or persist another whole-session trace projection. Both would weaken the existing contracts. Character-to-token conversion is provider/tokenizer dependent and does not attribute message history. `sessionProjection` is intended for bounded UI-scale whole values; a growing request timeline would be resent as the value grows and would duplicate request facts already reconstructed by Trajectory.

## Decision

`@deepseek-ai/dsh-client-ui-trajectory` keeps one stable outer `Trajectory` conversation tab and adds an internal browser-only mode switch between the existing event ledger and a Context debugger. The Context mode reads the same bounded `TrajectorySnapshot.requests` request-inspection window already used by the ledger. It adds no persistence event, projection key, service, model-visible text, or second durable state path.

For every loaded assistant request with a reconstructed `ConversationPromptSnapshot`, the debugger reports:

- system-prompt character count,
- model-visible tool count,
- compact JSON character count of the complete tool-schema array,
- largest individual tool schema by compact JSON character count,
- whether the prompt envelope was initial, system-changed, tools-changed, both-changed, or inherited,
- provider-reported request input tokens when usage exists.

Expanding a row exposes the exact reconstructed system string and tool catalog. The character footprint and provider token usage are intentionally displayed as separate measurements. The UI does not convert one into the other and does not claim to attribute message-history tokens.

The outer conversation slot remains `id: 'trajectory'`; Context is an internal segmented mode rather than a second `conversation.view` entry. This preserves existing Chat/Trajectory navigation, slot order, accessibility semantics, and session-scoped injection behavior.

## Alternatives considered

**Add a new growing session projection containing a request timeline.** Rejected because request inspection already reconstructs these facts and `sessionProjection` whole values are designed for bounded UI-scale state, not append-only history. Duplicating the timeline would increase transport cost and create a second source of truth.

**Estimate prompt tokens from system/tool character counts.** Rejected because tokenizer behavior varies by provider/model and because the request's message history is not represented by the system/tool envelope alone. Exact character/JSON footprint is useful evidence; fake token precision is not.

**Add a second top-level Context conversation tab.** Rejected because Context is part of Trajectory debugging, not a separate product surface. A second slot entry would change the established Chat/Trajectory navigation and make existing tab semantics noisier.

**Modify the agent loop or request assembly to emit new debugger events.** Rejected because `request/header`, request inspection, and provider usage already contain the needed facts. Browser tooling should derive from durable state rather than perturb model execution for observability.

## Consequences

Developers can compare prompt-envelope growth across the currently loaded request window without opening every System record individually. Tool-schema bloat becomes visible as both aggregate schema surface and a largest-tool outlier, while provider input usage remains available beside it for correlation.

The debugger is bounded by ordinary Trajectory history loading. Older requests do not appear until that history is loaded, which preserves the existing paging and memory model. Context mode does not independently load older pages.

This feature still does not answer how many provider tokens came from system prompt, tools, user/assistant history, injected context, or compaction summaries. A future attribution feature must use adapter/tokenizer-aware accounting or another exact source; it should not retrofit character heuristics into this view.
