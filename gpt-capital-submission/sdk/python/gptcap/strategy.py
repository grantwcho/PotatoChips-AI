from __future__ import annotations

import json
from abc import ABC, abstractmethod
from typing import Any

from contract import (
    CurrentPositioning,
    DecisionExplanationResponse,
    ExplainDecisionRequest,
    HealthStatus,
    MarketUpdateRequest,
    NewsEventRequest,
    PositionProposalResponse,
    ProposePositionsRequest,
    SignalBatchResponse,
    StressResponse,
    StressScenarioRequest,
    SubmissionMetadata,
)


class BaseStrategy(ABC):
    """Base class for Python reference submissions."""

    @abstractmethod
    def metadata(self) -> SubmissionMetadata:
        """Return static metadata for the submission."""

    def healthz(self) -> HealthStatus:
        metadata = self.metadata()
        return HealthStatus(status="ok", ready=True, version=metadata.version)

    @abstractmethod
    def on_market_update(self, request: MarketUpdateRequest) -> SignalBatchResponse:
        """Handle a market update batch."""

    @abstractmethod
    def on_news(self, request: NewsEventRequest) -> SignalBatchResponse:
        """Handle a news event."""

    @abstractmethod
    def propose_positions(
        self, request: ProposePositionsRequest
    ) -> PositionProposalResponse:
        """Propose position deltas for the current portfolio."""

    @abstractmethod
    def current_positioning(self) -> CurrentPositioning:
        """Return the current structured strategy state."""

    @abstractmethod
    def explain_decision(
        self, request: ExplainDecisionRequest
    ) -> DecisionExplanationResponse:
        """Explain a previously emitted signal."""

    @abstractmethod
    def stress_response(self, request: StressScenarioRequest) -> StressResponse:
        """Describe how positioning would change under a stress scenario."""

    @abstractmethod
    def export_state(self) -> dict[str, Any]:
        """Return all mutable strategy state required for deterministic replay."""

    @abstractmethod
    def import_state(self, state: dict[str, Any]) -> None:
        """Restore previously exported state."""

    def snapshot_bytes(self) -> bytes:
        payload = json.dumps(
            self.export_state(),
            separators=(",", ":"),
            sort_keys=True,
        )
        return payload.encode("utf-8")

    def restore_snapshot_bytes(self, snapshot: bytes) -> None:
        state = json.loads(snapshot.decode("utf-8"))
        if not isinstance(state, dict):
            raise ValueError("Snapshot payload must decode to an object.")
        self.import_state(state)
