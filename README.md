# DeepSeek Harness — Oscar Fork

English | [中文](README.zh.md)

> This repository is an engineering fork of [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). It is **not an official DeepSeek release**.

DeepSeek Harness (`dsh`) is an open-source agent harness built around an **everything-is-a-plugin** architecture and powered by [Cordis](https://github.com/cordiverse/cordis). This fork keeps that architecture, but focuses development on a narrower question:

**Can an agent runtime make execution, delivery, replay, and evaluation evidence precise enough to diagnose and reproduce what actually happened?**

The goal is not to add a large collection of product features. The goal is to strengthen the harness as an auditable execution substrate: explicit accounting, durable evidence, reproducible replay, behavior-neutral diagnostics, and benchmark infrastructure whose results can be validated rather than merely printed.

## Fork direction

This fork is being developed around six principles:

1. **Evidence before interpretation.** Persist the facts required to explain a run before drawing conclusions from it.
2. **Execution and delivery are different events.** A tool can execute successfully while its result is rejected, truncated, unmeasured, or never admitted back into the model context. Accounting should preserve that distinction.
3. **Measurement should be behavior-neutral by default.** Diagnostics and accounting should observe runtime behavior without silently changing it.
4. **Replay is a contract, not a button.** Live-fork replay, reproducible replay, and effect-free simulated replay have different semantics and should remain explicit.
5. **Benchmark infrastructure must be auditable.** Paired results, fixtures, deterministic replay, consistency checks, failure classification, and report generation matter more than producing a headline score.
6. **Prefer small, upstream-friendly seams.** Extend the existing plugin/runtime architecture instead of replacing it with a fork-specific privileged core.

## Current status

Status snapshot: **2026-08-15**.

### Landed on `master`

- ✅ **Replay capability semantics** — replay modes are modeled with distinct effect and snapshot semantics.
- ✅ **Historical request reconstruction** — canonical request snapshots can be reconstructed for replay-oriented workflows.
- ✅ **Executor-driven simulated replay** — effect-free simulated replay can run through a caller-supplied executor seam.
- ✅ **Code Mode delivery-byte accounting** — exact canonical JSON bytes delivered by successful sub-dispatches are recorded, while unknown legacy evidence remains explicit.
- ✅ **Delivery admission accounting** — successful execution is separated from result delivery/admission, including explicit delivery-rejection evidence.
- ✅ **Cumulative result-byte budget** — Code Mode can enforce a per-run delivered-result byte budget without collapsing execution success into delivery success.
- ✅ **DevTools execution summary** — trajectory inspection exposes durable Code Mode execution accounting and delivery-byte evidence.
- ✅ **Focused runtime/fixture coverage** — Worker boot fixtures and fork-owned tests track the current binding/output budget contracts.

### Active workstreams

The following branches were cut from the current `master` baseline. At the snapshot above they still point at the same baseline commit, so the table describes **workstream scope**, not already-landed functionality.

| Branch | Scope | Current state |
| --- | --- | --- |
| `agent/execution-devtools-diagnostics` | Turn existing accounting/evidence into stronger diagnostics: `deliveryRejected`, byte accounting, peak concurrency, unsettled/orphan dispatch detection, and per-tool execution summaries. Runtime behavior should remain unchanged unless a change is explicitly required. | Workstream opened; branch currently at `master` baseline |
| `agent/offline-benchmark-validation` | Harden the benchmark harness itself: paired-result schema, fixtures/deterministic replay, consistency validation, failure taxonomy, and report generation. | Workstream opened; branch currently at `master` baseline |
| `agent/replay-reproducibility-evidence` | Strengthen replay reproducibility and the evidence required to prove what inputs, snapshots, effects, and outputs a replay actually used. | Workstream opened; branch currently at `master` baseline |

## Roadmap

### P0 — Make execution evidence trustworthy

- Keep dispatch/execution/delivery accounting explicit and internally consistent.
- Close diagnostic gaps around rejected delivery, bytes, concurrency, and unsettled/orphan work.
- Make per-tool execution summaries useful enough to explain a trajectory without reading raw event streams by hand.

### P1 — Make replay reproducible and inspectable

- Tighten the contracts around historical request snapshots and replay inputs.
- Make deterministic/effect-free replay paths suitable for fixtures and regression testing.
- Persist enough evidence to distinguish reproducible replay from a live fork that happens to start from similar state.

### P2 — Validate the benchmark harness

- Define a paired-result schema with explicit provenance and failure state.
- Build deterministic fixtures/replay for harness validation.
- Add result-consistency checks and a failure taxonomy.
- Generate reports from validated results rather than ad-hoc console output.

### P3 — Integrate without losing upstream compatibility

- Keep changes modular and testable behind clear package/plugin seams.
- Rebase/sync with upstream deliberately instead of accumulating avoidable fork-only architecture.
- Promote stable diagnostics and replay contracts into reusable developer tooling.

## Non-goals

This fork deliberately does **not** treat infrastructure work as evidence for a model or execution-mode ranking.

- No fabricated or synthetic "benchmark results" presented as real measurements.
- No claim that Code Mode is better or worse merely because new accounting, replay, or benchmark machinery exists.
- No silent runtime behavior changes hidden inside diagnostics work.
- No rewrite of the everything-is-a-plugin / Cordis architecture just to make fork-specific features easier to bolt on.

When performance claims are eventually made, they should come from reproducible inputs, validated result pairs, explicit failure handling, and inspectable reports.

## Upstream architecture

The upstream project uses an architecture where **everything is a plugin**, powered by [Cordis](https://github.com/cordiverse/cordis), whose design is described in [_A Programming Paradigm for Spatiotemporal Composability_](https://github.com/cordiverse/paper).

DeepSeek Harness is currently a developer preview and iterates rapidly, so compatibility-breaking upstream changes should be expected.

## Run

### Run the upstream npm release

Install `Node.js`, then run:

```sh
npx @deepseek-ai/dsh web
```

This runs the published upstream package and starts the Web UI at `http://127.0.0.1:3080` by default. See the [Web UI guide](docs/user/guide/index.md).

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
