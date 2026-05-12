from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Literal

RegimeLabel = Literal["contango", "backwardation", "flat"]
SignalDirection = Literal["long", "short", "flat"]
InstructionAction = Literal["open", "close", "reverse", "rebalance"]
ComponentName = Literal["carry", "mean_reversion", "tail_hedge", "delta_hedge"]


@dataclass
class VolatilitySignalState:
    regime: RegimeLabel
    confidence: float
    vix_spot: float
    vix3m: float
    ratio: float
    carry_signal: str
    mean_reversion_signal: str
    tail_hedge_signal: str
    reason: str

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


@dataclass
class PositionInstruction:
    position_id: str
    component: ComponentName
    symbol: str
    action: InstructionAction
    side: SignalDirection
    target_position_pct_nav: float
    price: float
    current_stop_level: float
    delta_exposure: float
    vega_exposure: float
    gamma_exposure: float
    reason: str

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


@dataclass
class OpenPosition:
    position_id: str
    component: ComponentName
    symbol: str
    side: SignalDirection
    entry_date: str
    entry_price: float
    current_stop_level: float
    position_pct_nav: float
    entry_notional_usd: float
    delta_exposure: float
    vega_exposure: float
    gamma_exposure: float
    last_price: float
    unrealized_pnl_usd: float
    unrealized_pnl_pct: float
    updated_at: str
    status: str

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


@dataclass
class RegimeTransitionRecord:
    recorded_at: str
    regime: RegimeLabel
    confidence: float
    ratio: float
    vix_spot: float
    vix3m: float

    def to_dict(self) -> dict[str, object]:
        return asdict(self)
