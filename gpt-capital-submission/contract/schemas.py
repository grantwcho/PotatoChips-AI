from __future__ import annotations

from datetime import datetime
from enum import Enum

from pydantic import BaseModel, ConfigDict, Field


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class NewsCategory(str, Enum):
    MACRO = "macro"
    EARNINGS = "earnings"
    IDIOSYNCRATIC = "idiosyncratic"
    LIQUIDITY = "liquidity"
    POLICY = "policy"
    OTHER = "other"


class NewsSentiment(str, Enum):
    POSITIVE = "positive"
    NEGATIVE = "negative"
    NEUTRAL = "neutral"


class SignalIntent(str, Enum):
    INCREASE_LONG = "increase_long"
    REDUCE_LONG = "reduce_long"
    INCREASE_SHORT = "increase_short"
    REDUCE_SHORT = "reduce_short"
    FLATTEN = "flatten"
    HEDGE = "hedge"


class SignalOrigin(str, Enum):
    MARKET_UPDATE = "market_update"
    NEWS = "news"
    PORTFOLIO = "portfolio"


class PositionSide(str, Enum):
    LONG = "long"
    SHORT = "short"


class DirectionalBias(str, Enum):
    RISK_ON = "risk_on"
    RISK_OFF = "risk_off"
    NEUTRAL = "neutral"
    LONG_BIAS = "long_bias"
    SHORT_BIAS = "short_bias"


class LiquidityPosture(str, Enum):
    NORMAL = "normal"
    CAUTIOUS = "cautious"
    DEFENSIVE = "defensive"
    OPPORTUNISTIC = "opportunistic"


class FactorDirection(str, Enum):
    PRO = "pro"
    CON = "con"
    NEUTRAL = "neutral"


class ExplanationReferenceKind(str, Enum):
    MARKET_FEATURE = "market_feature"
    FACTOR = "factor"
    NEWS = "news"
    PORTFOLIO_STATE = "portfolio_state"
    SCENARIO = "scenario"


class HealthStatus(StrictModel):
    status: str
    ready: bool
    version: str


class SubmissionMetadata(StrictModel):
    name: str
    version: str
    declared_strategy_class: str
    author: str | None = None
    supports_news: bool
    supports_stress_scenarios: bool
    description: str | None = None


class SnapshotResponse(StrictModel):
    snapshot_b64: str
    checksum_sha256: str


class RestoreRequest(StrictModel):
    snapshot_b64: str


class RestoreResponse(StrictModel):
    restored: bool
    checksum_sha256: str


class MarketTick(StrictModel):
    symbol: str
    last: float
    open: float
    high: float
    low: float
    volume: float
    vwap: float
    spread_bps: float
    sector: str
    features: dict[str, float]


class MarketUpdateRequest(StrictModel):
    batch_id: str
    timestamp: datetime
    ticks: list[MarketTick]


class NewsEventRequest(StrictModel):
    event_id: str
    timestamp: datetime
    headline: str
    summary: str
    symbols: list[str]
    category: NewsCategory
    relevance: float = Field(ge=0.0, le=1.0)
    sentiment: NewsSentiment


class TradeSignal(StrictModel):
    signal_id: str
    timestamp: datetime
    symbol: str
    intent: SignalIntent
    strength: float = Field(ge=0.0, le=1.0)
    confidence: float = Field(ge=0.0, le=1.0)
    horizon_minutes: int = Field(ge=1)
    thesis: str
    origin: SignalOrigin
    tags: list[str]


class SignalBatchResponse(StrictModel):
    signals: list[TradeSignal]


class Position(StrictModel):
    symbol: str
    quantity: float
    avg_price: float
    market_price: float
    side: PositionSide


class PortfolioSnapshot(StrictModel):
    cash_usd: float
    gross_exposure_usd: float
    net_exposure_usd: float
    positions: list[Position]


class RiskLimits(StrictModel):
    max_gross_exposure_usd: float
    max_single_name_exposure_usd: float
    max_turnover_bps: float


class ProposePositionsRequest(StrictModel):
    timestamp: datetime
    portfolio: PortfolioSnapshot
    risk_limits: RiskLimits


class PositionProposal(StrictModel):
    proposal_id: str
    symbol: str
    target_delta_quantity: float
    reason: str
    linked_signal_ids: list[str]


class PositionProposalResponse(StrictModel):
    proposals: list[PositionProposal]


class FactorExposure(StrictModel):
    name: str
    weight: float = Field(ge=0.0, le=1.0)
    direction: FactorDirection
    evidence: str


class CurrentPositioning(StrictModel):
    timestamp: datetime
    directional_bias: DirectionalBias
    conviction: float = Field(ge=0.0, le=1.0)
    regime_view: str
    time_horizon: str
    liquidity_posture: LiquidityPosture
    risk_budget_usage: float = Field(ge=0.0, le=1.0)
    active_factors: list[FactorExposure]
    watchlist: list[str]
    key_risks: list[str]


class ExplainDecisionRequest(StrictModel):
    signal_id: str


class ExplanationReference(StrictModel):
    kind: ExplanationReferenceKind
    value: str


class DecisionExplanationResponse(StrictModel):
    signal_id: str
    trigger: str
    magnitude: float = Field(ge=0.0, le=1.0)
    confidence: float = Field(ge=0.0, le=1.0)
    expected_horizon_minutes: int = Field(ge=1)
    references: list[ExplanationReference]


class ScenarioShock(StrictModel):
    vol_multiplier: float
    spread_multiplier: float
    price_gap_pct: float


class StressScenarioRequest(StrictModel):
    scenario_id: str
    description: str
    shock: ScenarioShock


class FactorChange(StrictModel):
    name: str
    before: float
    after: float


class PositioningDelta(StrictModel):
    directional_bias_before: str
    directional_bias_after: str
    conviction_before: float
    conviction_after: float
    factor_changes: list[FactorChange]


class StressResponse(StrictModel):
    scenario_id: str
    positioning_delta: PositioningDelta
    summary: str


COMPONENT_MODELS: dict[str, type[BaseModel]] = {
    "HealthStatus": HealthStatus,
    "SubmissionMetadata": SubmissionMetadata,
    "SnapshotResponse": SnapshotResponse,
    "RestoreRequest": RestoreRequest,
    "RestoreResponse": RestoreResponse,
    "MarketTick": MarketTick,
    "MarketUpdateRequest": MarketUpdateRequest,
    "NewsEventRequest": NewsEventRequest,
    "TradeSignal": TradeSignal,
    "SignalBatchResponse": SignalBatchResponse,
    "Position": Position,
    "PortfolioSnapshot": PortfolioSnapshot,
    "RiskLimits": RiskLimits,
    "ProposePositionsRequest": ProposePositionsRequest,
    "PositionProposal": PositionProposal,
    "PositionProposalResponse": PositionProposalResponse,
    "FactorExposure": FactorExposure,
    "CurrentPositioning": CurrentPositioning,
    "ExplainDecisionRequest": ExplainDecisionRequest,
    "ExplanationReference": ExplanationReference,
    "DecisionExplanationResponse": DecisionExplanationResponse,
    "ScenarioShock": ScenarioShock,
    "StressScenarioRequest": StressScenarioRequest,
    "FactorChange": FactorChange,
    "PositioningDelta": PositioningDelta,
    "StressResponse": StressResponse,
}
