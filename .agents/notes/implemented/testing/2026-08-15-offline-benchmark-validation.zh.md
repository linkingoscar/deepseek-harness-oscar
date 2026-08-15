# Agent Note: Offline benchmark validation and replay

Status: implemented

[English](2026-08-15-offline-benchmark-validation.md) | 中文

## Problem

benchmark runner 原本能够采集 observation，并对两份 JSONL 的交集做比较，但没有定义带版本的结果格式，也无法证明相同 task id 的两侧仍然代表同一个任务；重复行、内部不一致的结果以及不同类型的 harness failure 也缺少稳定校验与分类。comparison 路径还没有一种完全离线、可确定性重放的 fixture 来把 benchmark harness 自身的逻辑变化与模型随机性分离开，持久化报告也只有原始 JSON。

## Decision

`scripts/dsh_bench.py` 把 benchmark observation 作为带版本的数据处理，并在 comparison 前进行校验。每个新采集的结果行都是 `kind: benchmark-result`、`schema_version: 1`，并带有语义级 `task_fingerprint`、明确的生命周期 `status`、`outcome`，以及失败 observation 的封闭 `failure_kind`。pairing 仍以 `(task_id, repetition)` 为键，但只有两侧 task fingerprint 相同且 scored/unscored 状态一致时才构成有效 pair。

comparison 默认要求完整配对。缺失 key 会让操作失败，而不是在集合交集中静默消失；`--allow-partial` 是中断任务的显式逃生口，生成的 comparison 会记录所有未匹配 key。comparison 格式同样带版本，并为每个配对 observation 写入一个 `benchmark-pair`，其中包含逐 run 的 metric delta，以及 outcome/failure transition。

runner 还提供完全离线的 `validate`、`fixture`、`replay` 和 `report` 命令。这些命令只消费已经记录的 observation；不会调用模型，也不会虚构替代 measurement。

## Validation model

结果校验同时覆盖单行和结果集合不变量。结果行必须使用受支持的 schema version，status/outcome/failure 组合必须有效，command 的 exit/timeout/spawn diagnostics 必须自洽，`leaf_tool_calls` 与 `billed_input_tokens` 等派生 accounting 必须精确成立。结果文件会拒绝重复 key、单个 task 的 repetition 序列缺口，以及同一文件中混杂的 provider/model/variant 值。

Task fingerprint 使用 canonical JSON 对 `id`、`prompt`、`prepare` 和 `check` 做哈希，不包含 `workspace`，因为语义相同的 benchmark task 可以有意运行在不同的 disposable checkout 中。因此 prompt 或 checker 的变化会使名义上相同的 pair 失效，同时不会把任务身份绑定到本地路径。

## Fixture semantics

paired fixture 是 benchmark harness 的离线回归产物，不是它自身产生的 benchmark evidence。它保存已经记录的 baseline/candidate 结果行的 canonical 副本、两侧的 SHA-256 digest，以及精确的 expected comparison。replay 会重新校验结果行、验证两个 digest、重新计算 comparison，并在任何 JSON 差异出现时失败。

fixture 有意保留原始 observation 行，而不是把它们缩减成伪造的最小示例。测试可以在内存里构造结果行来覆盖纯校验函数，但仓库中的 tooling 不会把这些测试值发布成经验性 benchmark 结果。

## Reporting

Markdown report 展示 pairing completeness、outcome count、diagnostic median、failure taxonomy 和 paired transition。报告会明确说明它只汇总已经记录的 observation，不推断哪一种 agent composition 或 execution mode 更好。解释权留给拥有 benchmark hypothesis 的实验或 PR。

## Alternatives considered

**保留宽松的交集 pairing。** 这会保持中断任务的旧便利性，但 baseline 或 candidate 缺失的 observation 会没有持久信号地消失。默认严格 pairing，并提供显式 partial mode，可以让不完整性成为 comparison 数据的一部分。

**只用 task id 标识任务。** 稳定 id 是必要条件，但不充分，因为 prompt 或 checker 可以在 id 不变的情况下变化。对语义任务定义做哈希可以检测这一错误，同时仍允许不同 workspace path。

**在仓库中生成 synthetic benchmark-result fixture。** 这会让 harness 回归测试更直观，但 synthetic row 很容易被误当成真实 benchmark evidence。实际提供的 fixture 命令只捕获 observation；unit test 只构造临时值，不把它们展示成 benchmark output。

**在 report 中自动给配置打分或排序。** 单一分数会把 pass/fail、variance、tool work、token usage 和 latency 压缩成带政策偏好的判断。report 保持描述性，实验 owner 必须自行做出并论证解释。

## Consequences

schema version 1 之前产生的结果文件会被新的离线校验路径拒绝，而不是通过猜测兼容。这是有意的 pre-release 格式破坏。

benchmark collection 现在可以在单个 agent exception 后继续，并对该 observation 进行分类；command spawn failure 也与 timeout 和 non-zero exit 分离。这样 aggregate delta 只有在 evidence 本身通过一致性校验后才会被报告。

fixture 对捕获的结果行和 comparison 实现而言是确定性的，但不会让原始模型运行变成确定性。replay 通过只能证明 benchmark-harness consistency；不会增加关于 agent quality 的 evidence。

`scripts/dsh_bench_test.py` 的聚焦单测覆盖重复 key、派生 accounting 错误、repetition 缺口、不完整 pairing、task-fingerprint mismatch、failure transition、fixture digest/replay 校验以及中性的 Markdown rendering。
