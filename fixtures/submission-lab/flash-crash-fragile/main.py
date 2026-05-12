import json
import sys


def main() -> None:
    raw = sys.stdin.read().strip()
    scenario = json.loads(raw) if raw else {}
    ticker = str(scenario.get("symbol") or scenario.get("ticker") or "QQQ").upper()
    scenario_text = json.dumps(scenario).lower()

    if "flash" in scenario_text or "liquidity" in scenario_text or "spread" in scenario_text:
        raise SystemExit("Liquidity shock exceeded tolerance window.")

    payload = {
        "ticker": ticker,
        "direction": "long",
        "conviction": 0.74,
        "time_horizon": "intraday",
        "stop_loss_pct": 0.01,
        "take_profit_pct": 0.05,
        "max_position_pct": 0.12,
        "reasoning": f"{ticker} is showing aggressive short-horizon trend persistence.",
        "data_sources": ["scenario.lookbackBars", "scenario.microprice"],
        "correlation_id": f"flash-crash-fragile-{ticker}",
    }
    json.dump(payload, sys.stdout)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
