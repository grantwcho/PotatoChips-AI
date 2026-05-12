import "server-only";

import { recordApiActivityEventSafe } from "@/lib/data/alloydb/api-activity";

type JsonRecord = Record<string, unknown>;
const KALSHI_SERIES_CACHE_TTL_MS = 15 * 60_000;
const KALSHI_EVENT_CACHE_TTL_MS = 5 * 60_000;

const KALSHI_SERIES_CATEGORIES = ["Economics", "Crypto", "Politics"] as const;
const KALSHI_DEFAULT_QUERY_HINTS: Record<string, string[]> = {
  "federal reserve": ["federal reserve", "fed", "fomc", "rate", "rates", "powell"],
  inflation: ["inflation", "cpi", "pce", "price"],
  jobs: ["jobs", "job", "payroll", "employment", "unemployment", "labor"],
  recession: ["recession", "gdp", "growth"],
  bitcoin: ["bitcoin", "btc", "crypto", "ethereum", "eth"],
  oil: ["oil", "energy", "gas", "crude", "spr"],
  tariffs: ["tariff", "trade war", "trade"],
};

export type KalshiMarket = {
  ticker: string;
  title: string;
  subtitle: string | null;
  imageUrl?: string | null;
  status: string | null;
  lastPrice: number | null;
  yesBid: number | null;
  yesAsk: number | null;
  noBid: number | null;
  noAsk: number | null;
  volume24h: number | null;
  openInterest: number | null;
  closeTime: string | null;
};

export type KalshiEvent = {
  eventTicker: string;
  seriesTicker: string | null;
  title: string;
  subtitle: string | null;
  imageUrl?: string | null;
  status: string | null;
  openTime: string | null;
  closeTime: string | null;
  markets: KalshiMarket[];
};

export type KalshiSeries = {
  ticker: string;
  title: string;
  category: string | null;
  volume: number | null;
  tags: string[];
};

export type KalshiQueryPacket = {
  query: string;
  matchedSeries: KalshiSeries[];
  events: KalshiEvent[];
  error: string | null;
};

export type KalshiResearchPacket = {
  configured: boolean;
  connected: boolean;
  checkedAt: string;
  queries: KalshiQueryPacket[];
  errors: string[];
};

type KalshiCacheEntry<T> = {
  expiresAt: number;
  value: T;
};

type KalshiEventMetadata = {
  imageUrl: string | null;
  featuredImageUrl: string | null;
  marketImageUrls: Record<string, string>;
};

let kalshiSeriesCatalogCache: KalshiCacheEntry<KalshiSeries[]> | null = null;
let kalshiSeriesCatalogInFlight: Promise<KalshiSeries[]> | null = null;
const kalshiEventCache = new Map<string, KalshiCacheEntry<KalshiEvent[]>>();
const kalshiEventInFlight = new Map<string, Promise<KalshiEvent[]>>();
const kalshiEventMetadataCache = new Map<string, KalshiCacheEntry<KalshiEventMetadata>>();
const kalshiEventMetadataInFlight = new Map<string, Promise<KalshiEventMetadata>>();

function getEnv(name: "KALSHI_API_ENDPOINT") {
  return process.env[name]?.trim() ?? "";
}

function getKalshiEndpoint() {
  return (getEnv("KALSHI_API_ENDPOINT") || "https://api.elections.kalshi.com/trade-api/v2").replace(
    /\/+$/,
    ""
  );
}

export function isKalshiConfigured() {
  return true;
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

function parseStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}

function getKalshiOrigin() {
  return new URL(getKalshiEndpoint()).origin;
}

function toAbsoluteKalshiUrl(value: unknown) {
  const raw = parseString(value);

  if (!raw) {
    return null;
  }

  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    try {
      return new URL(raw, `${getKalshiOrigin()}/`).toString();
    } catch {
      return null;
    }
  }
}

function isFreshCacheEntry<T>(entry: KalshiCacheEntry<T> | null | undefined) {
  return Boolean(entry && entry.expiresAt > Date.now());
}

async function kalshiRequest<T extends JsonRecord>(
  path: string,
  params?: Record<string, string | number | boolean | null | undefined>
) {
  const normalizedPath = path.replace(/^\/+/, "");
  const url = new URL(normalizedPath, `${getKalshiEndpoint()}/`);
  const startedAt = Date.now();
  let statusCode: number | null = null;
  let responseHeaders: Headers | null = null;
  let didLog = false;

  Object.entries(params ?? {}).forEach(([key, value]) => {
    if (value !== null && value !== undefined && String(value).length > 0) {
      url.searchParams.set(key, String(value));
    }
  });

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

    if (!response.ok) {
      const message =
        typeof payload.error === "string"
          ? payload.error
          : typeof payload.message === "string"
            ? payload.message
            : `HTTP ${response.status}`;
      await recordApiActivityEventSafe({
        service: "KALSHI",
        category: "RESEARCH",
        operation: normalizedPath,
        method: "GET",
        url: url.toString(),
        statusCode,
        durationMs: Date.now() - startedAt,
        requestHeaders,
        responseHeaders,
        responsePayload: payload,
        errorMessage: message,
      });
      didLog = true;
      throw new Error(`Kalshi request failed for GET ${path}: ${message}`);
    }

    await recordApiActivityEventSafe({
      service: "KALSHI",
      category: "RESEARCH",
      operation: normalizedPath,
      method: "GET",
      url: url.toString(),
      statusCode,
      durationMs: Date.now() - startedAt,
      requestHeaders,
      responseHeaders,
      responsePayload: payload,
    });
    didLog = true;

    return payload as T;
  } catch (error) {
    if (!didLog) {
      await recordApiActivityEventSafe({
        service: "KALSHI",
        category: "RESEARCH",
        operation: normalizedPath,
        method: "GET",
        url: url.toString(),
        statusCode,
        durationMs: Date.now() - startedAt,
        responseHeaders,
        errorMessage:
          error instanceof Error ? error.message : "Kalshi request failed unexpectedly.",
      });
    }

    throw error;
  }
}

function mapSeries(value: unknown): KalshiSeries {
  const record = asRecord(value);

  return {
    ticker: parseString(record.ticker) ?? "UNKNOWN",
    title: parseString(record.title) ?? "Untitled Kalshi series",
    category: parseString(record.category),
    volume: parseNumber(record.volume_fp),
    tags: parseStringArray(record.tags),
  };
}

function mapMarket(value: unknown): KalshiMarket {
  const record = asRecord(value);

  return {
    ticker: parseString(record.ticker) ?? "UNKNOWN",
    title: parseString(record.title) ?? "Untitled Kalshi market",
    subtitle: parseString(record.subtitle) ?? parseString(record.yes_sub_title),
    status: parseString(record.status),
    lastPrice: parseNumber(record.last_price_dollars),
    yesBid: parseNumber(record.yes_bid_dollars),
    yesAsk: parseNumber(record.yes_ask_dollars),
    noBid: parseNumber(record.no_bid_dollars),
    noAsk: parseNumber(record.no_ask_dollars),
    volume24h: parseNumber(record.volume_24h_fp),
    openInterest: parseNumber(record.open_interest_fp),
    closeTime: parseString(record.close_time) ?? parseString(record.expiration_time),
  };
}

function mapEvent(value: unknown): KalshiEvent {
  const record = asRecord(value);
  const markets = Array.isArray(record.markets) ? record.markets : [];

  return {
    eventTicker: parseString(record.event_ticker) ?? "UNKNOWN",
    seriesTicker: parseString(record.series_ticker),
    title: parseString(record.title) ?? "Untitled Kalshi event",
    subtitle: parseString(record.subtitle),
    status: parseString(record.status),
    openTime: parseString(record.open_time),
    closeTime: parseString(record.close_time),
    markets: markets.map(mapMarket).slice(0, 4),
  };
}

async function getEventMetadata(eventTicker: string) {
  const cachedMetadata = kalshiEventMetadataCache.get(eventTicker);

  if (isFreshCacheEntry(cachedMetadata)) {
    return cachedMetadata!.value;
  }

  const existing = kalshiEventMetadataInFlight.get(eventTicker);

  if (existing) {
    return existing;
  }

  const staleMetadata = cachedMetadata?.value ?? null;
  const request = (async () => {
    try {
      const data = await kalshiRequest<{
        image_url?: unknown;
        featured_image_url?: unknown;
        market_details?: unknown[];
      }>(`/events/${encodeURIComponent(eventTicker)}/metadata`);
      const marketDetails = Array.isArray(data.market_details) ? data.market_details : [];
      const marketImageUrls = Object.fromEntries(
        marketDetails.flatMap((detail) => {
          const record = asRecord(detail);
          const marketTicker = parseString(record.market_ticker);
          const imageUrl = toAbsoluteKalshiUrl(record.image_url);

          return marketTicker && imageUrl ? [[marketTicker, imageUrl]] : [];
        })
      );
      const metadata = {
        imageUrl: toAbsoluteKalshiUrl(data.image_url),
        featuredImageUrl: toAbsoluteKalshiUrl(data.featured_image_url),
        marketImageUrls,
      } satisfies KalshiEventMetadata;

      kalshiEventMetadataCache.set(eventTicker, {
        expiresAt: Date.now() + KALSHI_EVENT_CACHE_TTL_MS,
        value: metadata,
      });

      return metadata;
    } catch (error) {
      if (staleMetadata) {
        return staleMetadata;
      }

      throw error;
    } finally {
      kalshiEventMetadataInFlight.delete(eventTicker);
    }
  })();

  kalshiEventMetadataInFlight.set(eventTicker, request);
  return request;
}

async function enrichEventWithMetadata(event: KalshiEvent): Promise<KalshiEvent> {
  try {
    const metadata = await getEventMetadata(event.eventTicker);
    const eventImageUrl = metadata.featuredImageUrl ?? metadata.imageUrl;

    return {
      ...event,
      imageUrl: eventImageUrl,
      markets: event.markets.map((market) => ({
        ...market,
        imageUrl: metadata.marketImageUrls[market.ticker] ?? eventImageUrl,
      })),
    };
  } catch {
    return event;
  }
}

async function listSeriesByCategory(category: (typeof KALSHI_SERIES_CATEGORIES)[number]) {
  const data = await kalshiRequest<{ series?: unknown[] }>("/series", {
    category,
    include_volume: true,
    limit: 200,
  });

  return Array.isArray(data.series) ? data.series.map(mapSeries) : [];
}

async function getSeriesCatalog() {
  const cachedCatalog = kalshiSeriesCatalogCache;

  if (isFreshCacheEntry(cachedCatalog)) {
    return cachedCatalog!.value;
  }

  if (kalshiSeriesCatalogInFlight) {
    return kalshiSeriesCatalogInFlight;
  }

  const staleCatalog = kalshiSeriesCatalogCache?.value ?? null;
  kalshiSeriesCatalogInFlight = (async () => {
    try {
      const seriesCatalogResults = await Promise.allSettled(
        KALSHI_SERIES_CATEGORIES.map(listSeriesByCategory)
      );
      const bootstrapErrors = seriesCatalogResults.flatMap((result) =>
        result.status === "rejected"
          ? [
              result.reason instanceof Error
                ? result.reason.message
                : "Kalshi research request failed.",
            ]
          : []
      );
      const seriesCatalog = seriesCatalogResults.flatMap((result) =>
        result.status === "fulfilled" ? result.value : []
      );

      if (seriesCatalog.length === 0 && bootstrapErrors.length > 0) {
        if (staleCatalog && staleCatalog.length > 0) {
          return staleCatalog;
        }

        throw new Error(bootstrapErrors[0] ?? "Kalshi returned no usable market-implied context this cycle.");
      }

      kalshiSeriesCatalogCache = {
        expiresAt: Date.now() + KALSHI_SERIES_CACHE_TTL_MS,
        value: seriesCatalog,
      };

      return seriesCatalog;
    } finally {
      kalshiSeriesCatalogInFlight = null;
    }
  })();

  return kalshiSeriesCatalogInFlight;
}

function getQueryHints(query: string) {
  const normalized = query.trim().toLowerCase();

  if (!normalized) {
    return [];
  }

  const mapped = KALSHI_DEFAULT_QUERY_HINTS[normalized];
  if (mapped) {
    return mapped;
  }

  const directTokens = normalized
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);

  return directTokens.length > 0 ? directTokens : [normalized];
}

function scoreSeries(series: KalshiSeries, hints: string[]) {
  const haystack = `${series.title} ${series.category ?? ""} ${series.tags.join(" ")}`.toLowerCase();
  let score = 0;

  for (const hint of hints) {
    if (!hint) {
      continue;
    }

    if (haystack.includes(hint.toLowerCase())) {
      score += 3;
    }
  }

  if (series.volume) {
    score += Math.min(series.volume / 10_000, 5);
  }

  return score;
}

async function listOpenEventsForSeries(seriesTicker: string) {
  const cachedEvents = kalshiEventCache.get(seriesTicker);

  if (isFreshCacheEntry(cachedEvents)) {
    return cachedEvents!.value;
  }

  const existing = kalshiEventInFlight.get(seriesTicker);

  if (existing) {
    return existing;
  }

  const staleEvents = cachedEvents?.value ?? null;
  const request = (async () => {
    try {
      const data = await kalshiRequest<{ events?: unknown[] }>("/events", {
        status: "open",
        with_nested_markets: true,
        limit: 8,
        series_ticker: seriesTicker,
      });
      const events = Array.isArray(data.events) ? data.events.map(mapEvent) : [];

      if (events.length > 0) {
        kalshiEventCache.set(seriesTicker, {
          expiresAt: Date.now() + KALSHI_EVENT_CACHE_TTL_MS,
          value: events,
        });
      }

      return events;
    } catch (error) {
      if (staleEvents && staleEvents.length > 0) {
        return staleEvents;
      }

      throw error;
    } finally {
      kalshiEventInFlight.delete(seriesTicker);
    }
  })();

  kalshiEventInFlight.set(seriesTicker, request);
  return request;
}

function sortEvents(events: KalshiEvent[]) {
  return [...events].sort((left, right) => {
    const leftVolume =
      left.markets.reduce((sum, market) => sum + (market.volume24h ?? 0), 0) +
      left.markets.reduce((sum, market) => sum + (market.openInterest ?? 0), 0);
    const rightVolume =
      right.markets.reduce((sum, market) => sum + (market.volume24h ?? 0), 0) +
      right.markets.reduce((sum, market) => sum + (market.openInterest ?? 0), 0);

    return rightVolume - leftVolume;
  });
}

export async function getKalshiResearchPacket(
  queries: string[]
): Promise<KalshiResearchPacket> {
  const checkedAt = new Date().toISOString();
  const uniqueQueries = Array.from(
    new Set(queries.map((query) => query.trim()).filter(Boolean))
  ).slice(0, 6);
  let seriesCatalog: KalshiSeries[];

  try {
    seriesCatalog = await getSeriesCatalog();
  } catch (error) {
    const bootstrapError =
      error instanceof Error
        ? error.message
        : "Kalshi research request failed.";
    return {
      configured: isKalshiConfigured(),
      connected: false,
      checkedAt,
      queries: uniqueQueries.map((query) => ({
        query,
        matchedSeries: [],
        events: [],
        error: bootstrapError,
      })),
      errors: [bootstrapError],
    };
  }

  const queryPackets = await Promise.all(
    uniqueQueries.map(async (query) => {
      try {
        const hints = getQueryHints(query);
        const matchedSeries = seriesCatalog
          .map((series) => ({
            series,
            score: scoreSeries(series, hints),
          }))
          .filter((entry) => entry.score > 0)
          .sort((left, right) => right.score - left.score)
          .slice(0, 2)
          .map((entry) => entry.series);

        const events = sortEvents(
          (
            await Promise.all(
              matchedSeries.map((series) => listOpenEventsForSeries(series.ticker))
            )
          )
            .flat()
            .filter((event) => event.markets.length > 0)
        ).slice(0, 4);

        return {
          query,
          matchedSeries,
          events: await Promise.all(events.map(enrichEventWithMetadata)),
          error: null,
        } satisfies KalshiQueryPacket;
      } catch (error) {
        return {
          query,
          matchedSeries: [],
          events: [],
          error:
            error instanceof Error
              ? error.message
              : "Kalshi research request failed.",
        } satisfies KalshiQueryPacket;
      }
    })
  );

  const errors = [
    ...queryPackets.flatMap((packet) => (packet.error ? [packet.error] : [])),
  ];

  return {
    configured: isKalshiConfigured(),
    connected: queryPackets.some((packet) => packet.events.length > 0),
    checkedAt,
    queries: queryPackets,
    errors,
  };
}

function formatProbability(value: number | null) {
  return typeof value === "number" ? `${(value * 100).toFixed(1)}%` : "n/a";
}

export function summarizeKalshiPacketForAgents(packet: KalshiResearchPacket) {
  if (!packet.connected) {
    return packet.errors[0] ?? "Kalshi returned no usable market-implied context this cycle.";
  }

  return packet.queries
    .flatMap((queryPacket) => {
      const event = queryPacket.events[0];
      const market = event?.markets[0];
      const probability = market?.yesAsk ?? market?.lastPrice ?? market?.yesBid ?? null;

      if (!event || !market) {
        return [];
      }

      return [
        `${queryPacket.query}: ${market.title} (${formatProbability(probability)} yes-implied)`,
      ];
    })
    .slice(0, 3)
    .join(" | ");
}
