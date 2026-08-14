# Agent Note: 上下文归因证据契约

Status: implemented

[English](2026-08-14-context-attribution-evidence-contract.md) | 中文

## 问题

Harness 同时暴露了几类看上去可以直接比较、但来源和精度并不相同的上下文证据。Trajectory 可以重建 Harness 自己拥有的 request-envelope 结构；provider adapter 可以返回 provider 或 SDK 报告的 aggregate usage；token-meter 可以用启发式方法估算组件压力。如果把它们当成同一种证据，debugger 或 benchmark 就会表现出底层事实并不支持的“精确度”。

最危险的是归因。一次请求可以拥有精确可重建的 system 字符串和 tool-schema JSON 表面，而 provider 只返回一个聚合 input-token 数字。即使两者在相邻请求中同时变化，也不能证明某一段 surface 变化造成了某个具体 token delta。Conversation history、provider framing、隐藏指令、cache 语义、serializer 行为和 tokenizer 行为都可能同时变化。

同样的边界也影响运行时决策。token-meter 的固定密度估算很适合 compaction 和相对压力判断，但它不是 provider tokenization；provider aggregate 很适合 accounting 对比，但它不是 per-component ledger。如果没有明确契约，下游 UI 和 benchmark 很容易把较弱的证据静默升级成更强的结论。

## 决策

每一个 context/token 测量值都必须按照实际拥有的最强证据分类。Harness 采用三种证据等级，不能因为附近存在更强信号，就把某个值自动升级。

### 精确可重建证据

当 Harness 持久拥有某个值依赖的字节或结构化数据，并且计算过程没有引入 tokenizer/model 假设时，该值属于 **exact reconstructable**。

当前例子包括：

- `request/header` 的 system-prompt 字符数；
- tool-schema 紧凑序列化后的字符数和工具数量；
- 这些 Harness-owned 值在请求之间的变化；
- 工具新增/删除及单工具序列化 schema 的增长；
- durable request/turn/step/tool lifecycle 的身份和顺序。

这里的“精确”只针对 Harness 自己拥有的表示，**不代表精确 provider token**。越过 Harness 边界之后，provider 仍可能增加 chat template、转义、规范化、隐藏指令、framing 或其他序列化。

### Provider 返回证据

当一个值来自 provider 或 provider SDK 的响应，可以经过 adapter 规范化，但 Harness 无法独立重建 provider 的组件 accounting 时，该值属于 **provider reported**。

当前例子包括：

- 聚合 input/output usage；
- provider 暴露时的 cache-read/cache-write usage；
- provider 暴露时的 reasoning usage；
- 从相邻 provider totals 推导的 request-input delta。

Provider-reported 值对于已记录的 provider/adapter accounting vocabulary 是权威证据，但它不能证明某一段 system prompt、tool schema、message、tool result 或 provider-owned wrapper 分别占了多少 token。

### 估算证据

当一个值依赖无法保证复现 provider tokenization 的 heuristic 或 approximation 时，该值属于 **estimated**。

`@deepseek-ai/dsh-token-meter` 当前的组件定价属于这一类。`estimate.ts` 使用固定四字符/token 密度并叠加结构开销。因此，即使同一 session 的其他位置存在 provider aggregate usage，`contextBreakdown` 对 system/tools/messages 的拆分仍然只是估算。

Estimated 值可以用于相对压力、局部策略和诊断，但必须明确标注。它们不是 billing truth、精确组件归因，也不能作为 provider totals 的 reconciliation oracle。

## 精确组件 token 归因门槛

一个 provider/model route 只有存在下面两条证明路径之一时，才允许暴露 **exact component-token attribution**：

1. **Provider itemization。** Provider 直接返回组件级计数，并且其语义足以映射到 Harness 组件。
2. **可复现 provider tokenization。** Adapter 掌握最终 provider 可见序列化，掌握或固定所选 provider/model revision 的精确 tokenizer/chat-template 行为，能够识别包含 framing/hidden wrapper 成本在内的稳定组件 span，并能在相同 cache 语义下把重建总量与 provider-reported request usage 严格 reconciliation。

第二条路径必须同时满足：

- 所有 adapter/SDK transform 之后的最终 provider-visible request 表示是可观察的；
- 已知的是 model-specific tokenizer 和 chat-template revision，而不是根据模型家族名称推断；
- provider 添加的 framing 或隐藏内容要么能够分配，要么进入明确的 `provider_overhead` bucket；
- cache-hit/write accounting 与 provider report 使用相同的互斥语义；
- 组件 token 加显式 overhead 必须在代表性 conformance corpus 上与 provider totals 完全一致，覆盖 CJK、大型 JSON schema、tool call/result、空内容、reasoning passback 和 cache-hit 场景；
- 一旦出现 mismatch，该 route 就降级为 provider-reported totals + estimated components，而不是启发式摊平差额。

仅仅拥有 tokenizer library 不够。对 provider 序列化之前的 Harness 字符串做 tokenization，不能证明 provider 最终统计的内容。

## 当前能力矩阵

### DeepSeek 直连 chat-completions adapter

直连 adapter 掌握 `serializeRequest()`，因此知道 Harness 提交的最终 JSON request body。它也会把 DeepSeek 的 prompt、cache、completion 和 reasoning usage 映射到 Harness 的 `TokenUsage` vocabulary。

但是仓库并不掌握 provider 针对具体模型使用的精确 tokenizer/chat-template 行为，provider usage 也是 aggregate，而不是 system/tools/messages itemization。Server-side framing 和 tokenization 仍处于可观察边界之外。

**分类：** request surface 精确；aggregate token 为 provider-reported；组件 token 为 estimated。当前不具备 exact component-token attribution 资格。

### pi-ai-backed providers

Harness 把请求转换为 pi-ai 的高层 `Context`，然后调用 `Models.streamSimple()`。provider-specific 最终序列化发生在外部 pi-ai provider 实现内部，已经越过 Harness adapter 的可观察边界。pi-ai 返回 aggregate usage，Harness 再做规范化，但不会提供可重建的 per-component token ledger。

**分类：** Harness/pi-ai context surface 精确；aggregate token 为 provider/SDK-reported；组件 token 为 estimated。当前不具备 exact component-token attribution 资格。

## 产品与 benchmark 不变量

- Context Debugger 可以把精确字符/schema footprint 与 provider-reported request input 并列展示，但必须在视觉和语义上保持证据等级区分。
- 没有组件级证据时，request-input delta 绝不能归因给 system/tool-schema delta。
- Benchmark 可以并列比较 exact surface metrics 和 provider-reported token metrics；surface 下降只证明 Harness-visible envelope 更小。
- `contextBreakdown` 只要以组件 token 形式暴露，就必须持续被标注和处理为 estimated。
- Attribution 不应在 `sessionProjection` 中增加第二套持续增长的 whole-session telemetry ledger；仍以 bounded request inspection 和 durable source events 为读取路径。
- 只有 provider-specific pricing/accounting adapter 真正提供 billing 语义时，字段名才可以暗示 billing。

## 考虑过的替代方案

**按比例把 provider input tokens 分摊给可见组件。** 拒绝。这个分配在数学上很整齐，但证据上是假的。Provider framing、history、cache、隐藏内容和 tokenizer 行为都没有足够可观察性支撑这种拆分。

**只要 adapter 掌握 JSON request body，就把 token-meter 结果视为精确。** 拒绝。掌握 provider 之前的序列化，不等于掌握 provider tokenization 或 chat-template 行为，而这些差异恰恰在跨 provider 场景中最重要。

**完全移除组件估算，只显示 provider totals。** 拒绝。Estimated component pressure 对 compaction、prompt-shape 诊断和局部策略依然有实际价值。要求是诚实标注，而不是抛弃较弱但有用的证据。

**不建立统一 taxonomy，由每个 consumer 自己写 caveat。** 拒绝。真正的风险是多个 surface 之间语义逐渐漂移。共享契约比反复审计每个 debugger、benchmark 和未来优化策略更可靠。

## 后果

这个 fork 明确接受一个暂时能力缺口：它可以诊断 Harness 自己拥有的 context surface 在哪里增长，也可以观察 provider aggregate usage 如何变化，但当前不能精确回答每个组件分别消耗了多少 provider token。

这个限制是刻意保留的。它阻止伪精度，也给未来 provider 工作提供了清晰升级路径：在 adapter 边界增加 attribution proof surface，建立 conformance/reconciliation suite，只对真正通过门槛的 route 提升组件证据等级。

这个契约也约束后续产品开发。Context 工具必须携带 provenance，benchmark 字段名必须反映真实证据而不是理想语义，execution/runtime 优化必须使用当前最强证据进行评估，同时不能把 estimate 洗成 fact。它不如“合成精确度”显眼，但更适合一个要长期演进成 agent runtime 和 agent laboratory 的 Harness。
