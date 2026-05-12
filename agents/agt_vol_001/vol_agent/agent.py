from __future__ import annotations

from typing import Any

import pandas as pd

from .config import AgentConfig, load_config
from .indicators import (
    classify_regime,
    close_frame_from_market_data,
    crowded_correlation_fraction,
    estimate_portfolio_vol,
)
from .market_data import fetch_universe_history
from .storage import SQLiteVolatilityStore
from .types import OpenPosition, PositionInstruction, VolatilitySignalState


class VolatilityTraderAgent:
    def __init__(
        self,
        config: AgentConfig | None = None,
        *,
        config_path: str | None = None,
    ) -> None:
        self.config = config or load_config(config_path)
        self.store = SQLiteVolatilityStore(self.config.sqlite_path)

    def generate_signals(
        self,
        *,
        market_data: dict[str, pd.DataFrame] | None = None,
    ) -> VolatilitySignalState:
        prepared = self._prepare_market_data(market_data)
        signal = self._build_signal_state(prepared)
        self.store.record_signal(signal)
        self.store.record_regime_transition(signal)
        return signal

    def size_positions(
        self,
        signal: VolatilitySignalState,
        *,
        market_data: dict[str, pd.DataFrame] | None = None,
    ) -> list[PositionInstruction]:
        prepared = self._prepare_market_data(market_data)
        open_positions = {
            position.position_id: position for position in self.store.get_open_positions()
        }
        current_nav = self._current_nav(prepared, open_positions)
        raw_targets = self._build_raw_targets(signal)
        adjusted_targets = self._apply_risk_controls(raw_targets, prepared)

        instructions: list[PositionInstruction] = []
        all_position_ids = set(open_positions.keys()) | set(adjusted_targets.keys())
        for position_id in sorted(all_position_ids):
            existing = open_positions.get(position_id)
            target = adjusted_targets.get(position_id)

            if target is None or abs(float(target["weight"])) < 1e-6:
                if existing is not None:
                    instructions.append(
                        self._instruction_from_existing(
                            existing,
                            action="close",
                            price=self._latest_close(prepared[existing.symbol]),
                            reason="Component target was reduced to zero.",
                        )
                    )
                continue

            symbol = str(target["symbol"])
            price = self._latest_close(prepared[symbol])
            weight = float(target["weight"])
            side = "long" if weight > 0 else "short"
            delta_exposure, vega_exposure, gamma_exposure = self._position_exposures(
                symbol,
                weight,
            )
            instruction = PositionInstruction(
                position_id=position_id,
                component=str(target["component"]),
                symbol=symbol,
                action="open",
                side=side,
                target_position_pct_nav=weight,
                price=price,
                current_stop_level=float(target["stop_level"]),
                delta_exposure=delta_exposure,
                vega_exposure=vega_exposure,
                gamma_exposure=gamma_exposure,
                reason=str(target["reason"]),
            )

            if existing is None:
                instructions.append(instruction)
                continue

            if existing.symbol != symbol or existing.side != side:
                instructions.append(PositionInstruction(**{**instruction.to_dict(), "action": "reverse"}))
                continue

            if (
                abs(existing.position_pct_nav - weight) > 0.001
                or abs(existing.current_stop_level - float(target["stop_level"])) > 1e-6
            ):
                instructions.append(PositionInstruction(**{**instruction.to_dict(), "action": "rebalance"}))

        return instructions

    def execute_trades(
        self,
        instructions: list[PositionInstruction],
        *,
        market_data: dict[str, pd.DataFrame] | None = None,
    ) -> list[dict[str, Any]]:
        prepared = self._prepare_market_data(market_data)
        today = self._latest_trade_date(prepared).isoformat()
        open_positions = {
            position.position_id: position for position in self.store.get_open_positions()
        }
        nav = self._current_nav(prepared, open_positions)
        current_regime = self.store.get_state("current_regime") or "flat"
        executions: list[dict[str, Any]] = []

        for instruction in instructions:
            existing = open_positions.get(instruction.position_id)
            if instruction.action in {"close", "reverse", "rebalance"} and existing is not None:
                realized_pnl = self._position_pnl(existing, instruction.price)
                self.store.close_position(
                    position_id=instruction.position_id,
                    exit_date=today,
                    exit_price=instruction.price,
                    realized_pnl_usd=realized_pnl,
                    regime=current_regime,
                )
                executions.append(
                    {
                        "position_id": instruction.position_id,
                        "component": instruction.component,
                        "action": "close",
                        "realized_pnl_usd": round(realized_pnl, 2),
                    }
                )

            if instruction.action in {"open", "reverse", "rebalance"} and instruction.side != "flat":
                self.store.upsert_position(
                    position_id=instruction.position_id,
                    component=instruction.component,
                    symbol=instruction.symbol,
                    side=instruction.side,
                    entry_date=today,
                    entry_price=instruction.price,
                    current_stop_level=instruction.current_stop_level,
                    position_pct_nav=instruction.target_position_pct_nav,
                    entry_notional_usd=abs(instruction.target_position_pct_nav) * nav,
                    delta_exposure=instruction.delta_exposure,
                    vega_exposure=instruction.vega_exposure,
                    gamma_exposure=instruction.gamma_exposure,
                )
                executions.append(
                    {
                        "position_id": instruction.position_id,
                        "component": instruction.component,
                        "symbol": instruction.symbol,
                        "action": instruction.action,
                        "side": instruction.side,
                        "target_position_pct_nav": round(instruction.target_position_pct_nav, 4),
                    }
                )

        return executions

    def report_status(
        self,
        *,
        market_data: dict[str, pd.DataFrame] | None = None,
        persist_equity: bool = True,
    ) -> dict[str, Any]:
        prepared = self._prepare_market_data(market_data)
        today = self._latest_trade_date(prepared)
        signal = self._build_signal_state(prepared)
        open_positions = {
            position.position_id: position for position in self.store.get_open_positions()
        }

        active_positions: list[dict[str, Any]] = []
        unrealized_total = 0.0
        net_exposure = 0.0
        gross_exposure = 0.0
        greek_totals = {"delta": 0.0, "vega": 0.0, "gamma": 0.0}
        unrealized_by_component = {
            "carry": 0.0,
            "mean_reversion": 0.0,
            "tail_hedge": 0.0,
        }

        for position_id, position in open_positions.items():
            frame = prepared.get(position.symbol)
            if frame is None:
                continue
            price = self._latest_close(frame)
            pnl_usd = self._position_pnl(position, price)
            pnl_pct = pnl_usd / position.entry_notional_usd if position.entry_notional_usd else 0.0
            stop_level = self._current_stop_level(position, signal)
            self.store.update_position_metrics(
                position_id=position_id,
                current_stop_level=stop_level,
                last_price=price,
                unrealized_pnl_usd=pnl_usd,
                unrealized_pnl_pct=pnl_pct,
                delta_exposure=0.0,
                vega_exposure=0.0,
                gamma_exposure=0.0,
            )

            unrealized_total += pnl_usd
            net_exposure += position.position_pct_nav
            gross_exposure += abs(position.position_pct_nav)
            unrealized_by_component[position.component] = unrealized_by_component.get(position.component, 0.0) + pnl_usd
            active_positions.append(
                {
                    "position_id": position.position_id,
                    "component": position.component,
                    "symbol": position.symbol,
                    "side": position.side,
                    "position_pct_nav": round(position.position_pct_nav, 4),
                    "current_stop_level": round(stop_level, 4),
                    "unrealized_pnl_usd": round(pnl_usd, 2),
                }
            )

        current_nav = self.config.nav_usd + self.store.total_realized_pnl() + unrealized_total
        peak_nav = max(self._peak_nav(current_nav), current_nav)
        drawdown = (current_nav / peak_nav) - 1.0 if peak_nav > 0 else 0.0
        self.store.set_state("peak_nav_usd", f"{peak_nav:.8f}")

        weights = self._weights_by_symbol(self.store.get_open_positions())
        returns_frame = close_frame_from_market_data(prepared, list(weights.keys())).pct_change().dropna()
        portfolio_vol_estimate = estimate_portfolio_vol(weights, returns_frame)

        if persist_equity:
            self.store.record_equity_point(
                trade_date=today.isoformat(),
                nav_usd=current_nav,
                peak_nav_usd=peak_nav,
                drawdown_pct=drawdown,
                portfolio_vol_estimate=portfolio_vol_estimate,
                gross_exposure_pct_nav=gross_exposure,
                delta_exposure=greek_totals["delta"],
                vega_exposure=greek_totals["vega"],
                gamma_exposure=greek_totals["gamma"],
            )

        realized_by_component = self.store.realized_pnl_by_component()
        pnl_attribution = {}
        for component in ["carry", "mean_reversion", "tail_hedge"]:
            pnl_attribution[component] = round(
                realized_by_component.get(component, 0.0)
                + unrealized_by_component.get(component, 0.0),
                2,
            )
        pnl_attribution["total"] = round(sum(pnl_attribution.values()), 2)

        return {
            "cycle_timestamp": pd.Timestamp.utcnow().replace(microsecond=0).isoformat(),
            "regime": signal.regime,
            "confidence_pct": round(signal.confidence * 100, 1),
            "vix_spot": round(signal.vix_spot, 2),
            "vix3m": round(signal.vix3m, 2),
            "vix_ratio": round(signal.ratio, 4),
            "signal_state": signal.to_dict(),
            "active_positions": active_positions,
            "greeks_snapshot": {
                "available": False,
                "reason": "This sleeve currently routes ETF volatility proxies, so live option-chain Greeks are not available.",
            },
            "pnl_attribution": pnl_attribution,
            "regime_transition_history": [
                transition.to_dict() for transition in self.store.get_recent_transitions(10)
            ],
            "net_exposure_pct_nav": round(net_exposure, 4),
            "gross_exposure_pct_nav": round(gross_exposure, 4),
            "portfolio_vol_estimate": round(portfolio_vol_estimate, 4),
            "drawdown_from_peak": round(drawdown, 4),
            "equity_curve": self.store.recent_equity_curve(90),
        }

    def run_cycle(
        self,
        *,
        market_data: dict[str, pd.DataFrame] | None = None,
    ) -> dict[str, Any]:
        prepared = self._prepare_market_data(market_data)
        signal = self.generate_signals(market_data=prepared)
        instructions = self.size_positions(signal, market_data=prepared)
        executions = self.execute_trades(instructions, market_data=prepared)
        dashboard = self.report_status(market_data=prepared)
        dashboard["signal"] = signal.to_dict()
        dashboard["executions"] = executions
        return dashboard

    def sandbox_signal_from_market_data(
        self,
        *,
        market_data: dict[str, pd.DataFrame],
    ) -> dict[str, Any]:
        signal = self._build_signal_state(market_data)
        if signal.carry_signal == "long_svxy":
            ticker = "SVXY"
            direction = "long"
        elif signal.carry_signal == "long_uvxy":
            ticker = "UVXY"
            direction = "long"
        elif signal.mean_reversion_signal == "long_svxy":
            ticker = "SVXY"
            direction = "long"
        elif signal.tail_hedge_signal == "long_uvxy":
            ticker = "UVXY"
            direction = "long"
        else:
            ticker = "SVXY"
            direction = "close"

        return {
            "ticker": ticker,
            "direction": direction,
            "conviction": round(signal.confidence, 4),
            "time_horizon": "position",
            "stop_loss_pct": 0.06,
            "take_profit_pct": 0.15,
            "max_position_pct": self.config.carry_max_pct_nav,
            "reasoning": signal.reason,
            "data_sources": ["scenario.lookbackBars", "vol_rules"],
            "correlation_id": f"AGT-VOL-001-{signal.regime}",
            "dashboard_payload": self.report_status(
                market_data=market_data,
                persist_equity=False,
            ),
        }

    def _prepare_market_data(
        self,
        market_data: dict[str, pd.DataFrame] | None,
    ) -> dict[str, pd.DataFrame]:
        if market_data is not None:
            prepared = {
                symbol.upper(): frame.sort_index().copy()
                for symbol, frame in market_data.items()
                if isinstance(frame, pd.DataFrame) and not frame.empty
            }
        else:
            prepared = fetch_universe_history(self.config.universe, lookback_days=300)

        required = {"^VIX", "^VIX3M", "SVXY", "UVXY", "SPY"}
        missing = sorted(symbol for symbol in required if symbol not in prepared)
        if missing:
            raise ValueError(f"Missing required volatility data: {', '.join(missing)}")
        return prepared

    def _build_signal_state(
        self,
        market_data: dict[str, pd.DataFrame],
    ) -> VolatilitySignalState:
        vix_spot = self._latest_close(market_data["^VIX"])
        vix3m = self._latest_close(market_data["^VIX3M"])
        regime, confidence, ratio, reason = classify_regime(
            vix_spot=vix_spot,
            vix3m=vix3m,
            contango_ratio_threshold=self.config.contango_ratio_threshold,
            backwardation_ratio_threshold=self.config.backwardation_ratio_threshold,
            confidence_floor=self.config.confidence_floor,
            confidence_ceiling=self.config.confidence_ceiling,
        )

        if regime == "contango":
            carry_signal = "long_svxy"
        elif regime == "backwardation":
            carry_signal = "long_uvxy"
        else:
            carry_signal = "flat"

        if self.config.mean_reversion_vix_threshold < vix_spot <= self.config.mean_reversion_stop_vix:
            mean_reversion_signal = "long_svxy"
        else:
            mean_reversion_signal = "flat"

        if vix_spot < self.config.cheap_tail_vix_threshold:
            tail_hedge_signal = "long_uvxy"
        else:
            tail_hedge_signal = "flat"

        return VolatilitySignalState(
            regime=regime,
            confidence=confidence,
            vix_spot=vix_spot,
            vix3m=vix3m,
            ratio=ratio,
            carry_signal=carry_signal,
            mean_reversion_signal=mean_reversion_signal,
            tail_hedge_signal=tail_hedge_signal,
            reason=reason,
        )

    def _build_raw_targets(
        self,
        signal: VolatilitySignalState,
    ) -> dict[str, dict[str, Any]]:
        confidence_scale = max(signal.confidence, self.config.confidence_floor)
        targets: dict[str, dict[str, Any]] = {}

        if signal.regime == "contango":
            carry_weight = min(
                self.config.carry_base_pct_nav * confidence_scale,
                self.config.carry_max_pct_nav,
            )
            targets["carry"] = {
                "position_id": "carry",
                "component": "carry",
                "symbol": "SVXY",
                "weight": carry_weight,
                "stop_level": self.config.contango_ratio_threshold,
                "reason": "Contango regime favors harvesting roll yield through inverse-vol exposure.",
            }
        elif signal.regime == "backwardation":
            carry_weight = min(
                self.config.carry_base_pct_nav * 2.0 * confidence_scale,
                self.config.carry_max_pct_nav,
            )
            targets["carry"] = {
                "position_id": "carry",
                "component": "carry",
                "symbol": "UVXY",
                "weight": carry_weight,
                "stop_level": self.config.backwardation_ratio_threshold,
                "reason": "Backwardation regime calls for long-vol crash protection at double normal size.",
            }

        if signal.mean_reversion_signal == "long_svxy":
            stretch = min(
                (signal.vix_spot - self.config.mean_reversion_vix_threshold)
                / max(self.config.mean_reversion_stop_vix - self.config.mean_reversion_vix_threshold, 1e-6),
                1.0,
            )
            mean_reversion_weight = self.config.mean_reversion_max_pct_nav * max(0.35, stretch)
            targets["mean_reversion"] = {
                "position_id": "mean_reversion",
                "component": "mean_reversion",
                "symbol": "SVXY",
                "weight": mean_reversion_weight,
                "stop_level": self.config.mean_reversion_stop_vix,
                "reason": "Spot VIX is stretched above 30, so the mean-reversion overlay leans into short-vol snapback.",
            }

        if signal.tail_hedge_signal == "long_uvxy":
            cheapness = max(
                (self.config.cheap_tail_vix_threshold - signal.vix_spot)
                / max(self.config.cheap_tail_vix_threshold, 1e-6),
                0.25,
            )
            tail_weight = min(
                self.config.tail_hedge_max_pct_nav * cheapness * 1.4,
                self.config.tail_hedge_max_pct_nav,
            )
            targets["tail_hedge"] = {
                "position_id": "tail_hedge",
                "component": "tail_hedge",
                "symbol": "UVXY",
                "weight": tail_weight,
                "stop_level": self.config.cheap_tail_vix_threshold,
                "reason": "Vol is cheap enough to own a small tail hedge.",
            }

        return targets

    def _apply_risk_controls(
        self,
        targets: dict[str, dict[str, Any]],
        market_data: dict[str, pd.DataFrame],
    ) -> dict[str, dict[str, Any]]:
        adjusted = {key: {**value} for key, value in targets.items()}
        non_hedge_symbols = sorted(
            {
                str(target["symbol"])
                for target in adjusted.values()
                if abs(float(target["weight"])) > 0
            }
        )
        if len(non_hedge_symbols) > 1:
            crowded_fraction = crowded_correlation_fraction(
                market_data,
                non_hedge_symbols,
                self.config.correlation_window_days,
                self.config.correlation_threshold,
            )
            if crowded_fraction > self.config.correlation_fraction_threshold:
                for target in adjusted.values():
                    target["weight"] = float(target["weight"]) * 0.5
                    target["reason"] = f"{target['reason']} Correlation filter halved size."

        weights = self._weights_by_symbol_from_targets(adjusted)
        returns_frame = close_frame_from_market_data(market_data, list(weights.keys())).pct_change().dropna()
        portfolio_vol = estimate_portfolio_vol(weights, returns_frame)
        if portfolio_vol > self.config.max_portfolio_vol_contribution_annualized and portfolio_vol > 0:
            vol_scale = self.config.max_portfolio_vol_contribution_annualized / portfolio_vol
            for target in adjusted.values():
                target["weight"] = float(target["weight"]) * vol_scale
                target["reason"] = f"{target['reason']} Portfolio-vol cap scaled the sleeve down."

        return adjusted

    def _current_nav(
        self,
        market_data: dict[str, pd.DataFrame],
        open_positions: dict[str, OpenPosition] | None = None,
    ) -> float:
        positions = open_positions or {
            position.position_id: position for position in self.store.get_open_positions()
        }
        unrealized = 0.0
        for position in positions.values():
            frame = market_data.get(position.symbol)
            if frame is None:
                continue
            unrealized += self._position_pnl(position, self._latest_close(frame))
        return self.config.nav_usd + self.store.total_realized_pnl() + unrealized

    def _peak_nav(self, fallback: float) -> float:
        raw = self.store.get_state("peak_nav_usd")
        if raw is None:
            return fallback
        try:
            return float(raw)
        except ValueError:
            return fallback

    def _position_pnl(self, position: OpenPosition, current_price: float) -> float:
        if position.entry_price <= 0:
            return 0.0
        direction = 1.0 if position.side == "long" else -1.0
        return position.entry_notional_usd * ((current_price / position.entry_price) - 1.0) * direction

    def _position_exposures(
        self,
        symbol: str,
        weight: float,
    ) -> tuple[float, float, float]:
        _ = (symbol, weight)
        return (0.0, 0.0, 0.0)

    def _weights_by_symbol(self, positions: list[OpenPosition]) -> dict[str, float]:
        weights: dict[str, float] = {}
        for position in positions:
            weights[position.symbol] = weights.get(position.symbol, 0.0) + position.position_pct_nav
        return weights

    def _weights_by_symbol_from_targets(
        self,
        targets: dict[str, dict[str, Any]],
    ) -> dict[str, float]:
        weights: dict[str, float] = {}
        for target in targets.values():
            weight = float(target["weight"])
            if abs(weight) < 1e-6:
                continue
            symbol = str(target["symbol"])
            weights[symbol] = weights.get(symbol, 0.0) + weight
        return weights

    def _instruction_from_existing(
        self,
        position: OpenPosition,
        *,
        action: str,
        price: float,
        reason: str,
    ) -> PositionInstruction:
        return PositionInstruction(
            position_id=position.position_id,
            component=position.component,
            symbol=position.symbol,
            action=action,
            side="flat",
            target_position_pct_nav=0.0,
            price=price,
            current_stop_level=position.current_stop_level,
            delta_exposure=0.0,
            vega_exposure=0.0,
            gamma_exposure=0.0,
            reason=reason,
        )

    def _current_stop_level(
        self,
        position: OpenPosition,
        signal: VolatilitySignalState,
    ) -> float:
        if position.component == "mean_reversion":
            return self.config.mean_reversion_stop_vix
        if position.component == "tail_hedge":
            return self.config.cheap_tail_vix_threshold
        if position.component == "carry" and position.symbol == "SVXY":
            return self.config.contango_ratio_threshold
        if position.component == "carry" and position.symbol == "UVXY":
            return self.config.backwardation_ratio_threshold
        return position.current_stop_level

    def _latest_close(self, frame: pd.DataFrame) -> float:
        return float(frame["Close"].dropna().iloc[-1])

    def _latest_trade_date(self, market_data: dict[str, pd.DataFrame]) -> pd.Timestamp:
        index_sets = [set(frame.index) for frame in market_data.values() if not frame.empty]
        common_dates = sorted(set.intersection(*index_sets))
        if not common_dates:
            raise ValueError("No common timestamp exists across volatility market data.")
        return pd.Timestamp(common_dates[-1])
