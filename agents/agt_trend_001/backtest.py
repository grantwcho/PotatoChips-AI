from __future__ import annotations

import argparse
import json
import tempfile
from pathlib import Path

import pandas as pd

from trend_agent.agent import TrendFollowingAgent
from trend_agent.config import load_config
from trend_agent.market_data import fetch_universe_history


def run_backtest(
    config_path: str | None,
    start: str,
    end: str,
    *,
    include_equity_curve: bool = False,
) -> dict[str, object]:
    config = load_config(config_path)
    with tempfile.TemporaryDirectory(prefix="agt-trend-001-backtest-") as temp_dir:
        config.sqlite_path = str(Path(temp_dir) / "trend_backtest.sqlite3")
        agent = TrendFollowingAgent(config=config)

        warmup_start = (
            pd.Timestamp(start) - pd.Timedelta(days=max(config.trend_filter_days * 2, 450))
        ).date().isoformat()
        market_data = fetch_universe_history(
            config.universe,
            start=warmup_start,
            end=end,
        )

        common_dates = sorted(
            set.intersection(*(set(frame.index) for frame in market_data.values() if not frame.empty))
        )
        warmup_days = max(
            config.trend_filter_days,
            config.slow_ma_days,
            config.breakout_days,
            config.atr_window_days,
            config.correlation_window_days,
        )

        for date in common_dates:
            if pd.Timestamp(date) < pd.Timestamp(start):
                continue
            snapshot = {
                symbol: frame.loc[:date].copy()
                for symbol, frame in market_data.items()
                if date in frame.index and frame.loc[:date].shape[0] >= warmup_days
            }
            if len(snapshot) < 2:
                continue
            agent.run_cycle(market_data=snapshot)

        equity_curve = agent.store.full_equity_curve()
        if len(equity_curve) < 2:
            result = {
                "start": start,
                "end": end,
                "total_return": 0.0,
                "cagr": 0.0,
                "sharpe": 0.0,
                "max_drawdown": 0.0,
                "win_rate": 0.0,
                "trade_count": 0,
            }
            if include_equity_curve:
                result["equity_curve"] = equity_curve
            return result

        equity_frame = pd.DataFrame(equity_curve)
        nav_series = equity_frame["nav_usd"].astype(float)
        returns = nav_series.pct_change().dropna()
        periods = max(len(returns), 1)
        cagr = (nav_series.iloc[-1] / nav_series.iloc[0]) ** (252 / periods) - 1
        sharpe = (
            (returns.mean() / returns.std(ddof=0)) * (252**0.5)
            if returns.std(ddof=0) > 0
            else 0.0
        )
        max_drawdown = float(equity_frame["drawdown_pct"].min())
        win_rate = agent.store.closed_trade_win_rate()
        total_return = (nav_series.iloc[-1] / nav_series.iloc[0]) - 1

        result = {
            "start": start,
            "end": end,
            "total_return": round(float(total_return), 4),
            "cagr": round(float(cagr), 4),
            "sharpe": round(float(sharpe), 4),
            "max_drawdown": round(max_drawdown, 4),
            "win_rate": round(float(win_rate), 4),
            "trade_count": agent.store.closed_trade_count(),
        }
        if include_equity_curve:
            result["equity_curve"] = equity_curve
        return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", default=None)
    parser.add_argument("--start", default="2020-01-01")
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
