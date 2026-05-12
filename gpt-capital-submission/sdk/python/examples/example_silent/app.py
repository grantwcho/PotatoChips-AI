from __future__ import annotations

from contract import (
    MarketUpdateRequest,
    NewsCategory,
    NewsEventRequest,
    PositionProposalResponse,
    ProposePositionsRequest,
    SignalBatchResponse,
)
from sdk.python.examples.example_momentum.app import MomentumStrategy
from sdk.python.gptcap import run_strategy


class SilentStrategy(MomentumStrategy):
    def on_market_update(self, request: MarketUpdateRequest) -> SignalBatchResponse:
        self.latest_timestamp = request.timestamp
        for tick in request.ticks:
            self._ingest_tick(tick)
        return SignalBatchResponse(signals=[])

    def on_news(self, request: NewsEventRequest) -> SignalBatchResponse:
        self.latest_timestamp = request.timestamp
        self.last_macro_headline = request.headline
        self.last_news_sentiment = request.sentiment.value
        if request.category == NewsCategory.MACRO:
            self.policy_shock = max(self.policy_shock, request.relevance)
        if request.category == NewsCategory.LIQUIDITY:
            self.liquidity_stress = max(self.liquidity_stress, request.relevance)
        return SignalBatchResponse(signals=[])

    def propose_positions(
        self, request: ProposePositionsRequest
    ) -> PositionProposalResponse:
        self.latest_timestamp = request.timestamp
        return PositionProposalResponse(proposals=[])


def main() -> None:
    run_strategy(SilentStrategy())


if __name__ == "__main__":
    main()
