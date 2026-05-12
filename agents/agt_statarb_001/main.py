from __future__ import annotations

import argparse
import json
import sys
from typing import Any

from statarb_agent.agent import StatisticalArbitrageAgent
from statarb_agent.market_data import configured_data_sources, frame_from_scenario


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
    agent: StatisticalArbitrageAgent,
    payload: dict[str, Any] | None,
) -> dict[str, Any]:
    market_data_sources = configured_data_sources()
    frame = agent._prepare_price_frame(None)
    signals = agent.generate_signals(price_frame=frame)
    nav_usd = _resolve_runtime_nav(payload, agent.config.nav_usd)
    instructions = agent.size_positions(signals, nav_usd=nav_usd)
    dashboard = agent.report_status(price_frame=frame)
    open_instructions = [
        instruction for instruction in instructions if instruction.action == "open"
    ]

    top_candidates = sorted(
        (signal for signal in signals if signal.action in {"enter_long_spread", "enter_short_spread"}),
        key=lambda signal: abs(float(signal.z_score)),
        reverse=True,
    )[:8]
    allowed_pairs = [
        {
            "pairKey": instruction.pair_key,
            "longSymbol": instruction.long_symbol,
            "shortSymbol": instruction.short_symbol,
        }
        for instruction in open_instructions
    ]
    top_pair = open_instructions[0] if open_instructions else None

    return {
        "agentId": "AGT-STATARB-001",
        "allowedSymbols": sorted(str(column).upper() for column in frame.columns),
        "allowedExpressionKinds": ["equity_pair"],
        "allowedPairs": allowed_pairs,
        "observation": (
            f"Top spread candidate is {top_pair.long_symbol} versus {top_pair.short_symbol}."
            if top_pair is not None
            else "No pair currently clears the cointegration, half-life, and z-score gates."
        ),
        "whyItMatters": (
            "The sleeve only wants relative-value entries when the spread is statistically stretched enough to justify a dollar-neutral position."
        ),
        "changeMind": (
            "A cleaner spread dislocation, stronger reversion stats, or a fresh break in an open pair would change the sleeve's next action."
        ),
        "dataConsumed": [
            *market_data_sources,
            "cointegration_diagnostics",
            "engle_granger",
            "spread_zscore",
        ],
        "systematicDiagnostics": {
            "candidatePairs": [signal.to_dict() for signal in top_candidates],
            "openInstructions": [instruction.to_dict() for instruction in open_instructions[:4]],
            "requestedNavUsd": nav_usd,
            "portfolioConstraints": {
                "maxActivePairs": agent.config.max_active_pairs,
                "maxPairPctNav": agent.config.max_pair_pct_nav,
                "maxNetExposurePctNav": agent.config.max_net_exposure_pct_nav,
                "maxHalfLifeDays": agent.config.max_half_life_days,
                "cointegrationBreakPValue": agent.config.cointegration_break_pvalue,
            },
        },
        "dashboardPayload": dashboard,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", default=None)
    args = parser.parse_args()

    agent = StatisticalArbitrageAgent(config_path=args.config)
    payload = read_stdin_payload()
    market_data_sources = configured_data_sources()

    if payload and payload.get("mode") == "signal":
        symbol = str(payload.get("symbol", "SPY")).upper()
        lookback_bars = payload.get("lookbackBars")
        if isinstance(lookback_bars, list) and lookback_bars:
            scenario_frame = frame_from_scenario(symbol, lookback_bars)
            print(
                json.dumps(
                    {
                        "ticker": symbol,
                        "direction": "close",
                        "conviction": 0.0,
                        "time_horizon": "swing",
                        "stop_loss_pct": 0.03,
                        "take_profit_pct": 0.06,
                        "max_position_pct": agent.config.max_pair_pct_nav,
                        "reasoning": (
                            "Single-symbol scenario bars are insufficient for a live pair-trading scan. "
                            "AGT-STATARB-001 requires real multi-symbol history to form a spread view."
                        ),
                        "data_sources": ["scenario.lookbackBars"],
                        "correlation_id": f"{symbol}-insufficient-pair-history",
                        "dashboard_payload": {
                            "active_pairs": [],
                            "current_z_scores": [],
                            "pair_pnl": [],
                            "net_exposure": 0.0,
                            "strategy_sharpe_30d": round(
                                agent.store.rolling_sharpe_30d(), 4
                            ),
                            "insufficient_pair_history": True,
                        },
                    }
                )
            )
            return 0

    if payload and payload.get("mode") == "runtime_evidence":
        print(json.dumps(build_runtime_evidence(agent, payload)))
        return 0

    result = agent.run_cycle()
    best_signal = next(
        (
            signal
            for signal in result.get("signals", [])
            if signal.get("action") in {"enter_long_spread", "enter_short_spread"}
        ),
        None,
    )

    if best_signal is None:
        output = {
            "ticker": "SPY",
            "direction": "close",
            "conviction": 0.0,
            "time_horizon": "swing",
            "stop_loss_pct": 0.03,
            "take_profit_pct": 0.06,
            "max_position_pct": agent.config.max_pair_pct_nav,
            "reasoning": "No qualifying pair met the stat-arb entry thresholds this cycle.",
            "data_sources": market_data_sources,
            "correlation_id": "AGT-STATARB-001-no-trade",
            "dashboard_payload": result,
        }
    else:
        action = str(best_signal["action"])
        output = {
            "ticker": str(best_signal["leader_symbol"]).upper(),
            "secondary_symbol": str(best_signal["hedge_symbol"]).upper(),
            "pair": str(best_signal["pair_key"]),
            "direction": "short" if action == "enter_short_spread" else "long",
            "conviction": float(best_signal["conviction"]),
            "time_horizon": "swing",
            "stop_loss_pct": 0.03,
            "take_profit_pct": 0.06,
            "max_position_pct": agent.config.max_pair_pct_nav,
            "reasoning": str(best_signal["reason"]),
            "data_sources": [*market_data_sources, "cointegration_scan"],
            "correlation_id": str(best_signal["pair_key"]),
            "dashboard_payload": result,
        }

    print(json.dumps(output))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
