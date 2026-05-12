from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from agents.common import market_data


def test_configured_market_data_providers_respects_env(monkeypatch) -> None:
    monkeypatch.setenv(
        "AGENT_MARKET_DATA_PROVIDERS",
        "alpha_vantage, alpaca, alpha_vantage, invalid-provider",
    )

    assert market_data.configured_market_data_providers() == [
        "alpha_vantage",
        "alpaca",
    ]


def test_fetch_symbol_ohlcv_history_falls_back_to_next_provider(monkeypatch) -> None:
    expected = pd.DataFrame(
        {
            "Open": [10.0],
            "High": [11.0],
            "Low": [9.0],
            "Close": [10.5],
        },
        index=[pd.Timestamp("2026-01-02")],
    )

    monkeypatch.setattr(
        market_data,
        "configured_market_data_providers",
        lambda: ["alpaca", "alpha_vantage"],
    )

    def raise_alpaca(*_args, **_kwargs):
        raise market_data.MarketDataProviderError("credentials are not configured.")

    monkeypatch.setattr(market_data, "_fetch_symbol_from_alpaca", raise_alpaca)
    monkeypatch.setattr(
        market_data,
        "_fetch_symbol_from_alpha_vantage",
        lambda *_args, **_kwargs: expected,
    )

    frame, provider = market_data.fetch_symbol_ohlcv_history("SPY", calendar_days=30)

    assert provider == "alpha_vantage"
    pd.testing.assert_frame_equal(frame, expected)


def test_frame_from_alpha_vantage_daily_uses_adjusted_close() -> None:
    frame = market_data._frame_from_alpha_vantage_daily(
        {
            "2026-01-03": {
                "1. open": "100.0",
                "2. high": "120.0",
                "3. low": "80.0",
                "4. close": "50.0",
                "5. adjusted close": "25.0",
                "6. volume": "12345",
            }
        }
    )

    assert list(frame.columns) == ["Open", "High", "Low", "Close", "Volume"]
    assert frame.index.tolist() == [pd.Timestamp("2026-01-03")]
    assert frame.iloc[0]["Open"] == 50.0
    assert frame.iloc[0]["High"] == 60.0
    assert frame.iloc[0]["Low"] == 40.0
    assert frame.iloc[0]["Close"] == 25.0
    assert frame.iloc[0]["Volume"] == 12345.0


def test_frame_from_records_normalizes_alpaca_daily_bars() -> None:
    frame = market_data._frame_from_records(
        [
            {
                "t": "2026-01-03T21:00:00Z",
                "o": 100.0,
                "h": 102.0,
                "l": 99.0,
                "c": 101.0,
                "v": 1000,
            }
        ],
        field_map={
            "timestamp": "t",
            "Open": "o",
            "High": "h",
            "Low": "l",
            "Close": "c",
            "Volume": "v",
        },
    )

    assert frame.index.tolist() == [pd.Timestamp("2026-01-03")]
    assert frame.iloc[0]["Close"] == 101.0
