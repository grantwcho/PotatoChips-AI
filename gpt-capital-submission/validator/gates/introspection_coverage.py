from __future__ import annotations

from collections.abc import Iterable
from typing import Any

from contract import CurrentPositioning

from ..scorecard import IntrospectionCoverageResult


def evaluate_introspection_coverage(
    snapshots: Iterable[CurrentPositioning],
) -> IntrospectionCoverageResult:
    snapshot_list = list(snapshots)
    if not snapshot_list:
        return IntrospectionCoverageResult(score=0.0, per_field={})

    per_field_hits: dict[str, int] = {
        field_name: 0 for field_name in CurrentPositioning.model_fields
    }
    for snapshot in snapshot_list:
        for field_name in per_field_hits:
            if _is_populated(getattr(snapshot, field_name)):
                per_field_hits[field_name] += 1

    per_field = {
        field_name: round(hit_count / len(snapshot_list), 4)
        for field_name, hit_count in per_field_hits.items()
    }
    score = round(sum(per_field.values()) / len(per_field), 4)
    return IntrospectionCoverageResult(score=score, per_field=per_field)


def _is_populated(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        lowered = value.strip().lower()
        return lowered not in {"", "n/a", "unknown", "unclear", "none"}
    if isinstance(value, (int, float)):
        return True
    if isinstance(value, list):
        return len(value) > 0 and any(_is_populated(item) for item in value)
    if isinstance(value, dict):
        return len(value) > 0 and any(_is_populated(item) for item in value.values())
    if hasattr(value, "model_dump"):
        return _is_populated(value.model_dump(mode="json"))
    return True
