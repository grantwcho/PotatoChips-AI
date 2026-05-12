import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

function cleanEndpoint(value) {
  return value.replace(/\/v2\/?$/, "").replace(/\/+$/, "");
}

function getUtcDateOffset(daysAgo) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return date.toISOString().slice(0, 10);
}

async function requestJson(url, init, label) {
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message =
      typeof payload.message === "string"
        ? payload.message
        : typeof payload.error === "string"
          ? payload.error
          : `HTTP ${response.status}`;

    throw new Error(`${label} failed: ${message}`);
  }

  return payload;
}

async function safeCheck(label, fn) {
  try {
    return {
      label,
      ok: true,
      detail: await fn(),
    };
  } catch (error) {
    return {
      label,
      ok: false,
      detail: error instanceof Error ? error.message : "Unknown provider failure.",
    };
  }
}

function alpacaHeaders() {
  return {
    accept: "application/json",
    "APCA-API-KEY-ID": process.env.ALPACA_API_KEY ?? "",
    "APCA-API-SECRET-KEY": process.env.ALPACA_SECRET_KEY ?? "",
  };
}

async function checkAlpacaAccount() {
  const endpoint = process.env.ALPACA_ENDPOINT?.trim();
  const key = process.env.ALPACA_API_KEY?.trim();
  const secret = process.env.ALPACA_SECRET_KEY?.trim();

  if (!endpoint || !key || !secret) {
    throw new Error("Missing ALPACA_ENDPOINT, ALPACA_API_KEY, or ALPACA_SECRET_KEY.");
  }

  const account = await requestJson(
    `${cleanEndpoint(endpoint)}/v2/account`,
    { headers: alpacaHeaders() },
    "Alpaca account check"
  );

  return `account status ${account.status ?? "unknown"}, portfolio value present: ${
    account.portfolio_value !== undefined ? "yes" : "no"
  }`;
}

async function checkAlpacaMarketData() {
  if (!process.env.ALPACA_API_KEY?.trim() || !process.env.ALPACA_SECRET_KEY?.trim()) {
    throw new Error("Missing ALPACA_API_KEY or ALPACA_SECRET_KEY.");
  }

  const snapshot = await requestJson(
    "https://data.alpaca.markets/v2/stocks/SPY/snapshot",
    { headers: alpacaHeaders() },
    "Alpaca market data check"
  );
  const latestTrade = snapshot.latestTrade ?? {};
  const previousDailyBar = snapshot.previousDailyBar ?? {};

  return `SPY trade price present: ${latestTrade.p !== undefined ? "yes" : "no"}, previous close present: ${
    previousDailyBar.c !== undefined ? "yes" : "no"
  }`;
}

function massiveUrl(path, params = {}) {
  const apiKey = process.env.MASSIVE_API_KEY?.trim();
  const endpoint = (process.env.MASSIVE_ENDPOINT?.trim() || "https://api.massive.com").replace(
    /\/+$/,
    ""
  );

  if (!apiKey) {
    throw new Error("Missing MASSIVE_API_KEY.");
  }

  const url = new URL(path, endpoint);

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).length > 0) {
      url.searchParams.set(key, String(value));
    }
  });

  url.searchParams.set("apiKey", apiKey);
  return url;
}

function massiveHeaders() {
  return {
    accept: "application/json",
    authorization: `Bearer ${process.env.MASSIVE_API_KEY?.trim() ?? ""}`,
  };
}

async function checkMassiveAggregates() {
  const from = getUtcDateOffset(14);
  const to = getUtcDateOffset(0);
  const data = await requestJson(
    massiveUrl(`/v2/aggs/ticker/SPY/range/1/day/${from}/${to}`, {
      adjusted: true,
      sort: "asc",
      limit: 5000,
    }),
    { headers: massiveHeaders() },
    "Massive aggregate bars check"
  );
  const results = Array.isArray(data.results) ? data.results : [];

  return `SPY aggregate bars returned: ${results.length}`;
}

async function checkMassiveNews() {
  const data = await requestJson(
    massiveUrl("/v2/reference/news", {
      ticker: "SPY",
      sort: "published_utc",
      order: "desc",
      limit: 1,
    }),
    { headers: massiveHeaders() },
    "Massive news check"
  );
  const results = Array.isArray(data.results) ? data.results : [];

  return `SPY news items returned: ${results.length}`;
}

async function checkMassiveTreasuryYields() {
  const data = await requestJson(
    massiveUrl("/fed/v1/treasury-yields", {
      sort: "date.desc",
      limit: 1,
    }),
    { headers: massiveHeaders() },
    "Massive treasury yields check"
  );
  const results = Array.isArray(data.results) ? data.results : [];

  return `treasury yield rows returned: ${results.length}`;
}

function getAlphaVantageKey() {
  return (
    process.env.ALPHA_VANTAGE_API_KEY?.trim() ||
    process.env.ALPHAVANTAGE_API_KEY?.trim() ||
    process.env.ALPHA_VANTAGE_KEY?.trim() ||
    ""
  );
}

function alphaVantageUrl(params = {}) {
  const endpoint = (
    process.env.ALPHA_VANTAGE_ENDPOINT?.trim() || "https://www.alphavantage.co"
  ).replace(/\/+$/, "");
  const apiKey = getAlphaVantageKey();

  if (!apiKey) {
    throw new Error("Missing ALPHA_VANTAGE_API_KEY.");
  }

  const url = new URL("/query", endpoint);

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).length > 0) {
      url.searchParams.set(key, String(value));
    }
  });

  url.searchParams.set("apikey", apiKey);
  return url;
}

async function checkAlphaVantageNews() {
  const data = await requestJson(
    alphaVantageUrl({
      function: "NEWS_SENTIMENT",
      topics: "financial_markets",
      sort: "LATEST",
      limit: 1,
    }),
    { headers: { accept: "application/json" } },
    "Alpha Vantage NEWS_SENTIMENT check"
  );

  if (typeof data.Note === "string" && data.Note.trim().length > 0) {
    throw new Error(`Alpha Vantage NEWS_SENTIMENT check failed: ${data.Note}`);
  }

  if (typeof data.Information === "string" && data.Information.trim().length > 0) {
    throw new Error(`Alpha Vantage NEWS_SENTIMENT check failed: ${data.Information}`);
  }

  if (typeof data["Error Message"] === "string" && data["Error Message"].trim().length > 0) {
    throw new Error(`Alpha Vantage NEWS_SENTIMENT check failed: ${data["Error Message"]}`);
  }

  const feed = Array.isArray(data.feed) ? data.feed : [];

  return `feed items returned: ${feed.length}, article title present: ${
    typeof feed[0]?.title === "string" ? "yes" : "no"
  }`;
}

function kalshiEndpoint() {
  return (
    process.env.KALSHI_API_ENDPOINT?.trim() ||
    "https://api.elections.kalshi.com/trade-api/v2"
  ).replace(/\/+$/, "");
}

async function checkKalshiSeries() {
  const data = await requestJson(
    `${kalshiEndpoint()}/series?category=Economics&include_volume=true&limit=2`,
    {
      headers: {
        accept: "application/json",
      },
    },
    "Kalshi series check"
  );
  const series = Array.isArray(data.series) ? data.series : [];

  return `economics series returned: ${series.length}`;
}

async function checkKalshiEvents() {
  const data = await requestJson(
    `${kalshiEndpoint()}/events?status=open&with_nested_markets=true&limit=2`,
    {
      headers: {
        accept: "application/json",
      },
    },
    "Kalshi events check"
  );
  const events = Array.isArray(data.events) ? data.events : [];

  return `open events returned: ${events.length}`;
}

function secHeaders() {
  return {
    accept: "application/json",
    "accept-encoding": "gzip, deflate",
    "user-agent":
      process.env.SEC_USER_AGENT?.trim() ||
      "Potato Chips AI Research local-development contact@example.com",
  };
}

function secDataEndpoint() {
  return (process.env.SEC_DATA_ENDPOINT?.trim() || "https://data.sec.gov").replace(
    /\/+$/,
    ""
  );
}

function secArchivesEndpoint() {
  return (process.env.SEC_ARCHIVES_ENDPOINT?.trim() || "https://www.sec.gov").replace(
    /\/+$/,
    ""
  );
}

function padCik(value) {
  return String(value).replace(/\D/g, "").padStart(10, "0");
}

async function checkSecEdgarSubmissions() {
  const tickers = await requestJson(
    `${secArchivesEndpoint()}/files/company_tickers.json`,
    { headers: secHeaders() },
    "SEC ticker map check"
  );
  const apple = Object.values(tickers).find(
    (entry) => entry && typeof entry === "object" && entry.ticker === "AAPL"
  );

  if (!apple?.cik_str) {
    throw new Error("AAPL CIK not found in SEC company_tickers.json.");
  }

  const cik = padCik(apple.cik_str);
  const submissions = await requestJson(
    `${secDataEndpoint()}/submissions/CIK${cik}.json`,
    { headers: secHeaders() },
    "SEC submissions check"
  );
  const forms = Array.isArray(submissions.filings?.recent?.form)
    ? submissions.filings.recent.form
    : [];
  const latestForm = forms[0] ?? "unknown";

  return `AAPL CIK ${cik}, latest form ${latestForm}, custom User-Agent: ${
    process.env.SEC_USER_AGENT?.trim() ? "yes" : "no"
  }`;
}

async function checkSecEdgarCompanyFacts() {
  const data = await requestJson(
    `${secDataEndpoint()}/api/xbrl/companyfacts/CIK0000320193.json`,
    { headers: secHeaders() },
    "SEC company facts check"
  );
  const usGaap = data.facts?.["us-gaap"] ?? {};

  return `AAPL us-gaap concepts present: ${Object.keys(usGaap).length}`;
}

const checks = await Promise.all([
  safeCheck("Alpaca paper account", checkAlpacaAccount),
  safeCheck("Alpaca stock market data", checkAlpacaMarketData),
  safeCheck("Massive aggregate bars", checkMassiveAggregates),
  safeCheck("Massive ticker news", checkMassiveNews),
  safeCheck("Massive treasury yields", checkMassiveTreasuryYields),
  safeCheck("Kalshi series", checkKalshiSeries),
  safeCheck("Kalshi events", checkKalshiEvents),
  safeCheck("Alpha Vantage news", checkAlphaVantageNews),
  safeCheck("SEC EDGAR submissions", checkSecEdgarSubmissions),
  safeCheck("SEC EDGAR company facts", checkSecEdgarCompanyFacts),
]);

console.log("Data provider check (read-only; no orders submitted)");

checks.forEach((check) => {
  console.log(`${check.ok ? "PASS" : "FAIL"} ${check.label}: ${check.detail}`);
});

if (checks.some((check) => !check.ok)) {
  process.exitCode = 1;
}
