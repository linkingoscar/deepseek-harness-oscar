# Agent Note: 离线 Benchmark 执行基础

Status: implemented

[English](2026-08-14-offline-benchmark-execution.md) | 中文

## 问题

这个 fork 目前处于纯开发阶段，外部 benchmark corpus 和真实 provider 对比数据暂时不可用。这并不会降低实验基础设施的重要性，反而要求我们先把内部契约做扎实：当真实 workload 到来时，Harness 应该已经能够公平地调度成对 variant、保留 replay 证据、隔离 artifact，并避免 measurement layer 自己引入 order bias。

现有 `compare-modes` 路径会先跑完整的 native task set，再跑完整的 Code Mode task set。这个形态很简单，但会产生不必要的时间耦合。Provider 负载、cache 状态、repository prepare、runtime 温度、后台 rollout 或其他环境漂移，都可能仅仅因为某个 mode 总是更早执行而与 variant 形成系统性相关。

第二个风险是实现漂移。如果仅仅为了改变调度方式就重新造一套 comparison engine，那么 task loading、session execution、event metrics 和 comparison semantics 都会被复制。最终可能出现两套 benchmark system，而它们之间的差异来自 runner 本身，而不是被测试的 agent。

## 决策

Fork 新增一层确定性的 counterbalanced native/Code Mode 成对执行调度，同时继续把现有 benchmark engine 作为 task execution 和 result semantics 的唯一事实来源。

### 成对不变量

对于每一个 `(task, repetition)`：

- native 恰好执行一次；
- Code Mode 恰好执行一次；
- 两次 observation 保持相邻；
- 谁先执行会随 task index 和 repetition 确定性交替。

调度形态类似：

```text
task A / rep 1: native -> code
task B / rep 1: code   -> native
task A / rep 2: code   -> native
task B / rep 2: native -> code
```

这里选择 deterministic，而不是全局随机。只要 task 顺序和 repetition count 相同，variant schedule 就保持一致，从而更容易复现 failure、session artifact 和执行顺序。

### 复用现有 benchmark engine

`scripts/dsh_bench_plan.py` 只负责 schedule construction。`scripts/dsh_bench_compare_modes_offline.py` 消费这个 schedule，但 task loading、`run_one()`、durable event metrics 和 `compare_results()` 仍委托给 `scripts/dsh_bench.py`。

因此 standalone executor 改变的是 orchestration，而不是 benchmark 的语义定义。Native 和 Code Mode 继续使用独立 session root 与 JSONL output，最终 comparison 会增加 `run_order: counterbalanced-paired`，让每个结果都记录自己由哪种实验调度产生。

### 离线验证边界

新增测试刻意不调用 provider。它们只验证在没有外部数据时依然可以严格证明的基础设施属性：

- first variant 的交替顺序是确定性的；
- 每个 task/repetition pair 恰好完整包含两个 variant；
- 非法 repetition 和 task index 会被拒绝；
- executor 严格按照 generated run plan 执行；
- native 和 Code Mode 的 result file 保持分离；
- paired comparison metadata 被正确保留。

这些测试不声称 Code Mode 更快、更便宜或成功率更高。它们证明的是：以后真正做对比时，不会从一个可以提前避免的调度缺陷开始。

### 保持证据语义分离

这一 testing layer 遵循 context-attribution evidence contract。Harness-owned surface metric 可以作为 exact reconstructable fact 比较；provider usage 可以作为 provider-reported accounting 比较；token-meter 的组件结果继续属于 estimate。Benchmark layer 不会把一种 evidence class 洗成另一种，也不会在没有 provider-specific accounting adapter 的情况下使用暗示 billing truth 的字段语义。

## 考虑过的替代方案

**保留 whole-batch ordering。** 拒绝。它会系统性地把 variant 与时间关联起来。即使今天没有外部 provider，把这种顺序固化进 experiment API，也会让未来数据更难解释，并在 benchmark 真正有价值时被迫迁移。

**全局随机打散所有 run。** 不作为默认方案。它提高随机化程度，但牺牲 pair locality 和 deterministic replay。相邻 pair 可以缩小两次 observation 之间的环境距离，而 deterministic alternation 已经能够平衡谁先执行。

**使用 seed 随机 pair order。** 未来对更大规模 study 可能有价值，但不作为基础方案。Seeded scheduler 会增加一个新的配置维度，而当前最核心的不变量已经可以由 pair adjacency + balanced first-position assignment 满足。

**围绕新 schedule 重写一套 `compare-modes` engine。** 拒绝。调度变化不值得复制 task semantics、durable event parsing 和 comparison logic。新层只负责它应该负责的那一小块，并组合现有 runner。

**等外部 workload 到来之后再做 benchmark infrastructure。** 拒绝。等真实 run 产生以后才发现 measurement defect，代价会更高：历史结果可能无法比较，甚至只能丢弃。Scheduler correctness、artifact shape 和 replay metadata 都可以现在验证。

## 后果

Fork 现在拥有一个可复现的 paired-comparison primitive，它不依赖某个具体模型或外部 benchmark 才有价值。后续 Code Mode、prompt、tool composition、context policy 和 execution-plane 工作都可以复用同一调度，而不必每次重新发明 experiment orchestration。

这个设计刻意保持窄边界。它还没有替换主 `compare-modes` command，没有加入统计推断，没有估算 provider cost，也没有宣称任何 performance win。这些都是后续独立决策。当前得到的收益是：实验底座拥有更明确的 provenance、更低的内置 order bias，也更适合 replay 和审查。

下一步 testing 工作是在 standalone path 经仓库 gates 稳定后，将这套 schedule 合入 primary benchmark command。更重要的下一步 runtime 工作则与此分离：真正修改 agent 行为——尤其是 Code Mode execution semantics、resource budget、replay-safe side effect，以及 bounded context/debug surface——然后在代表性 workload 到来后利用这套 laboratory 进行验证。
