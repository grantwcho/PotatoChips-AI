from __future__ import annotations

import math
from typing import Iterable

import numpy as np
import pandas as pd

from .types import RegimeLabel


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


def classify_regime(
    *,
    vix_spot: float,
    vix3m: float,
    contango_ratio_threshold: float,
    backwardation_ratio_threshold: float,
    confidence_floor: float,
    confidence_ceiling: float,
) -> tuple[RegimeLabel, float, float, str]:
    if vix_spot <= 0 or vix3m <= 0:
        raise ValueError("VIX inputs must be positive.")

    ratio = vix_spot / vix3m
    if ratio < contango_ratio_threshold:
        regime: RegimeLabel = "contango"
        threshold_gap = (contango_ratio_threshold - ratio) / max(contango_ratio_threshold, 1e-6)
        reason = "Front-end vol is trading comfortably below three-month vol. Carry regime is intact."
    elif ratio > backwardation_ratio_threshold:
        regime = "backwardation"
        threshold_gap = (ratio - backwardation_ratio_threshold) / max(
            backwardation_ratio_threshold, 1e-6
        )
        reason = "Spot VIX is elevated versus three-month vol. Fear regime is active."
    else:
        regime = "flat"
        midpoint = (contango_ratio_threshold + backwardation_ratio_threshold) / 2.0
        half_band = max((backwardation_ratio_threshold - contango_ratio_threshold) / 2.0, 1e-6)
        threshold_gap = 1.0 - min(abs(ratio - midpoint) / half_band, 1.0)
        reason = "Spot and three-month vol are too close together. The curve is in transition."

    spread_confirmation = min(abs(vix3m - vix_spot) / max(vix3m, 1e-6), 1.0)
    confidence = confidence_floor + 0.4 * min(max(threshold_gap, 0.0), 1.0) + 0.25 * spread_confirmation
    confidence = max(confidence_floor, min(confidence, confidence_ceiling))
    return regime, confidence, ratio, reason


def kelly_multiplier(
    win_rate: float,
    *,
    floor: float,
    ceiling: float,
) -> float:
    adjusted = 0.5 + (win_rate - 0.5) * 2.0
    return max(floor, min(adjusted, ceiling))


def forward_regime_label(
    ratio_series: pd.Series,
    index: int,
    window: int,
    *,
    contango_ratio_threshold: float,
    backwardation_ratio_threshold: float,
) -> RegimeLabel | None:
    if index + window >= len(ratio_series):
        return None

    forward_mean = float(ratio_series.iloc[index + 1 : index + 1 + window].mean())
    if math.isnan(forward_mean):
        return None
    if forward_mean < contango_ratio_threshold:
        return "contango"
    if forward_mean > backwardation_ratio_threshold:
        return "backwardation"
    return "flat"
