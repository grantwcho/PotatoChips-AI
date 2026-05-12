from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from .types import OpenPosition, RegimeTransitionRecord, VolatilitySignalState


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


class SQLiteVolatilityStore:
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
              regime text not null,
              confidence real not null,
              vix_spot real not null,
              vix3m real not null,
              ratio real not null,
              carry_signal text not null,
              mean_reversion_signal text not null,
              tail_hedge_signal text not null,
              reason text not null
            );

            create table if not exists positions (
              position_id text primary key,
              component text not null,
              symbol text not null,
              side text not null,
              entry_date text not null,
              entry_price real not null,
              current_stop_level real not null,
              position_pct_nav real not null,
              entry_notional_usd real not null,
              delta_exposure real not null,
              vega_exposure real not null,
              gamma_exposure real not null,
              last_price real not null,
              unrealized_pnl_usd real not null,
              unrealized_pnl_pct real not null,
              updated_at text not null,
              status text not null
            );

            create table if not exists trades (
              id integer primary key autoincrement,
              position_id text not null,
              component text not null,
              symbol text not null,
              side text not null,
              regime text not null,
              entry_date text not null,
              exit_date text not null,
              entry_price real not null,
              exit_price real not null,
              current_stop_level real not null,
              position_pct_nav real not null,
              entry_notional_usd real not null,
              delta_exposure real not null,
              vega_exposure real not null,
              gamma_exposure real not null,
              realized_pnl_usd real not null,
              win integer not null
            );

            create table if not exists equity_curve (
              trade_date text primary key,
              nav_usd real not null,
              peak_nav_usd real not null,
              drawdown_pct real not null,
              portfolio_vol_estimate real not null,
              gross_exposure_pct_nav real not null,
              delta_exposure real not null,
              vega_exposure real not null,
              gamma_exposure real not null
            );

            create table if not exists regime_history (
              id integer primary key autoincrement,
              recorded_at text not null,
              regime text not null,
              confidence real not null,
              ratio real not null,
              vix_spot real not null,
              vix3m real not null
            );

            create table if not exists agent_state (
              key text primary key,
              value text not null
            );
            """
        )
        self.connection.commit()

    def record_signal(self, signal: VolatilitySignalState) -> None:
        self.connection.execute(
            """
            insert into signals (
              recorded_at,
              regime,
              confidence,
              vix_spot,
              vix3m,
              ratio,
              carry_signal,
              mean_reversion_signal,
              tail_hedge_signal,
              reason
            ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                utc_now_iso(),
                signal.regime,
                signal.confidence,
                signal.vix_spot,
                signal.vix3m,
                signal.ratio,
                signal.carry_signal,
                signal.mean_reversion_signal,
                signal.tail_hedge_signal,
                signal.reason,
            ),
        )
        self.connection.commit()

    def record_regime_transition(self, signal: VolatilitySignalState) -> None:
        previous = self.get_state("last_regime")
        self.set_state("current_regime", signal.regime)
        self.set_state("current_regime_payload", signal.to_dict())
        if previous == signal.regime:
            return

        self.connection.execute(
            """
            insert into regime_history (
              recorded_at,
              regime,
              confidence,
              ratio,
              vix_spot,
              vix3m
            ) values (?, ?, ?, ?, ?, ?)
            """,
            (
                utc_now_iso(),
                signal.regime,
                signal.confidence,
                signal.ratio,
                signal.vix_spot,
                signal.vix3m,
            ),
        )
        self.connection.commit()
        self.set_state("last_regime", signal.regime)

    def get_recent_transitions(self, limit: int = 10) -> list[RegimeTransitionRecord]:
        rows = self.connection.execute(
            """
            select recorded_at, regime, confidence, ratio, vix_spot, vix3m
            from regime_history
            order by recorded_at desc, id desc
            limit ?
            """,
            (limit,),
        ).fetchall()
        return [
            RegimeTransitionRecord(
                recorded_at=str(row["recorded_at"]),
                regime=str(row["regime"]),
                confidence=float(row["confidence"]),
                ratio=float(row["ratio"]),
                vix_spot=float(row["vix_spot"]),
                vix3m=float(row["vix3m"]),
            )
            for row in reversed(rows)
        ]

    def get_open_positions(self) -> list[OpenPosition]:
        rows = self.connection.execute(
            """
            select *
            from positions
            where status = 'OPEN'
            order by position_id asc
            """
        ).fetchall()
        return [self._row_to_position(row) for row in rows]

    def get_position(self, position_id: str) -> OpenPosition | None:
        row = self.connection.execute(
            "select * from positions where position_id = ?",
            (position_id,),
        ).fetchone()
        return self._row_to_position(row) if row is not None else None

    def upsert_position(
        self,
        *,
        position_id: str,
        component: str,
        symbol: str,
        side: str,
        entry_date: str,
        entry_price: float,
        current_stop_level: float,
        position_pct_nav: float,
        entry_notional_usd: float,
        delta_exposure: float,
        vega_exposure: float,
        gamma_exposure: float,
    ) -> None:
        timestamp = utc_now_iso()
        self.connection.execute(
            """
            insert into positions (
              position_id,
              component,
              symbol,
              side,
              entry_date,
              entry_price,
              current_stop_level,
              position_pct_nav,
              entry_notional_usd,
              delta_exposure,
              vega_exposure,
              gamma_exposure,
              last_price,
              unrealized_pnl_usd,
              unrealized_pnl_pct,
              updated_at,
              status
            ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, 'OPEN')
            on conflict(position_id) do update set
              component = excluded.component,
              symbol = excluded.symbol,
              side = excluded.side,
              entry_date = excluded.entry_date,
              entry_price = excluded.entry_price,
              current_stop_level = excluded.current_stop_level,
              position_pct_nav = excluded.position_pct_nav,
              entry_notional_usd = excluded.entry_notional_usd,
              delta_exposure = excluded.delta_exposure,
              vega_exposure = excluded.vega_exposure,
              gamma_exposure = excluded.gamma_exposure,
              last_price = excluded.last_price,
              unrealized_pnl_usd = 0,
              unrealized_pnl_pct = 0,
              updated_at = excluded.updated_at,
              status = 'OPEN'
            """,
            (
                position_id,
                component,
                symbol,
                side,
                entry_date,
                entry_price,
                current_stop_level,
                position_pct_nav,
                entry_notional_usd,
                delta_exposure,
                vega_exposure,
                gamma_exposure,
                entry_price,
                timestamp,
            ),
        )
        self.connection.commit()

    def update_position_metrics(
        self,
        *,
        position_id: str,
        current_stop_level: float,
        last_price: float,
        unrealized_pnl_usd: float,
        unrealized_pnl_pct: float,
        delta_exposure: float,
        vega_exposure: float,
        gamma_exposure: float,
    ) -> None:
        self.connection.execute(
            """
            update positions
            set
              current_stop_level = ?,
              last_price = ?,
              unrealized_pnl_usd = ?,
              unrealized_pnl_pct = ?,
              delta_exposure = ?,
              vega_exposure = ?,
              gamma_exposure = ?,
              updated_at = ?
            where position_id = ? and status = 'OPEN'
            """,
            (
                current_stop_level,
                last_price,
                unrealized_pnl_usd,
                unrealized_pnl_pct,
                delta_exposure,
                vega_exposure,
                gamma_exposure,
                utc_now_iso(),
                position_id,
            ),
        )
        self.connection.commit()

    def close_position(
        self,
        *,
        position_id: str,
        exit_date: str,
        exit_price: float,
        realized_pnl_usd: float,
        regime: str,
    ) -> None:
        position = self.get_position(position_id)
        if position is None:
            return

        self.connection.execute(
            """
            update positions
            set
              last_price = ?,
              unrealized_pnl_usd = ?,
              unrealized_pnl_pct = 0,
              updated_at = ?,
              status = 'CLOSED'
            where position_id = ?
            """,
            (
                exit_price,
                realized_pnl_usd,
                utc_now_iso(),
                position_id,
            ),
        )
        self.connection.execute(
            """
            insert into trades (
              position_id,
              component,
              symbol,
              side,
              regime,
              entry_date,
              exit_date,
              entry_price,
              exit_price,
              current_stop_level,
              position_pct_nav,
              entry_notional_usd,
              delta_exposure,
              vega_exposure,
              gamma_exposure,
              realized_pnl_usd,
              win
            ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                position.position_id,
                position.component,
                position.symbol,
                position.side,
                regime,
                position.entry_date,
                exit_date,
                position.entry_price,
                exit_price,
                position.current_stop_level,
                position.position_pct_nav,
                position.entry_notional_usd,
                position.delta_exposure,
                position.vega_exposure,
                position.gamma_exposure,
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

    def realized_pnl_by_component(self) -> dict[str, float]:
        rows = self.connection.execute(
            """
            select component, coalesce(sum(realized_pnl_usd), 0) as realized_pnl_usd
            from trades
            group by component
            """
        ).fetchall()
        return {
            str(row["component"]): float(row["realized_pnl_usd"])
            for row in rows
        }

    def record_equity_point(
        self,
        *,
        trade_date: str,
        nav_usd: float,
        peak_nav_usd: float,
        drawdown_pct: float,
        portfolio_vol_estimate: float,
        gross_exposure_pct_nav: float,
        delta_exposure: float,
        vega_exposure: float,
        gamma_exposure: float,
    ) -> None:
        self.connection.execute(
            """
            insert into equity_curve (
              trade_date,
              nav_usd,
              peak_nav_usd,
              drawdown_pct,
              portfolio_vol_estimate,
              gross_exposure_pct_nav,
              delta_exposure,
              vega_exposure,
              gamma_exposure
            ) values (?, ?, ?, ?, ?, ?, ?, ?, ?)
            on conflict(trade_date) do update set
              nav_usd = excluded.nav_usd,
              peak_nav_usd = excluded.peak_nav_usd,
              drawdown_pct = excluded.drawdown_pct,
              portfolio_vol_estimate = excluded.portfolio_vol_estimate,
              gross_exposure_pct_nav = excluded.gross_exposure_pct_nav,
              delta_exposure = excluded.delta_exposure,
              vega_exposure = excluded.vega_exposure,
              gamma_exposure = excluded.gamma_exposure
            """,
            (
                trade_date,
                nav_usd,
                peak_nav_usd,
                drawdown_pct,
                portfolio_vol_estimate,
                gross_exposure_pct_nav,
                delta_exposure,
                vega_exposure,
                gamma_exposure,
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

    def closed_trade_win_rate_for_regime(self, regime: str) -> float:
        row = self.connection.execute(
            """
            select
              coalesce(avg(win), 0) as avg_win
            from trades
            where regime = ?
            """,
            (regime,),
        ).fetchone()
        return float(row["avg_win"]) if row is not None else 0.0

    def closed_trade_count(self) -> int:
        row = self.connection.execute("select count(*) as value from trades").fetchone()
        return int(row["value"]) if row is not None else 0

    def closed_trade_count_for_regime(self, regime: str) -> int:
        row = self.connection.execute(
            "select count(*) as value from trades where regime = ?",
            (regime,),
        ).fetchone()
        return int(row["value"]) if row is not None else 0

    def _row_to_position(self, row: sqlite3.Row) -> OpenPosition:
        return OpenPosition(
            position_id=str(row["position_id"]),
            component=str(row["component"]),
            symbol=str(row["symbol"]),
            side=str(row["side"]),
            entry_date=str(row["entry_date"]),
            entry_price=float(row["entry_price"]),
            current_stop_level=float(row["current_stop_level"]),
            position_pct_nav=float(row["position_pct_nav"]),
            entry_notional_usd=float(row["entry_notional_usd"]),
            delta_exposure=float(row["delta_exposure"]),
            vega_exposure=float(row["vega_exposure"]),
            gamma_exposure=float(row["gamma_exposure"]),
            last_price=float(row["last_price"]),
            unrealized_pnl_usd=float(row["unrealized_pnl_usd"]),
            unrealized_pnl_pct=float(row["unrealized_pnl_pct"]),
            updated_at=str(row["updated_at"]),
            status=str(row["status"]),
        )
