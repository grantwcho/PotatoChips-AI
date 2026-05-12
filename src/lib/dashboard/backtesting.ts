import "server-only";

import { spawn } from "node:child_process";
import path from "node:path";
import { DEFAULT_AGENT_SEEDS } from "@/lib/agents/default-agents";
import {
  PYTHON_TRADING_AGENT_IDS,
  TRADING_AGENT_IDS,
  type PythonTradingAgentId,
  type TradingAgentId,
} from "@/lib/agents/trading-agent-config";
import {
  resolvePythonBenchmarkRuntime,
  resolvePythonTradingAgentRuntime,
  summarizePythonExecutionFailure,
} from "@/lib/agents/python-runtime";
import type {
  DashboardBacktestAgentOption,
  DashboardBacktestConfig,
  DashboardBacktestCurvePoint,
  DashboardBacktestData,
  DashboardBacktestRange,
  DashboardBacktestRangeOption,
  DashboardBacktestRun,
} from "@/lib/dashboard/types";

type JsonRecord = Record<string, unknown>;

const PACIFIC_TIME_ZONE = "America/Los_Angeles";
const BENCHMARK_SYMBOL = "SPY";
const BACKTEST_TIMEOUT_MS = 300_000;
const MAX_RANGE_START = "2018-01-01";
const SUPPORTED_BACKTEST_AGENT_IDS = new Set<PythonTradingAgentId>(PYTHON_TRADING_AGENT_IDS);

const BACKTEST_RANGE_DEFINITIONS: Array<{
  key: DashboardBacktestRange;
  label: string;
  start: (endDate: Date) => Date;
}> = [
  { key: "1W", label: "1W", start: (endDate) => shiftUtcDate(endDate, { days: -7 }) },
  { key: "1M", label: "1M", start: (endDate) => shiftUtcDate(endDate, { months: -1 }) },
  { key: "3M", label: "3M", start: (endDate) => shiftUtcDate(endDate, { months: -3 }) },
  { key: "6M", label: "6M", start: (endDate) => shiftUtcDate(endDate, { months: -6 }) },
  { key: "1Y", label: "1Y", start: (endDate) => shiftUtcDate(endDate, { years: -1 }) },
  { key: "2Y", label: "2Y", start: (endDate) => shiftUtcDate(endDate, { years: -2 }) },
  { key: "5Y", label: "5Y", start: (endDate) => shiftUtcDate(endDate, { years: -5 }) },
  { key: "MAX", label: "Max", start: () => new Date(`${MAX_RANGE_START}T00:00:00Z`) },
];

function shiftUtcDate(
  date: Date,
  delta: { days?: number; months?: number; years?: number }
) {
  const next = new Date(date.toISOString());

  if (delta.years) {
    next.setUTCFullYear(next.getUTCFullYear() + delta.years);
  }

  if (delta.months) {
    next.setUTCMonth(next.getUTCMonth() + delta.months);
  }

  if (delta.days) {
    next.setUTCDate(next.getUTCDate() + delta.days);
  }

  return next;
}

function formatPacificDate(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: PACIFIC_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function formatCurveLabel(date: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
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

function parseJsonFromStdout(stdout: string) {
  const trimmed = stdout.trim();
  if (!trimmed) {
    throw new Error("Replay command did not return any output.");
  }

  try {
    return JSON.parse(trimmed) as JsonRecord;
  } catch {
    const lines = trimmed
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    for (let index = lines.length - 1; index >= 0; index -= 1) {
      try {
        return JSON.parse(lines[index]) as JsonRecord;
      } catch {
        continue;
      }
    }

    throw new Error("Unable to parse replay output.");
  }
}

function summarizeBacktestError(error: unknown) {
  return summarizePythonExecutionFailure(error);
}

function getTradingAgentSeed(agentId: TradingAgentId) {
  return DEFAULT_AGENT_SEEDS.find((seed) => seed.id === agentId) ?? null;
}

function getBacktestAgentSupportNote(agentId: TradingAgentId) {
  if (SUPPORTED_BACKTEST_AGENT_IDS.has(agentId as PythonTradingAgentId)) {
    return "Daily-bar replay is wired for this Python sleeve.";
  }

  return "This sleeve still depends on the live multi-agent stack, so it does not have a deterministic historical replay harness yet.";
}

function getAvailableBacktestAgents(): DashboardBacktestAgentOption[] {
  return TRADING_AGENT_IDS.map((agentId) => {
    const seed = getTradingAgentSeed(agentId);

    return {
      id: agentId,
      displayName: seed?.displayName ?? agentId,
      role: seed?.role ?? "Research Agent",
      supported: SUPPORTED_BACKTEST_AGENT_IDS.has(agentId as PythonTradingAgentId),
      supportNote: getBacktestAgentSupportNote(agentId),
    };
  });
}

function getAvailableRanges(): DashboardBacktestRangeOption[] {
  const today = formatPacificDate(new Date());
  const endDate = new Date(`${today}T00:00:00Z`);

  return BACKTEST_RANGE_DEFINITIONS.map((definition) => ({
    key: definition.key,
    label: definition.label,
    start: formatPacificDate(definition.start(endDate)),
    end: today,
  }));
}

export function getDashboardBacktestConfig(): DashboardBacktestConfig {
  const availableAgents = getAvailableBacktestAgents();
  const availableRanges = getAvailableRanges();
  const defaultAgentIds = availableAgents
    .filter((agent) => agent.supported)
    .map((agent) => agent.id);

  return {
    defaultRange: "1M",
    defaultAgentIds,
    benchmarkSymbol: BENCHMARK_SYMBOL,
    availableRanges,
    availableAgents,
  };
}

function resolveBacktestRange(range: DashboardBacktestRange | undefined) {
  const config = getDashboardBacktestConfig();
  return (
    config.availableRanges.find((option) => option.key === range) ??
    config.availableRanges.find((option) => option.key === config.defaultRange) ??
    config.availableRanges[0]
  );
}

async function runJsonCommand(input: {
  pythonBin: string;
  cwd: string;
  args: string[];
  timeoutMs?: number;
}) {
  const repoPythonPath = process.cwd();

  return await new Promise<JsonRecord>((resolve, reject) => {
    const child = spawn(input.pythonBin, input.args, {
      cwd: input.cwd,
      env: {
        ...process.env,
        PYTHONPATH: process.env.PYTHONPATH
          ? `${repoPythonPath}${path.delimiter}${process.env.PYTHONPATH}`
          : repoPythonPath,
        PYTHONUNBUFFERED: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      child.kill("SIGKILL");
      reject(new Error(`Command timed out after ${input.timeoutMs ?? BACKTEST_TIMEOUT_MS}ms.`));
    }, input.timeoutMs ?? BACKTEST_TIMEOUT_MS);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);

      if ((code ?? 0) !== 0) {
        reject(
          new Error(
            stderr.trim() || `Replay command exited with code ${code ?? 0}.`
          )
        );
        return;
      }

      try {
        resolve(parseJsonFromStdout(stdout));
      } catch (error) {
        reject(
          new Error(
            error instanceof Error
              ? `Unable to parse replay output: ${error.message}`
              : "Unable to parse replay output."
          )
        );
      }
    });
  });
}

async function runPythonAgentBacktest(input: {
  agentId: PythonTradingAgentId;
  start: string;
  end: string;
}) {
  const seed = getTradingAgentSeed(input.agentId);
  const packagePath =
    seed?.config && typeof seed.config.packagePath === "string"
      ? seed.config.packagePath
      : null;
  const configPath =
    seed?.config && typeof seed.config.configPath === "string"
      ? seed.config.configPath
      : null;

  if (!packagePath || !configPath) {
    throw new Error(`${input.agentId} is missing package or config metadata.`);
  }

  const { cwd, configPath: resolvedConfigPath, pythonBin } =
    await resolvePythonTradingAgentRuntime(input.agentId);

  return await runJsonCommand({
    pythonBin,
    cwd,
    args: [
      "backtest.py",
      "--config",
      resolvedConfigPath,
      "--start",
      input.start,
      "--end",
      input.end,
      "--include-equity-curve",
    ],
  });
}

async function runBenchmarkBacktest(input: { start: string; end: string }) {
  const pythonBin = await resolvePythonBenchmarkRuntime();

  return await runJsonCommand({
    pythonBin,
    cwd: process.cwd(),
    args: [
      path.resolve(process.cwd(), "scripts/backtest_benchmark.py"),
      "--symbol",
      BENCHMARK_SYMBOL,
      "--start",
      input.start,
      "--end",
      input.end,
    ],
  });
}

function normalizeCurve(
  curve: unknown,
  keys: { date: string[]; value: string[] }
): DashboardBacktestCurvePoint[] {
  if (!Array.isArray(curve)) {
    return [];
  }

  const parsed = curve
    .map((point) => {
      if (!point || typeof point !== "object" || Array.isArray(point)) {
        return null;
      }

      const record = point as JsonRecord;
      const date = keys.date
        .map((candidate) => record[candidate])
        .find((candidate): candidate is string => typeof candidate === "string");
      const value = keys.value
        .map((candidate) => parseNumber(record[candidate]))
        .find((candidate): candidate is number => typeof candidate === "number");

      if (!date || typeof value !== "number" || value <= 0) {
        return null;
      }

      return {
        date,
        value,
      };
    })
    .filter((point): point is { date: string; value: number } => Boolean(point))
    .sort((left, right) => left.date.localeCompare(right.date));

  const baseValue = parsed[0]?.value;
  if (typeof baseValue !== "number" || baseValue <= 0) {
    return [];
  }

  return parsed.map((point) => ({
    date: point.date,
    label: formatCurveLabel(point.date),
    value: Number(point.value.toFixed(4)),
    normalizedValue: Number(((point.value / baseValue) * 100).toFixed(4)),
  }));
}

function buildExtraMetrics(payload: JsonRecord) {
  const metrics: DashboardBacktestRun["extraMetrics"] = [];
  const classificationAccuracy = parseNumber(payload.classification_accuracy);
  const contangoAccuracy = parseNumber(payload.contango_accuracy);
  const backwardationAccuracy = parseNumber(payload.backwardation_accuracy);

  if (typeof classificationAccuracy === "number") {
    metrics.push({
      label: "Classification Accuracy",
      value: classificationAccuracy,
      format: "percent",
    });
  }

  if (typeof contangoAccuracy === "number") {
    metrics.push({
      label: "Contango Accuracy",
      value: contangoAccuracy,
      format: "percent",
    });
  }

  if (typeof backwardationAccuracy === "number") {
    metrics.push({
      label: "Backwardation Accuracy",
      value: backwardationAccuracy,
      format: "percent",
    });
  }

  return metrics;
}

function buildCompletedRun(input: {
  agentId: PythonTradingAgentId;
  payload: JsonRecord;
  benchmarkReturn: number | null;
}): DashboardBacktestRun {
  const seed = getTradingAgentSeed(input.agentId);
  const curve = normalizeCurve(input.payload.equity_curve, {
    date: ["trade_date", "date"],
    value: ["nav_usd", "close"],
  });
  const totalReturn =
    parseNumber(input.payload.total_return) ??
    (curve.length >= 2 ? (curve.at(-1)!.value / curve[0]!.value) - 1 : null);

  return {
    agentId: input.agentId,
    displayName: seed?.displayName ?? input.agentId,
    role: seed?.role ?? "Research Agent",
    status: "completed",
    supportNote: getBacktestAgentSupportNote(input.agentId),
    error: null,
    start:
      typeof input.payload.start === "string" ? input.payload.start : curve[0]?.date ?? MAX_RANGE_START,
    end:
      typeof input.payload.end === "string"
        ? input.payload.end
        : curve.at(-1)?.date ?? formatPacificDate(new Date()),
    totalReturn,
    benchmarkReturn: input.benchmarkReturn,
    alpha:
      typeof totalReturn === "number" && typeof input.benchmarkReturn === "number"
        ? totalReturn - input.benchmarkReturn
        : null,
    cagr: parseNumber(input.payload.cagr),
    sharpe: parseNumber(input.payload.sharpe),
    maxDrawdown: parseNumber(input.payload.max_drawdown),
    winRate: parseNumber(input.payload.win_rate),
    tradeCount: parseNumber(input.payload.trade_count),
    curve,
    extraMetrics: buildExtraMetrics(input.payload),
  };
}

function buildUnsupportedRun(agentId: string): DashboardBacktestRun {
  const seed = getTradingAgentSeed(agentId as TradingAgentId);

  return {
    agentId,
    displayName: seed?.displayName ?? agentId,
    role: seed?.role ?? "Research Agent",
    status: "unsupported",
    supportNote: getBacktestAgentSupportNote(agentId as TradingAgentId),
    error: null,
    start: "",
    end: "",
    totalReturn: null,
    benchmarkReturn: null,
    alpha: null,
    cagr: null,
    sharpe: null,
    maxDrawdown: null,
    winRate: null,
    tradeCount: null,
    curve: [],
    extraMetrics: [],
  };
}

function buildErroredRun(agentId: PythonTradingAgentId, error: unknown): DashboardBacktestRun {
  const seed = getTradingAgentSeed(agentId);

  return {
    agentId,
    displayName: seed?.displayName ?? agentId,
    role: seed?.role ?? "Research Agent",
    status: "error",
    supportNote: getBacktestAgentSupportNote(agentId),
    error: summarizeBacktestError(error),
    start: "",
    end: "",
    totalReturn: null,
    benchmarkReturn: null,
    alpha: null,
    cagr: null,
    sharpe: null,
    maxDrawdown: null,
    winRate: null,
    tradeCount: null,
    curve: [],
    extraMetrics: [],
  };
}

export async function runDashboardBacktest(input?: {
  range?: DashboardBacktestRange;
  agentIds?: string[];
}): Promise<DashboardBacktestData> {
  const config = getDashboardBacktestConfig();
  const range = resolveBacktestRange(input?.range);
  const requestedAgentIds = Array.from(
    new Set((input?.agentIds?.length ? input.agentIds : config.defaultAgentIds).filter(Boolean))
  );
  const selectedAgentIds = requestedAgentIds.filter((agentId) =>
    TRADING_AGENT_IDS.includes(agentId as TradingAgentId)
  );
  const supportedAgentIds = selectedAgentIds.filter((agentId) =>
    SUPPORTED_BACKTEST_AGENT_IDS.has(agentId as PythonTradingAgentId)
  ) as PythonTradingAgentId[];
  const unsupportedAgentIds = selectedAgentIds.filter(
    (agentId) => !SUPPORTED_BACKTEST_AGENT_IDS.has(agentId as PythonTradingAgentId)
  );

  const [benchmarkPayload, agentResults] = await Promise.all([
    runBenchmarkBacktest({ start: range.start, end: range.end }).catch(() => null),
    Promise.allSettled(
      supportedAgentIds.map((agentId) =>
        runPythonAgentBacktest({
          agentId,
          start: range.start,
          end: range.end,
        })
      )
    ),
  ]);

  const benchmark =
    benchmarkPayload && typeof benchmarkPayload === "object"
      ? {
          symbol:
            typeof benchmarkPayload.symbol === "string"
              ? benchmarkPayload.symbol
              : BENCHMARK_SYMBOL,
          start:
            typeof benchmarkPayload.start === "string" ? benchmarkPayload.start : range.start,
          end: typeof benchmarkPayload.end === "string" ? benchmarkPayload.end : range.end,
          totalReturn: parseNumber(benchmarkPayload.total_return),
          curve: normalizeCurve(benchmarkPayload.curve, {
            date: ["date", "trade_date"],
            value: ["close", "nav_usd"],
          }),
        }
      : null;

  const runs: DashboardBacktestRun[] = [];

  supportedAgentIds.forEach((agentId, index) => {
    const result = agentResults[index];

    if (!result || result.status === "rejected") {
      runs.push(buildErroredRun(agentId, result?.reason));
      return;
    }

    try {
      runs.push(
        buildCompletedRun({
          agentId,
          payload: result.value,
          benchmarkReturn: benchmark?.totalReturn ?? null,
        })
      );
    } catch (error) {
      runs.push(buildErroredRun(agentId, error));
    }
  });

  unsupportedAgentIds.forEach((agentId) => {
    runs.push(buildUnsupportedRun(agentId));
  });

  return {
    range: range.key,
    start: range.start,
    end: range.end,
    generatedAt: new Date().toISOString(),
    benchmark,
    runs,
  };
}
