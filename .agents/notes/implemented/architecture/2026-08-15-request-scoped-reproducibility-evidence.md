# Agent Note: Request-scoped reproducibility evidence

Status: implemented

English | [中文](2026-08-15-request-scoped-reproducibility-evidence.zh.md)

## Problem

Replay already distinguishes transcript inspection, request reconstruction, effect-free simulation, live fork, and reproducible execution. The reproducible mode correctly stayed unavailable because the durable log did not prove that the execution environment or external state had been snapshotted, and no reproducible executor exists.

A future implementation needs durable evidence that can answer two different questions without conflating them: whether an input identity matches a historical run, and whether the historical state can actually be restored. A hash of a runtime, configuration, tool schema set, or plugin graph is useful comparison evidence, but it is not a snapshot. Treating identity as restorable state would allow replay capability reporting to overclaim reproducibility.

## Decision

The session replay vocabulary includes a required, log-only `replay/reproducibility-evidence` event scoped to one exact historical `request/header` sequence.

The version-1 payload records:

- `requestHeaderSeq`, binding the evidence to one reconstructable request-header epoch rather than to a whole session;
- optional identity digests for runtime, effective configuration, model-visible tool schemas, and the composed plugin graph;
- an optional execution-environment snapshot reference;
- an optional external-state snapshot reference.

Digests are SHA-256 lowercase hexadecimal values. Snapshot references also carry a non-empty format and opaque locator so a future reproducible executor can resolve bytes and verify their digest.

Identity digests never satisfy snapshot blockers. A validated `executionEnvironmentSnapshot` may remove only `EXECUTION_ENVIRONMENT_NOT_SNAPSHOTTED`; a validated `externalStateSnapshot` may remove only `EXTERNAL_STATE_NOT_SNAPSHOTTED`. `REPRODUCIBLE_EXECUTOR_NOT_IMPLEMENTED` remains, so the `reproducible` mode remains unavailable in this phase.

## Runtime capture seam

The agent loop exposes the synchronous `agent/request-reproducibility-evidence` notification at the request-header boundary. The loop emits it only after the canonical `request/header` event has been durably appended and before provider dispatch. The payload carries the exact committed header sequence and the frozen header snapshot stored at that sequence.

Listeners receive a narrow write-only evidence sink and may contribute only evidence already available synchronously at that boundary. The loop does not await listener promises. Listener failures, invalid contributions, collector failures, and evidence-log append failures are diagnostic failures only: none may veto or mutate the model request.

Contributions made during one boundary are combined into one atomic durable payload. Identical values coalesce. Disjoint fields compose. If valid contributors disagree about the same identity or snapshot field, that field fails closed and is omitted permanently for that capture; later listener order cannot restore it. If no unambiguous evidence remains, no evidence event is appended.

This capture boundary is an epoch marker, not call-level provenance. A later provider attempt using the same unchanged request header does not create a new evidence capture merely because another network call occurred. A new capture occurs when the loop logs an initial, resumed, or changed `request/header`. Producers that need stronger attempt-level provenance must define that separately rather than overloading this event.

## Evidence selection and validation

Evidence is request-scoped and atomic. For the latest reconstructable request in the inspected prefix, replay inspection considers only evidence whose `requestHeaderSeq` matches that exact request and whose event sequence occurs after the referenced header.

When several matching records exist, the latest record replaces earlier records; fields are not merged across captures. This avoids constructing a synthetic proof from snapshots or identities captured at different times.

Imported evidence is validated fail-closed. Version, request sequence, digest shape, snapshot format, snapshot locator, allowed keys, and nested identity fields are checked. An invalid latest replacement does not fall back to an older valid record. An evidence event marked `ignorable` also cannot strengthen replay capability, because this event changes which reproducibility blockers are justified and therefore must be treated as required vocabulary.

`ReplayInspection` exposes the selected validated evidence and its durable event sequence for diagnostics.

## Alternatives considered

**Treat fingerprints as snapshots.** Rejected because equality evidence cannot restore process state, filesystem state, sandbox state, provider-side state, or other external effects. This would make the replay capability report stronger than the evidence supports.

**Merge multiple evidence events field-by-field.** Rejected because an environment snapshot from one capture and external-state snapshot from another could produce a proof that never existed atomically.

**Fall back to the most recent valid record when the latest one is malformed.** Rejected because corruption or a bad replacement must weaken the claim, not silently revive stale evidence.

**Let contributors append evidence directly.** Rejected because direct writers reintroduce ordering races and can create several partial records around one request boundary. The loop owns the single append after the collector has resolved conflicts.

**Mark the evidence event ignorable.** Rejected because an older reader skipping the event could reconstruct a materially weaker replay-evidence model without realizing that required proof was omitted.

## Consequences

The durable log can now distinguish identity evidence from restorable snapshot evidence and can reduce snapshot-presence blockers without claiming that reproducible execution exists.

Old logs remain valid and simply retain both snapshot blockers. The session format version does not change because this is ordinary event-vocabulary growth; older readers are protected by the required unknown-event rule rather than by silently skipping the event.

The capture seam now exists, but this phase deliberately does not create default environment or external-state snapshots and does not implement a reproducible executor. Runtime, configuration, tool, plugin, sandbox, or external-state owners may contribute identities or artifact references without moving durable-log ownership out of the session layer.

## Verification

`packages/core/session/tests/replay.spec.ts` pins the replay interpretation: identity-only evidence does not clear snapshot blockers, complete snapshot references leave only the executor blocker, malformed latest evidence fails closed, evidence does not leak across request boundaries, inspection boundaries do not see future evidence, and `ignorable` evidence cannot strengthen reproducibility.

`packages/core/session/tests/reproducibility-evidence.spec.ts` pins same-boundary collection semantics: validated merging, permanent per-field conflict removal, mutation-free rejection of invalid input, and sealing.

`packages/core/agent-loop/tests/reproducibility-evidence.spec.ts` pins the runtime boundary: the referenced header is already durable while provider dispatch has not occurred, contributor failures do not block the request, conflicting fields fail closed, and an empty resolved capture emits no evidence record.
