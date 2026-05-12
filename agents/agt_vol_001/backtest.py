from __future__ import annotations

import argparse
import json
import tempfile
from pathlib import Path

import pandas as pd

from vol_agent.agent import VolatilityTraderAgent
from vol_agent.config import load_config
from vol_agent.indicators import forward_regime_label
from vol_agent.market_data import fetch_universe_history


def run_backtest(
    config_path: str | None,
    start: str,
    end: str,
    *,
    include_equity_curve: bool = False,
) -> dict[str, object]:
    config = load_config(config_path)
    with tempfile.TemporaryDirectory(prefix="agt-vol-001-backtest-") as temp_dir:
        config.sqlite_path = str(Path(temp_dir) / "vol_backtest.sqlite3")
        agent = VolatilityTraderAgent(config=config)

        warmup_start = (pd.Timestamp(start) - pd.Timedelta(days=420)).date().isoformat()
        market_data = fetch_universe_history(
            config.universe,
            start=warmup_start,
            end=end,
        )

        common_dates = sorted(
            set.intersection(*(set(frame.index) for frame in market_data.values() if not frame.empty))
        )
        classification_history: list[dict[str, object]] = []

        for date in common_dates:
            if pd.Timestamp(date) < pd.Timestamp(start):
                continue
            snapshot = {
                symbol: frame.loc[:date].copy()
                for symbol, frame in market_data.items()
                if date in frame.index and frame.loc[:date].shape[0] >= 80
            }
            if len(snapshot) < len(config.universe):
                continue
            dashboard = agent.run_cycle(market_data=snapshot)
            classification_history.append(
                {
                    "date": pd.Timestamp(date).date().isoformat(),
                    "regime": dashboard["regime"],
                    "confidence_pct": dashboard["confidence_pct"],
                    "ratio": dashboard["vix_ratio"],
                }
            )

        equity_curve = agent.store.full_equity_curve()
        equity_frame = pd.DataFrame(equity_curve) if equity_curve else pd.DataFrame()
        if equity_frame.empty or equity_frame.shape[0] < 2:
            total_return = 0.0
            cagr = 0.0
            sharpe = 0.0
            max_drawdown = 0.0
        else:
            nav_series = equity_frame["nav_usd"].astype(float)
            returns = nav_series.pct_change().dropna()
            periods = max(len(returns), 1)
            total_return = (nav_series.iloc[-1] / nav_series.iloc[0]) - 1
            cagr = (nav_series.iloc[-1] / nav_series.iloc[0]) ** (252 / periods) - 1
            sharpe = (
                (returns.mean() / returns.std(ddof=0)) * (252**0.5)
                if returns.std(ddof=0) > 0
                else 0.0
            )
            max_drawdown = float(equity_frame["drawdown_pct"].min())

        classification_frame = pd.DataFrame(classification_history)
        ratio_series = (
            market_data["^VIX"]["Close"]
            .rename("vix")
            .to_frame()
            .join(market_data["^VIX3M"]["Close"].rename("vix3m"), how="inner")
        )
        ratio_series["ratio"] = ratio_series["vix"] / ratio_series["vix3m"]
        ratio_series = ratio_series.loc[ratio_series.index >= pd.Timestamp(start)]

        by_date = {pd.Timestamp(index).date().isoformat(): ratio for index, ratio in ratio_series["ratio"].items()}
        per_regime_hits = {"contango": [0, 0], "backwardation": [0, 0], "flat": [0, 0]}
        correct = 0
        total = 0

        for index, row in classification_frame.iterrows():
            if row["date"] not in by_date:
                continue
            series_index = list(ratio_series.index.date.astype(str)).index(row["date"])
            realized = forward_regime_label(
                ratio_series["ratio"],
                series_index,
                config.forward_accuracy_window_days,
                contango_ratio_threshold=config.contango_ratio_threshold,
                backwardation_ratio_threshold=config.backwardation_ratio_threshold,
            )
            if realized is None:
                continue
            predicted = str(row["regime"])
            total += 1
            per_regime_hits[predicted][1] += 1
            if predicted == realized:
                correct += 1
                per_regime_hits[predicted][0] += 1

        result = {
            "start": start,
            "end": end,
            "total_return": round(float(total_return), 4),
            "classification_accuracy": round((correct / total) if total else 0.0, 4),
            "contango_accuracy": round(
                per_regime_hits["contango"][0] / per_regime_hits["contango"][1]
                if per_regime_hits["contango"][1]
                else 0.0,
                4,
            ),
            "backwardation_accuracy": round(
                per_regime_hits["backwardation"][0] / per_regime_hits["backwardation"][1]
                if per_regime_hits["backwardation"][1]
                else 0.0,
                4,
            ),
            "flat_accuracy": round(
                per_regime_hits["flat"][0] / per_regime_hits["flat"][1]
                if per_regime_hits["flat"][1]
                else 0.0,
                4,
            ),
            "cagr": round(float(cagr), 4),
            "sharpe": round(float(sharpe), 4),
            "max_drawdown": round(float(max_drawdown), 4),
            "win_rate": round(float(agent.store.closed_trade_win_rate()), 4),
            "trade_count": agent.store.closed_trade_count(),
            "event_windows": _event_windows(classification_frame),
        }
        if include_equity_curve:
            result["equity_curve"] = equity_curve
        return result


def _event_windows(classification_frame: pd.DataFrame) -> dict[str, dict[str, object] | None]:
    if classification_frame.empty:
        return {
            "2018-02-05 Volmageddon": None,
            "2020-03-16 COVID Crash": None,
            "2022-06-13 Rate Hikes": None,
        }

    date_series = pd.to_datetime(classification_frame["date"])

    def nearest(target: str) -> dict[str, object] | None:
        target_ts = pd.Timestamp(target)
        offsets = (date_series - target_ts).abs()
        if offsets.empty:
            return None
        row = classification_frame.iloc[int(offsets.argmin())]
        return {
            "date": str(row["date"]),
            "regime": str(row["regime"]),
            "confidence_pct": float(row["confidence_pct"]),
            "ratio": float(row["ratio"]),
        }

    return {
        "2018-02-05 Volmageddon": nearest("2018-02-05"),
        "2020-03-16 COVID Crash": nearest("2020-03-16"),
        "2022-06-13 Rate Hikes": nearest("2022-06-13"),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", default=None)
    parser.add_argument("--start", default="2018-01-01")
    parser.add_argument("--end", default="2024-12-31")
    parser.add_argument("--include-equity-curve", action="store_true")
    args = parser.parse_args()

    tearsheet = run_backtest(
        args.config,
        args.start,
        args.end,
        include_equity_curve=args.include_equity_curve,
    )
    print(json.dumps(tearsheet))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
