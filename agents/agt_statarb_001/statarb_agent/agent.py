from __future__ import annotations

from dataclasses import asdict
from datetime import datetime, timezone
from math import isfinite
from typing import Any

import pandas as pd

from .config import AgentConfig, load_config
from .market_data import fetch_price_history
from .statistics import scan_pair_universe
from .storage import SQLiteStateStore
from .types import PairCandidate, PairSignal, PositionInstruction, PositionState


class StatisticalArbitrageAgent:
    def __init__(
        self,
        config: AgentConfig | None = None,
        *,
        config_path: str | None = None,
    ) -> None:
        self.config = config or load_config(config_path)
        self.store = SQLiteStateStore(self.config.sqlite_path)

    def generate_signals(
        self,
        *,
        price_frame: pd.DataFrame | None = None,
    ) -> list[PairSignal]:
        frame = self._prepare_price_frame(price_frame)
        pair_map = scan_pair_universe(
            frame,
            lookback=self.config.lookback_days,
            zscore_window=self.config.zscore_window,
        )
        open_positions = {position.pair_key: position for position in self.store.get_open_positions()}
        signals: list[PairSignal] = []

        for position in open_positions.values():
            candidate = pair_map.get(position.pair_key)
            if candidate is None:
                signals.append(
                    PairSignal(
                        pair_key=position.pair_key,
                        leader_symbol=position.leader_symbol,
                        hedge_symbol=position.hedge_symbol,
                        action="exit",
                        z_score=position.current_z_score,
                        p_value=1.0,
                        hedge_ratio=position.hedge_ratio,
                        half_life_days=self.config.max_half_life_days + 1,
                        conviction=1.0,
                        reason="Closing because the pair no longer has enough history for a retest.",
                    )
                )
                continue

            if candidate.p_value > self.config.cointegration_break_pvalue:
                signals.append(self._exit_signal(candidate, "Cointegration broke on re-test."))
                continue

            if abs(candidate.z_score) >= self.config.stop_zscore:
                signals.append(self._exit_signal(candidate, "Stop-loss hit on spread z-score."))
                continue

            if abs(candidate.z_score) <= self.config.exit_zscore:
                signals.append(self._exit_signal(candidate, "Spread mean-reverted into the exit band."))

        planned_exits = {signal.pair_key for signal in signals if signal.action == "exit"}
        remaining_open_count = max(0, len(open_positions) - len(planned_exits))
        remaining_capacity = max(0, self.config.max_active_pairs - remaining_open_count)

        ranked_candidates = [
            candidate
            for candidate in sorted(
                pair_map.values(),
                key=lambda item: (item.p_value, item.spread_std, item.half_life_days),
            )
            if candidate.p_value <= self.config.cointegration_break_pvalue
            and candidate.half_life_days <= self.config.max_half_life_days
        ]

        for candidate in ranked_candidates:
            if remaining_capacity <= 0 or candidate.pair_key in open_positions:
                continue
            if abs(candidate.z_score) < self.config.entry_zscore:
                continue

            signals.append(
                PairSignal(
                    pair_key=candidate.pair_key,
                    leader_symbol=candidate.leader_symbol,
                    hedge_symbol=candidate.hedge_symbol,
                    action="enter_short_spread"
                    if candidate.z_score > 0
                    else "enter_long_spread",
                    z_score=candidate.z_score,
                    p_value=candidate.p_value,
                    hedge_ratio=candidate.hedge_ratio,
                    half_life_days=candidate.half_life_days,
                    conviction=self._conviction(candidate),
                    reason=(
                        f"Spread z-score is {candidate.z_score:.2f} with p-value "
                        f"{candidate.p_value:.3f} and half-life {candidate.half_life_days:.1f} days."
                    ),
                )
            )
            remaining_capacity -= 1

        for signal in signals:
            self.store.record_signal(signal)
        return signals

    def size_positions(
        self,
        signals: list[PairSignal],
        *,
        nav_usd: float | None = None,
    ) -> list[PositionInstruction]:
        nav = nav_usd or self.config.nav_usd
        pair_budget = nav * self.config.max_pair_pct_nav
        instructions: list[PositionInstruction] = []

        for signal in signals:
            if signal.action == "exit":
                position = self.store.get_position(signal.pair_key)
                if position is None:
                    continue
                instructions.append(
                    PositionInstruction(
                        pair_key=signal.pair_key,
                        action="close",
                        long_symbol=position.long_symbol,
                        short_symbol=position.short_symbol,
                        long_notional_usd=position.long_notional_usd,
                        short_notional_usd=position.short_notional_usd,
                        z_score=signal.z_score,
                        hedge_ratio=signal.hedge_ratio,
                        reason=signal.reason,
                    )
                )
                continue

            leg_budget = pair_budget / 2
            if signal.action == "enter_short_spread":
                long_symbol = signal.hedge_symbol
                short_symbol = signal.leader_symbol
            else:
                long_symbol = signal.leader_symbol
                short_symbol = signal.hedge_symbol

            instructions.append(
                PositionInstruction(
                    pair_key=signal.pair_key,
                    action="open",
                    long_symbol=long_symbol,
                    short_symbol=short_symbol,
                    long_notional_usd=leg_budget,
                    short_notional_usd=leg_budget,
                    z_score=signal.z_score,
                    hedge_ratio=signal.hedge_ratio,
                    reason=signal.reason,
                )
            )

        net_exposure = sum(
            abs(item.long_notional_usd - item.short_notional_usd) for item in instructions
        )
        if nav > 0 and (net_exposure / nav) > self.config.max_net_exposure_pct_nav:
            scale = (self.config.max_net_exposure_pct_nav * nav) / net_exposure
            instructions = [
                PositionInstruction(
                    pair_key=item.pair_key,
                    action=item.action,
                    long_symbol=item.long_symbol,
                    short_symbol=item.short_symbol,
                    long_notional_usd=item.long_notional_usd * scale,
                    short_notional_usd=item.short_notional_usd * scale,
                    z_score=item.z_score,
                    hedge_ratio=item.hedge_ratio,
                    reason=item.reason,
                )
                for item in instructions
            ]

        return instructions

    def execute_trades(
        self,
        instructions: list[PositionInstruction],
        *,
        price_frame: pd.DataFrame | None = None,
    ) -> list[dict[str, Any]]:
        frame = self._prepare_price_frame(price_frame)
        latest_prices = self._latest_price_map(frame)
        results: list[dict[str, Any]] = []

        for instruction in instructions:
            if instruction.action == "open":
                leader_symbol, hedge_symbol = instruction.pair_key.split("|")
                entry_long_price = latest_prices.get(instruction.long_symbol)
                entry_short_price = latest_prices.get(instruction.short_symbol)
                if entry_long_price is None or entry_short_price is None:
                    continue

                self.store.upsert_open_position(
                    instruction,
                    leader_symbol=leader_symbol,
                    hedge_symbol=hedge_symbol,
                    entry_long_price=entry_long_price,
                    entry_short_price=entry_short_price,
                )
                results.append(
                    {
                        "pair_key": instruction.pair_key,
                        "action": "open",
                        "long_symbol": instruction.long_symbol,
                        "short_symbol": instruction.short_symbol,
                        "z_score": instruction.z_score,
                    }
                )
                continue

            position = self.store.get_position(instruction.pair_key)
            if position is None:
                continue

            realized_pnl = self._position_pnl(position, latest_prices)
            attribution = {
                "pair": instruction.pair_key,
                "z_score_at_entry": position.entry_z_score,
                "z_score_at_exit": instruction.z_score,
                "leader_symbol": position.leader_symbol,
                "hedge_symbol": position.hedge_symbol,
                "long_symbol": position.long_symbol,
                "short_symbol": position.short_symbol,
                "pnl_usd": realized_pnl,
            }
            self.store.close_position(instruction, realized_pnl_usd=realized_pnl, attribution=attribution)
            results.append(
                {
                    "pair_key": instruction.pair_key,
                    "action": "close",
                    "realized_pnl_usd": realized_pnl,
                    "z_score": instruction.z_score,
                }
            )

        return results

    def report_status(
        self,
        *,
        price_frame: pd.DataFrame | None = None,
    ) -> dict[str, Any]:
        frame = self._prepare_price_frame(price_frame)
        pair_map = scan_pair_universe(
            frame,
            lookback=self.config.lookback_days,
            zscore_window=self.config.zscore_window,
        )
        latest_prices = self._latest_price_map(frame)
        open_positions = self.store.get_open_positions()
        active_pairs: list[dict[str, Any]] = []
        pair_pnl: list[dict[str, Any]] = []
        current_z_scores: list[dict[str, Any]] = []
        total_pnl = 0.0
        net_exposure = 0.0

        for position in open_positions:
            candidate = pair_map.get(position.pair_key)
            current_z = candidate.z_score if candidate is not None else position.current_z_score
            pnl_usd = self._position_pnl(position, latest_prices)
            self.store.update_mark_to_market(position.pair_key, current_z, pnl_usd)
            total_pnl += pnl_usd
            net_exposure += abs(position.long_notional_usd - position.short_notional_usd)

            active_pairs.append(
                {
                    "pair": position.pair_key,
                    "long_symbol": position.long_symbol,
                    "short_symbol": position.short_symbol,
                    "entry_z_score": position.entry_z_score,
                    "current_z_score": current_z,
                    "pnl_usd": round(pnl_usd, 2),
                }
            )
            current_z_scores.append(
                {
                    "pair": position.pair_key,
                    "z_score": round(current_z, 4),
                }
            )
            pair_pnl.append(
                {
                    "pair": position.pair_key,
                    "pnl_usd": round(pnl_usd, 2),
                }
            )

        cycle_date = datetime.now(timezone.utc).date().isoformat()
        dashboard_payload = {
            "cycle_timestamp": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
            "active_pairs": active_pairs,
            "current_z_scores": current_z_scores,
            "pair_pnl": pair_pnl,
            "net_exposure": round(net_exposure, 2),
            "strategy_sharpe_30d": round(self.store.rolling_sharpe_30d(), 4),
        }
        strategy_return = total_pnl / self.config.nav_usd if self.config.nav_usd else 0.0
        self.store.record_cycle_metric(
            cycle_date=cycle_date,
            strategy_return=strategy_return,
            net_exposure=net_exposure,
            dashboard_payload=dashboard_payload,
        )
        dashboard_payload["strategy_sharpe_30d"] = round(self.store.rolling_sharpe_30d(), 4)
        return dashboard_payload

    def run_cycle(self, *, price_frame: pd.DataFrame | None = None) -> dict[str, Any]:
        frame = self._prepare_price_frame(price_frame)
        signals = self.generate_signals(price_frame=frame)
        instructions = self.size_positions(signals)
        executions = self.execute_trades(instructions, price_frame=frame)
        dashboard = self.report_status(price_frame=frame)
        dashboard["signals"] = [signal.to_dict() for signal in signals]
        dashboard["executions"] = executions
        return dashboard

    def sandbox_fallback_signal(self, symbol: str, price_frame: pd.DataFrame) -> dict[str, Any]:
        closes = price_frame[symbol.upper()].dropna()
        rolling = closes.tail(min(len(closes), self.config.zscore_window))
        std = float(rolling.std(ddof=0)) if len(rolling) > 1 else 0.0
        mean = float(rolling.mean()) if len(rolling) else 0.0
        latest = float(rolling.iloc[-1]) if len(rolling) else 0.0
        z_score = ((latest - mean) / std) if std > 0 else 0.0

        if z_score > self.config.entry_zscore:
            direction = "short"
        elif z_score < -self.config.entry_zscore:
            direction = "long"
        else:
            direction = "close"

        return {
            "ticker": symbol.upper(),
            "direction": direction,
            "conviction": max(0.0, min(abs(z_score) / max(self.config.stop_zscore, 1.0), 1.0)),
            "time_horizon": "swing",
            "stop_loss_pct": 0.03,
            "take_profit_pct": 0.06,
            "max_position_pct": self.config.max_pair_pct_nav,
            "reasoning": (
                "Sandbox fallback used a single-symbol mean-reversion read because the "
                "scenario did not include enough pair history for a full cointegration scan."
            ),
            "data_sources": ["scenario.lookbackBars"],
            "correlation_id": f"{symbol.upper()}-{datetime.now(timezone.utc).date().isoformat()}",
            "z_score": round(z_score, 4),
            "dashboard_payload": {
                "active_pairs": [],
                "current_z_scores": [{"pair": symbol.upper(), "z_score": round(z_score, 4)}],
                "pair_pnl": [],
                "net_exposure": 0.0,
                "strategy_sharpe_30d": round(self.store.rolling_sharpe_30d(), 4),
            },
        }

    def _prepare_price_frame(self, price_frame: pd.DataFrame | None) -> pd.DataFrame:
        frame = price_frame if price_frame is not None else fetch_price_history(
            self.config.universe,
            self.config.lookback_days,
        )
        if not isinstance(frame, pd.DataFrame) or frame.empty:
            raise ValueError("Stat-arb agent needs a non-empty price frame.")
        return frame.sort_index().ffill().dropna(axis=1, how="all")

    def _exit_signal(self, candidate: PairCandidate, reason: str) -> PairSignal:
        return PairSignal(
            pair_key=candidate.pair_key,
            leader_symbol=candidate.leader_symbol,
            hedge_symbol=candidate.hedge_symbol,
            action="exit",
            z_score=candidate.z_score,
            p_value=candidate.p_value,
            hedge_ratio=candidate.hedge_ratio,
            half_life_days=candidate.half_life_days,
            conviction=1.0,
            reason=reason,
        )

    def _conviction(self, candidate: PairCandidate) -> float:
        p_value_component = max(0.0, 1.0 - candidate.p_value)
        z_component = min(abs(candidate.z_score) / max(self.config.stop_zscore, 1.0), 1.0)
        half_life_component = 1.0 if candidate.half_life_days <= 0 else min(
            self.config.max_half_life_days / candidate.half_life_days,
            1.0,
        )
        return max(0.0, min((p_value_component + z_component + half_life_component) / 3, 1.0))

    def _latest_price_map(self, frame: pd.DataFrame) -> dict[str, float]:
        latest = frame.iloc[-1]
        result: dict[str, float] = {}
        for symbol, value in latest.items():
            numeric = float(value)
            if isfinite(numeric):
                result[str(symbol).upper()] = numeric
        return result

    def _position_pnl(
        self,
        position: PositionState,
        latest_prices: dict[str, float],
    ) -> float:
        long_price = latest_prices.get(position.long_symbol)
        short_price = latest_prices.get(position.short_symbol)
        if long_price is None or short_price is None:
            return position.current_pnl_usd

        long_return = (
            (long_price - position.entry_long_price) / position.entry_long_price
            if position.entry_long_price > 0
            else 0.0
        )
        short_return = (
            (position.entry_short_price - short_price) / position.entry_short_price
            if position.entry_short_price > 0
            else 0.0
        )
        return (long_return * position.long_notional_usd) + (
            short_return * position.short_notional_usd
        )
