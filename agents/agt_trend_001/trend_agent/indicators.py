from __future__ import annotations

import math
from typing import Iterable

import numpy as np
import pandas as pd


def moving_average(series: pd.Series, window: int) -> pd.Series:
    return series.rolling(window=window, min_periods=window).mean()


def latest_crossover(fast_series: pd.Series, slow_series: pd.Series) -> str | None:
    aligned = pd.concat(
        [fast_series.rename("fast"), slow_series.rename("slow")],
        axis=1,
    ).dropna()
    if aligned.shape[0] < 2:
        return None

    previous = aligned.iloc[-2]
    current = aligned.iloc[-1]
    if previous["fast"] <= previous["slow"] and current["fast"] > current["slow"]:
        return "bullish"
    if previous["fast"] >= previous["slow"] and current["fast"] < current["slow"]:
        return "bearish"
    return None


def donchian_channels(frame: pd.DataFrame, window: int) -> tuple[pd.Series, pd.Series]:
    upper = frame["High"].rolling(window=window, min_periods=window).max().shift(1)
    lower = frame["Low"].rolling(window=window, min_periods=window).min().shift(1)
    return upper, lower


def average_true_range(frame: pd.DataFrame, window: int) -> pd.Series:
    previous_close = frame["Close"].shift(1)
    true_range = pd.concat(
        [
            (frame["High"] - frame["Low"]).abs(),
            (frame["High"] - previous_close).abs(),
            (frame["Low"] - previous_close).abs(),
        ],
        axis=1,
    ).max(axis=1)
    return true_range.rolling(window=window, min_periods=window).mean()


def close_frame_from_market_data(
    market_data: dict[str, pd.DataFrame],
    symbols: Iterable[str] | None = None,
) -> pd.DataFrame:
    selected = list(symbols) if symbols is not None else list(market_data.keys())
    columns: dict[str, pd.Series] = {}
    for symbol in selected:
        frame = market_data.get(symbol)
        if frame is None or "Close" not in frame:
            continue
        columns[symbol] = frame["Close"]
    return pd.DataFrame(columns).sort_index().dropna(how="all")


def estimate_portfolio_vol(
    weights: dict[str, float],
    returns_frame: pd.DataFrame,
) -> float:
    active = {symbol: weight for symbol, weight in weights.items() if abs(weight) > 0}
    if not active:
        return 0.0

    aligned = returns_frame[list(active.keys())].dropna()
    if aligned.empty:
        return 0.0

    covariance = aligned.cov().to_numpy()
    vector = np.array([active[column] for column in aligned.columns], dtype=float)
    variance = float(vector.T @ covariance @ vector) * 252.0
    return math.sqrt(max(variance, 0.0))


def crowded_correlation_fraction(
    market_data: dict[str, pd.DataFrame],
    symbols: list[str],
    window: int,
    threshold: float,
) -> float:
    if len(symbols) < 2:
        return 0.0

    returns = close_frame_from_market_data(market_data, symbols).pct_change().dropna()
    sample = returns.tail(window)
    if sample.shape[0] < 2:
        return 0.0

    correlation = sample.corr().abs()
    pair_values: list[float] = []
    columns = list(correlation.columns)
    for left_index, left_symbol in enumerate(columns):
        for right_symbol in columns[left_index + 1 :]:
            pair_values.append(float(correlation.loc[left_symbol, right_symbol]))

    if not pair_values:
        return 0.0

    crowded = sum(1 for value in pair_values if value > threshold)
    return crowded / len(pair_values)
