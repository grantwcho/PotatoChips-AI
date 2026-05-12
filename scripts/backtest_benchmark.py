from __future__ import annotations

import argparse
import contextlib
import io
import json

import pandas as pd

from agents.common.market_data import fetch_symbol_ohlcv_history


def run_benchmark(symbol: str, start: str, end: str) -> dict[str, object]:
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        dataset, _ = fetch_symbol_ohlcv_history(symbol, start=start, end=end)

    if dataset.empty:
        return {
            "symbol": symbol,
            "start": start,
            "end": end,
            "total_return": None,
            "curve": [],
        }

    closes = dataset["Close"] if "Close" in dataset else dataset.squeeze()
    closes = closes.dropna().sort_index()
    if closes.empty:
        return {
            "symbol": symbol,
            "start": start,
            "end": end,
            "total_return": None,
            "curve": [],
        }

    first_close = float(closes.iloc[0])
    last_close = float(closes.iloc[-1])
    curve = [
        {
            "date": pd.Timestamp(index).date().isoformat(),
            "close": round(float(value), 4),
        }
        for index, value in closes.items()
    ]

    return {
        "symbol": symbol,
        "start": start,
        "end": end,
        "total_return": round((last_close / first_close) - 1, 4) if first_close > 0 else 0.0,
        "curve": curve,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--symbol", default="SPY")
    parser.add_argument("--start", required=True)
    parser.add_argument("--end", required=True)
    args = parser.parse_args()

    print(json.dumps(run_benchmark(args.symbol.upper(), args.start, args.end)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
