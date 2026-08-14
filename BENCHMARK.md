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
- tool calls and structured tool errors,
- uncached input tokens,
- output tokens,
- cache-read and cache-write tokens,
- reasoning tokens,
- billed input tokens (`input + cache read + cache write`).

Token fields are summed from `assistant/message.data.usage` when the selected adapter reports usage. Missing provider accounting remains missing rather than being estimated.

## Compare a candidate

Run the same task ids and repetition count on the candidate branch or composition, then compare paired observations:

```sh
python scripts/dsh_bench.py compare \
  .bench/baseline.jsonl \
  .bench/candidate.jsonl
```

The comparison reports baseline/candidate summaries, candidate-minus-baseline deltas, and explicit pass-to-fail regressions or fail-to-pass improvements. Pairing is by `(task_id, repetition)`, so unrelated or partially completed runs do not silently contaminate the comparison.

## Benchmark discipline

For changes intended to improve agent quality, keep the following together in the PR:

1. the hypothesis (for example, "Code Mode reduces tool-round trips on repository search tasks"),
2. the benchmark task set or a reproducible reference to it,
3. baseline and candidate settings,
4. pass-rate and efficiency deltas,
5. any known regressions.

A benchmark runner does not remove model variance. Repeat stochastic tasks, use the same worktree preparation, provider/model settings, and task checks, and treat small deltas cautiously.
