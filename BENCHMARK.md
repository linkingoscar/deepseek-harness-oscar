# Running benchmarks

This fork treats benchmark deltas as a first-class development signal. The goal is not to bless one public leaderboard, but to make every agent-loop, prompt, tool, Code Mode, or context-policy change measurable on the task sets you care about.

The repository includes `scripts/dsh_bench.py`, a small JSONL benchmark runner built on the existing Python SDK and durable session events.

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

- `prepare`: argv array run before the agent. It must exit zero or the task is recorded as `prepare-failed`.
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

The output file contains one JSON object per task run so interrupted benchmark jobs keep their completed observations.

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
- billed input tokens (`input + cache read + cache write`).

`tool_calls` counts `tool/call` events, so it measures model-visible calls. That number is intentionally not used as a proxy for execution work under Code Mode: one `run_code` can dispatch many tools without putting those sub-calls into model history. The runner therefore also counts `tool/code-dispatch` events and reports:

```text
leaf_tool_calls = tool_calls - run_code_calls + code_subcalls
```

In native mode `leaf_tool_calls == tool_calls`. In Code Mode the transport call is removed and the actual SDK sub-dispatches are added back. This lets a comparison distinguish fewer model round trips from less underlying tool work.

Token fields are summed from `assistant/message.data.usage` when the selected adapter reports usage. Missing provider accounting remains missing rather than being estimated.

## Compare a candidate

Run the same task ids and repetition count on the candidate branch or composition, then compare paired observations:

```sh
python scripts/dsh_bench.py compare \
  .bench/baseline.jsonl \
  .bench/candidate.jsonl
```

The comparison reports baseline/candidate summaries, candidate-minus-baseline deltas, and explicit pass-to-fail regressions or fail-to-pass improvements. Pairing is by `(task_id, repetition)`, so unrelated or partially completed runs do not silently contaminate the comparison.

## Native vs Code Mode

The repository includes two deliberately narrow JSON-RPC compositions with the same model-facing capabilities:

- `examples/jsonrpc-agent/minimal.cordis.yml`: native function calling.
- `examples/jsonrpc-agent/minimal-code.cordis.yml`: TypeScript Code Mode using `@deepseek-ai/dsh-code-runtime-worker-thread`.

The Code Mode composition keeps the same persistent Bash and string-replace editor tools and the same danger-full-access benchmark posture. Its meaningful experimental differences are the tool presentation (`mode: code`) and the worker-thread execution transport needed by `run_code`.

Run the same task set through both compositions with one command:

```sh
python scripts/dsh_bench.py compare-modes benchmarks/tasks.jsonl \
  --output-dir .bench/code-mode \
  --model deepseek-v4-flash \
  --repeat 3
```

This writes:

- `.bench/code-mode/native.jsonl`
- `.bench/code-mode/code.jsonl`
- `.bench/code-mode/comparison.json`
- separate durable session directories under `.bench/code-mode/sessions/`

Each task's `prepare` command runs before every repetition in every mode, so a destructive coding task must reset its workspace completely. Do not compare modes against a workspace whose prepare step leaves changes from the previous variant.

The first Code Mode questions to answer are empirical:

1. Does pass rate improve, regress, or stay flat?
2. Does Code Mode reduce model steps and model-visible tool calls?
3. Is any reduction merely transport collapse, or does `leaf_tool_calls` also fall?
4. What happens to billed input/output tokens and wall-clock latency?
5. Are failures concentrated in `run_code`, its sub-dispatches, or the same leaf tools that fail natively?

Do not call Code Mode an efficiency win solely because `tool_calls` fell. A successful result is stronger when task success holds or improves and the reduction survives the leaf-call, token, and latency views.

## Benchmark discipline

For changes intended to improve agent quality, keep the following together in the PR:

1. the hypothesis (for example, "Code Mode reduces model round trips on repository search tasks without lowering success rate"),
2. the benchmark task set or a reproducible reference to it,
3. baseline and candidate settings,
4. pass-rate and efficiency deltas,
5. any known regressions.

A benchmark runner does not remove model variance. Repeat stochastic tasks, use the same worktree preparation, provider/model settings, and task checks, and treat small deltas cautiously.
