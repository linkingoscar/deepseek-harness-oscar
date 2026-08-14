from __future__ import annotations

from dataclasses import dataclass
from typing import Generic, Sequence, TypeVar

T = TypeVar("T")


@dataclass(frozen=True, slots=True)
class ModeRun(Generic[T]):
    task: T
    repetition: int
    variant: str


def variant_order(*, repetition: int, task_index: int) -> tuple[str, str]:
    """Return a deterministic, counterbalanced native/code ordering.

    Repetition is one-based. Adjacent tasks and repetitions flip which variant
    goes first, while every task/repetition pair still executes both variants
    back-to-back.
    """
    if repetition < 1:
        raise ValueError("repetition must be >= 1")
    if task_index < 0:
        raise ValueError("task_index must be >= 0")
    return ("native", "code") if (repetition + task_index) % 2 == 1 else ("code", "native")


def build_counterbalanced_mode_plan(tasks: Sequence[T], repeat: int) -> list[ModeRun[T]]:
    """Build a deterministic run plan for paired native/Code Mode comparisons."""
    if repeat < 1:
        raise ValueError("repeat must be >= 1")
    plan: list[ModeRun[T]] = []
    for repetition in range(1, repeat + 1):
        for task_index, task in enumerate(tasks):
            for variant in variant_order(repetition=repetition, task_index=task_index):
                plan.append(ModeRun(task=task, repetition=repetition, variant=variant))
    return plan
