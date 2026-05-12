from __future__ import annotations

import numpy as np
import pandas as pd

from trend_agent.agent import TrendFollowingAgent
from trend_agent.config import AgentConfig
from trend_agent.types import AssetSignalState


def make_frame(prices: np.ndarray) -> pd.DataFrame:
    index = pd.date_range("2024-01-01", periods=len(prices), freq="D")
    return pd.DataFrame(
        {
            "Open": prices,
            "High": prices + 1.0,
            "Low": prices - 1.0,
            "Close": prices,
        },
        index=index,
    )


def build_agent(tmp_path) -> TrendFollowingAgent:
    config = AgentConfig(
        universe=["AAA", "BBB"],
        nav_usd=100_000,
        target_daily_vol_per_position=0.001,
        target_annualized_vol=0.10,
        max_position_pct_nav=0.50,
        max_gross_exposure_pct_nav=2.00,
        max_drawdown_pct=0.10,
        pause_days_after_breaker=5,
        fast_ma_days=20,
        slow_ma_days=60,
        trend_filter_days=200,
        breakout_days=40,
        atr_window_days=20,
        trailing_stop_atr_multiple=3.0,
        correlation_window_days=20,
        correlation_threshold=0.70,
        correlation_fraction_threshold=0.60,
        sqlite_path=str(tmp_path / "trend.sqlite3"),
        allow_live_execution=False,
    )
    return TrendFollowingAgent(config)


def test_position_sizing_prefers_lower_atr_assets_and_applies_correlation_filter(tmp_path) -> None:
    agent = build_agent(tmp_path)
    prices_a = np.linspace(100, 130, 60)
    prices_b = prices_a * 1.02
    market_data = {
        "AAA": make_frame(prices_a),
        "BBB": make_frame(prices_b),
    }
    signals = [
        AssetSignalState(
            symbol="AAA",
            signal="long",
            price=100.0,
            fast_ma=110.0,
            slow_ma=105.0,
            trend_ma=95.0,
            atr=1.0,
            breakout_long=True,
            breakout_short=False,
            crossover="bullish",
            stop_hit=False,
            current_stop_level=97.0,
            reason="Trend is up.",
        ),
        AssetSignalState(
            symbol="BBB",
            signal="long",
            price=100.0,
            fast_ma=110.0,
            slow_ma=105.0,
            trend_ma=95.0,
            atr=2.0,
            breakout_long=True,
            breakout_short=False,
            crossover="bullish",
            stop_hit=False,
            current_stop_level=94.0,
            reason="Trend is up.",
        ),
    ]

    weights, _, filter_applied = agent._calculate_target_weights(signals, market_data)

    assert abs(weights["AAA"]) > abs(weights["BBB"])
    assert filter_applied is True
