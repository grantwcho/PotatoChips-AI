from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field

from contract import (
    CurrentPositioning,
    ExplainDecisionRequest,
    MarketUpdateRequest,
    NewsEventRequest,
    PortfolioSnapshot,
    Position,
    PositionSide,
    ProposePositionsRequest,
    RestoreRequest,
    RiskLimits,
    ScenarioShock,
    StressScenarioRequest,
    TradeSignal,
)

from ..client import SubmissionClient
from ..runtime import SubmissionRuntime
from .models import ReplayEvent, ReplayEventType


@dataclass(frozen=True)
class AnchorSnapshot:
    anchor: str
    event_id: str
    before: CurrentPositioning
    after: CurrentPositioning


@dataclass(frozen=True)
class StabilitySnapshot:
    event_id: str
    first: CurrentPositioning
    second: CurrentPositioning


@dataclass(frozen=True)
class ReplayStep:
    event: ReplayEvent
    signal_count: int
    signal_ids: list[str]
    positioning: CurrentPositioning


@dataclass
class ReplayTrace:
    steps: list[ReplayStep] = field(default_factory=list)
    endpoint_latencies_ms: list[float] = field(default_factory=list)
    anchor_snapshots: dict[str, AnchorSnapshot] = field(default_factory=dict)
    stability_snapshots: list[StabilitySnapshot] = field(default_factory=list)
    signal_ids: list[str] = field(default_factory=list)


def run_replay(
    client: SubmissionClient,
    runtime: SubmissionRuntime,
    replay_events: Sequence[ReplayEvent],
    *,
    stability_checkpoint_ids: Sequence[str],
) -> ReplayTrace:
    trace = ReplayTrace()
    for event in replay_events:
        anchor_before: CurrentPositioning | None = None
        if event.anchors:
            before_call = client.current_positioning()
            anchor_before = before_call.model
            trace.endpoint_latencies_ms.append(before_call.latency_ms)

        if event.type == ReplayEventType.MARKET_UPDATE:
            market_request = MarketUpdateRequest.model_validate(event.payload)
            response = client.on_market_update(market_request)
            trace.endpoint_latencies_ms.append(response.latency_ms)
            proposal = client.propose_positions(_build_portfolio_request(event))
            trace.endpoint_latencies_ms.append(proposal.latency_ms)
        else:
            news_request = NewsEventRequest.model_validate(event.payload)
            response = client.on_news(news_request)
            trace.endpoint_latencies_ms.append(response.latency_ms)

        trace.signal_ids.extend(signal.signal_id for signal in response.model.signals)
        positioning = _positioning_after_event(
            client=client,
            trace=trace,
            event=event,
            stability_checkpoint_ids=stability_checkpoint_ids,
        )
        trace.steps.append(
            ReplayStep(
                event=event,
                signal_count=len(response.model.signals),
                signal_ids=[signal.signal_id for signal in response.model.signals],
                positioning=positioning,
            )
        )

        if anchor_before is not None:
            for anchor in event.anchors:
                trace.anchor_snapshots[anchor] = AnchorSnapshot(
                    anchor=anchor,
                    event_id=event.event_id,
                    before=anchor_before,
                    after=positioning,
                )
        runtime.sample_stats()
    return trace


def run_schema_probe(
    client: SubmissionClient,
    replay_events: Sequence[ReplayEvent],
) -> None:
    metadata = client.metadata()
    client.healthz()
    snapshot_before = client.snapshot()
    market_event = next(
        event for event in replay_events if event.type == ReplayEventType.MARKET_UPDATE
    )
    news_event = next(
        event for event in replay_events if event.type == ReplayEventType.NEWS
    )

    market_response = client.on_market_update(
        MarketUpdateRequest.model_validate(market_event.payload)
    )
    client.on_news(NewsEventRequest.model_validate(news_event.payload))
    client.current_positioning()
    client.propose_positions(_build_portfolio_request(market_event))
    client.stress_response(_sample_stress_request())

    signal_id = _first_signal_id(
        market_response.model.signals,
        fallback_events=replay_events,
        client=client,
    )
    if signal_id is not None:
        client.explain_decision(ExplainDecisionRequest(signal_id=signal_id))

    snapshot_bytes = snapshot_before.model.snapshot_b64
    client.restore(RestoreRequest(snapshot_b64=snapshot_bytes))
    response_one = client.on_market_update(
        MarketUpdateRequest.model_validate(market_event.payload)
    )
    client.restore(RestoreRequest(snapshot_b64=snapshot_bytes))
    response_two = client.on_market_update(
        MarketUpdateRequest.model_validate(market_event.payload)
    )
    if response_one.model.model_dump(mode="json") != response_two.model.model_dump(
        mode="json"
    ):
        raise RuntimeError(
            "Snapshot/restore round-trip did not preserve deterministic "
            f"output for {metadata.model.name}."
        )


def _positioning_after_event(
    *,
    client: SubmissionClient,
    trace: ReplayTrace,
    event: ReplayEvent,
    stability_checkpoint_ids: Sequence[str],
) -> CurrentPositioning:
    if event.event_id in stability_checkpoint_ids:
        first_call = client.current_positioning()
        second_call = client.current_positioning()
        trace.endpoint_latencies_ms.extend(
            [first_call.latency_ms, second_call.latency_ms]
        )
        trace.stability_snapshots.append(
            StabilitySnapshot(
                event_id=event.event_id,
                first=first_call.model,
                second=second_call.model,
            )
        )
        return second_call.model
    positioning_call = client.current_positioning()
    trace.endpoint_latencies_ms.append(positioning_call.latency_ms)
    return positioning_call.model


def _sample_stress_request() -> StressScenarioRequest:
    return StressScenarioRequest(
        scenario_id="stress-vol-spike",
        description="Volatility rises and spreads widen materially over 15 minutes.",
        shock=ScenarioShock(
            vol_multiplier=1.25,
            spread_multiplier=3.0,
            price_gap_pct=-0.018,
        ),
    )


def _build_portfolio_request(event: ReplayEvent) -> ProposePositionsRequest:
    return ProposePositionsRequest(
        timestamp=event.timestamp,
        portfolio=PortfolioSnapshot(
            cash_usd=250000.0,
            gross_exposure_usd=640000.0,
            net_exposure_usd=140000.0,
            positions=[
                Position(
                    symbol="SPY",
                    quantity=600.0,
                    avg_price=520.0,
                    market_price=524.0,
                    side=PositionSide.LONG,
                ),
                Position(
                    symbol="NVDA",
                    quantity=120.0,
                    avg_price=880.0,
                    market_price=903.0,
                    side=PositionSide.LONG,
                ),
            ],
        ),
        risk_limits=RiskLimits(
            max_gross_exposure_usd=1_000_000.0,
            max_single_name_exposure_usd=125_000.0,
            max_turnover_bps=180.0,
        ),
    )


def _first_signal_id(
    signals: Sequence[TradeSignal],
    *,
    fallback_events: Sequence[ReplayEvent],
    client: SubmissionClient,
) -> str | None:
    if signals:
        return signals[0].signal_id
    for event in fallback_events:
        if event.type != ReplayEventType.MARKET_UPDATE:
            continue
        response = client.on_market_update(
            MarketUpdateRequest.model_validate(event.payload)
        )
        if response.model.signals:
            return response.model.signals[0].signal_id
    return None
