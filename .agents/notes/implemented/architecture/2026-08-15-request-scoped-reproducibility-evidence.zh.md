# Agent Note: Request-scoped reproducibility evidence

Status: implemented

[English](2026-08-15-request-scoped-reproducibility-evidence.md) | 中文

## Problem

Replay 已经区分 transcript inspection、request reconstruction、无副作用 simulation、live fork 和 reproducible execution。`reproducible` 模式此前正确地保持 unavailable，因为 durable log 不能证明 execution environment 或 external state 已经被快照，而且也不存在 reproducible executor。

未来实现需要 durable evidence 来回答两个不同问题，并且不能把它们混为一谈：某个输入 identity 是否与历史运行一致，以及历史状态是否真的可以恢复。runtime、configuration、tool schema set 或 plugin graph 的哈希适合作为比较证据，但它不是 snapshot。若把 identity 当成可恢复状态，replay capability reporting 就会夸大 reproducibility。

## Decision

Session replay vocabulary 增加一个 required、log-only 的 `replay/reproducibility-evidence` event，并绑定到某一个精确的历史 `request/header` sequence。

version 1 payload 记录：

- `requestHeaderSeq`，把 evidence 绑定到一个可重建的 request-header epoch，而不是整个 session；
- runtime、effective configuration、model-visible tool schemas 和 composed plugin graph 的可选 identity digests；
- 可选的 execution-environment snapshot reference；
- 可选的 external-state snapshot reference。

Digest 使用 SHA-256 小写十六进制。Snapshot reference 还包含非空 format 和 opaque locator，使未来的 reproducible executor 可以解析对应字节并校验 digest。

Identity digests 永远不能满足 snapshot blocker。经过验证的 `executionEnvironmentSnapshot` 只能移除 `EXECUTION_ENVIRONMENT_NOT_SNAPSHOTTED`；经过验证的 `externalStateSnapshot` 只能移除 `EXTERNAL_STATE_NOT_SNAPSHOTTED`。`REPRODUCIBLE_EXECUTOR_NOT_IMPLEMENTED` 仍然存在，因此本阶段 `reproducible` 模式仍保持 unavailable。

## Runtime capture seam

Agent loop 在 request-header 边界暴露同步通知 `agent/request-reproducibility-evidence`。只有 canonical `request/header` 已 durable append 成功、provider 尚未 dispatch 时才会 emit；payload 携带精确的已提交 header sequence，以及该 sequence 实际存储的 frozen header snapshot。

Listener 只拿到一个窄的、write-only 的 evidence sink，只能同步贡献在该边界已经可获得的 evidence。Loop 不等待 listener 返回的 Promise。Listener throw、非法 contribution、collector failure 或 evidence-log append failure 都只属于 diagnostics failure：任何一种都不能 veto 或修改模型请求。

同一 capture boundary 中的 contribution 会先合并，再由 loop 只追加一个原子的 durable payload。完全相同的值会合并，不同字段可以组合；如果多个有效 contributor 对同一个 identity 或 snapshot 字段给出冲突值，该字段立即 fail closed，并在本次 capture 中永久省略，后续 listener 顺序不能把它恢复。如果最终没有任何无歧义 evidence，则不追加 evidence event。

这个 capture boundary 是 request-header epoch marker，不是每一次 provider call 的 provenance。若后续 provider attempt 继续复用未变化的同一个 request header，不会仅因为再次发生网络调用就新建一条 evidence capture。只有 loop 记录 initial、resume 或 change 的新 `request/header` 时才形成新 capture。若未来需要更强的 attempt-level provenance，应单独定义，而不能过载这里的 event 语义。

## Evidence selection and validation

Evidence 以 request 为作用域，并且是原子的。对于 inspected prefix 中最新可重建的 request，replay inspection 只考虑 `requestHeaderSeq` 与该 request 精确匹配、且 event sequence 位于所引用 header 之后的 evidence。

当存在多条匹配记录时，最新记录整体替换旧记录；不会跨 capture 逐字段合并。这样可以避免把不同时间采集的 snapshot 或 identity 拼成一个从未真实存在过的 synthetic proof。

导入的 evidence 采用 fail-closed 验证。Version、request sequence、digest shape、snapshot format、snapshot locator、allowed keys 和嵌套 identity fields 都会被检查。最新 replacement 无效时，不会回退到更早的有效记录。被标记为 `ignorable` 的 evidence event 也不能增强 replay capability，因为该事件会改变哪些 reproducibility blockers 有证据可以消除，所以它必须属于 required vocabulary。

`ReplayInspection` 会暴露选中的、已验证的 evidence 及其 durable event sequence，供 diagnostics 使用。

## Alternatives considered

**把 fingerprints 当作 snapshots。** 拒绝，因为 equality evidence 无法恢复 process state、filesystem state、sandbox state、provider-side state 或其他 external effects。这样会让 replay capability report 强于实际 evidence。

**逐字段合并多条 evidence events。** 拒绝，因为某次 capture 的 environment snapshot 与另一次 capture 的 external-state snapshot 可能被拼成一个从未原子存在过的 proof。

**当最新记录损坏时回退到最近的有效记录。** 拒绝，因为 corruption 或错误 replacement 应该削弱 claim，而不是静默复活 stale evidence。

**让 contributor 直接 append evidence。** 拒绝，因为多个直接 writer 会重新引入写入顺序竞争，并可能围绕同一个 request boundary 产生多条 partial records。Loop 必须在 collector 解决冲突后拥有唯一一次 append。

**把 evidence event 标记为 ignorable。** 拒绝，因为旧 reader 若跳过该事件，可能在不知道缺少 required proof 的情况下重建出实质上更弱的 replay-evidence model。

## Consequences

Durable log 现在可以区分 identity evidence 与可恢复 snapshot evidence，并且可以减少 snapshot-presence blockers，而不会声称 reproducible execution 已经存在。

旧日志仍然有效，只是继续保留两个 snapshot blockers。Session format version 不改变，因为这是普通 event-vocabulary growth；旧 reader 由 required unknown-event rule 保护，而不是静默跳过该事件。

运行时 capture seam 现在已经存在，但本阶段仍刻意不创建默认 environment 或 external-state snapshots，也不实现 reproducible executor。Runtime、configuration、tool、plugin、sandbox 或 external-state owner 可以贡献 identity 或 artifact reference，而无需把 durable-log ownership 移出 session layer。

## Verification

`packages/core/session/tests/replay.spec.ts` 固定 replay interpretation：identity-only evidence 不会清除 snapshot blockers；完整 snapshot references 只会留下 executor blocker；损坏的最新 evidence 会 fail closed；evidence 不会跨 request boundary 泄漏；inspection boundary 看不到未来 evidence；`ignorable` evidence 不能增强 reproducibility。

`packages/core/session/tests/reproducibility-evidence.spec.ts` 固定同一 capture boundary 的 collection semantics：validated merge、永久的 per-field conflict removal、非法输入 rejection 不改变已有状态，以及 sealing。

`packages/core/agent-loop/tests/reproducibility-evidence.spec.ts` 固定 runtime boundary：被引用的 header 已经 durable，而 provider dispatch 尚未发生；contributor failure 不会阻断请求；冲突字段 fail closed；最终为空的 capture 不会写 evidence record。
