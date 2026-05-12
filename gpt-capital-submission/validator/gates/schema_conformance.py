from __future__ import annotations

from collections.abc import Sequence

from ..client import SubmissionClient, ValidationProtocolError
from ..replay.models import ReplayEvent
from ..replay.runner import run_schema_probe
from ..scorecard import SchemaConformanceResult


def evaluate_schema_conformance(
    client: SubmissionClient,
    replay_events: Sequence[ReplayEvent],
) -> SchemaConformanceResult:
    try:
        run_schema_probe(client, replay_events)
    except (RuntimeError, ValidationProtocolError) as exc:
        return SchemaConformanceResult.model_validate(
            {
                "pass": False,
                "details": str(exc),
            }
        )
    return SchemaConformanceResult.model_validate(
        {
            "pass": True,
            "details": (
                "All endpoints returned schema-valid responses "
                "for representative inputs."
            ),
        }
    )
