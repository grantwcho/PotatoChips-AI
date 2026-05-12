from __future__ import annotations

import base64
import hashlib
import os

import uvicorn
from fastapi import FastAPI

from contract import (
    CurrentPositioning,
    DecisionExplanationResponse,
    ExplainDecisionRequest,
    HealthStatus,
    MarketUpdateRequest,
    NewsEventRequest,
    PositionProposalResponse,
    ProposePositionsRequest,
    RestoreRequest,
    RestoreResponse,
    SignalBatchResponse,
    SnapshotResponse,
    StressResponse,
    StressScenarioRequest,
    SubmissionMetadata,
)

from .strategy import BaseStrategy


def build_app(strategy: BaseStrategy) -> FastAPI:
    app = FastAPI(
        title="Potato Chips AI Submission",
        version=strategy.metadata().version,
    )

    @app.get("/healthz", response_model=HealthStatus)
    def healthz() -> HealthStatus:
        return strategy.healthz()

    @app.get("/metadata", response_model=SubmissionMetadata)
    def metadata() -> SubmissionMetadata:
        return strategy.metadata()

    @app.post("/snapshot", response_model=SnapshotResponse)
    def snapshot() -> SnapshotResponse:
        snapshot_bytes = strategy.snapshot_bytes()
        checksum = hashlib.sha256(snapshot_bytes).hexdigest()
        return SnapshotResponse(
            snapshot_b64=base64.b64encode(snapshot_bytes).decode("ascii"),
            checksum_sha256=checksum,
        )

    @app.post("/restore", response_model=RestoreResponse)
    def restore(request: RestoreRequest) -> RestoreResponse:
        snapshot_bytes = base64.b64decode(request.snapshot_b64.encode("ascii"))
        strategy.restore_snapshot_bytes(snapshot_bytes)
        checksum = hashlib.sha256(snapshot_bytes).hexdigest()
        return RestoreResponse(restored=True, checksum_sha256=checksum)

    @app.post("/on_market_update", response_model=SignalBatchResponse)
    def on_market_update(request: MarketUpdateRequest) -> SignalBatchResponse:
        return strategy.on_market_update(request)

    @app.post("/on_news", response_model=SignalBatchResponse)
    def on_news(request: NewsEventRequest) -> SignalBatchResponse:
        return strategy.on_news(request)

    @app.post("/propose_positions", response_model=PositionProposalResponse)
    def propose_positions(
        request: ProposePositionsRequest,
    ) -> PositionProposalResponse:
        return strategy.propose_positions(request)

    @app.get("/current_positioning", response_model=CurrentPositioning)
    def current_positioning() -> CurrentPositioning:
        return strategy.current_positioning()

    @app.post(
        "/explain_decision",
        response_model=DecisionExplanationResponse,
    )
    def explain_decision(
        request: ExplainDecisionRequest,
    ) -> DecisionExplanationResponse:
        return strategy.explain_decision(request)

    @app.post("/stress_response", response_model=StressResponse)
    def stress_response(request: StressScenarioRequest) -> StressResponse:
        return strategy.stress_response(request)

    return app


def run_strategy(strategy: BaseStrategy) -> None:
    port = int(os.environ.get("PORT", "8080"))
    uvicorn.run(build_app(strategy), host="0.0.0.0", port=port)
