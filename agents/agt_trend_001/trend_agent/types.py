from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Literal

SignalDirection = Literal["long", "short", "flat"]
InstructionAction = Literal["open", "close", "reverse", "rebalance"]


@dataclass
class AssetSignalState:
    symbol: str
    signal: SignalDirection
    price: float
    fast_ma: float
    slow_ma: float
    trend_ma: float
    atr: float
    breakout_long: bool
    breakout_short: bool
    crossover: str | None
    stop_hit: bool
    current_stop_level: float | None
    reason: str

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


@dataclass
class PositionInstruction:
    symbol: str
    action: InstructionAction
    side: SignalDirection
    target_position_pct_nav: float
    price: float
    atr: float
    stop_level: float | None
    reason: str

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


@dataclass
class OpenPosition:
    symbol: str
    side: SignalDirection
    entry_date: str
    entry_price: float
    atr_at_entry: float
    current_stop_level: float
    position_pct_nav: float
    entry_notional_usd: float
    highest_close: float
    lowest_close: float
    last_price: float
    unrealized_pnl_usd: float
    unrealized_pnl_pct: float
    updated_at: str
    status: str

    def to_dict(self) -> dict[str, object]:
        return asdict(self)
