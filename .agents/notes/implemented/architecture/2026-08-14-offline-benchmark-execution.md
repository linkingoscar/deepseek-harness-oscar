# Agent Note: Offline benchmark execution foundation

Status: implemented

English | [中文](2026-08-14-offline-benchmark-execution.zh.md)

## Development intent

This fork is still in a construction phase. The immediate goal is not to claim superiority from external benchmark data; it is to turn the Harness into a stronger runtime and a better laboratory for future agent work.

The development rule for this phase is therefore:

1. build runtime, execution-plane, replay, observability, and experiment infrastructure that can be verified locally;
2. distinguish exact Harness-owned evidence from provider-reported usage and heuristic estimates;
3. keep experiments reproducible before real workloads arrive;
4. use repository CI as the integration gate for stage-complete work;
5. avoid manufacturing performance conclusions from missing external data.

No external benchmark corpus or provider run is required for the work in this note.

## Work completed

### Context-attribution evidence contract

The preceding architecture checkpoint defines three evidence classes: exact reconstructable surface facts, provider-reported usage, and estimated component measurements. Benchmark and debugger code must preserve those distinctions rather than convert convenient aggregates into false precision.

### Counterbalanced native/Code Mode planning

`scripts/dsh_bench_plan.py` adds a deterministic plan for paired native/Code Mode observations.

For every `(task, repetition)` pair:

- both variants run exactly once;
- the two variants remain adjacent;
- which variant runs first alternates across task index and repetition.

This prevents the default experiment shape from being "run the entire native batch, then the entire Code Mode batch", which can unnecessarily amplify time drift and workspace/order effects.

### Standalone paired executor

`scripts/dsh_bench_compare_modes_offline.py` reuses the existing benchmark primitives instead of creating a second benchmark engine. It delegates task loading, `run_one()`, event metrics, and result comparison to `scripts/dsh_bench.py` while replacing only the run schedule.

The executor keeps the existing artifact shape:

- `native.jsonl`;
- `code.jsonl`;
- `comparison.json`;
- separate durable session roots per variant.

The comparison records `run_order: counterbalanced-paired` so downstream inspection can tell which experimental schedule produced the result.

### Offline tests

The new tests do not invoke a provider. They verify:

- deterministic alternation of first variant;
- exactly one native and one Code Mode observation per task/repetition pair;
- invalid repeat/index inputs are rejected;
- the executor follows the planned order;
- native/code output files remain separated;
- paired comparison metadata is written.

These tests are intentionally about infrastructure correctness, not model quality.

## Why this is useful before external data exists

External tasks are needed to answer "did the agent become better on real work?" They are not needed to answer whether the experiment machinery is deterministic, whether durable evidence is classified correctly, whether native/Code Mode runs are paired fairly, or whether result artifacts can be replayed and compared consistently.

Building these properties first reduces the chance that later performance work is contaminated by measurement and orchestration mistakes.

## Verification policy

Stage-complete work is allowed to merge when its local contract tests and repository CI are green. CI is treated as an integration gate, not as the development debugger.

For this stage, success means the planner/executor contract is covered by keyless tests and accepted by the fork/main repository gates. It does not mean Code Mode has been proven faster, cheaper, or more successful on external workloads.

## Next development direction

The next high-value slices remain inside the Harness itself:

- integrate the counterbalanced schedule into the primary benchmark command once the standalone path is stable;
- remove billing-suggestive metric names where only provider accounting aggregates are known;
- continue execution-plane work around Code Mode resource budgets, typed tool dispatch, and replay-safe side-effect semantics;
- turn durable session events into better bounded trace/context debugging surfaces;
- keep product-facing composition opinionated while preserving the replaceable runtime underneath.

The long-term target is a Harness that is simultaneously a reliable agent runtime and a disciplined agent laboratory: failures should be reconstructable, experiments should be comparable, and improvements should eventually be provable when real workloads become available.
