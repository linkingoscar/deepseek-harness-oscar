# Running benchmarks

This fork treats benchmark deltas as a first-class development signal. The goal is not to bless one public leaderboard, but to make every agent-loop, prompt, tool, Code Mode, or context-policy change measurable on the task sets you care about.

The repository includes `scripts/dsh_bench.py`, a JSONL benchmark runner built on the existing Python SDK and durable session events. The runner separates observation collection from offline validation, pairing, fixture replay, and report rendering. Offline commands never synthesize benchmark observations.

## Task format

Each line in the task file is one JSON object:

```json
{"id":"fix-parser","workspace":"/tmp/worktrees/fix-parser","prompt":"Inspect the repository and fix the failing parser tests.","prepare":["git","reset","--hard","HEAD"],"check":["python","-m","pytest","tests/test_parser.py"]}
```

Required fields:

- `id`: stable task identifier.
- `workspace`: isolated checkout or disposable directory the agent may modify.
- `prompt`: user task sent to the harness.

Optional fields:

- `prepare`: argv array run before the agent. It must exit zero or the task is recorded as a prepare failure.
- `check`: argv array run after the agent. Exit zero means pass. Tasks without a check are retained as unscored trajectory measurements.

Commands are executed directly, not through a shell. This keeps task definitions explicit and avoids accidental shell interpolation. Use disposable workspaces: the benchmark agent can modify files according to the selected Harness composition.

## Run a benchmark

Install the Python SDK as documented in [Get started with the Python SDK](docs/user/guide/python-sdk.md), then run:

```sh
python scripts/dsh_bench.py run benchmarks/tasks.jsonl \
  --output .bench/baseline.jsonl \
  --model deepseek-v4-flash \
  --repeat 3
```

Useful options:

- `--provider`: Harness provider route. Defaults to `deepseek-official`.
- `--model`: model id. Defaults to `deepseek-v4-flash`.
- `--max-tokens`: optional per-request output cap.
- `--cordis`: run a specific Cordis composition instead of the SDK default.
- `--session-root`: retain durable session logs at a chosen location.
- `--command-timeout`: timeout for `prepare` and `check` commands, in seconds.
- `--run-id`: stable prefix for generated benchmark session ids.

The output file contains one JSON object per task run so interrupted benchmark jobs keep their completed observations. Each row is versioned with `schema_version: 1` and `kind: "benchmark-result"`.

## Result schema and task identity

Every result row records the task id and repetition plus a `task_fingerprint`. The fingerprint is a SHA-256 digest over the semantic task definition: `id`, `prompt`, `prepare`, and `check`. The workspace path is deliberately excluded so the same task can run in separate disposable checkouts.

A paired comparison rejects equal `(task_id, repetition)` keys whose task fingerprints differ. This prevents a changed prompt or checker from being silently compared as if it were the same benchmark task.

Results also separate three concepts:

- `status`: harness lifecycle state (`completed`, `prepare-failed`, or `agent-failed`).
- `outcome`: benchmark outcome (`passed`, `failed`, or `unscored`).
- `failure_kind`: closed failure taxonomy for failed observations.

The current failure kinds are:

- `prepare-timeout`: the prepare command exceeded the command timeout.
- `prepare-exec-error`: the prepare command could not be spawned.
- `prepare-nonzero`: the prepare command exited non-zero.
- `agent-exception`: the Python harness invocation raised an exception.
- `check-timeout`: the post-run check exceeded the command timeout.
- `check-exec-error`: the post-run check could not be spawned.
- `check-nonzero`: the post-run check exited non-zero.

A failed unscored task remains `success: null`; its harness failure is represented by `outcome` and `failure_kind`. This keeps `success` tied to scored task checks while still making infrastructure and execution failures visible.

The benchmark result format is pre-release tooling data. Schema versions are explicit, and offline validation rejects unsupported versions instead of guessing how an older row should be interpreted.

## What is measured

Metrics are derived from the same root-session events that drive replay:

- pass/fail from the task's post-run check,
- wall-clock agent time,
- finish reason,
- turns and steps,
- model-visible top-level tool calls and structured tool errors,
- `run_code` calls,
- Code Mode sub-dispatches and sub-dispatch errors,
- operational leaf tool calls,
- uncached input tokens,
- output tokens,
- cache-read and cache-write tokens,
- reasoning tokens,
- billed input tokens (`input + cache read + cache write`),
- request-header count and prompt-envelope character diagnostics.

`tool_calls` counts `tool/call` events, so it measures model-visible calls. That number is intentionally not used as a proxy for execution work under Code Mode: one `run_code` can dispatch many tools without putting those sub-calls into model history. The runner therefore also counts `tool/code-dispatch` events and reports:

```text
leaf_tool_calls = tool_calls - run_code_calls + code_subcalls
```

In native mode `leaf_tool_calls == tool_calls`. In Code Mode the transport call is removed and the actual SDK sub-dispatches are added back. This lets a comparison distinguish fewer model round trips from less underlying tool work.

Token fields are summed from `assistant/message.data.usage` when the selected adapter reports usage. Missing provider accounting remains missing rather than being estimated.

## Validate result files offline

Before comparing or archiving observations, validate them without invoking a model:

```sh
python scripts/dsh_bench.py validate \
  .bench/baseline.jsonl \
  .bench/candidate.jsonl
```

Validation checks the versioned result schema and cross-row invariants. In particular it rejects:

- duplicate `(task_id, repetition)` keys,
- invalid status/outcome/failure combinations,
- inconsistent command timeout/spawn/exit diagnostics,
- non-contiguous repetition numbers for a task,
- mixed provider/model/variant values inside one result file,
- inconsistent derived metrics such as `leaf_tool_calls` or `billed_input_tokens`.

The command prints a digest for each canonicalized result file. The digest identifies the validated observations; it does not attest that a benchmark task or checker is well designed.

## Compare a candidate

Run the same task ids and repetition count on the candidate branch or composition, then compare paired observations:

```sh
python scripts/dsh_bench.py compare \
  .bench/baseline.jsonl \
  .bench/candidate.jsonl \
  --output .bench/comparison.json \
  --report .bench/report.md
```

Pairing is by `(task_id, repetition)` and requires equal task fingerprints and scored/unscored status. The comparison JSON is versioned as `kind: "benchmark-comparison"` and includes a `pairs` array. Each `benchmark-pair` contains baseline/candidate diagnostic views, candidate-minus-baseline per-run deltas, and explicit outcome/failure transitions.

Pair completeness is strict by default. If either file has an unmatched key, `compare` exits with an error instead of silently dropping the observation. For an intentionally interrupted run, use `--allow-partial` to compare only the intersection; the comparison records `pairing.complete: false` plus every baseline-only and candidate-only key.

The comparison also reports baseline/candidate summaries, candidate-minus-baseline aggregate deltas, pass-to-fail regressions, fail-to-pass changes, failure counts, and failure transitions. These are descriptive measurements, not an automatic verdict about either configuration.

## Capture and replay an observed-result fixture

A paired fixture freezes already-recorded observations and the exact comparison expected from the current harness logic:

```sh
python scripts/dsh_bench.py fixture \
  .bench/baseline.jsonl \
  .bench/candidate.jsonl \
  --output .bench/paired-fixture.json
```

The fixture contains canonical baseline/candidate result rows, SHA-256 digests for both sets, and the expected comparison. It does not run tasks, invoke a provider, estimate missing metrics, or create substitute benchmark observations. Because it stores the original result rows verbatim, treat it with the same care as the source JSONL, including any final responses or local paths in those rows.

Replay the fixture entirely offline:

```sh
python scripts/dsh_bench.py replay \
  .bench/paired-fixture.json \
  --output .bench/replayed-comparison.json \
  --report .bench/replayed-report.md
```

Replay validates both result sets, verifies their digests, recomputes the comparison, and fails if the recomputed JSON differs from `expected_comparison`. This gives benchmark-harness changes a deterministic regression surface without pretending that deterministic replay removes model variance from the original observations.

## Render a report from comparison JSON

Report generation is also offline:

```sh
python scripts/dsh_bench.py report \
  .bench/comparison.json \
  --output .bench/report.md
```

The Markdown report includes pairing completeness, outcome counts, diagnostic medians, failure taxonomy, and paired outcome/failure transitions. The renderer deliberately states that it summarizes recorded observations only and does not infer which agent composition or execution mode is better.

## Native vs Code Mode

The repository includes two checked-in native/Code Mode pairs. The default `fs` pair is intentionally structured-tool-only:

- `examples/jsonrpc-agent/minimal-fs.cordis.yml`: native `read`/`write`/`edit`/`glob`/`grep`.
- `examples/jsonrpc-agent/minimal-fs-code.cordis.yml`: the same capabilities through TypeScript Code Mode.

This pair omits Bash on purpose. An arbitrary shell is already a programmable batching surface (`grep | awk | xargs`, Python one-liners, and so on), so a shell-rich benchmark can hide the difference Code Mode is meant to create. The `fs` pair instead tests whether moving structured tool orchestration into the execution plane changes model round trips and context growth.

For coding tasks that specifically need a persistent shell, the `shell` pair remains available:

- `examples/jsonrpc-agent/minimal.cordis.yml`: native persistent Bash + string-replace editor.
- `examples/jsonrpc-agent/minimal-code.cordis.yml`: the same capabilities through Code Mode.

Run the same task set through both compositions with one command:

```sh
python scripts/dsh_bench.py compare-modes benchmarks/tasks.jsonl \
  --output-dir .bench/code-mode \
  --toolset fs \
  --model deepseek-v4-flash \
  --repeat 3
```

`--toolset fs` is the default; pass `--toolset shell` for the persistent-Bash pair. Either side can also be overridden with `--native-cordis` / `--code-cordis`.

This writes:

- `.bench/code-mode/native.jsonl`
- `.bench/code-mode/code.jsonl`
- `.bench/code-mode/comparison.json`
- `.bench/code-mode/report.md`
- separate durable session directories under `.bench/code-mode/sessions/`

Each task's `prepare` command runs before every repetition in every mode, so a destructive coding task must reset its workspace completely. Do not compare modes against a workspace whose prepare step leaves changes from the previous variant.

The useful questions are empirical and should be answered from the recorded observations, for example:

1. Does pass rate differ between the paired runs?
2. How do model steps and model-visible tool calls differ?
3. Does a tool-call difference survive the leaf-call view?
4. How do billed input/output tokens and wall-clock latency differ?
5. Are failures concentrated in `run_code`, its sub-dispatches, or the same leaf tools that fail in the native composition?

Do not call Code Mode an efficiency win solely because `tool_calls` fell. The benchmark harness reports observations and pair transitions; interpretation belongs in the experiment or PR discussion and must account for task success, leaf work, tokens, latency, and model variance.

For a checked-in diagnostic workload, materialize the [Code Mode micro-eval suite](benchmarks/code-mode/README.md). It creates disposable deterministic task workspaces and emits task JSONL that runs through the same `compare-modes` path. Those fixtures define tasks and checkers; they are not precomputed benchmark results.

## Benchmark discipline

For changes intended to improve agent quality, keep the following together in the PR:

1. the hypothesis,
2. the benchmark task set or a reproducible reference to it,
3. baseline and candidate settings,
4. validated paired observations and relevant deltas,
5. any known regressions or incomplete pairs.

A benchmark runner does not remove model variance. Repeat stochastic tasks, use the same task definitions and worktree preparation, provider/model settings, and task checks, and treat small deltas cautiously. Use offline fixtures to validate harness logic, not to manufacture evidence about agent quality.
