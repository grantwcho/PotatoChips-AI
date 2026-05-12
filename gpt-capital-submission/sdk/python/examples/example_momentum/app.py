from __future__ import annotations

from datetime import datetime
from typing import Any

from contract import (
    CurrentPositioning,
    DecisionExplanationResponse,
    DirectionalBias,
    ExplainDecisionRequest,
    ExplanationReference,
    ExplanationReferenceKind,
    FactorChange,
    FactorDirection,
    FactorExposure,
    LiquidityPosture,
    MarketTick,
    MarketUpdateRequest,
    NewsCategory,
    NewsEventRequest,
    NewsSentiment,
    PositioningDelta,
    PositionProposal,
    PositionProposalResponse,
    ProposePositionsRequest,
    SignalBatchResponse,
    SignalIntent,
    SignalOrigin,
    StressResponse,
    StressScenarioRequest,
    SubmissionMetadata,
    TradeSignal,
)
from sdk.python.gptcap import BaseStrategy, run_strategy


class MomentumStrategy(BaseStrategy):
    def __init__(self) -> None:
        self.latest_timestamp = datetime(2026, 4, 13, 13, 30)
        self.symbol_state: dict[str, dict[str, float | str]] = {}
        self.signal_records: dict[str, dict[str, Any]] = {}
        self.policy_shock = 0.0
        self.liquidity_stress = 0.0
        self.last_macro_headline = "No macro catalyst yet."
        self.last_news_sentiment = NewsSentiment.NEUTRAL.value
        self.signal_counter = 0

    def metadata(self) -> SubmissionMetadata:
        return SubmissionMetadata(
            name="Example Momentum",
            version="1.0.0",
            declared_strategy_class="momentum",
            author="Potato Chips AI",
            supports_news=True,
            supports_stress_scenarios=True,
            description=(
                "Reference cross-sectional momentum strategy with genuine "
                "introspection tied to internal factor weights."
            ),
        )

    def on_market_update(self, request: MarketUpdateRequest) -> SignalBatchResponse:
        self.latest_timestamp = request.timestamp
        signals: list[TradeSignal] = []
        for tick in request.ticks:
            state = self._ingest_tick(tick)
            score = float(state["momentum_score"])
            conviction = self._conviction_from_score(score)
            if score > 0.6 and self._risk_bias() != DirectionalBias.RISK_OFF:
                signals.append(
                    self._record_signal(
                        tick=tick,
                        intent=SignalIntent.INCREASE_LONG,
                        strength=min(score, 1.0),
                        confidence=conviction,
                        thesis=(
                            "Positive price momentum with contained spread and "
                            "supportive sector confirmation."
                        ),
                        origin=SignalOrigin.MARKET_UPDATE,
                        tags=["momentum", "sector_confirmation"],
                        references=[
                            self._feature_reference("return_1d", tick),
                            self._feature_reference("return_5m", tick),
                            ExplanationReference(
                                kind=ExplanationReferenceKind.FACTOR,
                                value="price_momentum",
                            ),
                        ],
                    )
                )
            elif score < -0.55:
                signals.append(
                    self._record_signal(
                        tick=tick,
                        intent=SignalIntent.INCREASE_SHORT,
                        strength=min(abs(score), 1.0),
                        confidence=conviction,
                        thesis=(
                            "Negative momentum is dominating and spread is not "
                            "yet wide enough to block an expression."
                        ),
                        origin=SignalOrigin.MARKET_UPDATE,
                        tags=["momentum", "downside_expression"],
                        references=[
                            self._feature_reference("return_1d", tick),
                            self._feature_reference("return_5m", tick),
                            ExplanationReference(
                                kind=ExplanationReferenceKind.FACTOR,
                                value="price_momentum",
                            ),
                        ],
                    )
                )
        return SignalBatchResponse(signals=signals)

    def on_news(self, request: NewsEventRequest) -> SignalBatchResponse:
        self.latest_timestamp = request.timestamp
        self.last_macro_headline = request.headline
        self.last_news_sentiment = request.sentiment.value
        signals: list[TradeSignal] = []
        if request.category == NewsCategory.MACRO:
            self.policy_shock = max(self.policy_shock, request.relevance)
            if "cut" in request.headline.lower():
                self.policy_shock *= 1.1
            for symbol in request.symbols[:2]:
                signals.append(
                    self._record_signal(
                        tick=self._synthetic_tick(symbol),
                        intent=SignalIntent.HEDGE,
                        strength=min(0.35 + request.relevance * 0.3, 1.0),
                        confidence=min(0.55 + request.relevance * 0.25, 1.0),
                        thesis=(
                            "Macro surprise increases dispersion risk, so the "
                            "strategy tightens risk expression."
                        ),
                        origin=SignalOrigin.NEWS,
                        tags=["macro_surprise", "hedge"],
                        references=[
                            ExplanationReference(
                                kind=ExplanationReferenceKind.NEWS,
                                value=request.event_id,
                            ),
                            ExplanationReference(
                                kind=ExplanationReferenceKind.FACTOR,
                                value="policy_shock_dispersion",
                            ),
                        ],
                    )
                )
        elif request.category == NewsCategory.LIQUIDITY:
            self.liquidity_stress = max(self.liquidity_stress, request.relevance)
        elif request.category in {NewsCategory.EARNINGS, NewsCategory.IDIOSYNCRATIC}:
            for symbol in request.symbols[:1]:
                signals.append(
                    self._record_signal(
                        tick=self._synthetic_tick(symbol),
                        intent=SignalIntent.REDUCE_LONG,
                        strength=min(0.4 + request.relevance * 0.2, 1.0),
                        confidence=min(0.5 + request.relevance * 0.2, 1.0),
                        thesis=(
                            "Event-specific risk raises the bar for keeping long "
                            "exposure in the affected name."
                        ),
                        origin=SignalOrigin.NEWS,
                        tags=["event_risk", "risk_adjustment"],
                        references=[
                            ExplanationReference(
                                kind=ExplanationReferenceKind.NEWS,
                                value=request.event_id,
                            )
                        ],
                    )
                )
        return SignalBatchResponse(signals=signals)

    def propose_positions(
        self, request: ProposePositionsRequest
    ) -> PositionProposalResponse:
        self.latest_timestamp = request.timestamp
        proposals: list[PositionProposal] = []
        remaining_risk = max(0.0, 1.0 - self._risk_budget_usage())
        ranked = sorted(
            self.symbol_state.items(),
            key=lambda item: abs(float(item[1]["momentum_score"])),
            reverse=True,
        )[:3]
        for symbol, state in ranked:
            score = float(state["momentum_score"])
            if abs(score) < 0.55:
                continue
            delta = round(score * remaining_risk * 100.0, 2)
            proposals.append(
                PositionProposal(
                    proposal_id=f"prop-{symbol.lower()}-{len(proposals) + 1:03d}",
                    symbol=symbol,
                    target_delta_quantity=delta,
                    reason=(
                        "Momentum ranking remains favorable relative to current "
                        "risk budget usage."
                    ),
                    linked_signal_ids=self._linked_signals(symbol),
                )
            )
        return PositionProposalResponse(proposals=proposals)

    def current_positioning(self) -> CurrentPositioning:
        avg_score = self._average_momentum()
        momentum_weight = min(abs(avg_score), 1.0)
        policy_weight = min(self.policy_shock * 0.8, 1.0)
        liquidity_weight = min(self.liquidity_stress * 0.9, 1.0)
        active_factors = [
            FactorExposure(
                name="price_momentum",
                weight=round(momentum_weight, 4),
                direction=(
                    FactorDirection.PRO if avg_score >= 0 else FactorDirection.CON
                ),
                evidence=self._momentum_evidence(),
            ),
            FactorExposure(
                name="policy_shock_dispersion",
                weight=round(policy_weight, 4),
                direction=FactorDirection.PRO,
                evidence=self.last_macro_headline,
            ),
            FactorExposure(
                name="liquidity_fragility",
                weight=round(liquidity_weight, 4),
                direction=FactorDirection.CON,
                evidence=(
                    f"Average spread stress score is {self.liquidity_stress:.2f}."
                ),
            ),
        ]
        return CurrentPositioning(
            timestamp=self.latest_timestamp,
            directional_bias=self._risk_bias(),
            conviction=round(self._conviction_from_score(avg_score), 4),
            regime_view=self._regime_view(),
            time_horizon="intraday_to_swing",
            liquidity_posture=self._liquidity_posture(),
            risk_budget_usage=round(self._risk_budget_usage(), 4),
            active_factors=active_factors,
            watchlist=self._watchlist(),
            key_risks=self._key_risks(),
        )

    def explain_decision(
        self, request: ExplainDecisionRequest
    ) -> DecisionExplanationResponse:
        record = self.signal_records[request.signal_id]
        return DecisionExplanationResponse(
            signal_id=request.signal_id,
            trigger=str(record["trigger"]),
            magnitude=float(record["magnitude"]),
            confidence=float(record["confidence"]),
            expected_horizon_minutes=int(record["expected_horizon_minutes"]),
            references=list(record["references"]),
        )

    def stress_response(self, request: StressScenarioRequest) -> StressResponse:
        positioning = self.current_positioning()
        vol_hit = max(request.shock.vol_multiplier - 1.0, 0.0)
        spread_hit = max(request.shock.spread_multiplier - 1.0, 0.0)
        conviction_after = max(
            0.0,
            positioning.conviction - (vol_hit * 0.4 + spread_hit * 0.15),
        )
        after_bias = (
            DirectionalBias.NEUTRAL
            if conviction_after < 0.45
            else positioning.directional_bias
        )
        factor_changes = [
            FactorChange(
                name=factor.name,
                before=factor.weight,
                after=(
                    round(max(0.0, factor.weight - vol_hit * 0.3), 4)
                    if factor.name == "price_momentum"
                    else factor.weight
                ),
            )
            for factor in positioning.active_factors
        ]
        return StressResponse(
            scenario_id=request.scenario_id,
            positioning_delta=PositioningDelta(
                directional_bias_before=positioning.directional_bias.value,
                directional_bias_after=after_bias.value,
                conviction_before=positioning.conviction,
                conviction_after=round(conviction_after, 4),
                factor_changes=factor_changes,
            ),
            summary=(
                "The strategy would trim momentum expression and lean toward "
                "neutrality until volatility and spread pressure normalize."
            ),
        )

    def export_state(self) -> dict[str, Any]:
        return {
            "latest_timestamp": self.latest_timestamp.isoformat(),
            "symbol_state": self.symbol_state,
            "signal_records": self.signal_records,
            "policy_shock": self.policy_shock,
            "liquidity_stress": self.liquidity_stress,
            "last_macro_headline": self.last_macro_headline,
            "last_news_sentiment": self.last_news_sentiment,
            "signal_counter": self.signal_counter,
        }

    def import_state(self, state: dict[str, Any]) -> None:
        self.latest_timestamp = datetime.fromisoformat(str(state["latest_timestamp"]))
        self.symbol_state = dict(state["symbol_state"])
        self.signal_records = dict(state["signal_records"])
        self.policy_shock = float(state["policy_shock"])
        self.liquidity_stress = float(state["liquidity_stress"])
        self.last_macro_headline = str(state["last_macro_headline"])
        self.last_news_sentiment = str(state["last_news_sentiment"])
        self.signal_counter = int(state["signal_counter"])

    def _ingest_tick(self, tick: MarketTick) -> dict[str, float | str]:
        ret_1d = tick.features.get("return_1d", 0.0)
        ret_5m = tick.features.get("return_5m", 0.0)
        spread_penalty = min(tick.spread_bps / 25.0, 1.0)
        momentum_score = ret_1d * 18.0 + ret_5m * 40.0 - spread_penalty * 0.4
        if tick.spread_bps > 12.0:
            self.liquidity_stress = min(1.0, self.liquidity_stress + 0.15)
        state: dict[str, float | str] = {
            "last": tick.last,
            "return_1d": ret_1d,
            "return_5m": ret_5m,
            "spread_bps": tick.spread_bps,
            "sector": tick.sector,
            "momentum_score": round(momentum_score, 4),
        }
        self.symbol_state[tick.symbol] = state
        return state

    def _record_signal(
        self,
        *,
        tick: MarketTick,
        intent: SignalIntent,
        strength: float,
        confidence: float,
        thesis: str,
        origin: SignalOrigin,
        tags: list[str],
        references: list[ExplanationReference],
    ) -> TradeSignal:
        self.signal_counter += 1
        signal_id = f"sig-{tick.symbol.lower()}-{self.signal_counter:04d}"
        score = self.symbol_state.get(tick.symbol, {}).get("momentum_score", 0.0)
        trigger = (
            f"{tick.symbol} score={score} "
            f"spread_bps={tick.spread_bps:.2f}"
        )
        self.signal_records[signal_id] = {
            "trigger": trigger,
            "magnitude": round(strength, 4),
            "confidence": round(confidence, 4),
            "expected_horizon_minutes": 240,
            "references": [reference.model_dump() for reference in references],
            "symbol": tick.symbol,
        }
        return TradeSignal(
            signal_id=signal_id,
            timestamp=self.latest_timestamp,
            symbol=tick.symbol,
            intent=intent,
            strength=round(strength, 4),
            confidence=round(confidence, 4),
            horizon_minutes=240,
            thesis=thesis,
            origin=origin,
            tags=tags,
        )

    def _feature_reference(self, name: str, tick: MarketTick) -> ExplanationReference:
        value = tick.features.get(name, 0.0)
        return ExplanationReference(
            kind=ExplanationReferenceKind.MARKET_FEATURE,
            value=f"{name}={value:.4f}",
        )

    def _synthetic_tick(self, symbol: str) -> MarketTick:
        state = self.symbol_state.get(symbol, {})
        last = float(state.get("last", 100.0))
        spread = float(state.get("spread_bps", 5.0))
        sector = str(state.get("sector", "broad_market"))
        return MarketTick(
            symbol=symbol,
            last=last,
            open=last,
            high=last,
            low=last,
            volume=0.0,
            vwap=last,
            spread_bps=spread,
            sector=sector,
            features={
                "return_1d": float(state.get("return_1d", 0.0)),
                "return_5m": float(state.get("return_5m", 0.0)),
            },
        )

    def _average_momentum(self) -> float:
        if not self.symbol_state:
            return 0.0
        scores = [
            float(state["momentum_score"]) for state in self.symbol_state.values()
        ]
        return sum(scores) / len(scores)

    def _risk_bias(self) -> DirectionalBias:
        avg_score = self._average_momentum()
        if self.liquidity_stress > 0.8:
            return DirectionalBias.RISK_OFF
        if avg_score > 0.3:
            return DirectionalBias.RISK_ON
        if avg_score < -0.3:
            return DirectionalBias.SHORT_BIAS
        return DirectionalBias.NEUTRAL

    def _risk_budget_usage(self) -> float:
        base = min(abs(self._average_momentum()) * 0.7, 0.85)
        return min(1.0, base + self.policy_shock * 0.15 + self.liquidity_stress * 0.2)

    def _liquidity_posture(self) -> LiquidityPosture:
        if self.liquidity_stress > 0.7:
            return LiquidityPosture.DEFENSIVE
        if self.liquidity_stress > 0.35:
            return LiquidityPosture.CAUTIOUS
        if self.policy_shock > 0.5 and self.liquidity_stress < 0.2:
            return LiquidityPosture.OPPORTUNISTIC
        return LiquidityPosture.NORMAL

    def _regime_view(self) -> str:
        if self.liquidity_stress > 0.7:
            return "Liquidity shock is dominant, so momentum is being down-weighted."
        if self.policy_shock > 0.5:
            return (
                "Macro surprise is lifting dispersion, and the strategy is "
                "favoring names with resilient momentum."
            )
        if self._average_momentum() > 0.3:
            return "Trend regime remains intact with broad risk appetite."
        if self._average_momentum() < -0.3:
            return "Negative momentum is spreading and favors defensive posture."
        return "Choppy tape with mixed momentum leadership."

    def _momentum_evidence(self) -> str:
        ranked = sorted(
            self.symbol_state.items(),
            key=lambda item: abs(float(item[1]["momentum_score"])),
            reverse=True,
        )[:2]
        if not ranked:
            return "No market updates processed yet."
        phrases = [
            f"{symbol} score={float(state['momentum_score']):.2f}"
            for symbol, state in ranked
        ]
        return "Top names are " + ", ".join(phrases) + "."

    def _watchlist(self) -> list[str]:
        ranked = sorted(
            self.symbol_state.items(),
            key=lambda item: abs(float(item[1]["momentum_score"])),
            reverse=True,
        )
        return [symbol for symbol, _state in ranked[:5]]

    def _key_risks(self) -> list[str]:
        return [
            "Momentum leadership could reverse if spreads widen materially.",
            (
                f"Latest news tone is {self.last_news_sentiment}, "
                "which may shift dispersion abruptly."
            ),
        ]

    def _conviction_from_score(self, score: float) -> float:
        adjusted = (
            abs(score) * 0.65 + self.policy_shock * 0.1 - self.liquidity_stress * 0.2
        )
        return max(0.05, min(0.95, adjusted))

    def _linked_signals(self, symbol: str) -> list[str]:
        signal_ids = [
            signal_id
            for signal_id, record in self.signal_records.items()
            if record.get("symbol") == symbol
        ]
        return signal_ids[-2:]


def main() -> None:
    run_strategy(MomentumStrategy())


if __name__ == "__main__":
    main()
