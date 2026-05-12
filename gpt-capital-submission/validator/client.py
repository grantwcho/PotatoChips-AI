from __future__ import annotations

from dataclasses import dataclass
from typing import Generic, TypeVar

from pydantic import BaseModel, ValidationError

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

from .runtime import SubmissionRuntime

ModelT = TypeVar("ModelT", bound=BaseModel)


class ValidationProtocolError(RuntimeError):
    """Raised when a submission violates the HTTP or schema contract."""


@dataclass(frozen=True)
class ValidatedCall(Generic[ModelT]):
    model: ModelT
    latency_ms: float
    status_code: int


class SubmissionClient:
    def __init__(self, runtime: SubmissionRuntime) -> None:
        self.runtime = runtime

    def healthz(self) -> ValidatedCall[HealthStatus]:
        return self._request("GET", "/healthz", HealthStatus)

    def metadata(self) -> ValidatedCall[SubmissionMetadata]:
        return self._request("GET", "/metadata", SubmissionMetadata)

    def snapshot(self) -> ValidatedCall[SnapshotResponse]:
        return self._request("POST", "/snapshot", SnapshotResponse)

    def restore(self, request: RestoreRequest) -> ValidatedCall[RestoreResponse]:
        return self._request("POST", "/restore", RestoreResponse, request)

    def on_market_update(
        self, request: MarketUpdateRequest
    ) -> ValidatedCall[SignalBatchResponse]:
        return self._request("POST", "/on_market_update", SignalBatchResponse, request)

    def on_news(self, request: NewsEventRequest) -> ValidatedCall[SignalBatchResponse]:
        return self._request("POST", "/on_news", SignalBatchResponse, request)

    def propose_positions(
        self, request: ProposePositionsRequest
    ) -> ValidatedCall[PositionProposalResponse]:
        return self._request(
            "POST",
            "/propose_positions",
            PositionProposalResponse,
            request,
        )

    def current_positioning(self) -> ValidatedCall[CurrentPositioning]:
        return self._request("GET", "/current_positioning", CurrentPositioning)

    def explain_decision(
        self, request: ExplainDecisionRequest
    ) -> ValidatedCall[DecisionExplanationResponse]:
        return self._request(
            "POST",
            "/explain_decision",
            DecisionExplanationResponse,
            request,
        )

    def stress_response(
        self, request: StressScenarioRequest
    ) -> ValidatedCall[StressResponse]:
        return self._request("POST", "/stress_response", StressResponse, request)

    def _request(
        self,
        method: str,
        path: str,
        response_model: type[ModelT],
        request_model: BaseModel | None = None,
    ) -> ValidatedCall[ModelT]:
        payload = request_model.model_dump(mode="json") if request_model else None
        response = self.runtime.request(method=method, path=path, json_body=payload)
        if response.status_code >= 400:
            raise ValidationProtocolError(
                f"{method} {path} returned HTTP "
                f"{response.status_code}: {response.payload!r}"
            )
        try:
            model = response_model.model_validate(response.payload)
        except ValidationError as exc:
            raise ValidationProtocolError(
                f"{method} {path} returned schema-invalid payload: {exc}"
            ) from exc
        return ValidatedCall(
            model=model,
            latency_ms=response.latency_ms,
            status_code=response.status_code,
        )
