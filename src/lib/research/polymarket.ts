import "server-only";

import { recordApiActivityEventSafe } from "@/lib/data/alloydb/api-activity";

type JsonRecord = Record<string, unknown>;

export type PolymarketOutcome = {
  label: string;
  price: number | null;
};

export type PolymarketMarket = {
  id: string;
  question: string;
  slug: string | null;
  imageUrl?: string | null;
  endDate: string | null;
  startDate: string | null;
  updatedAt: string | null;
  active: boolean | null;
  closed: boolean | null;
  volume: number | null;
  volume24hr: number | null;
  liquidity: number | null;
  lastTradePrice: number | null;
  bestBid: number | null;
  bestAsk: number | null;
  spread: number | null;
  outcomes: PolymarketOutcome[];
  url: string | null;
};

export type PolymarketEvent = {
  id: string;
  ticker: string | null;
  slug: string | null;
  title: string;
  description: string | null;
  imageUrl?: string | null;
  startDate: string | null;
  endDate: string | null;
  updatedAt: string | null;
  active: boolean | null;
  closed: boolean | null;
  volume: number | null;
  volume24hr: number | null;
  openInterest: number | null;
  liquidity: number | null;
  tags: string[];
  markets: PolymarketMarket[];
  url: string | null;
};

export type PolymarketQueryPacket = {
  query: string;
  events: PolymarketEvent[];
  error: string | null;
};

export type PolymarketResearchPacket = {
  configured: boolean;
  connected: boolean;
  checkedAt: string;
  queries: PolymarketQueryPacket[];
  errors: string[];
};

function getEnv(name: "POLYMARKET_GAMMA_ENDPOINT" | "POLYMARKET_ENDPOINT") {
  return process.env[name]?.trim() ?? "";
}

function getPolymarketGammaEndpoint() {
  return (getEnv("POLYMARKET_GAMMA_ENDPOINT") || getEnv("POLYMARKET_ENDPOINT") || "https://gamma-api.polymarket.com").replace(
    /\/+$/,
    ""
  );
}

export function isPolymarketConfigured() {
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

function parseBoolean(value: unknown) {
  return typeof value === "boolean" ? value : null;
}

function parseStringArray(value: unknown) {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }

  if (typeof value === "string" && value.trim().length > 0) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed)
        ? parsed.filter((item): item is string => typeof item === "string")
        : [];
    } catch {
      return [];
    }
  }

  return [];
}

function parseNumberArray(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((item) => parseNumber(item));
  }

  if (typeof value === "string" && value.trim().length > 0) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map((item) => parseNumber(item)) : [];
    } catch {
      return [];
    }
  }

  return [];
}

function mapOutcomes(record: JsonRecord) {
  const labels = parseStringArray(record.outcomes);
  const prices = parseNumberArray(record.outcomePrices);

  return labels.map((label, index) => ({
    label,
    price: prices[index] ?? null,
  }));
}

function getEventUrl(slug: string | null) {
  return slug ? `https://polymarket.com/event/${slug}` : null;
}

async function polymarketRequest<T extends JsonRecord>(
  path: string,
  params?: Record<string, string | number | boolean | null | undefined>
) {
  const url = new URL(path, getPolymarketGammaEndpoint());
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
        service: "POLYMARKET",
        category: "RESEARCH",
        operation: path,
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
      throw new Error(`Polymarket request failed for GET ${path}: ${message}`);
    }

    await recordApiActivityEventSafe({
      service: "POLYMARKET",
      category: "RESEARCH",
      operation: path,
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
        service: "POLYMARKET",
        category: "RESEARCH",
        operation: path,
        method: "GET",
        url: url.toString(),
        statusCode,
        durationMs: Date.now() - startedAt,
        responseHeaders,
        errorMessage:
          error instanceof Error
            ? error.message
            : "Polymarket request failed unexpectedly.",
      });
    }

    throw error;
  }
}

function mapMarket(value: unknown): PolymarketMarket {
  const record = asRecord(value);
  const slug = parseString(record.slug);

  return {
    id: parseString(record.id) ?? "unknown",
    question: parseString(record.question) ?? "Untitled Polymarket market",
    slug,
    imageUrl: parseString(record.image) ?? parseString(record.icon),
    endDate: parseString(record.endDateIso) ?? parseString(record.endDate),
    startDate: parseString(record.startDateIso) ?? parseString(record.startDate),
    updatedAt: parseString(record.updatedAt),
    active: parseBoolean(record.active),
    closed: parseBoolean(record.closed),
    volume: parseNumber(record.volume),
    volume24hr: parseNumber(record.volume24hr),
    liquidity: parseNumber(record.liquidity),
    lastTradePrice: parseNumber(record.lastTradePrice),
    bestBid: parseNumber(record.bestBid),
    bestAsk: parseNumber(record.bestAsk),
    spread: parseNumber(record.spread),
    outcomes: mapOutcomes(record),
    url: getEventUrl(slug),
  };
}

function mapEvent(value: unknown): PolymarketEvent {
  const record = asRecord(value);
  const slug = parseString(record.slug);
  const tags = Array.isArray(record.tags) ? record.tags : [];
  const markets = Array.isArray(record.markets) ? record.markets : [];

  return {
    id: parseString(record.id) ?? "unknown",
    ticker: parseString(record.ticker),
    slug,
    title: parseString(record.title) ?? "Untitled Polymarket event",
    description: parseString(record.description),
    imageUrl: parseString(record.image) ?? parseString(record.icon),
    startDate: parseString(record.startDate),
    endDate: parseString(record.endDate),
    updatedAt: parseString(record.updatedAt),
    active: parseBoolean(record.active),
    closed: parseBoolean(record.closed),
    volume: parseNumber(record.volume),
    volume24hr: parseNumber(record.volume24hr),
    openInterest: parseNumber(record.openInterest),
    liquidity: parseNumber(record.liquidity),
    tags: tags
      .map((tag) => {
        const tagRecord = asRecord(tag);
        return (
          parseString(tagRecord.label) ??
          parseString(tagRecord.slug) ??
          parseString(tagRecord.name)
        );
      })
      .filter((tag): tag is string => Boolean(tag)),
    markets: markets.map(mapMarket).slice(0, 3),
    url: getEventUrl(slug),
  };
}

export async function searchPolymarket(query: string) {
  const normalizedQuery = query.trim();

  if (!normalizedQuery) {
    throw new Error("A query is required to fetch Polymarket market context.");
  }

  const data = await polymarketRequest<{ events?: unknown[] }>("/public-search", {
    q: normalizedQuery,
  });
  const events = Array.isArray(data.events) ? data.events : [];

  return {
    events: events.map(mapEvent).slice(0, 5),
  };
}

async function getQueryPacket(query: string): Promise<PolymarketQueryPacket> {
  try {
    const data = await searchPolymarket(query);

    return {
      query,
      events: data.events,
      error: null,
    };
  } catch (error) {
    return {
      query,
      events: [],
      error:
        error instanceof Error
          ? error.message
          : "Polymarket public-search request failed.",
    };
  }
}

export async function getPolymarketResearchPacket(
  queries: string[]
): Promise<PolymarketResearchPacket> {
  const checkedAt = new Date().toISOString();
  const uniqueQueries = Array.from(
    new Set(queries.map((query) => query.trim()).filter(Boolean))
  ).slice(0, 6);

  const queryPackets = await Promise.all(uniqueQueries.map(getQueryPacket));
  const errors = queryPackets.flatMap((packet) => (packet.error ? [packet.error] : []));

  return {
    configured: isPolymarketConfigured(),
    connected: queryPackets.some((packet) => packet.events.length > 0),
    checkedAt,
    queries: queryPackets,
    errors,
  };
}

function formatProbability(value: number | null) {
  return typeof value === "number" ? `${(value * 100).toFixed(1)}%` : "n/a";
}

export function summarizePolymarketPacketForAgents(packet: PolymarketResearchPacket) {
  if (!packet.connected) {
    return packet.errors[0] ?? "Polymarket returned no usable prediction-market context this cycle.";
  }

  return packet.queries
    .flatMap((queryPacket) => {
      const event = queryPacket.events[0];
      const market = event?.markets[0];
      const probability = market?.outcomes[0]?.price ?? market?.lastTradePrice ?? null;

      if (!market) {
        return [];
      }

      return [
        `${queryPacket.query}: ${market.question} (${market.outcomes[0]?.label ?? "Lead"} ${formatProbability(probability)})`,
      ];
    })
    .slice(0, 3)
    .join(" | ");
}
