from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path
from typing import Any

import yaml


@dataclass
class AgentConfig:
    universe: list[str]
    nav_usd: float
    target_daily_vol_per_position: float
    target_annualized_vol: float
    max_position_pct_nav: float
    max_gross_exposure_pct_nav: float
    max_drawdown_pct: float
    pause_days_after_breaker: int
    fast_ma_days: int
    slow_ma_days: int
    trend_filter_days: int
    breakout_days: int
    atr_window_days: int
    trailing_stop_atr_multiple: float
    correlation_window_days: int
    correlation_threshold: float
    correlation_fraction_threshold: float
    sqlite_path: str
    allow_live_execution: bool

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "AgentConfig":
        portfolio = payload.get("portfolio", {}) or {}
        signals = payload.get("signals", {}) or {}
        risk = payload.get("risk", {}) or {}
        storage = payload.get("storage", {}) or {}
        execution = payload.get("execution", {}) or {}
        universe = payload.get("universe", []) or []

        return cls(
            universe=[str(symbol).upper() for symbol in universe],
            nav_usd=float(portfolio.get("nav_usd", 100_000)),
            target_daily_vol_per_position=float(
                portfolio.get("target_daily_vol_per_position", 0.001)
            ),
            target_annualized_vol=float(portfolio.get("target_annualized_vol", 0.10)),
            max_position_pct_nav=float(portfolio.get("max_position_pct_nav", 0.20)),
            max_gross_exposure_pct_nav=float(
                portfolio.get("max_gross_exposure_pct_nav", 1.50)
            ),
            max_drawdown_pct=float(portfolio.get("max_drawdown_pct", 0.10)),
            pause_days_after_breaker=int(
                portfolio.get("pause_days_after_breaker", 5)
            ),
            fast_ma_days=int(signals.get("fast_ma_days", 20)),
            slow_ma_days=int(signals.get("slow_ma_days", 60)),
            trend_filter_days=int(signals.get("trend_filter_days", 200)),
            breakout_days=int(signals.get("breakout_days", 40)),
            atr_window_days=int(signals.get("atr_window_days", 20)),
            trailing_stop_atr_multiple=float(
                signals.get("trailing_stop_atr_multiple", 3.0)
            ),
            correlation_window_days=int(risk.get("correlation_window_days", 20)),
            correlation_threshold=float(risk.get("correlation_threshold", 0.70)),
            correlation_fraction_threshold=float(
                risk.get("correlation_fraction_threshold", 0.60)
            ),
            sqlite_path=str(storage.get("sqlite_path", ".data/agt_trend_001.sqlite3")),
            allow_live_execution=bool(execution.get("allow_live_execution", False)),
        )


def load_config(config_path: str | Path | None = None) -> AgentConfig:
    root = Path(__file__).resolve().parents[1]
    resolved = Path(config_path) if config_path else root / "config" / "default.yaml"
    with resolved.open("r", encoding="utf-8") as handle:
        payload = yaml.safe_load(handle) or {}

    config = AgentConfig.from_dict(payload)
    sqlite_path = Path(config.sqlite_path)
    state_dir = os.getenv("GPTCAPITAL_AGENT_STATE_DIR", "").strip()

    if state_dir:
        sqlite_path = Path(state_dir).expanduser() / "agt_trend_001.sqlite3"
    elif not sqlite_path.is_absolute():
        sqlite_path = (resolved.parent.parent / sqlite_path).resolve()

    sqlite_path.parent.mkdir(parents=True, exist_ok=True)

    return AgentConfig(
        universe=config.universe,
        nav_usd=config.nav_usd,
        target_daily_vol_per_position=config.target_daily_vol_per_position,
        target_annualized_vol=config.target_annualized_vol,
        max_position_pct_nav=config.max_position_pct_nav,
        max_gross_exposure_pct_nav=config.max_gross_exposure_pct_nav,
        max_drawdown_pct=config.max_drawdown_pct,
        pause_days_after_breaker=config.pause_days_after_breaker,
        fast_ma_days=config.fast_ma_days,
        slow_ma_days=config.slow_ma_days,
        trend_filter_days=config.trend_filter_days,
        breakout_days=config.breakout_days,
        atr_window_days=config.atr_window_days,
        trailing_stop_atr_multiple=config.trailing_stop_atr_multiple,
        correlation_window_days=config.correlation_window_days,
        correlation_threshold=config.correlation_threshold,
        correlation_fraction_threshold=config.correlation_fraction_threshold,
        sqlite_path=str(sqlite_path),
        allow_live_execution=config.allow_live_execution,
    )
