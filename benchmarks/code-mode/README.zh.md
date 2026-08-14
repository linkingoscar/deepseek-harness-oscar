# Code Mode 微型评测套件

[English](README.md) | 中文

这套评测专门隔离执行平面可能真正发挥作用的工作负载：扇出读取、搜索后读取聚合、多文件编辑和依赖遍历。它有意采用合成任务。固定夹具让任务正确性保持确定，而 Harness 的执行轨迹仍可自由变化。

生成一次性工作区和 benchmark JSONL 文件：

```sh
python benchmarks/code-mode/suite.py materialize \
  --output .bench/code-mode/tasks.jsonl \
  --work-root .bench/code-mode/workspaces
```

然后运行能力匹配的结构化工具对照：

```sh
python scripts/dsh_bench.py compare-modes .bench/code-mode/tasks.jsonl \
  --output-dir .bench/code-mode/results \
  --toolset fs \
  --repeat 3
```

四个 case 分别覆盖不同的编排模式：

- `aggregate-services`：glob 扇出文件集合，读取全部文件，聚合后写出一个答案。
- `critical-timeouts`：grep 标记，只读取匹配文件，聚合字段并写出一个答案。
- `beta-retry-migration`：发现匹配配置，编辑前读取，只修改符合条件的文件，并精确记录改动。
- `dependency-closure`：从根节点出发，通过文件读取沿动态传递图遍历，并聚合可达集合。

每次 benchmark 重复都会运行 `prepare` 命令，用套件内代码定义的夹具恢复 case；运行后的 `check` 命令则验证完整的最终文件集合。出现额外文件、连带修改源文件、JSON 格式错误或语义答案错误时，任务都会判定失败。

这些 case 不能替代仓库规模的 coding eval。它们是一层诊断工具：如果 Code Mode 在这些刻意偏执行密集的工作负载上，无法在不损害正确性的前提下降低模型往返次数，那么把它设为默认就值得怀疑。如果它能做到，下一步才是验证这种优势能否延续到真实仓库和具备 shell 能力的 profile。
