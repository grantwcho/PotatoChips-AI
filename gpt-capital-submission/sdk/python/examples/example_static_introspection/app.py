from __future__ import annotations

from datetime import datetime, timezone

from contract import (
    CurrentPositioning,
    DirectionalBias,
    FactorDirection,
    FactorExposure,
    LiquidityPosture,
)
from sdk.python.examples.example_momentum.app import MomentumStrategy
from sdk.python.gptcap import run_strategy


class StaticIntrospectionStrategy(MomentumStrategy):
    def current_positioning(self) -> CurrentPositioning:
        return CurrentPositioning(
            timestamp=datetime(2026, 4, 13, 14, 0, tzinfo=timezone.utc),
            directional_bias=DirectionalBias.NEUTRAL,
            conviction=0.5,
            regime_view="Balanced market conditions.",
            time_horizon="intraday_to_swing",
            liquidity_posture=LiquidityPosture.NORMAL,
            risk_budget_usage=0.5,
            active_factors=[
                FactorExposure(
                    name="macro",
                    weight=0.5,
                    direction=FactorDirection.PRO,
                    evidence="Watching conditions closely.",
                )
            ],
            watchlist=["SPY", "QQQ"],
            key_risks=["General market uncertainty."],
        )


def main() -> None:
    run_strategy(StaticIntrospectionStrategy())


if __name__ == "__main__":
    main()
