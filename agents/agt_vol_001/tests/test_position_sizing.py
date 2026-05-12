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


def test_position_sizing_respects_caps_without_synthetic_delta_hedge(tmp_path) -> None:
    agent = build_agent(tmp_path)
    market_data = {
        "^VIX": make_frame(np.linspace(15, 16, 120)),
        "^VIX3M": make_frame(np.linspace(19, 20, 120)),
        "SVXY": make_frame(np.linspace(40, 60, 120) + np.sin(np.linspace(0, 6, 120))),
        "UVXY": make_frame(np.linspace(15, 10, 120) + np.cos(np.linspace(0, 6, 120))),
        "SPY": make_frame(np.linspace(500, 530, 120) + np.sin(np.linspace(0, 4, 120))),
    }

    signal = agent.generate_signals(market_data=market_data)
    instructions = agent.size_positions(signal, market_data=market_data)
    by_component = {instruction.component: instruction for instruction in instructions}

    assert by_component["carry"].symbol == "SVXY"
    assert by_component["carry"].side == "long"
    assert abs(by_component["carry"].target_position_pct_nav) <= agent.config.carry_max_pct_nav
    assert "delta_hedge" not in by_component
    assert all(instruction.vega_exposure == 0.0 for instruction in instructions)
    assert all(instruction.gamma_exposure == 0.0 for instruction in instructions)
