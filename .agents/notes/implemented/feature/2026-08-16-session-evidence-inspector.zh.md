# Agent Note: Session Evidence Inspector

Status: implemented

[English](2026-08-16-session-evidence-inspector.md) | 中文

## Problem

Execution accounting、Code Mode diagnostics 和 replay inspection 已经能够派生解释 session 所需的 durable facts，但开发者工具仍需要分别调用并理解这些 projection。让每个消费方重复组合这些结果，会让 byte handling、replay availability 的表述或 concurrency scope 逐渐漂移，即使底层 evidence 本身已经有明确的权威来源。

缺少的是针对同一个 event-log prefix 的统一只读视图。它需要提高 discoverability，同时不能创建新的 evidence source，也不能把为了展示方便而增加的字段变成更强的 runtime claim。

## Decision

`@deepseek-ai/dsh-session-query/evidence-inspector` 导出 `readSessionEvidence(sessionId, events, options?)`。该函数接收调用方已经取得的有序 session event log，并为全部派生输出选择同一个包含端点 boundary。

`execution` 部分就是现有 `summarizeCodeRunExecutionAccounting(deriveCodeRunExecutionAccounting(prefix))` 的结果。因此它原样保留 started、settled、failed、delivery-rejected、measured/unmeasured delivery bytes、`maxRunPeakInFlight`、unsettled starts、orphan settles、incomplete-run counts 和 per-tool summaries，而不重新定义任何 metric。

`replay` 部分把 capability 判定交给 `inspectReplayCapabilities`。它暴露最新可重建 request header、现有 request-reconstruction、simulated、live-fork 与 reproducible capability records，以及经过验证后选中的 reproducibility-evidence record 和两类 snapshot reference 的存在性布尔 projection。最新 evidence replacement 损坏时仍按原 replay inspection 逻辑 fail closed，因为 evidence selection 的所有权没有迁移到 inspector。

`session` 部分记录传入的 session id、选定 boundary、选定 event count、source kind，以及现有 `stableForkBoundary` 结果。直接检查 event log 时，`sourceKind` 默认是 `supplied-log`；如果调用方已经知道此次 observation 来自 live 或 persisted source，可以显式传入这个事实。Inspector 不从 events 推断 storage provenance，因为 event stream 本身不包含这种证明。

该 projection 没有 version 字段，也没有 persistence representation。它不追加 session event、不定义 diagnostics metric、replay blocker、replay mode 或 reproducibility evidence field，也不执行 model 或 tool。

## Evidence boundaries

`maxRunPeakInFlight` 继续表示各 run-local peak 中的最大值。Inspector 不把它重命名或重新解释成 session-wide/global peak concurrency，因为现有 run summary 不保留足够的跨 run ordering evidence 来证明这种结论。

Measured delivered-value bytes 保留现有 diagnostics 的 overflow 规则：如果精确的 safe-integer 小计无法再表示为一个 JavaScript safe integer，则 `deliveredValueBytes` 为 `null`。聚合溢出不会增加 `unmeasuredDeliveredValues`；后者仍只表示在 run-accounting 阶段，上游 outcome 本身缺少或无法精确表示 byte evidence。

Snapshot-reference presence 只从针对最新可重建 request 选中的已验证 evidence record 派生。Identity fingerprint 不算 snapshot，inspector 自身也不会移除或新增 reproducibility blocker。

## Alternatives considered

**新增 inspector event 或持久化 projection。** 否决，因为 execution 与 replay facts 已经有 durable owner。第二套存储表示只会带来同步和迁移义务，却不会增加 evidence。

**在 `session-query` 内重新实现 execution 和 replay fold。** 否决，因为重复 derivation 会制造第二个 semantics owner，并可能与 delivery-byte、incomplete-evidence 或 replay fail-closed 行为产生漂移。

**为了方便增加 `globalPeakConcurrency` 字段。** 否决，因为现有 durable summary 无法证明多个 run 的跨 run overlap。继续使用 `maxRunPeakInFlight` 才能保持当前 evidence 实际支持的精确作用域。

**把 fingerprint 或更旧的有效 replay evidence 当作 fallback proof。** 否决，因为 replay 已经区分 identity 与可恢复 snapshot，并且最新匹配 evidence 损坏时有意 fail closed。Inspector 继承这个决定，而不是削弱它。

## Consequences

开发者工具可以消费一个确定性的对象，同时获得 session selection、Code Mode execution diagnostics 与 replay readiness，并保留现有语义 owner。Deterministic fixtures 覆盖 empty log、可重建 request、正常与失败的 Code Mode dispatch、delivery rejection、unmeasured bytes、unsettled/orphan dispatch、aggregate byte overflow、replay evidence presence/absence、malformed latest evidence 和 prefix selection，全程不需要真实 model call。

直接 API 要求调用方提供 event log，因此无法自行证明该日志来自 live 还是 persisted session。这个限制通过 `sourceKind` 显式表达；后续如果把 source resolution 集成进 `SessionQueryEngine`，只需传入已经确定的 source fact，而不需要改变 inspector 的 evidence 语义。
