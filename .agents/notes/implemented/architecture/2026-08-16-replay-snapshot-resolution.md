# Agent Note: Replay snapshot resolution and verification

Status: implemented

English | [中文](2026-08-16-replay-snapshot-resolution.zh.md)

## Problem

Durable replay reproducibility evidence can name an execution-environment snapshot and an external-state snapshot by `format`, opaque `locator`, and SHA-256 digest. Before this change those references proved only that a snapshot claim was recorded. Core had no contract for asking a caller to materialize the referenced artifact and no way to prove that the returned bytes still matched the durable digest.

A future reproducible executor must not trust locator metadata, resolver metadata, or identity fingerprints as substitutes for artifact bytes. It also must be able to distinguish a missing reference, a missing resolver, an invalid resolver contract, a resolver failure, and a digest mismatch.

## Decision

`packages/core/session/src/replay-snapshot.ts` defines the caller-supplied `ReplaySnapshotResolver` contract and the request-scoped `resolveReplaySnapshots()` API. The resolver owns interpretation of `format` and `locator`; Core provides no filesystem, HTTP, S3, sandbox, or cloud resolver.

`resolveReplaySnapshots()` delegates request and boundary selection to `inspectReplayCapabilities()`. It therefore reuses the existing exact `request/header` binding, latest-replacement semantics, malformed-latest fail-closed behavior, and boundary isolation instead of scanning reproducibility evidence again.

Execution-environment and external-state snapshots are resolved independently. For each class the result is a discriminated state:

- `reference-absent`;
- `resolver-absent`;
- `resolver-contract-invalid`;
- `resolve-failed`;
- `digest-mismatch`;
- `verified`.

A valid resolver must be an object with a non-whitespace `id` and a callable `resolve()` method. A resolver exception/rejection is classified separately from a non-`Uint8Array` return. On a byte result, Core copies the bytes, computes SHA-256 over that detached byte sequence with Node's crypto implementation, and compares the computed digest with the durable snapshot digest. Locator text, byte count, and resolver-provided metadata are never used as integrity substitutes.

The public replay facade exports the resolver contract and resolution API through `@deepseek-ai/dsh-session/replay`.

## Replay capability semantics

Snapshot verification is deliberately separate from replay capability inspection. Existing inspection still reports whether the selected durable evidence contains snapshot references; calling the resolver does not mutate the log or rewrite capability records.

Even when both artifacts return `verified`, reproducible replay remains `unavailable` and `REPRODUCIBLE_EXECUTOR_NOT_IMPLEMENTED` remains the blocker. This change does not restore snapshots, start a sandbox, invoke a model, execute a tool, create a live fork, or implement a reproducible executor.

## Failure and trust boundaries

The resolver is caller-owned code and may perform whatever I/O the caller explicitly chooses. Core itself performs no default external I/O. One snapshot's failure does not suppress resolution of the other snapshot class.

Malformed or ignorable latest reproducibility evidence is handled before resolution by the existing inspector. Resolution never falls back to an older valid snapshot when the selected latest record fails closed. Identity digests remain comparison evidence only and are never treated as snapshot references.

A `verified` result contains a detached mutable `Uint8Array` that matched the durable digest at verification time. The result object is immutable, but the bytes are an execution input rather than durable evidence; a future executor must define its own ownership and restoration lifecycle.

## Alternatives considered

**Provide a built-in filesystem or HTTP resolver.** Rejected because path permissions, network effects, credentials, lifecycle, portability, and large-object streaming are provider concerns and would widen Core's trust boundary before the verification contract is stable.

**Make digest verification part of `inspectReplayCapabilities()`.** Rejected because inspection is synchronous, durable-evidence-only analysis. Artifact materialization is caller-supplied execution with potential I/O and must remain explicit.

**Mark reproducible replay available after both digests verify.** Rejected because verified artifacts are only a prerequisite. No restoration or reproducible executor exists yet.

## Consequences

Replay can now advance a durable snapshot reference from "recorded" to "artifact bytes verified" without overstating reproducible execution support. Callers receive explicit failure states for diagnostics, both snapshot classes retain independent ownership, and future executor work has a narrow verified-byte input contract to build on.

The remaining major blocker is unchanged: snapshot restoration and a reproducible executor still need their own lifecycle, effect, failure, and provenance contracts before reproducible replay can become available.
