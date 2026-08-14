# Agent Note：上下文归因证据契约

状态：已实施

[English](2026-08-14-context-attribution-evidence-contract.md) | 中文

## 问题

Harness 现在同时暴露三类不同的上下文证据：Trajectory 中可重建的请求 envelope 结构、provider 返回的聚合 usage，以及 token-meter 中启发式估算的组件 token。它们回答的问题不同，不能表现得像拥有同等精度。

尤其是，一次请求可以拥有精确的 system 字符串和精确的 tool-schema JSON 表面，同时 provider 只返回一个聚合 input-token 总数。这两者的变化相关并不等于组件归因。同样，token-meter 的固定密度估算对于压力和 compaction 决策有用，但它不是 provider tokenizer 的结果。

如果没有明确的证据契约，debugger 或 benchmark 很容易把估算重新包装成“精确 token”，从相邻总量推断因果，或者把不同 accounting 语义的 provider 直接比较。

## 决策

每一个上下文/token 测量值都必须属于下面三类证据之一。

### 1. 精确可重建证据

当 Harness 自己持久拥有某个值依赖的字节或结构化数据，并且计算过程中没有引入 tokenizer/model 假设时，该值属于 **精确可重建（exact reconstructable）**。

当前例子包括：

- `request/header` 的 system-prompt 字符数；
- tool-schema 紧凑序列化后的字符数和工具数量；
- 这些值在相邻请求之间的变化；
- 工具新增/删除及单工具序列化 schema 的增长；
- durable request/turn/step/tool lifecycle 的身份和顺序。

这里的“精确”是相对于 Harness 自己拥有的表示而言，**不代表 provider token 精确**。在 Harness 边界之后，provider 仍可能应用 chat template、转义、规范化、隐藏指令或其他序列化。

### 2. Provider 返回证据

当一个值来自 provider 响应（可以经过 adapter 规范化），但 Harness 无法独立重建其组件 accounting 时，该值属于 **provider-reported**。

当前例子包括：

- 聚合 input/output usage；
- provider 暴露时的 cache-read/cache-write usage；
- provider 暴露时的 reasoning usage；
- 从相邻 provider 总量计算出的 request-input delta。

对于 provider 自己的 billing/accounting 语义，provider-reported 总量是权威证据，但应遵守 adapter 已记录的规范化规则。它并不能证明某一段 system prompt、tool schema、message 或 tool result 消耗了这些 token 中的某个具体子集。

### 3. 估算证据

当一个值依赖无法保证复现 provider tokenization 的 heuristic 或近似时，该值属于 **Estimated**。

`@deepseek-ai/dsh-token-meter` 当前的组件定价属于这一类。`estimate.ts` 使用固定的 4 characters/token 密度并叠加结构开销。因此，即使同一 session 的其他位置存在 provider aggregate usage，`contextBreakdown` 对 system/tools/messages 的拆分仍然只是估算。

只要明确标注，Estimated 值可以用于相对压力、局部策略和诊断；它们不能被当作 billing truth、精确组件归因，也不能作为 provider 总量的 reconciliation oracle。

## 精确组件 token 归因门槛

一个 provider/model route 只有存在下面两条证明路径之一时，才允许暴露 **exact component-token attribution**：

1. **Provider itemization：** provider 直接返回组件级 token 计数，并且语义足以把计数映射到 Harness 组件；或
2. **可复现的 provider tokenization：** adapter 掌握最终 provider 可见序列化，掌握或固定所选 provider/model revision 的精确 tokenizer/chat-template 行为，能够识别包含 framing/hidden wrapper 成本在内的稳定组件 span，并能在相同 cache 语义下把重建总量与 provider 返回的 request usage 严格 reconciliation。

第二条路径必须同时满足：

- 在所有 adapter/SDK 转换之后，最终 provider 可见的 request 表示是可观察的；
- 已知的是 model-specific tokenizer 和 chat-template revision，而不是根据模型家族名称猜测；
- provider 添加的 framing 或隐藏 prompt 要么已知并能分配，要么进入明确的 `provider_overhead` bucket；
- cache hit/write accounting 与 provider report 使用同一套互斥语义；
- 组件 token 加显式 overhead 必须在代表性 conformance corpus 上与 provider 总量完全一致，覆盖 CJK、大型 JSON schema、tool call/result、空内容、reasoning passback 和 cache-hit 场景；
- 只要出现 mismatch，该 route 就必须降级为 provider-reported totals + estimated components。不能把差额静默摊到组件上。

仅仅拥有 tokenizer library 不够。对 provider 序列化之前的 Harness 字符串做 tokenization，并不能证明 provider 最终统计的内容。

## 当前能力矩阵

### DeepSeek 直连 chat-completions adapter

直连 adapter 掌握 `serializeRequest()`，因此知道 Harness 实际提交的最终 JSON request body。它还会把 DeepSeek 的 `prompt_tokens`、cache-hit 字段、completion tokens 和 reasoning tokens 映射到 Harness 互斥的 `TokenUsage` 语义。

但是，仓库并不掌握 provider 对具体模型使用的精确 tokenizer/chat-template 行为，DeepSeek usage 也只是 aggregate，而不是 system/tools/messages 组件级 itemization。因此 server-side framing 和 tokenization 仍然处在可观察边界之外。

**分类：** request surface 精确；aggregate token 为 provider-reported；组件 token 为 estimated。当前不具备 exact component-token attribution 资格。

### pi-ai-backed providers

Harness 把请求转换为 pi-ai 的高层 `Context`，然后调用 `Models.streamSimple()`。provider-specific 最终序列化发生在外部 pi-ai provider 实现内部，已经越过 Harness adapter 的可观察边界。pi-ai 会返回 aggregate input/output/cache usage，Harness 再做规范化，但不会提供可重建的 per-component token ledger。

**分类：** Harness/pi-ai context surface 精确；aggregate token 为 provider/SDK-reported；组件 token 为 estimated。当前不具备 exact component-token attribution 资格。

## 产品与 benchmark 规则

- Context Debugger 可以把精确字符/schema footprint 与 provider-reported request input 并列展示，但 UI 必须在视觉和语义上区分它们的证据等级。
- 没有组件级证据时，request-input delta 绝不能归因给 system/tool-schema delta；conversation history、provider framing、cache 和 tokenizer 行为也可能发生变化。
- Benchmark 可以同时比较 exact surface metrics 与 provider-reported token metrics。surface 下降只能证明 Harness 可见 envelope 更小，不能证明 token 等量下降。
- `contextBreakdown` 的值只要以组件 token 形式暴露，就必须被标注/处理为 estimate。
- 不应为了 attribution 在 `sessionProjection` 中新增持续增长的 whole-session timeline；应继续优先使用 bounded request inspection 和 durable source events。

## 后果

这个 fork 明确接受一个暂时的能力缺口：它可以诊断 Harness 自己拥有的 context surface 在哪里增长，也可以观察 provider aggregate input 如何变化，但当前还不能精确回答每个组件分别消耗了多少 provider token。

这个缺口比伪精度更好。未来的 provider 工作应该先在 adapter 边界增加 attribution proof surface，并建立 conformance/reconciliation suite。只有通过上述门槛的 route，才允许把组件标签从 estimated 升级成 exact。

在此之前，优化策略应该针对不同决策使用最强、但不过度声明的证据：结构诊断使用 exact surface/provenance，成本/usage 比较使用 provider totals，近似压力或 compaction policy 使用 token-meter estimates。