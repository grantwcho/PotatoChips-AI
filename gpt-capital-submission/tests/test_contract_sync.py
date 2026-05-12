from __future__ import annotations

from pathlib import Path
from typing import Any, cast

import yaml  # type: ignore[import-untyped]

from contract.schemas import COMPONENT_MODELS
from sdk.python.examples.example_momentum.app import MomentumStrategy
from sdk.python.gptcap import build_app

ROOT = Path(__file__).resolve().parents[1]
OPENAPI_PATH = ROOT / "contract" / "openapi.yaml"


def _load_spec() -> dict[str, Any]:
    with OPENAPI_PATH.open("r", encoding="utf-8") as handle:
        return cast(dict[str, Any], yaml.safe_load(handle))


def test_openapi_paths_match_server_contract() -> None:
    spec = _load_spec()
    app_spec = build_app(MomentumStrategy()).openapi()
    expected_refs = {
        ("/healthz", "get"): (None, "HealthStatus"),
        ("/metadata", "get"): (None, "SubmissionMetadata"),
        ("/snapshot", "post"): (None, "SnapshotResponse"),
        ("/restore", "post"): ("RestoreRequest", "RestoreResponse"),
        ("/on_market_update", "post"): ("MarketUpdateRequest", "SignalBatchResponse"),
        ("/on_news", "post"): ("NewsEventRequest", "SignalBatchResponse"),
        ("/propose_positions", "post"): (
            "ProposePositionsRequest",
            "PositionProposalResponse",
        ),
        ("/current_positioning", "get"): (None, "CurrentPositioning"),
        ("/explain_decision", "post"): (
            "ExplainDecisionRequest",
            "DecisionExplanationResponse",
        ),
        ("/stress_response", "post"): ("StressScenarioRequest", "StressResponse"),
    }
    assert set(spec["paths"]) == set(app_spec["paths"])
    for (path, method), (request_ref, response_ref) in expected_refs.items():
        operation = spec["paths"][path][method]
        server_operation = app_spec["paths"][path][method]
        if request_ref is None:
            assert "requestBody" not in operation
        else:
            request_schema = operation["requestBody"]["content"]["application/json"][
                "schema"
            ]["$ref"]
            server_request_schema = server_operation["requestBody"]["content"][
                "application/json"
            ]["schema"]["$ref"]
            assert request_schema.endswith(f"/{request_ref}")
            assert server_request_schema.endswith(f"/{request_ref}")
        response_schema = operation["responses"]["200"]["content"]["application/json"][
            "schema"
        ]["$ref"]
        server_response_schema = server_operation["responses"]["200"]["content"][
            "application/json"
        ]["schema"]["$ref"]
        assert response_schema.endswith(f"/{response_ref}")
        assert server_response_schema.endswith(f"/{response_ref}")


def test_component_models_match_openapi_field_names_and_required_sets() -> None:
    spec = _load_spec()
    schemas = spec["components"]["schemas"]
    for name, model in COMPONENT_MODELS.items():
        schema = schemas[name]
        assert set(schema["properties"]) == set(model.model_fields)
        expected_required = {
            field_name
            for field_name, field in model.model_fields.items()
            if field.is_required()
        }
        assert set(schema.get("required", [])) == expected_required
        assert schema.get("additionalProperties") is False
