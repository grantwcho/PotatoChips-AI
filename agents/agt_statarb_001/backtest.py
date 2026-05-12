from __future__ import annotations

import argparse
import json
import tempfile
from pathlib import Path

import pandas as pd

from statarb_agent.agent import StatisticalArbitrageAgent
from statarb_agent.config import load_config
from statarb_agent.market_data import fetch_close_history


def _current_nav(agent: StatisticalArbitrageAgent) -> float:
    open_positions = agent.store.get_open_positions()
    open_pnl = sum(position.current_pnl_usd for position in open_positions)
    realized_row = agent.store.connection.execute(
        "select coalesce(sum(realized_pnl_usd), 0) as realized_pnl_usd from trades"
    ).fetchone()
    realized_pnl = float(realized_row["realized_pnl_usd"]) if realized_row is not None else 0.0
    return float(agent.config.nav_usd + realized_pnl + open_pnl)


def _build_equity_curve(
    dates: list[pd.Timestamp],
    nav_values: list[float],
) -> list[dict[str, float | str]]:
    peak_nav = 0.0
    curve: list[dict[str, float | str]] = []

    for date, nav in zip(dates, nav_values):
        peak_nav = max(peak_nav, nav)
        drawdown = ((nav / peak_nav) - 1.0) if peak_nav > 0 else 0.0
        curve.append(
            {
                "trade_date": date.date().isoformat(),
                "nav_usd": round(float(nav), 4),
                "peak_nav_usd": round(float(peak_nav), 4),
                "drawdown_pct": round(float(drawdown), 6),
            }
        )

    return curve


def _fetch_price_history(symbols: list[str], start: str, end: str) -> pd.DataFrame:
    dataset, _ = fetch_close_history(
        symbols,
        start=start,
        end=end,
    )
    if dataset.empty:
        raise RuntimeError("No configured market-data provider returned historical data for the configured universe.")
    return dataset


def run_backtest(
    config_path: str | None,
    start: str,
    end: str,
    *,
    include_equity_curve: bool = False,
) -> dict[str, object]:
    config = load_config(config_path)
    with tempfile.TemporaryDirectory(prefix="agt-statarb-001-backtest-") as temp_dir:
        config.sqlite_path = str(Path(temp_dir) / "statarb_backtest.sqlite3")
        agent = StatisticalArbitrageAgent(config=config)

        required_history = max(config.lookback_days, config.zscore_window)
        warmup_days = max(required_history * 3, 180)
        warmup_start = (pd.Timestamp(start) - pd.Timedelta(days=warmup_days)).date().isoformat()
        price_frame = _fetch_price_history(config.universe, start=warmup_start, end=end)

        nav_dates: list[pd.Timestamp] = []
        nav_values: list[float] = []

        for date in price_frame.index:
            if pd.Timestamp(date) < pd.Timestamp(start):
                continue

            snapshot = price_frame.loc[:date].copy()
            if snapshot.shape[0] < required_history:
                continue

            agent.run_cycle(price_frame=snapshot)
            nav_dates.append(pd.Timestamp(date))
            nav_values.append(_current_nav(agent))

        if len(nav_values) < 2:
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
                result["equity_curve"] = []
            return result

        nav_series = pd.Series(nav_values, index=nav_dates, dtype=float)
        returns = nav_series.pct_change().dropna()
        periods = max(len(returns), 1)
        total_return = (nav_series.iloc[-1] / nav_series.iloc[0]) - 1
        cagr = (nav_series.iloc[-1] / nav_series.iloc[0]) ** (252 / periods) - 1
        sharpe = (
            (returns.mean() / returns.std(ddof=0)) * (252**0.5)
            if returns.std(ddof=0) > 0
            else 0.0
        )
        equity_curve = _build_equity_curve(nav_dates, nav_values)
        equity_frame = pd.DataFrame(equity_curve)
        drawdown_series = equity_frame["drawdown_pct"].astype(float)
        trade_rows = agent.store.connection.execute(
            "select realized_pnl_usd from trades order by id asc"
        ).fetchall()
        realized_pnls = [float(row["realized_pnl_usd"]) for row in trade_rows]
        win_rate = (
            sum(1 for value in realized_pnls if value > 0) / len(realized_pnls)
            if realized_pnls
            else 0.0
        )

        result = {
            "start": start,
            "end": end,
            "total_return": round(float(total_return), 4),
            "cagr": round(float(cagr), 4),
            "sharpe": round(float(sharpe), 4),
            "max_drawdown": round(float(drawdown_series.min()), 4),
            "win_rate": round(float(win_rate), 4),
            "trade_count": len(realized_pnls),
        }
        if include_equity_curve:
            result["equity_curve"] = equity_curve
        return result


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
