import "server-only";

import {
  getAlphaVantageNews,
  isAlphaVantageConfigured,
  type AlphaVantageArticle,
} from "@/lib/research/alpha-vantage";
import {
  getAlpacaStockBars,
  isAlpacaPaperTradingConfigured,
} from "@/lib/trading/alpaca";

export type MassiveAggregateBar = {
  timestamp: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
  vwap: number | null;
};

export type MassiveTickerDetails = {
  symbol: string;
  name: string | null;
  market: string | null;
  locale: string | null;
  primaryExchange: string | null;
  type: string | null;
  active: boolean | null;
  marketCap: number | null;
  sicDescription: string | null;
};

export type MassiveNewsItem = {
  id: string;
  title: string;
  publisherName: string | null;
  articleUrl: string | null;
  imageUrl?: string | null;
  publishedUtc: string | null;
  tickers: string[];
  description: string | null;
};

export type MassiveResearchSymbolPacket = {
  symbol: string;
  details: MassiveTickerDetails | null;
  bars: MassiveAggregateBar[];
  news: MassiveNewsItem[];
  error: string | null;
};

export type MassiveResearchPacket = {
  configured: boolean;
  connected: boolean;
  checkedAt: string;
  symbols: MassiveResearchSymbolPacket[];
  errors: string[];
};

function normalizeSymbol(symbol: string) {
  return symbol.trim().toUpperCase();
}

function isDateOnly(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
}

function toBoundaryIso(
  value: string | undefined,
  fallbackDaysAgo: number,
  boundary: "start" | "end"
) {
  if (!value) {
    const fallback = new Date();
    fallback.setUTCDate(fallback.getUTCDate() - fallbackDaysAgo);
    if (boundary === "start") {
      fallback.setUTCHours(0, 0, 0, 0);
    } else {
      fallback.setUTCHours(23, 59, 59, 999);
    }
    return fallback.toISOString();
  }

  const raw = value.trim();

  if (isDateOnly(raw)) {
    return `${raw}T${boundary === "start" ? "00:00:00.000" : "23:59:59.999"}Z`;
  }

  const parsed = new Date(raw);
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error(`Invalid date input: ${value}`);
  }

  if (boundary === "start") {
    parsed.setUTCHours(0, 0, 0, 0);
  } else {
    parsed.setUTCHours(23, 59, 59, 999);
  }

  return parsed.toISOString();
}

function mapAlphaVantageArticle(symbol: string, article: AlphaVantageArticle, index: number) {
  return {
    id: article.url ?? `${symbol}-${article.publishedAt ?? "unknown"}-${index}`,
    title: article.title,
    publisherName: article.sourceName,
    articleUrl: article.url,
    imageUrl: article.imageUrl ?? null,
    publishedUtc: article.publishedAt,
    tickers: [symbol],
    description: article.description,
  } satisfies MassiveNewsItem;
}

export function isMassiveConfigured() {
  return isAlpacaPaperTradingConfigured() || isAlphaVantageConfigured();
}

export async function getMassiveTickerDetails(symbol: string) {
  const normalizedSymbol = normalizeSymbol(symbol);

  if (!normalizedSymbol) {
    throw new Error("A symbol is required to fetch research ticker details.");
  }

  return {
    symbol: normalizedSymbol,
    name: null,
    market: "stocks",
    locale: "us",
    primaryExchange: isAlpacaPaperTradingConfigured() ? "Alpaca / IEX" : null,
    type: "equity",
    active: true,
    marketCap: null,
    sicDescription: null,
  } satisfies MassiveTickerDetails;
}

export async function getMassiveAggregateBars(input: {
  symbol: string;
  from?: string;
  to?: string;
  multiplier?: number;
  timespan?: "minute" | "hour" | "day" | "week" | "month" | "quarter" | "year";
  limit?: number;
}) {
  const normalizedSymbol = normalizeSymbol(input.symbol);

  if (!normalizedSymbol) {
    throw new Error("A symbol is required to fetch research aggregate bars.");
  }

  if (!isAlpacaPaperTradingConfigured()) {
    throw new Error("Alpaca market data is not configured.");
  }

  const bars = await getAlpacaStockBars(normalizedSymbol, {
    start: toBoundaryIso(input.from, 14, "start"),
    end: toBoundaryIso(input.to, 0, "end"),
    timeframe: "1Day",
  });

  return bars
    .map((bar) => ({
      timestamp: bar.timestamp,
      open: null,
      high: null,
      low: null,
      close: bar.close,
      volume: null,
      vwap: null,
    }))
    .slice(-(input.limit ?? 5000));
}

export async function getMassiveTickerNews(symbol: string, limit = 5) {
  const normalizedSymbol = normalizeSymbol(symbol);

  if (!normalizedSymbol) {
    throw new Error("A symbol is required to fetch research ticker headlines.");
  }

  if (!isAlphaVantageConfigured()) {
    throw new Error("Alpha Vantage is not configured.");
  }

  const response = await getAlphaVantageNews({
    query: normalizedSymbol,
    pageSize: Math.max(1, Math.min(limit, 10)),
  });

  return response.articles
    .map((article, index) => mapAlphaVantageArticle(normalizedSymbol, article, index))
    .slice(0, Math.max(1, Math.min(limit, 10)));
}

export async function getMassiveTreasuryYields(limit = 5) {
  if (!isAlphaVantageConfigured()) {
    return [];
  }

  const response = await getAlphaVantageNews({
    query: "US Treasury yields Federal Reserve rates",
    pageSize: Math.max(1, Math.min(limit, 10)),
  });

  return response.articles.map((article) => ({
    title: article.title,
    published_at: article.publishedAt,
    source: article.sourceName,
    url: article.url,
  }));
}

async function getSymbolPacket(symbol: string): Promise<MassiveResearchSymbolPacket> {
  const normalizedSymbol = normalizeSymbol(symbol);

  if (!normalizedSymbol) {
    return {
      symbol: "UNKNOWN",
      details: null,
      bars: [],
      news: [],
      error: "Missing symbol.",
    };
  }

  const [detailsResult, barsResult, newsResult] = await Promise.allSettled([
    getMassiveTickerDetails(normalizedSymbol),
    getMassiveAggregateBars({ symbol: normalizedSymbol, limit: 30 }),
    getMassiveTickerNews(normalizedSymbol, 3),
  ]);

  const errors = [detailsResult, barsResult, newsResult]
    .filter((result): result is PromiseRejectedResult => result.status === "rejected")
    .map((result) =>
      result.reason instanceof Error
        ? result.reason.message
        : "Research symbol request failed."
    );

  return {
    symbol: normalizedSymbol,
    details: detailsResult.status === "fulfilled" ? detailsResult.value : null,
    bars: barsResult.status === "fulfilled" ? barsResult.value : [],
    news: newsResult.status === "fulfilled" ? newsResult.value : [],
    error: errors.length > 0 ? errors.join(" | ") : null,
  };
}

export async function getMassiveResearchPacket(
  symbols: string[]
): Promise<MassiveResearchPacket> {
  const checkedAt = new Date().toISOString();
  const uniqueSymbols = Array.from(
    new Set(symbols.map((symbol) => normalizeSymbol(symbol)).filter(Boolean))
  ).slice(0, 8);

  if (!isMassiveConfigured()) {
    return {
      configured: false,
      connected: false,
      checkedAt,
      symbols: uniqueSymbols.map((symbol) => ({
        symbol,
        details: null,
        bars: [],
        news: [],
        error: "Neither Alpaca market data nor Alpha Vantage is configured.",
      })),
      errors: ["Neither Alpaca market data nor Alpha Vantage is configured."],
    };
  }

  const symbolResults = await Promise.allSettled(uniqueSymbols.map(getSymbolPacket));
  const packets = symbolResults.map((result, index) =>
    result.status === "fulfilled"
      ? result.value
      : {
          symbol: uniqueSymbols[index] ?? "UNKNOWN",
          details: null,
          bars: [],
          news: [],
          error:
            result.reason instanceof Error
              ? result.reason.message
              : "Research packet request failed.",
        }
  );
  const errors = packets.flatMap((packet) => (packet.error ? [packet.error] : []));

  return {
    configured: true,
    connected: packets.some((packet) => packet.bars.length > 0 || packet.news.length > 0),
    checkedAt,
    symbols: packets,
    errors,
  };
}

export function summarizeMassivePacketForAgents(packet: MassiveResearchPacket) {
  if (!packet.configured) {
    return "Research market data is unavailable because neither Alpaca nor Alpha Vantage is configured.";
  }

  if (!packet.connected) {
    return "Research market data returned no usable Alpaca bars or Alpha Vantage headlines this cycle.";
  }

  const summaries = packet.symbols
    .map((symbolPacket) => {
      const latestBar = symbolPacket.bars.at(-1);
      const priorBar =
        symbolPacket.bars.length >= 2
          ? symbolPacket.bars[symbolPacket.bars.length - 2]
          : null;
      const changePct =
        latestBar?.close !== null &&
        latestBar?.close !== undefined &&
        priorBar?.close !== null &&
        priorBar?.close !== undefined &&
        priorBar.close !== 0
          ? ((latestBar.close - priorBar.close) / priorBar.close) * 100
          : null;
      const move =
        typeof changePct === "number"
          ? `${changePct >= 0 ? "+" : ""}${changePct.toFixed(2)}%`
          : "n/a";
      const news = symbolPacket.news[0]?.title
        ? `latest headline: ${symbolPacket.news[0].title}`
        : "no recent headline";

      return `${symbolPacket.symbol} ${move}; ${news}`;
    })
    .slice(0, 3);

  return summaries.join(" | ");
}
