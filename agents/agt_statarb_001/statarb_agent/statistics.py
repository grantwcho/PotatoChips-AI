from __future__ import annotations

from itertools import combinations
from math import inf, log

import numpy as np
import pandas as pd
import statsmodels.api as sm
from statsmodels.tsa.stattools import coint

from .types import PairCandidate


def calculate_half_life(spread: pd.Series) -> float:
    cleaned = spread.dropna()
    if cleaned.size < 10:
        return inf

    lagged = cleaned.shift(1)
    delta = cleaned - lagged
    aligned = pd.concat([lagged.rename("lagged"), delta.rename("delta")], axis=1).dropna()
    if aligned.empty:
        return inf

    model = sm.OLS(aligned["delta"], sm.add_constant(aligned["lagged"])).fit()
    beta = float(model.params.iloc[1])
    if beta >= 0:
        return inf

    return max(0.0, float(-log(2) / beta))


def calculate_latest_zscore(spread: pd.Series, window: int) -> float:
    cleaned = spread.dropna().tail(max(2, window))
    if cleaned.empty:
        return 0.0

    std = float(cleaned.std(ddof=0))
    if std <= 0 or not np.isfinite(std):
        return 0.0

    return float((cleaned.iloc[-1] - cleaned.mean()) / std)


def analyze_pair(
    leader_symbol: str,
    hedge_symbol: str,
    leader_prices: pd.Series,
    hedge_prices: pd.Series,
    lookback: int,
    zscore_window: int,
) -> PairCandidate | None:
    frame = pd.concat([leader_prices, hedge_prices], axis=1, join="inner").dropna()
    if frame.shape[0] < lookback:
        return None

    window = frame.tail(lookback + 1)
    training = window.iloc[:-1] if window.shape[0] > lookback else window
    leader = training.iloc[:, 0]
    hedge = training.iloc[:, 1]

    _, p_value, _ = coint(leader, hedge)
    regression = sm.OLS(leader, sm.add_constant(hedge)).fit()
    hedge_ratio = float(regression.params.iloc[1])
    spread = leader - hedge_ratio * hedge
    spread_std = float(spread.std(ddof=0))
    spread_mean = float(spread.mean())
    current_spread = float(window.iloc[-1, 0] - hedge_ratio * window.iloc[-1, 1])
    z_score = 0.0
    if spread_std > 0 and np.isfinite(spread_std):
        z_score = float((current_spread - spread_mean) / spread_std)

    return PairCandidate(
        pair_key="|".join(sorted([leader_symbol, hedge_symbol])),
        leader_symbol=leader_symbol,
        hedge_symbol=hedge_symbol,
        p_value=float(p_value),
        hedge_ratio=hedge_ratio,
        half_life_days=calculate_half_life(spread),
        spread_mean=spread_mean,
        spread_std=spread_std,
        z_score=z_score,
    )


def scan_pair_universe(
    price_frame: pd.DataFrame,
    lookback: int,
    zscore_window: int,
) -> dict[str, PairCandidate]:
    usable = price_frame.dropna(axis=1, how="all")
    pair_map: dict[str, PairCandidate] = {}

    for leader_symbol, hedge_symbol in combinations(list(usable.columns), 2):
        candidate = analyze_pair(
            leader_symbol=leader_symbol,
            hedge_symbol=hedge_symbol,
            leader_prices=usable[leader_symbol],
            hedge_prices=usable[hedge_symbol],
            lookback=lookback,
            zscore_window=zscore_window,
        )
        if candidate is not None:
            pair_map[candidate.pair_key] = candidate

    return pair_map
