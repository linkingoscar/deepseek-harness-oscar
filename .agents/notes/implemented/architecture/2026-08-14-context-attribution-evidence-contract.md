# Agent Note: Context attribution evidence contract

Status: implemented

English | [中文](2026-08-14-context-attribution-evidence-contract.zh.md)

## Problem

The Harness now exposes three different kinds of context evidence: reconstructable request-envelope structure in Trajectory, provider-reported aggregate usage, and heuristic component token estimates in token-meter. They answer different questions and must not be presented as if they have the same precision.

In particular, a request can show an exact system string and exact tool-schema JSON surface while the provider reports only one aggregate input-token total. A correlation between those movements is not component attribution. Likewise, token-meter's fixed-density estimate is useful for pressure and compaction decisions but is not provider tokenization.

Without an explicit evidence contract, a debugger or benchmark can accidentally relabel an estimate as an exact token count, infer causality from adjacent totals, or compare providers whose accounting semantics differ.

## Decision

Every context/token measurement belongs to one of three evidence classes.

### 1. Exact reconstructable evidence

A value is **exact reconstructable** when the Harness itself durably owns the bytes or structured value from which it is computed and the computation introduces no tokenizer/model assumption.

Current examples:

- `request/header` system-prompt characters;
- compact serialized tool-schema characters and tool count;
- request-to-request changes of those values;
- tool additions/removals and per-tool serialized-schema growth;
- durable request/turn/step/tool lifecycle identities and ordering.

"Exact" here means exact with respect to the Harness-owned representation. It does **not** mean exact provider tokens. A provider may apply a chat template, escaping, normalization, hidden instructions, or another serialization after the Harness boundary.

### 2. Provider-reported evidence

A value is **provider reported** when it comes from the provider response (possibly normalized by an adapter) but the Harness cannot independently reconstruct its component accounting.

Current examples:

- aggregate input/output usage;
- cache-read/cache-write usage where the provider exposes it;
- reasoning usage where the provider exposes it;
- request-input deltas derived from adjacent provider totals.

Provider-reported totals are authoritative for the provider's own billing/accounting vocabulary, subject to the adapter's documented normalization. They are not evidence that any particular system prompt, tool schema, message, or tool result consumed a specific subset of those tokens.

### 3. Estimated evidence

A value is **estimated** when it depends on a heuristic or an approximation that is not guaranteed to reproduce provider tokenization.

`@deepseek-ai/dsh-token-meter` component pricing is currently in this class. `estimate.ts` uses a fixed 4 characters/token density plus structural overhead. `contextBreakdown` therefore remains an estimated system/tools/messages decomposition even when provider aggregate usage exists elsewhere in the same session.

Estimated values may be used for relative pressure, local policy, and diagnostics when clearly labelled. They must not be used as billing truth, exact component attribution, or as a reconciliation oracle for provider totals.

## Exact component-token attribution gate

A provider/model route may expose **exact component-token attribution** only when one of these two proof paths exists:

1. **Provider itemization:** the provider directly reports component-level token counts with semantics sufficient to map the counts to Harness components; or
2. **Reproducible provider tokenization:** the adapter owns the final provider-visible serialization, owns or pins the exact tokenizer/chat-template behavior for the selected provider/model revision, can identify stable component spans including framing/hidden wrapper costs, and can reconcile the reconstructed total to the provider-reported request usage under the same cache semantics.

The second path must satisfy all of the following:

- final provider-visible request representation is observable after all adapter/SDK transforms;
- model-specific tokenizer and chat-template revision are known, not guessed from a family name;
- provider-added framing or hidden prompt material is either known and allocated or represented as an explicit `provider_overhead` bucket;
- cache-hit/write accounting uses the same disjoint semantics as the provider report;
- component counts plus explicit overhead reconcile exactly to the provider total for a representative conformance corpus, including CJK, large JSON schemas, tool calls/results, empty content, reasoning passback, and cache-hit cases;
- a mismatch downgrades the route to provider-reported totals plus estimated components. It must never be silently distributed across components.

A tokenizer library by itself is insufficient. Tokenizing Harness strings before provider serialization does not prove what the provider counted.

## Current capability matrix

### Direct DeepSeek chat-completions adapter

The direct adapter owns `serializeRequest()` and therefore knows the final JSON request body submitted by Harness. It also maps DeepSeek `prompt_tokens`, cache-hit fields, completion tokens, and reasoning tokens into the Harness disjoint `TokenUsage` vocabulary.

However, the repository does not own the provider's exact model tokenizer/chat-template behavior, and DeepSeek usage is aggregate rather than system/tools/messages itemization. Server-side framing and tokenization therefore remain outside the observable boundary.

**Classification:** exact request surface; provider-reported aggregate tokens; estimated component tokens. Not eligible for exact component-token attribution today.

### pi-ai-backed providers

The Harness converts requests into pi-ai's high-level `Context` and calls `Models.streamSimple()`. Provider-specific final serialization occurs inside the external pi-ai provider implementation, outside the Harness adapter boundary. pi-ai returns aggregate input/output/cache usage, which the Harness normalizes, but not a reconstructable per-component token ledger.

**Classification:** exact Harness/pi-ai context surface; provider/SDK-reported aggregate tokens; estimated component tokens. Not eligible for exact component-token attribution today.

## Product and benchmark rules

- Context Debugger may display exact character/schema footprint beside provider-reported request input, but the UI must keep their evidence classes visually and semantically separate.
- A request-input delta must never be attributed to a system/tool-schema delta without component-level evidence; conversation history, provider framing, caching, and tokenizer behavior may also have changed.
- Benchmarks may compare exact surface metrics and provider-reported token metrics side by side. A surface reduction is evidence of a smaller Harness-visible envelope, not proof of an equal token reduction.
- `contextBreakdown` values must be labelled/treated as estimates anywhere they are exposed as component tokens.
- No growing whole-session attribution timeline should be added to `sessionProjection`; bounded request inspection and durable source events remain the preferred read path.

## Consequences

The fork deliberately accepts a temporary gap: it can diagnose where Harness-owned context surface grows and how provider aggregate input moves, but it cannot yet say exactly how many provider tokens belong to each component.

That gap is preferable to false precision. Future provider work should first add an attribution proof surface at the adapter boundary and a conformance/reconciliation suite. Only routes that pass the gate above may upgrade component labels from estimated to exact.

Until then, optimization policy should use the strongest evidence available for each decision: exact surface/provenance for structural diagnosis, provider totals for cost/usage comparisons, and token-meter estimates for approximate pressure or compaction policy.