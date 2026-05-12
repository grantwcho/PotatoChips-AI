from __future__ import annotations

import json

from ..replay.runner import ReplayTrace
from ..scorecard import ResponsivenessResult

REQUIRED_ANCHORS = ("macro_surprise", "regime_transition")


def evaluate_responsiveness(trace: ReplayTrace) -> ResponsivenessResult:
    missing = [
        anchor for anchor in REQUIRED_ANCHORS if anchor not in trace.anchor_snapshots
    ]
    if missing:
        return ResponsivenessResult.model_validate(
            {
                "pass": False,
                "details": f"Missing replay anchors: {', '.join(missing)}",
            }
        )

    messages = []
    passed = True
    for anchor in REQUIRED_ANCHORS:
        snapshot = trace.anchor_snapshots[anchor]
        before = snapshot.before.model_dump(mode="json")
        after = snapshot.after.model_dump(mode="json")
        changed_fields = sorted(
            field_name
            for field_name in before.keys()
            if before[field_name] != after[field_name]
        )
        factors_same = json.dumps(
            before["active_factors"], sort_keys=True
        ) == json.dumps(
            after["active_factors"],
            sort_keys=True,
        )
        regime_same = before["regime_view"] == after["regime_view"]
        if factors_same and regime_same:
            passed = False
        messages.append(
            f"{anchor}: changed={changed_fields or ['none']}, "
            f"regime_same={regime_same}, active_factors_same={factors_same}"
        )
    return ResponsivenessResult.model_validate(
        {
            "pass": passed,
            "details": " | ".join(messages),
        }
    )
