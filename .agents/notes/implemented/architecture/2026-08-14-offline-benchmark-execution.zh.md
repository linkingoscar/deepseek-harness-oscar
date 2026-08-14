# Agent Note：离线 Benchmark 执行基础

状态：已实施

[English](2026-08-14-offline-benchmark-execution.md) | 中文

## 开发意图

这个 fork 仍处于纯开发阶段。当前目标不是依靠外部 benchmark 数据证明“比别人强”，而是先把 Harness 本身做成更强的 runtime，以及更可靠的 agent 实验平台。

因此这一阶段的开发规则是：

1. 优先构建可以在本地验证的 runtime、execution plane、replay、observability 和实验基础设施；
2. 严格区分 Harness 自己拥有的精确证据、provider 返回的 usage，以及启发式估算；
3. 在真实 workload 到来之前，先保证实验本身可重复；
4. 阶段性成果通过仓库 CI 后允许合并；
5. 不在缺少外部数据时制造性能结论。

本说明中的工作不依赖任何外部 benchmark corpus 或真实 provider 执行。

## 已完成工作

### 上下文归因证据契约

前一个架构 checkpoint 已明确三类证据：精确可重建的 Harness 表面事实、provider-reported usage，以及 estimated 组件测量。Benchmark 和 debugger 必须保留这些证据等级，不能把方便的聚合值包装成伪精确结论。

### Native / Code Mode counterbalanced 规划

`scripts/dsh_bench_plan.py` 新增了确定性的 native/Code Mode 成对执行计划。

对于每一个 `(task, repetition)`：

- native 和 Code Mode 各执行一次；
- 两个 variant 始终相邻；
- 谁先执行会随 task index 和 repetition 交替。

这样可以避免默认实验形态变成“先跑完整批 native，再跑完整批 Code Mode”，从而降低时间漂移、workspace 状态和执行顺序带来的额外偏差。

### 独立的成对执行器

`scripts/dsh_bench_compare_modes_offline.py` 没有重新造一套 benchmark engine，而是复用现有 benchmark primitive。Task loading、`run_one()`、event metrics 和结果对比仍由 `scripts/dsh_bench.py` 提供，只替换执行调度方式。

执行器继续保持现有 artifact 结构：

- `native.jsonl`；
- `code.jsonl`；
- `comparison.json`；
- native/code 各自独立的 durable session root。

`comparison.json` 会记录 `run_order: counterbalanced-paired`，让后续分析能够知道结果来自哪一种实验调度。

### 离线测试

新增测试不会调用 provider。它们验证：

- 首个 variant 的交替顺序是确定性的；
- 每个 task/repetition 恰好得到一次 native 和一次 Code Mode；
- 非法 repeat/index 会被拒绝；
- executor 严格按照规划顺序执行；
- native/code 输出文件保持分离；
- paired comparison metadata 正确写入。

这些测试证明的是实验基础设施正确性，而不是模型质量。

## 为什么没有外部数据时依然值得做

外部任务是回答“agent 在真实工作上是不是变强了”所必需的；但判断实验调度是否确定、durable evidence 是否分类正确、native/Code Mode 是否公平成对、结果 artifact 是否能稳定重放和比较，并不需要外部任务。

先把这些属性做扎实，可以减少未来性能开发被测量错误和 orchestration 偏差污染的概率。

## 验证策略

阶段性工作只要本地契约测试与仓库 CI 都通过，就可以合并。CI 被当作 integration gate，而不是日常开发 debugger。

这一阶段的成功标准是：planner/executor 契约被 keyless tests 覆盖，并且通过 fork/main repository gates。它不代表 Code Mode 已经被证明在外部 workload 上更快、更便宜或成功率更高。

## 下一步方向

后续高价值切片仍然集中在 Harness 本身：

- standalone 路径稳定后，把 counterbalanced schedule 合入主 benchmark command；
- 对只有 provider accounting aggregate 的指标去除带有 billing 暗示的命名；
- 继续推进 Code Mode execution plane 的 resource budget、typed tool dispatch 和 replay-safe side-effect 语义；
- 把 durable session events 进一步变成更好的 bounded trace/context debugger；
- 产品层保持 opinionated composition，同时保留底层 runtime 的可替换性。

长期目标是把 Harness 同时做成可靠的 agent runtime 和严谨的 agent laboratory：失败可以被重建，实验可以被比较，而当真实 workload 到来后，改进能够被真正证明。
