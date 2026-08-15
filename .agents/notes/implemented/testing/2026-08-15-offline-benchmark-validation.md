# Agent Note: Offline benchmark validation and replay

Status: implemented

English | [中文](2026-08-15-offline-benchmark-validation.zh.md)

## Problem

The benchmark runner could collect observations and compare the intersection of two JSONL files, but it did not define a versioned result format, prove that paired task ids still represented the same task, reject duplicate or internally inconsistent rows, or distinguish harness failures with a stable taxonomy. The comparison path also had no deterministic offline fixture that could detect changes in benchmark-harness logic independently of model variance, and its only durable report was raw JSON.

## Decision

`scripts/dsh_bench.py` treats benchmark observations as versioned data and validates them before comparison. Each newly collected row is `kind: benchmark-result` with `schema_version: 1`, a semantic `task_fingerprint`, an explicit lifecycle `status`, an `outcome`, and a closed `failure_kind` when the observation failed. Pairing remains keyed by `(task_id, repetition)`, but a pair is valid only when both rows have the same task fingerprint and scored/unscored status.

Comparison is complete by default. Missing keys fail the operation instead of disappearing through set intersection; `--allow-partial` is the explicit escape hatch for interrupted jobs, and the resulting comparison records the unmatched keys. The comparison format is versioned and contains a `benchmark-pair` record for every paired observation, including per-run metric deltas and outcome/failure transitions.

The runner also provides offline `validate`, `fixture`, `replay`, and `report` commands. These commands consume recorded observations only; none invokes a model or invents replacement measurements.

## Validation model

Result validation covers row and result-set invariants. Rows must use the supported schema version, valid status/outcome/failure combinations, consistent command exit/timeout/spawn diagnostics, and exact derived accounting for `leaf_tool_calls` and `billed_input_tokens`. Result files reject duplicate keys, gaps in a task's repetition sequence, and mixed provider/model/variant values.

The task fingerprint hashes `id`, `prompt`, `prepare`, and `check` with canonical JSON. It excludes `workspace`, because equivalent benchmark tasks may intentionally execute in different disposable checkouts. A changed prompt or checker therefore invalidates a nominally equal pair without coupling identity to local paths.

## Fixture semantics

A paired fixture is an offline regression artifact for the benchmark harness, not benchmark evidence of its own. It stores canonical copies of already-recorded baseline and candidate rows, SHA-256 digests for both sets, and the exact expected comparison. Replay revalidates the rows, verifies both digests, recomputes the comparison, and fails on any JSON difference.

The fixture deliberately retains the original observation rows rather than reducing them to fabricated minimal examples. Tests may construct in-memory rows to exercise the pure validation functions, but checked-in tooling does not publish those test values as empirical benchmark results.

## Reporting

Markdown reports present pairing completeness, outcome counts, diagnostic medians, failure taxonomy, and paired transitions. The report explicitly states that it summarizes recorded observations and does not infer which agent composition or execution mode is better. Interpretation stays with the experiment or PR that owns the benchmark hypothesis.

## Alternatives considered

**Keep permissive intersection pairing.** This preserves the old convenience for interrupted runs, but it lets missing candidate or baseline observations disappear without a durable signal. Strict pairing with an explicit partial mode makes incompleteness part of the comparison data.

**Identify tasks by id only.** Stable ids are necessary but insufficient because a task prompt or checker can change while retaining the same id. Hashing the semantic task definition detects that error while still allowing different workspace paths.

**Generate synthetic benchmark-result fixtures in the repository.** This would make harness regression tests easy to inspect, but synthetic rows are too easy to mistake for real benchmark evidence. The shipped fixture command captures observed rows; unit tests construct temporary values without presenting them as benchmark output.

**Automatically score or rank configurations in the report.** A single score would collapse pass/fail, variance, tool work, token usage, and latency into an opinionated policy. The report stays descriptive so experiment owners must make and defend the interpretation.

## Consequences

Result files produced before schema version 1 are rejected by the new offline validation path instead of being guessed into compatibility. This is an intentional pre-release format break.

Benchmark collection can now continue past an individual agent exception and classify that observation, while command spawn failures are separated from timeouts and non-zero exits. Offline comparison failures therefore identify malformed evidence before aggregate deltas are reported.

Fixtures are deterministic with respect to the captured result rows and comparison implementation, but they do not make the original model run deterministic. A replay pass proves benchmark-harness consistency only; it does not add evidence about agent quality.

The focused unit suite in `scripts/dsh_bench_test.py` covers duplicate keys, derived-accounting errors, repetition gaps, incomplete pairing, task-fingerprint mismatch, failure transitions, fixture digest and replay checks, and neutral Markdown rendering.
