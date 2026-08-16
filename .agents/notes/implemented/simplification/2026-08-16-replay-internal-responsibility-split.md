# Agent Note: Replay internal responsibility split

Status: implemented

English | [中文](2026-08-16-replay-internal-responsibility-split.zh.md)

## Problem

Replay inspection, request-scoped reproducibility-evidence selection, and effect-free simulation lived in one source module even though they have different responsibilities and failure semantics. The public API was small, but future replay work would have had to edit the same implementation file for evidence selection, capability policy, and executor handling, increasing the chance that an internal change accidentally widened replay claims or leaked helper APIs.

## Decision

`packages/core/session/src/replay.ts` is the public facade and re-exports the existing replay API. Capability derivation and boundary validation live in `replay-inspection.ts`, request-scoped replacement evidence selection lives in `replay-evidence.ts`, and effect-free executor validation and execution live in `replay-simulation.ts`.

The split does not add a replay mode, blocker, durable event, snapshot resolver, environment restoration path, or reproducible executor. `reproducible` remains unavailable while `REPRODUCIBLE_EXECUTOR_NOT_IMPLEMENTED` applies, and snapshot references remove only their existing snapshot-presence blockers.

The evidence selector keeps replacement semantics fail-closed: an ignorable or malformed latest record for the selected request does not fall back to an older valid record. Internal selector helpers are not re-exported from `replay.ts`.

## Alternatives considered

**Keep all replay behavior in `replay.ts`.** Rejected because inspection policy, evidence replacement selection, and simulation execution change for different reasons and already have distinct tests and failure semantics.

**Introduce new public replay subpaths for each responsibility.** Rejected because no current consumer needs separate package-level entry points. The existing facade is sufficient and avoids expanding the public API during an internal hardening pass.

**Add snapshot resolution while splitting the module.** Rejected because snapshot materialization is a new capability, not a structural refactor, and current replay semantics deliberately stop before reproducible execution.

## Consequences

Replay code has narrower ownership without changing observable replay semantics. Tests pin facade exports, immutable capability records, fail-closed latest-replacement behavior, executor identity validation, asynchronous execution, and propagation of executor-owned failures.

Future replay work can change one responsibility without reopening unrelated policy, but any new replay capability still requires its own evidence and execution justification rather than being inferred from this file split.
