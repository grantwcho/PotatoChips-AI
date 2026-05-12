import type {
  AgentApplicationType,
  SignalOutput,
} from "@/lib/hr-agent/models/agent-application";

export type NativeAgentOutput = Record<string, unknown>;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function asString(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : fallback;
}

function asNumber(value: unknown, fallback: number) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  return fallback;
}

function normalizeDirection(value: unknown): SignalOutput["direction"] {
  const raw = asString(value, "long").toLowerCase();

  if (["short", "sell", "bearish"].includes(raw)) {
    return "short";
  }

  if (["close", "exit", "flat"].includes(raw)) {
    return "close";
  }

  return "long";
}

function normalizeTimeHorizon(value: unknown): SignalOutput["time_horizon"] {
  const raw = asString(value, "swing").toLowerCase();

  if (raw === "intraday" || raw === "day") {
    return "intraday";
  }

  if (raw === "position" || raw === "long_term" || raw === "long-term") {
    return "position";
  }

  return "swing";
}

function normalizeDataSources(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return ["unmapped-agent-output"];
}

export function adaptNativeOutputToSignalContract({
  nativeOutput,
  agentId,
  agentType,
}: {
  nativeOutput: NativeAgentOutput;
  agentId: string;
  agentType: AgentApplicationType;
}): SignalOutput {
  const ticker = asString(
    nativeOutput.ticker ?? nativeOutput.symbol ?? nativeOutput.asset,
    "UNKNOWN"
  ).toUpperCase();
  const conviction = clamp(
    asNumber(nativeOutput.conviction ?? nativeOutput.confidence ?? nativeOutput.score, 0.5),
    0,
    1
  );

  return {
    agent_id: agentId,
    agent_type: agentType,
    timestamp: new Date().toISOString(),
    ticker,
    direction: normalizeDirection(nativeOutput.direction ?? nativeOutput.side),
    conviction,
    time_horizon: normalizeTimeHorizon(
      nativeOutput.time_horizon ?? nativeOutput.horizon ?? nativeOutput.hold_period
    ),
    stop_loss_pct: clamp(asNumber(nativeOutput.stop_loss_pct, 0.03), 0, 1),
    take_profit_pct: clamp(asNumber(nativeOutput.take_profit_pct, 0.08), 0, 5),
    max_position_pct: clamp(asNumber(nativeOutput.max_position_pct, 0.02), 0, 1),
    reasoning: asString(
      nativeOutput.reasoning ?? nativeOutput.thesis ?? nativeOutput.explanation,
      "Adapter could not find a native reasoning field."
    ),
    data_sources: normalizeDataSources(nativeOutput.data_sources ?? nativeOutput.sources),
    correlation_id: asString(
      nativeOutput.correlation_id ?? nativeOutput.id,
      `hr-adapter-${crypto.randomUUID()}`
    ),
  };
}
