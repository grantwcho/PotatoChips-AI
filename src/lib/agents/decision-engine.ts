import "server-only";

import { DEFAULT_AGENT_SEEDS } from "@/lib/agents/default-agents";
import { assembleAgentSessionPrompt } from "@/lib/agents/learning";
import { requestConfiguredJsonObject, type JsonSchema } from "@/lib/agents/model-json";
import { getDecisionModelRouteForAgent } from "@/lib/agents/model-routing";
import { runPythonTradingAgent } from "@/lib/agents/python-trading";
import type { CioAllocationInput } from "@/lib/agents/repository";
import {
  TRADING_AGENT_IDS,
  getTradingAgentRole,
  isPythonTradingAgentId,
  isTradingAgentId,
  type TradingAgentId,
} from "@/lib/agents/trading-agent-config";
import type { RuntimeSessionSnapshot } from "@/lib/agents/types";
import {
  getKalshiResearchPacket,
  summarizeKalshiPacketForAgents,
  type KalshiResearchPacket,
} from "@/lib/research/kalshi";
import {
  getMassiveResearchPacket,
  summarizeMassivePacketForAgents,
  type MassiveResearchPacket,
} from "@/lib/research/massive";
import {
  getNewsApiResearchPacket,
  summarizeNewsApiPacketForAgents,
  type NewsApiResearchPacket,
} from "@/lib/research/newsapi";
import {
  getPolymarketResearchPacket,
  summarizePolymarketPacketForAgents,
  type PolymarketResearchPacket,
} from "@/lib/research/polymarket";
import {
  getSecEarningsPacket,
  summarizeSecEarningsPacketForAgents,
  type SecEarningsPacket,
} from "@/lib/research/sec-edgar";
import { parseAlpacaOptionContractSymbol } from "@/lib/trading/alpaca";
import type {
  AlpacaAccountSnapshot,
  AlpacaOrderSnapshot,
  AlpacaPositionSnapshot,
  AlpacaOrderSide,
} from "@/lib/trading/types";
type JsonRecord = Record<string, unknown>;
type PythonTraderEvidence = {
  allowedSymbols: string[];
  allowedExpressionKinds: TraderDecisionExpressionKind[];
  allowedPairs: Array<{
    pairKey: string;
    longSymbol: string;
    shortSymbol: string;
  }>;
};

export type AgentDecisionMarketContext = {
  researchFocus: string;
  planningRationale: string;
  benchmarkSymbols: string[];
  eventTickers: string[];
  sentimentTickers: string[];
  massiveSymbols: string[];
  kalshiQueries: string[];
  polymarketQueries: string[];
  newsQueries: string[];
  secTickers: string[];
  macroRead: string;
  eventRead: string;
  sentimentRead: string;
  researchSource: "AGENT_DIRECTED";
  researchPacketSummary: string;
  massiveSummary: string;
  kalshiSummary: string;
  polymarketSummary: string;
  newsApiSummary: string;
  secEdgarSummary: string;
  dataConsumed: string[];
};

export type AgentDecisionDependencyStatus = {
  sourceId: string;
  healthy: boolean;
  summary: string;
  error: string | null;
  impact: string;
};

export type AgentRiskGuardrails = {
  maxSingleOrderPctOfAllocation: number;
  maxSleeveUtilizationPct: number;
  maxPortfolioGrossExposurePct: number;
  buyingPowerBufferPct: number;
  minOrderNotional: number;
};

export type ResearchAgentDecision = {
  marketRegime: string;
  researchArea: string;
  selectedEventTicker: string | null;
  selectedSentimentTicker: string | null;
  sentimentScore: number;
  observation: string;
  whyItMatters: string;
  changeMind: string;
  confidenceScore: number;
  macroSummary: string;
  eventSummary: string;
  sentimentSummary: string;
  influenceNotes: Record<TradingAgentId, string>;
  dataConsumed: string[];
};

export type TraderDecisionExpressionKind =
  | "equity"
  | "equity_pair"
  | "option_single"
  | "option_spread"
  | "long_straddle";

export type TraderAgentTradeIdea = {
  symbol: string;
  side: "buy" | "sell";
  requestedNotionalUsd: number;
  strategyFamily: string;
  expressionKind: TraderDecisionExpressionKind;
  optionType?: "call" | "put";
  targetDaysToExpiration?: number;
  strikeOffsetPct?: number;
  thesisLabel: string;
  assetBucketLabel?: string | null;
  secondarySymbol?: string | null;
  secondarySide?: "buy" | "sell";
  longSymbol?: string | null;
  shortSymbol?: string | null;
  longNotionalUsd?: number;
  shortNotionalUsd?: number;
};

export type TraderAgentDecision = {
  agentId: TradingAgentId;
  shouldTrade: boolean;
  observation: string;
  whyItMatters: string;
  changeMind: string;
  confidenceScore: number;
  reasoning: string;
  discussionNote: string;
  dataConsumed: string[];
  trade: TraderAgentTradeIdea | null;
};

export type CioAllocationDecisionOutput = {
  agentId: TradingAgentId;
  targetAllocationUsd: number;
  rationale: string;
  confidenceScore: number;
};

export type CioGuardrailDecisionOutput = {
  agentId: TradingAgentId;
  rationale: string;
  confidenceScore: number;
  guardrails: AgentRiskGuardrails;
};

export type CioCycleDirectives = {
  allowTrading: boolean;
  activeTradingAgents: TradingAgentId[];
  rationale: string;
};

export type CioAgentDecision = {
  observation: string;
  whyItMatters: string;
  changeMind: string;
  confidenceScore: number;
  allocationBoundary: string;
  cycleDirectives: CioCycleDirectives;
  selectedTradeAgentId: TradingAgentId | null;
  selectedTradeRationale: string;
  allocations: Record<TradingAgentId, CioAllocationDecisionOutput>;
  guardrailsByAgent: Record<TradingAgentId, CioGuardrailDecisionOutput>;
  dataConsumed: string[];
};

export type AgentDecisionSet = {
  research: ResearchAgentDecision;
  traders: Record<TradingAgentId, TraderAgentDecision>;
  cio: CioAgentDecision;
};

export type AgentResearchPlan = {
  researchFocus: string;
  planningRationale: string;
  benchmarkSymbols: string[];
  eventTickers: string[];
  sentimentTickers: string[];
  massiveSymbols: string[];
  kalshiQueries: string[];
  polymarketQueries: string[];
  newsQueries: string[];
  secTickers: string[];
  dataConsumed: string[];
};

export type AgentDirectedResearchCollection = {
  researchPlan: AgentResearchPlan;
  marketContext: AgentDecisionMarketContext;
  dependencyStatuses: AgentDecisionDependencyStatus[];
  retentionPackets: AgentRetainedResearchPacket[];
};

export type AgentRetainedResearchPacket = {
  sourceId: ResearchDependencySourceId;
  summary: string;
  payload: unknown;
};

export type AgentTradeIntentSummary = {
  agentId: TradingAgentId;
  symbol: string;
  side: AlpacaOrderSide;
  requestedNotionalUsd: number;
  assetBucket: string;
  strategyFamily: string;
  displaySymbol: string | null;
  executionKind: "equity" | "equity_pair" | "option_single" | "option_mleg";
  contractSymbols: string[];
  signalContext: Record<string, unknown>;
};

export type AgentRiskDispositionDecision = {
  approveTrade: boolean;
  approvedNotionalUsd: number;
  rationale: string;
  changeMind: string;
  confidenceScore: number;
  dataConsumed: string[];
};

export type AgentReplacementHoldingCandidate = {
  agentId: TradingAgentId;
  symbol: string;
  assetBucket: string;
  marketValueUsd: number;
  maxReducibleNotionalUsd: number;
  unrealizedPlUsd: number;
  currentPriceUsd: number | null;
  positionAgeDays: number | null;
  targetAllocationUsd: number | null;
  agentExposureUsd: number | null;
  ownerConfidenceScore: number;
  ownerShouldTrade: boolean;
  ownerTradeSymbol: string | null;
  ownerTradeSide: "buy" | "sell" | null;
};

export type AgentReplacementDecision = {
  shouldReplace: boolean;
  fundingAgentId: TradingAgentId | null;
  fundingSymbol: string | null;
  fundingNotionalUsd: number;
  incomingExpectedReturnBps: number;
  fundingExpectedReturnBps: number;
  netAdvantageBps: number;
  estimatedRoundTripCostBps: number;
  requiredHurdleBps: number;
  rationale: string;
  changeMind: string;
  confidenceScore: number;
  dataConsumed: string[];
};

export type AgentOptionExecutionCandidate = {
  symbol: string;
  optionType: "call" | "put";
  expirationDate: string | null;
  strikePrice: number | null;
  premium: number;
  askPrice: number | null;
  bidPrice: number | null;
  tradePrice: number | null;
  daysToExpiration: number;
};

export type AgentOptionExecutionDecision =
  | {
      canExecute: false;
      rationale: string;
      changeMind: string;
      confidenceScore: number;
      dataConsumed: string[];
    }
  | {
      canExecute: true;
      qty: number;
      limitPrice: number;
      rationale: string;
      changeMind: string;
      confidenceScore: number;
      dataConsumed: string[];
      contractSymbol: string;
    }
  | {
      canExecute: true;
      qty: number;
      limitPrice: number;
      rationale: string;
      changeMind: string;
      confidenceScore: number;
      dataConsumed: string[];
      longContractSymbol: string;
      shortContractSymbol: string;
    }
  | {
      canExecute: true;
      qty: number;
      limitPrice: number;
      rationale: string;
      changeMind: string;
      confidenceScore: number;
      dataConsumed: string[];
      callContractSymbol: string;
      putContractSymbol: string;
    };

type AgentDecisionInput = {
  session: RuntimeSessionSnapshot;
  marketContext: AgentDecisionMarketContext;
  dependencyStatuses: AgentDecisionDependencyStatus[];
  brokerState:
    | {
        account: AlpacaAccountSnapshot;
        positions: AlpacaPositionSnapshot[];
        recentOrders: AlpacaOrderSnapshot[];
      }
    | null;
  allocationInputs: CioAllocationInput[];
};

const RESEARCH_DEPENDENCY_IMPACTS = {
  MASSIVE:
    "Primary market and company evidence is thinner, so downstream decisions have less direct tape and news context.",
  KALSHI:
    "Crowd-implied macro and event probabilities are missing, so the desk loses one external expectations check.",
  POLYMARKET:
    "Prediction-market sentiment is missing, so the desk loses one crowd-positioning cross-check.",
  SEC_EDGAR:
    "Filing verification is missing, so catalyst conviction has to lean more on secondary sources.",
  NEWSAPI:
    "Supplemental headline flow is missing, so narrative confirmation is thinner this cycle.",
} satisfies Record<
  "MASSIVE" | "KALSHI" | "POLYMARKET" | "SEC_EDGAR" | "NEWSAPI",
  string
>;

type ResearchDependencySourceId = keyof typeof RESEARCH_DEPENDENCY_IMPACTS;

function asString(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function asNullableString(value: unknown) {
  const normalized = asString(value);
  return normalized.length > 0 ? normalized : null;
}

function asNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function roundTo(value: number, decimals = 2) {
  const multiplier = 10 ** decimals;
  return Math.round(value * multiplier) / multiplier;
}

function requireStringField(value: unknown, label: string) {
  const normalized = asString(value);

  if (!normalized) {
    throw new Error(`Decision payload omitted ${label}.`);
  }

  return normalized;
}

function requireNumberField(value: unknown, label: string) {
  const normalized = asNumber(value);

  if (normalized === null) {
    throw new Error(`Decision payload omitted numeric field ${label}.`);
  }

  return normalized;
}

function requireBooleanField(value: unknown, label: string) {
  if (typeof value !== "boolean") {
    throw new Error(`Decision payload omitted boolean field ${label}.`);
  }

  return value;
}

function requirePercentScore(value: unknown, label: string) {
  const score = requireNumberField(value, label);

  if (score < 0 || score > 100) {
    throw new Error(`${label} must be between 0 and 100.`);
  }

  return Math.round(score);
}

function requirePositiveNumberField(value: unknown, label: string) {
  const normalized = requireNumberField(value, label);

  if (normalized <= 0) {
    throw new Error(`${label} must be greater than 0.`);
  }

  return normalized;
}

function requireNonNegativeNumberField(value: unknown, label: string) {
  const normalized = requireNumberField(value, label);

  if (normalized < 0) {
    throw new Error(`${label} must be 0 or greater.`);
  }

  return normalized;
}

function requireRecord(value: unknown, label: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Decision payload omitted object ${label}.`);
  }

  return value as JsonRecord;
}

function requireStringList(value: unknown, label: string, input?: {
  min?: number;
  max?: number;
}) {
  if (!Array.isArray(value)) {
    throw new Error(`Decision payload omitted array ${label}.`);
  }

  const normalized = Array.from(
    new Set(
      value
        .map((item) => asString(item))
        .filter((item) => item.length > 0)
    )
  ).slice(0, input?.max ?? 8);

  if (normalized.length < (input?.min ?? 0)) {
    throw new Error(
      `${label} must contain at least ${input?.min ?? 0} entr${(input?.min ?? 0) === 1 ? "y" : "ies"}.`
    );
  }

  return normalized;
}

function requireSymbolList(value: unknown, label: string, input?: {
  min?: number;
  max?: number;
}) {
  return requireStringList(value, label, input).map((item) => item.toUpperCase());
}

function normalizeOptionalSymbol(value: unknown, label: string) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== "string") {
    throw new Error(`${label} must be a string or null.`);
  }

  const normalized = value.trim().toUpperCase();
  return normalized.length > 0 ? normalized : null;
}

function validateTradingAgentId(value: unknown): TradingAgentId | null {
  return isTradingAgentId(value) ? value : null;
}

function normalizeTraderTradeSymbol(
  symbol: string,
  expressionKind: TraderDecisionExpressionKind
) {
  const normalized = symbol.trim().toUpperCase();

  if (
    expressionKind !== "option_single" &&
    expressionKind !== "option_spread" &&
    expressionKind !== "long_straddle"
  ) {
    return normalized;
  }

  return parseAlpacaOptionContractSymbol(normalized)?.underlyingSymbol ?? normalized;
}

async function requestValidatedAgentJsonDecision<T>(input: {
  agentId: string;
  purpose: string;
  userPrompt: string;
  validate: (payload: JsonRecord) => T;
  schema?: JsonSchema;
}) {
  const systemPrompt = await getAgentSystemPrompt(input.agentId, input.purpose);

  return requestConfiguredJsonObject({
    systemPrompt,
    userPrompt: input.userPrompt,
    errorContext: `${input.agentId} ${input.purpose}`,
    validate: input.validate,
    anthropicSchema: input.schema,
    route: getDecisionModelRouteForAgent(input.agentId),
  });
}

async function getAgentSystemPrompt(agentId: string, purpose: string) {
  const assembled = await assembleAgentSessionPrompt(agentId).catch(() => null);
  const fallback = DEFAULT_AGENT_SEEDS.find((seed) => seed.id === agentId)?.systemPrompt;
  const agentPrompt = assembled?.assembledPrompt ?? fallback ?? `${agentId} system prompt unavailable.`;

  return [
    agentPrompt,
    "RUNTIME DIRECTIVE:",
    "You are making a real structured runtime decision for the financial research loop, not roleplaying.",
    "Return strict JSON only. Do not wrap it in markdown. Do not output commentary outside the JSON object.",
    "Use only the supplied context. If evidence is weak or a research event should be skipped, say so explicitly.",
    `Current task: ${purpose}.`,
  ].join("\n\n");
}

const JSON_STRING_SCHEMA = { type: "string" } satisfies JsonSchema;
const JSON_NUMBER_SCHEMA = { type: "number" } satisfies JsonSchema;
const JSON_BOOLEAN_SCHEMA = { type: "boolean" } satisfies JsonSchema;
const JSON_NULL_SCHEMA = { type: "null" } satisfies JsonSchema;

function jsonObjectSchema(
  properties: Record<string, JsonSchema>,
  required: string[] = Object.keys(properties)
): JsonSchema {
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  };
}

function jsonArraySchema(items: JsonSchema): JsonSchema {
  return {
    type: "array",
    items,
  };
}

function jsonEnumSchema(values: readonly string[]): JsonSchema {
  return {
    type: "string",
    enum: [...values],
  };
}

function jsonNullableSchema(schema: JsonSchema): JsonSchema {
  return {
    anyOf: [schema, JSON_NULL_SCHEMA],
  };
}

function jsonRecordSchema(keys: readonly string[], valueSchema: JsonSchema): JsonSchema {
  return jsonObjectSchema(
    Object.fromEntries(keys.map((key) => [key, valueSchema])) as Record<string, JsonSchema>,
    [...keys]
  );
}

const TRADING_AGENT_ID_SCHEMA = jsonEnumSchema(TRADING_AGENT_IDS);
const TRADE_SIDE_SCHEMA = jsonEnumSchema(["buy", "sell"] as const);
const OPTION_TYPE_SCHEMA = jsonEnumSchema(["call", "put"] as const);
const TRADE_EXPRESSION_KIND_SCHEMA = jsonEnumSchema([
  "equity",
  "equity_pair",
  "option_single",
  "option_spread",
  "long_straddle",
] as const);

const RESEARCH_PLAN_SCHEMA = jsonObjectSchema({
  researchFocus: JSON_STRING_SCHEMA,
  planningRationale: JSON_STRING_SCHEMA,
  benchmarkSymbols: jsonArraySchema(JSON_STRING_SCHEMA),
  eventTickers: jsonArraySchema(JSON_STRING_SCHEMA),
  sentimentTickers: jsonArraySchema(JSON_STRING_SCHEMA),
  massiveSymbols: jsonArraySchema(JSON_STRING_SCHEMA),
  kalshiQueries: jsonArraySchema(JSON_STRING_SCHEMA),
  polymarketQueries: jsonArraySchema(JSON_STRING_SCHEMA),
  newsQueries: jsonArraySchema(JSON_STRING_SCHEMA),
  secTickers: jsonArraySchema(JSON_STRING_SCHEMA),
  dataConsumed: jsonArraySchema(JSON_STRING_SCHEMA),
});

const RESEARCH_DECISION_SCHEMA = jsonObjectSchema({
  marketRegime: JSON_STRING_SCHEMA,
  researchArea: JSON_STRING_SCHEMA,
  selectedEventTicker: jsonNullableSchema(JSON_STRING_SCHEMA),
  selectedSentimentTicker: jsonNullableSchema(JSON_STRING_SCHEMA),
  sentimentScore: JSON_NUMBER_SCHEMA,
  observation: JSON_STRING_SCHEMA,
  whyItMatters: JSON_STRING_SCHEMA,
  changeMind: JSON_STRING_SCHEMA,
  confidenceScore: JSON_NUMBER_SCHEMA,
  macroSummary: JSON_STRING_SCHEMA,
  eventSummary: JSON_STRING_SCHEMA,
  sentimentSummary: JSON_STRING_SCHEMA,
  influenceNotes: jsonRecordSchema(TRADING_AGENT_IDS, JSON_STRING_SCHEMA),
  dataConsumed: jsonArraySchema(JSON_STRING_SCHEMA),
});

const TRADER_TRADE_IDEA_SCHEMA = jsonObjectSchema({
  symbol: JSON_STRING_SCHEMA,
  side: TRADE_SIDE_SCHEMA,
  requestedNotionalUsd: JSON_NUMBER_SCHEMA,
  strategyFamily: JSON_STRING_SCHEMA,
  expressionKind: TRADE_EXPRESSION_KIND_SCHEMA,
  optionType: jsonNullableSchema(OPTION_TYPE_SCHEMA),
  targetDaysToExpiration: jsonNullableSchema(JSON_NUMBER_SCHEMA),
  strikeOffsetPct: jsonNullableSchema(JSON_NUMBER_SCHEMA),
  thesisLabel: JSON_STRING_SCHEMA,
  assetBucketLabel: jsonNullableSchema(JSON_STRING_SCHEMA),
  secondarySymbol: jsonNullableSchema(JSON_STRING_SCHEMA),
  secondarySide: jsonNullableSchema(TRADE_SIDE_SCHEMA),
  longSymbol: jsonNullableSchema(JSON_STRING_SCHEMA),
  shortSymbol: jsonNullableSchema(JSON_STRING_SCHEMA),
  longNotionalUsd: jsonNullableSchema(JSON_NUMBER_SCHEMA),
  shortNotionalUsd: jsonNullableSchema(JSON_NUMBER_SCHEMA),
});

const TRADER_DECISION_SCHEMA = jsonObjectSchema({
  shouldTrade: JSON_BOOLEAN_SCHEMA,
  observation: JSON_STRING_SCHEMA,
  whyItMatters: JSON_STRING_SCHEMA,
  changeMind: JSON_STRING_SCHEMA,
  confidenceScore: JSON_NUMBER_SCHEMA,
  reasoning: JSON_STRING_SCHEMA,
  discussionNote: JSON_STRING_SCHEMA,
  dataConsumed: jsonArraySchema(JSON_STRING_SCHEMA),
  trade: jsonNullableSchema(TRADER_TRADE_IDEA_SCHEMA),
});

const CIO_ALLOCATION_SCHEMA = jsonObjectSchema({
  agentId: TRADING_AGENT_ID_SCHEMA,
  targetAllocationUsd: JSON_NUMBER_SCHEMA,
  rationale: JSON_STRING_SCHEMA,
  confidenceScore: JSON_NUMBER_SCHEMA,
});

const CIO_GUARDRAIL_SCHEMA = jsonObjectSchema({
  agentId: TRADING_AGENT_ID_SCHEMA,
  rationale: JSON_STRING_SCHEMA,
  confidenceScore: JSON_NUMBER_SCHEMA,
  maxSingleOrderPctOfAllocation: JSON_NUMBER_SCHEMA,
  maxSleeveUtilizationPct: JSON_NUMBER_SCHEMA,
  maxPortfolioGrossExposurePct: JSON_NUMBER_SCHEMA,
  buyingPowerBufferPct: JSON_NUMBER_SCHEMA,
  minOrderNotional: JSON_NUMBER_SCHEMA,
});

const CIO_DECISION_SCHEMA = jsonObjectSchema({
  observation: JSON_STRING_SCHEMA,
  whyItMatters: JSON_STRING_SCHEMA,
  changeMind: JSON_STRING_SCHEMA,
  confidenceScore: JSON_NUMBER_SCHEMA,
  allocationBoundary: JSON_STRING_SCHEMA,
  cycleDirectives: jsonObjectSchema({
    allowTrading: JSON_BOOLEAN_SCHEMA,
    activeTradingAgents: jsonArraySchema(TRADING_AGENT_ID_SCHEMA),
    rationale: JSON_STRING_SCHEMA,
  }),
  selectedTradeAgentId: jsonNullableSchema(TRADING_AGENT_ID_SCHEMA),
  selectedTradeRationale: JSON_STRING_SCHEMA,
  allocations: jsonArraySchema(CIO_ALLOCATION_SCHEMA),
  guardrails: jsonArraySchema(CIO_GUARDRAIL_SCHEMA),
  dataConsumed: jsonArraySchema(JSON_STRING_SCHEMA),
});

const RISK_DISPOSITION_SCHEMA = jsonObjectSchema({
  approveTrade: JSON_BOOLEAN_SCHEMA,
  approvedNotionalUsd: JSON_NUMBER_SCHEMA,
  rationale: JSON_STRING_SCHEMA,
  changeMind: JSON_STRING_SCHEMA,
  confidenceScore: JSON_NUMBER_SCHEMA,
  dataConsumed: jsonArraySchema(JSON_STRING_SCHEMA),
});

const REPLACEMENT_DECISION_SCHEMA = jsonObjectSchema({
  shouldReplace: JSON_BOOLEAN_SCHEMA,
  fundingAgentId: jsonNullableSchema(TRADING_AGENT_ID_SCHEMA),
  fundingSymbol: jsonNullableSchema(JSON_STRING_SCHEMA),
  fundingNotionalUsd: JSON_NUMBER_SCHEMA,
  incomingExpectedReturnBps: JSON_NUMBER_SCHEMA,
  fundingExpectedReturnBps: JSON_NUMBER_SCHEMA,
  netAdvantageBps: JSON_NUMBER_SCHEMA,
  estimatedRoundTripCostBps: JSON_NUMBER_SCHEMA,
  requiredHurdleBps: JSON_NUMBER_SCHEMA,
  rationale: JSON_STRING_SCHEMA,
  changeMind: JSON_STRING_SCHEMA,
  confidenceScore: JSON_NUMBER_SCHEMA,
  dataConsumed: jsonArraySchema(JSON_STRING_SCHEMA),
});

const OPTION_EXECUTION_SCHEMA = jsonObjectSchema({
  canExecute: JSON_BOOLEAN_SCHEMA,
  contractSymbol: jsonNullableSchema(JSON_STRING_SCHEMA),
  longContractSymbol: jsonNullableSchema(JSON_STRING_SCHEMA),
  shortContractSymbol: jsonNullableSchema(JSON_STRING_SCHEMA),
  callContractSymbol: jsonNullableSchema(JSON_STRING_SCHEMA),
  putContractSymbol: jsonNullableSchema(JSON_STRING_SCHEMA),
  qty: jsonNullableSchema(JSON_NUMBER_SCHEMA),
  limitPrice: jsonNullableSchema(JSON_NUMBER_SCHEMA),
  rationale: JSON_STRING_SCHEMA,
  changeMind: JSON_STRING_SCHEMA,
  confidenceScore: JSON_NUMBER_SCHEMA,
  dataConsumed: jsonArraySchema(JSON_STRING_SCHEMA),
});

function summarizeBrokerState(
  brokerState: AgentDecisionInput["brokerState"]
) {
  if (!brokerState) {
    return {
      connected: false,
      account: null,
      capacity: null,
      positions: [],
      recentOrders: [],
    };
  }

  const grossExposure =
    Math.abs(brokerState.account.longMarketValue ?? 0) +
    Math.abs(brokerState.account.shortMarketValue ?? 0);
  const liveOpenOrders = brokerState.recentOrders.filter((order) =>
    ["accepted", "new", "partially_filled", "pending_new"].includes(
      order.status.toLowerCase()
    )
  );

  return {
    connected: true,
    account: {
      equity: brokerState.account.equity,
      cash: brokerState.account.cash,
      buyingPower: brokerState.account.buyingPower,
      portfolioValue: brokerState.account.portfolioValue,
      longMarketValue: brokerState.account.longMarketValue,
      shortMarketValue: brokerState.account.shortMarketValue,
    },
    capacity: {
      grossExposure,
      liveOpenOrderCount: liveOpenOrders.length,
      liveOpenSymbols: [...new Set(liveOpenOrders.map((order) => order.symbol))].slice(0, 12),
    },
    positions: brokerState.positions.slice(0, 12).map((position) => ({
      symbol: position.symbol,
      qty: position.qty,
      side: position.side,
      marketValue: position.marketValue,
      unrealizedPl: position.unrealizedPl,
      currentPrice: position.currentPrice,
      assetClass: position.assetClass,
    })),
    recentOrders: brokerState.recentOrders.slice(0, 10).map((order) => ({
      symbol: order.symbol,
      side: order.side,
      status: order.status,
      notional: order.notional,
      qty: order.qty,
      submittedAt: order.submittedAt,
      clientOrderId: order.clientOrderId,
    })),
  };
}

function summarizeAllocationInputs(inputs: CioAllocationInput[]) {
  return inputs.map((input) => ({
    agentId: input.agentId,
    strategyCategory: input.strategyCategory,
    currentAllocationUsd: input.currentAllocationUsd,
    maxAllocationUsd: input.maxAllocationUsd,
    recentMessageCount: input.recentMessageCount,
    highPriorityMessageCount: input.highPriorityMessageCount,
    recentOrderCount: input.recentOrderCount,
    recentAcceptedOrderCount: input.recentAcceptedOrderCount,
    averageConfidenceScore: input.averageConfidenceScore,
    attributedMarketValue: input.attributedMarketValue,
    attributedUnrealizedPl: input.attributedUnrealizedPl,
    positionCount: input.positionCount,
  }));
}

function buildResearchPlanningPrompt(input: {
  session: RuntimeSessionSnapshot;
  brokerState: AgentDecisionInput["brokerState"];
  allocationInputs: CioAllocationInput[];
}) {
  return JSON.stringify(
    {
      task:
        "Choose what evidence the desk should pull for this cycle before any trading decision is made. You own the research focus, the instruments worth inspecting, and the external query set.",
      rules: [
        "Do not assume any preset regime, preset ticker rotation, or preset query list exists.",
        "Choose the provider requests yourself from the supplied portfolio and session context.",
        "Use benchmarkSymbols for broad tape or cross-asset references you want in view.",
        "Use eventTickers only for single-name or catalyst-specific names worth checking in SEC/news context.",
        "Use sentimentTickers for names or risk assets where crowd narrative matters this cycle.",
        "massiveSymbols should be the concrete ticker list to pull from Alpaca pricing and Alpha Vantage headline research this cycle.",
        "You may leave eventTickers, sentimentTickers, kalshiQueries, polymarketQueries, newsQueries, or secTickers empty if that provider is not useful this cycle.",
        "Only request providers and symbols you genuinely want as evidence. Unqueried providers will be treated as absent evidence, not as implied confirmation.",
      ],
      outputShape: {
        researchFocus: "string",
        planningRationale: "string",
        benchmarkSymbols: ["string"],
        eventTickers: ["string"],
        sentimentTickers: ["string"],
        massiveSymbols: ["string"],
        kalshiQueries: ["string"],
        polymarketQueries: ["string"],
        newsQueries: ["string"],
        secTickers: ["string"],
        dataConsumed: ["string"],
      },
      context: {
        session: input.session,
        brokerState: summarizeBrokerState(input.brokerState),
        allocationInputs: summarizeAllocationInputs(input.allocationInputs),
      },
    },
    null,
    2
  );
}

function buildResearchPrompt(input: AgentDecisionInput) {
  const influenceNotesShape = Object.fromEntries(
    TRADING_AGENT_IDS.map((agentId) => [agentId, "string"])
  );

  return JSON.stringify(
    {
      task:
        "Produce the research view that should drive this cycle. Decide the market regime label, the primary research focus, the most relevant event ticker, the most relevant sentiment ticker, and what each trading sleeve should pay attention to.",
      rules: [
        "Use only the provided evidence.",
        "Treat skipped, unavailable, and failed providers as missing evidence. Do not invent replacement facts, proxy data, or synthetic context.",
        "If single-name evidence is weak, you may set selectedEventTicker or selectedSentimentTicker to null.",
        "When selectedEventTicker is non-null it must come from the researched event scope. When selectedSentimentTicker is non-null it must come from the researched sentiment scope.",
        "Choose a concise marketRegime label yourself; it does not need to match an existing enum.",
        "Keep observations concrete and execution-relevant.",
      ],
      outputShape: {
        marketRegime: "string",
        researchArea: "string",
        selectedEventTicker: "string|null",
        selectedSentimentTicker: "string|null",
        sentimentScore: "0-100 number",
        observation: "string",
        whyItMatters: "string",
        changeMind: "string",
        confidenceScore: "0-100 number",
        macroSummary: "string",
        eventSummary: "string",
        sentimentSummary: "string",
        influenceNotes: influenceNotesShape,
        dataConsumed: ["string"],
      },
      context: {
        session: input.session,
        marketContext: input.marketContext,
        dependencyStatuses: input.dependencyStatuses,
        brokerState: summarizeBrokerState(input.brokerState),
        allocationInputs: summarizeAllocationInputs(input.allocationInputs),
      },
    },
    null,
    2
  );
}

function buildTraderPrompt(input: {
  agentId: TradingAgentId;
  session: RuntimeSessionSnapshot;
  brokerState: AgentDecisionInput["brokerState"];
  allocationInput: CioAllocationInput | null;
  researchDecision: ResearchAgentDecision;
  marketContext: AgentDecisionMarketContext;
}) {
  return JSON.stringify(
    {
      task:
        "Decide whether your sleeve should elevate a fresh research event right now. You own the timing, instrument selection, and expression. If there is no edge, set shouldTrade to false.",
      rules: [
        "Use only provided evidence and your role mandate.",
        "Treat missing-provider status as a data gap, not as positive confirmation.",
        "If you do not want to elevate a research event, return trade as null and explain why.",
        "Use a US-listed equity or listed option expression only as research notation, not an instruction to transact.",
        "When workflow capacity or coverage is tight, prefer no-event over fresh adds.",
        "If your sleeve is already crowded, assume the research lead may treat any new idea as a replacement request rather than automatic fresh coverage.",
        "Do not request more notional than the visible sleeve and workflow context can plausibly support right now.",
        "Do not propose a fresh option expression when workflow capacity is obviously constrained; stand down instead.",
        "For option expressions, trade.symbol must be the underlying ticker like MMM or QQQ, not an OCC contract symbol.",
        "For equity_pair, exactly one leg should be constructive and one should be cautious, and longSymbol/shortSymbol must match those sides.",
        "For downside legs, assume event notation requires clean research coverage; if that is doubtful, stand down instead of forcing the event.",
        "For option_single, set optionType, targetDaysToExpiration, and strikeOffsetPct. For option_spread, set optionType and targetDaysToExpiration. For long_straddle, set targetDaysToExpiration and side='buy'.",
        "requestedNotionalUsd should reflect research-event weight before any guardrail clipping.",
      ],
      outputShape: {
        shouldTrade: "boolean",
        observation: "string",
        whyItMatters: "string",
        changeMind: "string",
        confidenceScore: "0-100 number",
        reasoning: "string",
        discussionNote: "string",
        dataConsumed: ["string"],
        trade: {
          symbol: "string",
          side: "buy|sell",
          requestedNotionalUsd: "number",
          strategyFamily: "string",
          expressionKind: "equity|option_single|option_spread|long_straddle",
          optionType: "call|put|null (required for option_single and option_spread)",
          targetDaysToExpiration: "number|null",
          strikeOffsetPct: "number|null (required for option_single)",
          thesisLabel: "string",
          assetBucketLabel: "string|null",
        },
      },
      context: {
        session: input.session,
        researchDecision: input.researchDecision,
        marketContext: input.marketContext,
        brokerState: summarizeBrokerState(input.brokerState),
        allocationInput: input.allocationInput,
      },
    },
    null,
    2
  );
}

function buildPythonTraderPrompt(input: {
  agentId: TradingAgentId;
  session: RuntimeSessionSnapshot;
  brokerState: AgentDecisionInput["brokerState"];
  allocationInput: CioAllocationInput | null;
  researchDecision: ResearchAgentDecision;
  marketContext: AgentDecisionMarketContext;
  systematicEvidence: JsonRecord;
}) {
  const systematicEvidence = compactPythonEvidenceForPrompt(input.systematicEvidence);

  return JSON.stringify(
    {
      task:
        "Make the sleeve's final trade decision from the live systematic diagnostics provided below. You are not bound to route a trade just because a quantitative setup exists.",
      rules: [
        "Use only the provided evidence and your role mandate.",
        "Treat the systematic diagnostics as evidence, not as an automatic order.",
        "Do not invent symbols, pairs, or expression kinds outside the allowed evidence scope.",
        "If the evidence is incomplete, contradictory, or weak, set shouldTrade to false and trade to null.",
        "When broker buying power is tight or cash is deeply used, prefer trims or no-trade over fresh adds.",
        "If your sleeve is already crowded, assume the research lead may treat any new buy as a replacement request rather than automatic fresh capital.",
        "Use a listed equity or equity-pair expression only when the evidence supports it and it is allowed by the evidence payload.",
        "requestedNotionalUsd should reflect the size you want before any guardrail clipping.",
      ],
      outputShape: {
        shouldTrade: "boolean",
        observation: "string",
        whyItMatters: "string",
        changeMind: "string",
        confidenceScore: "0-100 number",
        reasoning: "string",
        discussionNote: "string",
        dataConsumed: ["string"],
        trade: {
          symbol: "string",
          side: "buy|sell",
          requestedNotionalUsd: "number",
          strategyFamily: "string",
          expressionKind: "equity|equity_pair",
          thesisLabel: "string",
          assetBucketLabel: "string|null",
          secondarySymbol: "string|null (required for equity_pair)",
          secondarySide: "buy|sell|null (required for equity_pair)",
          longSymbol: "string|null (required for equity_pair)",
          shortSymbol: "string|null (required for equity_pair)",
          longNotionalUsd: "number|null (required for equity_pair)",
          shortNotionalUsd: "number|null (required for equity_pair)",
        },
      },
      context: {
        session: input.session,
        researchDecision: input.researchDecision,
        marketContext: input.marketContext,
        brokerState: summarizeBrokerState(input.brokerState),
        allocationInput: input.allocationInput,
        systematicEvidence,
      },
    },
    null,
    2
  );
}

function buildCioPrompt(input: {
  session: RuntimeSessionSnapshot;
  brokerState: AgentDecisionInput["brokerState"];
  allocationInputs: CioAllocationInput[];
  researchDecision: ResearchAgentDecision;
  traderDecisions: TraderAgentDecision[];
}) {
  const traderIdUnion = TRADING_AGENT_IDS.join("|");
  const activeTradingAgentIds = getScheduledActiveTradingAgentIds(input.session);
  const inactiveTradingAgentIds = TRADING_AGENT_IDS.filter(
    (agentId) => !activeTradingAgentIds.includes(agentId)
  );

  return JSON.stringify(
    {
      task:
        "Set sleeve weights and sleeve-level quality guardrails for this cycle, and choose which research sleeve, if any, should elevate an event now.",
      rules: [
        "You own ensemble weighting and sleeve guardrails, not workflow payload formatting.",
        "Return target weights for every research sleeve so the ensemble stays fully specified.",
        "Return a guardrail block for every research sleeve.",
        "Return cycleDirectives describing whether event publication should be allowed this cycle and which sleeves should remain active.",
        "Do not activate or select a research sleeve that the runtime session marks inactive.",
        "Treat inactive sleeves as watch-only this cycle even if they carry stale prior signals.",
        "selectedTradeAgentId may be null if no research event should publish this cycle.",
        "If cycleDirectives.allowTrading is false, selectedTradeAgentId must be null.",
        "Treat a capacity-constrained add as an opportunity-cost ranking problem: the new idea must beat the weakest current research event by a meaningful hurdle before you elevate it.",
        "Do not describe fresh sleeve room or select a fresh add when workflow context says capacity is tight; prefer no-event until capacity is freed.",
        "Keep guardrails internally consistent and practical for the current workflow state.",
      ],
      outputShape: {
        observation: "string",
        whyItMatters: "string",
        changeMind: "string",
        confidenceScore: "0-100 number",
        allocationBoundary: "string",
        cycleDirectives: {
          allowTrading: "boolean",
          activeTradingAgents: [traderIdUnion],
          rationale: "string",
        },
        selectedTradeAgentId: `${traderIdUnion}|null`,
        selectedTradeRationale: "string",
        allocations: [
          {
            agentId: "TradingAgentId",
            targetAllocationUsd: "number",
            rationale: "string",
            confidenceScore: "0-100 number",
          },
        ],
        guardrails: [
          {
            agentId: "TradingAgentId",
            rationale: "string",
            confidenceScore: "0-100 number",
            maxSingleOrderPctOfAllocation: "number",
            maxSleeveUtilizationPct: "number",
            maxPortfolioGrossExposurePct: "number",
            buyingPowerBufferPct: "number",
            minOrderNotional: "number",
          },
        ],
        dataConsumed: ["string"],
      },
      context: {
        session: input.session,
        activeTradingAgentIds,
        inactiveTradingAgentIds,
        researchDecision: input.researchDecision,
        brokerState: summarizeBrokerState(input.brokerState),
        allocationInputs: summarizeAllocationInputs(input.allocationInputs),
        traderDecisions: input.traderDecisions,
      },
    },
    null,
    2
  );
}

function buildRiskAdjudicationPrompt(input: {
  session: RuntimeSessionSnapshot;
  brokerState: AgentDecisionInput["brokerState"];
  allocationInput: CioAllocationInput | null;
  researchDecision: ResearchAgentDecision;
  traderDecision: TraderAgentDecision;
  cioDecision: CioAgentDecision;
  tradeIntent: AgentTradeIntentSummary;
  guardrails: AgentRiskGuardrails;
  riskContext: {
    sleeveAllocationUsd: number | null;
    buyingPower: number;
    portfolioValue: number;
    agentExposureUsd: number;
    portfolioGrossExposureUsd: number;
  };
}) {
  return JSON.stringify(
    {
      task:
        "Make the final research-event quality decision for this cycle. You own whether the selected event should publish now and the approved research weight for that event.",
      rules: [
        "You are making the final ensemble-quality judgment, not workflow payload formatting.",
        "If this event should not publish, set approveTrade to false and approvedNotionalUsd to 0.",
        "If this event should publish, approvedNotionalUsd must be greater than 0 and no larger than requestedNotionalUsd.",
        "Use the guardrails as policy inputs, but you are responsible for the final approval decision and final research weight.",
        "When research capacity is tight, reject fresh adds and favor clearer coverage over marginal expansion.",
        "Respect the replacement hurdle already implied by research lead context; do not wave through a marginal swap that fails to clearly outrank the funding source.",
        "Do not output commentary outside strict JSON.",
      ],
      outputShape: {
        approveTrade: "boolean",
        approvedNotionalUsd: "number",
        rationale: "string",
        changeMind: "string",
        confidenceScore: "0-100 number",
        dataConsumed: ["string"],
      },
      context: input,
    },
    null,
    2
  );
}

function buildCioReplacementPrompt(input: {
  session: RuntimeSessionSnapshot;
  brokerState: AgentDecisionInput["brokerState"];
  researchDecision: ResearchAgentDecision;
  cioDecision: CioAgentDecision;
  selectedTradeAgentId: TradingAgentId;
  selectedTradeDecision: TraderAgentDecision;
  traderDecisions: Record<TradingAgentId, TraderAgentDecision>;
  holdings: AgentReplacementHoldingCandidate[];
}) {
  return JSON.stringify(
    {
      task:
        "Decide whether a capital-constrained incoming trade should replace an existing holding. This is a portfolio-wide opportunity-cost ranking problem.",
      rules: [
        "Use only the provided evidence and holding candidates.",
        "Treat this as a replacement decision, not a fresh-capital decision.",
        "Rank the incoming trade and each funding candidate on expected return per unit risk, conviction, correlation or portfolio fit, liquidity or implementation cost, signal decay, and sleeve risk-budget pressure.",
        "Estimate round-trip cost in basis points for the swap and set a required hurdle in basis points that is at least as large as the estimated cost.",
        "Recommend a replacement only if the incoming trade clearly beats the chosen funding source after costs and the required hurdle.",
        "Choose at most one funding source, and only from the provided holdings list.",
        "fundingNotionalUsd must be greater than 0 and no larger than the chosen holding's maxReducibleNotionalUsd when shouldReplace is true.",
        "If no holding should be displaced, set shouldReplace to false and leave the funding fields empty.",
      ],
      outputShape: {
        shouldReplace: "boolean",
        fundingAgentId: "TradingAgentId|null",
        fundingSymbol: "string|null",
        fundingNotionalUsd: "number",
        incomingExpectedReturnBps: "number",
        fundingExpectedReturnBps: "number",
        netAdvantageBps: "number",
        estimatedRoundTripCostBps: "number",
        requiredHurdleBps: "number",
        rationale: "string",
        changeMind: "string",
        confidenceScore: "0-100 number",
        dataConsumed: ["string"],
      },
      context: {
        session: input.session,
        brokerState: summarizeBrokerState(input.brokerState),
        researchDecision: input.researchDecision,
        allocationBoundary: input.cioDecision.allocationBoundary,
        selectedTrade: {
          agentId: input.selectedTradeAgentId,
          confidenceScore: input.selectedTradeDecision.confidenceScore,
          observation: input.selectedTradeDecision.observation,
          whyItMatters: input.selectedTradeDecision.whyItMatters,
          changeMind: input.selectedTradeDecision.changeMind,
          discussionNote: input.selectedTradeDecision.discussionNote,
          trade: input.selectedTradeDecision.trade,
          targetAllocationUsd:
            input.cioDecision.allocations[input.selectedTradeAgentId].targetAllocationUsd,
          guardrails:
            input.cioDecision.guardrailsByAgent[input.selectedTradeAgentId].guardrails,
        },
        traderDecisions: Object.values(input.traderDecisions).map((decision) => ({
          agentId: decision.agentId,
          shouldTrade: decision.shouldTrade,
          confidenceScore: decision.confidenceScore,
          observation: decision.observation,
          discussionNote: decision.discussionNote,
          trade: decision.trade,
        })),
        holdings: input.holdings,
      },
    },
    null,
    2
  );
}

function buildOptionExecutionPrompt(input: {
  agentId: TradingAgentId;
  session: RuntimeSessionSnapshot;
  researchDecision: ResearchAgentDecision;
  traderDecision: TraderAgentDecision;
  tradeIntent: AgentTradeIntentSummary;
  underlyingReferencePrice: number;
  candidates: AgentOptionExecutionCandidate[];
}) {
  return JSON.stringify(
    {
      task:
        "Choose the exact listed option contract or contracts that should express this already-approved sleeve idea.",
      rules: [
        "Choose only from the provided candidate contracts.",
        "If none of the candidates are executable enough, set canExecute to false.",
        "For a single-option expression, return contractSymbol, qty, and limitPrice.",
        "For a spread expression, return longContractSymbol, shortContractSymbol, qty, and limitPrice.",
        "For a long straddle, return callContractSymbol, putContractSymbol, qty, and limitPrice.",
        "qty must be a positive integer when canExecute is true.",
        "limitPrice must be a positive number when canExecute is true.",
      ],
      outputShape: {
        canExecute: "boolean",
        contractSymbol: "string|null",
        longContractSymbol: "string|null",
        shortContractSymbol: "string|null",
        callContractSymbol: "string|null",
        putContractSymbol: "string|null",
        qty: "number|null",
        limitPrice: "number|null",
        rationale: "string",
        changeMind: "string",
        confidenceScore: "0-100 number",
        dataConsumed: ["string"],
      },
      context: input,
    },
    null,
    2
  );
}

function validateResearchPlan(payload: JsonRecord): AgentResearchPlan {
  return {
    researchFocus: requireStringField(payload.researchFocus, "researchPlan.researchFocus"),
    planningRationale: requireStringField(
      payload.planningRationale,
      "researchPlan.planningRationale"
    ),
    benchmarkSymbols: requireSymbolList(payload.benchmarkSymbols, "researchPlan.benchmarkSymbols"),
    eventTickers: requireSymbolList(payload.eventTickers, "researchPlan.eventTickers"),
    sentimentTickers: requireSymbolList(
      payload.sentimentTickers,
      "researchPlan.sentimentTickers"
    ),
    massiveSymbols: requireSymbolList(payload.massiveSymbols, "researchPlan.massiveSymbols", {
      min: 1,
      max: 8,
    }),
    kalshiQueries: requireStringList(payload.kalshiQueries, "researchPlan.kalshiQueries", {
      max: 6,
    }),
    polymarketQueries: requireStringList(
      payload.polymarketQueries,
      "researchPlan.polymarketQueries",
      {
        max: 6,
      }
    ),
    newsQueries: requireStringList(payload.newsQueries, "researchPlan.newsQueries", {
      max: 6,
    }),
    secTickers: requireSymbolList(payload.secTickers, "researchPlan.secTickers", {
      max: 6,
    }),
    dataConsumed: requireStringList(payload.dataConsumed, "researchPlan.dataConsumed", {
      min: 1,
      max: 16,
    }),
  };
}

function buildResearchDependencyStatus(input: {
  sourceId: ResearchDependencySourceId;
  healthy: boolean;
  summary: string;
  error?: string | null;
}): AgentDecisionDependencyStatus {
  return {
    sourceId: input.sourceId,
    healthy: input.healthy,
    summary: input.summary,
    error: input.error ?? null,
    impact: RESEARCH_DEPENDENCY_IMPACTS[input.sourceId],
  };
}

function buildSkippedProviderStatus(sourceId: ResearchDependencySourceId, summary: string) {
  return buildResearchDependencyStatus({
    sourceId,
    healthy: true,
    summary,
    error: null,
  });
}

function buildRetainedResearchPacket(input: {
  sourceId: ResearchDependencySourceId;
  requestedInputs: string[];
  summary: string;
  status: "fulfilled" | "rejected" | "skipped";
  packet:
    | MassiveResearchPacket
    | KalshiResearchPacket
    | PolymarketResearchPacket
    | SecEarningsPacket
    | NewsApiResearchPacket
    | null;
  error?: string | null;
}) {
  return {
    sourceId: input.sourceId,
    summary: input.summary,
    payload: {
      sourceId: input.sourceId,
      requested: input.requestedInputs.length > 0,
      requestedInputs: input.requestedInputs,
      status: input.status,
      summary: input.summary,
      error: input.error ?? null,
      packet: input.packet,
    },
  } satisfies AgentRetainedResearchPacket;
}

function joinSentences(parts: Array<string | null | undefined>) {
  return parts
    .map((part) => (typeof part === "string" ? part.trim() : ""))
    .filter((part) => part.length > 0)
    .join(" ");
}

function buildSymbolScope(symbolGroups: Array<readonly string[] | string[]>) {
  return new Set(
    symbolGroups
      .flatMap((group) => group)
      .map((symbol) => symbol.trim().toUpperCase())
      .filter(Boolean)
  );
}

function requireResearchedSymbol(
  symbol: string | null,
  fieldName: string,
  scope: ReadonlySet<string>
) {
  if (!symbol) {
    return;
  }

  if (!scope.has(symbol)) {
    throw new Error(
      `${fieldName} must come from the researched symbol scope for this cycle.`
    );
  }
}

function buildMarketContextFromResearchCollection(input: {
  researchPlan: AgentResearchPlan;
  massiveSummary: string;
  kalshiSummary: string;
  polymarketSummary: string;
  newsApiSummary: string;
  secEdgarSummary: string;
  massiveEvidenceSummary: string | null;
  kalshiEvidenceSummary: string | null;
  polymarketEvidenceSummary: string | null;
  newsApiEvidenceSummary: string | null;
  secEdgarEvidenceSummary: string | null;
}): AgentDecisionMarketContext {
  const eventTickerSummary =
    input.researchPlan.eventTickers.length > 0
      ? input.researchPlan.eventTickers.join(", ")
      : "none selected";
  const sentimentTickerSummary =
    input.researchPlan.sentimentTickers.length > 0
      ? input.researchPlan.sentimentTickers.join(", ")
      : "none selected";
  const externalEvidenceSummary = joinSentences([
    input.massiveEvidenceSummary,
    input.kalshiEvidenceSummary,
    input.polymarketEvidenceSummary,
    input.newsApiEvidenceSummary,
    input.secEdgarEvidenceSummary,
  ]);

  return {
    researchFocus: input.researchPlan.researchFocus,
    planningRationale: input.researchPlan.planningRationale,
    benchmarkSymbols: input.researchPlan.benchmarkSymbols,
    eventTickers: input.researchPlan.eventTickers,
    sentimentTickers: input.researchPlan.sentimentTickers,
    massiveSymbols: input.researchPlan.massiveSymbols,
    kalshiQueries: input.researchPlan.kalshiQueries,
    polymarketQueries: input.researchPlan.polymarketQueries,
    newsQueries: input.researchPlan.newsQueries,
    secTickers: input.researchPlan.secTickers,
    researchSource: "AGENT_DIRECTED",
    researchPacketSummary: joinSentences([
      `Research focus: ${input.researchPlan.researchFocus}.`,
      `Planning rationale: ${input.researchPlan.planningRationale}.`,
      `Pricing/headline symbols: ${input.researchPlan.massiveSymbols.join(", ")}.`,
      externalEvidenceSummary.length > 0
        ? `Provider evidence: ${externalEvidenceSummary}`
        : "No external provider returned usable live evidence this cycle.",
    ]),
    macroRead: joinSentences([
      `Focus: ${input.researchPlan.researchFocus}.`,
      input.researchPlan.benchmarkSymbols.length > 0
        ? `Benchmarks in scope: ${input.researchPlan.benchmarkSymbols.join(", ")}.`
        : null,
      input.massiveEvidenceSummary ? `Alpaca + Alpha Vantage: ${input.massiveEvidenceSummary}` : null,
      input.kalshiEvidenceSummary ? `Kalshi: ${input.kalshiEvidenceSummary}` : null,
      input.polymarketEvidenceSummary
        ? `Polymarket: ${input.polymarketEvidenceSummary}`
        : null,
    ]),
    eventRead: joinSentences([
      `Event candidates: ${eventTickerSummary}.`,
      input.massiveEvidenceSummary ? `Alpaca + Alpha Vantage: ${input.massiveEvidenceSummary}` : null,
      input.secEdgarEvidenceSummary
        ? `SEC EDGAR: ${input.secEdgarEvidenceSummary}`
        : null,
      input.newsApiEvidenceSummary ? `Alpha Vantage: ${input.newsApiEvidenceSummary}` : null,
    ]),
    sentimentRead: joinSentences([
      `Sentiment candidates: ${sentimentTickerSummary}.`,
      input.massiveEvidenceSummary ? `Alpaca + Alpha Vantage: ${input.massiveEvidenceSummary}` : null,
      input.kalshiEvidenceSummary ? `Kalshi: ${input.kalshiEvidenceSummary}` : null,
      input.polymarketEvidenceSummary
        ? `Polymarket: ${input.polymarketEvidenceSummary}`
        : null,
      input.newsApiEvidenceSummary ? `Alpha Vantage: ${input.newsApiEvidenceSummary}` : null,
    ]),
    massiveSummary: input.massiveSummary,
    kalshiSummary: input.kalshiSummary,
    polymarketSummary: input.polymarketSummary,
    newsApiSummary: input.newsApiSummary,
    secEdgarSummary: input.secEdgarSummary,
    dataConsumed: [
      ...input.researchPlan.dataConsumed,
      ...input.researchPlan.massiveSymbols.map((symbol) => `massive:${symbol}`),
      ...input.researchPlan.kalshiQueries.map((query) => `kalshi:${query}`),
      ...input.researchPlan.polymarketQueries.map((query) => `polymarket:${query}`),
      ...input.researchPlan.newsQueries.map((query) => `alphavantage:${query}`),
      ...input.researchPlan.secTickers.map((symbol) => `sec:${symbol}`),
    ],
  };
}

function parseInfluenceNotes(value: unknown) {
  const record = requireRecord(value, "research.influenceNotes");
  const notes = {} as ResearchAgentDecision["influenceNotes"];

  for (const agentId of TRADING_AGENT_IDS) {
    notes[agentId] = requireStringField(
      record[agentId],
      `research.influenceNotes.${agentId}`
    );
  }

  return notes;
}

function validateResearchDecision(
  payload: JsonRecord,
  marketContext: AgentDecisionMarketContext
): ResearchAgentDecision {
  const selectedEventTicker = normalizeOptionalSymbol(
    payload.selectedEventTicker,
    "research.selectedEventTicker"
  );
  const selectedSentimentTicker = normalizeOptionalSymbol(
    payload.selectedSentimentTicker,
    "research.selectedSentimentTicker"
  );

  requireResearchedSymbol(
    selectedEventTicker,
    "research.selectedEventTicker",
    buildSymbolScope([
      marketContext.eventTickers,
      marketContext.secTickers,
      marketContext.massiveSymbols,
    ])
  );
  requireResearchedSymbol(
    selectedSentimentTicker,
    "research.selectedSentimentTicker",
    buildSymbolScope([
      marketContext.sentimentTickers,
      marketContext.massiveSymbols,
    ])
  );

  return {
    marketRegime: requireStringField(payload.marketRegime, "research.marketRegime"),
    researchArea: requireStringField(payload.researchArea, "research.researchArea"),
    selectedEventTicker,
    selectedSentimentTicker,
    sentimentScore: requirePercentScore(payload.sentimentScore, "research.sentimentScore"),
    observation: requireStringField(payload.observation, "research.observation"),
    whyItMatters: requireStringField(payload.whyItMatters, "research.whyItMatters"),
    changeMind: requireStringField(payload.changeMind, "research.changeMind"),
    confidenceScore: requirePercentScore(payload.confidenceScore, "research.confidenceScore"),
    macroSummary: requireStringField(payload.macroSummary, "research.macroSummary"),
    eventSummary: requireStringField(payload.eventSummary, "research.eventSummary"),
    sentimentSummary: requireStringField(
      payload.sentimentSummary,
      "research.sentimentSummary"
    ),
    influenceNotes: parseInfluenceNotes(payload.influenceNotes),
    dataConsumed: requireStringList(payload.dataConsumed, "research.dataConsumed", {
      min: 1,
      max: 20,
    }),
  };
}

function validateTraderTradeIdea(value: unknown): TraderAgentTradeIdea | null {
  const record = requireRecord(value, "trader.trade");
  const expressionKind = requireStringField(
    record.expressionKind,
    "trader.trade.expressionKind"
  );
  const normalizedExpressionKind =
    expressionKind === "equity" ||
    expressionKind === "equity_pair" ||
    expressionKind === "option_single" ||
    expressionKind === "option_spread" ||
    expressionKind === "long_straddle"
      ? expressionKind
      : null;

  if (!normalizedExpressionKind) {
    throw new Error(
      "trader.trade.expressionKind must be equity, equity_pair, option_single, option_spread, or long_straddle."
    );
  }

  const side = requireStringField(record.side, "trader.trade.side").toLowerCase();

  if (side !== "buy" && side !== "sell") {
    throw new Error("trader.trade.side must be buy or sell.");
  }

  const tradeIdea = {
    symbol: normalizeTraderTradeSymbol(
      requireStringField(record.symbol, "trader.trade.symbol"),
      normalizedExpressionKind
    ),
    side,
    requestedNotionalUsd: roundTo(
      requirePositiveNumberField(
        record.requestedNotionalUsd,
        "trader.trade.requestedNotionalUsd"
      ),
      2
    ),
    strategyFamily: requireStringField(
      record.strategyFamily,
      "trader.trade.strategyFamily"
    ),
    expressionKind: normalizedExpressionKind,
    thesisLabel: requireStringField(record.thesisLabel, "trader.trade.thesisLabel"),
    assetBucketLabel: asNullableString(record.assetBucketLabel),
  } satisfies Omit<
    TraderAgentTradeIdea,
    "optionType" | "targetDaysToExpiration" | "strikeOffsetPct"
  >;

  if (normalizedExpressionKind === "equity") {
    return tradeIdea;
  }

  if (normalizedExpressionKind === "equity_pair") {
    const secondarySide = requireStringField(
      record.secondarySide,
      "trader.trade.secondarySide"
    ).toLowerCase();

    if (secondarySide !== "buy" && secondarySide !== "sell") {
      throw new Error("trader.trade.secondarySide must be buy or sell.");
    }

    const secondarySymbol = requireStringField(
      record.secondarySymbol,
      "trader.trade.secondarySymbol"
    ).toUpperCase();
    const longSymbol = requireStringField(
      record.longSymbol,
      "trader.trade.longSymbol"
    ).toUpperCase();
    const shortSymbol = requireStringField(
      record.shortSymbol,
      "trader.trade.shortSymbol"
    ).toUpperCase();

    if (secondarySymbol === tradeIdea.symbol) {
      throw new Error("trader.trade.secondarySymbol must differ from trader.trade.symbol.");
    }

    if (side === secondarySide) {
      throw new Error("trader.trade.equity_pair must contain one buy leg and one sell leg.");
    }

    if (longSymbol === shortSymbol) {
      throw new Error("trader.trade.longSymbol and trader.trade.shortSymbol must differ.");
    }

    const longMatchesPrimary = longSymbol === tradeIdea.symbol && side === "buy";
    const longMatchesSecondary = longSymbol === secondarySymbol && secondarySide === "buy";

    if (!longMatchesPrimary && !longMatchesSecondary) {
      throw new Error(
        "trader.trade.longSymbol must match the leg whose side is buy."
      );
    }

    const shortMatchesPrimary = shortSymbol === tradeIdea.symbol && side === "sell";
    const shortMatchesSecondary =
      shortSymbol === secondarySymbol && secondarySide === "sell";

    if (!shortMatchesPrimary && !shortMatchesSecondary) {
      throw new Error(
        "trader.trade.shortSymbol must match the leg whose side is sell."
      );
    }

    return {
      ...tradeIdea,
      secondarySymbol,
      secondarySide,
      longSymbol,
      shortSymbol,
      longNotionalUsd: roundTo(
        requirePositiveNumberField(
          record.longNotionalUsd,
          "trader.trade.longNotionalUsd"
        ),
        2
      ),
      shortNotionalUsd: roundTo(
        requirePositiveNumberField(
          record.shortNotionalUsd,
          "trader.trade.shortNotionalUsd"
        ),
        2
      ),
    };
  }

  const targetDaysToExpiration = requirePositiveNumberField(
    record.targetDaysToExpiration,
    "trader.trade.targetDaysToExpiration"
  );

  if (normalizedExpressionKind === "long_straddle") {
    if (side !== "buy") {
      throw new Error("trader.trade.side must be buy for a long_straddle.");
    }

    return {
      ...tradeIdea,
      targetDaysToExpiration,
    };
  }

  const optionType = requireStringField(
    record.optionType,
    "trader.trade.optionType"
  ).toLowerCase();

  if (optionType !== "call" && optionType !== "put") {
    throw new Error("trader.trade.optionType must be call or put.");
  }

  if (normalizedExpressionKind === "option_spread") {
    return {
      ...tradeIdea,
      optionType,
      targetDaysToExpiration,
    };
  }

  return {
    ...tradeIdea,
    optionType,
    targetDaysToExpiration,
    strikeOffsetPct: requireNumberField(
      record.strikeOffsetPct,
      "trader.trade.strikeOffsetPct"
    ),
  };
}

function validateTraderDecision(
  agentId: TradingAgentId,
  payload: JsonRecord
): TraderAgentDecision {
  const shouldTrade = requireBooleanField(payload.shouldTrade, `${agentId}.shouldTrade`);
  const trade = shouldTrade ? validateTraderTradeIdea(payload.trade) : null;

  if (shouldTrade && (!trade || trade.requestedNotionalUsd <= 0)) {
    throw new Error(`${agentId} indicated shouldTrade=true without a valid trade payload.`);
  }

  return {
    agentId,
    shouldTrade,
    observation: requireStringField(payload.observation, `${agentId}.observation`),
    whyItMatters: requireStringField(payload.whyItMatters, `${agentId}.whyItMatters`),
    changeMind: requireStringField(payload.changeMind, `${agentId}.changeMind`),
    confidenceScore: requirePercentScore(payload.confidenceScore, `${agentId}.confidenceScore`),
    reasoning: requireStringField(payload.reasoning, `${agentId}.reasoning`),
    discussionNote: requireStringField(payload.discussionNote, `${agentId}.discussionNote`),
    dataConsumed: requireStringList(payload.dataConsumed, `${agentId}.dataConsumed`, {
      min: 1,
      max: 20,
    }),
    trade,
  };
}

function parsePythonTraderEvidence(payload: JsonRecord): PythonTraderEvidence {
  const allowedSymbols = Array.isArray(payload.allowedSymbols)
    ? payload.allowedSymbols
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim().toUpperCase())
        .filter(Boolean)
    : [];
  const allowedExpressionKinds = Array.isArray(payload.allowedExpressionKinds)
    ? payload.allowedExpressionKinds.filter(
        (item): item is TraderDecisionExpressionKind =>
          item === "equity" || item === "equity_pair"
      )
    : [];
  const allowedPairs = Array.isArray(payload.allowedPairs)
    ? payload.allowedPairs
        .map((value) => requireRecord(value, "pythonEvidence.allowedPairs[]"))
        .map((pair) => ({
          pairKey: requireStringField(pair.pairKey, "pythonEvidence.allowedPairs[].pairKey"),
          longSymbol: requireStringField(
            pair.longSymbol,
            "pythonEvidence.allowedPairs[].longSymbol"
          ).toUpperCase(),
          shortSymbol: requireStringField(
            pair.shortSymbol,
            "pythonEvidence.allowedPairs[].shortSymbol"
          ).toUpperCase(),
        }))
    : [];

  return {
    allowedSymbols,
    allowedExpressionKinds,
    allowedPairs,
  };
}

function compactPythonEvidenceForPrompt(payload: JsonRecord) {
  const compact = { ...payload };
  const dashboardValue = payload.dashboardPayload;

  if (dashboardValue && typeof dashboardValue === "object" && !Array.isArray(dashboardValue)) {
    const dashboard = dashboardValue as JsonRecord;
    const compactDashboard: JsonRecord = {};

    for (const [key, value] of Object.entries(dashboard)) {
      if (key === "equity_curve" || key === "equityCurve") {
        if (Array.isArray(value)) {
          compactDashboard[key] = value.slice(-10);
        }
        continue;
      }

      if (Array.isArray(value)) {
        compactDashboard[key] = value.slice(0, 12);
        continue;
      }

      compactDashboard[key] = value;
    }

    compact.dashboardPayload = compactDashboard;
  }

  return compact;
}

function validatePythonTraderDecisionScope(
  decision: TraderAgentDecision,
  evidencePayload: JsonRecord
) {
  if (!decision.trade) {
    return decision;
  }

  const evidence = parsePythonTraderEvidence(evidencePayload);
  const allowedSymbols = new Set(evidence.allowedSymbols);

  if (
    evidence.allowedExpressionKinds.length > 0 &&
    !evidence.allowedExpressionKinds.includes(decision.trade.expressionKind)
  ) {
    throw new Error(
      `${decision.agentId} selected expressionKind ${decision.trade.expressionKind} outside the live evidence scope.`
    );
  }

  const scopedSymbols = [
    decision.trade.symbol,
    decision.trade.secondarySymbol ?? null,
    decision.trade.longSymbol ?? null,
    decision.trade.shortSymbol ?? null,
  ]
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim().toUpperCase());

  if (allowedSymbols.size > 0) {
    for (const symbol of scopedSymbols) {
      if (!allowedSymbols.has(symbol)) {
        throw new Error(
          `${decision.agentId} selected symbol ${symbol} outside the live evidence scope.`
        );
      }
    }
  }

  if (decision.trade.expressionKind === "equity_pair" && evidence.allowedPairs.length > 0) {
    const longSymbol = decision.trade.longSymbol?.trim().toUpperCase() ?? "";
    const shortSymbol = decision.trade.shortSymbol?.trim().toUpperCase() ?? "";
    const allowedPairSet = new Set(
      evidence.allowedPairs.map((pair) => `${pair.longSymbol}|${pair.shortSymbol}`)
    );

    if (!allowedPairSet.has(`${longSymbol}|${shortSymbol}`)) {
      throw new Error(
        `${decision.agentId} selected pair ${longSymbol}|${shortSymbol} outside the live evidence scope.`
      );
    }
  }

  return decision;
}

function validateGuardrailBlock(value: unknown): AgentRiskGuardrails {
  const record = requireRecord(value, "cio.guardrails");

  return {
    maxSingleOrderPctOfAllocation: roundTo(
      requirePositiveNumberField(
        record.maxSingleOrderPctOfAllocation,
        "cio.guardrails.maxSingleOrderPctOfAllocation"
      ),
      4
    ),
    maxSleeveUtilizationPct: roundTo(
      requirePositiveNumberField(
        record.maxSleeveUtilizationPct,
        "cio.guardrails.maxSleeveUtilizationPct"
      ),
      4
    ),
    maxPortfolioGrossExposurePct: roundTo(
      requirePositiveNumberField(
        record.maxPortfolioGrossExposurePct,
        "cio.guardrails.maxPortfolioGrossExposurePct"
      ),
      4
    ),
    buyingPowerBufferPct: roundTo(
      requirePositiveNumberField(
        record.buyingPowerBufferPct,
        "cio.guardrails.buyingPowerBufferPct"
      ),
      4
    ),
    minOrderNotional: roundTo(
      requirePositiveNumberField(record.minOrderNotional, "cio.guardrails.minOrderNotional"),
      2
    ),
  };
}

function validateSelectedTradeAgentId(value: unknown) {
  if (value === null) {
    return null;
  }

  const selected = validateTradingAgentId(value);

  if (!selected) {
    throw new Error("cio.selectedTradeAgentId must be null or a known research agent id.");
  }

  return selected;
}

function validateCycleDirectives(value: unknown): CioCycleDirectives {
  const record = requireRecord(value, "cio.cycleDirectives");
  const allowTrading = requireBooleanField(
    record.allowTrading,
    "cio.cycleDirectives.allowTrading"
  );
  const activeTradingAgents = requireStringList(
    record.activeTradingAgents,
    "cio.cycleDirectives.activeTradingAgents",
    { max: TRADING_AGENT_IDS.length }
  ).map((agentId) => {
    const validated = validateTradingAgentId(agentId);

    if (!validated) {
      throw new Error(
        "cio.cycleDirectives.activeTradingAgents must contain only known research agent ids."
      );
    }

    return validated;
  });

  return {
    allowTrading,
    activeTradingAgents,
    rationale: requireStringField(record.rationale, "cio.cycleDirectives.rationale"),
  };
}

function validateCioDecision(
  payload: JsonRecord,
  session?: RuntimeSessionSnapshot
): CioAgentDecision {
  if (!Array.isArray(payload.allocations)) {
    throw new Error("cio.allocations must be an array.");
  }

  if (!Array.isArray(payload.guardrails)) {
    throw new Error("cio.guardrails must be an array.");
  }

  const rawAllocations = payload.allocations;
  const rawGuardrails = payload.guardrails;
  const allocations = {} as Record<TradingAgentId, CioAllocationDecisionOutput>;
  const guardrailsByAgent = {} as Record<TradingAgentId, CioGuardrailDecisionOutput>;

  for (const item of rawAllocations) {
    const record = requireRecord(item, "cio.allocations[]");
    const agentId = validateTradingAgentId(record.agentId);

    if (!agentId) {
      throw new Error("cio.allocations[].agentId must be a known research agent id.");
    }

    allocations[agentId] = {
      agentId,
      targetAllocationUsd: roundTo(
        requireNonNegativeNumberField(
          record.targetAllocationUsd,
          `cio.allocations.${agentId}.targetAllocationUsd`
        ),
        2
      ),
      rationale: requireStringField(
        record.rationale,
        `cio.allocations.${agentId}.rationale`
      ),
      confidenceScore: requirePercentScore(
        record.confidenceScore,
        `cio.allocations.${agentId}.confidenceScore`
      ),
    };
  }

  for (const item of rawGuardrails) {
    const record = requireRecord(item, "cio.guardrails[]");
    const agentId = validateTradingAgentId(record.agentId);

    if (!agentId) {
      throw new Error("cio.guardrails[].agentId must be a known research agent id.");
    }

    guardrailsByAgent[agentId] = {
      agentId,
      rationale: requireStringField(
        record.rationale,
        `cio.guardrails.${agentId}.rationale`
      ),
      confidenceScore: requirePercentScore(
        record.confidenceScore,
        `cio.guardrails.${agentId}.confidenceScore`
      ),
      guardrails: validateGuardrailBlock(record),
    };
  }

  for (const agentId of TRADING_AGENT_IDS) {
    if (!allocations[agentId]) {
      throw new Error(`research lead decision omitted an allocation target for ${agentId}.`);
    }

    if (!guardrailsByAgent[agentId]) {
      throw new Error(`research lead decision omitted a guardrail block for ${agentId}.`);
    }
  }

  if (!Object.prototype.hasOwnProperty.call(payload, "selectedTradeAgentId")) {
    throw new Error("cio.selectedTradeAgentId is required.");
  }

  const selectedTradeAgentId = validateSelectedTradeAgentId(payload.selectedTradeAgentId);
  const cycleDirectives = validateCycleDirectives(payload.cycleDirectives);

  if (!cycleDirectives.allowTrading && selectedTradeAgentId) {
    throw new Error(
      "cio.selectedTradeAgentId must be null when cio.cycleDirectives.allowTrading is false."
    );
  }

  if (
    selectedTradeAgentId &&
    !cycleDirectives.activeTradingAgents.includes(selectedTradeAgentId)
  ) {
    throw new Error(
      `cio.selectedTradeAgentId ${selectedTradeAgentId} must be included in cio.cycleDirectives.activeTradingAgents.`
    );
  }

  if (session) {
    const activeTradingAgentIds = new Set(getScheduledActiveTradingAgentIds(session));

    for (const agentId of cycleDirectives.activeTradingAgents) {
      if (!activeTradingAgentIds.has(agentId)) {
        throw new Error(
          `cio.cycleDirectives.activeTradingAgents cannot include ${agentId} because that sleeve is inactive during ${session.label}.`
        );
      }
    }

    if (selectedTradeAgentId && !activeTradingAgentIds.has(selectedTradeAgentId)) {
      throw new Error(
        `cio.selectedTradeAgentId ${selectedTradeAgentId} cannot be selected because that sleeve is inactive during ${session.label}.`
      );
    }

    if (!session.orderExecutionEnabled && cycleDirectives.allowTrading) {
      throw new Error(
        `cio.cycleDirectives.allowTrading must be false during ${session.label} because order execution is disabled.`
      );
    }
  }

  return {
    observation: requireStringField(payload.observation, "cio.observation"),
    whyItMatters: requireStringField(payload.whyItMatters, "cio.whyItMatters"),
    changeMind: requireStringField(payload.changeMind, "cio.changeMind"),
    confidenceScore: requirePercentScore(payload.confidenceScore, "cio.confidenceScore"),
    allocationBoundary: requireStringField(payload.allocationBoundary, "cio.allocationBoundary"),
    cycleDirectives,
    selectedTradeAgentId,
    selectedTradeRationale: requireStringField(
      payload.selectedTradeRationale,
      "cio.selectedTradeRationale"
    ),
    allocations,
    guardrailsByAgent,
    dataConsumed: requireStringList(payload.dataConsumed, "cio.dataConsumed", {
      min: 1,
      max: 24,
    }),
  };
}

function validateRiskDispositionDecision(payload: JsonRecord): AgentRiskDispositionDecision {
  const approveTrade = requireBooleanField(payload.approveTrade, "risk.approveTrade");
  const approvedNotionalUsd = roundTo(
    requireNonNegativeNumberField(payload.approvedNotionalUsd, "risk.approvedNotionalUsd"),
    2
  );

  if (approveTrade && approvedNotionalUsd <= 0) {
    throw new Error("risk.approvedNotionalUsd must be greater than 0 when risk.approveTrade is true.");
  }

  if (!approveTrade && approvedNotionalUsd !== 0) {
    throw new Error("risk.approvedNotionalUsd must be 0 when risk.approveTrade is false.");
  }

  return {
    approveTrade,
    approvedNotionalUsd,
    rationale: requireStringField(payload.rationale, "risk.rationale"),
    changeMind: requireStringField(payload.changeMind, "risk.changeMind"),
    confidenceScore: requirePercentScore(payload.confidenceScore, "risk.confidenceScore"),
    dataConsumed: requireStringList(payload.dataConsumed, "risk.dataConsumed", {
      min: 1,
      max: 20,
    }),
  };
}

function validateReplacementDecision(input: {
  payload: JsonRecord;
  holdings: AgentReplacementHoldingCandidate[];
}): AgentReplacementDecision {
  const shouldReplace = requireBooleanField(
    input.payload.shouldReplace,
    "replacement.shouldReplace"
  );
  const fundingAgentId = validateSelectedTradeAgentId(input.payload.fundingAgentId);
  const fundingSymbol = normalizeOptionalSymbol(
    input.payload.fundingSymbol,
    "replacement.fundingSymbol"
  );
  const fundingNotionalUsd = roundTo(
    requireNonNegativeNumberField(
      input.payload.fundingNotionalUsd,
      "replacement.fundingNotionalUsd"
    ),
    2
  );
  const incomingExpectedReturnBps = roundTo(
    requireNumberField(
      input.payload.incomingExpectedReturnBps,
      "replacement.incomingExpectedReturnBps"
    ),
    2
  );
  const fundingExpectedReturnBps = roundTo(
    requireNumberField(
      input.payload.fundingExpectedReturnBps,
      "replacement.fundingExpectedReturnBps"
    ),
    2
  );
  const netAdvantageBps = roundTo(
    requireNumberField(input.payload.netAdvantageBps, "replacement.netAdvantageBps"),
    2
  );
  const estimatedRoundTripCostBps = roundTo(
    requireNonNegativeNumberField(
      input.payload.estimatedRoundTripCostBps,
      "replacement.estimatedRoundTripCostBps"
    ),
    2
  );
  const requiredHurdleBps = roundTo(
    requireNonNegativeNumberField(
      input.payload.requiredHurdleBps,
      "replacement.requiredHurdleBps"
    ),
    2
  );
  const rationale = requireStringField(input.payload.rationale, "replacement.rationale");
  const changeMind = requireStringField(input.payload.changeMind, "replacement.changeMind");
  const confidenceScore = requirePercentScore(
    input.payload.confidenceScore,
    "replacement.confidenceScore"
  );
  const dataConsumed = requireStringList(
    input.payload.dataConsumed,
    "replacement.dataConsumed",
    {
      min: 1,
      max: 24,
    }
  );

  if (requiredHurdleBps < estimatedRoundTripCostBps) {
    throw new Error(
      "replacement.requiredHurdleBps must be at least replacement.estimatedRoundTripCostBps."
    );
  }

  if (!shouldReplace) {
    if (fundingAgentId !== null || fundingSymbol !== null || fundingNotionalUsd !== 0) {
      throw new Error(
        "Funding fields must be empty when replacement.shouldReplace is false."
      );
    }

    return {
      shouldReplace,
      fundingAgentId: null,
      fundingSymbol: null,
      fundingNotionalUsd: 0,
      incomingExpectedReturnBps,
      fundingExpectedReturnBps,
      netAdvantageBps,
      estimatedRoundTripCostBps,
      requiredHurdleBps,
      rationale,
      changeMind,
      confidenceScore,
      dataConsumed,
    };
  }

  if (!fundingAgentId || !fundingSymbol || fundingNotionalUsd <= 0) {
    throw new Error(
      "replacement decisions must include fundingAgentId, fundingSymbol, and positive fundingNotionalUsd."
    );
  }

  const selectedHolding = input.holdings.find((holding) => holding.symbol === fundingSymbol);

  if (!selectedHolding) {
    throw new Error(
      `replacement.fundingSymbol ${fundingSymbol} must match one of the provided holdings.`
    );
  }

  if (selectedHolding.agentId !== fundingAgentId) {
    throw new Error(
      `replacement.fundingAgentId ${fundingAgentId} does not own ${fundingSymbol} in the provided holdings.`
    );
  }

  if (fundingNotionalUsd > selectedHolding.maxReducibleNotionalUsd) {
    throw new Error(
      `replacement.fundingNotionalUsd must not exceed the holding's max reducible notional for ${fundingSymbol}.`
    );
  }

  if (netAdvantageBps < requiredHurdleBps) {
    throw new Error(
      "replacement.netAdvantageBps must be at least replacement.requiredHurdleBps when replacement.shouldReplace is true."
    );
  }

  return {
    shouldReplace,
    fundingAgentId,
    fundingSymbol,
    fundingNotionalUsd,
    incomingExpectedReturnBps,
    fundingExpectedReturnBps,
    netAdvantageBps,
    estimatedRoundTripCostBps,
    requiredHurdleBps,
    rationale,
    changeMind,
    confidenceScore,
    dataConsumed,
  };
}

function buildCandidateSymbolSet(candidates: AgentOptionExecutionCandidate[]) {
  return new Set(candidates.map((candidate) => candidate.symbol));
}

function validateOptionExecutionDecision(input: {
  payload: JsonRecord;
  traderDecision: TraderAgentDecision;
  candidates: AgentOptionExecutionCandidate[];
}): AgentOptionExecutionDecision {
  const canExecute = requireBooleanField(
    input.payload.canExecute,
    "optionExecution.canExecute"
  );
  const rationale = requireStringField(input.payload.rationale, "optionExecution.rationale");
  const changeMind = requireStringField(
    input.payload.changeMind,
    "optionExecution.changeMind"
  );
  const confidenceScore = requirePercentScore(
    input.payload.confidenceScore,
    "optionExecution.confidenceScore"
  );
  const dataConsumed = requireStringList(
    input.payload.dataConsumed,
    "optionExecution.dataConsumed",
    {
      min: 1,
      max: 20,
    }
  );

  if (!canExecute) {
    return {
      canExecute,
      rationale,
      changeMind,
      confidenceScore,
      dataConsumed,
    };
  }

  const qty = Math.max(
    1,
    Math.round(requirePositiveNumberField(input.payload.qty, "optionExecution.qty"))
  );
  const limitPrice = roundTo(
    requirePositiveNumberField(input.payload.limitPrice, "optionExecution.limitPrice"),
    4
  );
  const candidateSymbols = buildCandidateSymbolSet(input.candidates);
  const trade = input.traderDecision.trade;

  if (!trade) {
    throw new Error("Option execution requires a trader trade idea.");
  }

  if (trade.expressionKind === "option_single") {
    const contractSymbol = requireStringField(
      input.payload.contractSymbol,
      "optionExecution.contractSymbol"
    ).toUpperCase();

    if (!candidateSymbols.has(contractSymbol)) {
      throw new Error(`optionExecution.contractSymbol ${contractSymbol} is not in the candidate set.`);
    }

    return {
      canExecute,
      qty,
      limitPrice,
      rationale,
      changeMind,
      confidenceScore,
      dataConsumed,
      contractSymbol,
    };
  }

  if (trade.expressionKind === "option_spread") {
    const longContractSymbol = requireStringField(
      input.payload.longContractSymbol,
      "optionExecution.longContractSymbol"
    ).toUpperCase();
    const shortContractSymbol = requireStringField(
      input.payload.shortContractSymbol,
      "optionExecution.shortContractSymbol"
    ).toUpperCase();

    if (!candidateSymbols.has(longContractSymbol) || !candidateSymbols.has(shortContractSymbol)) {
      throw new Error("Spread contract symbols must come from the candidate set.");
    }

    if (longContractSymbol === shortContractSymbol) {
      throw new Error("Spread contract symbols must be distinct.");
    }

    return {
      canExecute,
      qty,
      limitPrice,
      rationale,
      changeMind,
      confidenceScore,
      dataConsumed,
      longContractSymbol,
      shortContractSymbol,
    };
  }

  const callContractSymbol = requireStringField(
    input.payload.callContractSymbol,
    "optionExecution.callContractSymbol"
  ).toUpperCase();
  const putContractSymbol = requireStringField(
    input.payload.putContractSymbol,
    "optionExecution.putContractSymbol"
  ).toUpperCase();

  if (!candidateSymbols.has(callContractSymbol) || !candidateSymbols.has(putContractSymbol)) {
    throw new Error("Straddle contract symbols must come from the candidate set.");
  }

  if (callContractSymbol === putContractSymbol) {
    throw new Error("Straddle call and put contracts must be distinct.");
  }

  return {
    canExecute,
    qty,
    limitPrice,
    rationale,
    changeMind,
    confidenceScore,
    dataConsumed,
    callContractSymbol,
    putContractSymbol,
  };
}

async function getResearchPlan(input: {
  session: RuntimeSessionSnapshot;
  brokerState: AgentDecisionInput["brokerState"];
  allocationInputs: CioAllocationInput[];
}) {
  return requestValidatedAgentJsonDecision({
    agentId: "AGT-RESEARCH",
    purpose: "research planning and evidence selection",
    userPrompt: buildResearchPlanningPrompt(input),
    validate: validateResearchPlan,
    schema: RESEARCH_PLAN_SCHEMA,
  });
}

async function getResearchDecision(input: AgentDecisionInput) {
  return requestValidatedAgentJsonDecision({
    agentId: "AGT-RESEARCH",
    purpose: "research and market framing",
    userPrompt: buildResearchPrompt(input),
    validate: (payload) => validateResearchDecision(payload, input.marketContext),
    schema: RESEARCH_DECISION_SCHEMA,
  });
}

function getScheduledActiveTradingAgentIds(session: RuntimeSessionSnapshot) {
  return TRADING_AGENT_IDS.filter((agentId) => session.activeAgentIds.includes(agentId));
}

function buildInactiveTraderDecision(input: {
  agentId: TradingAgentId;
  session: RuntimeSessionSnapshot;
}): TraderAgentDecision {
  const { agentId, session } = input;

  return {
    agentId,
    shouldTrade: false,
    observation: `${getTradingAgentRole(agentId)} is inactive during the ${session.label.toLowerCase()} session.`,
    whyItMatters:
      "The runtime schedule keeps this sleeve off the trader decision path for this cycle, so it should monitor existing exposure only and avoid fresh trade selection.",
    changeMind:
      "Wake this sleeve in the next staffed trading window before requesting a new trade decision.",
    confidenceScore: 100,
    reasoning: `Scheduler marked ${agentId} inactive for ${session.phase}.`,
    discussionNote: `Inactive for ${session.label}; no fresh trader model call was made this cycle.`,
    dataConsumed: [
      `session.phase:${session.phase}`,
      `session.label:${session.label}`,
      `session.orderExecutionEnabled:${session.orderExecutionEnabled}`,
    ],
    trade: null,
  };
}

async function getTraderDecision(input: {
  agentId: TradingAgentId;
  session: RuntimeSessionSnapshot;
  brokerState: AgentDecisionInput["brokerState"];
  allocationInput: CioAllocationInput | null;
  researchDecision: ResearchAgentDecision;
  marketContext: AgentDecisionMarketContext;
}) {
  if (isPythonTradingAgentId(input.agentId)) {
    const evidencePayload = await runPythonTradingAgent({
      agentId: input.agentId,
      payload: {
        mode: "runtime_evidence",
        session: input.session,
        brokerState: summarizeBrokerState(input.brokerState),
        allocationInput: input.allocationInput,
        researchDecision: input.researchDecision,
        marketContext: input.marketContext,
        portfolioValue: input.brokerState?.account.portfolioValue ?? null,
      },
    });

    return requestValidatedAgentJsonDecision({
      agentId: input.agentId,
      purpose: "trade timing and expression selection from live systematic diagnostics",
      userPrompt: buildPythonTraderPrompt({
        agentId: input.agentId,
        session: input.session,
        brokerState: input.brokerState,
        allocationInput: input.allocationInput,
        researchDecision: input.researchDecision,
        marketContext: input.marketContext,
        systematicEvidence: evidencePayload,
      }),
      validate: (payload) =>
        validatePythonTraderDecisionScope(
          validateTraderDecision(input.agentId, payload),
          evidencePayload
        ),
      schema: TRADER_DECISION_SCHEMA,
    });
  }

  return requestValidatedAgentJsonDecision({
    agentId: input.agentId,
    purpose: "trade timing and expression selection",
    userPrompt: buildTraderPrompt(input),
    validate: (payload) => validateTraderDecision(input.agentId, payload),
    schema: TRADER_DECISION_SCHEMA,
  });
}

async function getCioDecision(input: {
  session: RuntimeSessionSnapshot;
  brokerState: AgentDecisionInput["brokerState"];
  allocationInputs: CioAllocationInput[];
  researchDecision: ResearchAgentDecision;
  traderDecisions: TraderAgentDecision[];
}) {
  return requestValidatedAgentJsonDecision({
    agentId: "AGT-CIO",
    purpose: "allocation, guardrail, and sleeve-routing decision",
    userPrompt: buildCioPrompt(input),
    validate: (payload) => validateCioDecision(payload, input.session),
    schema: CIO_DECISION_SCHEMA,
  });
}

export async function getAgentRiskDispositionDecision(input: {
  session: RuntimeSessionSnapshot;
  brokerState: AgentDecisionInput["brokerState"];
  allocationInput: CioAllocationInput | null;
  researchDecision: ResearchAgentDecision;
  traderDecision: TraderAgentDecision;
  cioDecision: CioAgentDecision;
  tradeIntent: AgentTradeIntentSummary;
  guardrails: AgentRiskGuardrails;
  riskContext: {
    sleeveAllocationUsd: number | null;
    buyingPower: number;
    portfolioValue: number;
    agentExposureUsd: number;
    portfolioGrossExposureUsd: number;
  };
}) {
  return requestValidatedAgentJsonDecision({
    agentId: "AGT-CIO",
    purpose: "final trade-risk adjudication",
    userPrompt: buildRiskAdjudicationPrompt(input),
    validate: validateRiskDispositionDecision,
    schema: RISK_DISPOSITION_SCHEMA,
  });
}

export async function getCioReplacementDecision(input: {
  session: RuntimeSessionSnapshot;
  brokerState: AgentDecisionInput["brokerState"];
  researchDecision: ResearchAgentDecision;
  cioDecision: CioAgentDecision;
  selectedTradeAgentId: TradingAgentId;
  selectedTradeDecision: TraderAgentDecision;
  traderDecisions: Record<TradingAgentId, TraderAgentDecision>;
  holdings: AgentReplacementHoldingCandidate[];
}) {
  return requestValidatedAgentJsonDecision({
    agentId: "AGT-CIO",
    purpose: "portfolio-wide opportunity-cost replacement decision",
    userPrompt: buildCioReplacementPrompt(input),
    validate: (payload) =>
      validateReplacementDecision({
        payload,
        holdings: input.holdings,
      }),
    schema: REPLACEMENT_DECISION_SCHEMA,
  });
}

export async function getAgentOptionExecutionDecision(input: {
  agentId: TradingAgentId;
  session: RuntimeSessionSnapshot;
  researchDecision: ResearchAgentDecision;
  traderDecision: TraderAgentDecision;
  tradeIntent: AgentTradeIntentSummary;
  underlyingReferencePrice: number;
  candidates: AgentOptionExecutionCandidate[];
}) {
  return requestValidatedAgentJsonDecision({
    agentId: input.agentId,
    purpose: "exact option contract selection and execution planning",
    userPrompt: buildOptionExecutionPrompt(input),
    validate: (payload) =>
      validateOptionExecutionDecision({
        payload,
        traderDecision: input.traderDecision,
        candidates: input.candidates,
      }),
    schema: OPTION_EXECUTION_SCHEMA,
  });
}

export async function collectAgentDirectedMarketContext(input: {
  session: RuntimeSessionSnapshot;
  brokerState: AgentDecisionInput["brokerState"];
  allocationInputs: CioAllocationInput[];
}): Promise<AgentDirectedResearchCollection> {
  const researchPlan = await getResearchPlan(input);
  const dependencyStatuses: AgentDecisionDependencyStatus[] = [];
  const retentionPackets: AgentRetainedResearchPacket[] = [];

  const [
    massiveResult,
    kalshiResult,
    polymarketResult,
    secResult,
    newsApiResult,
  ] = await Promise.allSettled([
    getMassiveResearchPacket(researchPlan.massiveSymbols),
    researchPlan.kalshiQueries.length > 0
      ? getKalshiResearchPacket(researchPlan.kalshiQueries)
      : Promise.resolve(null),
    researchPlan.polymarketQueries.length > 0
      ? getPolymarketResearchPacket(researchPlan.polymarketQueries)
      : Promise.resolve(null),
    researchPlan.secTickers.length > 0
      ? getSecEarningsPacket(researchPlan.secTickers)
      : Promise.resolve(null),
    researchPlan.newsQueries.length > 0
      ? getNewsApiResearchPacket(researchPlan.newsQueries)
      : Promise.resolve(null),
  ]);

  let massiveSummary = "Alpaca + Alpha Vantage research was not requested for this cycle.";
  let kalshiSummary = "Kalshi was not requested for this cycle.";
  let polymarketSummary = "Polymarket was not requested for this cycle.";
  let secEdgarSummary = "SEC EDGAR was not requested for this cycle.";
  let newsApiSummary = "Alpha Vantage was not requested for this cycle.";
  let massiveEvidenceSummary: string | null = null;
  let kalshiEvidenceSummary: string | null = null;
  let polymarketEvidenceSummary: string | null = null;
  let secEdgarEvidenceSummary: string | null = null;
  let newsApiEvidenceSummary: string | null = null;

  if (massiveResult.status === "fulfilled") {
    massiveSummary = summarizeMassivePacketForAgents(massiveResult.value);
    massiveEvidenceSummary = massiveResult.value.connected ? massiveSummary : null;
    dependencyStatuses.push(
      buildResearchDependencyStatus({
        sourceId: "MASSIVE",
        healthy: massiveResult.value.connected,
        summary: massiveSummary,
        error: massiveResult.value.errors[0] ?? null,
        })
      );
  } else {
    const errorMessage =
      massiveResult.reason instanceof Error
        ? massiveResult.reason.message
        : "Alpaca + Alpha Vantage research request failed unexpectedly.";
    massiveSummary = `Alpaca + Alpha Vantage research failed this cycle: ${errorMessage}`;
    dependencyStatuses.push(
      buildResearchDependencyStatus({
        sourceId: "MASSIVE",
        healthy: false,
        summary: massiveSummary,
        error: errorMessage,
      })
    );
  }
  retentionPackets.push(
    buildRetainedResearchPacket({
      sourceId: "MASSIVE",
      requestedInputs: researchPlan.massiveSymbols,
      summary: massiveSummary,
      status: massiveResult.status === "fulfilled" ? "fulfilled" : "rejected",
      packet: massiveResult.status === "fulfilled" ? massiveResult.value : null,
      error:
        massiveResult.status === "fulfilled"
          ? massiveResult.value.errors[0] ?? null
          : massiveResult.reason instanceof Error
            ? massiveResult.reason.message
            : "Alpaca + Alpha Vantage research request failed unexpectedly.",
    })
  );

  if (kalshiResult.status === "fulfilled") {
    if (kalshiResult.value) {
      kalshiSummary = summarizeKalshiPacketForAgents(kalshiResult.value);
      kalshiEvidenceSummary = kalshiResult.value.connected ? kalshiSummary : null;
      dependencyStatuses.push(
        buildResearchDependencyStatus({
          sourceId: "KALSHI",
          healthy: kalshiResult.value.connected,
          summary: kalshiSummary,
          error: kalshiResult.value.errors[0] ?? null,
        })
      );
    } else {
      kalshiSummary = "Research agent skipped Kalshi for this cycle.";
      dependencyStatuses.push(buildSkippedProviderStatus("KALSHI", kalshiSummary));
    }
  } else {
    const errorMessage =
      kalshiResult.reason instanceof Error
        ? kalshiResult.reason.message
        : "Kalshi research request failed unexpectedly.";
    kalshiSummary = `Kalshi failed this cycle: ${errorMessage}`;
    dependencyStatuses.push(
      buildResearchDependencyStatus({
        sourceId: "KALSHI",
        healthy: false,
        summary: kalshiSummary,
        error: errorMessage,
      })
    );
  }
  retentionPackets.push(
    buildRetainedResearchPacket({
      sourceId: "KALSHI",
      requestedInputs: researchPlan.kalshiQueries,
      summary: kalshiSummary,
      status:
        kalshiResult.status === "rejected"
          ? "rejected"
          : kalshiResult.value
            ? "fulfilled"
            : "skipped",
      packet:
        kalshiResult.status === "fulfilled" && kalshiResult.value
          ? kalshiResult.value
          : null,
      error:
        kalshiResult.status === "rejected"
          ? kalshiResult.reason instanceof Error
            ? kalshiResult.reason.message
            : "Kalshi research request failed unexpectedly."
          : kalshiResult.value?.errors[0] ?? null,
    })
  );

  if (polymarketResult.status === "fulfilled") {
    if (polymarketResult.value) {
      polymarketSummary = summarizePolymarketPacketForAgents(polymarketResult.value);
      polymarketEvidenceSummary = polymarketResult.value.connected
        ? polymarketSummary
        : null;
      dependencyStatuses.push(
        buildResearchDependencyStatus({
          sourceId: "POLYMARKET",
          healthy: polymarketResult.value.connected,
          summary: polymarketSummary,
          error: polymarketResult.value.errors[0] ?? null,
        })
      );
    } else {
      polymarketSummary = "Research agent skipped Polymarket for this cycle.";
      dependencyStatuses.push(buildSkippedProviderStatus("POLYMARKET", polymarketSummary));
    }
  } else {
    const errorMessage =
      polymarketResult.reason instanceof Error
        ? polymarketResult.reason.message
        : "Polymarket research request failed unexpectedly.";
    polymarketSummary = `Polymarket failed this cycle: ${errorMessage}`;
    dependencyStatuses.push(
      buildResearchDependencyStatus({
        sourceId: "POLYMARKET",
        healthy: false,
        summary: polymarketSummary,
        error: errorMessage,
      })
    );
  }
  retentionPackets.push(
    buildRetainedResearchPacket({
      sourceId: "POLYMARKET",
      requestedInputs: researchPlan.polymarketQueries,
      summary: polymarketSummary,
      status:
        polymarketResult.status === "rejected"
          ? "rejected"
          : polymarketResult.value
            ? "fulfilled"
            : "skipped",
      packet:
        polymarketResult.status === "fulfilled" && polymarketResult.value
          ? polymarketResult.value
          : null,
      error:
        polymarketResult.status === "rejected"
          ? polymarketResult.reason instanceof Error
            ? polymarketResult.reason.message
            : "Polymarket research request failed unexpectedly."
          : polymarketResult.value?.errors[0] ?? null,
    })
  );

  if (secResult.status === "fulfilled") {
    if (secResult.value) {
      secEdgarSummary = summarizeSecEarningsPacketForAgents(secResult.value);
      secEdgarEvidenceSummary = secResult.value.connected ? secEdgarSummary : null;
      dependencyStatuses.push(
        buildResearchDependencyStatus({
          sourceId: "SEC_EDGAR",
          healthy: secResult.value.connected,
          summary: secEdgarSummary,
          error: secResult.value.errors[0] ?? null,
        })
      );
    } else {
      secEdgarSummary = "Research agent skipped SEC EDGAR for this cycle.";
      dependencyStatuses.push(buildSkippedProviderStatus("SEC_EDGAR", secEdgarSummary));
    }
  } else {
    const errorMessage =
      secResult.reason instanceof Error
        ? secResult.reason.message
        : "SEC EDGAR research request failed unexpectedly.";
    secEdgarSummary = `SEC EDGAR failed this cycle: ${errorMessage}`;
    dependencyStatuses.push(
      buildResearchDependencyStatus({
        sourceId: "SEC_EDGAR",
        healthy: false,
        summary: secEdgarSummary,
        error: errorMessage,
      })
    );
  }
  retentionPackets.push(
    buildRetainedResearchPacket({
      sourceId: "SEC_EDGAR",
      requestedInputs: researchPlan.secTickers,
      summary: secEdgarSummary,
      status:
        secResult.status === "rejected"
          ? "rejected"
          : secResult.value
            ? "fulfilled"
            : "skipped",
      packet:
        secResult.status === "fulfilled" && secResult.value ? secResult.value : null,
      error:
        secResult.status === "rejected"
          ? secResult.reason instanceof Error
            ? secResult.reason.message
            : "SEC EDGAR research request failed unexpectedly."
          : secResult.value?.errors[0] ?? null,
    })
  );

  if (newsApiResult.status === "fulfilled") {
    if (newsApiResult.value) {
      newsApiSummary = summarizeNewsApiPacketForAgents(newsApiResult.value);
      newsApiEvidenceSummary = newsApiResult.value.hasUsableArticles
        ? newsApiSummary
        : null;
      dependencyStatuses.push(
        buildResearchDependencyStatus({
          sourceId: "NEWSAPI",
          healthy: newsApiResult.value.connected,
          summary: newsApiSummary,
          error: newsApiResult.value.errors[0] ?? null,
        })
      );
    } else {
      newsApiSummary = "Research agent skipped Alpha Vantage for this cycle.";
      dependencyStatuses.push(buildSkippedProviderStatus("NEWSAPI", newsApiSummary));
    }
  } else {
    const errorMessage =
      newsApiResult.reason instanceof Error
        ? newsApiResult.reason.message
        : "Alpha Vantage research request failed unexpectedly.";
    newsApiSummary = `Alpha Vantage failed this cycle: ${errorMessage}`;
    dependencyStatuses.push(
      buildResearchDependencyStatus({
        sourceId: "NEWSAPI",
        healthy: false,
        summary: newsApiSummary,
        error: errorMessage,
      })
    );
  }
  retentionPackets.push(
    buildRetainedResearchPacket({
      sourceId: "NEWSAPI",
      requestedInputs: researchPlan.newsQueries,
      summary: newsApiSummary,
      status:
        newsApiResult.status === "rejected"
          ? "rejected"
          : newsApiResult.value
            ? "fulfilled"
            : "skipped",
      packet:
        newsApiResult.status === "fulfilled" && newsApiResult.value
          ? newsApiResult.value
          : null,
      error:
        newsApiResult.status === "rejected"
          ? newsApiResult.reason instanceof Error
            ? newsApiResult.reason.message
            : "Alpha Vantage research request failed unexpectedly."
          : newsApiResult.value?.errors[0] ?? null,
    })
  );

  return {
    researchPlan,
    marketContext: buildMarketContextFromResearchCollection({
      researchPlan,
      massiveSummary,
      kalshiSummary,
      polymarketSummary,
      newsApiSummary,
      secEdgarSummary,
      massiveEvidenceSummary,
      kalshiEvidenceSummary,
      polymarketEvidenceSummary,
      newsApiEvidenceSummary,
      secEdgarEvidenceSummary,
    }),
    dependencyStatuses,
    retentionPackets,
  };
}

export async function getAgentDrivenDecisionSet(
  input: AgentDecisionInput
): Promise<AgentDecisionSet> {
  const research = await getResearchDecision(input);
  const activeTradingAgentIds = getScheduledActiveTradingAgentIds(input.session);
  const activeTraderDecisions = await Promise.all(
    activeTradingAgentIds.map(async (agentId) =>
      getTraderDecision({
        agentId,
        session: input.session,
        brokerState: input.brokerState,
        allocationInput:
          input.allocationInputs.find((candidate) => candidate.agentId === agentId) ?? null,
        researchDecision: research,
        marketContext: input.marketContext,
      })
    )
  );
  const activeTraderDecisionMap = new Map(
    activeTraderDecisions.map((decision) => [decision.agentId, decision])
  );
  const traderDecisions = TRADING_AGENT_IDS.map(
    (agentId) =>
      activeTraderDecisionMap.get(agentId) ??
      buildInactiveTraderDecision({
        agentId,
        session: input.session,
      })
  );
  const traders = Object.fromEntries(
    traderDecisions.map((decision) => [decision.agentId, decision])
  ) as Record<TradingAgentId, TraderAgentDecision>;
  const cio = await getCioDecision({
    session: input.session,
    brokerState: input.brokerState,
    allocationInputs: input.allocationInputs,
    researchDecision: research,
    traderDecisions,
  });

  if (cio.selectedTradeAgentId) {
    const selected = traders[cio.selectedTradeAgentId];

    if (!selected?.shouldTrade || !selected.trade) {
      throw new Error(
        `research lead selected ${cio.selectedTradeAgentId} for publication, but that sleeve did not return a publishable research event.`
      );
    }
  }

  return {
    research,
    traders,
    cio,
  };
}
