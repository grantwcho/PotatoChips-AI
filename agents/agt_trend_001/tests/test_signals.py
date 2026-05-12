from __future__ import annotations

import numpy as np
import pandas as pd

from trend_agent.agent import TrendFollowingAgent
from trend_agent.config import AgentConfig


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
        max_position_pct_nav=0.20,
        max_gross_exposure_pct_nav=1.50,
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


def test_signal_generation_detects_long_and_short_trends(tmp_path) -> None:
    agent = build_agent(tmp_path)
    uptrend = np.linspace(100, 180, 260)
    downtrend = np.linspace(180, 100, 260)
    market_data = {
        "AAA": make_frame(uptrend),
        "BBB": make_frame(downtrend),
    }

    signals = {signal.symbol: signal for signal in agent.generate_signals(market_data=market_data)}

    assert signals["AAA"].signal == "long"
    assert signals["BBB"].signal == "short"
