# Agent Note: Code Execution Diagnostics Summary

Status: implemented

English | [中文](2026-08-15-code-execution-diagnostics-summary.zh.md)

## Problem

Code Mode already records durable `tool/code-dispatch-start` / `tool/code-dispatch` evidence and `deriveCodeRunExecutionAccounting` reconstructs run-local facts such as delivery rejections, measured delivery bytes, peak in-flight dispatches, unsettled starts, orphan settles, and per-tool counters. DevTools consumers still have to repeat their own cross-run aggregation, which risks inconsistent byte handling and misleading claims about concurrency.

Adding another runtime ledger or scheduler observer would be the wrong fix. The durable event pair is already the source of truth, and observability must not change dispatch behavior.

## Decision

`@deepseek-ai/dsh-tools/execution-diagnostics` adds `summarizeCodeRunExecutionAccounting(runs)`, a pure second-stage projection over existing `CodeRunExecutionAccounting` records. It aggregates started, settled, failed, delivery-rejected, unsettled, and orphan counts; preserves measured-versus-unmeasured delivery-byte evidence; and provides per-tool execution summaries.

The concurrency field is named `maxRunPeakInFlight`. It is the maximum of the run-local peaks and is deliberately not presented as a session/global concurrency peak, because run summaries do not retain enough inter-run ordering evidence to reconstruct overlapping runs.

Measured delivered-value bytes remain separate from missing byte evidence. If exact run or per-tool byte subtotals cannot be summed into a JavaScript safe integer, the corresponding `deliveredValueBytes` summary is `null` rather than an invented or rounded total. `unmeasuredDeliveredValues` continues to report upstream successes that lacked exact byte evidence; aggregation overflow does not increment that count.

A run contributes to `runsWithIncompleteEvidence` when its accounting contains at least one unsettled start or orphan settle. The summary reports that evidence quality issue instead of normalizing it away.

The package exposes the new pure summary through a stable `./execution-diagnostics` subpath backed by the existing TypeScript build output. No agent-loop, scheduler, tool execution, admission, or session persistence path is modified.

## Alternatives considered

**Derive diagnostics directly from live scheduler state.** Rejected because it would create a second observation path with different lifecycle and race semantics from the durable event source.

**Call the maximum run peak a global/session peak.** Rejected because independently summarized runs may overlap and their cross-run event ordering has already been discarded.

**Coerce byte overflow into a number.** Rejected because saturation, rounding, or partial totals would look exact to DevTools consumers. An explicit `null` preserves the distinction between representability and missing source evidence.

## Consequences

DevTools can consume one stable summary shape for Code Mode execution health without perturbing runtime behavior. Incomplete or sliced durable evidence remains visible, delivery rejection remains distinct from tool failure, and byte-accounting precision is explicit.

The summary cannot reconstruct a true global concurrency peak from run aggregates. A future global concurrency view would need ordered durable dispatch events, not this second-stage summary alone.

Unit coverage exercises empty evidence, cross-run/per-tool aggregation, incomplete evidence, delivery rejection, run-local peak semantics, and safe-integer byte overflow.
