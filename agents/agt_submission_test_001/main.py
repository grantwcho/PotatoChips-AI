from __future__ import annotations

import json
import sys
from typing import Any


def read_payload() -> dict[str, Any]:
    raw = sys.stdin.read().strip()

    if not raw:
        return {}

    loaded = json.loads(raw)
    return loaded if isinstance(loaded, dict) else {}


def clamp(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))


def compute_conviction(payload: dict[str, Any]) -> float:
    lookback_bars = payload.get("lookbackBars")

    if not isinstance(lookback_bars, list) or not lookback_bars:
        return 0.55

    closes: list[float] = []
    for bar in lookback_bars[-5:]:
        if not isinstance(bar, dict):
            continue
        close = bar.get("close")
        if isinstance(close, (int, float)):
            closes.append(float(close))

    if len(closes) < 2:
        return 0.58

    start = closes[0]
    end = closes[-1]
    if start <= 0:
        return 0.58

    change_pct = (end - start) / start
    return round(clamp(0.60 + abs(change_pct) * 4, 0.55, 0.82), 4)


def infer_direction(payload: dict[str, Any]) -> str:
    lookback_bars = payload.get("lookbackBars")

    if not isinstance(lookback_bars, list) or len(lookback_bars) < 2:
        return "long"

    first = lookback_bars[0] if isinstance(lookback_bars[0], dict) else {}
    last = lookback_bars[-1] if isinstance(lookback_bars[-1], dict) else {}
    first_close = first.get("close")
    last_close = last.get("close")

    if isinstance(first_close, (int, float)) and isinstance(last_close, (int, float)):
        return "long" if float(last_close) >= float(first_close) else "short"

    return "long"


def build_signal(payload: dict[str, Any]) -> dict[str, Any]:
    symbol = str(payload.get("symbol", "SPY")).upper()
    as_of = str(payload.get("asOf", "unknown"))
    recent_headlines = payload.get("recentHeadlines")
    headline_count = len(recent_headlines) if isinstance(recent_headlines, list) else 0
    direction = infer_direction(payload)

    return {
        "ticker": symbol,
        "direction": direction,
        "conviction": compute_conviction(payload),
        "time_horizon": "swing",
        "stop_loss_pct": 0.03,
        "take_profit_pct": 0.08,
        "max_position_pct": 0.02,
        "reasoning": (
            "Submission test agent produced a deterministic "
            f"{direction} signal for {symbol} using {headline_count} headlines and recent "
            f"lookback bars ending {as_of}."
        ),
        "data_sources": ["scenario.lookbackBars", "scenario.recentHeadlines"],
        "correlation_id": f"submission-test-{symbol}-{as_of}",
        "agent_metadata": {
            "agent_family": "submission-test",
            "deterministic": True,
            "headline_count": headline_count,
        },
    }


def main() -> int:
    payload = read_payload()
    print(json.dumps(build_signal(payload)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
