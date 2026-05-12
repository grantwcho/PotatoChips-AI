from __future__ import annotations

import json
from enum import Enum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from rich.console import Console
from rich.table import Table


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Verdict(str, Enum):
    ACCEPT = "accept"
    REJECT = "reject"
    REVIEW = "review"


class SchemaConformanceResult(StrictModel):
    pass_: bool = Field(alias="pass")
    details: str


class LivenessResult(StrictModel):
    pass_: bool = Field(alias="pass")
    boot_s: float
    p99_ms: float
    details: str | None = None


class ActivityRateResult(StrictModel):
    score: float
    flag: bool


class IntrospectionCoverageResult(StrictModel):
    score: float
    per_field: dict[str, float]


class ResponsivenessResult(StrictModel):
    pass_: bool = Field(alias="pass")
    details: str


class FaithfulnessClaim(StrictModel):
    checkpoint_id: str
    sentence: str
    verdict: Literal["grounded", "ungrounded", "partial"]
    field: str | None = None
    rationale: str | None = None


class FaithfulnessResult(StrictModel):
    pass_: bool = Field(alias="pass")
    ungrounded_claims: list[FaithfulnessClaim]


class DifferentiationResult(StrictModel):
    score: float


class InformativenessResult(StrictModel):
    score: float
    template_fills: dict[str, str]


class StabilityResult(StrictModel):
    pass_: bool = Field(alias="pass")
    details: str | None = None


class ViabilityScorecard(StrictModel):
    schema_conformance: SchemaConformanceResult
    liveness: LivenessResult
    activity_rate: ActivityRateResult
    introspection_coverage: IntrospectionCoverageResult
    responsiveness: ResponsivenessResult


class PackagingScorecard(StrictModel):
    faithfulness: FaithfulnessResult
    differentiation: DifferentiationResult
    informativeness: InformativenessResult
    stability: StabilityResult


class SampleCommentary(StrictModel):
    checkpoint_id: str
    commentary: str


class SubmissionScorecard(StrictModel):
    submission_id: str
    verdict: Verdict
    viability: ViabilityScorecard
    packaging: PackagingScorecard
    sample_commentary: list[SampleCommentary]

    def to_json(self) -> str:
        return json.dumps(self.model_dump(by_alias=True), indent=2)


def render_scorecard(
    scorecard: SubmissionScorecard, console: Console | None = None
) -> None:
    console = console or Console()
    verdict_table = Table(title=f"Potato Chips AI Validation: {scorecard.submission_id}")
    verdict_table.add_column("Verdict")
    verdict_table.add_row(scorecard.verdict.value.upper())
    console.print(verdict_table)

    viability_table = Table(title="Viability")
    viability_table.add_column("Gate")
    viability_table.add_column("Result")
    viability_table.add_column("Notes")
    viability_table.add_row(
        "schema_conformance",
        str(scorecard.viability.schema_conformance.pass_),
        scorecard.viability.schema_conformance.details,
    )
    viability_table.add_row(
        "liveness",
        str(scorecard.viability.liveness.pass_),
        f"boot={scorecard.viability.liveness.boot_s:.2f}s, "
        f"p99={scorecard.viability.liveness.p99_ms:.1f}ms",
    )
    viability_table.add_row(
        "activity_rate",
        "flagged" if scorecard.viability.activity_rate.flag else "ok",
        f"score={scorecard.viability.activity_rate.score:.2%}",
    )
    viability_table.add_row(
        "introspection_coverage",
        "ok",
        f"score={scorecard.viability.introspection_coverage.score:.2%}",
    )
    viability_table.add_row(
        "responsiveness",
        str(scorecard.viability.responsiveness.pass_),
        scorecard.viability.responsiveness.details,
    )
    console.print(viability_table)

    packaging_table = Table(title="Packaging")
    packaging_table.add_column("Check")
    packaging_table.add_column("Result")
    packaging_table.add_column("Notes")
    packaging_table.add_row(
        "faithfulness",
        str(scorecard.packaging.faithfulness.pass_),
        f"ungrounded={len(scorecard.packaging.faithfulness.ungrounded_claims)}",
    )
    packaging_table.add_row(
        "differentiation",
        "scored",
        f"{scorecard.packaging.differentiation.score:.3f}",
    )
    packaging_table.add_row(
        "informativeness",
        "scored",
        f"{scorecard.packaging.informativeness.score:.2%}",
    )
    packaging_table.add_row(
        "stability",
        str(scorecard.packaging.stability.pass_),
        scorecard.packaging.stability.details or "",
    )
    console.print(packaging_table)
