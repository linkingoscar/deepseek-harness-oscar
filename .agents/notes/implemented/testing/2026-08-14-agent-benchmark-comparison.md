# Agent Note: Paired benchmark comparisons for agent changes

Status: implemented

English | [中文](2026-08-14-agent-benchmark-comparison.zh.md)

## Problem

Agent-runtime changes can look better structurally while leaving task success unchanged or worse. Code Mode makes one specific measurement especially easy to misread: one model-visible `run_code` call can contain many native tool sub-dispatches, so counting only top-level tool calls confuses transport collapse with less execution work. A persistent shell is also a poor sole baseline because it already lets the model batch arbitrary computation inside one tool call.

## Decision

The fork treats paired benchmark evidence as the default development signal for changes intended to improve agent behavior. `scripts/dsh_bench.py` runs JSONL tasks through the existing Python SDK, records each repetition independently, derives trajectory metrics from durable root-session events, and compares baseline and candidate rows only when `(task_id, repetition)` matches.

Code Mode comparisons report both model-visible `tool/call` counts and execution-level `tool/code-dispatch` counts. `leaf_tool_calls` removes the outer `run_code` transport and adds its sub-dispatches, so a lower top-level call count is not presented as lower execution work unless the leaf view also improves.

`compare-modes` ships two capability-matched composition pairs. The default `fs` pair exposes `read`, `write`, `edit`, `glob`, and `grep` without Bash; the `shell` pair retains persistent Bash plus the string-replace editor as a conservative comparison. Both pairs change tool presentation while holding the model-facing capabilities for that pair constant, with the Code side additionally mounting the worker runtime required by `run_code`.

The checked-in `benchmarks/code-mode` micro-eval suite supplies deterministic execution-heavy fixtures. Its post-run checks verify semantic answer files, required source edits, preservation of untouched source files, and absence of unexpected files. The suite diagnoses orchestration behavior; repository-scale coding evals remain necessary before changing product defaults.

Benchmark results are development evidence, not a CI pass/fail threshold or a public leaderboard. Real-model runs depend on provider credentials, cost, model variance, and environment conditions, so the repository keeps the runner and deterministic task checks keyless while repeated model runs remain an explicit experiment.

## Alternatives considered

**Judge changes from architecture and trajectory inspection alone.** This is useful for forming a hypothesis but cannot establish that the agent solves more tasks or uses fewer resources, so behavioral claims require measured task runs.

**Use only the persistent-shell composition.** A shell can already batch search, parsing, and aggregation, which makes it a useful conservative comparison but an insensitive test of whether Code Mode adds an execution plane. The structured-tool pair is the default and the shell pair remains available.

**Count only model-visible tool calls.** That would systematically favor Code Mode because nested SDK calls do not enter model history. Durable Code Mode sub-dispatch events make the leaf execution count observable, so the runner reports both views.

**Make benchmark deltas a CI gate.** Real-model variance, credentials, provider availability, and spend would turn a useful experiment into a flaky repository gate. Keyless tests instead verify the runner, task materialization, and deterministic scoring logic.

## Consequences

Agent-quality PRs have a concrete place to state a hypothesis, task set, baseline/candidate settings, pass-rate delta, efficiency deltas, and regressions. The event-sourced session model becomes the measurement source rather than a parallel instrumentation path.

The comparison does not remove experimental judgment. Task suites can overfit the behavior they were designed to expose, medians can hide multimodal failures, and small stochastic deltas remain weak evidence. Repetitions and capability-matched compositions reduce those risks but do not eliminate them.

Code Mode earns a stronger default only if correctness holds or improves and the reduction survives model steps, model-visible calls, leaf calls, token accounting, and latency. A win confined to top-level tool-call count is treated as presentation compression, not demonstrated execution efficiency.
