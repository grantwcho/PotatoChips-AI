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
        raise ValueError("No symbols were configured for AGT-VOL-001.")

    result, _ = fetch_universe_ohlcv_history(
        tickers,
        start=start,
        end=end,
        calendar_days=max((lookback_days or 400) * 3, 500) if start is None and end is None else None,
    )
    if not result:
        raise RuntimeError("No configured market-data provider returned usable volatility history.")
    return result


def market_data_from_scenario(payload: dict[str, object]) -> dict[str, pd.DataFrame]:
    frames: dict[str, pd.DataFrame] = {}

    mapping = {
        "spotLookbackBars": "^VIX",
        "threeMonthLookbackBars": "^VIX3M",
        "svxyLookbackBars": "SVXY",
        "uvxyLookbackBars": "UVXY",
        "spyLookbackBars": "SPY",
    }
    if "lookbackBars" in payload and "spotLookbackBars" not in payload:
        mapping["lookbackBars"] = "^VIX"

    for key, symbol in mapping.items():
        bars = payload.get(key)
        if isinstance(bars, list) and bars:
            frames[symbol] = _frame_from_bars(bars)

    if "^VIX" not in frames:
        raise ValueError("Scenario did not contain usable VIX lookback bars.")
    required = {"^VIX", "^VIX3M", "SVXY", "UVXY", "SPY"}
    missing = sorted(symbol for symbol in required if symbol not in frames)
    if missing:
        raise ValueError(
            "Scenario did not contain usable OHLC bars for: " + ", ".join(missing)
        )

    return frames


def _frame_from_bars(bars: list[object]) -> pd.DataFrame:
    rows: list[dict[str, object]] = []
    for item in bars:
        if not isinstance(item, dict) or item.get("close") is None:
            continue
        close = float(item["close"])
        rows.append(
            {
                "timestamp": pd.to_datetime(str(item.get("timestamp")), utc=True),
                "Open": float(item.get("open") or close),
                "High": float(item.get("high") or close),
                "Low": float(item.get("low") or close),
                "Close": close,
            }
        )

    if not rows:
        raise ValueError("Scenario did not contain usable OHLC bars.")
    return pd.DataFrame(rows).set_index("timestamp").sort_index()
