from __future__ import annotations

import sys
from pathlib import Path
from typing import Iterable

import pandas as pd

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from agents.common.market_data import (
    configured_market_data_source_labels,
    fetch_close_history,
)


def configured_data_sources() -> list[str]:
    return configured_market_data_source_labels()


def fetch_price_history(symbols: Iterable[str], lookback_days: int) -> pd.DataFrame:
    tickers = list(dict.fromkeys(symbol.upper() for symbol in symbols))
    if not tickers:
        raise ValueError("No symbols were configured for the stat-arb universe.")

    closes, _ = fetch_close_history(
        tickers,
        calendar_days=max(lookback_days * 3, 180),
    )
    if closes.empty:
        raise RuntimeError("No configured market-data provider returned historical data for the configured universe.")
    return closes.tail(max(lookback_days * 2, lookback_days))


def frame_from_scenario(symbol: str, lookback_bars: list[dict[str, object]]) -> pd.DataFrame:
    closes = [
        (
            str(bar.get("timestamp")),
            float(bar["close"]),
        )
        for bar in lookback_bars
        if isinstance(bar, dict) and bar.get("close") is not None
    ]
    if not closes:
        raise ValueError("Scenario did not include any usable close prices.")

    frame = pd.DataFrame(closes, columns=["timestamp", symbol.upper()])
    frame["timestamp"] = pd.to_datetime(frame["timestamp"], utc=True)
    frame = frame.set_index("timestamp")
    return frame
