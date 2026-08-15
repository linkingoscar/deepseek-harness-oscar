# DeepSeek Harness — Oscar Fork 下一阶段执行计划

> 状态：可执行规划文档  
> 基线：`master` @ `aaa186c840e6dbe0a0f70fcb4b3f809db24cbb60`  
> 日期：2026-08-15  
> 目标：在不推翻现有 runtime 语义、不制造伪 benchmark 证据的前提下，把已经落地的 Replay、Execution Diagnostics、Offline Benchmark Validation 三块基础设施继续推进成可实际使用、可复核、可逐步进入 reproducible execution 的工程闭环。

## 1. 当前基线

当前 `master` 已完成第一轮三条并行开发线，项目已经从“补基础证据能力”进入“把证据能力连接起来并用于真实工程工作”的阶段。

已确认的基础能力包括：

- Replay 已区分 transcript、request reconstruction、simulated replay、live fork 与 reproducible replay，不再把不同语义压成一个“重放”按钮。
- `replay/reproducibility-evidence` 已能按精确 `request/header` sequence 持久记录 runtime/config/tool/plugin identity，以及 execution-environment / external-state snapshot reference。
- Replay 当前仍明确保留 `REPRODUCIBLE_EXECUTOR_NOT_IMPLEMENTED` blocker；有 snapshot reference 不等于已经具备 reproducible execution。
- Code Mode 已有 durable dispatch accounting，并有纯派生的 `summarizeCodeRunExecutionAccounting()`，能够汇总 delivery rejection、measured/unmeasured bytes、run-local peak、unsettled/orphan evidence 和 per-tool summary。
- Diagnostics summary 不读取 live scheduler state，不改变 agent-loop、scheduler、tool execution、admission 或 session persistence。
- Benchmark runner 已采用 `benchmark-result` schema v1，并具备 semantic task fingerprint、严格 paired validation、failure taxonomy、deterministic fixture/replay、offline validation 和 neutral Markdown report。
- Benchmark 离线命令只消费已经记录的 observation，不调用模型，不制造替代 measurement，也不自动推导 Code Mode 或某种配置更优。
- 当前 fork CI 已验证 35/35 static gates，并覆盖 benchmark、execution accounting、delivery bytes、admission、replay 和 trajectory focused tests。

这一基线意味着下一阶段不应该再复制一套 ledger、再造一套 replay 语义，或者在 benchmark report 里加入未经证据支持的“结论层”。下一阶段的核心任务应该是：**整合、绑定 provenance、验证 artifact、逐步消除 reproducibility blocker。**

## 2. 本轮目标

本轮建议同时启动三条 branch，三条线从同一个 `master` 基线切出，尽量保持文件所有权分离：

| Branch | 主目标 | 主要代码面 | Runtime 行为变化 |
| --- | --- | --- | --- |
| `agent/evidence-debug-bundle` | 把 execution diagnostics、replay inspection、session evidence 组合成一个可导出的确定性 debug artifact | `packages/session-query/**`，必要时只读消费 `dsh-session` / `dsh-tools` | 不允许 |
| `agent/benchmark-experiment-provenance` | 给真实 benchmark run 增加 experiment-level provenance、artifact digest、bundle/verify 流程 | `scripts/dsh_bench.py`、`scripts/dsh_bench_test.py`、`BENCHMARK.md` | 不改变 agent runtime |
| `agent/replay-snapshot-resolution` | 为 snapshot reference 增加 caller-supplied resolve + SHA-256 verify 能力，作为未来 reproducible executor 的前置层 | `packages/core/session/**` | 不执行模型/工具；不宣称 reproducible mode available |

三条线应并行开发，但不能把共享基线做成移动目标。**本轮开发期间不要进行大规模 upstream rebase/sync。** Upstream sync 应在三条线合并后单独进行，因为它天然会改变所有 branch 的 merge base，不适合作为同一批并行 feature 的第四条线。

## 3. 全局工程约束

以下约束对三条 branch 都是硬要求。

### 3.1 Evidence first

任何新字段都必须说明它来自哪一份 durable/file/process evidence。不能因为“理论上可以推断”就把未知事实写成确定值。

### 3.2 Execution、delivery、replay、benchmark interpretation 分层

- execution success 不能等价于 delivery success；
- run-local peak 不能重命名成 session/global peak；
- snapshot identity 不能等价于 snapshot bytes；
- fixture replay 通过不能等价于模型运行可复现；
- benchmark report 不能把描述性 delta 自动转成优劣结论。

### 3.3 不建立第二事实源

已经存在 durable session event 时，新功能必须优先消费现有 event/projector，而不是新增 live observer、scheduler side ledger 或临时内存计数器。

### 3.4 Fail closed，但不要伪造失败

证据不足时应返回 explicit unavailable / incomplete / unknown，而不是补默认值；但 diagnostics failure 本身也不能被错误升级为 runtime failure。

### 3.5 版本化外部 artifact

新增可持久化 JSON/JSONL artifact 时必须有 `kind` 和 `schema_version`，并明确 canonicalization、digest 和兼容策略。

### 3.6 非平凡改动必须有 Agent Note

每条 branch 的实现 PR 都应新增对应 Agent Note；不要修改 archived note。若更新双语文档，必须同步 translation pairing metadata。

### 3.7 共享文件冻结

三条开发 branch 在实现阶段原则上都不要修改：

- `README.md`
- `README.zh.md`
- `website/fork-landing.html`
- `.github/workflows/fork-ci.yml`

这些共享文件在三条 feature 合并后由单独 integration/docs PR 一次更新。除非某条 branch 的 CI 无法被现有 workflow 覆盖，否则不要在 feature branch 里改 CI workflow。

---

# 4. Workstream A — Evidence Debug Bundle

## 4.1 Branch

`agent/evidence-debug-bundle`

## 4.2 目标

提供一个**只基于 durable session log 的、版本化、确定性、可导出的 debug artifact**，把目前分散的 session identity、Replay inspection、Code Mode execution diagnostics 和 evidence quality 信息放到一个统一视图中。

当前已经有底层事实和 projector，但开发者仍需要自己完成多步拼接：读 session → 找相关 run → derive accounting → summarize diagnostics → inspect replay capabilities → 判断 evidence 是否 incomplete。这个过程容易让不同调用方对同一份 log 得出不同表述。

本任务的目标不是增加 UI 特效，也不是增加新的 runtime event，而是把已有事实组合成一个稳定的 developer-facing read model。

## 4.3 推荐落点

优先在 `packages/session-query/session-query` 增加纯读取能力，原因是 `SessionQueryEngine` 已经拥有：

- live/persisted session 的统一读取；
- detached raw session log；
- current surface / event list / trace；
- live-preferred 与 persistence 一致性规则。

建议不要把该能力放进 `session-log-export`，因为后者当前负责 Web ZIP download 控制，不是 semantic evidence projection 的自然 owner。

推荐新增模块名可为：

```text
packages/session-query/session-query/src/evidence-debug.ts
```

必要时为 `SessionQueryEngine` 增加类似：

```ts
readEvidenceDebugBundle(sessionId, options?)
```

具体命名可以调整，但必须保持“查询/派生”语义，不要让方法看起来会修改 session。

## 4.4 建议的数据模型

建议新增版本化 JSON-friendly 类型，例如：

```ts
interface SessionEvidenceDebugBundleV1 {
  kind: 'session-evidence-debug-bundle'
  schemaVersion: 1
  session: {
    id: string
    eventCount: number
    boundary: number | null
  }
  replay: {
    latestRequestHeaderSeq?: number
    reproducibilityEvidenceSeq?: number
    modes: Record<string, {
      availability: string
      effects: string
      blockers: readonly string[]
    }>
    evidence?: unknown
  }
  codeExecution: {
    runs: number
    summary: CodeExecutionDiagnosticsSummary
  }
  evidenceQuality: {
    incompleteCodeRuns: number
    hasUnmeasuredDeliveryBytes: boolean
    hasReplaySnapshotReferences: boolean
  }
}
```

上述字段只是建议结构，最终实现可以根据现有 package API 调整，但必须满足以下原则：

- `schemaVersion` 必须存在；
- 所有字段必须可由同一 session log/prefix 确定性重建；
- 不写入 human interpretation，例如 `healthy: true`、`goodConcurrency: true`、`codeModeEfficient: true`；
- replay capability 直接复用 `inspectReplayCapabilities()` 的 blocker 语义，不复制一套新判断；
- Code Mode diagnostics 直接复用 `deriveCodeRunExecutionAccounting()` 与 `summarizeCodeRunExecutionAccounting()`；
- `maxRunPeakInFlight` 原样保留，不能在 bundle 中改名为 `globalPeakConcurrency`；
- `deliveredValueBytes: null` 的 overflow 语义必须保留，不能填 `0`；
- unsettled / orphan evidence 必须可见，不能为了“清爽”从 bundle 中省略。

## 4.5 需要实现的能力

### A1. 单 session bundle

输入一个 `sessionId`，读取完整 detached log，并生成 bundle。

### A2. 可选 boundary

若现有 query API 容易支持，可允许调用方指定 inclusive event seq，生成“截至该时刻”的 evidence bundle。若实现 boundary 会导致 session-query 大范围改动，本轮可以只支持 full-log tail，并把 boundary support 写入 deferred work。

### A3. Code Mode run discovery

从 durable `tool/code-dispatch-start` / `tool/code-dispatch` 等已有事件派生 run accounting，不依赖 live scheduler。

### A4. Replay inspection

复用 `inspectReplayCapabilities()`，包含：

- request reconstruction availability；
- simulated replay conditional state；
- live-fork condition；
- reproducible blockers；
- selected reproducibility evidence seq；
- validated evidence payload。

### A5. Evidence-quality summary

允许增加纯派生的“证据质量”统计，但只能陈述事实，例如：

- 有多少 run 存在 unsettled/orphan；
- 是否存在 unmeasured delivered values；
- 是否存在 snapshot reference；
- 是否没有任何 request/header；
- 是否存在 replay blockers。

不要输出“建议修复”或自动 severity ranking；建议层以后可以由 UI/CLI 单独实现。

### A6. 稳定 JSON serialization

同一份 session log 必须生成字段顺序和数组顺序稳定的 JSON 结果。若提供 CLI/export helper，重复执行产生的 semantic JSON 必须一致。

## 4.6 明确不做

- 不新增 scheduler observer；
- 不新增 Code Mode execution ledger；
- 不修改 agent-loop；
- 不改变 tool dispatch / admission；
- 不新增模型可见 tool；
- 不在本轮做 Web 可视化；
- 不尝试从 run summaries 推导跨 run global concurrency；
- 不把 replay availability 自动升级。

## 4.7 文件所有权建议

主要允许修改：

```text
packages/session-query/session-query/src/**
packages/session-query/session-query/tests/**
packages/session-query/session-query/package.json      # 仅在确有 export 需要时
packages/session-query/session-query/README.md         # 若公共 API 改变
packages/session-query/session-query/README.zh.md
.agents/notes/implemented/feature/**                   # 新 Agent Note
```

原则上只读依赖、不要修改：

```text
packages/core/session/src/replay.ts
packages/core/tools/src/execution-accounting.ts
packages/core/tools/src/execution-diagnostics.ts
```

这条约束是为了与 Workstream C 并行，减少同文件冲突。

## 4.8 测试要求

至少覆盖：

1. 空/最小 session；
2. 无 Code Mode run 的普通 session；
3. 多个 Code Mode run 的聚合；
4. delivery rejection；
5. unmeasured byte evidence；
6. byte aggregate overflow 仍保留 `null`；
7. unsettled start；
8. orphan settle；
9. 无 request/header 的 replay blockers；
10. identity-only reproducibility evidence 不清除 snapshot blocker；
11. snapshot refs 存在时只反映当前 replay inspection 已支持的 blocker 变化；
12. 同一 log 两次生成 bundle 深度相等；
13. live source 与 persisted source 的选择继续遵循 `SessionQueryEngine` 原有规则。

## 4.9 Definition of Done

- 有一个公开、稳定、文档化的 read API 可以从 session durable evidence 生成 debug bundle；
- bundle 不需要 live scheduler；
- bundle 不修改 session；
- bundle 不发起模型/工具调用；
- Replay 字段与 `inspectReplayCapabilities()` 一致；
- Code Mode 字段与现有 accounting/diagnostics 一致；
- incomplete/unknown evidence 明确可见；
- package tests 通过；
- repository static gates 通过；
- Agent Note 与受影响 README 同步更新。

---

# 5. Workstream B — Benchmark Experiment Provenance

## 5.1 Branch

`agent/benchmark-experiment-provenance`

## 5.2 目标

把现有“validated result rows + comparison + fixture + report”继续提升为**可审计的 experiment artifact**。

当前 benchmark row 已经记录 `provider`、`model`、`variant`、`task_fingerprint`、`session_id`、`session_root` 等运行事实；offline validation 可以证明 row/result-set 内部一致，但还缺少一个 experiment-level manifest 来回答：

- 这批结果是由哪个 source revision 生成的？
- 使用的是哪一份 task file？
- 使用的是哪一份 Cordis composition？
- baseline/candidate observation 文件的精确 digest 是什么？
- comparison/report/fixture 对应的是哪两份 observation？
- artifact 是否在生成后被修改？

本任务只增强 provenance 和 artifact integrity，不做 benchmark campaign，不生成“官方分数”。

## 5.3 推荐新增 artifact

建议新增：

```text
kind: benchmark-experiment-manifest
schema_version: 1
```

manifest 至少应包含以下类别信息。

### Source identity

```json
{
  "source": {
    "kind": "git",
    "commit": "<40-hex-sha>",
    "dirty": false
  }
}
```

默认应优先要求可验证 source identity。若脚本允许 dirty tree，必须显式记录 `dirty: true`，不能把 dirty checkout 表述成纯 commit 状态。

不要把 API key、token、环境变量 secret 写入 manifest。

### Task identity

记录：

- task JSONL 文件 SHA-256；
- task count；
- 每个 row 仍使用现有 semantic `task_fingerprint`；
- manifest 不替代 row-level fingerprint。

### Composition identity

对实际使用的 Cordis YAML 记录：

- path（作为 provenance metadata）；
- SHA-256 digest；
- variant 名称。

如果使用默认 composition，也必须记录最终实际选择的文件 identity，而不是只记录“default”。

### Invocation identity

记录会影响 benchmark 语义的非 secret 参数，例如：

- provider；
- model；
- repetitions；
- max tokens；
- command timeout；
- run id；
- mode/variant pair。

必须明确区分“会影响结果语义的参数”和“纯输出路径参数”。

### Artifact digests

至少支持对以下文件记录 SHA-256：

- baseline results；
- candidate results；
- comparison JSON；
- Markdown report；
- paired fixture（若生成）。

若 manifest 自身需要 digest，必须避免自引用循环；可以不对 manifest 自身做 digest，或者用外层 bundle index 解决，本轮不必增加第二层格式。

## 5.4 推荐命令

可在现有 `dsh_bench.py` 中增加两个离线命令：

```text
bundle
verify-bundle
```

命名可以调整，但语义应保持清晰。

### `bundle`

输入已经存在的 observation/comparison/report/fixture，创建一个 experiment directory，例如：

```text
experiment/
  manifest.json
  baseline.jsonl
  candidate.jsonl
  comparison.json
  report.md
  fixture.json            # optional
```

`bundle` 不调用模型，不重新跑 task，不改变原始 observation 内容。

### `verify-bundle`

完全离线验证：

- manifest schema；
- artifact 文件是否存在；
- SHA-256 是否一致；
- result validation；
- strict pairing；
- comparison 是否可以从两侧结果重算一致；
- report 是否对应当前 comparison（如果 report renderer 可以确定性重建）；
- fixture 若存在，继续使用现有 fixture replay 规则验证。

任何 digest mismatch 必须失败，不能只 warning。

## 5.5 是否升级 `benchmark-result` schema

本任务**优先不要为了 experiment manifest 强行把 row schema 从 v1 升到 v2**。

原因：experiment provenance 属于 result-set / experiment 层，不一定需要污染每一个 row。若实现过程中发现必须新增 row-level、且无法从现有字段推导的事实，再单独评估 schema v2；不要为了“顺手统一”制造不必要格式 churn。

## 5.6 与 session evidence 的关系

成功 observation 当前已经有 `session_id` 和 `session_root`。本轮可以在 manifest 中记录这些 session reference 的集合或统计，但不要在 Python 里复制 TypeScript replay semantics。

推荐边界：

- benchmark manifest 负责“这条 observation 指向哪个 session artifact”；
- session/replay package 负责“该 session artifact 能证明什么”。

如果未来要把 Workstream A 的 Evidence Debug Bundle 一起打包，可以在三条线合并后的 integration wave 增加 optional enrichment；本 branch 不依赖 Workstream A，确保可真正并行。

## 5.7 明确不做

- 不生成 synthetic benchmark observations；
- 不发布伪造 fixture 作为 empirical result；
- 不自动选择 winner；
- 不引入综合评分公式；
- 不把 fixture replay 通过描述为 model replay deterministic；
- 不在 `verify-bundle` 中调用模型；
- 不在 manifest 中记录 secret；
- 不在本轮做远程 artifact upload/service。

## 5.8 文件所有权建议

主要允许修改：

```text
scripts/dsh_bench.py
scripts/dsh_bench_test.py
BENCHMARK.md
.agents/notes/implemented/testing/**
```

原则上不要修改：

```text
packages/core/session/**
packages/core/tools/**
packages/session-query/**
```

## 5.9 测试要求

至少覆盖：

1. clean git source identity；
2. dirty source identity 被明确记录；
3. task file digest；
4. Cordis digest；
5. bundle 中任意 result byte 被修改后 verify 失败；
6. comparison 被修改后 verify 失败；
7. report 被修改后 verify 失败，或至少 digest mismatch 失败；
8. manifest 缺 artifact 失败；
9. manifest unknown schema version 失败；
10. baseline/candidate task fingerprint mismatch 仍失败；
11. strict pairing 默认保持；
12. `--allow-partial` 语义不被 bundle 偷偷改成 complete；
13. bundle/verify 命令不 import/initialize model SDK；
14. report 继续包含 neutral interpretation disclaimer；
15. secret-like CLI/env 值不会被序列化进 manifest。

现有 Fork CI 已执行：

```sh
python -m py_compile scripts/dsh_bench.py scripts/dsh_bench_test.py
python scripts/dsh_bench_test.py
```

该 branch 必须继续通过这两项，并通过 repository static gates。

## 5.10 Definition of Done

- 一次真实 benchmark run 可以被封装为一个自描述 experiment bundle；
- bundle 的核心输入和输出均有 digest；
- offline `verify-bundle` 可以检测 tampering 和 semantic inconsistency；
- manifest 能标识 source/task/composition/invocation；
- 不需要模型即可验证 artifact；
- 不自动输出 winner；
- 现有 schema v1 validation、fixture replay、report semantics 不回退；
- 测试与 Agent Note 完整。

---

# 6. Workstream C — Replay Snapshot Resolution

## 6.1 Branch

`agent/replay-snapshot-resolution`

## 6.2 目标

补齐 reproducible replay 当前最明确、同时又不会过早进入“真正执行”的前置层：**让 durable `ReplaySnapshotReference` 可以被 caller-supplied resolver 解析，并对解析出的 bytes 做 SHA-256 验证。**

当前 Replay 已经能持久保存：

- snapshot `format`；
- opaque `locator`；
- snapshot digest。

但 snapshot reference 目前只是“指向某份可恢复 artifact 的声明”。在真正实现 reproducible executor 之前，至少应该先证明：

1. locator 能被某个明确 resolver 解析；
2. resolver 返回的 artifact 与 durable digest 一致；
3. execution-environment snapshot 与 external-state snapshot 各自保持独立；
4. 解析失败会削弱 reproducibility，不会静默回退或跳过。

本任务完成后，`reproducible` mode **仍然保持 unavailable**，因为 executor 仍未实现。该限制必须保留在 `inspectReplayCapabilities()` 中。

## 6.3 推荐 API

建议在 `@deepseek-ai/dsh-session/replay` 或相邻模块中新增 caller-supplied resolver contract，例如：

```ts
interface ReplaySnapshotResolver {
  readonly id: string
  resolve(reference: ReplaySnapshotReference):
    | Uint8Array
    | Promise<Uint8Array>
}
```

也可以返回更结构化的结果，但必须满足：

- core 不自行解释 opaque locator；
- resolver identity 可被结果记录；
- 返回内容能被 core 做 digest verify；
- resolver throw 与 digest mismatch 有不同错误语义。

建议新增结果类型：

```ts
interface ResolvedReplaySnapshot {
  resolverId: string
  reference: ReplaySnapshotReference
  bytes: Uint8Array
}
```

如果直接把 bytes 暴露给上层有内存/生命周期问题，也可以只返回 verified artifact handle，但那会引入新的 handle ownership 设计。本轮优先保持简单、可测试的 caller-supplied bytes contract，不要同时设计远程 streaming framework。

## 6.4 推荐能力

### C1. 单 snapshot resolve + verify

输入一个 `ReplaySnapshotReference` 和 resolver：

1. 检查 resolver contract；
2. 调用 resolver；
3. 计算 SHA-256；
4. 与 reference digest 精确比较；
5. mismatch 时 fail closed。

### C2. Reproducibility evidence snapshots resolve

提供 helper，可对选中的 `ReplayReproducibilityEvidence` 分别解析：

- `executionEnvironmentSnapshot`；
- `externalStateSnapshot`。

不要把两个 snapshot 合并为一个 generic state blob。

### C3. 与 request scope 绑定

如果提供从 `SessionEvent[]` 直接 resolve 的 API，必须先调用现有 replay inspection/selection 逻辑，确保使用的是 latest request 对应的 latest atomic validated evidence，而不是自己重新扫描并产生不同选择规则。

### C4. Explicit result state

建议明确区分：

- reference absent；
- reference present but resolver unavailable；
- resolve failed；
- digest mismatch；
- verified。

不要用一个 boolean 把所有失败压在一起。

### C5. 不升级 availability

即使两个 snapshot 都 verified，也不能移除 `REPRODUCIBLE_EXECUTOR_NOT_IMPLEMENTED`。本 branch 不实现 executor，所以最终 capability 仍然必须 unavailable。

## 6.5 Digest 规则

现有 replay evidence 使用 `sha256:<hex>` 或当前类型定义中的等价 digest contract 时，应直接复用现有 normalize/validation 规则。

禁止：

- 用 locator string 的 hash 代替 artifact bytes hash；
- 只比较文件大小；
- digest mismatch 后返回旧 snapshot；
- 解析 latest reference 失败后自动回退 earlier evidence；
- 把 identity digest 当 snapshot digest。

## 6.6 Resolver provider 范围

本 branch 建议**只定义和验证 caller-supplied resolver contract，不提供默认 filesystem/network/cloud resolver**。

原因：

- locator 是 opaque；
- 不同 sandbox/provider 的 artifact ownership 不同；
- 默认文件/网络 resolver 会立刻引入权限、路径、远程 I/O、secret、生命周期和跨平台问题；
- 当前更重要的是先固定“resolve 后如何证明 bytes 与 durable evidence 一致”。

后续可以单独实现 provider，例如 local artifact store、sandbox snapshot store 或 remote immutable object store。

## 6.7 推荐文件

主要允许修改：

```text
packages/core/session/src/replay.ts
packages/core/session/src/reproducibility-evidence.ts     # 仅复用/补充必要 helper 时
packages/core/session/src/replay-snapshot.ts              # 推荐新增独立模块
packages/core/session/src/types.ts                         # 仅在类型确需公共化时
packages/core/session/tests/replay.spec.ts
packages/core/session/tests/replay-snapshot.spec.ts        # 推荐新增
packages/core/session/package.json                         # 若需要新 subpath export
.agents/notes/implemented/architecture/**
```

尽量不要修改 `packages/session-query/**`，与 Workstream A 分离。

## 6.8 测试要求

至少覆盖：

1. 正确 bytes + 正确 digest → verified；
2. digest mismatch → hard failure；
3. resolver throw → resolve failure，不误报 mismatch；
4. resolver 返回非法值 → contract failure；
5. empty resolver id → contract failure；
6. execution-environment snapshot 与 external-state snapshot 分别处理；
7. 只有一个 snapshot 时不会伪造另一个；
8. identity-only evidence 不触发 snapshot resolve；
9. latest malformed evidence 仍 fail closed，不回退旧 evidence；
10. request A 的 snapshot 不泄漏到 request B；
11. boundary inspection 不读取未来 evidence；
12. verified snapshots 仍保留 `REPRODUCIBLE_EXECUTOR_NOT_IMPLEMENTED`；
13. resolver 未传入时 capability inspection 的现有行为不变；
14. simulated replay executor 行为完全不变。

现有 Fork CI 已运行：

```sh
pnpm exec vitest run packages/core/session/tests/replay.spec.ts packages/core/session/tests/replay-request.spec.ts
```

本 branch 应把新增 snapshot tests 纳入 package/standard CI；若确需加入 fork focused step，优先等 integration 阶段统一调整 workflow，避免三条 branch 同改 CI 文件。

## 6.9 Definition of Done

- durable snapshot reference 可以被 caller-supplied resolver 解析；
- artifact bytes 必须经过 SHA-256 校验；
- mismatch/resolve failure/absent reference 语义明确；
- request-scoped evidence selection 不重复实现；
- identity 与 snapshot 继续严格分离；
- 不新增默认外部 I/O provider；
- 不执行模型；
- 不执行工具；
- 不创建 live fork；
- `reproducible` mode 仍有 executor blocker；
- tests、JSDoc、Agent Note 完整。

---

# 7. 三条线的并行协作规则

## 7.1 统一切分基线

三条 branch 都从：

```text
aaa186c840e6dbe0a0f70fcb4b3f809db24cbb60
```

切出。

不要让其中一条 branch 先把自己的中间 commit merge 到 `master`，再让另外两条从新 master 才开始开发。开发期保持同一 baseline，可以最大程度降低“并行”名义下的隐性依赖。

## 7.2 文件所有权

| Surface | A Debug Bundle | B Benchmark Provenance | C Snapshot Resolution |
| --- | --- | --- | --- |
| `packages/session-query/**` | 主写 | 禁止 | 尽量禁止 |
| `scripts/dsh_bench*` | 禁止 | 主写 | 禁止 |
| `BENCHMARK.md` | 禁止 | 主写 | 禁止 |
| `packages/core/session/**` | 只读依赖 | 禁止 | 主写 |
| `packages/core/tools/**` | 只读依赖 | 禁止 | 禁止 |
| Root README / Pages | 冻结 | 冻结 | 冻结 |
| Fork CI workflow | 原则冻结 | 原则冻结 | 原则冻结 |
| Agent Notes | 各自新增独立文件 | 各自新增独立文件 | 各自新增独立文件 |

## 7.3 跨 branch 依赖规则

- A 可以调用当前 master 已存在的 replay/diagnostics API，但不能依赖 C 尚未合并的 snapshot resolver。
- B 可以记录 session refs，但不能依赖 A 尚未合并的 debug bundle。
- C 只处理 replay snapshot resolution，不依赖 A/B。
- 如果某条线发现“必须等另一条线的 API”，优先缩小 scope，避免在 feature branch 之间 cherry-pick 未合并代码。

## 7.4 Merge 顺序

开发并行，集成建议按风险从低到高：

1. `agent/evidence-debug-bundle`
2. `agent/benchmark-experiment-provenance`
3. `agent/replay-snapshot-resolution`

理由：

- A 主要是 read-only projection；
- B 主要是 Python/offline artifact；
- C 修改 core replay contract，风险最高，最后基于最新 master 做 rebase/clean replay 和完整 regression 最稳妥。

如果某条线明显先完成，也可以先开 PR，但最终 merge 前必须基于最新 `master` 检查 compare 和 CI。

## 7.5 每条 PR 的最低交付内容

每条 branch 的 PR description 至少写清：

- 问题是什么；
- 新增了什么 evidence/API/artifact；
- 哪些事实仍然无法证明；
- 哪些 runtime 行为明确没有改变；
- failure semantics；
- focused tests；
- static gate 结果；
- 是否引入新持久化 schema；
- 是否影响 backward compatibility。

---

# 8. 验证与 CI 策略

## 8.1 通用验收

每条 feature branch 合并前至少满足：

- 对应 focused tests 全绿；
- `pnpm run check:ci:static` 通过；
- 新公共 export 有 JSDoc；
- package publication constraints 与 files/exports 同步；
- 双语文档 pairing metadata 同步；
- 没有 unrelated files；
- compare 显示 branch 已重放到当前 master，无旧历史污染。

## 8.2 A 线重点

- session-query package tests；
- core tools execution accounting/diagnostics regressions；
- replay semantics regressions；
- deterministic bundle equality。

## 8.3 B 线重点

```sh
python -m py_compile scripts/dsh_bench.py scripts/dsh_bench_test.py
python scripts/dsh_bench_test.py
```

并额外覆盖 bundle tampering、digest、manifest validation。

## 8.4 C 线重点

- replay snapshot focused tests；
- replay/request reconstruction tests；
- reproducibility evidence tests；
- simulated replay regression；
- package build/public export smoke。

---

# 9. 本轮完成后的 Integration PR

三条线都进入 `master` 后，再开一个独立 integration/docs PR，统一处理：

1. README 中的 Current status；
2. Pages landing 的 3/3 下一阶段 workstreams 状态；
3. 必要的 `fork-ci.yml` focused test 补充；
4. benchmark 文档与 debug workflow 交叉链接；
5. 最终 35-gate static + focused suites；
6. Pages deploy 验证。

不要让三条 feature branch 分别修改 landing page，否则会制造无价值的 HTML 冲突。

---

# 10. 本轮之后的候选下一波

这三条任务完成后，项目才适合进入更强的 runtime / experiment 工作。

## 10.1 Reproducible Replay Executor

前置条件：Workstream C 已经证明 snapshot reference 可解析且 digest 可验证。

下一步才是设计真正的 reproducible executor：恢复 execution environment / external state，并在明确 effect contract 下执行历史 request。到那时才有资格讨论移除 `REPRODUCIBLE_EXECUTOR_NOT_IMPLEMENTED`。

## 10.2 Real Benchmark Campaigns

前置条件：Workstream B 已经给 experiment provenance 和 artifact integrity 固定格式。

然后可以跑真实 baseline/candidate experiments；结果应保留 raw observation、manifest、comparison、failure taxonomy 和 report，并由独立实验文档解释 hypothesis 和 conclusion。

## 10.3 Developer UI / CLI

前置条件：Workstream A 已经给出稳定 Evidence Debug Bundle。

随后可以选择把 bundle 渲染到 trajectory UI、CLI 或导出文件；UI 只做 presentation，不重新计算另一套 evidence semantics。

## 10.4 Upstream Sync

本轮三条线合并后再处理 upstream sync。建议流程是：

1. 记录当前 fork HEAD；
2. fetch upstream；
3. 计算 merge-base 和 upstream delta；
4. 优先检查 `packages/core/session`、`packages/core/tools`、`packages/session-query`、benchmark scripts 与 CI；
5. 逐项决定 fork patch：保留、重做、上游已覆盖、或删除；
6. rebase/merge 后重新跑 fork focused tests 和 static gates；
7. 不把 upstream drift 与 feature behavior change 混在同一个 PR。

---

# 11. Phase Exit Criteria

本轮可以标记完成，必须同时满足以下条件：

- [ ] A：一个 session 可以生成稳定的 Evidence Debug Bundle；
- [ ] A：bundle 统一引用现有 Replay/Diagnostics 事实，不建立第二事实源；
- [ ] B：一次 benchmark experiment 可以生成 versioned provenance manifest；
- [ ] B：result/comparison/report/fixture 的 artifact integrity 可以离线验证；
- [ ] C：snapshot reference 可以通过 caller-supplied resolver 解析并验证 SHA-256；
- [ ] C：即使 snapshot verified，reproducible mode 仍不会在没有 executor 的情况下被错误标记为 available；
- [ ] 三条 PR 均有 focused tests 和 Agent Note；
- [ ] 三条 PR 均通过 repository static gates；
- [ ] Integration PR 更新 README/Pages；
- [ ] 最终 Pages deployment success；
- [ ] 没有 synthetic benchmark result 被提交或展示成真实 measurement；
- [ ] 没有因 diagnostics/replay tooling 引入未声明的 runtime behavior change。

## 最终判断

这一轮的重点不是“再加三个 feature”，而是把第一轮已经建立的证据基础变成三个可靠的工程接口：

1. **能把一次 session 解释清楚；**
2. **能把一次 experiment 证明清楚；**
3. **能把一个 snapshot reference 验证成真实 artifact。**

完成这三点后，项目才真正具备进入 reproducible executor、真实 benchmark campaign 和 developer-facing UI 的条件。
