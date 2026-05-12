from __future__ import annotations

import argparse
import json
import sys
from typing import Any

from vol_agent.agent import VolatilityTraderAgent
from vol_agent.market_data import configured_data_sources, market_data_from_scenario


def read_stdin_payload() -> dict[str, Any] | None:
    if sys.stdin.isatty():
        return None

    raw = sys.stdin.read().strip()
    if not raw:
        return None

    return json.loads(raw)


def _as_positive_float(value: Any) -> float | None:
    if isinstance(value, (int, float)) and float(value) > 0:
        return float(value)
    if isinstance(value, str) and value.strip():
        try:
            parsed = float(value)
        except ValueError:
            return None
        return parsed if parsed > 0 else None
    return None


def _resolve_runtime_nav(payload: dict[str, Any] | None, fallback: float) -> float:
    if payload:
        for key in ("portfolioValue", "navUsd", "portfolio_value", "nav_usd"):
            resolved = _as_positive_float(payload.get(key))
            if resolved is not None:
                return resolved
    return fallback


def build_runtime_evidence(
    agent: VolatilityTraderAgent,
    payload: dict[str, Any] | None,
) -> dict[str, Any]:
    market_data_sources = configured_data_sources()
    prepared = agent._prepare_market_data(None)
    signal = agent._build_signal_state(prepared)
    raw_targets = agent._build_raw_targets(signal)
    adjusted_targets = agent._apply_risk_controls(raw_targets, prepared)

    dashboard = agent.report_status(market_data=prepared, persist_equity=False)
    nav_usd = _resolve_runtime_nav(payload, agent.config.nav_usd)
    sorted_targets = [
        target
        for target in sorted(
            adjusted_targets.values(),
            key=lambda item: abs(float(item["weight"])),
            reverse=True,
        )
        if abs(float(target["weight"])) > 1e-6
    ]
    target_expressions = [
        {
            "component": str(target["component"]),
            "symbol": str(target["symbol"]),
            "side": "buy" if float(target["weight"]) > 0 else "sell",
            "targetPositionPctNav": round(abs(float(target["weight"])), 4),
            "requestedNotionalUsd": round(abs(float(target["weight"])) * nav_usd, 2),
            "stopLevel": float(target["stop_level"]),
            "reason": str(target["reason"]),
        }
        for target in sorted_targets
    ]
    primary_target = target_expressions[0] if target_expressions else None

    return {
        "agentId": "AGT-VOL-001",
        "allowedSymbols": sorted(prepared.keys()),
        "allowedExpressionKinds": ["equity"],
        "allowedPairs": [],
        "observation": (
            f"{signal.regime.title()} is the current vol regime with {primary_target['symbol']} as the strongest available proxy expression."
            if primary_target is not None
            else "Volatility is in a transition regime with no clean proxy expression currently active."
        ),
        "whyItMatters": (
            f"VIX spot is {signal.vix_spot:.2f}, VIX3M is {signal.vix3m:.2f}, and the term-structure ratio is "
            f"{signal.ratio:.3f}."
        ),
        "changeMind": "A regime flip, spot-VIX stretch, or tighter risk envelope would change the sleeve's next action.",
        "dataConsumed": [
            *market_data_sources,
            "^VIX",
            "^VIX3M",
            "SVXY",
            "UVXY",
            "SPY",
            "volatility_diagnostics",
        ],
        "systematicDiagnostics": {
            "regime": signal.to_dict(),
            "targetExpressions": target_expressions,
            "riskContext": {
                "maxPortfolioVolContributionAnnualized": agent.config.max_portfolio_vol_contribution_annualized,
                "carryMaxPctNav": agent.config.carry_max_pct_nav,
                "meanReversionMaxPctNav": agent.config.mean_reversion_max_pct_nav,
                "tailHedgeMaxPctNav": agent.config.tail_hedge_max_pct_nav,
            },
            "greeksAvailable": False,
        },
        "dashboardPayload": dashboard,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", default=None)
    args = parser.parse_args()

    agent = VolatilityTraderAgent(config_path=args.config)
    payload = read_stdin_payload()
    market_data_sources = configured_data_sources()

    if payload and payload.get("mode") == "signal":
        scenario_data = market_data_from_scenario(payload)
        print(json.dumps(agent.sandbox_signal_from_market_data(market_data=scenario_data)))
        return 0

    if payload and payload.get("mode") == "runtime_evidence":
        print(json.dumps(build_runtime_evidence(agent, payload)))
        return 0

    dashboard = agent.run_cycle()
    signal = dashboard["signal"]
    if signal["carry_signal"] == "long_svxy":
        ticker = "SVXY"
        direction = "long"
    elif signal["carry_signal"] == "long_uvxy":
        ticker = "UVXY"
        direction = "long"
    elif signal["mean_reversion_signal"] == "long_svxy":
        ticker = "SVXY"
        direction = "long"
    elif signal["tail_hedge_signal"] == "long_uvxy":
        ticker = "UVXY"
        direction = "long"
    else:
        ticker = "SVXY"
        direction = "close"

    output = {
        "ticker": ticker,
        "direction": direction,
        "conviction": round(float(signal["confidence"]), 4),
        "time_horizon": "position",
        "stop_loss_pct": 0.06,
        "take_profit_pct": 0.15,
        "max_position_pct": agent.config.carry_max_pct_nav,
        "reasoning": str(signal["reason"]),
        "data_sources": [*market_data_sources, "vol_rules"],
        "correlation_id": f"AGT-VOL-001-{signal['regime']}",
        "dashboard_payload": dashboard,
    }
    print(json.dumps(output))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
