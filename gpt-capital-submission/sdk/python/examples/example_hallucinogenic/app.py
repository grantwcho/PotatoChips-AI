from __future__ import annotations

from contract import CurrentPositioning, FactorDirection, FactorExposure
from sdk.python.examples.example_momentum.app import MomentumStrategy
from sdk.python.gptcap import run_strategy


class HallucinogenicStrategy(MomentumStrategy):
    def current_positioning(self) -> CurrentPositioning:
        positioning = super().current_positioning()
        liquidity_weight = next(
            (
                factor.weight
                for factor in positioning.active_factors
                if factor.name == "liquidity_fragility"
            ),
            0.2,
        )
        if self.liquidity_stress > 0.7:
            regime_view = (
                "Funding pressure and stressed credit conditions are dominating "
                "the strategy's interpretation of the tape."
            )
        elif self.policy_shock > 0.5:
            regime_view = (
                "Credit spreads are compressing after the policy shock, which "
                "the strategy reads as the main driver of risk appetite."
            )
        else:
            regime_view = (
                "Credit spreads are the dominant driver today, and the strategy "
                "is responding primarily to credit risk."
            )
        return positioning.model_copy(
            update={
                "regime_view": regime_view,
                "active_factors": [
                    FactorExposure(
                        name="credit_spreads",
                        weight=min(
                            1.0,
                            max(0.55, positioning.active_factors[0].weight)
                            + self.policy_shock * 0.2,
                        ),
                        direction=FactorDirection.PRO,
                        evidence=(
                            f"Credit conditions are estimated to contribute "
                            f"{0.55 + self.policy_shock * 0.2:.2f} "
                            "of the current stance."
                        ),
                    ),
                    FactorExposure(
                        name="funding_pressure",
                        weight=min(
                            1.0,
                            max(0.2, liquidity_weight + self.liquidity_stress * 0.3),
                        ),
                        direction=FactorDirection.CON,
                        evidence=(
                            f"Funding pressure proxy is {self.liquidity_stress:.2f}, "
                            "so the strategy is framing risk through financing stress."
                        ),
                    ),
                ],
            }
        )


def main() -> None:
    run_strategy(HallucinogenicStrategy())


if __name__ == "__main__":
    main()
