from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from contract import NewsCategory, NewsSentiment

from .loader import DEFAULT_GOLD_REPLAY_PATH
from .models import ReplayEvent, ReplayEventType


@dataclass(frozen=True)
class SymbolSpec:
    sector: str
    price: float
    base_spread_bps: float
    base_volume: float
    vol_20d: float
    alpha: float


UNIVERSE: dict[str, SymbolSpec] = {
    "AAPL": SymbolSpec("megacap_tech", 198.0, 2.5, 42_000_000.0, 0.22, 0.0003),
    "MSFT": SymbolSpec("megacap_tech", 428.0, 2.1, 31_000_000.0, 0.21, 0.0004),
    "NVDA": SymbolSpec("semiconductors", 902.0, 4.0, 52_000_000.0, 0.34, 0.0013),
    "AMD": SymbolSpec("semiconductors", 164.0, 5.0, 49_000_000.0, 0.39, 0.0009),
    "META": SymbolSpec("megacap_tech", 514.0, 3.0, 18_500_000.0, 0.28, 0.0002),
    "AMZN": SymbolSpec("megacap_tech", 187.0, 2.8, 27_000_000.0, 0.26, 0.0001),
    "JPM": SymbolSpec("banks", 212.0, 3.2, 15_000_000.0, 0.24, 0.0002),
    "GS": SymbolSpec("banks", 431.0, 3.5, 4_500_000.0, 0.27, 0.0001),
    "BAC": SymbolSpec("banks", 42.0, 3.4, 39_000_000.0, 0.23, 0.0),
    "KRE": SymbolSpec("banks", 53.0, 8.5, 18_000_000.0, 0.31, -0.0002),
    "XOM": SymbolSpec("energy", 123.0, 2.7, 14_500_000.0, 0.19, 0.0001),
    "CVX": SymbolSpec("energy", 162.0, 2.6, 9_000_000.0, 0.18, 0.0001),
    "UNH": SymbolSpec("healthcare", 489.0, 3.1, 4_200_000.0, 0.20, -0.0002),
    "JNJ": SymbolSpec("healthcare", 154.0, 2.4, 7_800_000.0, 0.16, -0.0001),
    "CAT": SymbolSpec("industrials", 331.0, 2.9, 2_800_000.0, 0.22, 0.0002),
    "DE": SymbolSpec("industrials", 402.0, 3.1, 1_700_000.0, 0.25, 0.0001),
    "SPY": SymbolSpec("index", 524.0, 1.5, 62_000_000.0, 0.14, 0.0),
    "QQQ": SymbolSpec("index", 447.0, 1.6, 41_000_000.0, 0.17, 0.0003),
    "IWM": SymbolSpec("index", 206.0, 2.2, 25_000_000.0, 0.21, -0.0002),
    "XLF": SymbolSpec("banks", 42.0, 1.9, 35_000_000.0, 0.18, 0.0),
}


@dataclass(frozen=True)
class MarketCheckpoint:
    event_id: str
    timestamp: datetime
    label: str
    sector_moves: dict[str, float]
    spread_multiplier: float
    vol_multiplier: float
    volume_multiplier: float
    symbol_shocks: dict[str, float]
    anchors: list[str]
    tags: list[str]
    notes: str


@dataclass(frozen=True)
class NewsCheckpoint:
    event_id: str
    timestamp: datetime
    headline: str
    summary: str
    symbols: list[str]
    category: NewsCategory
    relevance: float
    sentiment: NewsSentiment
    anchors: list[str]
    tags: list[str]
    notes: str


MARKET_CHECKPOINTS: list[MarketCheckpoint] = [
    MarketCheckpoint(
        event_id="mkt-001",
        timestamp=datetime(2026, 4, 13, 13, 35, tzinfo=timezone.utc),
        label="opening-risk-bid",
        sector_moves={
            "semiconductors": 0.006,
            "megacap_tech": 0.003,
            "banks": 0.0015,
            "energy": -0.0005,
            "healthcare": -0.001,
            "industrials": 0.001,
            "index": 0.0018,
        },
        spread_multiplier=1.0,
        vol_multiplier=1.0,
        volume_multiplier=1.1,
        symbol_shocks={"NVDA": 0.002, "QQQ": 0.001},
        anchors=[],
        tags=["trend", "open"],
        notes="Opening bid favors semiconductors and large-cap tech.",
    ),
    MarketCheckpoint(
        event_id="mkt-002",
        timestamp=datetime(2026, 4, 13, 16, 0, tzinfo=timezone.utc),
        label="trend-follow-through",
        sector_moves={
            "semiconductors": 0.004,
            "megacap_tech": 0.0025,
            "banks": 0.001,
            "energy": 0.0004,
            "healthcare": -0.0004,
            "industrials": 0.0013,
            "index": 0.0015,
        },
        spread_multiplier=0.95,
        vol_multiplier=0.98,
        volume_multiplier=1.0,
        symbol_shocks={"AMD": 0.0015},
        anchors=[],
        tags=["trend"],
        notes="Correlated sector strength continues with healthy liquidity.",
    ),
    MarketCheckpoint(
        event_id="mkt-003",
        timestamp=datetime(2026, 4, 13, 19, 30, tzinfo=timezone.utc),
        label="steady-close",
        sector_moves={
            "semiconductors": 0.002,
            "megacap_tech": 0.0014,
            "banks": 0.0006,
            "energy": 0.0005,
            "healthcare": -0.0002,
            "industrials": 0.0008,
            "index": 0.001,
        },
        spread_multiplier=0.92,
        vol_multiplier=0.95,
        volume_multiplier=0.95,
        symbol_shocks={},
        anchors=[],
        tags=["trend", "close"],
        notes="Day one closes in orderly uptrend.",
    ),
    MarketCheckpoint(
        event_id="mkt-004",
        timestamp=datetime(2026, 4, 14, 13, 35, tzinfo=timezone.utc),
        label="rotation-open",
        sector_moves={
            "semiconductors": 0.001,
            "megacap_tech": 0.0005,
            "banks": 0.003,
            "energy": 0.001,
            "healthcare": 0.0006,
            "industrials": 0.0018,
            "index": 0.0012,
        },
        spread_multiplier=1.02,
        vol_multiplier=1.03,
        volume_multiplier=1.05,
        symbol_shocks={"KRE": 0.002},
        anchors=[],
        tags=["rotation", "open"],
        notes="Leadership rotates toward financials and cyclicals.",
    ),
    MarketCheckpoint(
        event_id="mkt-005",
        timestamp=datetime(2026, 4, 14, 16, 0, tzinfo=timezone.utc),
        label="earnings-contagion",
        sector_moves={
            "semiconductors": -0.008,
            "megacap_tech": -0.0015,
            "banks": 0.001,
            "energy": 0.0007,
            "healthcare": 0.0002,
            "industrials": 0.0003,
            "index": -0.001,
        },
        spread_multiplier=1.25,
        vol_multiplier=1.18,
        volume_multiplier=1.2,
        symbol_shocks={"AMD": -0.04, "NVDA": -0.012},
        anchors=[],
        tags=["idiosyncratic", "midday"],
        notes="Earnings miss hits AMD and pressures the semiconductor sleeve.",
    ),
    MarketCheckpoint(
        event_id="mkt-006",
        timestamp=datetime(2026, 4, 14, 19, 30, tzinfo=timezone.utc),
        label="choppy-close",
        sector_moves={
            "semiconductors": -0.002,
            "megacap_tech": 0.0005,
            "banks": 0.0012,
            "energy": 0.0004,
            "healthcare": 0.0008,
            "industrials": 0.0006,
            "index": 0.0002,
        },
        spread_multiplier=1.12,
        vol_multiplier=1.1,
        volume_multiplier=0.98,
        symbol_shocks={"AMD": -0.01},
        anchors=[],
        tags=["chop", "close"],
        notes="Shock is absorbed but semiconductor momentum remains impaired.",
    ),
    MarketCheckpoint(
        event_id="mkt-007",
        timestamp=datetime(2026, 4, 15, 13, 35, tzinfo=timezone.utc),
        label="pre-fed-calm",
        sector_moves={
            "semiconductors": 0.0008,
            "megacap_tech": 0.0008,
            "banks": 0.0005,
            "energy": 0.0004,
            "healthcare": 0.0003,
            "industrials": 0.0006,
            "index": 0.0007,
        },
        spread_multiplier=0.98,
        vol_multiplier=0.97,
        volume_multiplier=0.92,
        symbol_shocks={},
        anchors=[],
        tags=["calm", "open"],
        notes="Tape is quiet ahead of the macro catalyst.",
    ),
    MarketCheckpoint(
        event_id="mkt-008",
        timestamp=datetime(2026, 4, 15, 16, 5, tzinfo=timezone.utc),
        label="macro-repricing",
        sector_moves={
            "semiconductors": 0.013,
            "megacap_tech": 0.009,
            "banks": -0.007,
            "energy": 0.001,
            "healthcare": 0.0015,
            "industrials": 0.003,
            "index": 0.006,
        },
        spread_multiplier=1.2,
        vol_multiplier=1.28,
        volume_multiplier=1.45,
        symbol_shocks={"KRE": -0.012, "QQQ": 0.004, "XLF": -0.006},
        anchors=[],
        tags=["macro", "midday"],
        notes="Unexpected Fed easing drives growth outperformance and bank lag.",
    ),
    MarketCheckpoint(
        event_id="mkt-009",
        timestamp=datetime(2026, 4, 15, 19, 30, tzinfo=timezone.utc),
        label="dispersion-close",
        sector_moves={
            "semiconductors": 0.006,
            "megacap_tech": 0.004,
            "banks": -0.002,
            "energy": 0.0006,
            "healthcare": 0.001,
            "industrials": 0.0018,
            "index": 0.0022,
        },
        spread_multiplier=1.08,
        vol_multiplier=1.15,
        volume_multiplier=1.05,
        symbol_shocks={"NVDA": 0.003, "KRE": -0.004},
        anchors=[],
        tags=["macro", "close"],
        notes="Macro shock leaves the market in a high-dispersion regime.",
    ),
    MarketCheckpoint(
        event_id="mkt-010",
        timestamp=datetime(2026, 4, 16, 13, 35, tzinfo=timezone.utc),
        label="vol-spike-open",
        sector_moves={
            "semiconductors": -0.005,
            "megacap_tech": -0.004,
            "banks": -0.006,
            "energy": -0.002,
            "healthcare": -0.001,
            "industrials": -0.003,
            "index": -0.0038,
        },
        spread_multiplier=1.8,
        vol_multiplier=1.6,
        volume_multiplier=1.3,
        symbol_shocks={"IWM": -0.004},
        anchors=[],
        tags=["vol-spike", "open"],
        notes="The market opens with elevated volatility and weaker breadth.",
    ),
    MarketCheckpoint(
        event_id="mkt-011",
        timestamp=datetime(2026, 4, 16, 16, 30, tzinfo=timezone.utc),
        label="liquidity-dislocation",
        sector_moves={
            "semiconductors": -0.011,
            "megacap_tech": -0.009,
            "banks": -0.013,
            "energy": -0.005,
            "healthcare": -0.002,
            "industrials": -0.007,
            "index": -0.008,
        },
        spread_multiplier=3.1,
        vol_multiplier=2.1,
        volume_multiplier=1.55,
        symbol_shocks={"SPY": -0.007, "QQQ": -0.009, "KRE": -0.014},
        anchors=["regime_transition", "liquidity_shock"],
        tags=["shock", "midday"],
        notes=(
            "Brief price dislocation and spread widening "
            "force a risk-off transition."
        ),
    ),
    MarketCheckpoint(
        event_id="mkt-012",
        timestamp=datetime(2026, 4, 16, 19, 30, tzinfo=timezone.utc),
        label="partial-normalization",
        sector_moves={
            "semiconductors": 0.004,
            "megacap_tech": 0.003,
            "banks": 0.001,
            "energy": 0.0014,
            "healthcare": 0.0009,
            "industrials": 0.0012,
            "index": 0.0021,
        },
        spread_multiplier=1.6,
        vol_multiplier=1.35,
        volume_multiplier=1.1,
        symbol_shocks={"QQQ": 0.002},
        anchors=[],
        tags=["recovery", "close"],
        notes="Liquidity improves, but posture remains more cautious than before.",
    ),
    MarketCheckpoint(
        event_id="mkt-013",
        timestamp=datetime(2026, 4, 17, 13, 35, tzinfo=timezone.utc),
        label="calmer-open",
        sector_moves={
            "semiconductors": 0.003,
            "megacap_tech": 0.0022,
            "banks": 0.0015,
            "energy": 0.0008,
            "healthcare": 0.0005,
            "industrials": 0.0014,
            "index": 0.0018,
        },
        spread_multiplier=1.12,
        vol_multiplier=1.08,
        volume_multiplier=0.96,
        symbol_shocks={},
        anchors=[],
        tags=["calm", "open"],
        notes="The market opens calmer after the prior day's liquidity stress.",
    ),
    MarketCheckpoint(
        event_id="mkt-014",
        timestamp=datetime(2026, 4, 17, 16, 0, tzinfo=timezone.utc),
        label="steady-midday",
        sector_moves={
            "semiconductors": 0.002,
            "megacap_tech": 0.0015,
            "banks": 0.0008,
            "energy": 0.0006,
            "healthcare": 0.0004,
            "industrials": 0.0008,
            "index": 0.0012,
        },
        spread_multiplier=1.02,
        vol_multiplier=1.0,
        volume_multiplier=0.9,
        symbol_shocks={"NVDA": 0.0012},
        anchors=[],
        tags=["calm", "midday"],
        notes="Risk appetite steadies and the tape shifts from shock to calm.",
    ),
    MarketCheckpoint(
        event_id="mkt-015",
        timestamp=datetime(2026, 4, 17, 19, 30, tzinfo=timezone.utc),
        label="quiet-close",
        sector_moves={
            "semiconductors": 0.001,
            "megacap_tech": 0.001,
            "banks": 0.0005,
            "energy": 0.0005,
            "healthcare": 0.0003,
            "industrials": 0.0006,
            "index": 0.0009,
        },
        spread_multiplier=0.98,
        vol_multiplier=0.97,
        volume_multiplier=0.88,
        symbol_shocks={},
        anchors=[],
        tags=["calm", "close"],
        notes=(
            "Week closes in a calmer regime with lower dispersion "
            "than the shock day."
        ),
    ),
]


NEWS_CHECKPOINTS: list[NewsCheckpoint] = [
    NewsCheckpoint(
        event_id="news-001",
        timestamp=datetime(2026, 4, 13, 15, 5, tzinfo=timezone.utc),
        headline="Cloud capex chatter remains mixed ahead of large platform updates",
        summary=(
            "Desk talk suggests no clear incremental signal "
            "for mega-cap software demand."
        ),
        symbols=["MSFT", "AMZN"],
        category=NewsCategory.OTHER,
        relevance=0.18,
        sentiment=NewsSentiment.NEUTRAL,
        anchors=[],
        tags=["noise_news"],
        notes="Noise item that should not necessarily provoke action.",
    ),
    NewsCheckpoint(
        event_id="news-002",
        timestamp=datetime(2026, 4, 14, 15, 15, tzinfo=timezone.utc),
        headline="AMD posts an earnings miss and cuts near-term data center guidance",
        summary=(
            "Management highlights weaker near-term acceleration, "
            "pressuring semiconductor peers."
        ),
        symbols=["AMD", "NVDA", "QQQ"],
        category=NewsCategory.EARNINGS,
        relevance=0.91,
        sentiment=NewsSentiment.NEGATIVE,
        anchors=["idiosyncratic_event"],
        tags=["earnings", "substantive_news"],
        notes=(
            "Idiosyncratic event designed to test responsiveness "
            "to name-specific shocks."
        ),
    ),
    NewsCheckpoint(
        event_id="news-003",
        timestamp=datetime(2026, 4, 15, 15, 45, tzinfo=timezone.utc),
        headline="Federal Reserve surprises markets with an unexpected 50bp cut",
        summary=(
            "Growth assets rally while regional banks and financials "
            "lag on margin concerns."
        ),
        symbols=["SPY", "QQQ", "JPM", "KRE", "XLF"],
        category=NewsCategory.MACRO,
        relevance=0.97,
        sentiment=NewsSentiment.POSITIVE,
        anchors=["macro_surprise"],
        tags=["macro", "substantive_news"],
        notes="Primary macro anchor for packaging and responsiveness checks.",
    ),
    NewsCheckpoint(
        event_id="news-004",
        timestamp=datetime(2026, 4, 16, 15, 55, tzinfo=timezone.utc),
        headline=(
            "ETF market makers report a brief liquidity vacuum "
            "across index products"
        ),
        summary=(
            "Spreads widen sharply as order books thin and passive "
            "hedging demand jumps."
        ),
        symbols=["SPY", "QQQ", "IWM"],
        category=NewsCategory.LIQUIDITY,
        relevance=0.93,
        sentiment=NewsSentiment.NEGATIVE,
        anchors=["liquidity_shock"],
        tags=["liquidity", "substantive_news"],
        notes=(
            "Brief liquidity shock that should move both action "
            "and introspection surfaces."
        ),
    ),
    NewsCheckpoint(
        event_id="news-005",
        timestamp=datetime(2026, 4, 17, 15, 10, tzinfo=timezone.utc),
        headline="Healthcare conference headlines remain broadly incremental and mixed",
        summary=(
            "No single update materially changes the earnings outlook "
            "for diversified healthcare."
        ),
        symbols=["UNH", "JNJ"],
        category=NewsCategory.OTHER,
        relevance=0.16,
        sentiment=NewsSentiment.NEUTRAL,
        anchors=[],
        tags=["noise_news"],
        notes="Another low-signal item to keep the replay realistic.",
    ),
]


def _build_market_events() -> list[ReplayEvent]:
    current_prices = {symbol: spec.price for symbol, spec in UNIVERSE.items()}
    day_open_prices = dict(current_prices)
    previous_date = None
    events: list[ReplayEvent] = []
    for checkpoint in MARKET_CHECKPOINTS:
        current_date = checkpoint.timestamp.date()
        if current_date != previous_date:
            day_open_prices = dict(current_prices)
            previous_date = current_date
        ticks = []
        for symbol, spec in UNIVERSE.items():
            sector_move = checkpoint.sector_moves.get(spec.sector, 0.0)
            symbol_move = (
                sector_move + spec.alpha + checkpoint.symbol_shocks.get(symbol, 0.0)
            )
            current_prices[symbol] = round(
                current_prices[symbol] * (1.0 + symbol_move), 4
            )
            open_price = round(day_open_prices[symbol], 4)
            last_price = current_prices[symbol]
            return_1d = round(last_price / open_price - 1.0, 4)
            spread_bps = round(spec.base_spread_bps * checkpoint.spread_multiplier, 3)
            volume = round(
                spec.base_volume
                * checkpoint.volume_multiplier
                * (1.0 + abs(symbol_move) * 12.0),
                2,
            )
            ticks.append(
                {
                    "symbol": symbol,
                    "last": last_price,
                    "open": open_price,
                    "high": round(
                        max(last_price, open_price) * (1.0 + abs(symbol_move) * 0.2), 4
                    ),
                    "low": round(
                        min(last_price, open_price) * (1.0 - abs(symbol_move) * 0.2), 4
                    ),
                    "volume": volume,
                    "vwap": round((last_price + open_price) / 2.0, 4),
                    "spread_bps": spread_bps,
                    "sector": spec.sector,
                    "features": {
                        "return_5m": round(symbol_move, 4),
                        "return_1d": return_1d,
                        "volatility_20d": round(
                            spec.vol_20d * checkpoint.vol_multiplier, 4
                        ),
                    },
                }
            )
        events.append(
            ReplayEvent(
                event_id=checkpoint.event_id,
                timestamp=checkpoint.timestamp,
                type=ReplayEventType.MARKET_UPDATE,
                anchors=checkpoint.anchors,
                tags=checkpoint.tags,
                payload={
                    "batch_id": checkpoint.event_id,
                    "timestamp": checkpoint.timestamp.isoformat().replace(
                        "+00:00", "Z"
                    ),
                    "ticks": ticks,
                },
                notes=checkpoint.notes,
            )
        )
    return events


def _build_news_events() -> list[ReplayEvent]:
    events: list[ReplayEvent] = []
    for checkpoint in NEWS_CHECKPOINTS:
        events.append(
            ReplayEvent(
                event_id=checkpoint.event_id,
                timestamp=checkpoint.timestamp,
                type=ReplayEventType.NEWS,
                anchors=checkpoint.anchors,
                tags=checkpoint.tags,
                payload={
                    "event_id": checkpoint.event_id,
                    "timestamp": checkpoint.timestamp.isoformat().replace(
                        "+00:00", "Z"
                    ),
                    "headline": checkpoint.headline,
                    "summary": checkpoint.summary,
                    "symbols": checkpoint.symbols,
                    "category": checkpoint.category.value,
                    "relevance": checkpoint.relevance,
                    "sentiment": checkpoint.sentiment.value,
                },
                notes=checkpoint.notes,
            )
        )
    return events


def generate_gold_replay() -> list[ReplayEvent]:
    events = _build_market_events() + _build_news_events()
    return sorted(events, key=lambda event: event.timestamp)


def write_gold_replay(path: Path | None = None) -> Path:
    output_path = path or DEFAULT_GOLD_REPLAY_PATH
    output_path.parent.mkdir(parents=True, exist_ok=True)
    events = generate_gold_replay()
    with output_path.open("w", encoding="utf-8") as handle:
        for event in events:
            handle.write(
                json.dumps(
                    event.model_dump(mode="json"),
                    separators=(",", ":"),
                    sort_keys=True,
                )
            )
            handle.write("\n")
    return output_path


if __name__ == "__main__":
    write_gold_replay()
