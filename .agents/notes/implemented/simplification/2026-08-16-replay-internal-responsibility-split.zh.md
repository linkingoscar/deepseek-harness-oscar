# Agent Note: Replay internal responsibility split

Status: implemented

中文 | [English](2026-08-16-replay-internal-responsibility-split.md)

## Problem

Replay 检查、请求级 reproducibility evidence 选择和无副作用 simulation 原本位于同一个源码模块中，但三者承担不同职责并具有不同失败语义。公共 API 本身很小，但后续 Replay 开发若继续集中在同一实现文件，会让 evidence 选择、capability policy 和 executor 处理互相牵连，并增加内部修改意外扩大 Replay 声明或泄漏 helper API 的风险。

## Decision

`packages/core/session/src/replay.ts` 作为公共 facade，继续 re-export 现有 Replay API。capability 派生与 boundary 校验位于 `replay-inspection.ts`，请求级 replacement evidence 选择位于 `replay-evidence.ts`，无副作用 executor 校验与执行位于 `replay-simulation.ts`。

这次拆分不新增 replay mode、blocker、durable event、snapshot resolver、environment restoration 路径或 reproducible executor。只要 `REPRODUCIBLE_EXECUTOR_NOT_IMPLEMENTED` 仍成立，`reproducible` 继续保持 unavailable；snapshot reference 也仍然只移除已有的 snapshot-presence blocker。

evidence selector 保持 fail-closed 的 replacement 语义：对于选中 request，最新记录如果是 ignorable 或 malformed，不会回退到更早的 valid 记录。内部 selector helper 不从 `replay.ts` re-export。

## Alternatives considered

**继续把所有 Replay 行为留在 `replay.ts`。** 不采用，因为 inspection policy、evidence replacement selection 和 simulation execution 的变化原因不同，而且已经拥有不同测试与失败语义。

**为每类职责新增公共 Replay subpath。** 不采用，因为当前没有 consumer 需要独立 package-level entry point；保留现有 facade 足够，也避免在内部 hardening 阶段扩大公共 API。

**拆分模块时顺便增加 snapshot resolution。** 不采用，因为 snapshot materialization 是新增 capability，不是结构重构；当前 Replay 语义刻意停留在 reproducible execution 之前。

## Consequences

Replay 代码获得更窄的职责归属，同时不改变可观察 Replay 语义。测试固定 facade exports、不可变 capability records、latest replacement fail-closed 行为、executor identity 校验、异步执行以及 executor 自有错误的传播。

后续 Replay 工作可以只修改对应职责，而无需同时打开无关 policy；任何新的 Replay capability 仍必须由独立的 evidence 与 execution justification 支撑，不能从这次文件拆分中推导出来。
