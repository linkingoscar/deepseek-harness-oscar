# Code Mode micro-eval suite

This suite isolates workloads where an execution plane can plausibly help: fan-out reads, search-then-read aggregation, multi-file edits, and dependency traversal. It is synthetic on purpose. The fixtures make task correctness deterministic while the Harness trajectory remains free to vary.

Materialize disposable workspaces and a benchmark JSONL file:

```sh
python benchmarks/code-mode/suite.py materialize \
  --output .bench/code-mode/tasks.jsonl \
  --work-root .bench/code-mode/workspaces
```

Then run the capability-matched structured-tool comparison:

```sh
python scripts/dsh_bench.py compare-modes .bench/code-mode/tasks.jsonl \
  --output-dir .bench/code-mode/results \
  --toolset fs \
  --repeat 3
```

The four cases exercise different orchestration patterns:

- `aggregate-services`: glob a fan-out set, read every file, aggregate, and write one answer.
- `critical-timeouts`: grep a marker, read only matching files, aggregate fields, and write one answer.
- `beta-retry-migration`: discover matching configs, read before edit, mutate only qualifying files, and record exactly what changed.
- `dependency-closure`: start from roots, follow a dynamic transitive graph through file reads, and aggregate the reachable set.

Every benchmark repetition runs a `prepare` command that restores the case from the suite's in-code fixture, and the post-run `check` command verifies the complete final file set. Unexpected files, collateral source changes, malformed JSON, and incorrect semantic answers fail the task.

These cases are not a replacement for repository-scale coding evals. They are a diagnostic layer: if Code Mode cannot reduce model round trips on these deliberately execution-heavy workloads without hurting correctness, making it the default deserves skepticism. If it does, the next step is to test whether that advantage survives realistic repositories and shell-capable profiles.
