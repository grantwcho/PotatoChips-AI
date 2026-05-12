from __future__ import annotations

import json
import time
from collections.abc import Iterable, Iterator
from datetime import datetime
from pathlib import Path

from .models import ReplayEvent

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_GOLD_REPLAY_PATH = ROOT / "replay_data" / "gold_replay_v1.jsonl"


def load_replay(path: Path | None = None) -> list[ReplayEvent]:
    replay_path = path or DEFAULT_GOLD_REPLAY_PATH
    events: list[ReplayEvent] = []
    with replay_path.open("r", encoding="utf-8") as handle:
        for raw_line in handle:
            line = raw_line.strip()
            if not line:
                continue
            events.append(ReplayEvent.model_validate(json.loads(line)))
    return events


def iter_replay(
    events: Iterable[ReplayEvent],
    *,
    wall_clock: bool = False,
    speedup: float = 60.0,
) -> Iterator[ReplayEvent]:
    previous_timestamp: datetime | None = None
    for event in events:
        if wall_clock and previous_timestamp is not None:
            delta = (event.timestamp - previous_timestamp).total_seconds()
            if delta > 0:
                time.sleep(delta / max(speedup, 1.0))
        previous_timestamp = event.timestamp
        yield event
