from __future__ import annotations

from statistics import quantiles

from ..runtime import RuntimeStats
from ..scorecard import LivenessResult


def evaluate_liveness(
    *,
    boot_s: float,
    endpoint_latencies_ms: list[float],
    runtime_stats: RuntimeStats,
    boot_limit_s: float,
    p99_limit_ms: float,
) -> LivenessResult:
    p99_ms = _p99(endpoint_latencies_ms)
    details_parts = []
    if runtime_stats.crashed:
        details_parts.append("container crashed")
    if runtime_stats.oom_killed:
        details_parts.append("container OOM-killed")
    if runtime_stats.max_memory_mb:
        details_parts.append(f"max_mem={runtime_stats.max_memory_mb:.1f}MB")
    passed = (
        boot_s < boot_limit_s
        and p99_ms < p99_limit_ms
        and not runtime_stats.crashed
        and not runtime_stats.oom_killed
    )
    return LivenessResult.model_validate(
        {
            "pass": passed,
            "boot_s": round(boot_s, 4),
            "p99_ms": round(p99_ms, 4),
            "details": ", ".join(details_parts) if details_parts else None,
        }
    )


def _p99(values: list[float]) -> float:
    if not values:
        return 0.0
    if len(values) == 1:
        return values[0]
    return float(quantiles(values, n=100, method="inclusive")[98])
