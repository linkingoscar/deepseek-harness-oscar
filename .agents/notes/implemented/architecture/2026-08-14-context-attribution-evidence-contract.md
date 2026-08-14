# Agent Note: Context attribution evidence contract

Status: implemented

English | [中文](2026-08-14-context-attribution-evidence-contract.zh.md)

## Problem

The Harness exposes several kinds of context evidence that look numerically comparable but do not have the same provenance or precision. Trajectory can reconstruct request-envelope structure owned by the Harness; provider adapters can report aggregate usage returned by a provider or SDK; token-meter can estimate component pressure with heuristics. Treating these as interchangeable makes a debugger or benchmark look more precise than the underlying evidence permits.

The dangerous case is attribution. A request can have an exactly reconstructable system string and tool-schema JSON surface while the provider reports only one aggregate input-token number. If both move between requests, correlation does not establish that the surface change caused a particular token delta. Conversation history, provider framing, hidden instructions, cache semantics, serializer behavior, and tokenizer behavior may have changed as well.

The same distinction matters operationally. Token-meter's fixed-density estimate is useful for compaction and relative pressure decisions, but it is not provider tokenization. A provider aggregate is useful for accounting comparisons, but it is not a per-component ledger. Without an explicit contract, downstream UI and benchmark code can silently promote one evidence class into another.

## Decision

Every context/token measurement is classified by the strongest evidence actually available. The Harness uses three evidence classes and never upgrades a value merely because a nearby stronger signal exists.

### Exact reconstructable evidence

A value is **exact reconstructable** when the Harness durably owns the bytes or structured value from which it is computed and the computation introduces no tokenizer/model assumption.

Current examples include:

- `request/header` system-prompt characters;
- compact serialized tool-schema characters and tool count;
- request-to-request changes of those Harness-owned values;
- tool additions/removals and per-tool serialized-schema growth;
- durable request/turn/step/tool lifecycle identities and ordering.

"Exact" is scoped to the Harness-owned representation. It does **not** mean exact provider tokens. The provider boundary may still add chat templates, escaping, normalization, hidden instructions, framing, or other serialization.

### Provider-reported evidence

A value is **provider reported** when it originates in a provider or provider SDK response and may be normalized by an adapter, but the Harness cannot independently reconstruct the provider's component accounting.

Current examples include:

- aggregate input/output usage;
- cache-read/cache-write usage when exposed;
- reasoning usage when exposed;
- request-input deltas derived from adjacent provider totals.

Provider-reported values are authoritative for the documented provider/adapter vocabulary. They do not establish how much of the total belongs to a particular system prompt, tool schema, message, tool result, or provider-owned wrapper.

### Estimated evidence

A value is **estimated** when it depends on a heuristic or approximation not guaranteed to reproduce provider tokenization.

`@deepseek-ai/dsh-token-meter` component pricing is currently in this class. `estimate.ts` uses a fixed four-characters-per-token density plus structural overhead. `contextBreakdown` therefore remains an estimated system/tools/messages decomposition even when aggregate provider usage exists elsewhere in the same session.

Estimated values are valid for relative pressure, local policy, and diagnostics when clearly labelled. They are not billing truth, exact component attribution, or a reconciliation oracle for provider totals.

## Exact component-token attribution gate

A provider/model route may expose **exact component-token attribution** only when one of two proof paths exists:

1. **Provider itemization.** The provider directly reports component-level counts with semantics sufficient to map those counts to Harness components.
2. **Reproducible provider tokenization.** The adapter owns the final provider-visible serialization, owns or pins the exact tokenizer/chat-template behavior for the selected provider/model revision, identifies stable component spans including framing/hidden wrapper costs, and reconciles the reconstructed total to provider-reported request usage under the same cache semantics.

The second path requires all of the following:

- the final provider-visible request representation is observable after all adapter/SDK transforms;
- the model-specific tokenizer and chat-template revision are known, not inferred from a family name;
- provider-added framing or hidden material is either allocated or represented as an explicit `provider_overhead` bucket;
- cache-hit/write accounting uses the same disjoint semantics as the provider report;
- components plus explicit overhead reconcile exactly to provider totals on a representative conformance corpus covering CJK, large JSON schemas, tool calls/results, empty content, reasoning passback, and cache-hit cases;
- any mismatch downgrades the route to provider-reported totals plus estimated components instead of distributing the difference heuristically.

A tokenizer library by itself is insufficient. Tokenizing Harness strings before provider serialization does not prove what the provider counted.

## Current capability matrix

### Direct DeepSeek chat-completions adapter

The direct adapter owns `serializeRequest()` and therefore knows the final JSON request body submitted by Harness. It also maps DeepSeek prompt, cache, completion, and reasoning usage into the Harness `TokenUsage` vocabulary.

The repository does not, however, own the provider's exact model tokenizer/chat-template behavior, and the provider usage is aggregate rather than system/tools/messages itemization. Server-side framing and tokenization remain outside the observable boundary.

**Classification:** exact request surface; provider-reported aggregate tokens; estimated component tokens. The route is not eligible for exact component-token attribution today.

### pi-ai-backed providers

The Harness converts requests into pi-ai's high-level `Context` and calls `Models.streamSimple()`. Provider-specific final serialization occurs in the external pi-ai provider implementation, outside the Harness adapter boundary. pi-ai returns aggregate usage that the Harness normalizes, but not a reconstructable per-component token ledger.

**Classification:** exact Harness/pi-ai context surface; provider/SDK-reported aggregate tokens; estimated component tokens. These routes are not eligible for exact component-token attribution today.

## Product and benchmark invariants

- Context Debugger may display exact character/schema footprint beside provider-reported request input, but the evidence classes remain visually and semantically distinct.
- A request-input delta is never attributed to system/tool-schema delta without component-level evidence.
- Benchmarks may compare exact surface metrics and provider-reported token metrics side by side; surface reduction proves only a smaller Harness-visible envelope.
- `contextBreakdown` remains labelled and treated as estimated wherever it is exposed as component tokens.
- Attribution does not add a second growing whole-session telemetry ledger to `sessionProjection`; bounded request inspection and durable source events remain the read path.
- Field names must not imply billing semantics unless a provider-specific pricing/accounting adapter actually supplies those semantics.

## Alternatives considered

**Proportionally distribute provider input tokens across visible components.** Rejected because the allocation would be mathematically neat but evidentially false. Provider framing, history, caches, hidden material, and tokenizer behavior are not observable enough to justify the split.

**Treat token-meter output as exact whenever the adapter owns the JSON request body.** Rejected because owning pre-provider serialization is not equivalent to owning provider tokenization or chat-template behavior. This would collapse an important boundary precisely where cross-provider differences are largest.

**Expose only provider totals and remove component estimates entirely.** Rejected because estimated component pressure remains operationally useful for compaction, prompt-shape diagnostics, and local policy. The requirement is truthful labelling, not elimination of weaker-but-useful evidence.

**Avoid a formal evidence taxonomy and let each consumer document caveats independently.** Rejected because the risk is cross-surface semantic drift. A shared contract is cheaper than repeatedly auditing every debugger, benchmark, and future optimization policy for accidental overclaiming.

## Consequences

The fork deliberately accepts a temporary capability gap: it can diagnose where Harness-owned context surface grows and observe how provider aggregate usage moves, but it cannot currently state exactly how many provider tokens belong to each component.

That limitation is intentional. It prevents false precision and gives future provider work a concrete upgrade path: add an attribution proof surface at the adapter boundary, build a conformance/reconciliation suite, and promote component evidence only for routes that satisfy the gate.

The contract also constrains future product work. Context tooling must carry provenance, benchmark field names must reflect evidence rather than aspiration, and execution/runtime optimizations must be evaluated against the strongest available evidence without laundering estimates into facts. The result is less flashy than synthetic precision, but substantially more trustworthy as the Harness evolves into an agent runtime and laboratory.
