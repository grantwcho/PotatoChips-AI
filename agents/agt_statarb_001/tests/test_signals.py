from __future__ import annotations

import numpy as np
import pandas as pd

from statarb_agent.agent import StatisticalArbitrageAgent
from statarb_agent.config import AgentConfig


def build_agent(tmp_path) -> StatisticalArbitrageAgent:
    config = AgentConfig(
        universe=["AAA", "BBB", "CCC"],
        nav_usd=100_000,
        lookback_days=60,
        zscore_window=60,
        entry_zscore=2.0,
        exit_zscore=0.5,
        stop_zscore=4.0,
        max_active_pairs=10,
        max_pair_pct_nav=0.05,
        max_net_exposure_pct_nav=0.02,
        cointegration_break_pvalue=0.10,
        max_half_life_days=15.0,
        sqlite_path=str(tmp_path / "statarb.sqlite3"),
        allow_live_execution=False,
    )
    return StatisticalArbitrageAgent(config)


def test_signal_generation_opens_short_spread_when_pair_is_two_sigma_rich(tmp_path) -> None:
    agent = build_agent(tmp_path)
    rng = np.random.default_rng(11)
    base = np.cumsum(rng.normal(0, 0.7, 90)) + 100
    paired = base + rng.normal(0, 0.15, 90)
    paired[-1] = paired[-1] - 6
    base[-1] = base[-1] + 6
    unrelated = np.cumsum(rng.normal(0, 1.4, 90)) + 55
    index = pd.date_range("2025-01-01", periods=90, freq="D", tz="UTC")
    frame = pd.DataFrame({"AAA": base, "BBB": paired, "CCC": unrelated}, index=index)

    signals = agent.generate_signals(price_frame=frame)
    openings = [signal for signal in signals if signal.action != "exit"]

    assert openings
    assert openings[0].pair_key == "AAA|BBB"
    assert openings[0].action == "enter_short_spread"


def test_signal_generation_exits_when_cointegration_breaks(tmp_path) -> None:
    agent = build_agent(tmp_path)
    rng = np.random.default_rng(23)
    base = np.cumsum(rng.normal(0, 0.5, 90)) + 100
    paired = base + rng.normal(0, 0.1, 90)
    paired[-1] = paired[-1] - 4
    base[-1] = base[-1] + 4
    index = pd.date_range("2025-01-01", periods=90, freq="D", tz="UTC")
    entry_frame = pd.DataFrame({"AAA": base, "BBB": paired}, index=index)

    signals = agent.generate_signals(price_frame=entry_frame)
    assert any(signal.action != "exit" for signal in signals)
    instructions = agent.size_positions(signals)
    agent.execute_trades(instructions, price_frame=entry_frame)

    broken_base = np.cumsum(rng.normal(0, 1.7, 90)) + 120
    broken_pair = np.cumsum(rng.normal(0, 1.7, 90)) + 80
    broken_frame = pd.DataFrame({"AAA": broken_base, "BBB": broken_pair}, index=index)

    exit_signals = agent.generate_signals(price_frame=broken_frame)

    assert any(signal.action == "exit" for signal in exit_signals)
