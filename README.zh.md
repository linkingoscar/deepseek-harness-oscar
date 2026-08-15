# DeepSeek Harness — Oscar Fork

[English](README.md) | 中文

> 本仓库是 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的工程 fork，**不是 DeepSeek 官方发布版本**。

DeepSeek Harness（`dsh`）本身是一个开源 agent harness，采用**一切皆插件**的架构，并由 [Cordis](https://github.com/cordiverse/cordis) 驱动。这个 fork 保留上游架构，但把开发重点收敛到一个更具体的问题上：

**一个 agent runtime，能不能把执行、结果交付、replay 与评估证据做得足够精确，以至于我们能够诊断、复现并验证一次运行到底发生了什么？**

这个 fork 的目标不是堆叠大量产品功能，而是把 harness 强化成一个更可审计的执行底座：显式 accounting、持久化 evidence、可复现 replay、默认行为中性的 diagnostics，以及能够验证结果而不是只打印分数的 benchmark 基础设施。

项目页面：**https://linkingoscar.github.io/deepseek-harness-oscar/**

## Fork 开发思想

当前开发围绕六条原则展开：

1. **先有证据，再做解释。** 在对一次运行下结论之前，先持久化足够解释它的事实。
2. **执行成功和结果成功交付是两件事。** 工具可以执行成功，但其结果仍可能被拒绝、截断、无法计量，或者没有被重新送回模型上下文；accounting 必须保留这层区别。
3. **测量默认不应改变行为。** diagnostics 与 accounting 的默认职责是观察 runtime，而不是悄悄修改 runtime。
4. **Replay 是契约，不是一个按钮。** live-fork replay、reproducible replay 与 effect-free simulated replay 的语义不同，必须显式区分。
5. **Benchmark 基础设施本身必须可审计。** paired result、fixture、deterministic replay、一致性校验、failure taxonomy 与报告生成，比先产出一个 headline score 更重要。
6. **优先做小而清晰、可上游化的 seam。** 尽量沿用现有 plugin/runtime 架构扩展，而不是在 fork 里制造新的 privileged core。

## 当前开发进度

状态快照：**2026-08-15**。

第一阶段的三条并行开发线现在已经**全部落到 `master`**。项目已经从并行功能建设切换到 integration、validation 和 evidence-driven experimentation 阶段。

### 已落地主干的基础能力

- ✅ **Replay capability semantics** — 已将不同 replay 模式建模为具有不同 effect / snapshot 语义的能力。
- ✅ **历史请求重建** — 可以为 replay-oriented workflow 重建 canonical historical request snapshot。
- ✅ **Executor-driven simulated replay** — 已加入 caller-supplied executor seam，可执行 effect-free simulated replay。
- ✅ **Code Mode delivery-byte accounting** — 记录成功 sub-dispatch 实际交付的 canonical JSON 字节数，并显式保留 legacy unknown evidence。
- ✅ **Delivery admission accounting** — 将工具执行成功与结果 delivery/admission 分离，并记录明确的 delivery-rejection evidence。
- ✅ **累计结果字节预算** — Code Mode 可对单次 run 的已交付结果字节数施加累计预算，同时不混淆“执行成功”和“交付成功”。
- ✅ **聚焦 runtime/fixture 覆盖** — Worker boot fixture 与 fork 自有测试已覆盖当前 binding/output budget contract。

### 已完成的三条并行开发线

| Workstream | 已交付能力 | 状态 |
| --- | --- | --- |
| `agent/replay-reproducibility-evidence` | 持久化 request-scoped reproducibility evidence，记录 replay 实际使用的 input / snapshot / effect context，并避免把 live fork 与 reproducible replay 混为一谈。 | ✅ PR #17 已合并 |
| `agent/execution-devtools-diagnostics` | 基于既有 durable accounting 纯派生 diagnostics，覆盖 `deliveryRejected`、measured/unmeasured byte accounting、run-local peak concurrency、unsettled/orphan dispatch、incomplete evidence 与 per-tool summary。 | ✅ PR #18 已合并；publication constraint 由 PR #20 补齐 |
| `agent/offline-benchmark-validation` | versioned paired-result validation、semantic task fingerprint、deterministic offline fixture/replay、failure taxonomy、一致性校验与中性的 Markdown 报告生成。 | ✅ PR #19 已合并 |

Benchmark 最终集成经过 fork CI 验证：**35/35 static gates 全部通过**，同时 benchmark、execution accounting、delivery-byte、admission、replay 与 trajectory focused tests 也全部通过。

## 现在这个 fork 能证明什么

这一阶段做的核心不是“得出产品结论”，而是提高证据质量。

### Execution

runtime 可以保留一次 tool dispatch 的 started、settled、failed，以及结果是否成功 delivery/admission 的区别。diagnostics 可以从 durable facts 做聚合，而不改变 scheduler 行为。

### Delivery 与 bytes

Code Mode accounting 可以区分 measured delivery bytes 与 unknown evidence，记录 delivery rejection，并对累计 delivered-result budget 做推导，而不会把“执行成功”等同于“结果进入模型上下文”。

### Replay

Replay-oriented flow 可以重建历史请求输入，并保留 request-scoped reproducibility evidence。这个 fork 会继续明确区分 live-fork semantics、reproducible replay 与 effect-free simulated replay。

### Benchmark validation

Offline benchmark harness 现在把 observation 当成带版本的 evidence 来处理：它会校验 result-set invariant，默认要求严格 paired observation，记录 failure transition，支持 deterministic fixture replay，并从已记录 observation 生成描述性报告。

**它不会制造伪 benchmark observation，也不会自动推导 Code Mode 或某一种配置更优。**

## 下一阶段

接下来不是继续为了“有更多 feature”而扩三条支线，而是把已经进入 `master` 的能力整合起来，并开始用它们做可复核的实验。

### P0 — 整合 developer diagnostics

- 把 execution summary、replay evidence 与 trajectory inspection 串成一致的 debugging workflow。
- durable evidence 只支持 run-local claim 时，就不把它包装成 global/session claim。
- 提高可发现性，但不把策略判断偷偷塞进 diagnostics 层。

### P1 — 开始做可复现实验

- 真实 benchmark 使用可追溯输入与经过校验的 paired result。
- 保留 raw observation、failure taxonomy、fixture provenance 与 report，确保结果可检查。
- 把结论留在 experiment 层，而不是让 benchmark harness 隐式替用户排名。

### P2 — 持续保持上游兼容

- 有意识地与 upstream rebase/sync，避免积累不必要的 fork-only 架构。
- 优先保持小而清晰的 package/plugin seam，以及默认行为中性的 instrumentation。
- 对已经证明有价值的 evidence contract，再考虑提升为更通用的 developer tooling。

## 明确的非目标

这个 fork 不会把“基础设施已经存在”本身当成模型或 execution mode 优劣的证据。

- 不生成或包装伪造、合成的“benchmark 结果”并当成真实测量。
- 不因为新增了 accounting、replay 或 benchmark machinery，就推导 Code Mode 更好或更差。
- 不把 runtime 行为变化偷偷塞进 diagnostics 工作里。
- 不为了 fork 特有功能方便而重写上游的 everything-is-a-plugin / Cordis 架构。

未来如果要做性能或模式优劣结论，应该建立在可复现输入、经过校验的 paired result、显式 failure handling 与可检查报告之上。

## 上游架构

上游项目采用**一切皆插件**的架构，并由 [Cordis](https://github.com/cordiverse/cordis) 驱动，其设计参见论文 [_A Programming Paradigm for Spatiotemporal Composability_](https://github.com/cordiverse/paper)。

DeepSeek Harness 是一个快速演进的 developer-oriented 项目，因此 upstream compatibility 应该被视为持续的工程工作，而不是一次性的 migration。

## 运行

### 运行上游 npm 发布版本

安装 `Node.js` 后运行：

```sh
npx @deepseek-ai/dsh web
```

这会运行上游发布的 npm 包，并默认在 `http://127.0.0.1:3080` 启动 Web UI。详见 [Web UI 指南](docs/user/guide/index.md)。

<a id="run-from-source"></a>

### 从源码运行当前 fork

```sh
git clone https://github.com/linkingoscar/deepseek-harness-oscar.git
cd deepseek-harness-oscar
pnpm install
pnpm run build
pnpm dsh web
```

## 开发

请先阅读[开发指南](docs/development.md)与[架构文档](docs/architecture.md)。

面向 agent 的开发请遵循 [AGENTS.md](AGENTS.md)。Fork 内的工作应尽量把 evidence contract、测试和 runtime semantic change 分开，使 diagnostics 改进可以独立于行为变化进行审查。

## 上游、社区与贡献

本 fork 基于 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)。上游项目的支持与社区资源请参考其仓库及 [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions)。

仓库贡献规范参见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可证

[MIT](LICENSE)

第三方依赖及其许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
