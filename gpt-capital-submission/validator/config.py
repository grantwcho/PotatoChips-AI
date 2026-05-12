from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from .replay.loader import DEFAULT_GOLD_REPLAY_PATH


@dataclass(frozen=True)
class ValidationConfig:
    replay_path: Path = DEFAULT_GOLD_REPLAY_PATH
    boot_timeout_s: float = 60.0
    p99_latency_limit_ms: float = 500.0
    activity_flag_threshold: float = 0.02
    accept_activity_rate: float = 0.05
    accept_introspection_coverage: float = 0.7
    accept_differentiation: float = 0.18
    accept_informativeness: float = 0.6
    packaging_checkpoint_count: int = 10
    stability_checkpoint_ids: list[str] = field(
        default_factory=lambda: ["mkt-001", "news-003", "mkt-011"]
    )
    llm_cache_dir: Path = Path(".gptcap_cache")
    anthropic_model: str = "claude-sonnet-4-5"
