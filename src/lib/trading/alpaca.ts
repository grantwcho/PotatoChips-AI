import "server-only";

import { recordApiActivityEventSafe } from "@/lib/data/alloydb/api-activity";
import type {
  AlpacaAccountSnapshot,
  AlpacaAssetSnapshot,
  AlpacaOptionContractSnapshot,
  AlpacaOrderSnapshot,
  AlpacaOptionType,
  AlpacaPortfolioHistory,
  AlpacaPortfolioHistoryPoint,
  AlpacaPositionSnapshot,
  AlpacaOptionOrderLegInput,
  AlpacaStockBar,
  AlpacaStockSnapshot,
  AlpacaSubmitOrderInput,
} from "@/lib/trading/types";

type JsonRecord = Record<string, unknown>;

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

function asRecord(value: unknown): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as JsonRecord;
}

function formatPrice(value: number) {
  return value >= 1 ? value.toFixed(2) : value.toFixed(4);
}

function formatQty(value: number, decimals = 4) {
  return value.toFixed(decimals);
}

function getEnv(name: "ALPACA_ENDPOINT" | "ALPACA_API_KEY" | "ALPACA_SECRET_KEY") {
  return process.env[name]?.trim() ?? "";
}

function getAlpacaConfig() {
  const endpoint = getEnv("ALPACA_ENDPOINT");
  const apiKey = getEnv("ALPACA_API_KEY");
  const secretKey = getEnv("ALPACA_SECRET_KEY");

  if (!endpoint || !apiKey || !secretKey) {
    throw new Error(
      "Missing Alpaca market-data credentials. Set ALPACA_ENDPOINT, ALPACA_API_KEY, and ALPACA_SECRET_KEY."
    );
  }

  return {
    endpoint: endpoint.replace(/\/v2\/?$/, "").replace(/\/+$/, ""),
    apiKey,
    secretKey,
  };
}

function getAlpacaDataEndpoint() {
  return "https://data.alpaca.markets";
}

export function parseAlpacaOptionContractSymbol(contractSymbol: string): {
  symbol: string;
  underlyingSymbol: string;
  expirationDate: string;
  optionType: AlpacaOptionType;
  strikePrice: number;
} | null {
  const normalized = contractSymbol.trim().toUpperCase();
  const match = normalized.match(/^([A-Z]{1,10})(\d{6})([CP])(\d{8})$/);

  if (!match) {
    return null;
  }

  const [, underlyingSymbol, expirationCompact, optionFlag, strikeCompact] = match;
  const year = Number(`20${expirationCompact.slice(0, 2)}`);
  const month = Number(expirationCompact.slice(2, 4));
  const day = Number(expirationCompact.slice(4, 6));
  const strikePrice = Number(strikeCompact) / 1000;

  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null;
  }

  return {
    symbol: normalized,
    underlyingSymbol,
    expirationDate: `${year.toString().padStart(4, "0")}-${month
      .toString()
      .padStart(2, "0")}-${day.toString().padStart(2, "0")}`,
    optionType: optionFlag === "C" ? "call" : "put",
    strikePrice,
  };
}

export function isAlpacaPaperTradingConfigured() {
  return Boolean(
    getEnv("ALPACA_ENDPOINT") &&
      getEnv("ALPACA_API_KEY") &&
      getEnv("ALPACA_SECRET_KEY")
  );
}

async function alpacaRequest<T extends JsonRecord | JsonRecord[]>(
  path: string,
  init?: RequestInit
) {
  const { endpoint } = getAlpacaConfig();
  return alpacaRequestAgainstBaseUrl<T>(endpoint, path, init);
}

async function alpacaDataRequest<T extends JsonRecord | JsonRecord[]>(
  path: string,
  init?: RequestInit
) {
  return alpacaRequestAgainstBaseUrl<T>(getAlpacaDataEndpoint(), path, init);
}

async function alpacaRequestAgainstBaseUrl<T extends JsonRecord | JsonRecord[]>(
  baseUrl: string,
  path: string,
  init?: RequestInit
) {
  const { apiKey, secretKey } = getAlpacaConfig();
  const headers = new Headers(init?.headers);
  const startedAt = Date.now();
  let statusCode: number | null = null;
  let responseHeaders: Headers | null = null;
  let didLog = false;

  headers.set("accept", "application/json");
  headers.set("APCA-API-KEY-ID", apiKey);
  headers.set("APCA-API-SECRET-KEY", secretKey);

  if (init?.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  try {
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers,
      cache: "no-store",
    });
    statusCode = response.status;
    responseHeaders = response.headers;

    const requestId = response.headers.get("x-request-id");
    const payload = (await response.json().catch(() => ({}))) as
      | JsonRecord
      | JsonRecord[];

    if (!response.ok) {
      const errorMessage =
        !Array.isArray(payload) && typeof payload.message === "string"
          ? payload.message
          : `HTTP ${response.status}`;

      await recordApiActivityEventSafe({
        service: "ALPACA",
        category: "TRADING",
        operation: path,
        method: init?.method ?? "GET",
        url: `${baseUrl}${path}`,
        statusCode,
        durationMs: Date.now() - startedAt,
        requestHeaders: headers,
        requestPayload: init?.body ?? null,
        responseHeaders,
        responsePayload: payload,
        errorMessage,
        metadata: {
          requestId,
          baseUrl,
        },
      });
      didLog = true;

      throw new Error(
        `Alpaca request failed for ${init?.method ?? "GET"} ${path}: ${errorMessage}`
      );
    }

    await recordApiActivityEventSafe({
      service: "ALPACA",
      category: "TRADING",
      operation: path,
      method: init?.method ?? "GET",
      url: `${baseUrl}${path}`,
      statusCode,
      durationMs: Date.now() - startedAt,
      requestHeaders: headers,
      requestPayload: init?.body ?? null,
      responseHeaders,
      responsePayload: payload,
      metadata: {
        requestId,
        baseUrl,
      },
    });
    didLog = true;

    return {
      data: payload as T,
      requestId,
    };
  } catch (error) {
    if (!didLog) {
      await recordApiActivityEventSafe({
        service: "ALPACA",
        category: "TRADING",
        operation: path,
        method: init?.method ?? "GET",
        url: `${baseUrl}${path}`,
        statusCode,
        durationMs: Date.now() - startedAt,
        requestHeaders: headers,
        requestPayload: init?.body ?? null,
        responseHeaders,
        errorMessage:
          error instanceof Error ? error.message : "Alpaca request failed unexpectedly.",
        metadata: {
          baseUrl,
        },
      });
    }

    throw error;
  }
}

function mapAccount(data: JsonRecord, requestId: string | null): AlpacaAccountSnapshot {
  return {
    accountId: typeof data.id === "string" ? data.id : "unknown",
    status: typeof data.status === "string" ? data.status : null,
    equity: parseNumber(data.equity),
    cash: parseNumber(data.cash),
    buyingPower: parseNumber(data.buying_power),
    portfolioValue: parseNumber(data.portfolio_value),
    longMarketValue: parseNumber(data.long_market_value),
    shortMarketValue: parseNumber(data.short_market_value),
    multiplier: typeof data.multiplier === "string" ? data.multiplier : null,
    daytradeCount: parseNumber(data.daytrade_count),
    patternDayTrader:
      typeof data.pattern_day_trader === "boolean" ? data.pattern_day_trader : null,
    requestId,
    raw: data,
  };
}

function mapPosition(data: JsonRecord): AlpacaPositionSnapshot {
  return {
    symbol: typeof data.symbol === "string" ? data.symbol : "UNKNOWN",
    side: typeof data.side === "string" ? data.side : null,
    qty: parseNumber(data.qty),
    avgEntryPrice: parseNumber(data.avg_entry_price),
    marketValue: parseNumber(data.market_value),
    costBasis: parseNumber(data.cost_basis),
    unrealizedPl: parseNumber(data.unrealized_pl),
    currentPrice: parseNumber(data.current_price),
    exchange: typeof data.exchange === "string" ? data.exchange : null,
    assetClass: typeof data.asset_class === "string" ? data.asset_class : null,
    raw: data,
  };
}

function mapAsset(data: JsonRecord): AlpacaAssetSnapshot {
  return {
    symbol: typeof data.symbol === "string" ? data.symbol : "UNKNOWN",
    status: typeof data.status === "string" ? data.status : null,
    assetClass: typeof data.class === "string" ? data.class : null,
    tradable: typeof data.tradable === "boolean" ? data.tradable : null,
    fractionable:
      typeof data.fractionable === "boolean" ? data.fractionable : null,
    shortable: typeof data.shortable === "boolean" ? data.shortable : null,
    easyToBorrow:
      typeof data.easy_to_borrow === "boolean" ? data.easy_to_borrow : null,
    marginable: typeof data.marginable === "boolean" ? data.marginable : null,
    raw: data,
  };
}

function mapOrder(
  data: JsonRecord,
  requestId: string | null,
  fallbackSymbol?: string
): AlpacaOrderSnapshot {
  const firstLeg = Array.isArray(data.legs) ? asRecord(data.legs[0]) : {};

  return {
    brokerOrderId: typeof data.id === "string" ? data.id : "unknown",
    clientOrderId:
      typeof data.client_order_id === "string" ? data.client_order_id : null,
    symbol:
      typeof data.symbol === "string"
        ? data.symbol
        : typeof data.underlying_symbol === "string"
          ? data.underlying_symbol
          : typeof firstLeg.symbol === "string"
            ? firstLeg.symbol
            : fallbackSymbol ?? "UNKNOWN",
    side: typeof data.side === "string" ? data.side : "buy",
    orderType: typeof data.order_type === "string" ? data.order_type : "market",
    orderClass: typeof data.order_class === "string" ? data.order_class : null,
    timeInForce:
      typeof data.time_in_force === "string" ? data.time_in_force : "day",
    qty: parseNumber(data.qty),
    notional: parseNumber(data.notional),
    filledQty: parseNumber(data.filled_qty),
    filledAvgPrice: parseNumber(data.filled_avg_price),
    status: typeof data.status === "string" ? data.status : "unknown",
    assetClass: typeof data.asset_class === "string" ? data.asset_class : null,
    submittedAt:
      typeof data.submitted_at === "string" ? data.submitted_at : null,
    updatedAt: typeof data.updated_at === "string" ? data.updated_at : null,
    requestId,
    raw: data,
  };
}

function mapStockSnapshot(
  symbol: string,
  data: JsonRecord,
  requestId: string | null
): AlpacaStockSnapshot {
  const latestQuote = asRecord(data.latestQuote);
  const latestTrade = asRecord(data.latestTrade);
  const minuteBar = asRecord(data.minuteBar);
  const dailyBar = asRecord(data.dailyBar);
  const prevDailyBar = asRecord(data.prevDailyBar);
  const previousDailyBar = asRecord(data.previousDailyBar);

  return {
    symbol,
    askPrice: parseNumber(latestQuote.ap),
    bidPrice: parseNumber(latestQuote.bp),
    tradePrice:
      parseNumber(latestTrade.p) ??
      parseNumber(minuteBar.c) ??
      parseNumber(dailyBar.c),
    previousClose:
      parseNumber(prevDailyBar.c) ??
      parseNumber(previousDailyBar.c),
    requestId,
    raw: data,
  };
}

function mapStockBars(data: JsonRecord): AlpacaStockBar[] {
  const bars = Array.isArray(data.bars) ? data.bars : [];

  return bars.map((bar) => {
    const record = asRecord(bar);

    return {
      timestamp: typeof record.t === "string" ? record.t : new Date(0).toISOString(),
      close: parseNumber(record.c),
      raw: record,
    };
  });
}

function mapOptionSnapshot(
  contractSymbol: string,
  data: JsonRecord,
  requestId: string | null
): AlpacaOptionContractSnapshot {
  const latestQuote = asRecord(data.latestQuote);
  const latestTrade = asRecord(data.latestTrade);
  const parsed = parseAlpacaOptionContractSymbol(contractSymbol);

  return {
    symbol: contractSymbol,
    underlyingSymbol: parsed?.underlyingSymbol ?? contractSymbol,
    expirationDate: parsed?.expirationDate ?? null,
    optionType: parsed?.optionType ?? null,
    strikePrice: parsed?.strikePrice ?? null,
    askPrice: parseNumber(latestQuote.ap),
    bidPrice: parseNumber(latestQuote.bp),
    tradePrice: parseNumber(latestTrade.p),
    requestId,
    raw: data,
  };
}

function mapPortfolioHistory(
  data: JsonRecord,
  requestId: string | null
): AlpacaPortfolioHistory {
  const timestamps = Array.isArray(data.timestamp) ? data.timestamp : [];
  const equity = Array.isArray(data.equity) ? data.equity : [];
  const profitLoss = Array.isArray(data.profit_loss) ? data.profit_loss : [];
  const profitLossPct = Array.isArray(data.profit_loss_pct)
    ? data.profit_loss_pct
    : [];
  const points: AlpacaPortfolioHistoryPoint[] = timestamps.map((timestamp, index) => {
    const timestampSeconds = parseNumber(timestamp);

    return {
      timestamp:
        typeof timestampSeconds === "number"
          ? new Date(timestampSeconds * 1000).toISOString()
          : new Date(0).toISOString(),
      equity: parseNumber(equity[index]),
      profitLoss: parseNumber(profitLoss[index]),
      profitLossPct: parseNumber(profitLossPct[index]),
    };
  });

  return {
    points,
    baseValue: parseNumber(data.base_value),
    baseValueAsOf:
      typeof data.base_value_asof === "string" ? data.base_value_asof : null,
    timeframe: typeof data.timeframe === "string" ? data.timeframe : null,
    requestId,
    raw: data,
  };
}

export async function getAlpacaAccount() {
  const { data, requestId } = await alpacaRequest<JsonRecord>("/v2/account");
  return mapAccount(asRecord(data), requestId);
}

export async function getAlpacaPortfolioHistory(input?: {
  period?: "1D" | "1M" | "1A" | "all";
  timeframe?: "1Min" | "1D";
  intradayReporting?: "market_hours" | "extended_hours" | "continuous";
}) {
  const params = new URLSearchParams({
    period: input?.period ?? "1D",
    timeframe: input?.timeframe ?? "1Min",
  });

  if (input?.intradayReporting) {
    params.set("intraday_reporting", input.intradayReporting);
  }

  const { data, requestId } = await alpacaRequest<JsonRecord>(
    `/v2/account/portfolio/history?${params.toString()}`
  );

  return mapPortfolioHistory(asRecord(data), requestId);
}

export async function getAlpacaStockBars(
  symbol: string,
  input: {
    start: string;
    end: string;
    timeframe?: "1Min" | "1Day";
  }
) {
  const encodedSymbol = encodeURIComponent(symbol.trim().toUpperCase());
  const params = new URLSearchParams({
    timeframe: input.timeframe ?? "1Day",
    start: input.start,
    end: input.end,
    adjustment: "raw",
    feed: "iex",
    limit: "10000",
  });
  const { data } = await alpacaDataRequest<JsonRecord>(
    `/v2/stocks/${encodedSymbol}/bars?${params.toString()}`
  );

  return mapStockBars(asRecord(data));
}

export async function listAlpacaPositions() {
  const { data } = await alpacaRequest<JsonRecord[]>("/v2/positions");
  return data.map((position) => mapPosition(asRecord(position)));
}

export async function getAlpacaAsset(symbol: string) {
  const encodedSymbol = encodeURIComponent(symbol.trim().toUpperCase());
  const { data } = await alpacaRequest<JsonRecord>(`/v2/assets/${encodedSymbol}`);
  return mapAsset(asRecord(data));
}

export async function listAlpacaRecentOrders(limit = 12) {
  const params = new URLSearchParams({
    status: "all",
    direction: "desc",
    limit: String(Math.max(1, Math.min(limit, 50))),
    nested: "false",
  });
  const { data } = await alpacaRequest<JsonRecord[]>(`/v2/orders?${params.toString()}`);
  return data.map((order) => mapOrder(asRecord(order), null));
}

export async function getAlpacaStockSnapshot(symbol: string) {
  const encodedSymbol = encodeURIComponent(symbol.trim().toUpperCase());

  if (!encodedSymbol) {
    throw new Error("A symbol is required to fetch an Alpaca stock snapshot.");
  }

  const { data, requestId } = await alpacaDataRequest<JsonRecord>(
    `/v2/stocks/${encodedSymbol}/snapshot`
  );

  return mapStockSnapshot(encodedSymbol, asRecord(data), requestId);
}

export async function listAlpacaOptionSnapshots(
  underlyingSymbol: string,
  input?: {
    limit?: number;
    feed?: "indicative" | "opra";
  }
) {
  const encodedSymbol = encodeURIComponent(underlyingSymbol.trim().toUpperCase());

  if (!encodedSymbol) {
    throw new Error("An underlying symbol is required to fetch Alpaca option snapshots.");
  }

  const targetLimit = Math.max(1, Math.min(input?.limit ?? 200, 500));
  const snapshots: AlpacaOptionContractSnapshot[] = [];
  let pageToken: string | null = null;
  let requestId: string | null = null;

  while (snapshots.length < targetLimit) {
    const params = new URLSearchParams({
      limit: String(Math.min(100, targetLimit - snapshots.length)),
      feed: input?.feed ?? "indicative",
    });

    if (pageToken) {
      params.set("page_token", pageToken);
    }

    const response = await alpacaDataRequest<JsonRecord>(
      `/v1beta1/options/snapshots/${encodedSymbol}?${params.toString()}`
    );
    requestId = response.requestId;
    const payload = asRecord(response.data);
    const pageSnapshots = asRecord(payload.snapshots);

    for (const [contractSymbol, rawSnapshot] of Object.entries(pageSnapshots)) {
      if (snapshots.length >= targetLimit) {
        break;
      }

      snapshots.push(
        mapOptionSnapshot(contractSymbol, asRecord(rawSnapshot), requestId)
      );
    }

    pageToken =
      typeof payload.next_page_token === "string" ? payload.next_page_token : null;

    if (!pageToken) {
      break;
    }
  }

  return snapshots;
}

export async function submitAlpacaOrder(input: AlpacaSubmitOrderInput) {
  const kind =
    input.kind ?? (input.orderClass === "mleg" ? "option_mleg" : input.positionIntent ? "option" : "equity");
  const body: JsonRecord = {
    type: input.type ?? "market",
    time_in_force: input.timeInForce ?? "day",
  };

  if (kind === "option_mleg") {
    if (!input.qty || input.qty <= 0) {
      throw new Error("Alpaca multi-leg option orders require a positive qty.");
    }

    if (!Array.isArray(input.legs) || input.legs.length < 2 || input.legs.length > 4) {
      throw new Error("Alpaca multi-leg option orders require 2-4 option legs.");
    }

    body.order_class = "mleg";
    body.qty = formatQty(input.qty, 0);
    body.legs = input.legs.map((leg: AlpacaOptionOrderLegInput) => ({
      symbol: leg.symbol,
      ratio_qty: formatQty(leg.ratioQty, 0),
      side: leg.side,
      position_intent: leg.positionIntent,
    }));
  } else {
    if (!input.symbol || !input.side) {
      throw new Error("Alpaca order submission requires symbol and side.");
    }

    if (!input.qty && !input.notional) {
      throw new Error("Alpaca order submission requires either qty or notional.");
    }

    if (input.qty && input.notional) {
      throw new Error("Alpaca order submission cannot use qty and notional together.");
    }

    body.symbol = input.symbol;
    body.side = input.side;

    if (typeof input.qty === "number") {
      body.qty = formatQty(input.qty, kind === "option" ? 0 : 4);
    }

    if (typeof input.notional === "number") {
      if (kind === "option") {
        throw new Error("Alpaca option orders require qty; notional sizing is not supported.");
      }

      body.notional = input.notional.toFixed(2);
    }

    if (kind === "option" && input.positionIntent) {
      body.position_intent = input.positionIntent;
    }
  }

  if (input.clientOrderId) {
    body.client_order_id = input.clientOrderId;
  }

  if (typeof input.limitPrice === "number") {
    body.limit_price = formatPrice(input.limitPrice);
  }

  if (input.extendedHours) {
    if (kind !== "equity") {
      throw new Error("Extended-hours routing is only supported for equity orders.");
    }
    body.extended_hours = true;
  }

  const { data, requestId } = await alpacaRequest<JsonRecord>("/v2/orders", {
    method: "POST",
    body: JSON.stringify(body),
  });

  const fallbackSymbol =
    input.symbol ??
    (Array.isArray(input.legs) ? input.legs.map((leg) => leg.symbol).join(" / ") : undefined);

  return mapOrder(asRecord(data), requestId, fallbackSymbol);
}

export async function cancelAlpacaOrder(orderId: string) {
  await alpacaRequest<JsonRecord>(`/v2/orders/${encodeURIComponent(orderId)}`, {
    method: "DELETE",
  });
}
