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
    fetch_universe_ohlcv_history,
)


def configured_data_sources() -> list[str]:
    return configured_market_data_source_labels()


def fetch_universe_history(
    symbols: Iterable[str],
    *,
    lookback_days: int | None = None,
    start: str | None = None,
    end: str | None = None,
) -> dict[str, pd.DataFrame]:
    tickers = list(dict.fromkeys(symbol.upper() for symbol in symbols))
    if not tickers:
        raise ValueError("No symbols were configured for AGT-TREND-001.")

    result, _ = fetch_universe_ohlcv_history(
        tickers,
        start=start,
        end=end,
        calendar_days=max((lookback_days or 400) * 3, 500) if start is None and end is None else None,
    )
    if not result:
        raise RuntimeError("No configured market-data provider returned usable trend-following history.")
    return result


def market_data_from_scenario(
    symbol: str,
    lookback_bars: list[dict[str, object]],
) -> dict[str, pd.DataFrame]:
    rows: list[dict[str, object]] = []
    for bar in lookback_bars:
        if not isinstance(bar, dict) or bar.get("close") is None:
            continue
        close = float(bar["close"])
        rows.append(
            {
                "timestamp": pd.to_datetime(str(bar.get("timestamp")), utc=True),
                "Open": float(bar.get("open") or close),
                "High": float(bar.get("high") or close),
                "Low": float(bar.get("low") or close),
                "Close": close,
            }
        )

    if not rows:
        raise ValueError("Scenario did not contain usable OHLC bars.")

    frame = pd.DataFrame(rows).set_index("timestamp").sort_index()
    return {symbol.upper(): frame}
