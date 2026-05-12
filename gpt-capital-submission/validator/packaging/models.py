from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, ConfigDict

from ..scorecard import FaithfulnessClaim


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class CommentaryKind(str, Enum):
    OPEN_COMMENTARY = "open_commentary"
    MIDDAY_OBSERVATION = "midday_observation"
    DECISION_EXPLANATION = "decision_explanation"
    END_OF_DAY_WRAP = "end_of_day_wrap"


class CommentaryEntry(StrictModel):
    checkpoint_id: str
    kind: CommentaryKind
    text: str
    signal_id: str | None = None


class DayInLifeResponse(StrictModel):
    commentary: list[CommentaryEntry]


class FaithfulnessResponse(StrictModel):
    judgments: list[FaithfulnessClaim]


class AnalystTemplateResponse(StrictModel):
    position: str
    conviction: str
    thesis: str
    key_risks: str
    disconfirming_evidence: str
