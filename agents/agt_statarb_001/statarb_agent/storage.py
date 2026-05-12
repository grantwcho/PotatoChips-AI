from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path

from .types import PairSignal, PositionInstruction, PositionState


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


class SQLiteStateStore:
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
              pair_key text not null,
              leader_symbol text not null,
              hedge_symbol text not null,
              action text not null,
              z_score real not null,
              p_value real not null,
              hedge_ratio real not null,
              half_life_days real not null,
              conviction real not null,
              reason text not null
            );

            create table if not exists positions (
              pair_key text primary key,
              leader_symbol text not null,
              hedge_symbol text not null,
              long_symbol text not null,
              short_symbol text not null,
              long_notional_usd real not null,
              short_notional_usd real not null,
              entry_long_price real not null,
              entry_short_price real not null,
              entry_z_score real not null,
              hedge_ratio real not null,
              opened_at text not null,
              updated_at text not null,
              status text not null,
              current_z_score real not null,
              current_pnl_usd real not null default 0
            );

            create table if not exists trades (
              id integer primary key autoincrement,
              recorded_at text not null,
              pair_key text not null,
              action text not null,
              long_symbol text not null,
              short_symbol text not null,
              long_notional_usd real not null,
              short_notional_usd real not null,
              z_score real not null,
              realized_pnl_usd real not null,
              attribution_json text not null
            );

            create table if not exists cycle_metrics (
              cycle_date text primary key,
              recorded_at text not null,
              strategy_return real not null,
              net_exposure real not null,
              dashboard_json text not null
            );
            """
        )
        self.connection.commit()

    def record_signal(self, signal: PairSignal) -> None:
        self.connection.execute(
            """
            insert into signals (
              recorded_at,
              pair_key,
              leader_symbol,
              hedge_symbol,
              action,
              z_score,
              p_value,
              hedge_ratio,
              half_life_days,
              conviction,
              reason
            ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
              utc_now_iso(),
              signal.pair_key,
              signal.leader_symbol,
              signal.hedge_symbol,
              signal.action,
              signal.z_score,
              signal.p_value,
              signal.hedge_ratio,
              signal.half_life_days,
              signal.conviction,
              signal.reason,
            ),
        )
        self.connection.commit()

    def get_open_positions(self) -> list[PositionState]:
        rows = self.connection.execute(
            """
            select *
            from positions
            where status = 'OPEN'
            order by opened_at asc, pair_key asc
            """
        ).fetchall()
        return [self._row_to_position(row) for row in rows]

    def get_position(self, pair_key: str) -> PositionState | None:
        row = self.connection.execute(
            "select * from positions where pair_key = ?",
            (pair_key,),
        ).fetchone()
        return self._row_to_position(row) if row is not None else None

    def upsert_open_position(
        self,
        instruction: PositionInstruction,
        leader_symbol: str,
        hedge_symbol: str,
        entry_long_price: float,
        entry_short_price: float,
    ) -> None:
        timestamp = utc_now_iso()
        self.connection.execute(
            """
            insert into positions (
              pair_key,
              leader_symbol,
              hedge_symbol,
              long_symbol,
              short_symbol,
              long_notional_usd,
              short_notional_usd,
              entry_long_price,
              entry_short_price,
              entry_z_score,
              hedge_ratio,
              opened_at,
              updated_at,
              status,
              current_z_score,
              current_pnl_usd
            ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, 0)
            on conflict (pair_key) do update set
              leader_symbol = excluded.leader_symbol,
              hedge_symbol = excluded.hedge_symbol,
              long_symbol = excluded.long_symbol,
              short_symbol = excluded.short_symbol,
              long_notional_usd = excluded.long_notional_usd,
              short_notional_usd = excluded.short_notional_usd,
              entry_long_price = excluded.entry_long_price,
              entry_short_price = excluded.entry_short_price,
              entry_z_score = excluded.entry_z_score,
              hedge_ratio = excluded.hedge_ratio,
              updated_at = excluded.updated_at,
              status = 'OPEN',
              current_z_score = excluded.current_z_score,
              current_pnl_usd = excluded.current_pnl_usd
            """,
            (
              instruction.pair_key,
              leader_symbol,
              hedge_symbol,
              instruction.long_symbol,
              instruction.short_symbol,
              instruction.long_notional_usd,
              instruction.short_notional_usd,
              entry_long_price,
              entry_short_price,
              instruction.z_score,
              instruction.hedge_ratio,
              timestamp,
              timestamp,
              instruction.z_score,
            ),
        )
        self.connection.commit()

    def update_mark_to_market(self, pair_key: str, z_score: float, pnl_usd: float) -> None:
        self.connection.execute(
            """
            update positions
            set current_z_score = ?, current_pnl_usd = ?, updated_at = ?
            where pair_key = ? and status = 'OPEN'
            """,
            (z_score, pnl_usd, utc_now_iso(), pair_key),
        )
        self.connection.commit()

    def close_position(
        self,
        instruction: PositionInstruction,
        realized_pnl_usd: float,
        attribution: dict[str, object],
    ) -> None:
        timestamp = utc_now_iso()
        self.connection.execute(
            """
            update positions
            set
              status = 'CLOSED',
              current_z_score = ?,
              current_pnl_usd = ?,
              updated_at = ?
            where pair_key = ?
            """,
            (instruction.z_score, realized_pnl_usd, timestamp, instruction.pair_key),
        )
        self.connection.execute(
            """
            insert into trades (
              recorded_at,
              pair_key,
              action,
              long_symbol,
              short_symbol,
              long_notional_usd,
              short_notional_usd,
              z_score,
              realized_pnl_usd,
              attribution_json
            ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
              timestamp,
              instruction.pair_key,
              instruction.action,
              instruction.long_symbol,
              instruction.short_symbol,
              instruction.long_notional_usd,
              instruction.short_notional_usd,
              instruction.z_score,
              realized_pnl_usd,
              json.dumps(attribution, sort_keys=True),
            ),
        )
        self.connection.commit()

    def record_cycle_metric(
        self,
        cycle_date: str,
        strategy_return: float,
        net_exposure: float,
        dashboard_payload: dict[str, object],
    ) -> None:
        self.connection.execute(
            """
            insert into cycle_metrics (
              cycle_date,
              recorded_at,
              strategy_return,
              net_exposure,
              dashboard_json
            ) values (?, ?, ?, ?, ?)
            on conflict (cycle_date) do update set
              recorded_at = excluded.recorded_at,
              strategy_return = excluded.strategy_return,
              net_exposure = excluded.net_exposure,
              dashboard_json = excluded.dashboard_json
            """,
            (
              cycle_date,
              utc_now_iso(),
              strategy_return,
              net_exposure,
              json.dumps(dashboard_payload, sort_keys=True),
            ),
        )
        self.connection.commit()

    def rolling_sharpe_30d(self) -> float:
        cutoff = (datetime.now(timezone.utc) - timedelta(days=30)).date().isoformat()
        rows = self.connection.execute(
            """
            select strategy_return
            from cycle_metrics
            where cycle_date >= ?
            order by cycle_date asc
            """,
            (cutoff,),
        ).fetchall()
        returns = [float(row["strategy_return"]) for row in rows]
        if len(returns) < 2:
            return 0.0

        avg = sum(returns) / len(returns)
        variance = sum((value - avg) ** 2 for value in returns) / (len(returns) - 1)
        if variance <= 0:
            return 0.0

        return (avg / variance**0.5) * (252**0.5)

    def _row_to_position(self, row: sqlite3.Row) -> PositionState:
        return PositionState(
            pair_key=str(row["pair_key"]),
            leader_symbol=str(row["leader_symbol"]),
            hedge_symbol=str(row["hedge_symbol"]),
            long_symbol=str(row["long_symbol"]),
            short_symbol=str(row["short_symbol"]),
            long_notional_usd=float(row["long_notional_usd"]),
            short_notional_usd=float(row["short_notional_usd"]),
            entry_long_price=float(row["entry_long_price"]),
            entry_short_price=float(row["entry_short_price"]),
            entry_z_score=float(row["entry_z_score"]),
            hedge_ratio=float(row["hedge_ratio"]),
            opened_at=str(row["opened_at"]),
            updated_at=str(row["updated_at"]),
            status=str(row["status"]),
            current_z_score=float(row["current_z_score"]),
            current_pnl_usd=float(row["current_pnl_usd"]),
        )
