from __future__ import annotations

import numpy as np
import pandas as pd

from vol_agent.agent import VolatilityTraderAgent
from vol_agent.config import AgentConfig


def make_frame(prices: np.ndarray) -> pd.DataFrame:
    index = pd.date_range("2024-01-01", periods=len(prices), freq="D")
    return pd.DataFrame(
        {
            "Open": prices,
            "High": prices * 1.01,
            "Low": prices * 0.99,
            "Close": prices,
        },
        index=index,
    )


def build_agent(tmp_path) -> VolatilityTraderAgent:
    config = AgentConfig(
        universe=["^VIX", "^VIX3M", "SVXY", "UVXY", "SPY"],
        nav_usd=100_000,
        carry_base_pct_nav=0.04,
        carry_max_pct_nav=0.08,
        mean_reversion_max_pct_nav=0.04,
        tail_hedge_max_pct_nav=0.03,
        max_portfolio_vol_contribution_annualized=0.03,
        forward_accuracy_window_days=5,
        contango_ratio_threshold=0.9,
        backwardation_ratio_threshold=1.05,
        mean_reversion_vix_threshold=30.0,
        mean_reversion_stop_vix=40.0,
        cheap_tail_vix_threshold=13.0,
        confidence_floor=0.35,
        confidence_ceiling=0.95,
        correlation_window_days=20,
        correlation_threshold=0.70,
        correlation_fraction_threshold=0.60,
        sqlite_path=str(tmp_path / "vol.sqlite3"),
        allow_live_execution=False,
    )
    return VolatilityTraderAgent(config)


def test_regime_classification_detects_contango_and_backwardation(tmp_path) -> None:
    agent = build_agent(tmp_path)
    base = np.linspace(40, 50, 120)
    market_data = {
        "^VIX": make_frame(np.linspace(14, 15, 120)),
        "^VIX3M": make_frame(np.linspace(18, 19, 120)),
        "SVXY": make_frame(base),
        "UVXY": make_frame(np.linspace(10, 9, 120)),
        "SPY": make_frame(np.linspace(500, 515, 120)),
    }

    signal = agent.generate_signals(market_data=market_data)

    assert signal.regime == "contango"
    assert signal.carry_signal == "long_svxy"
    assert signal.mean_reversion_signal == "flat"

    fear_data = {
        "^VIX": make_frame(np.linspace(34, 36, 120)),
        "^VIX3M": make_frame(np.linspace(29, 30, 120)),
        "SVXY": make_frame(base),
        "UVXY": make_frame(np.linspace(12, 18, 120)),
        "SPY": make_frame(np.linspace(500, 470, 120)),
    }

    fear_signal = agent.generate_signals(market_data=fear_data)

    assert fear_signal.regime == "backwardation"
    assert fear_signal.carry_signal == "long_uvxy"
    assert fear_signal.mean_reversion_signal == "long_svxy"
