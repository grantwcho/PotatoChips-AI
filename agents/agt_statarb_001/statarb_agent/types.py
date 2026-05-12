from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Literal

SignalAction = Literal["enter_long_spread", "enter_short_spread", "exit"]
InstructionAction = Literal["open", "close"]


@dataclass
class PairCandidate:
    pair_key: str
    leader_symbol: str
    hedge_symbol: str
    p_value: float
    hedge_ratio: float
    half_life_days: float
    spread_mean: float
    spread_std: float
    z_score: float

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


@dataclass
class PairSignal:
    pair_key: str
    leader_symbol: str
    hedge_symbol: str
    action: SignalAction
    z_score: float
    p_value: float
    hedge_ratio: float
    half_life_days: float
    conviction: float
    reason: str

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


@dataclass
class PositionInstruction:
    pair_key: str
    action: InstructionAction
    long_symbol: str
    short_symbol: str
    long_notional_usd: float
    short_notional_usd: float
    z_score: float
    hedge_ratio: float
    reason: str

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


@dataclass
class PositionState:
    pair_key: str
    leader_symbol: str
    hedge_symbol: str
    long_symbol: str
    short_symbol: str
    long_notional_usd: float
    short_notional_usd: float
    entry_long_price: float
    entry_short_price: float
    entry_z_score: float
    hedge_ratio: float
    opened_at: str
    updated_at: str
    status: str
    current_z_score: float
    current_pnl_usd: float

    def to_dict(self) -> dict[str, object]:
        return asdict(self)
