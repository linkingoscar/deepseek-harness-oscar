# Agent Note: Replay snapshot resolution and verification

Status: implemented

中文 | [English](2026-08-16-replay-snapshot-resolution.md)

## Problem

Durable replay reproducibility evidence 已经可以用 `format`、opaque `locator` 和 SHA-256 digest 指向 execution-environment snapshot 与 external-state snapshot。但在本次改动前，这些 reference 只能证明“记录过一个 snapshot 声明”。Core 没有 contract 可以要求调用方把 reference 对应的 artifact 实体解析出来，也无法证明解析出的 bytes 仍然与 durable digest 一致。

未来的 reproducible executor 不能把 locator metadata、resolver metadata 或 identity fingerprint 当成 artifact bytes 的替代证明。同时，系统还必须明确区分：reference 缺失、resolver 缺失、resolver contract 非法、resolver 执行失败以及 digest mismatch。

## Decision

`packages/core/session/src/replay-snapshot.ts` 定义 caller-supplied `ReplaySnapshotResolver` contract，以及 request-scoped `resolveReplaySnapshots()` API。resolver 负责解释 `format` 和 `locator`；Core 不提供 filesystem、HTTP、S3、sandbox 或 cloud resolver。

`resolveReplaySnapshots()` 把 request 与 boundary 的选择委托给 `inspectReplayCapabilities()`。因此它直接复用现有精确 `request/header` 绑定、latest-replacement 语义、最新 malformed record fail-closed 规则和 boundary isolation，而不是再扫描一遍 reproducibility evidence。

Execution-environment 与 external-state 两类 snapshot 独立解析。每一类都会得到一个 discriminated state：

- `reference-absent`；
- `resolver-absent`；
- `resolver-contract-invalid`；
- `resolve-failed`；
- `digest-mismatch`；
- `verified`。

合法 resolver 必须是 object，拥有非空白 `id` 与可调用的 `resolve()`。resolver throw/reject 与返回非 `Uint8Array` 会被分开分类。拿到 bytes 后，Core 先复制为独立 byte sequence，再使用 Node crypto 对这些 artifact bytes 本身计算 SHA-256，并与 durable snapshot digest 比较。locator 文本、byte count 和 resolver 提供的 metadata 都不能替代完整性校验。

Public replay facade 通过 `@deepseek-ai/dsh-session/replay` 导出 resolver contract 与 resolution API。

## Replay capability semantics

Snapshot verification 与 replay capability inspection 保持分层。现有 inspection 继续只说明所选 durable evidence 是否包含 snapshot reference；调用 resolver 不会修改 session log，也不会重写 capability record。

即使两个 artifact 都返回 `verified`，reproducible replay 仍保持 `unavailable`，并继续保留 `REPRODUCIBLE_EXECUTOR_NOT_IMPLEMENTED` blocker。本改动不恢复 snapshot、不启动 sandbox、不调用模型、不执行工具、不创建 live fork，也不实现 reproducible executor。

## Failure and trust boundaries

Resolver 是 caller-owned code，可以执行调用方明确选择的 I/O；Core 本身不执行任何默认 external I/O。一类 snapshot 的失败不会阻止另一类 snapshot 的独立解析与校验。

最新 malformed 或 ignorable reproducibility evidence 会先由现有 inspector 按 fail-closed 规则处理。resolution 不会在最新 record 失败后回退到更早的 valid snapshot。Identity digest 仍然只是 comparison evidence，绝不会被解释为 snapshot reference。

`verified` 结果携带一个 detached、可变的 `Uint8Array`，它表示“在校验时与 durable digest 一致”的 bytes。结果 object 是 immutable 的，但这些 bytes 是未来 executor 的 execution input，而不是新的 durable evidence；后续 executor 必须自行定义 ownership 与 restoration lifecycle。

## Alternatives considered

**提供内置 filesystem 或 HTTP resolver。** 拒绝，因为 path permission、network effect、credential、lifecycle、portability 与 large-object streaming 都属于 provider concern，在 verification contract 稳定前不应该扩大 Core 的信任边界。

**把 digest verification 放进 `inspectReplayCapabilities()`。** 拒绝，因为 inspection 是同步、只依赖 durable evidence 的分析；artifact materialization 是 caller-supplied execution，可能包含 I/O，必须显式调用。

**两个 digest 都通过后直接把 reproducible replay 标成 available。** 拒绝，因为 verified artifact 只是前置条件，snapshot restoration 与 reproducible executor 仍未实现。

## Consequences

Replay 现在可以把 durable snapshot reference 从“已记录”推进到“artifact bytes 已验证”，同时不夸大 reproducible execution 支持。调用方能看到明确的失败状态，两类 snapshot 继续保持独立 ownership，未来 executor 也获得了一个窄而明确的 verified-byte 输入 contract。

剩余的主要 blocker 没有变化：snapshot restoration 与 reproducible executor 仍然需要独立的 lifecycle、effect、failure 与 provenance contract，完成这些之后才可以讨论让 reproducible replay 变为 available。
