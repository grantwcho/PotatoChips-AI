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
    carry_base_pct_nav: float
    carry_max_pct_nav: float
    mean_reversion_max_pct_nav: float
    tail_hedge_max_pct_nav: float
    max_portfolio_vol_contribution_annualized: float
    forward_accuracy_window_days: int
    contango_ratio_threshold: float
    backwardation_ratio_threshold: float
    mean_reversion_vix_threshold: float
    mean_reversion_stop_vix: float
    cheap_tail_vix_threshold: float
    confidence_floor: float
    confidence_ceiling: float
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
            carry_base_pct_nav=float(portfolio.get("carry_base_pct_nav", 0.04)),
            carry_max_pct_nav=float(portfolio.get("carry_max_pct_nav", 0.08)),
            mean_reversion_max_pct_nav=float(
                portfolio.get("mean_reversion_max_pct_nav", 0.04)
            ),
            tail_hedge_max_pct_nav=float(portfolio.get("tail_hedge_max_pct_nav", 0.03)),
            max_portfolio_vol_contribution_annualized=float(
                portfolio.get("max_portfolio_vol_contribution_annualized", 0.03)
            ),
            forward_accuracy_window_days=int(
                portfolio.get("forward_accuracy_window_days", 5)
            ),
            contango_ratio_threshold=float(
                signals.get("contango_ratio_threshold", 0.9)
            ),
            backwardation_ratio_threshold=float(
                signals.get("backwardation_ratio_threshold", 1.05)
            ),
            mean_reversion_vix_threshold=float(
                signals.get("mean_reversion_vix_threshold", 30.0)
            ),
            mean_reversion_stop_vix=float(
                signals.get("mean_reversion_stop_vix", 40.0)
            ),
            cheap_tail_vix_threshold=float(
                signals.get("cheap_tail_vix_threshold", 13.0)
            ),
            confidence_floor=float(signals.get("confidence_floor", 0.35)),
            confidence_ceiling=float(signals.get("confidence_ceiling", 0.95)),
            correlation_window_days=int(risk.get("correlation_window_days", 20)),
            correlation_threshold=float(risk.get("correlation_threshold", 0.70)),
            correlation_fraction_threshold=float(
                risk.get("correlation_fraction_threshold", 0.60)
            ),
            sqlite_path=str(storage.get("sqlite_path", ".data/agt_vol_001.sqlite3")),
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
        sqlite_path = Path(state_dir).expanduser() / "agt_vol_001.sqlite3"
    elif not sqlite_path.is_absolute():
        sqlite_path = (resolved.parent.parent / sqlite_path).resolve()

    sqlite_path.parent.mkdir(parents=True, exist_ok=True)

    return AgentConfig(
        universe=config.universe,
        nav_usd=config.nav_usd,
        carry_base_pct_nav=config.carry_base_pct_nav,
        carry_max_pct_nav=config.carry_max_pct_nav,
        mean_reversion_max_pct_nav=config.mean_reversion_max_pct_nav,
        tail_hedge_max_pct_nav=config.tail_hedge_max_pct_nav,
        max_portfolio_vol_contribution_annualized=config.max_portfolio_vol_contribution_annualized,
        forward_accuracy_window_days=config.forward_accuracy_window_days,
        contango_ratio_threshold=config.contango_ratio_threshold,
        backwardation_ratio_threshold=config.backwardation_ratio_threshold,
        mean_reversion_vix_threshold=config.mean_reversion_vix_threshold,
        mean_reversion_stop_vix=config.mean_reversion_stop_vix,
        cheap_tail_vix_threshold=config.cheap_tail_vix_threshold,
        confidence_floor=config.confidence_floor,
        confidence_ceiling=config.confidence_ceiling,
        correlation_window_days=config.correlation_window_days,
        correlation_threshold=config.correlation_threshold,
        correlation_fraction_threshold=config.correlation_fraction_threshold,
        sqlite_path=str(sqlite_path),
        allow_live_execution=config.allow_live_execution,
    )
