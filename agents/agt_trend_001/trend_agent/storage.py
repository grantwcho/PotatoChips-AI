from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from .types import AssetSignalState, OpenPosition


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


class SQLiteTrendStore:
    def __init__(self, database_path: str) -> None:
        self.database_path = database_path
        resolved = Path(database_path)
        resolved.parent.mkdir(parents=True, exist_ok=True)
        self.connection = sqlite3.connect(database_path)
        self.connection.row_factory = sqlite3.Row
        self._initialize()

    def _initialize(self) -> None:
        self.connection.executescript(
            """
            create table if not exists signals (
              id integer primary key autoincrement,
              recorded_at text not null,
              symbol text not null,
              signal text not null,
              price real not null,
              fast_ma real not null,
              slow_ma real not null,
              trend_ma real not null,
              atr real not null,
              breakout_long integer not null,
              breakout_short integer not null,
              crossover text,
              stop_hit integer not null,
              current_stop_level real,
              reason text not null
            );

            create table if not exists positions (
              symbol text primary key,
              side text not null,
              entry_date text not null,
              entry_price real not null,
              atr_at_entry real not null,
              current_stop_level real not null,
              position_pct_nav real not null,
              entry_notional_usd real not null,
              highest_close real not null,
              lowest_close real not null,
              last_price real not null,
              unrealized_pnl_usd real not null,
              unrealized_pnl_pct real not null,
              updated_at text not null,
              status text not null
            );

            create table if not exists trades (
              id integer primary key autoincrement,
              symbol text not null,
              side text not null,
              entry_date text not null,
              exit_date text not null,
              entry_price real not null,
              exit_price real not null,
              atr_at_entry real not null,
              stop_level real not null,
              position_pct_nav real not null,
              entry_notional_usd real not null,
              realized_pnl_usd real not null,
              win integer not null
            );

            create table if not exists equity_curve (
              trade_date text primary key,
              nav_usd real not null,
              peak_nav_usd real not null,
              drawdown_pct real not null,
              portfolio_vol_estimate real not null,
              gross_exposure_pct_nav real not null
            );

            create table if not exists agent_state (
              key text primary key,
              value text not null
            );
            """
        )
        self.connection.commit()

    def record_signal(self, signal: AssetSignalState) -> None:
        self.connection.execute(
            """
            insert into signals (
              recorded_at,
              symbol,
              signal,
              price,
              fast_ma,
              slow_ma,
              trend_ma,
              atr,
              breakout_long,
              breakout_short,
              crossover,
              stop_hit,
              current_stop_level,
              reason
            ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                utc_now_iso(),
                signal.symbol,
                signal.signal,
                signal.price,
                signal.fast_ma,
                signal.slow_ma,
                signal.trend_ma,
                signal.atr,
                int(signal.breakout_long),
                int(signal.breakout_short),
                signal.crossover,
                int(signal.stop_hit),
                signal.current_stop_level,
                signal.reason,
            ),
        )
        self.connection.commit()

    def get_open_positions(self) -> list[OpenPosition]:
        rows = self.connection.execute(
            """
            select *
            from positions
            where status = 'OPEN'
            order by symbol asc
            """
        ).fetchall()
        return [self._row_to_position(row) for row in rows]

    def get_position(self, symbol: str) -> OpenPosition | None:
        row = self.connection.execute(
            "select * from positions where symbol = ?",
            (symbol,),
        ).fetchone()
        return self._row_to_position(row) if row is not None else None

    def upsert_position(
        self,
        *,
        symbol: str,
        side: str,
        entry_date: str,
        entry_price: float,
        atr_at_entry: float,
        current_stop_level: float,
        position_pct_nav: float,
        entry_notional_usd: float,
    ) -> None:
        timestamp = utc_now_iso()
        self.connection.execute(
            """
            insert into positions (
              symbol,
              side,
              entry_date,
              entry_price,
              atr_at_entry,
              current_stop_level,
              position_pct_nav,
              entry_notional_usd,
              highest_close,
              lowest_close,
              last_price,
              unrealized_pnl_usd,
              unrealized_pnl_pct,
              updated_at,
              status
            ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, 'OPEN')
            on conflict(symbol) do update set
              side = excluded.side,
              entry_date = excluded.entry_date,
              entry_price = excluded.entry_price,
              atr_at_entry = excluded.atr_at_entry,
              current_stop_level = excluded.current_stop_level,
              position_pct_nav = excluded.position_pct_nav,
              entry_notional_usd = excluded.entry_notional_usd,
              highest_close = excluded.highest_close,
              lowest_close = excluded.lowest_close,
              last_price = excluded.last_price,
              unrealized_pnl_usd = 0,
              unrealized_pnl_pct = 0,
              updated_at = excluded.updated_at,
              status = 'OPEN'
            """,
            (
                symbol,
                side,
                entry_date,
                entry_price,
                atr_at_entry,
                current_stop_level,
                position_pct_nav,
                entry_notional_usd,
                entry_price,
                entry_price,
                entry_price,
                timestamp,
            ),
        )
        self.connection.commit()

    def update_position_metrics(
        self,
        *,
        symbol: str,
        current_stop_level: float,
        highest_close: float,
        lowest_close: float,
        last_price: float,
        unrealized_pnl_usd: float,
        unrealized_pnl_pct: float,
    ) -> None:
        self.connection.execute(
            """
            update positions
            set
              current_stop_level = ?,
              highest_close = ?,
              lowest_close = ?,
              last_price = ?,
              unrealized_pnl_usd = ?,
              unrealized_pnl_pct = ?,
              updated_at = ?
            where symbol = ? and status = 'OPEN'
            """,
            (
                current_stop_level,
                highest_close,
                lowest_close,
                last_price,
                unrealized_pnl_usd,
                unrealized_pnl_pct,
                utc_now_iso(),
                symbol,
            ),
        )
        self.connection.commit()

    def close_position(
        self,
        *,
        symbol: str,
        exit_date: str,
        exit_price: float,
        realized_pnl_usd: float,
    ) -> None:
        position = self.get_position(symbol)
        if position is None:
            return

        self.connection.execute(
            """
            update positions
            set
              last_price = ?,
              unrealized_pnl_usd = ?,
              unrealized_pnl_pct = ?,
              updated_at = ?,
              status = 'CLOSED'
            where symbol = ?
            """,
            (
                exit_price,
                realized_pnl_usd,
                0.0,
                utc_now_iso(),
                symbol,
            ),
        )
        self.connection.execute(
            """
            insert into trades (
              symbol,
              side,
              entry_date,
              exit_date,
              entry_price,
              exit_price,
              atr_at_entry,
              stop_level,
              position_pct_nav,
              entry_notional_usd,
              realized_pnl_usd,
              win
            ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                position.symbol,
                position.side,
                position.entry_date,
                exit_date,
                position.entry_price,
                exit_price,
                position.atr_at_entry,
                position.current_stop_level,
                position.position_pct_nav,
                position.entry_notional_usd,
                realized_pnl_usd,
                int(realized_pnl_usd > 0),
            ),
        )
        self.connection.commit()

    def total_realized_pnl(self) -> float:
        row = self.connection.execute(
            "select coalesce(sum(realized_pnl_usd), 0) as value from trades"
        ).fetchone()
        return float(row["value"]) if row is not None else 0.0

    def record_equity_point(
        self,
        *,
        trade_date: str,
        nav_usd: float,
        peak_nav_usd: float,
        drawdown_pct: float,
        portfolio_vol_estimate: float,
        gross_exposure_pct_nav: float,
    ) -> None:
        self.connection.execute(
            """
            insert into equity_curve (
              trade_date,
              nav_usd,
              peak_nav_usd,
              drawdown_pct,
              portfolio_vol_estimate,
              gross_exposure_pct_nav
            ) values (?, ?, ?, ?, ?, ?)
            on conflict(trade_date) do update set
              nav_usd = excluded.nav_usd,
              peak_nav_usd = excluded.peak_nav_usd,
              drawdown_pct = excluded.drawdown_pct,
              portfolio_vol_estimate = excluded.portfolio_vol_estimate,
              gross_exposure_pct_nav = excluded.gross_exposure_pct_nav
            """,
            (
                trade_date,
                nav_usd,
                peak_nav_usd,
                drawdown_pct,
                portfolio_vol_estimate,
                gross_exposure_pct_nav,
            ),
        )
        self.connection.commit()

    def recent_equity_curve(self, limit: int = 90) -> list[dict[str, float | str]]:
        rows = self.connection.execute(
            """
            select trade_date, nav_usd, peak_nav_usd, drawdown_pct
            from equity_curve
            order by trade_date desc
            limit ?
            """,
            (limit,),
        ).fetchall()
        return [
            {
                "trade_date": str(row["trade_date"]),
                "nav_usd": float(row["nav_usd"]),
                "peak_nav_usd": float(row["peak_nav_usd"]),
                "drawdown_pct": float(row["drawdown_pct"]),
            }
            for row in reversed(rows)
        ]

    def full_equity_curve(self) -> list[dict[str, float | str]]:
        rows = self.connection.execute(
            """
            select trade_date, nav_usd, peak_nav_usd, drawdown_pct
            from equity_curve
            order by trade_date asc
            """
        ).fetchall()
        return [
            {
                "trade_date": str(row["trade_date"]),
                "nav_usd": float(row["nav_usd"]),
                "peak_nav_usd": float(row["peak_nav_usd"]),
                "drawdown_pct": float(row["drawdown_pct"]),
            }
            for row in rows
        ]

    def get_state(self, key: str) -> str | None:
        row = self.connection.execute(
            "select value from agent_state where key = ?",
            (key,),
        ).fetchone()
        return str(row["value"]) if row is not None else None

    def set_state(self, key: str, value: str | dict[str, object]) -> None:
        serialized = json.dumps(value, sort_keys=True) if isinstance(value, dict) else str(value)
        self.connection.execute(
            """
            insert into agent_state (key, value)
            values (?, ?)
            on conflict(key) do update set value = excluded.value
            """,
            (key, serialized),
        )
        self.connection.commit()

    def closed_trade_win_rate(self) -> float:
        row = self.connection.execute(
            """
            select
              coalesce(avg(win), 0) as avg_win
            from trades
            """
        ).fetchone()
        return float(row["avg_win"]) if row is not None else 0.0

    def closed_trade_count(self) -> int:
        row = self.connection.execute("select count(*) as value from trades").fetchone()
        return int(row["value"]) if row is not None else 0

    def _row_to_position(self, row: sqlite3.Row) -> OpenPosition:
        return OpenPosition(
            symbol=str(row["symbol"]),
            side=str(row["side"]),
            entry_date=str(row["entry_date"]),
            entry_price=float(row["entry_price"]),
            atr_at_entry=float(row["atr_at_entry"]),
            current_stop_level=float(row["current_stop_level"]),
            position_pct_nav=float(row["position_pct_nav"]),
            entry_notional_usd=float(row["entry_notional_usd"]),
            highest_close=float(row["highest_close"]),
            lowest_close=float(row["lowest_close"]),
            last_price=float(row["last_price"]),
            unrealized_pnl_usd=float(row["unrealized_pnl_usd"]),
            unrealized_pnl_pct=float(row["unrealized_pnl_pct"]),
            updated_at=str(row["updated_at"]),
            status=str(row["status"]),
        )
