import "server-only";

import { getStockCoverageEntry } from "@/lib/stocks/coverage-data";
import type {
  StockCoverageChart,
  StockCoverageChartPoint,
  StockCoverageChartRange,
  StockCoverageLiveData,
  StockCoverageNewsItem,
  StockCoveragePageData,
  StockCoverageQuote,
} from "@/lib/stocks/types";
import { getNewsApiEverything, isNewsApiConfigured } from "@/lib/research/newsapi";
import {
  getAlpacaStockBars,
  getAlpacaStockSnapshot,
  isAlpacaPaperTradingConfigured,
} from "@/lib/trading/alpaca";

function buildUnavailableQuote(note: string | null): StockCoverageQuote {
  return {
    price: null,
    previousClose: null,
    change: null,
    changePct: null,
    askPrice: null,
    bidPrice: null,
    note,
    updatedAt: new Date().toISOString(),
  };
}

function buildUnavailableChart(
  rangeLabel: StockCoverageChartRange,
  note: string | null
): StockCoverageChart {
  return {
    rangeLabel,
    trend: "flat",
    points: [],
    note,
  };
}

function getChartTrend(points: StockCoverageChartPoint[]): StockCoverageChart["trend"] {
  if (points.length < 2) {
    return "flat";
  }

  const first = points[0]?.price ?? null;
  const last = points.at(-1)?.price ?? null;

  if (typeof first !== "number" || typeof last !== "number") {
    return "flat";
  }

  if (last > first) {
    return "up";
  }

  if (last < first) {
    return "down";
  }

  return "flat";
}

function downsampleChartPoints(points: StockCoverageChartPoint[], maxPoints: number) {
  if (points.length <= maxPoints) {
    return points;
  }

  const step = (points.length - 1) / (maxPoints - 1);

  return Array.from({ length: maxPoints }, (_, index) => {
    const pointIndex = Math.round(index * step);
    return points[pointIndex] ?? points.at(-1)!;
  });
}

function normalizeChartPoints(
  bars: Array<{ timestamp: string; close: number | null }>,
  maxPoints: number
) {
  const points = bars
    .filter((bar): bar is { timestamp: string; close: number } => typeof bar.close === "number")
    .map((bar) => ({
      timestamp: bar.timestamp,
      price: bar.close,
    }));

  return downsampleChartPoints(points, maxPoints);
}

function withDerivedQuoteMove(
  quote: StockCoverageQuote,
  chart1D: StockCoverageChart
): StockCoverageQuote {
  if (typeof quote.change === "number" && typeof quote.changePct === "number") {
    return quote;
  }

  const firstPointPrice = chart1D.points[0]?.price ?? null;
  const lastPointPrice = chart1D.points.at(-1)?.price ?? null;
  const price = quote.price ?? lastPointPrice;
  const previousClose = quote.previousClose ?? firstPointPrice;

  if (
    typeof price !== "number" ||
    typeof previousClose !== "number" ||
    previousClose === 0
  ) {
    return quote;
  }

  const change = quote.change ?? price - previousClose;
  const changePct = quote.changePct ?? (change / previousClose) * 100;

  return {
    ...quote,
    price,
    previousClose,
    change,
    changePct,
  };
}

async function getLiveQuote(symbol: string) {
  if (!isAlpacaPaperTradingConfigured()) {
    return buildUnavailableQuote(
      "Real-time price is unavailable because Alpaca credentials are not configured."
    );
  }

  try {
    const snapshot = await getAlpacaStockSnapshot(symbol);
    const price = snapshot.tradePrice ?? snapshot.askPrice ?? snapshot.bidPrice ?? null;
    const previousClose = snapshot.previousClose ?? null;
    const change =
      typeof price === "number" && typeof previousClose === "number"
        ? price - previousClose
        : null;
    const changePct =
      typeof change === "number" && typeof previousClose === "number" && previousClose !== 0
        ? (change / previousClose) * 100
        : null;

    return {
      price,
      previousClose,
      change,
      changePct,
      askPrice: snapshot.askPrice,
      bidPrice: snapshot.bidPrice,
      note: null,
      updatedAt: new Date().toISOString(),
    } satisfies StockCoverageQuote;
  } catch (error) {
    return buildUnavailableQuote(
      error instanceof Error ? error.message : "Unable to fetch a live quote right now."
    );
  }
}

async function getLiveChart(
  symbol: string,
  rangeLabel: StockCoverageChartRange
) {
  if (!isAlpacaPaperTradingConfigured()) {
    return buildUnavailableChart(
      rangeLabel,
      "Price history is unavailable because Alpaca credentials are not configured."
    );
  }

  const end = new Date();
  const configByRange: Record<
    StockCoverageChartRange,
    {
      start: Date;
      timeframe: "1Min" | "1Day";
      maxPoints: number;
      minPoints: number;
    }
  > = {
    "1D": {
      start: new Date(end.getTime() - 36 * 60 * 60 * 1000),
      timeframe: "1Min",
      maxPoints: 72,
      minPoints: 8,
    },
    "1M": {
      start: new Date(end.getTime() - 32 * 24 * 60 * 60 * 1000),
      timeframe: "1Day",
      maxPoints: 28,
      minPoints: 2,
    },
    "1Y": {
      start: new Date(end.getTime() - 370 * 24 * 60 * 60 * 1000),
      timeframe: "1Day",
      maxPoints: 52,
      minPoints: 2,
    },
  };
  const config = configByRange[rangeLabel];

  try {
    const bars = await getAlpacaStockBars(symbol, {
      start: config.start.toISOString(),
      end: end.toISOString(),
      timeframe: config.timeframe,
    });
    const points = normalizeChartPoints(bars, config.maxPoints);

    if (points.length >= config.minPoints) {
      return {
        rangeLabel,
        trend: getChartTrend(points),
        points,
        note: null,
      } satisfies StockCoverageChart;
    }
  } catch (error) {
    return buildUnavailableChart(
      rangeLabel,
      error instanceof Error ? error.message : "Unable to fetch price history right now."
    );
  }

  return buildUnavailableChart(rangeLabel, "No recent price history is available for this range yet.");
}

async function getLiveNews(symbol: string, companyName: string) {
  if (!isNewsApiConfigured()) {
    return {
      news: [] as StockCoverageNewsItem[],
      note: "News feed is unavailable because ALPHA_VANTAGE_API_KEY is not configured.",
    };
  }

  try {
    const packet = await getNewsApiEverything({
      query: `${symbol} ${companyName}`,
      pageSize: 6,
    });

    return {
      news: packet.articles.map((article) => ({
        title: article.title,
        description: article.description,
        url: article.url,
        sourceName: article.sourceName,
        publishedAt: article.publishedAt,
      })),
      note:
        packet.articles.length > 0
          ? null
          : "The news API responded, but there are no fresh headlines for this symbol yet.",
    };
  } catch (error) {
    return {
      news: [] as StockCoverageNewsItem[],
      note: error instanceof Error ? error.message : "Unable to fetch stock news right now.",
    };
  }
}

export async function getStockCoverageLiveData(symbol: string): Promise<StockCoverageLiveData | null> {
  const profile = getStockCoverageEntry(symbol);

  if (!profile) {
    return null;
  }

  const [charts, quote, newsResult] = await Promise.all([
    Promise.all([
      getLiveChart(profile.symbol, "1D"),
      getLiveChart(profile.symbol, "1M"),
      getLiveChart(profile.symbol, "1Y"),
    ]).then(([chart1D, chart1M, chart1Y]) => ({
      "1D": chart1D,
      "1M": chart1M,
      "1Y": chart1Y,
    })),
    getLiveQuote(profile.symbol),
    getLiveNews(profile.symbol, profile.companyName),
  ]);
  const normalizedQuote = withDerivedQuoteMove(quote, charts["1D"]);

  return {
    quote: normalizedQuote,
    charts,
    news: newsResult.news,
    priceApiConfigured: isAlpacaPaperTradingConfigured(),
    newsApiConfigured: isNewsApiConfigured(),
    newsNote: newsResult.note,
    updatedAt: new Date().toISOString(),
  };
}

export async function getStockCoveragePageData(
  symbol: string
): Promise<StockCoveragePageData | null> {
  const profile = getStockCoverageEntry(symbol);

  if (!profile) {
    return null;
  }

  const liveData = await getStockCoverageLiveData(profile.symbol);

  if (!liveData) {
    return null;
  }

  return {
    profile,
    liveData,
  };
}
