import "server-only";

import { randomUUID } from "node:crypto";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import { DEFAULT_AGENT_SEEDS } from "@/lib/agents/default-agents";
import { requestConfiguredJsonObject } from "@/lib/agents/model-json";
import { getDecisionModelRouteForAgent } from "@/lib/agents/model-routing";
import type { TradingAgentId as RuntimeTradingAgentId } from "@/lib/agents/trading-agent-config";
import type { RuntimeSessionSnapshot } from "@/lib/agents/types";
import { getAlloyDbPool } from "@/lib/data/alloydb/client";
import { parseAlpacaOptionContractSymbol } from "@/lib/trading/alpaca";
import type { AlpacaOrderSnapshot, AlpacaPositionSnapshot } from "@/lib/trading/types";

const LEARNING_TIMEZONE = "America/New_York";
const SCHEMA_CACHE_TTL_MS = 60_000;
const TRADING_AGENT_IDS = [
  "AGT-MACRO-001",
  "AGT-EVENT-001",
  "AGT-SENT-001",
] as const;
const ACTIVE_AGENT_STATUSES = ["ACTIVE", "PAPER"] as const;
const TERMINAL_ORDER_STATUSES = new Set([
  "filled",
  "partially_filled",
  "canceled",
  "expired",
  "rejected",
  "done_for_day",
]);
const LIVE_ORDER_STATUSES = new Set(["accepted", "new", "partially_filled", "filled"]);
const AGENT_ALLOWED_SYMBOLS: Record<string, string[]> = {
  // Symbol-universe drift checks are intentionally disabled while the research
  // sleeves move to model-selected instruments rather than a fixed static list.
  "AGT-MACRO-001": [],
  "AGT-EVENT-001": [],
  "AGT-SENT-001": [],
};

type TradingAgentId = (typeof TRADING_AGENT_IDS)[number];
type LearningCadence =
  | "DAILY_SIGNAL_TRACK"
  | "WEEKLY_SELF_REVIEW"
  | "MONTHLY_PARAMETER_OPTIMIZATION"
  | "QUARTERLY_DEEP_REVIEW";
type LearningParameterType = "NUMBER" | "INTEGER";
type LearningBiasDirection = "INCREASE" | "DECREASE" | "AVOID" | "PREFER" | "OBSERVE";
type ChangeDirection = "NONE" | "INCREASE" | "DECREASE";

type QueryRunner = Pool | PoolClient;
type JsonRecord = Record<string, unknown>;

type LearningParameterSpec = {
  key: string;
  label: string;
  type: LearningParameterType;
  defaultValue: number;
  minValue: number;
  maxValue: number;
  maxStepPct: number;
  runtimeInfluence?: "notional_multiplier" | "confidence_floor";
};

type ActiveParameterRow = QueryResultRow & {
  agent_id: string;
  parameter_key: string;
  parameter_type: string;
  value_boolean: boolean | null;
  value_integer: number | null;
  value_number: string | null;
  value_text: string | null;
};

type ShortTermMemoryRow = QueryResultRow & {
  agent_id: string;
  memory_date: Date | string;
  memory_payload: Record<string, unknown>;
  updated_at: Date;
};

type LessonRow = QueryResultRow & {
  affected_regimes: unknown;
  confidence_score: number;
  created_at: Date;
  expires_at: Date | null;
  lesson_key: string;
  lesson_text: string;
  memory_scope: string;
  title: string;
};

type AgentConfigRow = QueryResultRow & {
  objective_function: string;
  system_prompt: string;
};

type AgentIdentityRow = QueryResultRow & {
  current_allocation_usd: string | null;
  display_name: string;
  id: string;
  role: string;
  status: string;
  strategy_category: string | null;
};

type PendingOutcomeRow = QueryResultRow & {
  broker_order_id: string | null;
  client_order_id: string | null;
  expected_window_end: Date | null;
  id: string;
  symbol: string | null;
};

type ParameterVersionRow = QueryResultRow & {
  change_direction: ChangeDirection;
  created_at: Date;
  effective_at: Date;
  id: string;
  max_step_pct: string | null;
  parameter_key: string;
  parameter_type: string;
  status: string;
  value_integer: number | null;
  value_number: string | null;
};

export type AgentRuntimeControls = {
  confidenceFloor: number;
  notionalMultiplier: number;
};

export type LearningMaintenanceInput = {
  brokerExecution:
    | {
        error?: string;
        intent: {
          agentId: RuntimeTradingAgentId;
          confidenceScore: number;
          notional: number;
          side: string;
          signalContext: Record<string, unknown>;
          symbol: string;
        };
        order?: AlpacaOrderSnapshot;
        requestPayload: Record<string, unknown>;
      }
    | null;
  brokerState:
    | {
        positions: AlpacaPositionSnapshot[];
        recentOrders: AlpacaOrderSnapshot[];
      }
    | null;
  cycleId: number;
  regime: string;
  session: RuntimeSessionSnapshot;
};

type PromptSection = {
  assembledPrompt: string;
  mediumTermMemory: string;
  shortTermMemory: string;
  staticPrompt: string;
};

type AgentLessonCandidate = {
  key: string;
  title: string;
  text: string;
  biasDirection: LearningBiasDirection;
  memoryScope: "GLOBAL" | "REGIME" | "SYMBOL_CLUSTER" | "EXECUTION";
  confidenceScore: number;
  weight: number;
  sampleSize: number;
  regimes: string[];
  expiresInDays: number;
  metadata: JsonRecord;
};

type AgentParameterChangeCandidate = {
  parameterKey: string;
  nextValue: number;
  reasoning: string;
};

type AgentWeeklySelfReviewDecision = {
  summary: string;
  findings: JsonRecord[];
  recommendations: JsonRecord[];
  lessons: AgentLessonCandidate[];
};

type AgentMonthlyOptimizationDecision = {
  summary: string;
  findings: JsonRecord[];
  recommendations: JsonRecord[];
  parameterChanges: AgentParameterChangeCandidate[];
};

type AgentQuarterlyDeepReviewDecision = {
  summary: string;
  findings: JsonRecord[];
  recommendations: JsonRecord[];
};

const LEARNING_PARAMETER_SPECS: Record<string, LearningParameterSpec[]> = {
  "AGT-CIO": [
    {
      key: "allocation_reactivity",
      label: "Allocation Reactivity",
      type: "NUMBER",
      defaultValue: 1,
      minValue: 0.75,
      maxValue: 1.25,
      maxStepPct: 0.1,
    },
  ],
  "AGT-RESEARCH": [
    {
      key: "publish_confidence_floor",
      label: "Research Publish Confidence Floor",
      type: "INTEGER",
      defaultValue: 30,
      minValue: 25,
      maxValue: 70,
      maxStepPct: 0.1,
    },
  ],
  "AGT-MACRO-001": [
    {
      key: "notional_multiplier",
      label: "Macro Notional Multiplier",
      type: "NUMBER",
      defaultValue: 1.35,
      minValue: 0.75,
      maxValue: 1.75,
      maxStepPct: 0.15,
      runtimeInfluence: "notional_multiplier",
    },
    {
      key: "confidence_floor",
      label: "Macro Confidence Floor",
      type: "INTEGER",
      defaultValue: 56,
      minValue: 45,
      maxValue: 75,
      maxStepPct: 0.1,
      runtimeInfluence: "confidence_floor",
    },
  ],
  "AGT-EVENT-001": [
    {
      key: "notional_multiplier",
      label: "Event Notional Multiplier",
      type: "NUMBER",
      defaultValue: 1.35,
      minValue: 0.75,
      maxValue: 1.75,
      maxStepPct: 0.15,
      runtimeInfluence: "notional_multiplier",
    },
    {
      key: "confidence_floor",
      label: "Event Confidence Floor",
      type: "INTEGER",
      defaultValue: 52,
      minValue: 42,
      maxValue: 72,
      maxStepPct: 0.1,
      runtimeInfluence: "confidence_floor",
    },
  ],
  "AGT-SENT-001": [
    {
      key: "notional_multiplier",
      label: "Sentiment Notional Multiplier",
      type: "NUMBER",
      defaultValue: 1.3,
      minValue: 0.75,
      maxValue: 1.7,
      maxStepPct: 0.15,
      runtimeInfluence: "notional_multiplier",
    },
    {
      key: "confidence_floor",
      label: "Sentiment Confidence Floor",
      type: "INTEGER",
      defaultValue: 54,
      minValue: 44,
      maxValue: 74,
      maxStepPct: 0.1,
      runtimeInfluence: "confidence_floor",
    },
  ],
};

let learningSchemaCache:
  | {
      checkedAt: number;
      available: boolean;
    }
  | null = null;

function parseNumeric(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function roundTo(value: number, digits = 2) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Number(value.toFixed(digits));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function asString(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function requireStringField(value: unknown, label: string) {
  const normalized = asString(value);

  if (!normalized) {
    throw new Error(`Learning review payload omitted ${label}.`);
  }

  return normalized;
}

function requireNumberField(value: unknown, label: string) {
  const normalized = parseNumeric(value);

  if (normalized === null) {
    throw new Error(`Learning review payload omitted numeric field ${label}.`);
  }

  return normalized;
}

function requirePositiveNumberField(value: unknown, label: string) {
  const normalized = requireNumberField(value, label);

  if (normalized <= 0) {
    throw new Error(`${label} must be greater than 0.`);
  }

  return normalized;
}

function requirePercentScore(value: unknown, label: string) {
  const normalized = requireNumberField(value, label);

  if (normalized < 0 || normalized > 100) {
    throw new Error(`${label} must be between 0 and 100.`);
  }

  return Math.round(normalized);
}

function requireIntegerInRange(
  value: unknown,
  label: string,
  input: {
    min: number;
    max: number;
  }
) {
  const normalized = Math.round(requireNumberField(value, label));

  if (normalized < input.min || normalized > input.max) {
    throw new Error(`${label} must be between ${input.min} and ${input.max}.`);
  }

  return normalized;
}

function requireRecord(value: unknown, label: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Learning review payload omitted object ${label}.`);
  }

  return value as JsonRecord;
}

function requireRecordList(value: unknown, label: string, max = 6) {
  if (!Array.isArray(value)) {
    throw new Error(`Learning review payload omitted array ${label}.`);
  }

  return value.slice(0, max).map((item, index) =>
    requireRecord(item, `${label}[${index}]`)
  );
}

function requireStringList(value: unknown, label: string, max = 8) {
  if (!Array.isArray(value)) {
    throw new Error(`Learning review payload omitted array ${label}.`);
  }

  return Array.from(
    new Set(
      value
        .map((item) => asString(item))
        .filter((item) => item.length > 0)
    )
  ).slice(0, max);
}

function validateLearningBiasDirection(value: unknown) {
  if (
    value === "INCREASE" ||
    value === "DECREASE" ||
    value === "AVOID" ||
    value === "PREFER" ||
    value === "OBSERVE"
  ) {
    return value;
  }

  throw new Error(
    "Learning review lesson.biasDirection must be one of INCREASE, DECREASE, AVOID, PREFER, or OBSERVE."
  );
}

function validateLessonMemoryScope(value: unknown) {
  if (
    value === "GLOBAL" ||
    value === "REGIME" ||
    value === "SYMBOL_CLUSTER" ||
    value === "EXECUTION"
  ) {
    return value;
  }

  throw new Error(
    "Learning review lesson.memoryScope must be one of GLOBAL, REGIME, SYMBOL_CLUSTER, or EXECUTION."
  );
}

function getSpecsForAgent(agentId: string) {
  return LEARNING_PARAMETER_SPECS[agentId] ?? [];
}

function inferAgentIdFromClientOrderId(clientOrderId: string | null) {
  if (!clientOrderId?.startsWith("gptcap-")) {
    return null;
  }

  if (clientOrderId.includes("-macro")) {
    return "AGT-MACRO-001";
  }

  if (clientOrderId.includes("-event")) {
    return "AGT-EVENT-001";
  }

  if (clientOrderId.includes("-sent")) {
    return "AGT-SENT-001";
  }

  return null;
}

function getZonedPseudoDate(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)])
  );

  return new Date(
    Date.UTC(
      values.year,
      (values.month ?? 1) - 1,
      values.day ?? 1,
      values.hour ?? 0,
      values.minute ?? 0,
      values.second ?? 0
    )
  );
}

function getDateKey(date: Date, timeZone = LEARNING_TIMEZONE) {
  return getZonedPseudoDate(date, timeZone).toISOString().slice(0, 10);
}

function getWeekStartKey(date: Date, timeZone = LEARNING_TIMEZONE) {
  const zoned = getZonedPseudoDate(date, timeZone);
  const day = zoned.getUTCDay() === 0 ? 7 : zoned.getUTCDay();
  zoned.setUTCDate(zoned.getUTCDate() - day + 1);
  return zoned.toISOString().slice(0, 10);
}

function getMonthStartKey(date: Date, timeZone = LEARNING_TIMEZONE) {
  const zoned = getZonedPseudoDate(date, timeZone);
  zoned.setUTCDate(1);
  return zoned.toISOString().slice(0, 10);
}

function getQuarterStartKey(date: Date, timeZone = LEARNING_TIMEZONE) {
  const zoned = getZonedPseudoDate(date, timeZone);
  const month = zoned.getUTCMonth();
  const quarterMonth = Math.floor(month / 3) * 3;
  return new Date(Date.UTC(zoned.getUTCFullYear(), quarterMonth, 1))
    .toISOString()
    .slice(0, 10);
}

function shiftDays(dateKey: string, days: number) {
  const next = new Date(`${dateKey}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

function isOppositeDirection(
  existing: LearningBiasDirection,
  incoming: LearningBiasDirection
) {
  return (
    (existing === "INCREASE" && incoming === "DECREASE") ||
    (existing === "DECREASE" && incoming === "INCREASE") ||
    (existing === "PREFER" && incoming === "AVOID") ||
    (existing === "AVOID" && incoming === "PREFER")
  );
}

function mapOrderStatusToOutcomeType(status: string | null | undefined) {
  switch ((status ?? "").toLowerCase()) {
    case "filled":
      return "FILLED";
    case "partially_filled":
      return "PARTIALLY_FILLED";
    case "accepted":
    case "new":
      return "ACCEPTED";
    case "canceled":
    case "done_for_day":
      return "CANCELED";
    case "expired":
      return "EXPIRED";
    case "rejected":
      return "REJECTED";
    default:
      return "ACCEPTED";
  }
}

function isOutcomeResolved(status: string | null | undefined) {
  return TERMINAL_ORDER_STATUSES.has((status ?? "").toLowerCase());
}

function buildOutcomeNotes(status: string | null | undefined) {
  const normalized = (status ?? "").toLowerCase();

  if (!normalized) {
    return "Outcome captured from agent runtime without a workflow status.";
  }

  if (normalized === "filled" || normalized === "partially_filled") {
    return `Workflow provider reported ${normalized.replaceAll("_", " ")} status for the tracked research event.`;
  }

  if (normalized === "accepted" || normalized === "new") {
    return "Workflow provider accepted the event, but the outcome window is still open.";
  }

  return `Workflow provider closed the event with status ${normalized.replaceAll("_", " ")}.`;
}

async function getRunner(client?: PoolClient) {
  return client ?? getAlloyDbPool();
}

export async function isLearningSchemaAvailable(client?: PoolClient) {
  const now = Date.now();

  if (
    learningSchemaCache &&
    now - learningSchemaCache.checkedAt < SCHEMA_CACHE_TTL_MS
  ) {
    return learningSchemaCache.available;
  }

  try {
    const runner = await getRunner(client);
    const result = await runner.query<{
      has_lessons: boolean;
      has_parameters: boolean;
      has_reviews: boolean;
      has_short_term: boolean;
      has_outcomes: boolean;
    }>(`
      select
        to_regclass('public.agent_lessons') is not null as has_lessons,
        to_regclass('public.agent_parameter_versions') is not null as has_parameters,
        to_regclass('public.agent_learning_reviews') is not null as has_reviews,
        to_regclass('public.agent_short_term_memory') is not null as has_short_term,
        to_regclass('public.agent_signal_outcomes') is not null as has_outcomes
    `);
    const row = result.rows[0];
    const available = Boolean(
      row?.has_lessons &&
        row?.has_parameters &&
        row?.has_reviews &&
        row?.has_short_term &&
        row?.has_outcomes
    );

    learningSchemaCache = {
      checkedAt: now,
      available,
    };

    return available;
  } catch {
    learningSchemaCache = {
      checkedAt: now,
      available: false,
    };
    return false;
  }
}

async function seedParameterSpec(
  runner: QueryRunner,
  agentId: string,
  spec: LearningParameterSpec
) {
  const baseValues =
    spec.type === "INTEGER"
      ? {
          valueBoolean: null,
          valueInteger: Math.round(spec.defaultValue),
          valueNumber: null,
          valueText: null,
        }
      : {
          valueBoolean: null,
          valueInteger: null,
          valueNumber: spec.defaultValue,
          valueText: null,
        };

  await runner.query(
    `
      insert into agent_parameter_versions (
        id,
        agent_id,
        parameter_key,
        parameter_type,
        value_number,
        value_integer,
        value_boolean,
        value_text,
        min_value,
        max_value,
        max_step_pct,
        change_direction,
        status,
        reasoning,
        effective_at,
        created_at
      )
      select
        $1::uuid,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9,
        $10,
        $11,
        'NONE',
        'ACTIVE',
        $12,
        now(),
        now()
      where not exists (
        select 1
        from agent_parameter_versions
        where agent_id = $2
          and parameter_key = $3
          and status = 'ACTIVE'
      )
    `,
    [
      randomUUID(),
      agentId,
      spec.key,
      spec.type,
      baseValues.valueNumber,
      baseValues.valueInteger,
      baseValues.valueBoolean,
      baseValues.valueText,
      spec.minValue,
      spec.maxValue,
      spec.maxStepPct,
      `Seeded ${spec.label} with a bounded default value.`,
    ]
  );
}

export async function ensureAgentLearningSeeded(client?: PoolClient) {
  if (!(await isLearningSchemaAvailable(client))) {
    return;
  }

  const runner = await getRunner(client);

  for (const [agentId, specs] of Object.entries(LEARNING_PARAMETER_SPECS)) {
    for (const spec of specs) {
      await seedParameterSpec(runner, agentId, spec);
    }
  }
}

function readParameterValue(row: ActiveParameterRow) {
  if (row.parameter_type === "INTEGER") {
    return Number(row.value_integer ?? 0);
  }

  if (row.parameter_type === "NUMBER") {
    return parseNumeric(row.value_number) ?? 0;
  }

  if (row.parameter_type === "BOOLEAN") {
    return row.value_boolean ? 1 : 0;
  }

  return Number(row.value_text ?? 0);
}

function normalizeLearningSymbol(symbol: string) {
  const parsedOption = parseAlpacaOptionContractSymbol(symbol);
  return parsedOption?.underlyingSymbol ?? symbol;
}

export async function getTradingAgentRuntimeControls() {
  const exploratory = process.env.AGENT_PAPER_EXPERIMENTATION_ENABLED?.trim().toLowerCase() !== "false";
  const defaults = new Map<TradingAgentId, AgentRuntimeControls>(
    TRADING_AGENT_IDS.map((agentId) => {
      const specs = getSpecsForAgent(agentId);
      const notionalSpec = specs.find(
        (spec) => spec.runtimeInfluence === "notional_multiplier"
      );
      const confidenceSpec = specs.find(
        (spec) => spec.runtimeInfluence === "confidence_floor"
      );

      return [
        agentId,
        {
          confidenceFloor: confidenceSpec
            ? Math.round(confidenceSpec.defaultValue)
            : 0,
          notionalMultiplier: notionalSpec?.defaultValue ?? 1,
        },
      ];
    })
  );

  if (!(await isLearningSchemaAvailable())) {
    return defaults;
  }

  await ensureAgentLearningSeeded();
  const pool = getAlloyDbPool();
  const result = await pool.query<ActiveParameterRow>(
    `
      select
        agent_id,
        parameter_key,
        parameter_type,
        value_number,
        value_integer,
        value_boolean,
        value_text
      from agent_parameter_versions
      where status = 'ACTIVE'
        and agent_id = any($1::text[])
        and parameter_key in ('notional_multiplier', 'confidence_floor')
    `,
    [TRADING_AGENT_IDS]
  );

  for (const row of result.rows) {
    if (
      row.agent_id !== "AGT-MACRO-001" &&
      row.agent_id !== "AGT-EVENT-001" &&
      row.agent_id !== "AGT-SENT-001"
    ) {
      continue;
    }

    const current = defaults.get(row.agent_id);

    if (!current) {
      continue;
    }

    if (row.parameter_key === "notional_multiplier") {
      current.notionalMultiplier = clamp(readParameterValue(row), 0.75, 1.75);
    }

    if (row.parameter_key === "confidence_floor") {
      current.confidenceFloor = Math.round(clamp(readParameterValue(row), 25, 90));
    }
  }

  if (exploratory) {
    for (const [agentId, control] of defaults.entries()) {
      const experimentalFloor =
        agentId === "AGT-MACRO-001"
          ? 56
          : agentId === "AGT-EVENT-001"
            ? 52
            : 54;
      const experimentalMultiplier =
        agentId === "AGT-SENT-001" ? 1.3 : 1.35;

      control.confidenceFloor = Math.round(
        clamp(Math.min(control.confidenceFloor, experimentalFloor), 25, 90)
      );
      control.notionalMultiplier = clamp(
        Math.max(control.notionalMultiplier, experimentalMultiplier),
        0.75,
        1.75
      );
    }
  }

  return defaults;
}

async function fetchActiveLessons(
  runner: QueryRunner,
  agentId: string,
  now: Date
) {
  const result = await runner.query<LessonRow>(
    `
      select
        lesson_key,
        title,
        lesson_text,
        memory_scope,
        confidence_score,
        affected_regimes,
        expires_at,
        created_at
      from agent_lessons
      where agent_id = $1
        and status = 'ACTIVE'
        and (expires_at is null or expires_at > $2)
      order by confidence_score desc, created_at desc
      limit 6
    `,
    [agentId, now]
  );

  return result.rows;
}

function formatLessonSummary(row: LessonRow) {
  const regimes = Array.isArray(row.affected_regimes)
    ? row.affected_regimes
    : [];
  const regimeSuffix =
    regimes.length > 0 ? ` (regimes: ${(regimes as string[]).join(", ")})` : "";

  return `- ${row.title}: ${row.lesson_text}${regimeSuffix}`;
}

function formatParameterSummary(
  agentId: string,
  activeParameters: ActiveParameterRow[]
) {
  const specs = getSpecsForAgent(agentId);

  if (specs.length === 0) {
    return "- No bounded learning parameters configured.";
  }

  return specs
    .map((spec) => {
      const row = activeParameters.find((candidate) => candidate.parameter_key === spec.key);
      const value = row ? readParameterValue(row) : spec.defaultValue;
      const printable =
        spec.type === "INTEGER" ? String(Math.round(value)) : String(roundTo(value, 3));

      return `- ${spec.label}: ${printable} (bounds ${spec.minValue}..${spec.maxValue}, max step ${Math.round(
        spec.maxStepPct * 100
      )}%)`;
    })
    .join("\n");
}

function formatShortTermMemory(payload: Record<string, unknown> | null) {
  if (!payload) {
    return "- No short-term memory has been captured for the current market day yet.";
  }

  return Object.entries(payload)
    .map(([key, value]) => {
      if (Array.isArray(value)) {
        return `- ${key}: ${value.join(", ") || "none"}`;
      }

      if (value && typeof value === "object") {
        return `- ${key}: ${JSON.stringify(value)}`;
      }

      return `- ${key}: ${String(value)}`;
    })
    .join("\n");
}

export async function assembleAgentSessionPrompt(
  agentId: string,
  asOf = new Date()
): Promise<PromptSection | null> {
  if (!(await isLearningSchemaAvailable())) {
    return null;
  }

  const pool = getAlloyDbPool();
  const dateKey = getDateKey(asOf);
  const [configResult, lessonRows, parameterResult, shortTermResult] =
    await Promise.all([
      pool.query<AgentConfigRow>(
        `
          select objective_function, system_prompt
          from agent_configs
          where agent_id = $1
          limit 1
        `,
        [agentId]
      ),
      fetchActiveLessons(pool, agentId, asOf),
      pool.query<ActiveParameterRow>(
        `
          select
            agent_id,
            parameter_key,
            parameter_type,
            value_number,
            value_integer,
            value_boolean,
            value_text
          from agent_parameter_versions
          where agent_id = $1
            and status = 'ACTIVE'
          order by parameter_key asc
        `,
        [agentId]
      ),
      pool.query<ShortTermMemoryRow>(
        `
          select agent_id, memory_date, memory_payload, updated_at
          from agent_short_term_memory
          where agent_id = $1
            and memory_date = $2::date
          limit 1
        `,
        [agentId, dateKey]
      ),
    ]);

  const config = configResult.rows[0];

  if (!config) {
    return null;
  }

  const mediumTermMemory = [
    "MEDIUM-TERM MEMORY",
    "These lessons and parameters persist across sessions and are bounded by system review.",
    "",
    "Active lessons:",
    lessonRows.length > 0
      ? lessonRows.map((row) => formatLessonSummary(row)).join("\n")
      : "- No active lessons promoted yet.",
    "",
    "Bounded parameters:",
    formatParameterSummary(agentId, parameterResult.rows),
  ]
    .join("\n")
    .trim();

  const shortTermPayload = shortTermResult.rows[0]?.memory_payload ?? null;
  const shortTermMemory = [
    "SHORT-TERM MEMORY",
    "This operating context resets daily and should be treated as ephemeral execution state.",
    "",
    formatShortTermMemory(shortTermPayload),
  ]
    .join("\n")
    .trim();

  const assembledPrompt = [
    config.system_prompt.trim(),
    mediumTermMemory,
    shortTermMemory,
  ]
    .join("\n\n---\n\n")
    .trim();

  return {
    assembledPrompt,
    mediumTermMemory,
    shortTermMemory,
    staticPrompt: config.system_prompt,
  };
}

async function getLearningAgentSystemPrompt(agentId: string, purpose: string) {
  const assembled = await assembleAgentSessionPrompt(agentId).catch(() => null);
  const fallback = DEFAULT_AGENT_SEEDS.find((seed) => seed.id === agentId)?.systemPrompt;
  const agentPrompt = assembled?.assembledPrompt ?? fallback ?? `${agentId} system prompt unavailable.`;

  return [
    agentPrompt,
    "LEARNING REVIEW DIRECTIVE:",
    "You are producing a structured review or optimization judgment for the financial research system, not roleplaying.",
    "Return strict JSON only. Do not wrap it in markdown. Do not output commentary outside the JSON object.",
    "Make recommendations only from the supplied evidence and the persistent memory available in your prompt.",
    "Do not invent research events, observations, or metrics that are not present in the provided context.",
    `Current task: ${purpose}.`,
  ].join("\n\n");
}

async function requestLearningDecisionJson(input: {
  agentId: string;
  purpose: string;
  userPrompt: string;
}) {
  const systemPrompt = await getLearningAgentSystemPrompt(input.agentId, input.purpose);

  return requestConfiguredJsonObject({
    systemPrompt,
    userPrompt: input.userPrompt,
    errorContext: `${input.agentId} ${input.purpose}`,
    route: getDecisionModelRouteForAgent(input.agentId),
  });
}

function buildWeeklySelfReviewPrompt(input: {
  agentId: TradingAgentId;
  regime: string;
  reviewDate: string;
  windowStart: string;
  windowEnd: string;
  metrics: Awaited<ReturnType<typeof fetchSignalMetrics>>;
}) {
  return JSON.stringify(
    {
      task:
        "Review your recent research outcomes and decide what lessons should persist into medium-term memory.",
      rules: [
        "Summarize the week in plain language from the supplied metrics.",
        "Return at most 3 lesson candidates and only when the evidence is strong enough to persist.",
        "Do not propose parameter changes here; only produce findings, recommendations, and lessons.",
        "If evidence is thin, return an empty lessons array.",
      ],
      outputShape: {
        summary: "string",
        findings: [
          {
            finding: "string",
            type: "string",
          },
        ],
        recommendations: [
          {
            action: "string",
            rationale: "string",
          },
        ],
        lessons: [
          {
            key: "string",
            title: "string",
            text: "string",
            biasDirection: "INCREASE|DECREASE|AVOID|PREFER|OBSERVE",
            memoryScope: "GLOBAL|REGIME|SYMBOL_CLUSTER|EXECUTION",
            confidenceScore: "0-100 number",
            weight: "0-1 number",
            sampleSize: "positive integer",
            regimes: ["string"],
            expiresInDays: "integer 7-180",
            metadata: {},
          },
        ],
      },
      context: input,
    },
    null,
    2
  );
}

function buildMonthlyOptimizationPrompt(input: {
  agentId: TradingAgentId;
  reviewDate: string;
  windowStart: string;
  windowEnd: string;
  metrics: Awaited<ReturnType<typeof fetchSignalMetrics>>;
  parameterState: Array<{
    key: string;
    label: string;
    type: LearningParameterType;
    currentValue: number;
    minValue: number;
    maxValue: number;
    maxStepPct: number;
  }>;
}) {
  return JSON.stringify(
    {
      task:
        "Review the monthly outcome set and decide whether any bounded runtime parameter should change.",
      rules: [
        "You may propose zero, one, or two parameter changes.",
        "Only use parameter keys from parameterState.",
        "Any proposed nextValue must stay within the provided bounds.",
        "If evidence is insufficient or mixed, prefer no parameter changes.",
        "Do not propose lessons here; focus on findings, recommendations, and bounded parameter changes.",
      ],
      outputShape: {
        summary: "string",
        findings: [
          {
            finding: "string",
            type: "string",
          },
        ],
        recommendations: [
          {
            action: "string",
            rationale: "string",
          },
        ],
        parameterChanges: [
          {
            parameterKey: "string",
            nextValue: "number",
            reasoning: "string",
          },
        ],
      },
      context: input,
    },
    null,
    2
  );
}

function buildQuarterlyDeepReviewPrompt(input: {
  reviewerAgentId: string;
  targetAgent: {
    id: string;
    displayName: string;
    role: string;
    status: string;
    strategyCategory: string | null;
    currentAllocationUsd: number | null;
  };
  reviewDate: string;
  windowStart: string;
  windowEnd: string;
  messageCount: number;
  metrics: {
    acceptedCount: number;
    driftSymbols: string[];
    rejectedCount: number;
    rejectionRate: number;
    totalCount: number;
    totalPnl: number;
  };
}) {
  return JSON.stringify(
    {
      task:
        "Produce a quarterly operating review for the target agent using the provided activity, outcome, and communication evidence.",
      rules: [
        "Summarize the target agent's quarter in plain language.",
        "Use findings for concrete observations and recommendations for actions or follow-up.",
        "Do not propose storage changes, prompt edits, or schema edits.",
      ],
      outputShape: {
        summary: "string",
        findings: [
          {
            finding: "string",
            type: "string",
          },
        ],
        recommendations: [
          {
            action: "string",
            rationale: "string",
          },
        ],
      },
      context: input,
    },
    null,
    2
  );
}

function validateLessonCandidate(payload: JsonRecord): AgentLessonCandidate {
  const weight = roundTo(requirePositiveNumberField(payload.weight, "lesson.weight"), 3);

  if (weight > 1) {
    throw new Error("lesson.weight must be between 0 and 1.");
  }

  return {
    key: requireStringField(payload.key, "lesson.key"),
    title: requireStringField(payload.title, "lesson.title"),
    text: requireStringField(payload.text, "lesson.text"),
    biasDirection: validateLearningBiasDirection(payload.biasDirection),
    memoryScope: validateLessonMemoryScope(payload.memoryScope),
    confidenceScore: requirePercentScore(payload.confidenceScore, "lesson.confidenceScore"),
    weight,
    sampleSize: requireIntegerInRange(payload.sampleSize, "lesson.sampleSize", {
      min: 1,
      max: 10_000,
    }),
    regimes: requireStringList(payload.regimes ?? [], "lesson.regimes"),
    expiresInDays: requireIntegerInRange(payload.expiresInDays, "lesson.expiresInDays", {
      min: 7,
      max: 180,
    }),
    metadata:
      payload.metadata === undefined
        ? {}
        : requireRecord(payload.metadata, "lesson.metadata"),
  };
}

function validateParameterChangeCandidate(
  payload: JsonRecord,
  allowedParameters: Map<
    string,
    {
      minValue: number;
      maxValue: number;
    }
  >
): AgentParameterChangeCandidate {
  const parameterKey = requireStringField(payload.parameterKey, "parameterChange.parameterKey");

  const parameter = allowedParameters.get(parameterKey);

  if (!parameter) {
    throw new Error(
      `parameterChange.parameterKey ${parameterKey} is not in the allowed parameter set.`
    );
  }

  const nextValue = requireNumberField(payload.nextValue, "parameterChange.nextValue");

  if (nextValue < parameter.minValue || nextValue > parameter.maxValue) {
    throw new Error(
      `parameterChange.nextValue for ${parameterKey} must stay within ${parameter.minValue} and ${parameter.maxValue}.`
    );
  }

  return {
    parameterKey,
    nextValue,
    reasoning: requireStringField(payload.reasoning, "parameterChange.reasoning"),
  };
}

function validateWeeklySelfReviewDecision(
  payload: JsonRecord
): AgentWeeklySelfReviewDecision {
  return {
    summary: requireStringField(payload.summary, "weeklyReview.summary"),
    findings: requireRecordList(payload.findings ?? [], "weeklyReview.findings", 6),
    recommendations: requireRecordList(
      payload.recommendations ?? [],
      "weeklyReview.recommendations",
      6
    ),
    lessons: requireRecordList(payload.lessons ?? [], "weeklyReview.lessons", 3).map(
      validateLessonCandidate
    ),
  };
}

function validateMonthlyOptimizationDecision(input: {
  payload: JsonRecord;
  allowedParameters: Map<
    string,
    {
      minValue: number;
      maxValue: number;
    }
  >;
}): AgentMonthlyOptimizationDecision {
  const seenParameterKeys = new Set<string>();
  const parameterChanges = requireRecordList(
    input.payload.parameterChanges ?? [],
    "monthlyOptimization.parameterChanges",
    2
  ).map((record) => {
    const candidate = validateParameterChangeCandidate(record, input.allowedParameters);

    if (seenParameterKeys.has(candidate.parameterKey)) {
      throw new Error(
        `monthlyOptimization.parameterChanges contains duplicate parameterKey ${candidate.parameterKey}.`
      );
    }

    seenParameterKeys.add(candidate.parameterKey);
    return candidate;
  });

  return {
    summary: requireStringField(input.payload.summary, "monthlyOptimization.summary"),
    findings: requireRecordList(
      input.payload.findings ?? [],
      "monthlyOptimization.findings",
      6
    ),
    recommendations: requireRecordList(
      input.payload.recommendations ?? [],
      "monthlyOptimization.recommendations",
      6
    ),
    parameterChanges,
  };
}

function validateQuarterlyDeepReviewDecision(
  payload: JsonRecord
): AgentQuarterlyDeepReviewDecision {
  return {
    summary: requireStringField(payload.summary, "quarterlyReview.summary"),
    findings: requireRecordList(payload.findings ?? [], "quarterlyReview.findings", 8),
    recommendations: requireRecordList(
      payload.recommendations ?? [],
      "quarterlyReview.recommendations",
      8
    ),
  };
}

async function getAgentWeeklySelfReviewDecision(input: {
  agentId: TradingAgentId;
  regime: string;
  reviewDate: string;
  windowStart: Date;
  windowEnd: Date;
  metrics: Awaited<ReturnType<typeof fetchSignalMetrics>>;
}) {
  const payload = await requestLearningDecisionJson({
    agentId: input.agentId,
    purpose: "weekly research self-review and lesson generation",
    userPrompt: buildWeeklySelfReviewPrompt({
      ...input,
      windowStart: input.windowStart.toISOString(),
      windowEnd: input.windowEnd.toISOString(),
    }),
  });

  return validateWeeklySelfReviewDecision(payload);
}

async function getAgentMonthlyOptimizationDecision(input: {
  agentId: TradingAgentId;
  reviewDate: string;
  windowStart: Date;
  windowEnd: Date;
  metrics: Awaited<ReturnType<typeof fetchSignalMetrics>>;
  parameterState: Array<{
    key: string;
    label: string;
    type: LearningParameterType;
    currentValue: number;
    minValue: number;
    maxValue: number;
    maxStepPct: number;
  }>;
}) {
  const payload = await requestLearningDecisionJson({
    agentId: input.agentId,
    purpose: "monthly bounded runtime parameter optimization",
    userPrompt: buildMonthlyOptimizationPrompt({
      ...input,
      windowStart: input.windowStart.toISOString(),
      windowEnd: input.windowEnd.toISOString(),
    }),
  });

  return validateMonthlyOptimizationDecision({
    payload,
    allowedParameters: new Map(
      input.parameterState.map((parameter) => [
        parameter.key,
        {
          minValue: parameter.minValue,
          maxValue: parameter.maxValue,
        },
      ])
    ),
  });
}

async function getAgentQuarterlyDeepReviewDecision(input: {
  reviewerAgentId: string;
  targetAgent: {
    id: string;
    displayName: string;
    role: string;
    status: string;
    strategyCategory: string | null;
    currentAllocationUsd: number | null;
  };
  reviewDate: string;
  windowStart: Date;
  windowEnd: Date;
  messageCount: number;
  metrics: {
    acceptedCount: number;
    driftSymbols: string[];
    rejectedCount: number;
    rejectionRate: number;
    totalCount: number;
    totalPnl: number;
  };
}) {
  const payload = await requestLearningDecisionJson({
    agentId: input.reviewerAgentId,
    purpose: `quarterly deep review of ${input.targetAgent.id}`,
    userPrompt: buildQuarterlyDeepReviewPrompt({
      ...input,
      windowStart: input.windowStart.toISOString(),
      windowEnd: input.windowEnd.toISOString(),
    }),
  });

  return validateQuarterlyDeepReviewDecision(payload);
}

async function insertOutcomeRecord(
  runner: QueryRunner,
  input: {
    agentId: string;
    brokerOrderId: string | null;
    clientOrderId: string | null;
    confidenceScore: number | null;
    cycleId: number | null;
    expectedWindowEnd: Date;
    notes: string;
    notional: number | null;
    outcomeStatus: "PENDING" | "RESOLVED";
    outcomeType:
      | "ACCEPTED"
      | "FILLED"
      | "PARTIALLY_FILLED"
      | "REJECTED"
      | "CANCELED"
      | "OPEN_POSITION"
      | "CLOSED_POSITION"
      | "EXPIRED";
    payload: Record<string, unknown>;
    regime: string | null;
    side: string | null;
    signalType: string;
    symbol: string | null;
  }
) {
  await runner.query(
    `
      insert into agent_signal_outcomes (
        id,
        agent_id,
        cycle_id,
        broker_order_id,
        client_order_id,
        symbol,
        side,
        signal_type,
        evaluation_horizon,
        outcome_status,
        outcome_type,
        regime,
        entry_notional,
        entry_confidence_score,
        expected_window_end,
        resolution_notes,
        payload,
        created_at,
        updated_at
      )
      values (
        $1::uuid,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        'INTRADAY',
        $9,
        $10,
        $11,
        $12,
        $13,
        $14,
        $15,
        $16::jsonb,
        now(),
        now()
      )
      on conflict do nothing
    `,
    [
      randomUUID(),
      input.agentId,
      input.cycleId,
      input.brokerOrderId,
      input.clientOrderId,
      input.symbol,
      input.side,
      input.signalType,
      input.outcomeStatus,
      input.outcomeType,
      input.regime,
      input.notional,
      input.confidenceScore,
      input.expectedWindowEnd,
      input.notes,
      JSON.stringify(input.payload),
    ]
  );
}

async function reconcilePendingOutcomes(
  runner: QueryRunner,
  brokerState:
    | {
        positions: AlpacaPositionSnapshot[];
        recentOrders: AlpacaOrderSnapshot[];
      }
    | null,
  now: Date
) {
  const pendingResult = await runner.query<PendingOutcomeRow>(
    `
      select
        id,
        broker_order_id,
        client_order_id,
        symbol,
        expected_window_end
      from agent_signal_outcomes
      where outcome_status = 'PENDING'
        and evaluation_horizon = 'INTRADAY'
      order by created_at asc
      limit 200
    `
  );
  const ordersByBrokerId = new Map<string, AlpacaOrderSnapshot>();
  const ordersByClientId = new Map<string, AlpacaOrderSnapshot>();
  const positionsBySymbol = new Map<string, AlpacaPositionSnapshot>();

  for (const order of brokerState?.recentOrders ?? []) {
    ordersByBrokerId.set(order.brokerOrderId, order);

    if (order.clientOrderId) {
      ordersByClientId.set(order.clientOrderId, order);
    }
  }

  for (const position of brokerState?.positions ?? []) {
    positionsBySymbol.set(position.symbol, position);
  }

  for (const row of pendingResult.rows) {
    const matchedOrder =
      (row.broker_order_id ? ordersByBrokerId.get(row.broker_order_id) : undefined) ??
      (row.client_order_id ? ordersByClientId.get(row.client_order_id) : undefined);
    const position = row.symbol ? positionsBySymbol.get(row.symbol) : undefined;
    const status = matchedOrder?.status ?? null;
    const shouldExpire = row.expected_window_end ? row.expected_window_end <= now : false;

    if (!matchedOrder && !shouldExpire) {
      continue;
    }

    const nextOutcomeType = matchedOrder
      ? mapOrderStatusToOutcomeType(status)
      : position
      ? "OPEN_POSITION"
      : "EXPIRED";
    const resolved =
      shouldExpire ||
      !matchedOrder ||
      isOutcomeResolved(status) ||
      nextOutcomeType === "OPEN_POSITION";

    await runner.query(
      `
        update agent_signal_outcomes
        set
          outcome_status = $2,
          outcome_type = $3,
          unrealized_pnl = $4,
          fill_quality_score = $5,
          resolved_at = case when $2 = 'RESOLVED' then now() else resolved_at end,
          resolution_notes = $6,
          updated_at = now()
        where id = $1::uuid
      `,
      [
        row.id,
        resolved ? "RESOLVED" : "PENDING",
        nextOutcomeType,
        position?.unrealizedPl ?? null,
        matchedOrder && LIVE_ORDER_STATUSES.has(matchedOrder.status.toLowerCase())
          ? matchedOrder.status.toLowerCase() === "filled"
            ? 90
            : matchedOrder.status.toLowerCase() === "partially_filled"
            ? 70
            : 55
          : null,
        matchedOrder
          ? buildOutcomeNotes(matchedOrder.status)
          : shouldExpire
          ? "The tracked order did not resolve inside the intraday review window."
          : "Position remains open while the order outcome is being tracked.",
      ]
    );
  }
}

async function syncSignalOutcomes(
  runner: QueryRunner,
  input: LearningMaintenanceInput,
  now: Date
) {
  const expectedWindowEnd = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  if (input.brokerExecution?.order) {
    await insertOutcomeRecord(runner, {
      agentId: input.brokerExecution.intent.agentId,
      brokerOrderId: input.brokerExecution.order.brokerOrderId,
      clientOrderId: input.brokerExecution.order.clientOrderId,
      confidenceScore: input.brokerExecution.intent.confidenceScore,
      cycleId: input.cycleId,
      expectedWindowEnd,
      notes: buildOutcomeNotes(input.brokerExecution.order.status),
      notional: input.brokerExecution.order.notional ?? input.brokerExecution.intent.notional,
      outcomeStatus: isOutcomeResolved(input.brokerExecution.order.status)
        ? "RESOLVED"
        : "PENDING",
      outcomeType: mapOrderStatusToOutcomeType(input.brokerExecution.order.status),
      payload: {
        requestPayload: input.brokerExecution.requestPayload,
        signalContext: input.brokerExecution.intent.signalContext,
      },
      regime: input.regime,
      side: input.brokerExecution.intent.side,
      signalType: String(
        input.brokerExecution.intent.signalContext.thesisType ??
          input.brokerExecution.intent.signalContext.catalystType ??
          input.brokerExecution.intent.signalContext.sentimentVelocity ??
          "AUTONOMOUS_ORDER"
      ),
      symbol: input.brokerExecution.intent.symbol,
    });
  } else if (input.brokerExecution?.error) {
    const clientOrderId =
      typeof input.brokerExecution.requestPayload.client_order_id === "string"
        ? input.brokerExecution.requestPayload.client_order_id
        : null;

    await insertOutcomeRecord(runner, {
      agentId: input.brokerExecution.intent.agentId,
      brokerOrderId: null,
      clientOrderId,
      confidenceScore: input.brokerExecution.intent.confidenceScore,
      cycleId: input.cycleId,
      expectedWindowEnd,
      notes: input.brokerExecution.error,
      notional: input.brokerExecution.intent.notional,
      outcomeStatus: "RESOLVED",
      outcomeType: "REJECTED",
      payload: {
        error: input.brokerExecution.error,
        requestPayload: input.brokerExecution.requestPayload,
        signalContext: input.brokerExecution.intent.signalContext,
      },
      regime: input.regime,
      side: input.brokerExecution.intent.side,
      signalType: "AUTONOMOUS_ORDER",
      symbol: input.brokerExecution.intent.symbol,
    });
  }

  await reconcilePendingOutcomes(runner, input.brokerState, now);
}

function buildOpenOrderIndex(
  brokerState:
    | {
        positions: AlpacaPositionSnapshot[];
        recentOrders: AlpacaOrderSnapshot[];
      }
    | null
) {
  const map = new Map<string, AlpacaOrderSnapshot[]>();

  for (const order of brokerState?.recentOrders ?? []) {
    if (!LIVE_ORDER_STATUSES.has(order.status.toLowerCase())) {
      continue;
    }

    const owner = inferAgentIdFromClientOrderId(order.clientOrderId);

    if (!owner) {
      continue;
    }

    const list = map.get(owner) ?? [];
    list.push(order);
    map.set(owner, list);
  }

  return map;
}

function buildOwnedPositionIndex(
  brokerState:
    | {
        positions: AlpacaPositionSnapshot[];
        recentOrders: AlpacaOrderSnapshot[];
      }
    | null
) {
  const owners = new Map<string, string>();

  for (const order of brokerState?.recentOrders ?? []) {
    if (!LIVE_ORDER_STATUSES.has(order.status.toLowerCase())) {
      continue;
    }

    const owner = inferAgentIdFromClientOrderId(order.clientOrderId);

    if (owner && !owners.has(order.symbol)) {
      owners.set(order.symbol, owner);
    }
  }

  const positionsByAgent = new Map<string, AlpacaPositionSnapshot[]>();

  for (const position of brokerState?.positions ?? []) {
    const owner = owners.get(position.symbol);

    if (!owner) {
      continue;
    }

    const list = positionsByAgent.get(owner) ?? [];
    list.push(position);
    positionsByAgent.set(owner, list);
  }

  return positionsByAgent;
}

async function refreshShortTermMemory(
  runner: QueryRunner,
  input: LearningMaintenanceInput,
  now: Date
) {
  const memoryDate = getDateKey(now);
  const agentResult = await runner.query<AgentIdentityRow>(
    `
      select
        id,
        display_name,
        role,
        strategy_category,
        status,
        current_allocation_usd
      from agents
      where paper_enabled = true
        and status = any($1::text[])
      order by tier asc, id asc
    `,
    [ACTIVE_AGENT_STATUSES]
  );
  const orderIndex = buildOpenOrderIndex(input.brokerState);
  const positionIndex = buildOwnedPositionIndex(input.brokerState);

  for (const agent of agentResult.rows) {
    const positions = positionIndex.get(agent.id) ?? [];
    const openOrders = orderIndex.get(agent.id) ?? [];
    const grossExposureUsd = roundTo(
      positions.reduce((sum, position) => sum + Math.abs(position.marketValue ?? 0), 0)
    );
    const unrealizedPlUsd = roundTo(
      positions.reduce((sum, position) => sum + (position.unrealizedPl ?? 0), 0)
    );
    const latestOrder = [...openOrders].sort(
      (left, right) =>
        new Date(right.updatedAt ?? right.submittedAt ?? 0).getTime() -
        new Date(left.updatedAt ?? left.submittedAt ?? 0).getTime()
    )[0];

    const payload: Record<string, unknown> = {
      marketStatus: input.session.marketStatus,
      phase: input.session.phase,
      sessionLabel: input.session.label,
      checkedAt: input.session.checkedAt,
      cycleId: input.cycleId,
      regime: input.regime,
      currentAllocationUsd: parseNumeric(agent.current_allocation_usd),
      positionCount: positions.length,
      positionSymbols: positions.map((position) => position.symbol),
      openOrderCount: openOrders.length,
      openOrderSymbols: openOrders.map((order) => order.symbol),
      grossExposureUsd,
      unrealizedPlUsd,
      latestOrderStatus: latestOrder?.status ?? null,
      latestOrderSymbol: latestOrder?.symbol ?? null,
      agentStatus: agent.status,
      role: agent.role,
      strategyCategory: agent.strategy_category,
    };

    await runner.query(
      `
        insert into agent_short_term_memory (
          agent_id,
          memory_date,
          memory_payload,
          reset_at,
          updated_at
        )
        values (
          $1,
          $2::date,
          $3::jsonb,
          $4,
          now()
        )
        on conflict (agent_id) do update
        set
          memory_date = excluded.memory_date,
          memory_payload = excluded.memory_payload,
          reset_at = excluded.reset_at,
          updated_at = now()
      `,
      [
        agent.id,
        memoryDate,
        JSON.stringify(payload),
        `${shiftDays(memoryDate, 1)}T00:00:00.000Z`,
      ]
    );
  }
}

async function createReviewIfAbsent(
  runner: QueryRunner,
  input: {
    agentId: string | null;
    cadence: LearningCadence;
    reviewDate: string;
    summary: string;
    windowStart: Date;
    windowEnd: Date;
    metrics: Record<string, unknown>;
    findings: unknown[];
    recommendations: unknown[];
    status?: "COMPLETED" | "SKIPPED";
  }
) {
  const result = await runner.query<{ id: string }>(
    `
      insert into agent_learning_reviews (
        id,
        agent_id,
        cadence,
        review_date,
        review_window_start,
        review_window_end,
        status,
        summary,
        metrics,
        findings,
        recommendations,
        created_at
      )
      values (
        $1::uuid,
        $2,
        $3,
        $4::date,
        $5,
        $6,
        $7,
        $8,
        $9::jsonb,
        $10::jsonb,
        $11::jsonb,
        now()
      )
      on conflict do nothing
      returning id
    `,
    [
      randomUUID(),
      input.agentId,
      input.cadence,
      input.reviewDate,
      input.windowStart,
      input.windowEnd,
      input.status ?? "COMPLETED",
      input.summary,
      JSON.stringify(input.metrics),
      JSON.stringify(input.findings),
      JSON.stringify(input.recommendations),
    ]
  );

  return result.rows[0]?.id ?? null;
}

async function maybeInsertLesson(
  runner: QueryRunner,
  input: {
    agentId: string;
    confidenceScore: number;
    createdByReviewId: string;
    evidenceWindowEnd: Date;
    evidenceWindowStart: Date;
    expiresAt: Date;
    key: string;
    memoryScope: "GLOBAL" | "REGIME" | "SYMBOL_CLUSTER" | "EXECUTION";
    metadata?: Record<string, unknown>;
    regimes: string[];
    sampleSize: number;
    text: string;
    title: string;
    weight: number;
    biasDirection: LearningBiasDirection;
  }
) {
  const existingResult = await runner.query<{
    bias_direction: LearningBiasDirection;
    created_at: Date;
    status: string;
  }>(
    `
      select bias_direction, created_at, status
      from agent_lessons
      where agent_id = $1
        and lesson_key = $2
        and status in ('ACTIVE', 'CONFLICT')
        and (expires_at is null or expires_at > now())
      order by created_at desc
      limit 1
    `,
    [input.agentId, input.key]
  );
  const existing = existingResult.rows[0];

  if (
    existing &&
    existing.bias_direction === input.biasDirection &&
    addDays(existing.created_at, 21) >= new Date()
  ) {
    return;
  }

  const conflict = existing
    ? isOppositeDirection(existing.bias_direction, input.biasDirection)
    : false;

  await runner.query(
    `
      insert into agent_lessons (
        id,
        agent_id,
        created_by_review_id,
        lesson_key,
        title,
        lesson_text,
        memory_scope,
        bias_direction,
        source_type,
        status,
        contradiction_status,
        confidence_score,
        sample_size,
        weight,
        affected_regimes,
        evidence_window_start,
        evidence_window_end,
        expires_at,
        metadata,
        created_at,
        updated_at
      )
      values (
        $1::uuid,
        $2,
        $3::uuid,
        $4,
        $5,
        $6,
        $7,
        $8,
        'SYSTEM_REVIEW',
        $9,
        $10,
        $11,
        $12,
        $13,
        $14::jsonb,
        $15,
        $16,
        $17,
        $18::jsonb,
        now(),
        now()
      )
    `,
    [
      randomUUID(),
      input.agentId,
      input.createdByReviewId,
      input.key,
      input.title,
      input.text,
      input.memoryScope,
      input.biasDirection,
      conflict ? "CONFLICT" : "ACTIVE",
      conflict ? "CONFLICTING" : "NONE",
      input.confidenceScore,
      input.sampleSize,
      input.weight,
      JSON.stringify(input.regimes),
      input.evidenceWindowStart,
      input.evidenceWindowEnd,
      input.expiresAt,
      JSON.stringify(input.metadata ?? {}),
    ]
  );
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

async function fetchSignalMetrics(
  runner: QueryRunner,
  agentId: string,
  windowStart: Date,
  windowEnd: Date
) {
  const signalResult = await runner.query<{
    accepted_count: string;
    rejected_count: string;
    resolved_count: string;
    total_count: string;
    total_pnl: string | null;
  }>(
    `
      select
        count(*)::text as total_count,
        count(*) filter (
          where outcome_type in ('ACCEPTED', 'FILLED', 'PARTIALLY_FILLED', 'OPEN_POSITION')
        )::text as accepted_count,
        count(*) filter (
          where outcome_type in ('REJECTED', 'CANCELED', 'EXPIRED')
        )::text as rejected_count,
        count(*) filter (where outcome_status = 'RESOLVED')::text as resolved_count,
        round(sum(coalesce(realized_pnl, unrealized_pnl, 0))::numeric, 2)::text as total_pnl
      from agent_signal_outcomes
      where agent_id = $1
        and created_at >= $2
        and created_at < $3
    `,
    [agentId, windowStart, windowEnd]
  );
  const orderResult = await runner.query<{ symbol: string }>(
    `
      select symbol
      from alpaca_orders
      where agent_id = $1
        and coalesce(updated_at, submitted_at) >= $2
        and coalesce(updated_at, submitted_at) < $3
      order by coalesce(updated_at, submitted_at) desc
    `,
    [agentId, windowStart, windowEnd]
  );
  const metrics = signalResult.rows[0];
  const totalCount = Number(metrics?.total_count ?? 0);
  const rejectedCount = Number(metrics?.rejected_count ?? 0);
  const acceptedCount = Number(metrics?.accepted_count ?? 0);
  const totalPnl = parseNumeric(metrics?.total_pnl) ?? 0;
  const allowedSymbols = new Set(AGENT_ALLOWED_SYMBOLS[agentId] ?? []);
  const driftSymbols = orderResult.rows
    .map((row) => row.symbol)
    .filter(
      (symbol) =>
        allowedSymbols.size > 0 &&
        !allowedSymbols.has(symbol) &&
        !allowedSymbols.has(normalizeLearningSymbol(symbol))
    );

  return {
    acceptedCount,
    driftSymbols,
    rejectedCount,
    rejectionRate: totalCount > 0 ? rejectedCount / totalCount : 0,
    totalCount,
    totalPnl,
  };
}

async function runDailyResearchSignalTracking(runner: QueryRunner, now: Date) {
  const reviewDate = getDateKey(now);
  const windowEnd = new Date(`${reviewDate}T23:59:59.999Z`);
  const windowStart = new Date(`${reviewDate}T00:00:00.000Z`);
  const metricsResult = await runner.query<{
    allocation_events: string;
    downstream_accepted_orders: string;
    downstream_orders: string;
    research_packets: string;
  }>(
    `
      with research_cycles as (
        select distinct cycle_id
        from agent_messages
        where sender_id = 'AGT-RESEARCH'
          and created_at >= $1
          and created_at < $2
      )
      select
        (
          select count(*)::text
          from agent_messages m
          where m.sender_id = 'AGT-RESEARCH'
            and m.message_type in ('RESEARCH_REPORT', 'DISCUSSION')
            and m.created_at >= $1
            and m.created_at < $2
        ) as research_packets,
        (
          select count(*)::text
          from alpaca_orders o
          where o.cycle_id in (select cycle_id from research_cycles)
        ) as downstream_orders,
        (
          select count(*)::text
          from alpaca_orders o
          where o.cycle_id in (select cycle_id from research_cycles)
            and lower(o.status) in ('accepted', 'new', 'partially_filled', 'filled')
        ) as downstream_accepted_orders,
        (
          select count(*)::text
          from agent_allocation_events e
          where e.cycle_id in (select cycle_id from research_cycles)
        ) as allocation_events
    `,
    [windowStart, windowEnd]
  );
  const metrics = metricsResult.rows[0];
  const researchPackets = Number(metrics?.research_packets ?? 0);
  const downstreamOrders = Number(metrics?.downstream_orders ?? 0);
  const downstreamAcceptedOrders = Number(metrics?.downstream_accepted_orders ?? 0);
  const allocationEvents = Number(metrics?.allocation_events ?? 0);
  const summary =
    researchPackets > 0
      ? `Research published ${researchPackets} packet(s); downstream agents produced ${downstreamAcceptedOrders} accepted-order proxy responses today.`
      : "Research published no tracked packets today, so daily usefulness could not be scored.";

  await createReviewIfAbsent(runner, {
    agentId: "AGT-RESEARCH",
    cadence: "DAILY_SIGNAL_TRACK",
    reviewDate,
    summary,
    windowStart,
    windowEnd,
    metrics: {
      allocationEvents,
      downstreamAcceptedOrders,
      downstreamOrders,
      proxyOnly: true,
      researchPackets,
    },
    findings:
      researchPackets > 0
        ? [
            {
              finding:
                "Daily research usefulness is currently measured with downstream activity proxies until signal-to-insight attribution is explicit.",
            },
          ]
        : [],
    recommendations:
      researchPackets > 0 && downstreamOrders === 0
        ? [
            {
              action: "Increase explicit downstream signal attribution for Research so usefulness is measurable beyond order proxies.",
            },
          ]
        : [],
  });
}

async function runWeeklySelfReview(
  runner: QueryRunner,
  agentId: TradingAgentId,
  regime: string,
  now: Date
) {
  const reviewDate = getWeekStartKey(now);
  const windowStart = new Date(`${reviewDate}T00:00:00.000Z`);
  const windowEnd = new Date(`${shiftDays(reviewDate, 7)}T00:00:00.000Z`);
  const metrics = await fetchSignalMetrics(runner, agentId, windowStart, windowEnd);
  const reviewDecision = await getAgentWeeklySelfReviewDecision({
    agentId,
    regime,
    reviewDate,
    windowStart,
    windowEnd,
    metrics,
  });

  const reviewId = await createReviewIfAbsent(runner, {
    agentId,
    cadence: "WEEKLY_SELF_REVIEW",
    reviewDate,
    summary: reviewDecision.summary,
    windowStart,
    windowEnd,
    metrics,
    findings: reviewDecision.findings,
    recommendations: reviewDecision.recommendations,
  });

  if (!reviewId) {
    return;
  }

  for (const lesson of reviewDecision.lessons) {
    await maybeInsertLesson(runner, {
      agentId,
      biasDirection: lesson.biasDirection,
      confidenceScore: lesson.confidenceScore,
      createdByReviewId: reviewId,
      evidenceWindowEnd: windowEnd,
      evidenceWindowStart: windowStart,
      expiresAt: addDays(windowEnd, lesson.expiresInDays),
      key: lesson.key,
      memoryScope: lesson.memoryScope,
      metadata: lesson.metadata,
      regimes: lesson.regimes.length > 0 ? lesson.regimes : [regime],
      sampleSize: lesson.sampleSize,
      text: lesson.text,
      title: lesson.title,
      weight: lesson.weight,
    });
  }
}

async function fetchLatestParameterVersion(
  runner: QueryRunner,
  agentId: string,
  parameterKey: string
) {
  const result = await runner.query<ParameterVersionRow>(
    `
      select
        id,
        parameter_key,
        parameter_type,
        value_number,
        value_integer,
        max_step_pct,
        change_direction,
        status,
        effective_at,
        created_at
      from agent_parameter_versions
      where agent_id = $1
        and parameter_key = $2
      order by
        case when status = 'ACTIVE' then 0 else 1 end,
        effective_at desc,
        created_at desc
      limit 2
    `,
    [agentId, parameterKey]
  );

  return result.rows;
}

function coerceCurrentParameterValue(
  spec: LearningParameterSpec,
  row: ParameterVersionRow | undefined
) {
  if (!row) {
    return spec.defaultValue;
  }

  if (spec.type === "INTEGER") {
    return Number(row.value_integer ?? spec.defaultValue);
  }

  return parseNumeric(row.value_number) ?? spec.defaultValue;
}

async function promoteParameterChange(
  runner: QueryRunner,
  input: {
    agentId: string;
    parameterKey: string;
    reviewId: string;
    nextValue: number;
    reasoning: string;
  }
) {
  const spec = getSpecsForAgent(input.agentId).find(
    (candidate) => candidate.key === input.parameterKey
  );

  if (!spec) {
    return false;
  }

  const versions = await fetchLatestParameterVersion(
    runner,
    input.agentId,
    input.parameterKey
  );
  const current = versions.find((version) => version.status === "ACTIVE");
  const previous = versions.find((version) => version.status !== "ACTIVE");
  const currentValue = coerceCurrentParameterValue(spec, current);
  const maxStepPct = parseNumeric(current?.max_step_pct) ?? spec.maxStepPct;
  const stepLimit =
    spec.type === "INTEGER"
      ? Math.max(1, Math.round(Math.abs(currentValue) * maxStepPct))
      : Math.max(0.01, Math.abs(currentValue) * maxStepPct);
  const boundedTarget = clamp(input.nextValue, spec.minValue, spec.maxValue);
  const rawDelta = boundedTarget - currentValue;

  if (Math.abs(rawDelta) < (spec.type === "INTEGER" ? 1 : 0.0001)) {
    return false;
  }

  const direction: ChangeDirection = rawDelta > 0 ? "INCREASE" : "DECREASE";

  if (
    previous &&
    previous.change_direction !== "NONE" &&
    previous.change_direction !== direction &&
    addDays(previous.effective_at, 45) > new Date()
  ) {
    return false;
  }

  const clampedDelta = clamp(rawDelta, -stepLimit, stepLimit);
  const nextClampedValue = clamp(currentValue + clampedDelta, spec.minValue, spec.maxValue);

  if (Math.abs(nextClampedValue - currentValue) < (spec.type === "INTEGER" ? 1 : 0.0001)) {
    return false;
  }

  await runner.query(
    `
      update agent_parameter_versions
      set status = 'SUPERSEDED'
      where agent_id = $1
        and parameter_key = $2
        and status = 'ACTIVE'
    `,
    [input.agentId, input.parameterKey]
  );

  await runner.query(
    `
      insert into agent_parameter_versions (
        id,
        agent_id,
        promoted_by_review_id,
        parameter_key,
        parameter_type,
        value_number,
        value_integer,
        min_value,
        max_value,
        max_step_pct,
        change_direction,
        status,
        reasoning,
        effective_at,
        created_at
      )
      values (
        $1::uuid,
        $2,
        $3::uuid,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9,
        $10,
        $11,
        'ACTIVE',
        $12,
        now(),
        now()
      )
    `,
    [
      randomUUID(),
      input.agentId,
      input.reviewId,
      input.parameterKey,
      spec.type,
      spec.type === "NUMBER" ? nextClampedValue : null,
      spec.type === "INTEGER" ? Math.round(nextClampedValue) : null,
      spec.minValue,
      spec.maxValue,
      spec.maxStepPct,
      direction,
      input.reasoning,
    ]
  );

  return true;
}

async function runMonthlyParameterOptimization(
  runner: QueryRunner,
  agentId: TradingAgentId,
  now: Date
) {
  const reviewDate = getMonthStartKey(now);
  const windowStart = new Date(`${reviewDate}T00:00:00.000Z`);
  const windowEnd = new Date(`${shiftDays(reviewDate, 31)}T00:00:00.000Z`);
  const metrics = await fetchSignalMetrics(runner, agentId, windowStart, windowEnd);
  const parameterSpecs = getSpecsForAgent(agentId);
  const versionResults = await Promise.all(
    parameterSpecs.map(async (spec) => [
      spec.key,
      await fetchLatestParameterVersion(runner, agentId, spec.key),
    ] as const)
  );
  const versionMap = new Map(versionResults);
  const parameterState = parameterSpecs.map((spec) => ({
    key: spec.key,
    label: spec.label,
    type: spec.type,
    currentValue: coerceCurrentParameterValue(
      spec,
      versionMap.get(spec.key)?.find((version) => version.status === "ACTIVE")
    ),
    minValue: spec.minValue,
    maxValue: spec.maxValue,
    maxStepPct: spec.maxStepPct,
  }));
  const optimizationDecision = await getAgentMonthlyOptimizationDecision({
    agentId,
    reviewDate,
    windowStart,
    windowEnd,
    metrics,
    parameterState,
  });

  const reviewId = await createReviewIfAbsent(runner, {
    agentId,
    cadence: "MONTHLY_PARAMETER_OPTIMIZATION",
    reviewDate,
    summary: optimizationDecision.summary,
    windowStart,
    windowEnd,
    metrics,
    findings: optimizationDecision.findings,
    recommendations: optimizationDecision.recommendations,
  });

  if (!reviewId) {
    return;
  }

  let promotedCount = 0;

  for (const change of optimizationDecision.parameterChanges) {
    const promoted = await promoteParameterChange(runner, {
      agentId,
      parameterKey: change.parameterKey,
      reviewId,
      nextValue: change.nextValue,
      reasoning: change.reasoning,
    });

    if (promoted) {
      promotedCount += 1;
    }
  }

  if (promotedCount > 0) {
    await runner.query(
      `
        update agent_learning_reviews
        set
          recommendations = recommendations || $2::jsonb,
          updated_at = now()
        where id = $1::uuid
      `,
      [
        reviewId,
        JSON.stringify([
          {
            action: `Promoted ${promotedCount} bounded parameter change${promotedCount === 1 ? "" : "s"} under monthly learning limits.`,
          },
        ]),
      ]
    );
  }
}

async function runQuarterlyDeepReview(
  runner: QueryRunner,
  agent: AgentIdentityRow,
  now: Date
) {
  const reviewDate = getQuarterStartKey(now);
  const windowStart = new Date(`${reviewDate}T00:00:00.000Z`);
  const windowEnd = new Date(`${shiftDays(reviewDate, 92)}T00:00:00.000Z`);
  const messageResult = await runner.query<{ message_count: string }>(
    `
      select count(*)::text as message_count
      from agent_messages
      where sender_id = $1
        and created_at >= $2
        and created_at < $3
    `,
    [agent.id, windowStart, windowEnd]
  );
  const metrics =
    agent.id === "AGT-MACRO-001" ||
    agent.id === "AGT-EVENT-001" ||
    agent.id === "AGT-SENT-001"
      ? await fetchSignalMetrics(runner, agent.id, windowStart, windowEnd)
      : {
          acceptedCount: 0,
          driftSymbols: [],
          rejectedCount: 0,
          rejectionRate: 0,
          totalCount: 0,
          totalPnl: 0,
        };
  const messageCount = Number(messageResult.rows[0]?.message_count ?? 0);
  const reviewerAgentId = agent.id === "AGT-CIO" ? "AGT-RESEARCH" : "AGT-CIO";
  const reviewDecision = await getAgentQuarterlyDeepReviewDecision({
    reviewerAgentId,
    targetAgent: {
      id: agent.id,
      displayName: agent.display_name,
      role: agent.role,
      status: agent.status,
      strategyCategory: agent.strategy_category,
      currentAllocationUsd: parseNumeric(agent.current_allocation_usd),
    },
    reviewDate,
    windowStart,
    windowEnd,
    messageCount,
    metrics,
  });

  await createReviewIfAbsent(runner, {
    agentId: agent.id,
    cadence: "QUARTERLY_DEEP_REVIEW",
    reviewDate,
    summary: reviewDecision.summary,
    windowStart,
    windowEnd,
    metrics: {
      ...metrics,
      messageCount,
    },
    findings: reviewDecision.findings,
    recommendations: reviewDecision.recommendations,
  });
}

export async function runLearningMaintenance(input: LearningMaintenanceInput) {
  if (!(await isLearningSchemaAvailable())) {
    return;
  }

  await ensureAgentLearningSeeded();

  const pool = getAlloyDbPool();
  const client = await pool.connect();
  const now = new Date();

  try {
    await client.query("begin");
    await syncSignalOutcomes(client, input, now);
    await refreshShortTermMemory(client, input, now);
    await runDailyResearchSignalTracking(client, now);

    for (const agentId of TRADING_AGENT_IDS) {
      await runWeeklySelfReview(client, agentId, input.regime, now);
      await runMonthlyParameterOptimization(client, agentId, now);
    }

    const agentResult = await client.query<AgentIdentityRow>(
      `
        select
          id,
          display_name,
          role,
          strategy_category,
          status,
          current_allocation_usd
        from agents
        where paper_enabled = true
          and status = any($1::text[])
        order by tier asc, id asc
      `,
      [ACTIVE_AGENT_STATUSES]
    );

    for (const agent of agentResult.rows) {
      await runQuarterlyDeepReview(client, agent, now);
    }

    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
