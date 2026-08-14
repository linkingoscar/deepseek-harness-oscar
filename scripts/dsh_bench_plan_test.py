from __future__ import annotations

import unittest

from dsh_bench_plan import build_counterbalanced_mode_plan, variant_order


class CounterbalancedPlanTests(unittest.TestCase):
    def test_order_flips_across_tasks_and_repetitions(self) -> None:
        plan = build_counterbalanced_mode_plan(["a", "b"], 2)
        observed = [(row.task, row.repetition, row.variant) for row in plan]
        self.assertEqual(
            observed,
            [
                ("a", 1, "native"),
                ("a", 1, "code"),
                ("b", 1, "code"),
                ("b", 1, "native"),
                ("a", 2, "code"),
                ("a", 2, "native"),
                ("b", 2, "native"),
                ("b", 2, "code"),
            ],
        )

    def test_each_pair_contains_both_variants_once(self) -> None:
        plan = build_counterbalanced_mode_plan(["a", "b", "c"], 3)
        buckets: dict[tuple[str, int], list[str]] = {}
        for row in plan:
            buckets.setdefault((row.task, row.repetition), []).append(row.variant)
        self.assertEqual(len(buckets), 9)
        for variants in buckets.values():
            self.assertEqual(set(variants), {"native", "code"})
            self.assertEqual(len(variants), 2)

    def test_invalid_indices_are_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "repetition"):
            variant_order(repetition=0, task_index=0)
        with self.assertRaisesRegex(ValueError, "task_index"):
            variant_order(repetition=1, task_index=-1)
        with self.assertRaisesRegex(ValueError, "repeat"):
            build_counterbalanced_mode_plan(["a"], 0)


if __name__ == "__main__":
    unittest.main()
