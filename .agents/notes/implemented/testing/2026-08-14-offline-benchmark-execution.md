# Agent Note: Offline benchmark execution foundation

Status: implemented

English | [中文](2026-08-14-offline-benchmark-execution.zh.md)

## Problem

The fork is in a construction phase where external benchmark corpora and live provider comparisons are intentionally unavailable. That does not remove the need for disciplined experimental infrastructure. It makes the internal contract more important: when real workloads arrive, the Harness must already know how to schedule paired variants, preserve replay evidence, separate artifacts, and avoid introducing order bias into the measurement layer itself.

The existing `compare-modes` path executes the complete native task set before the complete Code Mode task set. That shape is simple, but it creates avoidable temporal coupling. Provider load, cache state, repository preparation, runtime temperature, background rollout, or other environment drift can become correlated with the variant simply because one mode always runs earlier.

A second risk is implementation drift. Building a new comparison engine solely for a different schedule would duplicate task loading, session execution, event metrics, and comparison semantics. That would create two benchmark systems whose results might diverge for reasons unrelated to the agent under test.

## Decision

The fork adds a deterministic counterbalanced execution layer for paired native/Code Mode comparisons while keeping the existing benchmark engine as the source of truth for task execution and result semantics.

### Pairing invariant

For every `(task, repetition)` pair:

- native executes exactly once;
- Code Mode executes exactly once;
- the two observations remain adjacent;
- the first variant alternates deterministically across task index and repetition.

This produces a schedule such as:

```text
task A / rep 1: native -> code
task B / rep 1: code   -> native
task A / rep 2: code   -> native
task B / rep 2: native -> code
```

The ordering is deterministic rather than globally random. Re-running the same task ordering and repetition count yields the same variant schedule, which makes failures and session artifacts easier to reproduce.

### Reuse the benchmark engine

`scripts/dsh_bench_plan.py` owns only schedule construction. `scripts/dsh_bench_compare_modes_offline.py` consumes that schedule but delegates task loading, `run_one()`, durable event metrics, and `compare_results()` to `scripts/dsh_bench.py`.

The standalone executor therefore changes orchestration without redefining benchmark meaning. Native and Code Mode keep separate session roots and JSONL outputs, and the final comparison adds `run_order: counterbalanced-paired` so a result records how it was produced.

### Offline verification boundary

The accompanying tests are deliberately provider-free. They verify infrastructure properties that are meaningful before external data exists:

- deterministic alternation of the first variant;
- exact pair completeness for every task/repetition;
- rejection of invalid repetition and task-index inputs;
- executor adherence to the generated run plan;
- separation of native and Code Mode result files;
- preservation of paired comparison metadata.

These tests do not claim that Code Mode is faster, cheaper, or more successful. They establish that a later comparison will not begin with an avoidable scheduling defect.

### Evidence semantics remain separate

This testing layer follows the context-attribution evidence contract. Harness-owned surface metrics may be compared as exact reconstructable facts; provider usage may be compared as provider-reported accounting; estimated token-meter components remain estimates. The benchmark layer does not convert one class into another, and field names must not imply billing truth unless a provider-specific accounting adapter supplies it.

## Alternatives considered

**Keep the existing whole-batch ordering.** Rejected because it systematically correlates variant with time. Even if no external provider is used today, cementing that schedule into the experiment API would make later results harder to interpret and would require migration precisely when benchmark data becomes valuable.

**Globally shuffle every run.** Rejected as the default because it improves randomization at the cost of pair locality and deterministic replay. Adjacent pairs reduce the environmental distance between the two observations, while deterministic alternation still balances which mode goes first.

**Randomize pair order with a seed.** Considered useful as a future option for larger studies, but not chosen as the foundation. A seeded scheduler introduces another configuration dimension and does not improve the core invariant that matters now: paired adjacency plus balanced first-position assignment.

**Rewrite `compare-modes` around a new benchmark engine.** Rejected because scheduling is not a justification for duplicating task semantics, durable event parsing, or comparison logic. The new layer stays intentionally narrow and composes the existing runner.

**Defer benchmark infrastructure until external workloads exist.** Rejected because measurement defects discovered after real runs are expensive: results may become incomparable or need to be discarded. Scheduler correctness, artifact shape, and replay metadata are all verifiable now.

## Consequences

The fork now has a reproducible paired-comparison primitive that is useful independently of any particular model or external benchmark. Future Code Mode, prompt, tool-composition, context-policy, and execution-plane work can reuse the same schedule without inventing experiment orchestration each time.

The design deliberately keeps the new layer small. It does not yet replace the primary `compare-modes` command, add statistical inference, estimate provider cost, or declare performance wins. Those are separate decisions. The immediate benefit is a stronger experimental substrate with explicit provenance and less built-in order bias.

The next testing step is to integrate this schedule into the primary benchmark command once the standalone path remains stable under repository gates. The next runtime step is separate and more important: use the resulting laboratory to change actual agent behavior—especially Code Mode execution semantics, resource budgets, replay-safe side effects, and bounded context/debug surfaces—then evaluate those changes when representative workloads become available.
