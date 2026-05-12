import "server-only";

import { recordApiActivityEventSafe } from "@/lib/data/alloydb/api-activity";

type JsonRecord = Record<string, unknown>;
const SEC_FILING_CONTEXT_CACHE_TTL_MS = 30 * 60_000;

export type SecTickerMatch = {
  ticker: string;
  cik: number;
  cikPadded: string;
  title: string;
};

export type SecFinancialFact = {
  tag: string;
  label: string;
  value: number | null;
  unit: string | null;
  endDate: string | null;
  filedDate: string | null;
  form: string | null;
  fiscalYear: number | null;
  fiscalPeriod: string | null;
};

export type SecFiling = {
  symbol: string;
  cik: string;
  companyName: string;
  accessionNumber: string;
  filingDate: string | null;
  reportDate: string | null;
  acceptanceDateTime: string | null;
  form: string;
  primaryDocument: string | null;
  primaryDocDescription: string | null;
  filingUrl: string | null;
  indexUrl: string;
  isEarningsRelated: boolean;
};

export type SecFilingContext = {
  sourceDocumentName: string | null;
  sourceUrl: string | null;
  summary: string | null;
  highlights: string[];
  fetchedAt: string | null;
};

export type SecEarningsSymbolPacket = {
  symbol: string;
  match: SecTickerMatch | null;
  filings: SecFiling[];
  latestFiling: SecFiling | null;
  filingContext: SecFilingContext | null;
  facts: {
    revenue: SecFinancialFact | null;
    netIncome: SecFinancialFact | null;
    epsDiluted: SecFinancialFact | null;
  };
  error: string | null;
};

export type SecEarningsPacket = {
  configured: boolean;
  connected: boolean;
  checkedAt: string;
  customUserAgent: boolean;
  symbols: SecEarningsSymbolPacket[];
  errors: string[];
};

type SecDirectoryItem = {
  name: string;
  lastModified: string | null;
  size: string | null;
};

type SecFilingContextCacheEntry = {
  expiresAt: number;
  value: SecFilingContext;
};

const secFilingContextCache = new Map<string, SecFilingContextCacheEntry>();
const secFilingContextInFlight = new Map<string, Promise<SecFilingContext | null>>();

const EARNINGS_RELATED_FORMS = new Set([
  "8-K",
  "8-K/A",
  "10-Q",
  "10-Q/A",
  "10-K",
  "10-K/A",
  "20-F",
  "20-F/A",
  "40-F",
  "40-F/A",
  "6-K",
  "6-K/A",
]);

function getEnv(name: string) {
  return process.env[name]?.trim() ?? "";
}

function getSecDataEndpoint() {
  return (getEnv("SEC_DATA_ENDPOINT") || "https://data.sec.gov").replace(/\/+$/, "");
}

function getSecArchivesEndpoint() {
  return (getEnv("SEC_ARCHIVES_ENDPOINT") || "https://www.sec.gov").replace(
    /\/+$/,
    ""
  );
}

function getSecUserAgent() {
  return (
    getEnv("SEC_USER_AGENT") ||
    "Potato Chips AI Research local-development contact@example.com"
  );
}

export function isSecUserAgentConfigured() {
  return Boolean(getEnv("SEC_USER_AGENT"));
}

function isFreshCacheEntry(
  entry: SecFilingContextCacheEntry | null | undefined
): entry is SecFilingContextCacheEntry {
  return Boolean(entry && entry.expiresAt > Date.now());
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

function cikToPadded(value: number | string) {
  const normalized = String(value).replace(/\D/g, "");
  return normalized.padStart(10, "0");
}

async function secRequest<T extends JsonRecord>(
  url: string,
  label: string
): Promise<T> {
  const startedAt = Date.now();
  const requestHeaders = {
    accept: "application/json",
    "accept-encoding": "gzip, deflate",
    "user-agent": getSecUserAgent(),
  };
  let statusCode: number | null = null;
  let responseHeaders: Headers | null = null;
  let didLog = false;

  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: requestHeaders,
    });
    statusCode = response.status;
    responseHeaders = response.headers;
    const payload = (await response.json().catch(() => ({}))) as JsonRecord;

    if (!response.ok) {
      const message =
        typeof payload.message === "string" ? payload.message : `HTTP ${response.status}`;
      await recordApiActivityEventSafe({
        service: "SEC_EDGAR",
        category: "RESEARCH",
        operation: label,
        method: "GET",
        url,
        statusCode,
        durationMs: Date.now() - startedAt,
        requestHeaders,
        responseHeaders,
        responsePayload: payload,
        errorMessage: message,
      });
      didLog = true;
      throw new Error(`${label} failed: ${message}`);
    }

    await recordApiActivityEventSafe({
      service: "SEC_EDGAR",
      category: "RESEARCH",
      operation: label,
      method: "GET",
      url,
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
        service: "SEC_EDGAR",
        category: "RESEARCH",
        operation: label,
        method: "GET",
        url,
        statusCode,
        durationMs: Date.now() - startedAt,
        responseHeaders,
        errorMessage:
          error instanceof Error ? error.message : `${label} failed unexpectedly.`,
      });
    }

    throw error;
  }
}

async function secTextRequest(url: string, label: string) {
  const startedAt = Date.now();
  const requestHeaders = {
    accept:
      "text/html,application/xhtml+xml,application/xml,text/plain;q=0.9,*/*;q=0.8",
    "accept-encoding": "gzip, deflate",
    "user-agent": getSecUserAgent(),
  };
  let statusCode: number | null = null;
  let responseHeaders: Headers | null = null;
  let didLog = false;

  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: requestHeaders,
    });
    statusCode = response.status;
    responseHeaders = response.headers;
    const text = await response.text().catch(() => "");

    if (!response.ok) {
      const message = `HTTP ${response.status}`;
      await recordApiActivityEventSafe({
        service: "SEC_EDGAR",
        category: "RESEARCH",
        operation: label,
        method: "GET",
        url,
        statusCode,
        durationMs: Date.now() - startedAt,
        requestHeaders,
        responseHeaders,
        responsePayload: text,
        errorMessage: message,
      });
      didLog = true;
      throw new Error(`${label} failed: HTTP ${response.status}`);
    }

    await recordApiActivityEventSafe({
      service: "SEC_EDGAR",
      category: "RESEARCH",
      operation: label,
      method: "GET",
      url,
      statusCode,
      durationMs: Date.now() - startedAt,
      requestHeaders,
      responseHeaders,
      responsePayload: text,
    });
    didLog = true;

    return text;
  } catch (error) {
    if (!didLog) {
      await recordApiActivityEventSafe({
        service: "SEC_EDGAR",
        category: "RESEARCH",
        operation: label,
        method: "GET",
        url,
        statusCode,
        durationMs: Date.now() - startedAt,
        responseHeaders,
        errorMessage:
          error instanceof Error ? error.message : `${label} failed unexpectedly.`,
      });
    }

    throw error;
  }
}

function buildSecFilingBasePath(filing: SecFiling) {
  const preferredUrl = filing.filingUrl ?? filing.indexUrl;
  return preferredUrl.slice(0, preferredUrl.lastIndexOf("/"));
}

function buildSecFilingDirectoryUrl(filing: SecFiling) {
  return `${buildSecFilingBasePath(filing)}/index.json`;
}

function parseDirectoryItems(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as SecDirectoryItem[];
  }

  return value
    .map((item) => asRecord(item))
    .map((record) => ({
      name: parseString(record.name),
      lastModified: parseString(record["last-modified"]),
      size: parseString(record.size),
    }))
    .filter(
      (
        item
      ): item is SecDirectoryItem & {
        name: string;
      } => Boolean(item.name)
    );
}

async function getSecFilingDirectoryItems(filing: SecFiling) {
  const payload = await secRequest<JsonRecord>(
    buildSecFilingDirectoryUrl(filing),
    "SEC filing directory request"
  );

  return parseDirectoryItems(asRecord(payload.directory).item);
}

function buildFilingDocumentUrl(filing: SecFiling, name: string) {
  return `${buildSecFilingBasePath(filing)}/${name}`;
}

function decodeHtmlEntities(text: string) {
  return text
    .replace(/&#(\d+);/g, (_, value) => {
      const code = Number(value);
      return Number.isFinite(code) ? String.fromCharCode(code) : "";
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, value) => {
      const code = parseInt(value, 16);
      return Number.isFinite(code) ? String.fromCharCode(code) : "";
    })
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'");
}

function normalizeSecDocumentText(raw: string) {
  return decodeHtmlEntities(
    raw
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<\/?(p|div|tr|table|li|ul|ol|h\d|title|section|article|br)\b[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/\r/g, "\n")
  )
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function isLikelyBoilerplateLine(line: string) {
  const normalized = line.toLowerCase();

  return (
    normalized.length < 30 ||
    normalized.length > 420 ||
    normalized.includes("commission file number") ||
    normalized.includes("state or other jurisdiction") ||
    normalized.includes("exact name of registrant") ||
    normalized.includes("class of each") ||
    normalized.includes("trading symbol") ||
    normalized.includes("securities registered pursuant") ||
    normalized.includes("employer identification") ||
    normalized.includes("form 8-k") ||
    normalized.includes("form 10-q") ||
    normalized.includes("form 10-k") ||
    normalized.includes("securities exchange act of 1934") ||
    normalized.includes("xbrl") ||
    normalized.includes("contextref") ||
    normalized.includes("us-gaap") ||
    normalized.includes("dei:")
  );
}

function scoreEarningsLine(line: string) {
  const normalized = line.toLowerCase();
  let score = 0;

  if (/item 2\.02|financial results|results for|announced|reported/.test(normalized)) {
    score += 6;
  }

  if (/revenue|net sales|sales|net income|operating income|gross margin/.test(normalized)) {
    score += 5;
  }

  if (/diluted earnings per share|diluted eps|earnings per share|\beps\b/.test(normalized)) {
    score += 5;
  }

  if (/guidance|outlook|expects|forecast/.test(normalized)) {
    score += 4;
  }

  if (/quarter ended|fiscal .* quarter|first quarter|second quarter|third quarter|fourth quarter/.test(normalized)) {
    score += 3;
  }

  if (/\$[\d,.]+|\b\d+(?:\.\d+)?%|\b\d+(?:\.\d+)?\s?(billion|million|basis points)\b/i.test(line)) {
    score += 2;
  }

  if (normalized.includes("company") || normalized.includes("fiscal")) {
    score += 1;
  }

  return score;
}

function extractEarningsHighlights(lines: string[]) {
  const seen = new Set<string>();

  return lines
    .filter((line) => !isLikelyBoilerplateLine(line))
    .map((line) => ({
      line,
      score: scoreEarningsLine(line),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return left.line.length - right.line.length;
    })
    .map((entry) => entry.line)
    .filter((line) => {
      const key = line.toLowerCase();

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    })
    .slice(0, 5);
}

function summarizeEarningsHighlights(highlights: string[]) {
  if (highlights.length === 0) {
    return null;
  }

  return highlights
    .slice(0, 2)
    .join(" ")
    .slice(0, 600)
    .trim();
}

function buildCandidateDocumentNames(filing: SecFiling, items: SecDirectoryItem[]) {
  const prioritizedNames: string[] = [];
  const push = (value: string | null | undefined) => {
    const normalized = value?.trim();

    if (!normalized || prioritizedNames.includes(normalized)) {
      return;
    }

    prioritizedNames.push(normalized);
  };

  const exhibitCandidates = items
    .map((item) => item.name)
    .filter((name): name is string => Boolean(name))
    .filter((name) => /\.(htm|html|xml|txt)$/i.test(name))
    .filter((name) => /99|ex99|earn|result|release|quarter/i.test(name))
    .sort();

  if (
    filing.form === "8-K" ||
    filing.form === "8-K/A" ||
    filing.form === "6-K" ||
    filing.form === "6-K/A"
  ) {
    exhibitCandidates.forEach(push);
    push(filing.primaryDocument);
  } else {
    push(filing.primaryDocument);
    exhibitCandidates.forEach(push);
  }

  push(`${filing.accessionNumber}.txt`);

  return prioritizedNames.slice(0, 4);
}

async function parseLatestFilingContext(filing: SecFiling): Promise<SecFilingContext | null> {
  const cached = secFilingContextCache.get(filing.accessionNumber);

  if (isFreshCacheEntry(cached)) {
    return cached.value;
  }

  const existing = secFilingContextInFlight.get(filing.accessionNumber);

  if (existing) {
    return existing;
  }

  const request = (async () => {
    try {
      const items = await getSecFilingDirectoryItems(filing).catch(() => [] as SecDirectoryItem[]);
      const candidates = buildCandidateDocumentNames(filing, items);

      for (const name of candidates) {
        try {
          const text = await secTextRequest(
            buildFilingDocumentUrl(filing, name),
            "SEC filing document request"
          );
          const highlights = extractEarningsHighlights(normalizeSecDocumentText(text));
          const summary = summarizeEarningsHighlights(highlights);

          if (!summary && highlights.length === 0) {
            continue;
          }

          const parsedContext = {
            sourceDocumentName: name,
            sourceUrl: buildFilingDocumentUrl(filing, name),
            summary,
            highlights,
            fetchedAt: new Date().toISOString(),
          } satisfies SecFilingContext;

          secFilingContextCache.set(filing.accessionNumber, {
            expiresAt: Date.now() + SEC_FILING_CONTEXT_CACHE_TTL_MS,
            value: parsedContext,
          });

          return parsedContext;
        } catch {
          continue;
        }
      }

      return null;
    } finally {
      secFilingContextInFlight.delete(filing.accessionNumber);
    }
  })();

  secFilingContextInFlight.set(filing.accessionNumber, request);
  return request;
}

export async function getSecCompanyTickers() {
  const data = await secRequest<JsonRecord>(
    `${getSecArchivesEndpoint()}/files/company_tickers.json`,
    "SEC ticker map request"
  );

  return Object.values(data)
    .map((value) => {
      const record = asRecord(value);
      const cik = parseNumber(record.cik_str);
      const ticker = parseString(record.ticker);
      const title = parseString(record.title);

      if (typeof cik !== "number" || !ticker || !title) {
        return null;
      }

      return {
        ticker: ticker.toUpperCase(),
        cik,
        cikPadded: cikToPadded(cik),
        title,
      } satisfies SecTickerMatch;
    })
    .filter((match): match is SecTickerMatch => match !== null);
}

export async function resolveSecTicker(symbol: string) {
  const normalizedSymbol = symbol.trim().toUpperCase();

  if (!normalizedSymbol) {
    throw new Error("A ticker symbol is required to resolve an SEC CIK.");
  }

  const matches = await getSecCompanyTickers();
  return matches.find((match) => match.ticker === normalizedSymbol) ?? null;
}

function getFilingUrl(cikPadded: string, accessionNumber: string, primaryDocument: string | null) {
  const accessionPath = accessionNumber.replace(/-/g, "");
  const basePath = `${getSecArchivesEndpoint()}/Archives/edgar/data/${Number(
    cikPadded
  )}/${accessionPath}`;

  return {
    indexUrl: `${basePath}/${accessionNumber}-index.html`,
    filingUrl: primaryDocument ? `${basePath}/${primaryDocument}` : null,
  };
}

function mapRecentFilings(input: {
  symbol: string;
  match: SecTickerMatch;
  submissions: JsonRecord;
}) {
  const recent = asRecord(input.submissions.filings).recent;
  const recentRecord = asRecord(recent);
  const forms = Array.isArray(recentRecord.form) ? recentRecord.form : [];
  const accessionNumbers = Array.isArray(recentRecord.accessionNumber)
    ? recentRecord.accessionNumber
    : [];
  const filingDates = Array.isArray(recentRecord.filingDate)
    ? recentRecord.filingDate
    : [];
  const reportDates = Array.isArray(recentRecord.reportDate)
    ? recentRecord.reportDate
    : [];
  const acceptanceTimes = Array.isArray(recentRecord.acceptanceDateTime)
    ? recentRecord.acceptanceDateTime
    : [];
  const primaryDocuments = Array.isArray(recentRecord.primaryDocument)
    ? recentRecord.primaryDocument
    : [];
  const primaryDocDescriptions = Array.isArray(recentRecord.primaryDocDescription)
    ? recentRecord.primaryDocDescription
    : [];

  return forms
    .map((form, index) => {
      const formType = parseString(form) ?? "UNKNOWN";
      const accessionNumber = parseString(accessionNumbers[index]);

      if (!accessionNumber) {
        return null;
      }

      const primaryDocument = parseString(primaryDocuments[index]);
      const urls = getFilingUrl(input.match.cikPadded, accessionNumber, primaryDocument);

      return {
        symbol: input.symbol,
        cik: input.match.cikPadded,
        companyName: input.match.title,
        accessionNumber,
        filingDate: parseString(filingDates[index]),
        reportDate: parseString(reportDates[index]),
        acceptanceDateTime: parseString(acceptanceTimes[index]),
        form: formType,
        primaryDocument,
        primaryDocDescription: parseString(primaryDocDescriptions[index]),
        filingUrl: urls.filingUrl,
        indexUrl: urls.indexUrl,
        isEarningsRelated: EARNINGS_RELATED_FORMS.has(formType),
      } satisfies SecFiling;
    })
    .filter((filing): filing is SecFiling => filing !== null);
}

export async function getSecSubmissions(cikPadded: string) {
  return secRequest<JsonRecord>(
    `${getSecDataEndpoint()}/submissions/CIK${cikToPadded(cikPadded)}.json`,
    "SEC submissions request"
  );
}

export async function getSecCompanyFacts(cikPadded: string) {
  return secRequest<JsonRecord>(
    `${getSecDataEndpoint()}/api/xbrl/companyfacts/CIK${cikToPadded(cikPadded)}.json`,
    "SEC company facts request"
  );
}

function findLatestFact(input: {
  facts: JsonRecord;
  tags: string[];
  label: string;
  unitPreference?: (unit: string) => boolean;
}) {
  const usGaap = asRecord(input.facts["us-gaap"]);

  for (const tag of input.tags) {
    const concept = asRecord(usGaap[tag]);
    const units = asRecord(concept.units);
    const unitEntries = Object.entries(units);
    const sortedUnits = [
      ...unitEntries.filter(([unit]) => input.unitPreference?.(unit) ?? unit === "USD"),
      ...unitEntries.filter(([unit]) => !(input.unitPreference?.(unit) ?? unit === "USD")),
    ];

    for (const [unit, values] of sortedUnits) {
      if (!Array.isArray(values)) {
        continue;
      }

      const latest = values
        .map((value) => asRecord(value))
        .filter((value) => {
          const form = parseString(value.form);
          return form ? EARNINGS_RELATED_FORMS.has(form) : true;
        })
        .sort((left, right) => {
          const rightFiled = parseString(right.filed) ?? "";
          const leftFiled = parseString(left.filed) ?? "";
          return rightFiled.localeCompare(leftFiled);
        })[0];

      if (latest) {
        return {
          tag,
          label: input.label,
          value: parseNumber(latest.val),
          unit,
          endDate: parseString(latest.end),
          filedDate: parseString(latest.filed),
          form: parseString(latest.form),
          fiscalYear: parseNumber(latest.fy),
          fiscalPeriod: parseString(latest.fp),
        } satisfies SecFinancialFact;
      }
    }
  }

  return null;
}

function summarizeCompanyFacts(facts: JsonRecord) {
  return {
    revenue: findLatestFact({
      facts,
      label: "Revenue",
      tags: [
        "RevenueFromContractWithCustomerExcludingAssessedTax",
        "Revenues",
        "SalesRevenueNet",
      ],
    }),
    netIncome: findLatestFact({
      facts,
      label: "Net income",
      tags: ["NetIncomeLoss", "ProfitLoss"],
    }),
    epsDiluted: findLatestFact({
      facts,
      label: "Diluted EPS",
      tags: ["EarningsPerShareDiluted"],
      unitPreference: (unit) => unit.includes("shares"),
    }),
  };
}

async function getSymbolEarningsPacket(symbol: string): Promise<SecEarningsSymbolPacket> {
  const normalizedSymbol = symbol.trim().toUpperCase();

  if (!normalizedSymbol) {
    return {
      symbol: "UNKNOWN",
      match: null,
      filings: [],
      latestFiling: null,
      filingContext: null,
      facts: {
        revenue: null,
        netIncome: null,
        epsDiluted: null,
      },
      error: "Missing symbol.",
    };
  }

  const match = await resolveSecTicker(normalizedSymbol);

  if (!match) {
    return {
      symbol: normalizedSymbol,
      match: null,
      filings: [],
      latestFiling: null,
      filingContext: null,
      facts: {
        revenue: null,
        netIncome: null,
        epsDiluted: null,
      },
      error: "No SEC CIK match found for ticker.",
    };
  }

  const [submissionsResult, factsResult] = await Promise.allSettled([
    getSecSubmissions(match.cikPadded),
    getSecCompanyFacts(match.cikPadded),
  ]);
  const filings =
    submissionsResult.status === "fulfilled"
      ? mapRecentFilings({
          symbol: normalizedSymbol,
          match,
          submissions: submissionsResult.value,
        })
      : [];
  const earningsFilings = filings
    .filter((filing) => filing.isEarningsRelated)
    .sort((left, right) => {
      const rightTime = right.acceptanceDateTime ?? right.filingDate ?? "";
      const leftTime = left.acceptanceDateTime ?? left.filingDate ?? "";
      return rightTime.localeCompare(leftTime);
    });
  const latestFiling = earningsFilings[0] ?? null;
  const errors = [submissionsResult, factsResult]
    .filter((result): result is PromiseRejectedResult => result.status === "rejected")
    .map((result) =>
      result.reason instanceof Error
        ? result.reason.message
        : "SEC EDGAR request failed."
    );

  return {
    symbol: normalizedSymbol,
    match,
    filings: earningsFilings.slice(0, 12),
    latestFiling,
    filingContext: latestFiling ? await parseLatestFilingContext(latestFiling) : null,
    facts:
      factsResult.status === "fulfilled"
        ? summarizeCompanyFacts(asRecord(factsResult.value.facts))
        : {
            revenue: null,
            netIncome: null,
            epsDiluted: null,
          },
    error: errors.length > 0 ? errors.join(" | ") : null,
  };
}

export async function getSecEarningsPacket(
  symbols: string[]
): Promise<SecEarningsPacket> {
  const checkedAt = new Date().toISOString();
  const uniqueSymbols = Array.from(
    new Set(symbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean))
  ).slice(0, 6);
  const results = await Promise.allSettled(uniqueSymbols.map(getSymbolEarningsPacket));
  const symbolPackets = results.map((result, index) =>
    result.status === "fulfilled"
      ? result.value
      : {
          symbol: uniqueSymbols[index] ?? "UNKNOWN",
          match: null,
          filings: [],
          latestFiling: null,
          filingContext: null,
          facts: {
            revenue: null,
            netIncome: null,
            epsDiluted: null,
          },
          error:
            result.reason instanceof Error
              ? result.reason.message
              : "SEC EDGAR research request failed.",
        }
  );
  const errors = symbolPackets.flatMap((packet) => (packet.error ? [packet.error] : []));

  return {
    configured: true,
    connected: symbolPackets.some(
      (packet) => packet.match !== null || packet.latestFiling !== null
    ),
    checkedAt,
    customUserAgent: isSecUserAgentConfigured(),
    symbols: symbolPackets,
    errors,
  };
}

function formatFact(fact: SecFinancialFact | null) {
  if (!fact || typeof fact.value !== "number") {
    return null;
  }

  const formattedValue =
    Math.abs(fact.value) >= 1_000_000_000
      ? `$${(fact.value / 1_000_000_000).toFixed(1)}B`
      : Math.abs(fact.value) >= 1_000_000
        ? `$${(fact.value / 1_000_000).toFixed(1)}M`
        : fact.value.toLocaleString("en-US");

  return `${fact.label} ${formattedValue} (${fact.form ?? "form n/a"} filed ${
    fact.filedDate ?? "date n/a"
  })`;
}

export function summarizeSecEarningsPacketForAgents(packet: SecEarningsPacket) {
  if (!packet.connected) {
    return "SEC EDGAR did not return usable earnings filing context this cycle.";
  }

  return packet.symbols
    .map((symbolPacket) => {
      const filing = symbolPacket.latestFiling;
      const filingContextSummary = symbolPacket.filingContext?.summary;
      const factSummary = [
        formatFact(symbolPacket.facts.revenue),
        formatFact(symbolPacket.facts.netIncome),
        formatFact(symbolPacket.facts.epsDiluted),
      ]
        .filter(Boolean)
        .join("; ");

      if (!filing) {
        return `${symbolPacket.symbol}: no recent earnings-related filing found; ${factSummary || "XBRL facts unavailable"}`;
      }

      return `${symbolPacket.symbol}: latest ${filing.form} accepted ${
        filing.acceptanceDateTime ?? filing.filingDate ?? "date n/a"
      }; ${
        filingContextSummary ?? factSummary ?? "Fresh filing body not parsed yet and XBRL facts unavailable"
      }`;
    })
    .slice(0, 3)
    .join(" | ");
}
