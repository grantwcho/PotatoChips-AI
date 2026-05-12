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
    lookback_days: int
    zscore_window: int
    entry_zscore: float
    exit_zscore: float
    stop_zscore: float
    max_active_pairs: int
    max_pair_pct_nav: float
    max_net_exposure_pct_nav: float
    cointegration_break_pvalue: float
    max_half_life_days: float
    sqlite_path: str
    allow_live_execution: bool

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "AgentConfig":
        portfolio = payload.get("portfolio", {}) or {}
        signals = payload.get("signals", {}) or {}
        storage = payload.get("storage", {}) or {}
        execution = payload.get("execution", {}) or {}
        universe = payload.get("universe", []) or []

        return cls(
            universe=[str(symbol).upper() for symbol in universe],
            nav_usd=float(portfolio.get("nav_usd", 100_000)),
            lookback_days=int(signals.get("lookback_days", 60)),
            zscore_window=int(signals.get("zscore_window", 60)),
            entry_zscore=float(signals.get("entry_zscore", 2.0)),
            exit_zscore=float(signals.get("exit_zscore", 0.5)),
            stop_zscore=float(signals.get("stop_zscore", 4.0)),
            max_active_pairs=int(portfolio.get("max_active_pairs", 10)),
            max_pair_pct_nav=float(portfolio.get("max_pair_pct_nav", 0.05)),
            max_net_exposure_pct_nav=float(
                portfolio.get("max_net_exposure_pct_nav", 0.02)
            ),
            cointegration_break_pvalue=float(
                signals.get("cointegration_break_pvalue", 0.10)
            ),
            max_half_life_days=float(signals.get("max_half_life_days", 15.0)),
            sqlite_path=str(storage.get("sqlite_path", ".data/agt_statarb_001.sqlite3")),
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
        sqlite_path = Path(state_dir).expanduser() / "agt_statarb_001.sqlite3"
    elif not sqlite_path.is_absolute():
        sqlite_path = (resolved.parent.parent / sqlite_path).resolve()

    sqlite_path.parent.mkdir(parents=True, exist_ok=True)

    return AgentConfig(
        universe=config.universe,
        nav_usd=config.nav_usd,
        lookback_days=config.lookback_days,
        zscore_window=config.zscore_window,
        entry_zscore=config.entry_zscore,
        exit_zscore=config.exit_zscore,
        stop_zscore=config.stop_zscore,
        max_active_pairs=config.max_active_pairs,
        max_pair_pct_nav=config.max_pair_pct_nav,
        max_net_exposure_pct_nav=config.max_net_exposure_pct_nav,
        cointegration_break_pvalue=config.cointegration_break_pvalue,
        max_half_life_days=config.max_half_life_days,
        sqlite_path=str(sqlite_path),
        allow_live_execution=config.allow_live_execution,
    )
