from __future__ import annotations

from ..replay.runner import ReplayTrace
from ..scorecard import ActivityRateResult


def evaluate_activity_rate(
    trace: ReplayTrace,
    *,
    flag_threshold: float,
) -> ActivityRateResult:
    total = len(trace.steps)
    active = sum(1 for step in trace.steps if step.signal_count > 0)
    score = 0.0 if total == 0 else active / total
    return ActivityRateResult(score=round(score, 4), flag=score < flag_threshold)
