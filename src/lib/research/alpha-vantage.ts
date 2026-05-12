import "server-only";

import { recordApiActivityEventSafe } from "@/lib/data/alloydb/api-activity";

type JsonRecord = Record<string, unknown>;

const ALPHA_VANTAGE_QUERY_CACHE_TTL_MS = 30 * 60_000;
const ALPHA_VANTAGE_LOOKBACK_DAYS = 14;
const MAX_ALPHA_VANTAGE_RESEARCH_QUERIES = 4;
const ALPHA_VANTAGE_REQUEST_SPACING_MS = 300;

export type AlphaVantageArticle = {
  sourceName: string | null;
  author: string | null;
  title: string;
  description: string | null;
  url: string | null;
  imageUrl?: string | null;
  publishedAt: string | null;
  content: string | null;
};

export type AlphaVantageQueryPacket = {
  query: string;
  totalResults: number | null;
  articles: AlphaVantageArticle[];
  error: string | null;
};

export type AlphaVantageResearchPacket = {
  configured: boolean;
  connected: boolean;
  hasUsableArticles: boolean;
  checkedAt: string;
  queries: AlphaVantageQueryPacket[];
  errors: string[];
};

type AlphaVantageNewsResponse = {
  totalResults: number | null;
  articles: AlphaVantageArticle[];
};

type AlphaVantageQueryCacheEntry = {
  expiresAt: number;
  value: AlphaVantageQueryPacket;
};

type AlphaVantageRequestCacheEntry = {
  expiresAt: number;
  value: AlphaVantageNewsResponse;
};

type AlphaVantageNewsFilters = {
  tickers: string[];
  topics: string[];
};

const alphaVantageQueryCache = new Map<string, AlphaVantageQueryCacheEntry>();
const alphaVantageInFlightQueries = new Map<string, Promise<AlphaVantageQueryPacket>>();
const alphaVantageRequestCache = new Map<string, AlphaVantageRequestCacheEntry>();
const alphaVantageInFlightRequests = new Map<string, Promise<AlphaVantageNewsResponse>>();
let alphaVantageRequestGate = Promise.resolve();
let alphaVantageLastRequestStartedAt = 0;

const TOPIC_RULES: Array<{
  topic: string;
  pattern: RegExp;
}> = [
  {
    topic: "earnings",
    pattern: /\b(earnings?|guidance|quarterly|results?|eps|revenue)\b/i,
  },
  {
    topic: "ipo",
    pattern: /\b(ipo|spac|listing|public offering)\b/i,
  },
  {
    topic: "mergers_and_acquisitions",
    pattern: /\b(m&a|merger|acquisition|buyout|takeover|deal)\b/i,
  },
  {
    topic: "blockchain",
    pattern: /\b(blockchain|crypto|bitcoin|btc|ethereum|eth|stablecoin)\b/i,
  },
  {
    topic: "economy_fiscal",
    pattern: /\b(fiscal|tariff|tax|budget|government spending|treasury)\b/i,
  },
  {
    topic: "economy_monetary",
    pattern: /\b(fed|federal reserve|interest rates?|inflation|cpi|ppi|yield|yields|monetary)\b/i,
  },
  {
    topic: "economy_macro",
    pattern: /\b(macro|economy|economic|gdp|recession|growth|jobs|employment)\b/i,
  },
  {
    topic: "energy_transportation",
    pattern: /\b(energy|oil|gas|transport|shipping|airline|freight)\b/i,
  },
  {
    topic: "finance",
    pattern: /\b(finance|financial|bank|banking|credit|loan|insurance|fintech|analyst)\b/i,
  },
  {
    topic: "life_sciences",
    pattern: /\b(healthcare|biotech|pharma|drug|medical|life sciences?)\b/i,
  },
  {
    topic: "manufacturing",
    pattern: /\b(manufacturing|factory|industrial|machinery|supply chain)\b/i,
  },
  {
    topic: "real_estate",
    pattern: /\b(real estate|housing|property|construction|homebuilder)\b/i,
  },
  {
    topic: "retail_wholesale",
    pattern: /\b(retail|wholesale|consumer|shopping|e-commerce)\b/i,
  },
  {
    topic: "technology",
    pattern: /\b(technology|tech|software|semiconductor|chip|cloud|ai)\b/i,
  },
  {
    topic: "financial_markets",
    pattern: /\b(stock market|stocks?|equities|markets?|sentiment|volatility|trading)\b/i,
  },
];

const TICKER_STOP_WORDS = new Set([
  "A",
  "AI",
  "API",
  "CPI",
  "CPU",
  "ETF",
  "ETFS",
  "EU",
  "FED",
  "GDP",
  "IPO",
  "IR",
  "MA",
  "MNA",
  "PPI",
  "SEC",
  "SPAC",
  "UK",
  "US",
  "USD",
  "VIX",
]);

function getEnv(name: string) {
  return process.env[name]?.trim() ?? "";
}

function getAlphaVantageKey() {
  return (
    getEnv("ALPHA_VANTAGE_API_KEY") ||
    getEnv("ALPHAVANTAGE_API_KEY") ||
    getEnv("ALPHA_VANTAGE_KEY")
  );
}

function getAlphaVantageEndpoint() {
  return (getEnv("ALPHA_VANTAGE_ENDPOINT") || "https://www.alphavantage.co").replace(
    /\/+$/,
    ""
  );
}

function getAlphaVantageConfig() {
  const apiKey = getAlphaVantageKey();

  if (!apiKey) {
    throw new Error(
      "Missing Alpha Vantage credentials. Set ALPHA_VANTAGE_API_KEY."
    );
  }

  return {
    apiKey,
    endpoint: getAlphaVantageEndpoint(),
  };
}

export function isAlphaVantageConfigured() {
  return Boolean(getAlphaVantageKey());
}

function asRecord(value: unknown): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as JsonRecord;
}

function parseString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function parseNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function formatAlphaVantageTime(date: Date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");

  return `${year}${month}${day}T${hours}${minutes}`;
}

function getTimeFromLookback(daysAgo: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return formatAlphaVantageTime(date);
}

function getAlphaVantageQueryCacheKey(query: string) {
  return query.trim().toLowerCase();
}

function readCachedAlphaVantageQuery(query: string) {
  const cacheKey = getAlphaVantageQueryCacheKey(query);
  const cached = alphaVantageQueryCache.get(cacheKey);

  if (!cached) {
    return null;
  }

  if (cached.expiresAt <= Date.now()) {
    alphaVantageQueryCache.delete(cacheKey);
    return null;
  }

  return cached.value;
}

function writeCachedAlphaVantageQuery(packet: AlphaVantageQueryPacket) {
  alphaVantageQueryCache.set(getAlphaVantageQueryCacheKey(packet.query), {
    expiresAt: Date.now() + ALPHA_VANTAGE_QUERY_CACHE_TTL_MS,
    value: packet,
  });
}

function normalizeAlphaVantageFilters(filters: AlphaVantageNewsFilters): AlphaVantageNewsFilters {
  return {
    tickers: Array.from(
      new Set(
        filters.tickers
          .map((ticker) => ticker.trim().toUpperCase())
          .filter(Boolean)
      )
    ).slice(0, 3),
    topics: Array.from(
      new Set(
        filters.topics
          .map((topic) => topic.trim().toLowerCase())
          .filter(Boolean)
      )
    ).slice(0, 4),
  };
}

function getAlphaVantageRequestCacheKey(
  filters: AlphaVantageNewsFilters,
  limit: number
) {
  return JSON.stringify({
    limit,
    tickers: [...filters.tickers].sort(),
    topics: [...filters.topics].sort(),
  });
}

function readCachedAlphaVantageRequest(cacheKey: string) {
  const cached = alphaVantageRequestCache.get(cacheKey);

  if (!cached) {
    return null;
  }

  if (cached.expiresAt <= Date.now()) {
    alphaVantageRequestCache.delete(cacheKey);
    return null;
  }

  return cached.value;
}

function writeCachedAlphaVantageRequest(
  cacheKey: string,
  value: AlphaVantageNewsResponse
) {
  alphaVantageRequestCache.set(cacheKey, {
    expiresAt: Date.now() + ALPHA_VANTAGE_QUERY_CACHE_TTL_MS,
    value,
  });
}

function wait(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function runAlphaVantageRequestWithGate<T>(task: () => Promise<T>) {
  const scheduled = alphaVantageRequestGate.then(async () => {
    const waitMs = Math.max(
      0,
      alphaVantageLastRequestStartedAt +
        ALPHA_VANTAGE_REQUEST_SPACING_MS -
        Date.now()
    );

    if (waitMs > 0) {
      await wait(waitMs);
    }

    alphaVantageLastRequestStartedAt = Date.now();
    return task();
  });

  alphaVantageRequestGate = scheduled.then(
    () => undefined,
    () => undefined
  );

  return scheduled;
}

function extractTickerCandidates(query: string) {
  const matches = query.match(/\b(?:CRYPTO:[A-Za-z]{2,10}|FOREX:[A-Za-z]{3}|[A-Za-z]{1,5})\b/g) ?? [];

  return Array.from(
    new Set(
      matches
        .map((match) => match.trim())
        .filter((match) => match === match.toUpperCase())
        .filter((match) => !TICKER_STOP_WORDS.has(match))
    )
  ).slice(0, 3);
}

function inferTopics(query: string) {
  const topics = TOPIC_RULES.flatMap((rule) => (rule.pattern.test(query) ? [rule.topic] : []));
  const uniqueTopics = Array.from(new Set(topics));

  return uniqueTopics.length > 0 ? uniqueTopics.slice(0, 4) : ["financial_markets"];
}

function inferAlphaVantageFilters(query: string): AlphaVantageNewsFilters {
  return {
    tickers: extractTickerCandidates(query),
    topics: inferTopics(query),
  };
}

function parseAlphaVantagePublishedAt(value: string | null) {
  if (!value) {
    return null;
  }

  const match = value.match(
    /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?$/
  );

  if (!match) {
    return value;
  }

  const [, year, month, day, hour, minute, second] = match;

  return new Date(
    Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second ?? "0")
    )
  ).toISOString();
}

function mapArticle(value: unknown): AlphaVantageArticle {
  const record = asRecord(value);
  const authors = Array.isArray(record.authors)
    ? record.authors.filter((item): item is string => typeof item === "string")
    : [];

  return {
    // Intentionally keep only article evidence fields; provider sentiment scores stay out of the runtime.
    sourceName: parseString(record.source),
    author: authors.length > 0 ? authors.join(", ") : null,
    title: parseString(record.title) ?? "Untitled Alpha Vantage article",
    description: parseString(record.summary),
    url: parseString(record.url),
    imageUrl: parseString(record.banner_image),
    publishedAt: parseAlphaVantagePublishedAt(parseString(record.time_published)),
    content: parseString(record.summary),
  };
}

async function fetchAlphaVantageNewsRequest(
  filters: AlphaVantageNewsFilters,
  limit: number
) {
  const { apiKey, endpoint } = getAlphaVantageConfig();
  const url = new URL("/query", endpoint);
  const startedAt = Date.now();
  let statusCode: number | null = null;
  let responseHeaders: Headers | null = null;
  let didLog = false;

  url.searchParams.set("function", "NEWS_SENTIMENT");
  url.searchParams.set("sort", "LATEST");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("time_from", getTimeFromLookback(ALPHA_VANTAGE_LOOKBACK_DAYS));
  url.searchParams.set("apikey", apiKey);

  if (filters.tickers.length > 0) {
    url.searchParams.set("tickers", filters.tickers.join(","));
  }

  if (filters.topics.length > 0) {
    url.searchParams.set("topics", filters.topics.join(","));
  }

  try {
    const requestHeaders = {
      accept: "application/json",
    };
    const response = await fetch(url, {
      cache: "no-store",
      headers: requestHeaders,
    });
    statusCode = response.status;
    responseHeaders = response.headers;
    const payload = (await response.json().catch(() => ({}))) as JsonRecord;
    const apiError =
      parseString(payload["Error Message"]) ||
      parseString(payload.Information) ||
      parseString(payload.Note);

    if (!response.ok || apiError) {
      const message = apiError ?? `HTTP ${response.status}`;
      await recordApiActivityEventSafe({
        service: "ALPHA_VANTAGE",
        category: "RESEARCH",
        operation: "NEWS_SENTIMENT",
        method: "GET",
        url: url.toString(),
        statusCode,
        durationMs: Date.now() - startedAt,
        requestHeaders,
        responseHeaders,
        responsePayload: payload,
        errorMessage: message,
        metadata: {
          tickers: filters.tickers,
          topics: filters.topics,
          limit,
        },
      });
      didLog = true;
      throw new Error(`Alpha Vantage request failed for NEWS_SENTIMENT: ${message}`);
    }

    await recordApiActivityEventSafe({
      service: "ALPHA_VANTAGE",
      category: "RESEARCH",
      operation: "NEWS_SENTIMENT",
      method: "GET",
      url: url.toString(),
      statusCode,
      durationMs: Date.now() - startedAt,
      requestHeaders,
      responseHeaders,
      responsePayload: payload,
      metadata: {
        tickers: filters.tickers,
        topics: filters.topics,
        limit,
      },
    });
    didLog = true;

    const feed = Array.isArray(payload.feed) ? payload.feed : [];

    return {
      totalResults: parseNumber(feed.length),
      articles: feed.map(mapArticle),
    };
  } catch (error) {
    if (!didLog) {
      await recordApiActivityEventSafe({
        service: "ALPHA_VANTAGE",
        category: "RESEARCH",
        operation: "NEWS_SENTIMENT",
        method: "GET",
        url: url.toString(),
        statusCode,
        durationMs: Date.now() - startedAt,
        responseHeaders,
        errorMessage:
          error instanceof Error
            ? error.message
            : "Alpha Vantage request failed unexpectedly.",
        metadata: {
          tickers: filters.tickers,
          topics: filters.topics,
          limit,
        },
      });
    }

    throw error;
  }
}

async function alphaVantageNewsRequest(
  filters: AlphaVantageNewsFilters,
  limit: number
) {
  const normalizedFilters = normalizeAlphaVantageFilters(filters);
  const normalizedLimit = Math.max(1, Math.min(limit, 50));
  const cacheKey = getAlphaVantageRequestCacheKey(
    normalizedFilters,
    normalizedLimit
  );
  const cached = readCachedAlphaVantageRequest(cacheKey);

  if (cached) {
    return cached;
  }

  const existing = alphaVantageInFlightRequests.get(cacheKey);

  if (existing) {
    return existing;
  }

  const request = runAlphaVantageRequestWithGate(() =>
    fetchAlphaVantageNewsRequest(normalizedFilters, normalizedLimit)
  )
    .then((response) => {
      writeCachedAlphaVantageRequest(cacheKey, response);
      return response;
    })
    .finally(() => {
      alphaVantageInFlightRequests.delete(cacheKey);
    });

  alphaVantageInFlightRequests.set(cacheKey, request);

  return request;
}

export async function getAlphaVantageNews(input: {
  query: string;
  pageSize?: number;
}) {
  const query = input.query.trim();

  if (!query) {
    throw new Error("A query is required to fetch Alpha Vantage news results.");
  }

  return alphaVantageNewsRequest(
    inferAlphaVantageFilters(query),
    input.pageSize ?? 5
  );
}

export async function getAlphaVantageTopBusinessHeadlines(input?: {
  query?: string;
  pageSize?: number;
}) {
  const filters = input?.query?.trim()
    ? inferAlphaVantageFilters(input.query)
    : {
        tickers: [],
        topics: ["financial_markets", "finance"],
      };

  return alphaVantageNewsRequest(filters, input?.pageSize ?? 5);
}

async function getQueryPacket(query: string): Promise<AlphaVantageQueryPacket> {
  const cached = readCachedAlphaVantageQuery(query);

  if (cached) {
    return cached;
  }

  const cacheKey = getAlphaVantageQueryCacheKey(query);
  const existing = alphaVantageInFlightQueries.get(cacheKey);

  if (existing) {
    return existing;
  }

  const request = (async () => {
    const stale = alphaVantageQueryCache.get(cacheKey)?.value ?? null;

    try {
      const data = await getAlphaVantageNews({
        query,
        pageSize: 3,
      });

      const packet = {
        query,
        totalResults: data.totalResults,
        articles: data.articles,
        error: null,
      } satisfies AlphaVantageQueryPacket;

      writeCachedAlphaVantageQuery(packet);

      return packet;
    } catch (error) {
      if (stale && stale.articles.length > 0) {
        return {
          ...stale,
          error:
            error instanceof Error
              ? `Using cached Alpha Vantage results because the latest refresh failed: ${error.message}`
              : "Using cached Alpha Vantage results because the latest refresh failed.",
        } satisfies AlphaVantageQueryPacket;
      }

      return {
        query,
        totalResults: null,
        articles: [],
        error:
          error instanceof Error
            ? error.message
            : "Alpha Vantage query request failed.",
      };
    } finally {
      alphaVantageInFlightQueries.delete(cacheKey);
    }
  })();

  alphaVantageInFlightQueries.set(cacheKey, request);

  return request;
}

export async function getAlphaVantageResearchPacket(
  queries: string[]
): Promise<AlphaVantageResearchPacket> {
  const checkedAt = new Date().toISOString();
  const uniqueQueries = Array.from(
    new Set(queries.map((query) => query.trim()).filter(Boolean))
  ).slice(0, MAX_ALPHA_VANTAGE_RESEARCH_QUERIES);

  if (!isAlphaVantageConfigured()) {
    return {
      configured: false,
      connected: false,
      hasUsableArticles: false,
      checkedAt,
      queries: uniqueQueries.map((query) => ({
        query,
        totalResults: null,
        articles: [],
        error: "ALPHA_VANTAGE_API_KEY is not configured.",
      })),
      errors: ["ALPHA_VANTAGE_API_KEY is not configured."],
    };
  }

  const queryPackets = await Promise.all(uniqueQueries.map(getQueryPacket));
  const errors = queryPackets.flatMap((packet) => (packet.error ? [packet.error] : []));
  const hasUsableArticles = queryPackets.some((packet) => packet.articles.length > 0);
  const connected = queryPackets.some((packet) => packet.error === null) || hasUsableArticles;

  return {
    configured: true,
    connected,
    hasUsableArticles,
    checkedAt,
    queries: queryPackets,
    errors,
  };
}

export function summarizeAlphaVantagePacketForAgents(packet: AlphaVantageResearchPacket) {
  if (!packet.configured) {
    return "Alpha Vantage is unavailable because ALPHA_VANTAGE_API_KEY is not configured.";
  }

  if (!packet.connected) {
    return packet.errors[0]
      ? `Alpha Vantage request failed this cycle: ${packet.errors[0]}`
      : "Alpha Vantage request failed this cycle.";
  }

  if (!packet.hasUsableArticles) {
    return "Alpha Vantage was reachable but returned no relevant article context for the current query set this cycle.";
  }

  return packet.queries
    .flatMap((queryPacket) =>
      queryPacket.articles.slice(0, 1).map((article) => {
        const source = article.sourceName ? ` (${article.sourceName})` : "";
        return `${queryPacket.query}: ${article.title}${source}`;
      })
    )
    .slice(0, 3)
    .join(" | ");
}
