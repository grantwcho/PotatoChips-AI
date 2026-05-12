from __future__ import annotations

import argparse
import json
import sys
from typing import Any

from trend_agent.agent import TrendFollowingAgent
from trend_agent.market_data import configured_data_sources, market_data_from_scenario


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
    agent: TrendFollowingAgent,
    payload: dict[str, Any] | None,
) -> dict[str, Any]:
    market_data_sources = configured_data_sources()
    prepared = agent._prepare_market_data(None)
    signals = agent._evaluate_asset_states(prepared)
    weights, portfolio_vol_estimate, correlation_filter_applied = agent._calculate_target_weights(
        signals,
        prepared,
    )
    dashboard = agent.report_status(market_data=prepared, persist_equity=False)
    dashboard["correlation_filter_applied"] = correlation_filter_applied
    nav_usd = _resolve_runtime_nav(payload, agent.config.nav_usd)

    best_signal = None
    best_weight = 0.0
    for signal in signals:
        weight = float(weights.get(signal.symbol, 0.0))
        if abs(weight) > abs(best_weight):
            best_signal = signal
            best_weight = weight

    suggested_trades = []
    for signal in signals:
        weight = float(weights.get(signal.symbol, 0.0))
        if abs(weight) < 1e-6:
            continue
        suggested_trades.append(
            {
                "symbol": signal.symbol,
                "side": "buy" if weight > 0 else "sell",
                "targetPositionPctNav": round(abs(weight), 4),
                "requestedNotionalUsd": round(abs(weight) * nav_usd, 2),
                "signal": signal.signal,
                "reason": signal.reason,
                "price": signal.price,
                "atr": signal.atr,
                "fastMa": signal.fast_ma,
                "slowMa": signal.slow_ma,
                "trendMa": signal.trend_ma,
                "breakoutLong": signal.breakout_long,
                "breakoutShort": signal.breakout_short,
                "crossover": signal.crossover,
            }
        )
    suggested_trades = sorted(
        suggested_trades,
        key=lambda item: float(item["targetPositionPctNav"]),
        reverse=True,
    )[:8]

    return {
        "agentId": "AGT-TREND-001",
        "allowedSymbols": sorted(prepared.keys()),
        "allowedExpressionKinds": ["equity"],
        "allowedPairs": [],
        "observation": (
            f"{best_signal.symbol} currently has the strongest trend alignment in the basket."
            if best_signal is not None and abs(best_weight) >= 1e-6
            else "No ETF in the basket currently has enough alignment to justify a fresh trend allocation."
        ),
        "whyItMatters": (
            f"The sleeve's current portfolio-vol estimate is {portfolio_vol_estimate * 100:.2f}% annualized, "
            "and target weights reflect trend alignment after volatility and correlation adjustments."
        ),
        "changeMind": "A new crossover, breakout, stop event, or correlation shift would change the sleeve's next action.",
        "dataConsumed": [
            *market_data_sources,
            "trend_diagnostics",
            "atr",
            "moving_averages",
            "donchian_breakouts",
        ],
        "systematicDiagnostics": {
            "targetWeights": suggested_trades,
            "portfolioVolEstimate": portfolio_vol_estimate,
            "correlationFilterApplied": correlation_filter_applied,
            "signalStates": [signal.to_dict() for signal in signals],
            "portfolioConstraints": {
                "targetAnnualizedVol": agent.config.target_annualized_vol,
                "targetDailyVolPerPosition": agent.config.target_daily_vol_per_position,
                "maxPositionPctNav": agent.config.max_position_pct_nav,
                "maxGrossExposurePctNav": agent.config.max_gross_exposure_pct_nav,
                "maxDrawdownPct": agent.config.max_drawdown_pct,
            },
        },
        "dashboardPayload": dashboard,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", default=None)
    args = parser.parse_args()

    agent = TrendFollowingAgent(config_path=args.config)
    payload = read_stdin_payload()
    market_data_sources = configured_data_sources()

    if payload and payload.get("mode") == "signal":
        symbol = str(payload.get("symbol", "SPY")).upper()
        lookback_bars = payload.get("lookbackBars")
        if isinstance(lookback_bars, list) and lookback_bars:
            scenario_data = market_data_from_scenario(symbol, lookback_bars)
            print(json.dumps(agent.sandbox_signal_from_market_data(market_data=scenario_data)))
            return 0

    if payload and payload.get("mode") == "runtime_evidence":
        print(json.dumps(build_runtime_evidence(agent, payload)))
        return 0

    dashboard = agent.run_cycle()
    non_flat = next(
        (
            state
            for state in dashboard.get("signal_states", [])
            if state.get("signal") in {"long", "short"}
        ),
        None,
    )

    if non_flat is None:
        output = {
            "ticker": "SPY",
            "direction": "close",
            "conviction": 0.0,
            "time_horizon": "position",
            "stop_loss_pct": 0.03,
            "take_profit_pct": 0.12,
            "max_position_pct": agent.config.max_position_pct_nav,
            "reasoning": "No aligned trend signal is active across the configured ETF universe.",
            "data_sources": [*market_data_sources, "trend_rules"],
            "correlation_id": "AGT-TREND-001-no-trade",
            "dashboard_payload": dashboard,
        }
    else:
        price = float(non_flat["price"])
        atr = float(non_flat["atr"])
        trend_gap = abs(float(non_flat["fast_ma"]) - float(non_flat["slow_ma"])) / price if price > 0 else 0.0
        conviction = min(
            trend_gap * 12.0
            + (0.15 if non_flat.get("breakout_long") or non_flat.get("breakout_short") else 0.0)
            + (0.10 if non_flat.get("crossover") else 0.0),
            1.0,
        )
        output = {
            "ticker": str(non_flat["symbol"]),
            "direction": str(non_flat["signal"]),
            "conviction": conviction,
            "time_horizon": "position",
            "stop_loss_pct": (
                (agent.config.trailing_stop_atr_multiple * atr) / price if price > 0 and atr > 0 else 0.03
            ),
            "take_profit_pct": 0.12,
            "max_position_pct": agent.config.max_position_pct_nav,
            "reasoning": str(non_flat["reason"]),
            "data_sources": [*market_data_sources, "trend_rules"],
            "correlation_id": f"{non_flat['symbol']}-{non_flat['signal']}",
            "dashboard_payload": dashboard,
        }

    print(json.dumps(output))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
