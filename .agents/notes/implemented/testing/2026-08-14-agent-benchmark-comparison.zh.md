# Agent Note: Paired benchmark comparisons for agent changes

Status: implemented

[English](2026-08-14-agent-benchmark-comparison.md) | 中文

## Problem

Agent runtime 的改动可能在结构上更漂亮，却没有提高任务成功率，甚至使其下降。Code Mode 特别容易让一个指标产生误导：一个模型可见的 `run_code` 调用内部可以包含许多原生工具子调用，因此只统计顶层工具调用会把传输层折叠误认为执行工作量下降。持久化 shell 也不适合作为唯一基线，因为模型本来就能在一次工具调用里批量执行任意计算。

## Decision

这个 fork 将成对 benchmark 证据作为所有旨在提升 agent 行为的改动的默认开发信号。`scripts/dsh_bench.py` 通过现有 Python SDK 运行 JSONL 任务，独立记录每次 repetition，从根 session 的 durable events 推导 trajectory 指标，并且只在 `(task_id, repetition)` 相同时比较 baseline 和 candidate。

Code Mode 对比同时报告模型可见的 `tool/call` 数和执行层的 `tool/code-dispatch` 数。`leaf_tool_calls` 去掉外层 `run_code` transport，再加入其中的子调用，因此只有当 leaf 视角也改善时，顶层调用减少才可能被解释为执行工作量减少。

`compare-modes` 提供两组成对且能力对齐的 composition。默认的 `fs` 组合暴露 `read`、`write`、`edit`、`glob` 和 `grep`，不提供 Bash；`shell` 组合保留持久化 Bash 和 string-replace editor，作为更保守的对比。每一对都保持该组合中的模型能力一致，只改变工具 presentation；Code 侧额外挂载 `run_code` 所需的 worker runtime。

仓库内的 `benchmarks/code-mode` micro-eval suite 提供确定性的 execution-heavy fixtures。它的 post-run checks 会验证答案文件的语义、必须发生的源文件修改、未涉及源文件保持不变，以及不存在额外文件。这个 suite 用于诊断 orchestration 行为；在修改产品默认值之前，仍然需要 repository-scale coding evals。

Benchmark 结果属于开发证据，而不是 CI 的 pass/fail 阈值或公开 leaderboard。真实模型运行受 provider credential、成本、模型随机性和环境条件影响，因此仓库保持 runner 与确定性任务检查可以 keyless 运行，而重复的模型实验仍由开发者显式发起。

## Alternatives considered

**只根据架构和 trajectory inspection 判断改动。** 这些信息适合形成假设，但不能证明 agent 解出了更多任务或消耗了更少资源，因此行为改进的结论必须来自实测任务。

**只使用 persistent-shell composition。** Shell 本身就可以批量执行搜索、解析和聚合，因此它适合作为保守对比，却不敏感于 Code Mode 是否真正增加了 execution plane。结构化工具组合成为默认，shell 组合仍然保留。

**只统计模型可见的工具调用。** 这种做法会系统性偏向 Code Mode，因为嵌套 SDK 调用不会进入模型历史。Durable Code Mode sub-dispatch events 使 leaf execution count 可观测，因此 runner 同时报告两种视角。

**把 benchmark delta 设成 CI gate。** 真实模型的随机性、credential、provider availability 和成本会把有用实验变成不稳定的仓库 gate。Keyless tests 改为验证 runner、任务 materialization 和确定性评分逻辑。

## Consequences

Agent-quality PR 有了固定位置来陈述 hypothesis、task set、baseline/candidate 设置、pass-rate delta、效率指标变化和 regression。Event-sourced session model 直接成为测量来源，而不需要另一套 instrumentation path。

这种对比并不会消除实验判断。Task suite 可能过拟合自己要暴露的行为，median 可能掩盖多峰失败，小幅随机 delta 仍然属于弱证据。重复运行和能力对齐的 composition 可以降低这些风险，但不能消除它们。

只有当正确率保持或提高，并且改进同时体现在 model steps、模型可见调用、leaf calls、token accounting 和 latency 上时，Code Mode 才获得更强的默认化证据。只减少顶层工具调用属于 presentation compression，而不是已经证明的执行效率提升。
