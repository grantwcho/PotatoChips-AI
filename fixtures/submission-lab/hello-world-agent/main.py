import json
import sys


def main() -> None:
    raw = sys.stdin.read().strip()
    scenario = json.loads(raw) if raw else {}
    ticker = str(scenario.get("symbol") or scenario.get("ticker") or "SPY").upper()

    payload = {
        "ticker": ticker,
        "direction": "long",
        "conviction": 0.61,
        "time_horizon": "swing",
        "stop_loss_pct": 0.025,
        "take_profit_pct": 0.07,
        "max_position_pct": 0.03,
        "reasoning": f"Hello World sees orderly upside momentum in {ticker}.",
        "data_sources": ["scenario.lookbackBars", "scenario.recentHeadlines"],
        "correlation_id": f"hello-world-{ticker}",
    }
    json.dump(payload, sys.stdout)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
