# Agent Note: Trajectory 中的请求 Envelope 上下文调试器

Status: implemented

[English](2026-08-14-trajectory-context-debugger.md) | 中文

## Problem

Trajectory 已经可以重建请求计时、token 用量、请求选项、system prompt 变更、工具 schema 变更和事件记录表，但这些信息主要为检查单条选中记录而组织。对于另一类跨请求调试问题，现有界面不够直接：哪个请求的 prompt envelope 在膨胀，增长来自 system prompt 还是工具 schema，哪个工具 schema 占据最大表面，以及 provider 报告的输入是否随之变化。

一个简单粗暴的实现可能会用字符数估算 token，或者持久化另一份完整会话的 trace projection。这两种做法都会削弱现有契约。字符到 token 的换算依赖 provider/tokenizer，也无法归因消息历史；`sessionProjection` 面向有界的 UI 级 whole value，持续增长的请求时间线会随值增长被反复发送，同时复制 Trajectory 已经重建出的请求事实。

## Decision

`@deepseek-ai/dsh-client-ui-trajectory` 保留唯一且稳定的外层 `Trajectory` 会话标签页，在其中增加浏览器侧的内部模式切换：现有事件记录表和 Context 上下文调试器。Context 直接读取记录表已经使用的、有界的 `TrajectorySnapshot.requests` request-inspection 窗口。它不增加 persistence event、projection key、service、模型可见文本或第二条 durable state 路径。

对于每个已加载且具有重建 `ConversationPromptSnapshot` 的 assistant request，调试器显示：

- system prompt 字符数；
- 模型可见工具数量；
- 完整工具 schema 数组紧凑 JSON 的字符数；
- 以紧凑 JSON 字符数计最大的单个工具 schema；
- prompt envelope 是初始、system 变更、tools 变更、两者同时变更，还是沿用上一请求；
- 当 usage 存在时，provider 报告的请求输入 token。

展开一行可以查看精确重建的 system 字符串与工具目录。字符 footprint 与 provider token 用量被刻意作为两种独立测量并列展示；UI 不会在两者之间做换算，也不会声称已经对消息历史 token 做了归因。

外层 conversation slot 继续保持 `id: 'trajectory'`；Context 是内部 segmented mode，而不是第二个 `conversation.view` 条目。这样保留既有 Chat/Trajectory 导航、slot 顺序、可访问性语义和 session-scoped injection 行为。

## Alternatives considered

**新增一个持续增长、包含请求时间线的 session projection。** 拒绝，因为 request inspection 已经能够重建这些事实，而 `sessionProjection` whole value 的设计目标是有界 UI 状态，不是 append-only history。复制时间线既增加传输成本，也制造第二个事实来源。

**根据 system/tool 字符数估算 prompt token。** 拒绝，因为 tokenizer 行为随 provider/model 变化，而且请求中的消息历史并不包含在 system/tool envelope 中。精确字符/JSON footprint 是有价值的证据；伪造 token 精度不是。

**增加第二个顶层 Context 会话标签页。** 拒绝，因为 Context 属于 Trajectory 调试能力，而不是独立产品表面。第二个 slot 条目会改变稳定的 Chat/Trajectory 导航，并让现有 tab 语义更嘈杂。

**修改 agent loop 或请求组装流程以发送新的 debugger event。** 拒绝，因为 `request/header`、request inspection 和 provider usage 已经包含所需事实。浏览器工具应当从 durable state 派生，而不是为了可观测性扰动模型执行。

## Consequences

开发者可以在当前已加载请求窗口内直接比较 prompt-envelope 的增长，而不需要逐个打开 System 记录。工具 schema 膨胀既能从整体 schema 表面看到，也能通过最大单工具异常值定位；provider 输入用量则并列提供相关性观察。

调试器受普通 Trajectory 历史加载边界约束。更早的请求只有在对应历史被加载后才会出现，因此沿用既有 paging 与内存模型。Context 模式不会独立加载更早页面。

这个功能仍然不能回答 provider token 中有多少来自 system prompt、tools、user/assistant history、注入上下文或 compaction summary。未来若要做精确归因，必须使用 adapter/tokenizer-aware accounting 或其他精确来源，不应把字符启发式重新包装进该视图。
