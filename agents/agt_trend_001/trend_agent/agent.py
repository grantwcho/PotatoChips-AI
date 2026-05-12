from __future__ import annotations

from datetime import timedelta
from typing import Any

import pandas as pd

from .config import AgentConfig, load_config
from .indicators import (
    average_true_range,
    close_frame_from_market_data,
    crowded_correlation_fraction,
    donchian_channels,
    estimate_portfolio_vol,
    latest_crossover,
    moving_average,
)
from .market_data import fetch_universe_history
from .storage import SQLiteTrendStore
from .types import AssetSignalState, OpenPosition, PositionInstruction


class TrendFollowingAgent:
    def __init__(
        self,
        config: AgentConfig | None = None,
        *,
        config_path: str | None = None,
    ) -> None:
        self.config = config or load_config(config_path)
        self.store = SQLiteTrendStore(self.config.sqlite_path)

    def generate_signals(
        self,
        *,
        market_data: dict[str, pd.DataFrame] | None = None,
    ) -> list[AssetSignalState]:
        prepared = self._prepare_market_data(market_data)
        signals = self._evaluate_asset_states(prepared)
        for signal in signals:
            self.store.record_signal(signal)
        return signals

    def size_positions(
        self,
        signals: list[AssetSignalState],
        *,
        market_data: dict[str, pd.DataFrame] | None = None,
    ) -> list[PositionInstruction]:
        prepared = self._prepare_market_data(market_data)
        today = self._latest_trade_date(prepared)
        open_positions = {position.symbol: position for position in self.store.get_open_positions()}
        current_nav = self._current_nav(prepared, open_positions)
        peak_nav = self._peak_nav(current_nav)
        drawdown = (current_nav / peak_nav) - 1 if peak_nav > 0 else 0.0

        if drawdown <= -self.config.max_drawdown_pct:
            pause_until = self._next_trading_day(today, self.config.pause_days_after_breaker)
            self.store.set_state("pause_until", pause_until.isoformat())
            self.store.set_state("peak_nav_usd", f"{current_nav:.8f}")
            return [
                PositionInstruction(
                    symbol=position.symbol,
                    action="close",
                    side="flat",
                    target_position_pct_nav=0.0,
                    price=self._latest_close(prepared[position.symbol]),
                    atr=self._latest_atr(prepared[position.symbol]),
                    stop_level=position.current_stop_level,
                    reason="Portfolio drawdown circuit breaker triggered.",
                )
                for position in open_positions.values()
            ]

        if self._is_paused(today):
            return [
                PositionInstruction(
                    symbol=position.symbol,
                    action="close",
                    side="flat",
                    target_position_pct_nav=0.0,
                    price=self._latest_close(prepared[position.symbol]),
                    atr=self._latest_atr(prepared[position.symbol]),
                    stop_level=position.current_stop_level,
                    reason="Trend book is paused after the drawdown circuit breaker.",
                )
                for position in open_positions.values()
            ]

        weights, _, _ = self._calculate_target_weights(signals, prepared)
        instructions: list[PositionInstruction] = []

        for signal in signals:
            existing = open_positions.get(signal.symbol)
            target_weight = weights.get(signal.symbol, 0.0)

            if signal.signal == "flat" or target_weight == 0.0:
                if existing is not None:
                    instructions.append(
                        PositionInstruction(
                            symbol=signal.symbol,
                            action="close",
                            side="flat",
                            target_position_pct_nav=0.0,
                            price=signal.price,
                            atr=signal.atr,
                            stop_level=signal.current_stop_level,
                            reason=signal.reason,
                        )
                    )
                continue

            desired_side = "long" if target_weight > 0 else "short"
            desired_weight = float(target_weight)
            stop_level = self._initial_stop(
                side=desired_side,
                price=signal.price,
                atr=signal.atr,
            )

            if existing is None:
                instructions.append(
                    PositionInstruction(
                        symbol=signal.symbol,
                        action="open",
                        side=desired_side,
                        target_position_pct_nav=desired_weight,
                        price=signal.price,
                        atr=signal.atr,
                        stop_level=stop_level,
                        reason=signal.reason,
                    )
                )
                continue

            if existing.side != desired_side:
                instructions.append(
                    PositionInstruction(
                        symbol=signal.symbol,
                        action="reverse",
                        side=desired_side,
                        target_position_pct_nav=desired_weight,
                        price=signal.price,
                        atr=signal.atr,
                        stop_level=stop_level,
                        reason=signal.reason,
                    )
                )
                continue

            if abs(existing.position_pct_nav - desired_weight) > 0.005:
                instructions.append(
                    PositionInstruction(
                        symbol=signal.symbol,
                        action="rebalance",
                        side=desired_side,
                        target_position_pct_nav=desired_weight,
                        price=signal.price,
                        atr=signal.atr,
                        stop_level=signal.current_stop_level or stop_level,
                        reason=signal.reason,
                    )
                )

        return instructions

    def execute_trades(
        self,
        instructions: list[PositionInstruction],
        *,
        market_data: dict[str, pd.DataFrame] | None = None,
    ) -> list[dict[str, Any]]:
        prepared = self._prepare_market_data(market_data)
        today = self._latest_trade_date(prepared).isoformat()
        open_positions = {position.symbol: position for position in self.store.get_open_positions()}
        nav = self._current_nav(prepared, open_positions)
        executions: list[dict[str, Any]] = []

        for instruction in instructions:
            existing = open_positions.get(instruction.symbol)

            if instruction.action in {"close", "reverse", "rebalance"} and existing is not None:
                realized_pnl = self._position_pnl(existing, instruction.price)
                self.store.close_position(
                    symbol=instruction.symbol,
                    exit_date=today,
                    exit_price=instruction.price,
                    realized_pnl_usd=realized_pnl,
                )
                executions.append(
                    {
                        "symbol": instruction.symbol,
                        "action": "close",
                        "realized_pnl_usd": round(realized_pnl, 2),
                    }
                )

            if instruction.action in {"open", "reverse", "rebalance"} and instruction.side != "flat":
                self.store.upsert_position(
                    symbol=instruction.symbol,
                    side=instruction.side,
                    entry_date=today,
                    entry_price=instruction.price,
                    atr_at_entry=instruction.atr,
                    current_stop_level=instruction.stop_level or instruction.price,
                    position_pct_nav=instruction.target_position_pct_nav,
                    entry_notional_usd=abs(instruction.target_position_pct_nav) * nav,
                )
                executions.append(
                    {
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
        signal_states = self._evaluate_asset_states(prepared)
        open_positions = {position.symbol: position for position in self.store.get_open_positions()}
        signal_by_symbol = {signal.symbol: signal for signal in signal_states}

        active_position_sizes: list[dict[str, Any]] = []
        gross_exposure = 0.0
        unrealized_total = 0.0

        for symbol, position in open_positions.items():
            frame = prepared.get(symbol)
            if frame is None:
                continue
            price = self._latest_close(frame)
            signal = signal_by_symbol.get(symbol)
            atr = signal.atr if signal is not None else self._latest_atr(frame)
            highest_close = max(position.highest_close, price)
            lowest_close = min(position.lowest_close, price)
            stop_level = position.current_stop_level
            if position.side == "long":
                stop_level = max(stop_level, highest_close - self.config.trailing_stop_atr_multiple * atr)
            elif position.side == "short":
                stop_level = min(stop_level, lowest_close + self.config.trailing_stop_atr_multiple * atr)

            pnl_usd = self._position_pnl(position, price)
            pnl_pct = pnl_usd / position.entry_notional_usd if position.entry_notional_usd else 0.0
            self.store.update_position_metrics(
                symbol=symbol,
                current_stop_level=stop_level,
                highest_close=highest_close,
                lowest_close=lowest_close,
                last_price=price,
                unrealized_pnl_usd=pnl_usd,
                unrealized_pnl_pct=pnl_pct,
            )
            unrealized_total += pnl_usd
            gross_exposure += abs(position.position_pct_nav)
            active_position_sizes.append(
                {
                    "symbol": symbol,
                    "side": position.side,
                    "position_pct_nav": round(position.position_pct_nav, 4),
                    "current_stop_level": round(stop_level, 4),
                    "unrealized_pnl_usd": round(pnl_usd, 2),
                }
            )

        current_nav = self.config.nav_usd + self.store.total_realized_pnl() + unrealized_total
        peak_nav = max(self._peak_nav(current_nav), current_nav)
        drawdown = (current_nav / peak_nav) - 1 if peak_nav > 0 else 0.0
        self.store.set_state("peak_nav_usd", f"{peak_nav:.8f}")

        weights = {position.symbol: position.position_pct_nav for position in self.store.get_open_positions()}
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
            )

        current_positions_by_symbol = {
            position.symbol: position.position_pct_nav for position in self.store.get_open_positions()
        }
        dashboard_signal_states = []
        for signal in signal_states:
            dashboard_signal_states.append(
                {
                    **signal.to_dict(),
                    "current_position_pct_nav": round(
                        current_positions_by_symbol.get(signal.symbol, 0.0), 4
                    ),
                }
            )

        return {
            "cycle_timestamp": pd.Timestamp.utcnow().replace(microsecond=0).isoformat(),
            "signal_states": dashboard_signal_states,
            "active_positions": active_position_sizes,
            "portfolio_vol_estimate": round(portfolio_vol_estimate, 4),
            "drawdown_from_peak": round(drawdown, 4),
            "equity_curve": self.store.recent_equity_curve(90),
            "gross_exposure_pct_nav": round(gross_exposure, 4),
            "pause_until": self.store.get_state("pause_until"),
            "circuit_breaker_active": self._is_paused(today),
        }

    def run_cycle(
        self,
        *,
        market_data: dict[str, pd.DataFrame] | None = None,
    ) -> dict[str, Any]:
        prepared = self._prepare_market_data(market_data)
        signals = self.generate_signals(market_data=prepared)
        instructions = self.size_positions(signals, market_data=prepared)
        executions = self.execute_trades(instructions, market_data=prepared)
        dashboard = self.report_status(market_data=prepared)
        dashboard["signals"] = [signal.to_dict() for signal in signals]
        dashboard["executions"] = executions
        return dashboard

    def sandbox_signal_from_market_data(
        self,
        *,
        market_data: dict[str, pd.DataFrame],
    ) -> dict[str, Any]:
        signals = self._evaluate_asset_states(market_data)
        signal = signals[0]
        return {
            "ticker": signal.symbol,
            "direction": "close" if signal.signal == "flat" else signal.signal,
            "conviction": self._signal_conviction(signal),
            "time_horizon": "position",
            "stop_loss_pct": self._stop_loss_pct(signal),
            "take_profit_pct": 0.12,
            "max_position_pct": self.config.max_position_pct_nav,
            "reasoning": signal.reason,
            "data_sources": ["scenario.lookbackBars", "trend_rules"],
            "correlation_id": f"{signal.symbol}-{signal.signal}",
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
            return {
                symbol.upper(): frame.sort_index().copy()
                for symbol, frame in market_data.items()
                if isinstance(frame, pd.DataFrame) and not frame.empty
            }
        return fetch_universe_history(
            self.config.universe,
            lookback_days=max(self.config.trend_filter_days, 260),
        )

    def _evaluate_asset_states(
        self,
        market_data: dict[str, pd.DataFrame],
    ) -> list[AssetSignalState]:
        open_positions = {position.symbol: position for position in self.store.get_open_positions()}
        today = self._latest_trade_date(market_data)
        paused = self._is_paused(today)
        signals: list[AssetSignalState] = []

        for symbol in sorted(market_data.keys()):
            frame = market_data[symbol].dropna().copy()
            close = frame["Close"]
            fast_series = moving_average(close, self.config.fast_ma_days)
            slow_series = moving_average(close, self.config.slow_ma_days)
            trend_series = moving_average(close, self.config.trend_filter_days)
            atr_series = average_true_range(frame, self.config.atr_window_days)
            upper_channel, lower_channel = donchian_channels(frame, self.config.breakout_days)

            price = self._latest_close(frame)
            fast_ma = float(fast_series.iloc[-1]) if not pd.isna(fast_series.iloc[-1]) else price
            slow_ma = float(slow_series.iloc[-1]) if not pd.isna(slow_series.iloc[-1]) else price
            trend_ma = float(trend_series.iloc[-1]) if not pd.isna(trend_series.iloc[-1]) else price
            atr = float(atr_series.iloc[-1]) if not pd.isna(atr_series.iloc[-1]) else 0.0
            breakout_long = bool(not pd.isna(upper_channel.iloc[-1]) and price >= float(upper_channel.iloc[-1]))
            breakout_short = bool(not pd.isna(lower_channel.iloc[-1]) and price <= float(lower_channel.iloc[-1]))
            crossover = latest_crossover(fast_series, slow_series)

            desired_signal = "flat"
            if fast_ma > slow_ma and price > trend_ma:
                desired_signal = "long"
            elif fast_ma < slow_ma and price < trend_ma:
                desired_signal = "short"

            existing = open_positions.get(symbol)
            stop_level = existing.current_stop_level if existing is not None else None
            stop_hit = False

            if existing is not None and atr > 0:
                if existing.side == "long":
                    stop_level = max(
                        existing.current_stop_level,
                        max(existing.highest_close, price) - self.config.trailing_stop_atr_multiple * atr,
                    )
                    stop_hit = price <= stop_level
                elif existing.side == "short":
                    stop_level = min(
                        existing.current_stop_level,
                        min(existing.lowest_close, price) + self.config.trailing_stop_atr_multiple * atr,
                    )
                    stop_hit = price >= stop_level

            effective_signal = desired_signal
            reason = self._signal_reason(
                desired_signal=desired_signal,
                paused=paused,
                breakout_long=breakout_long,
                breakout_short=breakout_short,
                crossover=crossover,
                stop_hit=stop_hit,
                stop_level=stop_level,
            )
            if paused or stop_hit:
                effective_signal = "flat"

            signals.append(
                AssetSignalState(
                    symbol=symbol,
                    signal=effective_signal,
                    price=price,
                    fast_ma=fast_ma,
                    slow_ma=slow_ma,
                    trend_ma=trend_ma,
                    atr=atr,
                    breakout_long=breakout_long,
                    breakout_short=breakout_short,
                    crossover=crossover,
                    stop_hit=stop_hit,
                    current_stop_level=stop_level,
                    reason=reason,
                )
            )

        return signals

    def _calculate_target_weights(
        self,
        signals: list[AssetSignalState],
        market_data: dict[str, pd.DataFrame],
    ) -> tuple[dict[str, float], float, bool]:
        weights: dict[str, float] = {}
        active_symbols: list[str] = []

        for signal in signals:
            if signal.signal not in {"long", "short"} or signal.atr <= 0 or signal.price <= 0:
                continue
            atr_pct = signal.atr / signal.price
            raw_weight = self.config.target_daily_vol_per_position / atr_pct
            raw_weight = min(raw_weight, self.config.max_position_pct_nav)
            weights[signal.symbol] = raw_weight if signal.signal == "long" else -raw_weight
            active_symbols.append(signal.symbol)

        crowded_fraction = crowded_correlation_fraction(
            market_data,
            active_symbols,
            self.config.correlation_window_days,
            self.config.correlation_threshold,
        )
        correlation_filter_applied = (
            crowded_fraction > self.config.correlation_fraction_threshold
        )
        if correlation_filter_applied:
            weights = {symbol: weight * 0.5 for symbol, weight in weights.items()}

        returns_frame = close_frame_from_market_data(market_data, active_symbols).pct_change().dropna()
        portfolio_vol = estimate_portfolio_vol(weights, returns_frame)
        if portfolio_vol > 0:
            scale = self.config.target_annualized_vol / portfolio_vol
            weights = {symbol: weight * scale for symbol, weight in weights.items()}

        gross = sum(abs(weight) for weight in weights.values())
        if gross > self.config.max_gross_exposure_pct_nav and gross > 0:
            scale = self.config.max_gross_exposure_pct_nav / gross
            weights = {symbol: weight * scale for symbol, weight in weights.items()}

        portfolio_vol = estimate_portfolio_vol(weights, returns_frame)
        return weights, portfolio_vol, correlation_filter_applied

    def _current_nav(
        self,
        market_data: dict[str, pd.DataFrame],
        open_positions: dict[str, OpenPosition] | None = None,
    ) -> float:
        positions = open_positions or {position.symbol: position for position in self.store.get_open_positions()}
        unrealized = 0.0
        for symbol, position in positions.items():
            frame = market_data.get(symbol)
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

    def _signal_reason(
        self,
        *,
        desired_signal: str,
        paused: bool,
        breakout_long: bool,
        breakout_short: bool,
        crossover: str | None,
        stop_hit: bool,
        stop_level: float | None,
    ) -> str:
        if paused:
            pause_until = self.store.get_state("pause_until")
            return f"Portfolio circuit breaker is active until {pause_until}."
        if stop_hit:
            return (
                f"Trailing stop hit at approximately {stop_level:.2f}; flatten until the trend resets."
                if stop_level is not None
                else "Trailing stop hit; flatten until the trend resets."
            )
        if desired_signal == "long":
            extras = []
            if crossover == "bullish":
                extras.append("fresh 20/60 bullish crossover")
            if breakout_long:
                extras.append("40-day breakout confirmed")
            extra_text = f" and {', '.join(extras)}" if extras else ""
            return f"Fast trend is above slow trend with the 200-day filter positive{extra_text}."
        if desired_signal == "short":
            extras = []
            if crossover == "bearish":
                extras.append("fresh 20/60 bearish crossover")
            if breakout_short:
                extras.append("40-day downside breakout confirmed")
            extra_text = f" and {', '.join(extras)}" if extras else ""
            return f"Fast trend is below slow trend with the 200-day filter negative{extra_text}."
        return "No aligned trend signal is active right now."

    def _position_pnl(self, position: OpenPosition, current_price: float) -> float:
        if position.entry_price <= 0:
            return 0.0
        gross_return = (current_price - position.entry_price) / position.entry_price
        if position.side == "short":
            gross_return *= -1
        return gross_return * position.entry_notional_usd

    def _initial_stop(self, *, side: str, price: float, atr: float) -> float:
        if side == "short":
            return price + self.config.trailing_stop_atr_multiple * atr
        return price - self.config.trailing_stop_atr_multiple * atr

    def _latest_trade_date(self, market_data: dict[str, pd.DataFrame]) -> pd.Timestamp:
        latest = max(frame.index[-1] for frame in market_data.values() if not frame.empty)
        return pd.Timestamp(latest).normalize()

    def _latest_close(self, frame: pd.DataFrame) -> float:
        return float(frame["Close"].iloc[-1])

    def _latest_atr(self, frame: pd.DataFrame) -> float:
        atr_series = average_true_range(frame, self.config.atr_window_days)
        latest = atr_series.iloc[-1]
        return float(latest) if not pd.isna(latest) else 0.0

    def _is_paused(self, today: pd.Timestamp) -> bool:
        pause_until = self.store.get_state("pause_until")
        if not pause_until:
            return False
        return today.date() <= pd.Timestamp(pause_until).date()

    def _next_trading_day(self, today: pd.Timestamp, trading_days: int) -> pd.Timestamp:
        current = pd.Timestamp(today).normalize()
        remaining = trading_days
        while remaining > 0:
            current += timedelta(days=1)
            if current.weekday() < 5:
                remaining -= 1
        return current

    def _stop_loss_pct(self, signal: AssetSignalState) -> float:
        if signal.price <= 0 or signal.atr <= 0:
            return 0.03
        return (self.config.trailing_stop_atr_multiple * signal.atr) / signal.price

    def _signal_conviction(self, signal: AssetSignalState) -> float:
        trend_gap = abs(signal.fast_ma - signal.slow_ma) / signal.price if signal.price > 0 else 0.0
        breakout_bonus = 0.15 if signal.breakout_long or signal.breakout_short else 0.0
        crossover_bonus = 0.10 if signal.crossover is not None else 0.0
        score = min(trend_gap * 12.0 + breakout_bonus + crossover_bonus, 1.0)
        return max(score, 0.0)
