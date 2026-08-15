# DeepSeek Harness — Oscar Fork

English | [中文](README.zh.md)

> This repository is an engineering fork of [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). It is **not an official DeepSeek release**.

DeepSeek Harness (`dsh`) is an open-source agent harness built around an **everything-is-a-plugin** architecture and powered by [Cordis](https://github.com/cordiverse/cordis). This fork keeps that architecture, but focuses development on a narrower question:

**Can an agent runtime make execution, delivery, replay, and evaluation evidence precise enough to diagnose, reproduce, and validate what actually happened?**

The goal is not to add a large collection of product features. The goal is to strengthen the harness as an auditable execution substrate: explicit accounting, durable evidence, reproducible replay, behavior-neutral diagnostics, and benchmark infrastructure whose results can be validated rather than merely printed.

Project page: **https://linkingoscar.github.io/deepseek-harness-oscar/**

## Fork direction

This fork is developed around six principles:

1. **Evidence before interpretation.** Persist the facts required to explain a run before drawing conclusions from it.
2. **Execution and delivery are different events.** A tool can execute successfully while its result is rejected, truncated, unmeasured, or never admitted back into the model context. Accounting should preserve that distinction.
3. **Measurement should be behavior-neutral by default.** Diagnostics and accounting should observe runtime behavior without silently changing it.
4. **Replay is a contract, not a button.** Live-fork replay, reproducible replay, and effect-free simulated replay have different semantics and should remain explicit.
5. **Benchmark infrastructure must be auditable.** Paired results, fixtures, deterministic replay, consistency checks, failure classification, and report generation matter more than producing a headline score.
6. **Prefer small, upstream-friendly seams.** Extend the existing plugin/runtime architecture instead of replacing it with a fork-specific privileged core.

## Current status

Status snapshot: **2026-08-15**.

The first three parallel fork workstreams are now **landed on `master`**. The project has moved from parallel feature construction into integration, validation, and evidence-driven experimentation.

### Landed foundations

- ✅ **Replay capability semantics** — replay modes are modeled with distinct effect and snapshot semantics.
- ✅ **Historical request reconstruction** — canonical request snapshots can be reconstructed for replay-oriented workflows.
- ✅ **Executor-driven simulated replay** — effect-free simulated replay can run through a caller-supplied executor seam.
- ✅ **Code Mode delivery-byte accounting** — exact canonical JSON bytes delivered by successful sub-dispatches are recorded, while unknown legacy evidence remains explicit.
- ✅ **Delivery admission accounting** — successful execution is separated from result delivery/admission, including explicit delivery-rejection evidence.
- ✅ **Cumulative result-byte budget** — Code Mode can enforce a per-run delivered-result byte budget without collapsing execution success into delivery success.
- ✅ **Focused runtime/fixture coverage** — Worker boot fixtures and fork-owned tests track the current binding/output budget contracts.

### Completed parallel workstreams

| Workstream | Delivered capability | State |
| --- | --- | --- |
| `agent/replay-reproducibility-evidence` | Durable request-scoped reproducibility evidence that records the actual replay input/snapshot/effect context without conflating a live fork with a reproducible replay. | ✅ Merged via PR #17 |
| `agent/execution-devtools-diagnostics` | Pure derived execution diagnostics covering `deliveryRejected`, measured/unmeasured byte accounting, run-local peak concurrency, unsettled/orphan dispatch evidence, incomplete evidence, and per-tool summaries. | ✅ Merged via PR #18; publication constraint follow-up via PR #20 |
| `agent/offline-benchmark-validation` | Versioned paired-result validation, semantic task fingerprints, deterministic offline fixtures/replay, failure taxonomy, consistency checks, and neutral Markdown report generation. | ✅ Merged via PR #19 |

The benchmark integration was validated by the fork CI with **35/35 static gates passing** plus focused benchmark, execution-accounting, delivery-byte, admission, replay, and trajectory tests.

## What the fork can now prove

The work above is deliberately about evidence quality rather than product claims.

### Execution

The runtime can preserve the distinction between a tool dispatch starting, settling, failing, and having its result accepted or rejected for delivery. Derived diagnostics can summarize those durable facts without changing scheduler behavior.

### Delivery and bytes

Code Mode accounting can distinguish measured delivery bytes from unknown evidence, track delivery rejection, and reason about cumulative delivered-result budgets without treating execution success as equivalent to model-context delivery.

### Replay

Replay-oriented flows can reconstruct historical request inputs and retain request-scoped reproducibility evidence. The fork keeps live-fork semantics, reproducible replay, and effect-free simulated replay conceptually separate.

### Benchmark validation

The offline benchmark harness now treats observations as versioned evidence. It validates result-set invariants, requires strict paired observations by default, records failure transitions, supports deterministic fixture replay, and generates descriptive reports from recorded observations.

**It does not fabricate benchmark observations and does not infer that Code Mode or any configuration is superior.**

## Next phase

The next phase is integration and evidence-driven use of the infrastructure that is now on `master`.

### P0 — Consolidate developer diagnostics

- Connect execution summaries, replay evidence, and trajectory inspection into a coherent debugging workflow.
- Keep global/session claims separate from run-local evidence unless durable ordering data can actually support them.
- Improve discoverability without moving policy decisions into diagnostics code.

### P1 — Run reproducible experiments

- Use recorded, attributable inputs and validated result pairs for real benchmark runs.
- Keep raw observations, failure taxonomy, fixture provenance, and reports inspectable.
- Make interpretation an explicit experiment-level decision rather than a hidden harness policy.

### P2 — Keep the fork upstream-compatible

- Rebase/sync with upstream deliberately instead of accumulating avoidable fork-only architecture.
- Preserve small package/plugin seams and behavior-neutral instrumentation where possible.
- Promote stable evidence contracts into reusable developer tooling when they prove useful.

## Non-goals

This fork deliberately does **not** treat infrastructure work as evidence for a model or execution-mode ranking.

- No fabricated or synthetic “benchmark results” presented as real measurements.
- No claim that Code Mode is better or worse merely because new accounting, replay, or benchmark machinery exists.
- No silent runtime behavior changes hidden inside diagnostics work.
- No rewrite of the everything-is-a-plugin / Cordis architecture just to make fork-specific features easier to bolt on.

When performance claims are made, they should come from reproducible inputs, validated result pairs, explicit failure handling, and inspectable reports.

## Upstream architecture

The upstream project uses an architecture where **everything is a plugin**, powered by [Cordis](https://github.com/cordiverse/cordis), whose design is described in [_A Programming Paradigm for Spatiotemporal Composability_](https://github.com/cordiverse/paper).

DeepSeek Harness is a rapidly evolving developer-oriented project, so upstream compatibility should be treated as an active engineering concern rather than a one-time migration task.

## Run

### Run the upstream npm release

Install `Node.js`, then run:

```sh
npx @deepseek-ai/dsh web
```

This runs the published upstream package and starts the Web UI at `http://127.0.0.1:3080` by default. See the [Web UI guide](docs/user/guide/index.md).

<a id="run-from-source"></a>

### Run this fork from source

```sh
git clone https://github.com/linkingoscar/deepseek-harness-oscar.git
cd deepseek-harness-oscar
pnpm install
pnpm run build
pnpm dsh web
```

## Development

Start with the [development guide](docs/development.md) and [architecture documentation](docs/architecture.md).

For agent-driven changes, follow [AGENTS.md](AGENTS.md). Fork work should keep evidence contracts, tests, and runtime behavior changes separable so a diagnostic improvement can be reviewed independently from a semantic change.

## Upstream, community, and contributing

This fork builds on [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness). For upstream project support and community resources, see the upstream repository and its [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions).

For repository contribution guidance, see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)

Third-party dependencies and their licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
