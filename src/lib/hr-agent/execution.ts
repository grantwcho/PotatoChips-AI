import "server-only";

import path from "node:path";
import {
  adaptNativeOutputToSignalContract,
  type NativeAgentOutput,
} from "@/lib/hr-agent/adapter/signal-adapter";
import { scoreAgentPerformance } from "@/lib/hr-agent/evaluation/performance-scorer";
import type {
  AgentApplication,
  HrAdversarialReport,
  HrFunctionalTestResult,
  HrPerformanceMetrics,
  HrPortfolioFitReport,
  HrProbationReport,
  HrRegimeBacktestResult,
  HrSandboxReport,
  HrShadowComparisonRow,
  HrStressTestResult,
  SignalOutput,
} from "@/lib/hr-agent/models/agent-application";
import {
  collectWorkspaceFiles,
  fileExists,
  getHrWorkspaceRoot,
  getPersistedSubmissionArtifact,
  readTextPreview,
  resolveWorkspaceRoot,
  runHrCommand,
  writeHrJsonArtifact,
  writeHrTextArtifact,
} from "@/lib/hr-agent/storage";
import {
  getMassiveAggregateBars,
  getMassiveTickerNews,
  isMassiveConfigured,
} from "@/lib/research/massive";
import { getNewsApiEverything, isNewsApiConfigured } from "@/lib/research/newsapi";
import {
  getAlpacaStockBars,
  isAlpacaPaperTradingConfigured,
} from "@/lib/trading/alpaca";
import { getBrokerDashboardSnapshot } from "@/lib/agents/repository";
import { recordApiActivityEventSafe } from "@/lib/data/alloydb/api-activity";
import { requestConfiguredJsonObject, type JsonSchema } from "@/lib/agents/model-json";
import { SUBMISSION_EXECUTION_LIMITS } from "@/lib/submissions/guidelines";
import { findSubmissionManifestInWorkspace } from "@/lib/submissions/manifest";
import {
  buildSubmittedAgentEnvironment,
  getRequestedEnvVarsForWorkspace,
} from "@/lib/submissions/env-reconciliation";

type HistoricalBar = {
  timestamp: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
};

type AgentScenario = {
  mode: "signal";
  asOf: string;
  symbol: string;
  lookbackBars: HistoricalBar[];
  recentHeadlines: string[];
  description: string;
  claimedEdge: string;
  dataSourcesRequired: string;
  marketConditions?: {
    feedStatus?: "normal" | "delayed" | "poisoned" | "halted";
    simulatedSpreadBps?: number;
    partialFillProbability?: number;
    regimeLabel?: string;
  };
};

type AgentInvocation = {
  scenario: AgentScenario;
  rawOutput: NativeAgentOutput;
  translatedSignal: SignalOutput;
  executionSummary: string;
  stdout: string;
  stderr: string;
};

type EvaluationTrade = {
  regimeKey?: string;
  regimeLabel?: string;
  symbol: string;
  asOf: string;
  nextTimestamp: string;
  currentPrice: number;
  nextPrice: number;
  direction: SignalOutput["direction"];
  conviction: number;
  maxPositionPct: number;
  stopLossPct: number;
  takeProfitPct: number;
  realizedReturnPct: number;
  boundedReturnPct: number;
  grossExposurePct: number;
  turnoverPct: number;
  portfolioValue: number;
  rawOutput: NativeAgentOutput;
  translatedSignal: SignalOutput;
};

type ScenarioWindow = {
  from: string;
  to: string;
};

type FunctionalScenarioDescriptor = {
  key: string;
  label: string;
  scenario: AgentScenario;
  maxConviction?: number;
  maxPositionPct?: number;
};

type EvaluationOptions = {
  regimeKey?: string;
  regimeLabel?: string;
  window?: ScenarioWindow;
};

type InvocationPlan =
  | {
      kind: "code-archive";
      command: string[];
      cwd: string;
      descriptor: string;
    }
  | {
      kind: "wrapped-model";
      descriptor: string;
      sourcePath: string | null;
      systemPrompt: string;
      userPromptPrefix: string;
      supportingContext: string[];
    }
  | {
      kind: "docker-image";
      image: string;
      descriptor: string;
    }
  | {
      kind: "api-endpoint";
      url: string;
      descriptor: string;
    };

const TICKER_STOP_WORDS = new Set([
  "AI",
  "API",
  "ATS",
  "CIO",
  "CPU",
  "ETF",
  "GPT",
  "HR",
  "JSON",
  "LLM",
  "ML",
  "NYSE",
  "PNL",
  "SEC",
  "SDK",
  "URL",
  "USD",
]);

const WRAPPED_MODEL_SIGNAL_SCHEMA = {
  type: "object",
  additionalProperties: true,
  properties: {
    ticker: { type: "string" },
    direction: { type: "string", enum: ["long", "short", "close"] },
    conviction: { type: "number" },
    time_horizon: { type: "string", enum: ["intraday", "swing", "position"] },
    stop_loss_pct: { type: "number" },
    take_profit_pct: { type: "number" },
    max_position_pct: { type: "number" },
    reasoning: { type: "string" },
    data_sources: {
      type: "array",
      items: { type: "string" },
    },
    correlation_id: { type: "string" },
  },
  required: [
    "ticker",
    "direction",
    "conviction",
    "time_horizon",
    "stop_loss_pct",
    "take_profit_pct",
    "max_position_pct",
    "reasoning",
    "data_sources",
    "correlation_id",
  ],
} satisfies JsonSchema;

const WRAPPED_MODEL_CONTEXT_PATTERNS = [
  /^gpt-capital-model\.json$/i,
  /^model\.json$/i,
  /^README\.md$/i,
  /prompt/i,
  /instruction/i,
  /strategy/i,
  /thesis/i,
  /overview/i,
  /spec/i,
  /playbook/i,
  /system/i,
];

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function buildSandboxProfile() {
  return "(version 1) (deny default) (allow process*) (allow sysctl-read) (allow file-read*)";
}

function parseCommand(value: unknown): string[] | null {
  if (Array.isArray(value) && value.every((item) => typeof item === "string" && item.trim())) {
    return value.map((item) => item.trim());
  }

  if (typeof value === "string" && value.trim()) {
    return ["/bin/sh", "-lc", value.trim()];
  }

  return null;
}

function buildTemplateAgentSmokeCommand(input: {
  agentName: string | null;
  metrics: string[];
  responseFormats: string[];
}) {
  const metricsJson = JSON.stringify(input.metrics);
  const lensJson = JSON.stringify(input.agentName ?? "submitted_agent");
  const responseFormatsJson = JSON.stringify(input.responseFormats);
  const wrapperSource = `
import dataclasses
import importlib.util
import inspect
import json
import sys
from pathlib import Path

REPO_DIR = Path.cwd()
SDK_DIR = REPO_DIR / "sdk"
if SDK_DIR.exists():
    sys.path.insert(0, str(SDK_DIR))
sys.path.insert(0, str(REPO_DIR))

METRICS = ${metricsJson}
LENS = ${lensJson}
RESPONSE_FORMATS = ${responseFormatsJson}


def cz_log(event, **fields):
    print(
        "[cz-run] "
        + event
        + (" " + json.dumps(fields, separators=(",", ":"), sort_keys=True) if fields else ""),
        file=sys.stderr,
        flush=True,
    )


def to_dict(value):
    if dataclasses.is_dataclass(value):
        return dataclasses.asdict(value)
    if hasattr(value, "to_dict") and callable(value.to_dict):
        return value.to_dict()
    if isinstance(value, dict):
        return value
    return {}


def as_number(value, fallback=0.0):
    try:
        return float(value)
    except Exception:
        return fallback


def load_agent():
    from potato_chips_ai import Agent

    agent_path = REPO_DIR / "agent.py"
    if not agent_path.exists():
        raise RuntimeError("Missing agent.py")

    spec = importlib.util.spec_from_file_location("submitted_agent", agent_path)
    if spec is None or spec.loader is None:
        raise RuntimeError("Could not import agent.py")

    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    for _, obj in inspect.getmembers(module, inspect.isclass):
        try:
            if issubclass(obj, Agent) and obj is not Agent:
                return obj()
        except TypeError:
            continue

    raise RuntimeError("agent.py must define a subclass of potato_chips_ai.Agent")


prompt_text = sys.stdin.read().strip()
cz_log("stdin-read", chars=len(prompt_text))
prompt = json.loads(prompt_text) if prompt_text else {}
prompt_metrics = prompt.get("metrics")
metrics = (
    [item for item in prompt_metrics if isinstance(item, str) and item]
    if isinstance(prompt_metrics, list)
    else METRICS
)
metrics = metrics or ["revenue_data_center_q2_fy27"]

cz_log("load-agent-start")
agent = load_agent()
cz_log("load-agent-ok", class_name=agent.__class__.__name__)

if "freeform" in RESPONSE_FORMATS:
    from potato_chips_ai import AgentQuery

    query = AgentQuery(
        query_id=str(prompt.get("query_id") or prompt.get("id") or "smoke"),
        prompt=str(
            prompt.get("prompt")
            or prompt.get("question")
            or "Return a short response that proves the agent is working."
        ),
        response_format="freeform",
        context=prompt.get("context") if isinstance(prompt.get("context"), dict) else {},
        metrics=metrics,
    )

    cz_log(
        "freeform-start",
        context_keys=sorted(query.context.keys()),
        prompt_chars=len(query.prompt),
    )
    answer_text = agent.freeform(query)
    cz_log("freeform-ok", answer_chars=len(answer_text))
    if not isinstance(answer_text, str) or not answer_text.strip():
        raise RuntimeError("freeform(query) must return a non-empty string")

    response = {
        "status": "ok",
        "lens": LENS,
        "as_of": prompt.get("as_of") if isinstance(prompt.get("as_of"), str) else "2026-08-25T19:50:00Z",
        "question": prompt.get("question") if isinstance(prompt.get("question"), str) else query.prompt,
        "response_type": "freeform",
        "answer": {
            "text": answer_text.strip(),
        },
        "sources": [
            {
                "title": "Submitted freeform response",
                "url": "https://potatochipsai.com/submission-evidence/freeform",
            }
        ],
    }

    print(json.dumps(response, separators=(",", ":")))
    raise SystemExit(0)

predictions = agent.daily_forecast(metrics[:1])
if not isinstance(predictions, list) or not predictions:
    raise RuntimeError("daily_forecast() must return at least one Prediction")

prediction = to_dict(predictions[0])
intervals = prediction.get("confidence_intervals")
interval = to_dict(intervals[0]) if isinstance(intervals, list) and intervals else {}
point_estimate = as_number(prediction.get("point_estimate"))
low = as_number(interval.get("low"), point_estimate)
high = as_number(interval.get("high"), point_estimate)
level = as_number(interval.get("level"), 0.5)
refs = prediction.get("evidence_refs")
refs = [item for item in refs if isinstance(item, str) and item] if isinstance(refs, list) else []
source_label = refs[0] if refs else "submitted_daily_forecast"
safe_source = "".join(ch if ch.isalnum() or ch in "-_" else "-" for ch in source_label).strip("-") or "submitted"

response = {
    "status": "ok",
    "lens": LENS,
    "as_of": prompt.get("as_of") if isinstance(prompt.get("as_of"), str) else "2026-08-25T19:50:00Z",
    "question": prompt.get("question") if isinstance(prompt.get("question"), str) else "daily_forecast smoke test",
    "response_type": "point_estimate",
    "answer": {
        "summary": str(prediction.get("reasoning_summary") or "Submitted daily_forecast response."),
        "metric": str(prediction.get("metric_id") or metrics[0]),
        "value": point_estimate,
        "unit": str(prediction.get("unit") or "unknown"),
        "confidence_interval": {
            "low": low,
            "high": high,
            "confidence_level": level,
        },
    },
    "sources": [
        {
            "title": source_label,
            "url": f"https://potatochipsai.com/submission-evidence/{safe_source}",
        }
    ],
}

print(json.dumps(response, separators=(",", ":")))
  `.trim();

  return ["python3", "-c", wrapperSource];
}

function truncateContext(value: string, limit = 3_500) {
  const trimmed = value.trim();

  if (trimmed.length <= limit) {
    return trimmed;
  }

  return `${trimmed.slice(0, limit)}\n...[truncated]`;
}

function buildWrappedModelSystemPrompt(application: AgentApplication) {
  return `You are being wrapped into Potato Chips AI's agent interface for recruiting evaluation.

Your job is to behave like the submitted strategy as faithfully as possible using the provided submission materials.

Rules:
- Produce one coherent research judgment for the supplied symbol only.
- Use the submission's edge, horizon, risk parameters, and data requirements when they are available.
- If the submission is ambiguous, stay conservative rather than hallucinating hidden capabilities.
- Do not claim external data the submission did not mention.
- Size smaller when the strategy context is incomplete.

Submission identity:
- Name: ${application.agentName || "Unnamed submission"}
- Type: ${application.type}
- Description: ${application.description || "Not provided"}
- Claimed edge: ${application.claimedEdge || "Not provided"}
- Data sources: ${application.dataSourcesRequired || "Not provided"}
- Asset classes: ${application.documentationProfile.assetClasses || "Not provided"}
- Risk parameters: ${application.documentationProfile.riskParameters || "Not provided"}
- Holding period: ${application.documentationProfile.holdingPeriod || "Not provided"}`;
}

function looksLikeContextFile(relativePath: string) {
  const basename = path.basename(relativePath);
  return WRAPPED_MODEL_CONTEXT_PATTERNS.some((pattern) => pattern.test(basename));
}

async function readDocumentationArtifactPreview(application: AgentApplication) {
  const documentationPath = await getPersistedSubmissionArtifact(
    application.id,
    "documentation"
  );

  if (!documentationPath) {
    return null;
  }

  const preview = await readTextPreview(documentationPath, 24_000);

  if (!preview) {
    return null;
  }

  return {
    sourcePath: documentationPath,
    content: truncateContext(preview),
  };
}

async function collectWrappedModelContext(
  application: AgentApplication,
  workspaceRoot: string
) {
  const files = await collectWorkspaceFiles(workspaceRoot, 500);
  const contextSnippets: Array<{ sourcePath: string | null; content: string }> = [];

  for (const relativePath of files.filter(looksLikeContextFile).slice(0, 6)) {
    const absolutePath = path.join(workspaceRoot, relativePath);
    const preview = await readTextPreview(absolutePath, 24_000);

    if (!preview) {
      continue;
    }

    contextSnippets.push({
      sourcePath: absolutePath,
      content: `File: ${relativePath}\n${truncateContext(preview)}`,
    });
  }

  const documentationArtifact = await readDocumentationArtifactPreview(application);

  if (documentationArtifact) {
    contextSnippets.unshift({
      sourcePath: documentationArtifact.sourcePath,
      content: `Uploaded documentation\n${documentationArtifact.content}`,
    });
  }

  return contextSnippets;
}

function extractCandidateTickers(application: AgentApplication) {
  const joined = [
    application.agentName,
    application.description,
    application.claimedEdge,
    application.dataSourcesRequired,
  ].join(" ");

  return Array.from(
    new Set(
      (joined.match(/\b[A-Z]{1,5}\b/g) ?? []).filter(
        (ticker) => !TICKER_STOP_WORDS.has(ticker)
      )
    )
  );
}

function fallbackSymbols(application: AgentApplication) {
  if (application.type === "macro") {
    return ["SPY", "TLT", "GLD", "XLF", "HYG"];
  }

  if (application.type === "event") {
    return ["AAPL", "AMD", "DAL", "DIS", "PLTR"];
  }

  if (application.type === "sentiment") {
    return ["QQQ", "NVDA", "TSLA", "PLTR", "COIN"];
  }

  if (application.type === "research") {
    return ["SPY", "QQQ", "IWM", "GLD", "TLT"];
  }

  return ["SPY", "QQQ", "IWM", "GLD", "TLT"];
}

function pickSymbols(application: AgentApplication, maxSymbols = 4) {
  return Array.from(
    new Set([...extractCandidateTickers(application), ...fallbackSymbols(application)])
  ).slice(0, maxSymbols);
}

async function getHistoricalBars(
  symbol: string,
  options?: {
    days?: number;
    from?: string;
    to?: string;
  }
): Promise<HistoricalBar[]> {
  const errors: string[] = [];
  const days = options?.days ?? 60;
  const from =
    options?.from ??
    new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const to = options?.to ?? new Date().toISOString().slice(0, 10);

  if (isMassiveConfigured()) {
    try {
      const bars = await getMassiveAggregateBars({
        symbol,
        limit: 200,
        from,
        to,
      });

      const normalized = bars
        .filter((bar) => typeof bar.close === "number")
        .map((bar) => ({
          timestamp: bar.timestamp,
          open: bar.open,
          high: bar.high,
          low: bar.low,
          close: bar.close,
          volume: bar.volume,
        }));

      if (normalized.length > 0) {
        return normalized;
      }
    } catch (error) {
      errors.push(
        error instanceof Error ? error.message : "Research pricing history lookup failed."
      );
    }
  }

  if (isAlpacaPaperTradingConfigured()) {
    try {
      const end = new Date(to);
      const start = new Date(from);
      const bars = await getAlpacaStockBars(symbol, {
        start: start.toISOString(),
        end: end.toISOString(),
        timeframe: "1Day",
      });

      const normalized = bars
        .filter((bar) => typeof bar.close === "number")
        .map((bar) => ({
          timestamp: bar.timestamp,
          open: null,
          high: null,
          low: null,
          close: bar.close,
          volume: null,
        }));

      if (normalized.length > 0) {
        return normalized;
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "Alpaca history lookup failed.");
    }
  }

  throw new Error(
    errors[0] ?? "No market-data provider returned usable history for historical replay."
  );
}

async function getRecentHeadlines(symbol: string) {
  if (isMassiveConfigured()) {
    try {
      const items = await getMassiveTickerNews(symbol, 3);
      const titles = items.map((item) => item.title).filter(Boolean);

      if (titles.length > 0) {
        return titles;
      }
    } catch {
      // Fall through to Alpha Vantage or empty headlines.
    }
  }

  if (isNewsApiConfigured()) {
    try {
      const packet = await getNewsApiEverything({
        query: symbol,
        pageSize: 3,
      });
      return packet.articles.map((article) => article.title).filter(Boolean);
    } catch {
      return [];
    }
  }

  return [];
}

function pickScenarioIndices(totalBars: number, desiredCount: number, lookback: number) {
  const firstIndex = lookback - 1;
  const lastIndex = totalBars - 2;

  if (lastIndex < firstIndex) {
    return [];
  }

  const available = lastIndex - firstIndex + 1;
  const count = Math.min(desiredCount, available);

  if (count <= 1) {
    return [lastIndex];
  }

  return Array.from({ length: count }, (_, index) => {
    const position = firstIndex + Math.round((index * (available - 1)) / (count - 1));
    return clamp(position, firstIndex, lastIndex);
  });
}

async function buildHistoricalScenarios(
  application: AgentApplication,
  options?: {
    maxSymbols?: number;
    scenariosPerSymbol?: number;
    lookbackBars?: number;
    recentOnly?: boolean;
    explicitSymbols?: string[];
    window?: ScenarioWindow;
  }
) {
  const maxSymbols = options?.maxSymbols ?? 3;
  const scenariosPerSymbol = options?.scenariosPerSymbol ?? 3;
  const lookbackBars = options?.lookbackBars ?? 12;
  const scenarios: AgentScenario[] = [];

  for (const symbol of options?.explicitSymbols ?? pickSymbols(application, maxSymbols)) {
    let bars: HistoricalBar[];

    try {
      bars = await getHistoricalBars(symbol, options?.window);
    } catch {
      continue;
    }

    const headlines = await getRecentHeadlines(symbol).catch(() => []);
    const indices = options?.recentOnly
      ? pickScenarioIndices(bars.length, scenariosPerSymbol, lookbackBars).slice(-scenariosPerSymbol)
      : pickScenarioIndices(bars.length, scenariosPerSymbol, lookbackBars);

    for (const index of indices) {
      const window = bars.slice(Math.max(0, index - lookbackBars + 1), index + 1);
      const asOf = window.at(-1)?.timestamp;

      if (!asOf || window.length === 0) {
        continue;
      }

      scenarios.push({
        mode: "signal",
        asOf,
        symbol,
        lookbackBars: window,
        recentHeadlines: headlines,
        description: application.description,
        claimedEdge: application.claimedEdge,
        dataSourcesRequired: application.dataSourcesRequired,
      });
    }
  }

  if (scenarios.length === 0) {
    throw new Error("Unable to build any market scenarios for the submitted agent.");
  }

  return scenarios;
}

async function buildConformanceScenario(application: AgentApplication) {
  const scenarios = await buildHistoricalScenarios(application, {
    maxSymbols: 1,
    scenariosPerSymbol: 1,
    lookbackBars: 15,
    recentOnly: true,
  });

  return scenarios[0]!;
}

function extractJsonPayload(raw: string): NativeAgentOutput {
  const trimmed = raw.trim();

  if (!trimmed) {
    throw new Error("Submitted agent did not emit any JSON output.");
  }

  const attempts = [trimmed];
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");

  if (firstBrace !== -1 && lastBrace > firstBrace) {
    attempts.push(trimmed.slice(firstBrace, lastBrace + 1));
  }

  for (const attempt of attempts) {
    try {
      const parsed = JSON.parse(attempt) as unknown;

      if (Array.isArray(parsed)) {
        const firstItem = parsed[0];

        if (firstItem && typeof firstItem === "object" && !Array.isArray(firstItem)) {
          return firstItem as NativeAgentOutput;
        }
      }

      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as NativeAgentOutput;
      }
    } catch {
      continue;
    }
  }

  throw new Error("Submitted agent output was not valid JSON.");
}

function normalizeMappingNotes(rawOutput: NativeAgentOutput) {
  const notes: Array<{
    sourceField: string;
    targetField: keyof SignalOutput;
    note: string;
  }> = [];

  if ("symbol" in rawOutput || "ticker" in rawOutput || "asset" in rawOutput) {
    notes.push({
      sourceField:
        "ticker" in rawOutput ? "ticker" : "symbol" in rawOutput ? "symbol" : "asset",
      targetField: "ticker",
      note: "Mapped the submitted identifier into the internal ticker field.",
    });
  }

  if ("direction" in rawOutput || "side" in rawOutput) {
    notes.push({
      sourceField: "direction" in rawOutput ? "direction" : "side",
      targetField: "direction",
      note: "Normalized the directional research signal for replay scoring.",
    });
  }

  if ("conviction" in rawOutput || "confidence" in rawOutput || "score" in rawOutput) {
    notes.push({
      sourceField:
        "conviction" in rawOutput
          ? "conviction"
          : "confidence" in rawOutput
            ? "confidence"
            : "score",
      targetField: "conviction",
      note: "Clamped the submitted confidence value into the 0.0-1.0 conviction range.",
    });
  }

  notes.push({
    sourceField:
      "reasoning" in rawOutput
        ? "reasoning"
        : "thesis" in rawOutput
          ? "thesis"
          : "explanation" in rawOutput
            ? "explanation"
            : "reasoning",
    targetField: "reasoning",
    note: "Preserved the submitted explanation as the internal reasoning field.",
  });

  return notes;
}

function isLikelyPublicEndpoint(targetUrl: URL) {
  const hostname = targetUrl.hostname.toLowerCase();

  if (hostname === "localhost" || hostname.endsWith(".local")) {
    return false;
  }

  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
    const octets = hostname.split(".").map((part) => Number(part));

    if (octets[0] === 10 || octets[0] === 127) {
      return false;
    }

    if (octets[0] === 192 && octets[1] === 168) {
      return false;
    }

    if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) {
      return false;
    }
  }

  return true;
}

async function probeApiEndpoint(urlString: string) {
  const targetUrl = new URL(urlString);

  if (targetUrl.protocol !== "https:") {
    throw new Error("API endpoint submissions must use HTTPS.");
  }

  if (!isLikelyPublicEndpoint(targetUrl)) {
    throw new Error("API endpoint submissions must use a publicly reachable host.");
  }

  const startedAt = Date.now();

  try {
    const response = await fetch(targetUrl, {
      method: "GET",
      signal: AbortSignal.timeout(7_500),
      cache: "no-store",
    });
    const responsePayload = await response.clone().text().catch(() => "");

    await recordApiActivityEventSafe({
      service: "SUBMITTED_AGENT_API",
      category: "HR",
      operation: "probe-endpoint",
      method: "GET",
      url: targetUrl.toString(),
      statusCode: response.status,
      durationMs: Date.now() - startedAt,
      responseHeaders: response.headers,
      responsePayload,
      errorMessage: response.ok ? null : `HTTP ${response.status}`,
    });

    return {
      status: response.status,
      contentType: response.headers.get("content-type"),
      server: response.headers.get("server"),
    };
  } catch (error) {
    await recordApiActivityEventSafe({
      service: "SUBMITTED_AGENT_API",
      category: "HR",
      operation: "probe-endpoint",
      method: "GET",
      url: targetUrl.toString(),
      durationMs: Date.now() - startedAt,
      errorMessage:
        error instanceof Error ? error.message : "Endpoint probe failed unexpectedly.",
    });
    throw error;
  }
}

async function getSubmissionWorkspaceRoot(application: AgentApplication) {
  const extractedRoot = path.join(
    getHrWorkspaceRoot(application.id, "quarantine"),
    "extracted"
  );
  const workspaceRoot = await resolveWorkspaceRoot(extractedRoot);

  if (!(await fileExists(workspaceRoot))) {
    throw new Error("Quarantine workspace is missing. Re-run the intake stage.");
  }

  return workspaceRoot;
}

export async function inspectCodeArchiveWorkspace(
  workspaceRoot: string
): Promise<Extract<InvocationPlan, { kind: "code-archive" }>> {
  const templateManifest = await findSubmissionManifestInWorkspace(workspaceRoot);

  if (templateManifest?.kind === "agent-template") {
    const agentPath = path.join(workspaceRoot, "agent.py");

    if (!(await fileExists(agentPath))) {
      throw new Error("Template submissions must include a root agent.py next to manifest.yaml.");
    }

    return {
      kind: "code-archive",
      command: buildTemplateAgentSmokeCommand({
        agentName: templateManifest.name,
        metrics: templateManifest.metrics,
        responseFormats: templateManifest.responseFormats,
      }),
      cwd: workspaceRoot,
      descriptor: `${templateManifest.path} + agent.py`,
    };
  }

  if (templateManifest?.kind === "runtime") {
    if (!templateManifest.validation.valid) {
      throw new Error(
        `Unable to execute ${templateManifest.path}: ${templateManifest.validation.errors.join("; ")}`
      );
    }

    const command =
      templateManifest.command ??
      (templateManifest.entrypoint && templateManifest.runtime
        ? templateManifest.runtime === "python"
          ? ["python3", templateManifest.entrypoint]
          : ["node", templateManifest.entrypoint]
        : null);

    if (command) {
      return {
        kind: "code-archive",
        command,
        cwd: templateManifest.cwd
          ? path.join(workspaceRoot, templateManifest.cwd)
          : workspaceRoot,
        descriptor: `manifest ${templateManifest.path}`,
      };
    }
  }

  const manifestCandidates = [
    "manifest.json",
    "potato-chips-ai-agent.json",
    "potato-chips-ai.json",
    "gpt-capital-agent.json",
    "gpt-capital.json",
    "agent.json",
  ].map((fileName) => path.join(workspaceRoot, fileName));

  for (const manifestPath of manifestCandidates) {
    if (!(await fileExists(manifestPath))) {
      continue;
    }

    const preview = await readTextPreview(manifestPath, 16_000);

    if (!preview) {
      continue;
    }

    try {
      const parsed = JSON.parse(preview) as {
        command?: unknown;
        cwd?: unknown;
        entrypoint?: unknown;
        runtime?: unknown;
      };
      const command =
        parseCommand(parsed.command) ??
        (typeof parsed.entrypoint === "string" && typeof parsed.runtime === "string"
          ? parsed.runtime === "python"
            ? ["python3", parsed.entrypoint]
            : ["node", parsed.entrypoint]
          : null);

      if (command) {
        const cwd =
          typeof parsed.cwd === "string" && parsed.cwd.trim()
            ? path.join(workspaceRoot, parsed.cwd.trim())
            : workspaceRoot;

        return {
          kind: "code-archive",
          command,
          cwd,
          descriptor: `manifest ${path.basename(manifestPath)}`,
        };
      }
    } catch {
      continue;
    }
  }

  const directCandidates = [
    ["index.js", ["node", "index.js"]],
    ["index.mjs", ["node", "index.mjs"]],
    ["main.js", ["node", "main.js"]],
    ["main.mjs", ["node", "main.mjs"]],
    ["main.py", ["python3", "main.py"]],
  ] as const;

  for (const [relativePath, command] of directCandidates) {
    if (await fileExists(path.join(workspaceRoot, relativePath))) {
      return {
        kind: "code-archive",
        command: [...command],
        cwd: workspaceRoot,
        descriptor: relativePath,
      };
    }
  }

  const packageJsonPath = path.join(workspaceRoot, "package.json");

  if (await fileExists(packageJsonPath)) {
    const preview = await readTextPreview(packageJsonPath, 20_000);

    if (preview) {
      try {
        const packageJson = JSON.parse(preview) as {
          main?: unknown;
        };

        if (typeof packageJson.main === "string" && packageJson.main.trim()) {
          const entryPath = packageJson.main.trim();

          if (await fileExists(path.join(workspaceRoot, entryPath))) {
            return {
              kind: "code-archive",
              command: ["node", entryPath],
              cwd: workspaceRoot,
              descriptor: `package.json main (${entryPath})`,
            };
          }
        }
      } catch {
        // Ignore malformed package.json here; security scanning will flag it elsewhere.
      }
    }
  }

  throw new Error(
    "Unable to determine how to execute the submitted archive. Include manifest.yaml plus agent.py from the Potato Chips AI template, potato-chips-ai-agent.json, a root index.js/main.js/main.py, or a package.json main entry that reads JSON from stdin and writes JSON to stdout."
  );
}

async function detectCodeArchivePlan(application: AgentApplication): Promise<InvocationPlan> {
  const workspaceRoot = await getSubmissionWorkspaceRoot(application);

  return inspectCodeArchiveWorkspace(workspaceRoot);
}

async function detectWrappedModelPlan(
  application: AgentApplication
): Promise<Extract<InvocationPlan, { kind: "wrapped-model" }> | null> {
  const workspaceRoot = await getSubmissionWorkspaceRoot(application);

  for (const candidate of [
    "potato-chips-ai-model.json",
    "gpt-capital-model.json",
    "model.json",
  ]) {
    const manifestPath = path.join(workspaceRoot, candidate);

    if (!(await fileExists(manifestPath))) {
      continue;
    }

    const preview = await readTextPreview(manifestPath, 24_000);

    if (!preview) {
      continue;
    }

    try {
      const parsed = JSON.parse(preview) as {
        systemPrompt?: unknown;
        instructions?: unknown;
        prompt?: unknown;
        userPromptPrefix?: unknown;
      };
      const systemPrompt =
        typeof parsed.systemPrompt === "string" && parsed.systemPrompt.trim()
          ? parsed.systemPrompt.trim()
          : typeof parsed.instructions === "string" && parsed.instructions.trim()
            ? parsed.instructions.trim()
            : typeof parsed.prompt === "string" && parsed.prompt.trim()
              ? parsed.prompt.trim()
              : "";

      if (!systemPrompt) {
        continue;
      }

      return {
        kind: "wrapped-model",
        descriptor: candidate,
        sourcePath: manifestPath,
        systemPrompt,
        userPromptPrefix:
          typeof parsed.userPromptPrefix === "string" ? parsed.userPromptPrefix.trim() : "",
        supportingContext: (await collectWrappedModelContext(application, workspaceRoot)).map(
          (item) => item.content
        ),
      };
    } catch {
      continue;
    }
  }

  const contextSnippets = await collectWrappedModelContext(application, workspaceRoot);
  const primarySource = contextSnippets[0]?.sourcePath ?? null;
  const hasSubmissionContext =
    contextSnippets.length > 0 ||
    Boolean(
      application.description.trim() ||
        application.claimedEdge.trim() ||
        application.dataSourcesRequired.trim()
    );

  if (!hasSubmissionContext) {
    return null;
  }

  return {
    kind: "wrapped-model",
    descriptor:
      contextSnippets.length > 0
        ? "documentation-driven wrapper"
        : "metadata-driven wrapper",
    sourcePath: primarySource,
    systemPrompt: buildWrappedModelSystemPrompt(application),
    userPromptPrefix:
      "Treat the provided submission artifacts, README/spec excerpts, and form metadata as the source of truth for how this wrapped agent should behave.",
    supportingContext: contextSnippets.map((item) => item.content),
  };
}

function buildWrappedModelUserPrompt(
  application: AgentApplication,
  plan: Extract<InvocationPlan, { kind: "wrapped-model" }>,
  scenario: AgentScenario
) {
  const prefix = plan.userPromptPrefix ? `${plan.userPromptPrefix}\n\n` : "";
  const supportingContext =
    plan.supportingContext.length > 0
      ? `Submission documentation excerpts:\n${plan.supportingContext
          .map((item, index) => `--- Context ${index + 1} ---\n${item}`)
          .join("\n\n")}\n\n`
      : "";

  return `${prefix}${supportingContext}You are being wrapped as a Potato Chips AI research agent.

Read the financial-research scenario below and return exactly one JSON object matching the requested signal schema.

Behavior requirements:
- Make a concrete research classification for the supplied symbol only.
- Use conviction between 0 and 1.
- Keep any legacy sizing or boundary fields conservative.
- Explain the research judgment in plain English.

Submission context:
${JSON.stringify(
    {
      agentName: application.agentName,
      description: application.description,
      claimedEdge: application.claimedEdge,
      dataSourcesRequired: application.dataSourcesRequired,
      packageType: application.packageType,
    },
    null,
    2
  )}

Scenario:
${JSON.stringify(scenario, null, 2)}

Return JSON with keys:
- ticker
- direction
- conviction
- time_horizon
- stop_loss_pct
- take_profit_pct
- max_position_pct
- reasoning
- data_sources
- correlation_id`;
}

function validateWrappedModelSignal(
  payload: Record<string, unknown>,
  scenario: AgentScenario
) {
  const ticker =
    typeof payload.ticker === "string" && payload.ticker.trim()
      ? payload.ticker.trim().toUpperCase()
      : scenario.symbol.toUpperCase();
  const direction =
    payload.direction === "short" || payload.direction === "close"
      ? payload.direction
      : "long";
  const timeHorizon =
    payload.time_horizon === "intraday" ||
    payload.time_horizon === "position"
      ? payload.time_horizon
      : "swing";
  const conviction = clamp(
    typeof payload.conviction === "number" ? payload.conviction : 0.55,
    0,
    1
  );
  const stopLossPct = clamp(
    typeof payload.stop_loss_pct === "number" ? payload.stop_loss_pct : 0.03,
    0.005,
    0.2
  );
  const takeProfitPct = clamp(
    typeof payload.take_profit_pct === "number" ? payload.take_profit_pct : 0.08,
    0.01,
    0.5
  );
  const maxPositionPct = clamp(
    typeof payload.max_position_pct === "number" ? payload.max_position_pct : 0.03,
    0.0025,
    0.1
  );
  const reasoning =
    typeof payload.reasoning === "string" && payload.reasoning.trim()
      ? payload.reasoning.trim()
      : `Wrapped model generated a ${direction} view for ${ticker}.`;
  const dataSources = Array.isArray(payload.data_sources)
    ? payload.data_sources.filter((value): value is string => typeof value === "string")
    : ["scenario.lookbackBars", "scenario.recentHeadlines"];
  const correlationId =
    typeof payload.correlation_id === "string" && payload.correlation_id.trim()
      ? payload.correlation_id.trim()
      : `wrapped-model-${ticker}-${scenario.asOf}`;

  return {
    ticker,
    direction,
    conviction: Number(conviction.toFixed(4)),
    time_horizon: timeHorizon,
    stop_loss_pct: Number(stopLossPct.toFixed(4)),
    take_profit_pct: Number(takeProfitPct.toFixed(4)),
    max_position_pct: Number(maxPositionPct.toFixed(4)),
    reasoning,
    data_sources: dataSources,
    correlation_id: correlationId,
  } satisfies NativeAgentOutput;
}

async function invokeArchiveCommand(
  application: AgentApplication,
  plan: Extract<InvocationPlan, { kind: "code-archive" }>,
  scenario: AgentScenario
) {
  const sandboxAvailable = await runHrCommand({
    command: "sandbox-exec",
    args: ["-p", "(version 1) (allow default)", "/usr/bin/true"],
    timeoutMs: 2_000,
  })
    .then(() => true)
    .catch(() => false);

  if (!sandboxAvailable && process.env.HR_AGENT_ALLOW_UNSANDBOXED_CODE_EXECUTION !== "true") {
    throw new Error(
      "This host cannot safely execute submitted code archives because sandbox-exec is unavailable."
    );
  }

  const command = sandboxAvailable ? "sandbox-exec" : plan.command[0]!;
  const args = sandboxAvailable
    ? ["-p", buildSandboxProfile(), ...plan.command]
    : plan.command.slice(1);
  const requestedEnvVars = await getRequestedEnvVarsForWorkspace(plan.cwd).catch(
    () => []
  );
  const runtimeEnv = await buildSubmittedAgentEnvironment({
    extraEnv: {
      PYTHONUNBUFFERED: "1",
    },
    requestedEnvVars,
  });
  const result = await runHrCommand({
    command,
    args,
    cwd: plan.cwd,
    stdin: `${JSON.stringify(scenario)}\n`,
    timeoutMs: SUBMISSION_EXECUTION_LIMITS.timeoutMs,
    env: runtimeEnv.env,
  });

  if (result.exitCode !== 0) {
    throw new Error(
      `Submitted archive exited with status ${result.exitCode}: ${result.stderr || "no stderr"}`
    );
  }

  const rawOutput = extractJsonPayload(result.stdout);

  return {
    scenario,
    rawOutput,
    translatedSignal: adaptNativeOutputToSignalContract({
      nativeOutput: rawOutput,
      agentId: application.id,
      agentType: application.type,
    }),
    executionSummary: `Executed ${plan.command.join(" ")} from ${plan.descriptor}.`,
    stdout: result.stdout,
    stderr: result.stderr,
  } satisfies AgentInvocation;
}

async function invokeWrappedModelSubmission(
  application: AgentApplication,
  plan: Extract<InvocationPlan, { kind: "wrapped-model" }>,
  scenario: AgentScenario
) {
  const rawOutput = await requestConfiguredJsonObject<NativeAgentOutput>({
    systemPrompt: plan.systemPrompt,
    userPrompt: buildWrappedModelUserPrompt(application, plan, scenario),
    errorContext: `wrapped model submission for ${application.id}`,
    anthropicSchema: WRAPPED_MODEL_SIGNAL_SCHEMA,
    validate: (payload) => validateWrappedModelSignal(payload, scenario),
    route: "hr",
  });

  return {
    scenario,
    rawOutput,
    translatedSignal: adaptNativeOutputToSignalContract({
      nativeOutput: rawOutput,
      agentId: application.id,
      agentType: application.type,
    }),
    executionSummary:
      plan.sourcePath
        ? `Wrapped ${path.basename(plan.sourcePath)} into the research-agent signal contract.`
        : "Wrapped the submission metadata into the research-agent signal contract.",
    stdout: JSON.stringify(rawOutput, null, 2),
    stderr: "",
  } satisfies AgentInvocation;
}

async function invokeApiSubmission(
  application: AgentApplication,
  plan: Extract<InvocationPlan, { kind: "api-endpoint" }>,
  scenario: AgentScenario
) {
  const startedAt = Date.now();
  const requestHeaders = {
    accept: "application/json",
    "content-type": "application/json",
  };
  let text = "";
  let responseHeaders: Headers | null = null;
  let statusCode: number | null = null;

  try {
    const response = await fetch(plan.url, {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify(scenario),
      signal: AbortSignal.timeout(SUBMISSION_EXECUTION_LIMITS.timeoutMs),
      cache: "no-store",
    });
    statusCode = response.status;
    responseHeaders = response.headers;
    text = await response.text();

    await recordApiActivityEventSafe({
      service: "SUBMITTED_AGENT_API",
      category: "HR",
      operation: "invoke-submitted-endpoint",
      method: "POST",
      url: plan.url,
      statusCode,
      durationMs: Date.now() - startedAt,
      requestHeaders,
      requestPayload: scenario,
      responseHeaders,
      responsePayload: text,
      errorMessage: response.ok ? null : `HTTP ${response.status}`,
      metadata: {
        applicationId: application.id,
      },
    });

    if (!response.ok) {
      throw new Error(`API endpoint returned HTTP ${response.status}.`);
    }
  } catch (error) {
    if (statusCode === null) {
      await recordApiActivityEventSafe({
        service: "SUBMITTED_AGENT_API",
        category: "HR",
        operation: "invoke-submitted-endpoint",
        method: "POST",
        url: plan.url,
        durationMs: Date.now() - startedAt,
        requestHeaders,
        requestPayload: scenario,
        responseHeaders,
        responsePayload: text,
        errorMessage:
          error instanceof Error
            ? error.message
            : "Submitted API invocation failed unexpectedly.",
        metadata: {
          applicationId: application.id,
        },
      });
    }

    throw error;
  }

  const rawOutput = extractJsonPayload(text);

  return {
    scenario,
    rawOutput,
    translatedSignal: adaptNativeOutputToSignalContract({
      nativeOutput: rawOutput,
      agentId: application.id,
      agentType: application.type,
    }),
    executionSummary: `Invoked API endpoint ${plan.url}.`,
    stdout: text,
    stderr: "",
  } satisfies AgentInvocation;
}

async function invokeDockerSubmission(
  application: AgentApplication,
  plan: Extract<InvocationPlan, { kind: "docker-image" }>,
  scenario: AgentScenario
) {
  const requestedEnvVars = [
    application.dataSourcesRequired,
    application.description,
    application.claimedEdge,
  ]
    .join("\n")
    .match(/\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/g) ?? [];
  const runtimeEnv = await buildSubmittedAgentEnvironment({
    requestedEnvVars,
  });
  const dockerEnvArgs = runtimeEnv.injectedEnvVarNames.flatMap((envVarName) => [
    "--env",
    envVarName,
  ]);
  const result = await runHrCommand({
    command: "docker",
    args: [
      "run",
      "--rm",
      "--network",
      "none",
      "--cpus",
      SUBMISSION_EXECUTION_LIMITS.cpuLimit,
      "--memory",
      SUBMISSION_EXECUTION_LIMITS.memoryLimit,
      ...dockerEnvArgs,
      "-i",
      plan.image,
    ],
    stdin: `${JSON.stringify(scenario)}\n`,
    timeoutMs: SUBMISSION_EXECUTION_LIMITS.timeoutMs,
    env: runtimeEnv.env,
  }).catch((error) => {
    throw new Error(
      error instanceof Error
        ? `Docker execution failed: ${error.message}`
        : "Docker execution failed."
    );
  });

  if (result.exitCode !== 0) {
    throw new Error(
      `Submitted Docker image exited with status ${result.exitCode}: ${result.stderr || "no stderr"}`
    );
  }

  const rawOutput = extractJsonPayload(result.stdout);

  return {
    scenario,
    rawOutput,
    translatedSignal: adaptNativeOutputToSignalContract({
      nativeOutput: rawOutput,
      agentId: application.id,
      agentType: application.type,
    }),
    executionSummary: `Executed Docker image ${plan.image} with network disabled.`,
    stdout: result.stdout,
    stderr: result.stderr,
  } satisfies AgentInvocation;
}

async function resolveInvocationPlan(application: AgentApplication): Promise<InvocationPlan> {
  if (application.packageType === "api-endpoint") {
    return {
      kind: "api-endpoint",
      url: application.packageReference.trim(),
      descriptor: application.packageReference.trim(),
    };
  }

  if (application.packageType === "docker-image") {
    return {
      kind: "docker-image",
      image: application.packageReference.trim(),
      descriptor: application.packageReference.trim(),
    };
  }

  try {
    return await detectCodeArchivePlan(application);
  } catch (error) {
    const wrappedModelPlan = await detectWrappedModelPlan(application);

    if (wrappedModelPlan) {
      return wrappedModelPlan;
    }

    throw error;
  }
}

export async function inspectSubmissionExecutionPlan(application: AgentApplication) {
  const plan = await resolveInvocationPlan(application);

  if (plan.kind === "code-archive") {
    return {
      kind: plan.kind,
      descriptor: plan.descriptor,
      command: plan.command.join(" "),
      cwd: plan.cwd,
    };
  }

  if (plan.kind === "api-endpoint") {
    return {
      kind: plan.kind,
      descriptor: plan.descriptor,
      command: `POST ${plan.url}`,
      cwd: null,
    };
  }

  if (plan.kind === "wrapped-model") {
    return {
      kind: plan.kind,
      descriptor: plan.descriptor,
      command: plan.sourcePath
        ? `Wrapped model source ${path.basename(plan.sourcePath)}`
        : "Wrapped submission metadata",
      cwd: plan.sourcePath ? path.dirname(plan.sourcePath) : null,
    };
  }

  return {
    kind: plan.kind,
    descriptor: plan.descriptor,
    command: `docker run ${plan.image}`,
    cwd: null,
  };
}

export async function invokeSubmittedAgent(
  application: AgentApplication,
  scenario: AgentScenario
) {
  const plan = await resolveInvocationPlan(application);

  if (plan.kind === "api-endpoint") {
    return invokeApiSubmission(application, plan, scenario);
  }

  if (plan.kind === "docker-image") {
    return invokeDockerSubmission(application, plan, scenario);
  }

  if (plan.kind === "wrapped-model") {
    return invokeWrappedModelSubmission(application, plan, scenario);
  }

  return invokeArchiveCommand(application, plan, scenario);
}

export async function probeSubmissionTarget(application: AgentApplication) {
  if (application.packageType === "api-endpoint") {
    return probeApiEndpoint(application.packageReference.trim());
  }

  if (application.packageType === "docker-image") {
    const dockerCheck = await runHrCommand({
      command: "docker",
      args: ["--version"],
      timeoutMs: 5_000,
    }).catch(() => null);

    if (!dockerCheck || dockerCheck.exitCode !== 0) {
      throw new Error("Docker is not installed on this host, so Docker-image submissions cannot be quarantined yet.");
    }

    return {
      status: 200,
      contentType: "application/vnd.docker.distribution.manifest.v2+json",
      server: "docker",
    };
  }

  const persistedArtifact = await getPersistedSubmissionArtifact(application.id, "agent-package");

  if (!persistedArtifact) {
    throw new Error("Uploaded agent archive is missing from HR storage.");
  }

  return {
    status: 200,
    contentType: path.extname(persistedArtifact).toLowerCase(),
    server: "local-upload",
  };
}

export async function buildSandboxSampleExecution(application: AgentApplication) {
  const scenario = await buildConformanceScenario(application);
  const invocation = await invokeSubmittedAgent(application, scenario);

  return {
    rawAgentOutput: JSON.stringify(invocation.rawOutput, null, 2),
    sampleSignal: invocation.translatedSignal,
    mappingNotes: normalizeMappingNotes(invocation.rawOutput),
    invocation,
  };
}

function findBarIndexByTimestamp(bars: HistoricalBar[], timestamp: string) {
  return bars.findIndex((bar) => bar.timestamp === timestamp);
}

function computeTradeReturn(signal: SignalOutput, currentPrice: number, nextPrice: number) {
  const rawReturn = (nextPrice - currentPrice) / currentPrice;
  const signedReturn =
    signal.direction === "short"
      ? -rawReturn
      : signal.direction === "close"
        ? 0
        : rawReturn;
  const boundedReturn = Math.min(
    signal.take_profit_pct,
    Math.max(-signal.stop_loss_pct, signedReturn)
  );
  const exposure = clamp(signal.max_position_pct * Math.max(signal.conviction, 0.1), 0.0025, 0.1);

  return {
    rawReturnPct: signedReturn * 100,
    boundedReturnPct: boundedReturn * 100,
    weightedReturn: boundedReturn * exposure,
    exposure,
  };
}

async function buildProxyReturnSeries(
  application: AgentApplication,
  timestamps: string[],
  window?: ScenarioWindow
) {
  const proxySymbols =
    application.type === "macro"
      ? ["SPY", "TLT", "GLD"]
      : application.type === "event"
        ? ["IWM", "XLF", "DAL"]
        : application.type === "sentiment"
          ? ["QQQ", "NVDA", "COIN"]
          : ["SPY", "QQQ", "IWM"];
  const barsBySymbol = new Map<string, HistoricalBar[]>();

  for (const symbol of proxySymbols) {
    try {
      barsBySymbol.set(symbol, await getHistoricalBars(symbol, window));
    } catch {
      barsBySymbol.set(symbol, []);
    }
  }

  return timestamps.map((timestamp) => {
    const returns = proxySymbols
      .map((symbol) => {
        const bars = barsBySymbol.get(symbol) ?? [];
        const currentIndex = findBarIndexByTimestamp(bars, timestamp);
        const current = currentIndex >= 0 ? bars[currentIndex] : null;
        const next = currentIndex >= 0 ? bars[currentIndex + 1] : null;

        if (!current?.close || !next?.close) {
          return null;
        }

        return (next.close - current.close) / current.close;
      })
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value));

    if (returns.length === 0) {
      return null;
    }

    return returns.reduce((sum, value) => sum + value, 0) / returns.length;
  });
}

async function buildAverageReturnSeries(
  symbols: string[],
  timestamps: string[],
  window?: ScenarioWindow
) {
  const barsBySymbol = new Map<string, HistoricalBar[]>();

  for (const symbol of symbols) {
    try {
      barsBySymbol.set(symbol, await getHistoricalBars(symbol, window));
    } catch {
      barsBySymbol.set(symbol, []);
    }
  }

  return timestamps.map((timestamp) => {
    const returns = symbols
      .map((symbol) => {
        const bars = barsBySymbol.get(symbol) ?? [];
        const currentIndex = findBarIndexByTimestamp(bars, timestamp);
        const current = currentIndex >= 0 ? bars[currentIndex] : null;
        const next = currentIndex >= 0 ? bars[currentIndex + 1] : null;

        if (!current?.close || !next?.close) {
          return null;
        }

        return (next.close - current.close) / current.close;
      })
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value));

    if (returns.length === 0) {
      return null;
    }

    return returns.reduce((sum, value) => sum + value, 0) / returns.length;
  });
}

function calculateCorrelation(left: number[], right: number[]) {
  if (left.length !== right.length || left.length < 2) {
    return null;
  }

  const leftMean = left.reduce((sum, value) => sum + value, 0) / left.length;
  const rightMean = right.reduce((sum, value) => sum + value, 0) / right.length;
  const numerator = left.reduce(
    (sum, value, index) => sum + (value - leftMean) * ((right[index] ?? 0) - rightMean),
    0
  );
  const leftVariance = left.reduce((sum, value) => sum + (value - leftMean) ** 2, 0);
  const rightVariance = right.reduce((sum, value) => sum + (value - rightMean) ** 2, 0);
  const denominator = Math.sqrt(leftVariance * rightVariance);

  if (!Number.isFinite(denominator) || denominator === 0) {
    return null;
  }

  return Number((numerator / denominator).toFixed(2));
}

function deriveWindowFromTimestamps(timestamps: string[]): ScenarioWindow | null {
  if (timestamps.length === 0) {
    return null;
  }

  const sorted = [...timestamps].sort();

  return {
    from: sorted[0]!.slice(0, 10),
    to: sorted[sorted.length - 1]!.slice(0, 10),
  };
}

async function buildCorrelationSummary(
  application: AgentApplication,
  timestamps: string[],
  weightedReturns: number[],
  window?: ScenarioWindow
) {
  const resolvedWindow = window ?? deriveWindowFromTimestamps(timestamps) ?? undefined;
  const seriesByKey = {
    existingAgents: await buildProxyReturnSeries(application, timestamps, resolvedWindow),
    sp500: await buildAverageReturnSeries(["SPY"], timestamps, resolvedWindow),
    rates: await buildAverageReturnSeries(["TLT"], timestamps, resolvedWindow),
    vol: await buildAverageReturnSeries(["VXX", "UVXY"], timestamps, resolvedWindow),
  };
  const correlations = {
    correlationWithExistingAgents: null as number | null,
    correlationWithSp500: null as number | null,
    correlationWithRates: null as number | null,
    correlationWithVol: null as number | null,
  };

  for (const [key, series] of Object.entries(seriesByKey)) {
    const comparableReturns = weightedReturns
      .map((value, index) =>
        typeof series[index] === "number" ? [value, series[index]!] : null
      )
      .filter((pair): pair is [number, number] => Boolean(pair));
    const correlation =
      comparableReturns.length >= 2
        ? calculateCorrelation(
            comparableReturns.map((pair) => pair[0]),
            comparableReturns.map((pair) => pair[1])
          )
        : null;

    if (key === "existingAgents") {
      correlations.correlationWithExistingAgents = correlation;
    } else if (key === "sp500") {
      correlations.correlationWithSp500 = correlation;
    } else if (key === "rates") {
      correlations.correlationWithRates = correlation;
    } else if (key === "vol") {
      correlations.correlationWithVol = correlation;
    }
  }

  return correlations;
}

async function summarizeTrades(
  application: AgentApplication,
  trades: EvaluationTrade[],
  window?: ScenarioWindow
) {
  if (trades.length === 0) {
    throw new Error("Research replay could not score any completed scenarios.");
  }

  const weightedReturns = trades.map(
    (trade) => (trade.boundedReturnPct / 100) * (trade.grossExposurePct / 100)
  );
  const timestamps = trades.map((trade) => trade.asOf);
  const grossExposures = trades.map((trade) => trade.grossExposurePct / 100);
  const turnovers = trades.map((trade) => trade.turnoverPct / 100);
  const correlations = await buildCorrelationSummary(application, timestamps, weightedReturns, window);
  const transactionCostDragPct = turnovers.reduce(
    (sum, turnover) => sum + turnover * 0.001 * 100,
    0
  );
  const grossReturnPct = ((trades[trades.length - 1]!.portfolioValue - 100_000) / 100_000) * 100;
  const pnlSeries = trades.map((trade) => ({
    timestamp: trade.nextTimestamp,
    value: trade.portfolioValue,
  }));
  const metrics = scoreAgentPerformance({
    pnlSeries,
    totalSignalsGenerated: trades.length,
    winningSignals: trades.filter((trade) => trade.boundedReturnPct > 0).length,
    correlationWithExistingAgents: correlations.correlationWithExistingAgents,
    correlationWithSp500: correlations.correlationWithSp500,
    correlationWithRates: correlations.correlationWithRates,
    correlationWithVol: correlations.correlationWithVol,
    grossExposures,
    turnovers,
    transactionCostDragPct,
    netReturnPct: grossReturnPct - transactionCostDragPct,
  });

  return {
    metrics: metrics satisfies HrPerformanceMetrics,
    grossReturnPct: Number(grossReturnPct.toFixed(2)),
    transactionCostDragPct: Number(transactionCostDragPct.toFixed(2)),
    timestamps,
  };
}

async function evaluateScenarios(
  application: AgentApplication,
  scenarios: AgentScenario[],
  options?: EvaluationOptions
) {
  let portfolioValue = 100_000;
  const trades: EvaluationTrade[] = [];
  let previousExposure: number | null = null;

  for (const scenario of scenarios) {
    const invocation = await invokeSubmittedAgent(application, scenario);
    const bars = await getHistoricalBars(scenario.symbol, options?.window);
    const currentIndex = findBarIndexByTimestamp(bars, scenario.asOf);
    const current = currentIndex >= 0 ? bars[currentIndex] : null;
    const next = currentIndex >= 0 ? bars[currentIndex + 1] : null;

    if (!current?.close || !next?.close) {
      continue;
    }

    const tradeReturn = computeTradeReturn(invocation.translatedSignal, current.close, next.close);
    const turnover =
      previousExposure === null
        ? tradeReturn.exposure
        : Math.abs(tradeReturn.exposure - previousExposure);

    previousExposure = tradeReturn.exposure;
    portfolioValue *= 1 + tradeReturn.weightedReturn;

    trades.push({
      regimeKey: options?.regimeKey,
      regimeLabel: options?.regimeLabel,
      symbol: scenario.symbol,
      asOf: scenario.asOf,
      nextTimestamp: next.timestamp,
      currentPrice: current.close,
      nextPrice: next.close,
      direction: invocation.translatedSignal.direction,
      conviction: invocation.translatedSignal.conviction,
      maxPositionPct: invocation.translatedSignal.max_position_pct,
      stopLossPct: invocation.translatedSignal.stop_loss_pct,
      takeProfitPct: invocation.translatedSignal.take_profit_pct,
      realizedReturnPct: Number(tradeReturn.rawReturnPct.toFixed(2)),
      boundedReturnPct: Number(tradeReturn.boundedReturnPct.toFixed(2)),
      grossExposurePct: Number((tradeReturn.exposure * 100).toFixed(2)),
      turnoverPct: Number((turnover * 100).toFixed(2)),
      portfolioValue: Number(portfolioValue.toFixed(2)),
      rawOutput: invocation.rawOutput,
      translatedSignal: invocation.translatedSignal,
    });
  }

  if (trades.length === 0) {
    throw new Error("Research replay could not score any completed scenarios.");
  }

  const summary = await summarizeTrades(application, trades, options?.window);

  return {
    metrics: summary.metrics,
    trades,
    grossReturnPct: summary.grossReturnPct,
    transactionCostDragPct: summary.transactionCostDragPct,
    timestamps: summary.timestamps,
  };
}

export async function runRealPaperEvaluation(
  application: AgentApplication,
  options?: {
    maxSymbols?: number;
    scenariosPerSymbol?: number;
    lookbackBars?: number;
    recentOnly?: boolean;
    explicitSymbols?: string[];
    window?: ScenarioWindow;
    regimeKey?: string;
    regimeLabel?: string;
  }
) {
  const scenarios = await buildHistoricalScenarios(application, {
    maxSymbols: options?.maxSymbols ?? 3,
    scenariosPerSymbol: options?.scenariosPerSymbol ?? 3,
    lookbackBars: options?.lookbackBars ?? 12,
    recentOnly: options?.recentOnly,
    explicitSymbols: options?.explicitSymbols,
    window: options?.window,
  });
  const evaluation = await evaluateScenarios(application, scenarios, {
    regimeKey: options?.regimeKey,
    regimeLabel: options?.regimeLabel,
    window: options?.window,
  });
  const tradeArtifactPath = await writeHrJsonArtifact(
    `simulation/${application.id}/${options?.regimeKey ?? "core"}-scenario-evaluations.json`,
    evaluation.trades
  );
  const summaryArtifactPath = await writeHrJsonArtifact(
    `simulation/${application.id}/${options?.regimeKey ?? "core"}-historical-replay.json`,
    {
      evaluatedScenarios: evaluation.trades.length,
      symbols: Array.from(new Set(evaluation.trades.map((trade) => trade.symbol))),
      metrics: evaluation.metrics,
      grossReturnPct: evaluation.grossReturnPct,
      transactionCostDragPct: evaluation.transactionCostDragPct,
    }
  );

  return {
    metrics: evaluation.metrics,
    trades: evaluation.trades,
    artifactPaths: [tradeArtifactPath, summaryArtifactPath],
    summary: `Ran ${evaluation.trades.length} scored replay scenarios across ${new Set(
      evaluation.trades.map((trade) => trade.symbol)
    ).size} symbols using live market data.`,
  };
}

function buildFunctionalScenarioVariants(baseScenario: AgentScenario): FunctionalScenarioDescriptor[] {
  const bars = baseScenario.lookbackBars;
  const midpoint = Math.max(1, Math.floor(bars.length / 2));
  const gapBars = bars.filter((_, index) => index !== midpoint);
  const haltedBars = bars.map((bar) => ({
    ...bar,
    open: bar.close,
    high: bar.close,
    low: bar.close,
    volume: 0,
  }));
  const delayedBars = bars.map((bar, index) =>
    index === bars.length - 1
      ? {
          ...bar,
          timestamp: bars[Math.max(0, index - 1)]?.timestamp ?? bar.timestamp,
        }
      : bar
  );

  return [
    {
      key: "baseline",
      label: "Baseline market packet",
      scenario: {
        ...baseScenario,
        marketConditions: {
          feedStatus: "normal",
          simulatedSpreadBps: 8,
          partialFillProbability: 0.05,
        },
      },
      maxPositionPct: 0.1,
    },
    {
      key: "data-gap",
      label: "Data gap handling",
      scenario: {
        ...baseScenario,
        lookbackBars: gapBars,
        recentHeadlines: [],
        marketConditions: {
          feedStatus: "delayed",
          simulatedSpreadBps: 15,
          partialFillProbability: 0.15,
        },
      },
      maxPositionPct: 0.05,
      maxConviction: 0.7,
    },
    {
      key: "halted-symbol",
      label: "Halted ticker handling",
      scenario: {
        ...baseScenario,
        lookbackBars: haltedBars,
        recentHeadlines: [`${baseScenario.symbol} volatility pause / market halt scenario.`],
        marketConditions: {
          feedStatus: "halted",
          simulatedSpreadBps: 60,
          partialFillProbability: 0.5,
        },
      },
      maxPositionPct: 0.02,
      maxConviction: 0.35,
    },
    {
      key: "stale-feed",
      label: "Delayed feed / timeout packet",
      scenario: {
        ...baseScenario,
        lookbackBars: delayedBars,
        recentHeadlines: [
          ...baseScenario.recentHeadlines,
          "Market-data heartbeat delayed; fallback packet may be stale.",
        ],
        marketConditions: {
          feedStatus: "delayed",
          simulatedSpreadBps: 25,
          partialFillProbability: 0.25,
        },
      },
      maxPositionPct: 0.04,
      maxConviction: 0.5,
    },
  ];
}

function assessFunctionalSignal(
  descriptor: FunctionalScenarioDescriptor,
  signal: SignalOutput
): HrFunctionalTestResult {
  const notes: string[] = [];
  let status: HrFunctionalTestResult["status"] = "pass";

  if (signal.max_position_pct > 0.1) {
    status = "fail";
    notes.push("Breached the platform max-position limit of 10%.");
  } else if (
    typeof descriptor.maxPositionPct === "number" &&
    signal.max_position_pct > descriptor.maxPositionPct
  ) {
    status = "warn";
    notes.push(`Requested ${Math.round(signal.max_position_pct * 100)}% size in a stressed packet.`);
  }

  if (
    typeof descriptor.maxConviction === "number" &&
    signal.direction !== "close" &&
    signal.conviction > descriptor.maxConviction
  ) {
    status = status === "fail" ? "fail" : "warn";
    notes.push("Conviction stayed high despite degraded market conditions.");
  }

  if (signal.ticker !== "UNKNOWN" && signal.ticker !== descriptor.scenario.symbol) {
    status = status === "fail" ? "fail" : "warn";
    notes.push(`Returned ${signal.ticker} instead of the packet symbol ${descriptor.scenario.symbol}.`);
  }

  return {
    key: descriptor.key,
    label: descriptor.label,
    status,
    detail:
      notes.join(" ") ||
      `Returned a valid ${signal.direction} signal with ${Math.round(signal.max_position_pct * 100)}% max position.`,
  };
}

function classifyRegimeOutcome(metrics: HrPerformanceMetrics): HrRegimeBacktestResult["status"] {
  if ((metrics.maxDrawdownPct ?? 0) > 18 || metrics.totalSignalsGenerated === 0) {
    return "fail";
  }

  if ((metrics.maxDrawdownPct ?? 0) > 12 || (metrics.netReturnPct ?? 0) < 0) {
    return "warn";
  }

  return "pass";
}

export async function runSandboxEvaluation(application: AgentApplication) {
  const sample = await buildSandboxSampleExecution(application);
  const functionalTests: HrFunctionalTestResult[] = [];

  for (const descriptor of buildFunctionalScenarioVariants(sample.invocation.scenario)) {
    try {
      const invocation = await invokeSubmittedAgent(application, descriptor.scenario);
      functionalTests.push(assessFunctionalSignal(descriptor, invocation.translatedSignal));
    } catch (error) {
      functionalTests.push({
        key: descriptor.key,
        label: descriptor.label,
        status: "fail",
        detail: error instanceof Error ? error.message : "Functional scenario failed.",
      });
    }
  }

  const regimeResults: HrRegimeBacktestResult[] = [];
  const allTrades: EvaluationTrade[] = [];
  const artifactPaths: string[] = [];

  for (const regime of buildRandomHistoricalWindows(application.id, 10)) {
    try {
      const evaluation = await runRealPaperEvaluation(application, {
        maxSymbols: 2,
        scenariosPerSymbol: 1,
        lookbackBars: 15,
        window: regime.window,
        regimeKey: regime.key,
        regimeLabel: regime.label,
      });
      allTrades.push(...evaluation.trades);
      artifactPaths.push(...evaluation.artifactPaths);
      regimeResults.push({
        key: regime.key,
        label: regime.label,
        windowLabel: `${regime.window.from} to ${regime.window.to}`,
        evaluatedSignals: evaluation.metrics.totalSignalsGenerated,
        totalReturnPct: evaluation.metrics.netReturnPct,
        sharpeRatio: evaluation.metrics.sharpeRatio,
        maxDrawdownPct: evaluation.metrics.maxDrawdownPct,
        worstDayPct: evaluation.metrics.worstDayPct,
        notes: [
          `Correlation to current sleeves proxy: ${evaluation.metrics.correlationWithExistingAgents ?? "n/a"}.`,
          `Transaction cost drag: ${evaluation.metrics.transactionCostDragPct ?? "n/a"}%.`,
        ],
        status: classifyRegimeOutcome(evaluation.metrics),
      });
    } catch (error) {
      regimeResults.push({
        key: regime.key,
        label: regime.label,
        windowLabel: `${regime.window.from} to ${regime.window.to}`,
        evaluatedSignals: 0,
        totalReturnPct: null,
        sharpeRatio: null,
        maxDrawdownPct: null,
        worstDayPct: null,
        notes: [error instanceof Error ? error.message : "Regime replay failed."],
        status: "fail",
      });
    }
  }

  if (allTrades.length === 0) {
    throw new Error("Historical replay review could not complete any replay scenarios.");
  }

  const aggregateMetrics = (await summarizeTrades(application, allTrades)).metrics;

  return {
    report: {
      summary:
        "Ran sample execution checks and ten deterministic-random historical windows drawn from the past 20 years.",
      replayNotes: [
        "Each review window is chosen from the past 20 years using the application ID as a deterministic random seed.",
        "Historical prices are replayed as fixed market state; candidate signals do not move the market in this phase.",
        "This stage is meant to answer whether the submission behaves sensibly before it is allowed anywhere near live simulation.",
      ],
      rawAgentOutput: sample.rawAgentOutput,
      sampleSignal: sample.sampleSignal,
      functionalTests,
      regimeResults,
      metrics: aggregateMetrics,
    } satisfies HrSandboxReport,
    artifactPaths,
  };
}

function buildStressScenario(
  baseScenario: AgentScenario,
  kind: HrStressTestResult["key"]
): AgentScenario {
  if (kind === "data-poisoning") {
    return {
      ...baseScenario,
      lookbackBars: baseScenario.lookbackBars.map((bar, index) =>
        index === baseScenario.lookbackBars.length - 1
          ? {
              ...bar,
              open: bar.close,
              high: bar.low,
              low: bar.high,
              close: bar.close ? -Math.abs(bar.close) : bar.close,
            }
          : bar
      ),
      marketConditions: {
        feedStatus: "poisoned",
        simulatedSpreadBps: 35,
        partialFillProbability: 0.3,
      },
    };
  }

  if (kind === "liquidity-withdrawal") {
    return {
      ...baseScenario,
      marketConditions: {
        feedStatus: "normal",
        simulatedSpreadBps: 120,
        partialFillProbability: 0.65,
      },
      recentHeadlines: [
        ...baseScenario.recentHeadlines,
        "Liquidity shock: market depth has vanished and fills are partial.",
      ],
    };
  }

  if (kind === "correlated-drawdown") {
    return {
      ...baseScenario,
      lookbackBars: baseScenario.lookbackBars.map((bar) => ({
        ...bar,
        open: bar.close ? bar.close * 1.01 : bar.open,
        high: bar.close ? bar.close * 1.02 : bar.high,
        low: bar.close ? bar.close * 0.88 : bar.low,
        close: bar.close ? bar.close * 0.9 : bar.close,
      })),
      marketConditions: {
        feedStatus: "normal",
        simulatedSpreadBps: 45,
        partialFillProbability: 0.4,
      },
    };
  }

  return {
    ...baseScenario,
    lookbackBars: baseScenario.lookbackBars.map((bar, index) =>
      index < Math.floor(baseScenario.lookbackBars.length / 2)
        ? {
            ...bar,
            close: bar.close ? bar.close * 1.01 : bar.close,
          }
        : {
            ...bar,
            close: bar.close ? bar.close * 0.94 : bar.close,
          }
    ),
    marketConditions: {
      feedStatus: "normal",
      simulatedSpreadBps: 55,
      partialFillProbability: 0.35,
    },
  };
}

function classifyStressResponse(
  key: HrStressTestResult["key"],
  signal: SignalOutput
): Pick<HrStressTestResult, "status" | "detail"> {
  if (signal.max_position_pct > 0.1) {
    return {
      status: "fail",
      detail: "Requested more risk than the platform limit allows under stress.",
    };
  }

  if (
    (key === "data-poisoning" || key === "correlated-drawdown") &&
    signal.direction === "long" &&
    signal.conviction > 0.7
  ) {
    return {
      status: "fail",
      detail: "Stayed aggressively long in a corrupted or collapsing packet.",
    };
  }

  if (signal.conviction > 0.5 || signal.max_position_pct > 0.05) {
    return {
      status: "warn",
      detail: "Returned a valid signal but did not de-risk as much as expected.",
    };
  }

  return {
    status: "pass",
    detail: "Returned a valid, risk-reduced response under stress.",
  };
}

export async function runAdversarialEvaluation(application: AgentApplication) {
  const baseScenario = await buildConformanceScenario(application);
  const tests: HrStressTestResult[] = [];
  const blockingIssues: string[] = [];

  for (const key of [
    "data-poisoning",
    "liquidity-withdrawal",
    "correlated-drawdown",
    "rapid-regime-change",
  ] as const) {
    try {
      const invocation = await invokeSubmittedAgent(application, buildStressScenario(baseScenario, key));
      const verdict = classifyStressResponse(key, invocation.translatedSignal);

      if (verdict.status === "fail") {
        blockingIssues.push(`${key}: ${verdict.detail}`);
      }

      tests.push({
        key,
        label:
          key === "data-poisoning"
            ? "Data poisoning"
            : key === "liquidity-withdrawal"
              ? "Liquidity withdrawal"
              : key === "correlated-drawdown"
                ? "Correlated drawdown"
                : "Rapid regime change",
        status: verdict.status,
        detail: verdict.detail,
        conviction: Number(invocation.translatedSignal.conviction.toFixed(2)),
        maxPositionPct: Number((invocation.translatedSignal.max_position_pct * 100).toFixed(2)),
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Stress scenario failed.";
      blockingIssues.push(`${key}: ${detail}`);
      tests.push({
        key,
        label:
          key === "data-poisoning"
            ? "Data poisoning"
            : key === "liquidity-withdrawal"
              ? "Liquidity withdrawal"
              : key === "correlated-drawdown"
                ? "Correlated drawdown"
                : "Rapid regime change",
        status: "fail",
        detail,
        conviction: null,
        maxPositionPct: null,
      });
    }
  }

  const passCount = tests.filter((test) => test.status === "pass").length;
  const warnCount = tests.filter((test) => test.status === "warn").length;
  const resilienceScore = Number(
    ((passCount + warnCount * 0.5) / Math.max(tests.length, 1) * 100).toFixed(1)
  );

  return {
    report: {
      summary:
        "Ran adversarial packet tests against poisoned data, thin liquidity, correlated drawdowns, and abrupt regime shifts.",
      resilienceScore,
      blockingIssues,
      tests,
    } satisfies HrAdversarialReport,
  };
}

export async function runPortfolioFitAssessment(
  application: AgentApplication,
  metricsOverride?: HrPerformanceMetrics
) {
  const metrics = metricsOverride ?? application.sandboxReport.metrics;
  const snapshot = await getBrokerDashboardSnapshot().catch(() => null);
  const existingExposureCount = snapshot?.agentExposure.length ?? 0;
  const overlapScore =
    typeof metrics.correlationWithExistingAgents === "number"
      ? Number((((metrics.correlationWithExistingAgents + 1) / 2) * 100).toFixed(1))
      : null;
  const marginalSharpeDelta =
    metrics.sharpeRatio === null || metrics.correlationWithExistingAgents === null
      ? null
      : Number(
          (metrics.sharpeRatio * (1 - Math.max(metrics.correlationWithExistingAgents, 0))).toFixed(
            2
          )
        );
  const overlapAssessment =
    overlapScore === null
      ? "Ensemble overlap could not be estimated because the replay lacked comparable return series."
      : overlapScore > 75
        ? "High strategy overlap with the current sleeve mix; this candidate needs exceptional edge to justify a slot."
        : overlapScore > 50
          ? "Moderate overlap with current sleeves; useful only if live behavior is more robust than the house book."
          : "Low overlap versus the current sleeve mix; diversification benefit is plausible if the replay is trustworthy.";
  const capacityAssessment =
    (metrics.concentrationRiskPct ?? 0) > 8
      ? "Capacity looks constrained because the candidate repeatedly leans on large single-name exposure."
      : "Capacity looks acceptable for a probationary sleeve because requested exposures stay within small-book limits.";
  const interpretabilityAssessment =
    application.claimedEdge.length > 40 && application.sandboxReport.sampleSignal?.reasoning
      ? "Interpretability is acceptable: the submission documents an edge and emits human-readable research reasoning."
      : "Interpretability is weak: the strategy thesis or emitted research reasoning is too thin for comfortable research-lead oversight.";
  const portfolioRole =
    existingExposureCount === 0
      ? "No live sleeve exposure is available yet, so this candidate is best framed as a new exploratory sleeve."
      : overlapScore !== null && overlapScore < 50
        ? "Candidate appears better suited as a diversifying satellite sleeve."
        : "Candidate appears closest to a redundant overlay unless probation shows differentiated live behavior.";

  return {
    report: {
      summary:
        "Estimated the candidate's marginal value to the existing ensemble, its likely overlap with live sleeves, and whether the strategy is interpretable enough for research-lead supervision.",
      marginalSharpeDelta,
      overlapScore,
      overlapAssessment,
      capacityAssessment,
      interpretabilityAssessment,
      portfolioRole,
    } satisfies HrPortfolioFitReport,
  };
}

function hashSeed(input: string) {
  let hash = 2166136261;

  for (const character of input) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function createSeededRandom(seedInput: string) {
  let seed = hashSeed(seedInput);

  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildRandomHistoricalWindows(applicationId: string, count = 10) {
  const random = createSeededRandom(applicationId);
  const endBoundary = new Date();
  endBoundary.setUTCDate(endBoundary.getUTCDate() - 30);
  const startBoundary = new Date(endBoundary);
  startBoundary.setUTCFullYear(startBoundary.getUTCFullYear() - 20);
  const windowDays = 120;
  const dayMs = 24 * 60 * 60 * 1000;
  const latestStart = endBoundary.getTime() - windowDays * dayMs;
  const earliestStart = startBoundary.getTime();
  const spanMs = Math.max(dayMs, latestStart - earliestStart);
  const seen = new Set<string>();
  const windows: Array<{
    key: string;
    label: string;
    window: ScenarioWindow;
  }> = [];

  while (windows.length < count) {
    const startAt = new Date(earliestStart + Math.floor(random() * spanMs));
    const from = startAt.toISOString().slice(0, 10);

    if (seen.has(from)) {
      continue;
    }

    seen.add(from);
    const to = new Date(startAt.getTime() + windowDays * dayMs)
      .toISOString()
      .slice(0, 10);

    windows.push({
      key: `window-${windows.length + 1}`,
      label: `Random window ${windows.length + 1}`,
      window: {
        from,
        to,
      },
    });
  }

  return windows.sort((left, right) => left.window.from.localeCompare(right.window.from));
}

function buildRecentSimulationWindow(days = 30): ScenarioWindow {
  const to = new Date();
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - days);

  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

function formatDefaultSignal(symbol: string, ownerRows: Array<{ agentId: string; attributedQty: number | null }>) {
  if (ownerRows.length === 0) {
    return "No live sleeve currently holds this symbol.";
  }

  return ownerRows
    .map((owner) =>
      owner.attributedQty && owner.attributedQty > 0
        ? `${owner.agentId} long ${owner.attributedQty.toFixed(2)}`
        : `${owner.agentId} monitoring`
    )
    .join(" | ");
}

export async function runProbationEvaluation(
  application: AgentApplication,
  sandboxMetrics: HrPerformanceMetrics
) {
  const scenarios = await buildHistoricalScenarios(application, {
    maxSymbols: 3,
    scenariosPerSymbol: 2,
    lookbackBars: 12,
    recentOnly: true,
  });
  const snapshot = await getBrokerDashboardSnapshot().catch(() => null);
  const comparisonRows: HrShadowComparisonRow[] = [];

  for (const scenario of scenarios.slice(0, 4)) {
    const invocation = await invokeSubmittedAgent(application, scenario);
    const attributedPosition = snapshot?.attributedPositions.find(
      (position) => position.symbol.toUpperCase() === scenario.symbol.toUpperCase()
    );
    const defaultSignal = formatDefaultSignal(
      scenario.symbol,
      attributedPosition?.owners.map((owner) => ({
        agentId: owner.agentId,
        attributedQty: owner.attributedQty,
      })) ?? []
    );
    const candidateSignal = `${invocation.translatedSignal.direction} ${invocation.translatedSignal.ticker} @ conviction ${invocation.translatedSignal.conviction.toFixed(
      2
    )}`;

    comparisonRows.push({
      ticker: scenario.symbol,
      event: `Recent market context ending ${scenario.asOf.slice(0, 10)}`,
      submittedAgentSignal: candidateSignal,
      defaultAgentSignal: defaultSignal,
      divergence:
        attributedPosition?.owners.length
          ? "Candidate signal was compared against current research-sleeve context."
          : "Candidate signal was compared against the current absence of research-sleeve context.",
    });
  }

  const recentSeries = sandboxMetrics.pnlSeries.slice(
    -Math.max(3, Math.min(6, sandboxMetrics.pnlSeries.length))
  );
  const probationMetrics: HrPerformanceMetrics = {
    ...sandboxMetrics,
    totalSignalsGenerated: comparisonRows.length,
    pnlSeries: recentSeries,
  };
  const signalsArtifactPath = await writeHrTextArtifact(
    `shadow/${application.id}/signals.ndjson`,
    comparisonRows.map((row) => JSON.stringify(row)).join("\n")
  );
  const comparisonArtifactPath = await writeHrJsonArtifact(
    `shadow/${application.id}/comparison.json`,
    {
      comparedSymbols: comparisonRows.map((row) => row.ticker),
      comparisonRows,
    }
  );

  return {
    report: {
      summary:
        "Prepared a probationary deployment plan with tighter guardrails and live-vs-replay divergence monitoring.",
      startingAllocationPct: 1,
      tightenedRiskLimits: [
        "Cap confidence escalation during probation.",
        "Escalate any ensemble-level quality breach to manual review before expanding usage.",
        "Pause usage scaling if live research outputs diverge materially from sandbox expectations.",
      ],
      probationDays: 45,
      liveDivergenceThresholdPct: 15,
      promotionCriteria: [
        "Live research quality stays inside the sandbox confidence band.",
        "Probation signals remain interpretable and operationally stable.",
        "Ensemble-level throttles are infrequent and do not erase the candidate's edge.",
      ],
      metrics: probationMetrics,
      comparisonRows,
      divergenceNotes:
        comparisonRows.length === 0
          ? ["No recent live sleeve exposures were available for probation comparison."]
          : [
              "Probation compares candidate outputs against live sleeve positioning and replay expectations.",
              "A persistent live-vs-replay gap should halt promotion and trigger manual review.",
            ],
    } satisfies HrProbationReport,
    artifactPaths: [signalsArtifactPath, comparisonArtifactPath],
    summary: `Prepared probation monitoring against ${comparisonRows.length} recent live sleeve comparisons.`,
  };
}

export async function runLiveSimulationEvaluation(application: AgentApplication) {
  const simulationWindow = buildRecentSimulationWindow(30);
  const simulation = await runRealPaperEvaluation(application, {
    maxSymbols: 3,
    scenariosPerSymbol: 2,
    lookbackBars: 12,
    recentOnly: true,
    window: simulationWindow,
    regimeKey: "recent-month",
    regimeLabel: "Recent month live simulation",
  });
  const executionPlan = await inspectSubmissionExecutionPlan(application);
  const wrappedModel = executionPlan.kind === "wrapped-model";
  const portfolioFit = await runPortfolioFitAssessment(application, simulation.metrics);
  const probation = await runProbationEvaluation(application, simulation.metrics);

  return {
    portfolioFitReport: {
      ...portfolioFit.report,
      summary:
        "Simulated one month of recent live market data against the current ensemble to estimate fit, redundancy, and research usefulness.",
    } satisfies HrPortfolioFitReport,
    probationReport: {
      ...probation.report,
      summary: wrappedModel
        ? "Wrapped the submitted model into an agent interface and simulated one month of live data beside the house sleeves."
        : "Simulated one month of live data beside the current sleeves to measure behavior, drift, and onboarding readiness.",
      probationDays: 30,
      metrics: simulation.metrics,
      divergenceNotes: [
        wrappedModel
          ? "This submission was evaluated through the model-wrapper path instead of a native runnable agent entrypoint."
          : "This submission already exposed a runnable agent interface.",
        `Simulation window covered ${simulationWindow.from} through ${simulationWindow.to}.`,
        ...probation.report.divergenceNotes,
      ],
    } satisfies HrProbationReport,
    artifactPaths: [...simulation.artifactPaths, ...probation.artifactPaths],
    simulationWindow,
    wrappedModel,
  };
}
