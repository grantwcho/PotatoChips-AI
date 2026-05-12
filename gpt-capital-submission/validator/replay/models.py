from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, ConfigDict


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ReplayEventType(str, Enum):
    MARKET_UPDATE = "market_update"
    NEWS = "news"


class ReplayEvent(StrictModel):
    event_id: str
    timestamp: datetime
    type: ReplayEventType
    anchors: list[str]
    tags: list[str]
    payload: dict[str, Any]
    notes: str | None = None
