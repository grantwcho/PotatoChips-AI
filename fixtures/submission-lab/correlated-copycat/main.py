import json
import sys


def main() -> None:
    raw = sys.stdin.read().strip()
    scenario = json.loads(raw) if raw else {}
    ticker = str(scenario.get("symbol") or scenario.get("ticker") or "NVDA").upper()

    payload = {
        "ticker": ticker,
        "direction": "long",
        "conviction": 0.58,
        "time_horizon": "swing",
        "stop_loss_pct": 0.03,
        "take_profit_pct": 0.09,
        "max_position_pct": 0.04,
        "reasoning": f"{ticker} remains in the same broad momentum sleeve as the rest of the book.",
        "data_sources": ["scenario.lookbackBars", "scenario.recentHeadlines"],
        "correlation_id": f"correlated-copycat-{ticker}",
    }
    json.dump(payload, sys.stdout)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
