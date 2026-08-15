# Agent Note：Code Execution Diagnostics Summary

状态：implemented

[English](2026-08-15-code-execution-diagnostics-summary.md) | 中文

## 问题

Code Mode 已经持久记录 `tool/code-dispatch-start` / `tool/code-dispatch` 证据，`deriveCodeRunExecutionAccounting` 也已经能重建单次 run 内的事实，包括 delivery rejection、已测量的交付字节数、in-flight 峰值、未 settle 的 start、孤立 settle，以及按工具统计的计数。问题在于 DevTools 消费方仍需要各自重复做跨 run 聚合，容易出现字节精度处理不一致，或者把并发指标描述成证据实际上无法支持的“全局峰值”。

再增加一套 runtime ledger 或 scheduler observer 并不是正确方案。现有 durable event pair 已经是事实源，诊断能力不应改变 dispatch 行为。

## 决策

`@deepseek-ai/dsh-tools/execution-diagnostics` 新增 `summarizeCodeRunExecutionAccounting(runs)`，它只对现有 `CodeRunExecutionAccounting` 做纯粹的第二阶段 projection。该 summary 聚合 started、settled、failed、delivery-rejected、unsettled 与 orphan 计数，保留“已测量字节”和“缺少字节证据”的区别，并给出按工具聚合的 execution summary。

并发字段命名为 `maxRunPeakInFlight`。它只表示所有 run-local peak 中的最大值，刻意不称为 session/global concurrency peak，因为 run summary 已经丢失 run 之间的事件排序，无法据此重建多个 run 是否发生重叠。

已测量的 delivered-value bytes 与缺失的 byte evidence 始终分开表达。如果精确的 run 或 per-tool 字节小计在跨 run 聚合时无法再用 JavaScript safe integer 表示，对应 summary 的 `deliveredValueBytes` 返回 `null`，而不是伪造、截断或舍入一个总数。`unmeasuredDeliveredValues` 只继续表示上游成功结果本身缺少精确字节证据；聚合时的数值溢出不会增加这个计数。

当一个 run 的 accounting 至少包含一个 unsettled start 或 orphan settle 时，它计入 `runsWithIncompleteEvidence`。summary 会把这种证据质量问题直接暴露出来，而不是把它归一化掉。

package 通过稳定的 `./execution-diagnostics` 子路径暴露这个纯 summary，并直接指向现有 TypeScript build output。agent-loop、scheduler、tool execution、admission 与 session persistence 路径均不修改。

## 考虑过的替代方案

**直接从 live scheduler state 派生 diagnostics。** 否决，因为这会建立第二条观测路径，其生命周期与竞态语义会和 durable event 事实源不同。

**把最大 run peak 称为 global/session peak。** 否决，因为独立 summary 的多个 run 可能彼此重叠，而跨 run 事件顺序已经丢失。

**把字节溢出强制压成一个 number。** 否决，因为饱和、舍入或部分小计都会让 DevTools 消费者误以为该数字仍然精确。显式 `null` 可以保留“无法表示”和“源证据缺失”之间的区别。

## 后果

DevTools 可以使用一个稳定的 summary 形状观察 Code Mode execution health，同时不扰动 runtime 行为。残缺或切片后的 durable evidence 仍然可见，delivery rejection 与工具失败保持独立，byte accounting 的精度状态也被明确表达。

该 summary 无法仅凭 run aggregate 重建真正的全局并发峰值。未来如果需要 global concurrency view，必须使用有序的 durable dispatch events，而不能只依赖这个第二阶段 summary。

单元测试覆盖空证据、跨 run/per-tool 聚合、残缺证据、delivery rejection、run-local peak 语义，以及 safe-integer byte overflow。
