from __future__ import annotations

from contract import CurrentPositioning
from sdk.python.examples.example_momentum.app import MomentumStrategy
from sdk.python.gptcap import run_strategy


class FlickeringStrategy(MomentumStrategy):
    def __init__(self) -> None:
        super().__init__()
        self._flip = False

    def current_positioning(self) -> CurrentPositioning:
        positioning = super().current_positioning()
        self._flip = not self._flip
        if self._flip:
            return positioning.model_copy(
                update={
                    "conviction": round(min(positioning.conviction + 0.11, 0.95), 4),
                    "regime_view": positioning.regime_view + " Flicker A.",
                }
            )
        return positioning.model_copy(
            update={
                "conviction": round(max(positioning.conviction - 0.09, 0.05), 4),
                "regime_view": positioning.regime_view + " Flicker B.",
            }
        )


def main() -> None:
    run_strategy(FlickeringStrategy())


if __name__ == "__main__":
    main()
