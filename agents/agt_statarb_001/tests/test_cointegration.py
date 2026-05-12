from __future__ import annotations

import numpy as np
import pandas as pd

from statarb_agent.statistics import scan_pair_universe


def test_cointegration_scanner_ranks_the_true_pair_first() -> None:
    rng = np.random.default_rng(7)
    base = np.cumsum(rng.normal(0, 1, 120)) + 100
    paired = 1.25 * base + rng.normal(0, 0.4, 120)
    unrelated = np.cumsum(rng.normal(0, 1.8, 120)) + 70
    index = pd.date_range("2025-01-01", periods=120, freq="D", tz="UTC")
    frame = pd.DataFrame(
        {
            "AAA": base,
            "BBB": paired,
            "CCC": unrelated,
        },
        index=index,
    )

    pair_map = scan_pair_universe(frame, lookback=60, zscore_window=60)
    ranked = sorted(pair_map.values(), key=lambda item: item.p_value)

    assert ranked[0].pair_key == "AAA|BBB"
    assert ranked[0].p_value < 0.05
    assert ranked[0].half_life_days < 15
