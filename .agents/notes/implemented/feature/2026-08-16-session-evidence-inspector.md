# Agent Note: Session Evidence Inspector

Status: implemented

English | [中文](2026-08-16-session-evidence-inspector.zh.md)

## Problem

Execution accounting, Code Mode diagnostics, and replay inspection already derive the durable facts needed to explain a session, but developer tooling has to invoke and interpret those projections separately. Repeating that composition at each consumer risks drifting byte handling, replay availability wording, or concurrency scope even though the underlying evidence is already authoritative.

The missing capability is a single read-side view over one selected event-log prefix. It must improve discoverability without creating another evidence source or turning convenient presentation fields into stronger runtime claims.

## Decision

`@deepseek-ai/dsh-session-query/evidence-inspector` exports `readSessionEvidence(sessionId, events, options?)`. The function accepts an already obtained ordered session event log and selects the same inclusive boundary for all derived output.

The `execution` section is exactly the existing `summarizeCodeRunExecutionAccounting(deriveCodeRunExecutionAccounting(prefix))` result. It therefore preserves started, settled, failed, delivery-rejected, measured and unmeasured delivery bytes, `maxRunPeakInFlight`, unsettled starts, orphan settles, incomplete-run counts, and per-tool summaries without redefining any metric.

The `replay` section delegates capability decisions to `inspectReplayCapabilities`. It exposes the latest reconstructable request header, the existing request-reconstruction, simulated, live-fork, and reproducible capability records, and boolean presence projections for the validated reproducibility-evidence record and its two snapshot references. A malformed latest evidence replacement continues to fail closed because selection remains owned by replay inspection.

The `session` section records the supplied session id, selected boundary, selected event count, source kind, and the existing `stableForkBoundary` result. Direct event-log inspection defaults `sourceKind` to `supplied-log`; callers that already know the observation came from a live or persisted source may pass that fact explicitly. The inspector does not infer storage provenance from events because the event stream does not contain that proof.

The projection has no version field and no persistence representation. It appends no session event, defines no diagnostics metric, replay blocker, replay mode, or reproducibility evidence field, and performs no model or tool execution.

## Evidence boundaries

`maxRunPeakInFlight` remains the maximum of run-local peaks. The inspector does not rename or reinterpret it as session-wide or global peak concurrency because the run summaries do not retain sufficient cross-run ordering evidence.

Measured delivered-value bytes preserve the existing diagnostics overflow rule: when exact safe-integer subtotals cannot be represented as one JavaScript safe integer, `deliveredValueBytes` is `null`. Aggregation overflow does not increment `unmeasuredDeliveredValues`, which remains reserved for upstream outcomes whose byte evidence is absent or unrepresentable at the run-accounting stage.

Snapshot-reference presence is derived only from the validated evidence record selected for the latest reconstructable request. Identity fingerprints do not count as snapshots, and the inspector does not remove or add reproducibility blockers itself.

## Alternatives considered

**Create a new inspector event or persisted projection.** Rejected because execution and replay facts already have durable owners. A second stored representation would introduce synchronization and migration obligations without adding evidence.

**Reimplement execution and replay folds inside `session-query`.** Rejected because duplicated derivation would create a second semantics owner and could drift from delivery-byte, incomplete-evidence, or replay fail-closed behavior.

**Expose a `globalPeakConcurrency` convenience field.** Rejected because no existing durable summary proves cross-run overlap. Keeping `maxRunPeakInFlight` preserves the exact scope justified by current evidence.

**Treat fingerprints or older valid replay evidence as fallback proof.** Rejected because replay already distinguishes identity from restorable snapshots and intentionally fails closed when the latest matching evidence is malformed. The inspector inherits that decision rather than weakening it.

## Consequences

Developer tooling can consume one deterministic object for session selection, Code Mode execution diagnostics, and replay readiness while retaining the existing semantic owners. Deterministic fixtures cover empty logs, reconstructable requests, normal and failed Code Mode dispatches, delivery rejection, unmeasured bytes, unsettled and orphan dispatches, aggregate byte overflow, replay evidence presence and absence, malformed latest evidence, and prefix selection without any real model call.

The direct API requires the caller to provide the event log and cannot prove whether that log originated from a live or persisted session. That limitation is explicit in `sourceKind`; integrating source resolution into `SessionQueryEngine` can pass an already known source fact later without changing the inspector's evidence semantics.
