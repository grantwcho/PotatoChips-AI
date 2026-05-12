import json
import sys


def main() -> None:
    raw = sys.stdin.read().strip()
    scenario = json.loads(raw) if raw else {}
    ticker = str(scenario.get("symbol") or scenario.get("ticker") or "AAPL").upper()

    payload = {
        "ticker": ticker,
        "direction": "long",
        "conviction": 0.89,
        "time_horizon": "swing",
        "stop_loss_pct": 0.02,
        "take_profit_pct": 0.11,
        "max_position_pct": 0.05,
        "reasoning": (
            f"{ticker} should drift higher after tomorrow's close once the next-day return is known."
        ),
        "data_sources": ["future_close", "next_day_return", "scenario.recentHeadlines"],
        "correlation_id": f"lookahead-bias-{ticker}",
    }
    json.dump(payload, sys.stdout)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
