# DeepSeek Harness — Oscar Fork

[English](README.md) | 中文

> 本仓库是 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的工程 fork，**不是 DeepSeek 官方发布版本**。

DeepSeek Harness（`dsh`）本身是一个开源 agent harness，采用**一切皆插件**的架构，并由 [Cordis](https://github.com/cordiverse/cordis) 驱动。这个 fork 保留上游架构，但把开发重点收敛到一个更具体的问题上：

**一个 agent runtime，能不能把执行、结果交付、replay 与评估证据做得足够精确，以至于我们能够诊断、复现并验证一次运行到底发生了什么？**

这个 fork 的目标不是堆叠大量产品功能，而是把 harness 强化成一个更可审计的执行底座：显式 accounting、持久化 evidence、可复现 replay、默认行为中性的 diagnostics，以及能够验证结果而不是只打印分数的 benchmark 基础设施。

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

### 已落到 `master`

- ✅ **Replay capability semantics** — 已将不同 replay 模式建模为具有不同 effect / snapshot 语义的能力。
- ✅ **历史请求重建** — 可以为 replay-oriented workflow 重建 canonical historical request snapshot。
- ✅ **Executor-driven simulated replay** — 已加入 caller-supplied executor seam，可执行 effect-free simulated replay。
- ✅ **Code Mode delivery-byte accounting** — 记录成功 sub-dispatch 实际交付的 canonical JSON 字节数，并显式保留 legacy unknown evidence。
- ✅ **Delivery admission accounting** — 将工具执行成功与结果 delivery/admission 分离，并记录明确的 delivery-rejection evidence。
- ✅ **累计结果字节预算** — Code Mode 可对单次 run 的已交付结果字节数施加累计预算，同时不混淆“执行成功”和“交付成功”。
- ✅ **DevTools execution summary** — trajectory inspection 已可展示持久化的 Code Mode execution accounting 与 delivery-byte evidence。
- ✅ **聚焦 runtime/fixture 覆盖** — Worker boot fixture 与 fork 自有测试已覆盖当前 binding/output budget contract。

### 当前工作流

以下分支均从当前 `master` baseline 切出。按本快照，它们仍指向同一个 baseline commit，因此下表描述的是**工作流范围**，不是已经完成并落地的功能。

| Branch | 范围 | 当前状态 |
| --- | --- | --- |
| `agent/execution-devtools-diagnostics` | 把现有 accounting/evidence 做成更强的 diagnostics，包括 `deliveryRejected`、字节统计、peak concurrency、unsettled/orphan dispatch 检测，以及按工具聚合的 execution summary。除非显式需要，否则不改变 runtime 行为。 | 工作流已开启；分支当前仍在 `master` baseline |
| `agent/offline-benchmark-validation` | 完善 benchmark harness 本身，包括 paired-result schema、fixture/deterministic replay、结果一致性校验、failure taxonomy、报告生成。 | 工作流已开启；分支当前仍在 `master` baseline |
| `agent/replay-reproducibility-evidence` | 继续强化 replay reproducibility，以及证明某次 replay 实际使用了哪些输入、snapshot、effect 与 output 所需的 evidence。 | 工作流已开启；分支当前仍在 `master` baseline |

## Roadmap

### P0 — 先让执行证据可信

- 保证 dispatch / execution / delivery accounting 显式且内部一致。
- 补齐 rejected delivery、byte accounting、concurrency、unsettled/orphan work 等诊断缺口。
- 让 per-tool execution summary 足够有用，使开发者不必手工阅读原始 event stream 才能解释一次 trajectory。

### P1 — 让 replay 真正可复现、可检查

- 继续收紧 historical request snapshot 与 replay input 的契约。
- 让 deterministic / effect-free replay 路径适合 fixture 与 regression test。
- 持久化足够的证据，明确区分“可复现 replay”和“只是从相似状态开始的 live fork”。

### P2 — 验证 benchmark harness 本身

- 定义带有显式 provenance 与 failure state 的 paired-result schema。
- 为 harness validation 建立 deterministic fixture / replay。
- 加入结果一致性校验与 failure taxonomy。
- 从经过验证的结果生成报告，而不是依赖 ad-hoc console output。

### P3 — 在保持上游兼容性的前提下整合

- 继续把改动放在清晰、可测试的 package/plugin seam 后面。
- 有意识地与上游同步/rebase，避免积累不必要的 fork-only 架构。
- 把稳定后的 diagnostics 与 replay contract 提炼成可复用的 developer tooling。

## 明确的非目标

这个 fork 不会把“基础设施已经存在”本身当成模型或 execution mode 优劣的证据。

- 不生成或包装伪造、合成的“benchmark 结果”并当成真实测量。
- 不因为新增了 accounting、replay 或 benchmark machinery，就推导 Code Mode 更好或更差。
- 不把 runtime 行为变化偷偷塞进 diagnostics 工作里。
- 不为了 fork 特有功能方便而重写上游的 everything-is-a-plugin / Cordis 架构。

未来如果要做性能或模式优劣结论，应该建立在可复现输入、经过校验的 paired result、显式 failure handling 与可检查报告之上。

## 上游架构

上游项目采用**一切皆插件**的架构，并由 [Cordis](https://github.com/cordiverse/cordis) 驱动，其设计参见论文 [_A Programming Paradigm for Spatiotemporal Composability_](https://github.com/cordiverse/paper)。

DeepSeek Harness 目前仍处于 developer preview 并快速迭代，因此应预期上游会继续出现破坏兼容性的变更。

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
