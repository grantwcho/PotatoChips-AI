import "server-only";

import type { PoolClient } from "pg";
import type {
  OvernightRiskMonitorSnapshot,
  PaperCycleResult,
  PaperRuntimeMessageSeed,
  RuntimeSessionSnapshot,
} from "@/lib/agents/types";
import { isCoreDeskAgentId } from "@/lib/agents/core-agent-config";
import { isAgentSwarmDecommissioned } from "@/lib/agents/decommission";
import {
  runLearningMaintenance,
  type AgentRuntimeControls,
} from "@/lib/agents/learning";
import {
  TRADING_AGENT_IDS as ROUTED_TRADING_AGENT_IDS,
  getTradingAgentRole as getConfiguredTradingAgentRole,
  getTradingAgentShortCode,
  isPythonTradingAgentId,
  isTradingAgentId as isConfiguredTradingAgentId,
  type TradingAgentId as RuntimeTradingAgentId,
} from "@/lib/agents/trading-agent-config";
import {
  collectAgentDirectedMarketContext,
  type AgentDecisionSet,
  getAgentDrivenDecisionSet,
  getAgentOptionExecutionDecision,
  getCioReplacementDecision,
  getAgentRiskDispositionDecision,
  type AgentReplacementHoldingCandidate,
  type AgentDecisionMarketContext,
  type AgentDecisionDependencyStatus,
  type AgentRetainedResearchPacket,
  type AgentOptionExecutionCandidate,
  type AgentRiskGuardrails,
  type AgentTradeIntentSummary,
  type CioAgentDecision,
  type ResearchAgentDecision,
  type TraderAgentDecision,
} from "@/lib/agents/decision-engine";
import {
  generateAutonomousConversationPlan,
  renderAgentVoiceBatch,
  type AgentMessageVoiceDraft,
} from "@/lib/agents/message-generation";
import {
  completePaperCycle,
  ensureAgentRegistrySeeded,
  getPendingAgentResponseRequests,
  type CioAllocationInput,
  getCioAllocationInputs,
  getAgentFeedMessages,
  getAgentFeedSummary,
  getBrokerDashboardSnapshot,
  hasRecentAgentMessageByDedupeKey,
  getLatestPaperCycleIndex,
  insertAgentDecision,
  insertAgentAllocationEvent,
  type AgentCycleArtifactScope,
  type AgentCycleArtifactStorageTier,
  insertAgentMessage,
  insertAlpacaAccountSnapshot,
  insertAlpacaPositionSnapshots,
  insertPaperCycle,
  updatePaperCycleRegime,
  upsertAlpacaOrder,
  upsertAgentCycleArtifact,
  withAgentTransaction,
  type PendingAgentResponseRequest,
} from "@/lib/agents/repository";
import {
  getOvernightRiskMonitorSnapshot,
  getRuntimeSession,
} from "@/lib/agents/schedule";
import {
  getMassiveResearchPacket,
  summarizeMassivePacketForAgents,
  type MassiveResearchPacket,
} from "@/lib/research/massive";
import {
  getKalshiResearchPacket,
  summarizeKalshiPacketForAgents,
  type KalshiResearchPacket,
} from "@/lib/research/kalshi";
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
import {
  cancelAlpacaOrder,
  getAlpacaAsset,
  getAlpacaAccount,
  listAlpacaOptionSnapshots,
  parseAlpacaOptionContractSymbol,
  getAlpacaStockSnapshot,
  isAlpacaPaperTradingConfigured,
  listAlpacaPositions,
  listAlpacaRecentOrders,
  submitAlpacaOrder,
} from "@/lib/trading/alpaca";
import type {
  AlpacaAccountSnapshot,
  AlpacaOptionContractSnapshot,
  AlpacaOptionOrderLegInput,
  AlpacaOrderSide,
  AlpacaOrderSnapshot,
  AlpacaPositionIntent,
  AlpacaPositionSnapshot,
  AlpacaSubmitOrderInput,
  AlpacaStockSnapshot,
  BrokerDashboardSnapshot,
} from "@/lib/trading/types";

const REGIMES = [
  "BULL_TREND",
  "HIGH_VOL",
  "RISK_ON",
  "TRANSITION",
  "RISK_OFF",
  "LOW_VOL",
] as const;

function normalizeDiscussionRegime(value: string): (typeof REGIMES)[number] {
  const normalized = value.trim().toUpperCase();

  if ((REGIMES as readonly string[]).includes(normalized)) {
    return normalized as (typeof REGIMES)[number];
  }

  if (normalized.includes("BULL")) {
    return "BULL_TREND";
  }

  if (normalized.includes("LOW") && normalized.includes("VOL")) {
    return "LOW_VOL";
  }

  if (normalized.includes("HIGH") && normalized.includes("VOL")) {
    return "HIGH_VOL";
  }

  if (normalized.includes("RISK") && normalized.includes("OFF")) {
    return "RISK_OFF";
  }

  if (normalized.includes("RISK") && normalized.includes("ON")) {
    return "RISK_ON";
  }

  return "TRANSITION";
}

const SENTIMENT_NAMES = [
  "NVDA",
  "META",
  "TSLA",
  "AMZN",
  "AAPL",
  "NFLX",
  "PLTR",
  "COIN",
  "AMD",
  "SMCI",
] as const;
const EVENT_NAMES = [
  "JNJ",
  "PFE",
  "MRNA",
  "BAC",
  "UBER",
  "JPM",
  "DAL",
  "DIS",
  "COST",
  "CVS",
] as const;
const CREDIT_PROXY_SYMBOLS = [
  "HYG",
  "LQD",
  "JNK",
  "TLT",
  "XLF",
] as const;
const COMMODITY_PROXY_SYMBOLS = [
  "GLD",
  "SLV",
  "USO",
  "DBA",
  "COPX",
] as const;
const ALTERNATIVE_PROXY_SYMBOLS = [
  "IBIT",
  "BITO",
  "ARKK",
  "VNQ",
  "QQQ",
] as const;
const MACRO_OPTION_UNDERLYINGS = [
  "QQQ",
  "SPY",
  "GLD",
  "TLT",
  "HYG",
] as const;
const BROKER_SNAPSHOT_REFRESH_TTL_MS = 5_000;
const SHORT_AVAILABILITY_FAILURE_TTL_MS = 15 * 60_000;
const DEFAULT_STALE_EQUITY_ORDER_TTL_MS = 12 * 60_000;
const DEFAULT_STALE_OPTION_ORDER_TTL_MS = 8 * 60_000;
const URGENT_OPTION_ORDER_TTL_MS = 3 * 60_000;
const BASE_SLEEVE_RISK_GUARDRAILS = {
  maxSingleOrderPctOfAllocation: 0.075,
  maxSleeveUtilizationPct: 0.9,
  maxPortfolioGrossExposurePct: 0.85,
  buyingPowerBufferPct: 0.95,
  minOrderNotional: 25,
} as const;
const PAPER_EXPERIMENTATION_GUARDRAILS = {
  maxSingleOrderPctOfAllocation: 0.14,
  maxSleeveUtilizationPct: 1.15,
  maxPortfolioGrossExposurePct: 0.97,
  buyingPowerBufferPct: 0.99,
  minOrderNotional: 25,
} as const;
type SleeveRiskGuardrails = {
  maxSingleOrderPctOfAllocation: number;
  maxSleeveUtilizationPct: number;
  maxPortfolioGrossExposurePct: number;
  buyingPowerBufferPct: number;
  minOrderNotional: number;
};

let brokerSnapshotRefreshPromise: Promise<void> | null = null;
const recentShortAvailabilityFailures = new Map<
  string,
  {
    message: string;
    expiresAt: number;
  }
>();
const RESEARCH_AREAS = [
  "margin revisions",
  "regime breadth",
  "credit spread drift",
  "earnings estimate dispersion",
  "sector leadership rotation",
] as const;

const MACRO_TRADE_MAP: Record<
  (typeof REGIMES)[number],
  { candidates: string[]; rationale: string; notional: number }
> = {
  BULL_TREND: {
    candidates: ["QQQ", "SPY", "IWM", "SMH", "XLY"],
    rationale: "Growth leadership remains the cleanest liquid expression of the current bull trend.",
    notional: 700,
  },
  HIGH_VOL: {
    candidates: ["XLU", "TLT", "GLD", "XLP"],
    rationale: "Defensive beta and duration ballast are favored while volatility is elevated.",
    notional: 600,
  },
  RISK_ON: {
    candidates: ["SPY", "IWM", "QQQ", "XLF", "SMH"],
    rationale: "Broad equity beta remains the highest-conviction macro expression in a risk-on tape.",
    notional: 650,
  },
  TRANSITION: {
    candidates: ["TLT", "XLU", "GLD", "XLP"],
    rationale: "The macro book is preserving optionality while the regime transitions.",
    notional: 550,
  },
  RISK_OFF: {
    candidates: ["TLT", "XLU", "GLD", "XLP"],
    rationale: "Capital is rotating into defensive liquid instruments while risk appetite is fading.",
    notional: 625,
  },
  LOW_VOL: {
    candidates: ["XLF", "SPY", "DIA", "XLI"],
    rationale: "Low-volatility conditions support measured cyclical exposure through liquid ETFs.",
    notional: 575,
  },
};

type BrokerSyncState = {
  account: AlpacaAccountSnapshot;
  positions: AlpacaPositionSnapshot[];
  recentOrders: AlpacaOrderSnapshot[];
};

type OptionSelectionTarget = {
  targetDaysToExpiration: number;
  strikeOffsetPct?: number;
};

type OptionExecutionPlan =
  | {
      kind: "option_single";
      contractSymbol: string;
      qty: number;
      limitPrice: number;
      positionIntent: AlpacaPositionIntent;
    }
  | {
      kind: "option_mleg";
      qty: number;
      limitPrice: number;
      legs: AlpacaOptionOrderLegInput[];
      contractSymbols: string[];
    }
  | {
      kind: "equity_pair";
      legs: [
        {
          symbol: string;
          side: AlpacaOrderSide;
          notional: number;
          qty?: number | null;
        },
        {
          symbol: string;
          side: AlpacaOrderSide;
          notional: number;
          qty?: number | null;
        },
      ];
    };

type BrokerTradeIntent = {
  agentId: RuntimeTradingAgentId;
  symbol: string;
  side: AlpacaOrderSide;
  notional: number;
  shareQuantity?: number | null;
  assetBucket: "equity" | "credit_proxy" | "commodity_proxy" | "alternative_proxy" | "equity_option";
  strategyFamily: string;
  displaySymbol?: string;
  executionPlan?: OptionExecutionPlan;
  messageDraft: AgentMessageVoiceDraft;
  reasoning: string;
  signalContext: Record<string, unknown>;
  confidenceScore: number;
};

type TradingAgentId = "AGT-MACRO-001" | "AGT-EVENT-001" | "AGT-SENT-001";

type AgentDiscussionContext = {
  threadId: string;
  researchArea: string;
  eventTicker: string;
  sentimentTicker: string;
  sentimentScore: number;
  macroRead: string;
  eventRead: string;
  sentimentRead: string;
  researchSource: "MASSIVE" | "FALLBACK" | "AGENT_DIRECTED";
  researchPacketSummary: string;
  researchDataConsumed: string[];
  kalshiSummary: string;
  polymarketSummary: string;
  newsApiSummary: string;
  secEdgarSummary: string;
  influenceByAgent: Record<TradingAgentId, string>;
};

type DiscussionTradeBias = {
  preferredStrategyFamily: string | null;
  preferredSymbol: string | null;
  sideBias: AlpacaOrderSide | "neutral";
  confidenceDelta: number;
  notionalMultiplier: number;
  note: string;
  dataConsumed: string[];
};

type AgentDiscussionSignal = {
  observation: string;
  whyItMatters: string;
  changeMind: string;
  confidenceScore: number;
  tradeBias: DiscussionTradeBias;
  dataConsumed: string[];
};

type DeskDiscussionPlan = {
  research: AgentDiscussionSignal & {
    influenceNotes: Record<TradingAgentId, string>;
  };
  macro: AgentDiscussionSignal & {
    influenceTargetId: "AGT-EVENT-001";
    influenceEffect: string;
  };
  event: AgentDiscussionSignal & {
    influenceTargetId: "AGT-SENT-001";
    influenceEffect: string;
  };
  sentiment: AgentDiscussionSignal & {
    influenceTargetId: "AGT-MACRO-001";
    influenceEffect: string;
  };
  cio: {
    observation: string;
    whyItMatters: string;
    changeMind: string;
    confidenceScore: number;
    allocationBoundary: string;
    adjustments: Record<
      TradingAgentId,
      Pick<DiscussionTradeBias, "confidenceDelta" | "notionalMultiplier" | "note">
    >;
  };
  biasByAgent: Record<TradingAgentId, DiscussionTradeBias>;
};

type RiskGateDecision = {
  approved: boolean;
  notional: number;
  requestedNotional: number;
  reason: string;
  guardrails: SleeveRiskGuardrails;
  dataConsumed: string[];
};

type BrokerFailureCategory =
  | "TRADE_INTENT"
  | "PRETRADE_VALIDATION"
  | "RISK_GATE"
  | "BROKER_EXECUTION";

type BrokerExecutionResult = {
  intent: BrokerTradeIntent;
  requestPayload: Record<string, unknown>;
  riskGate?: RiskGateDecision;
  orders?: AlpacaOrderSnapshot[];
  order?: AlpacaOrderSnapshot;
  failureCategory?: BrokerFailureCategory;
  failureCode?: string;
  error?: string;
};

type PreparedOrderRequest = {
  orderRequests: AlpacaSubmitOrderInput[];
  requestPayload: Record<string, unknown>;
};

type ExecutableIntentValidationResult =
  | {
      ok: true;
      intent: BrokerTradeIntent;
      dataConsumed: string[];
    }
  | {
      ok: false;
      code: string;
      reason: string;
      dataConsumed: string[];
    };

type BrokerOrderMaintenanceResult = {
  brokerState: BrokerSyncState;
  messages: PaperRuntimeMessageSeed[];
};

function isPreTradeRiskBlock(result: BrokerExecutionResult) {
  return result.riskGate?.approved === false && result.error === result.riskGate.reason;
}

function isBlockedBeforeBroker(result: BrokerExecutionResult) {
  return (
    isPreTradeRiskBlock(result) ||
    result.failureCategory === "TRADE_INTENT" ||
    result.failureCategory === "PRETRADE_VALIDATION"
  );
}

function buildTradeFailureCopy(input: {
  brokerExecution: BrokerExecutionResult;
  submittedOrders: AlpacaOrderSnapshot[];
  tradeIntent: BrokerTradeIntent;
}) {
  const displaySymbol = input.tradeIntent.displaySymbol ?? input.tradeIntent.symbol;

  if (isPreTradeRiskBlock(input.brokerExecution)) {
    return {
      observation: `I got ${displaySymbol} blocked before it became a published research event.`,
      whyItMatters: `This was a capacity or quality limit, not a thesis change: ${input.brokerExecution.error}`,
      changeMind:
        "If we free up coverage capacity or the quality gate changes, I can put it back on cleanly.",
      failureCategory: "RISK_GATE",
    } as const;
  }

  if (
    input.brokerExecution.failureCategory === "TRADE_INTENT" ||
    input.brokerExecution.failureCategory === "PRETRADE_VALIDATION"
  ) {
    return {
      observation: `I blocked ${displaySymbol} before publishing it as a research event.`,
      whyItMatters: `This was a workflow-shape failure, not a thesis change: ${input.brokerExecution.error}`,
      changeMind:
        "If the event is rebuilt in a publishable shape, I can move it cleanly from there.",
      failureCategory: input.brokerExecution.failureCategory,
    } as const;
  }

  return {
    observation:
      input.submittedOrders.length > 0
        ? `I only got part of ${displaySymbol} published cleanly.`
        : `I couldn't publish ${displaySymbol} as a research event.`,
    whyItMatters: `This is a workflow publication block, not a strategy change: ${input.brokerExecution.error}`,
    changeMind:
      "If the workflow clears or the evidence improves enough, I can revisit it from there.",
    failureCategory: "BROKER_EXECUTION",
  } as const;
}

function parseUnknownNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function isCancelableBrokerOrderStatus(status: string) {
  return ["accepted", "new", "partially_filled", "pending_new"].includes(
    status.toLowerCase()
  );
}

function getWorkingBrokerOrderForAgent(input: {
  brokerState: BrokerSyncState;
  agentId: RuntimeTradingAgentId;
  symbol: string;
  side: AlpacaOrderSide;
}) {
  return input.brokerState.recentOrders.find((order) => {
    if (!isCancelableBrokerOrderStatus(order.status)) {
      return false;
    }

    if (order.symbol !== input.symbol || order.side.toLowerCase() !== input.side) {
      return false;
    }

    return inferAgentIdFromClientOrderId(order.clientOrderId) === input.agentId;
  });
}

function getStockReferencePriceForSide(
  side: AlpacaOrderSide,
  snapshot: AlpacaStockSnapshot
) {
  return side === "buy"
    ? snapshot.askPrice ?? snapshot.tradePrice ?? snapshot.previousClose
    : snapshot.bidPrice ?? snapshot.tradePrice ?? snapshot.previousClose;
}

function getWholeShareQtyForNotional(notional: number, referencePrice: number) {
  if (!Number.isFinite(referencePrice) || referencePrice <= 0) {
    return 0;
  }

  return Math.max(0, Math.floor(notional / referencePrice));
}

function pruneExpiredShortAvailabilityFailures(now = Date.now()) {
  for (const [symbol, entry] of recentShortAvailabilityFailures.entries()) {
    if (entry.expiresAt <= now) {
      recentShortAvailabilityFailures.delete(symbol);
    }
  }
}

function getRecentShortAvailabilityFailure(symbol: string, now = Date.now()) {
  pruneExpiredShortAvailabilityFailures(now);
  return recentShortAvailabilityFailures.get(symbol.trim().toUpperCase()) ?? null;
}

function recordShortAvailabilityFailure(symbol: string, message: string) {
  recentShortAvailabilityFailures.set(symbol.trim().toUpperCase(), {
    message,
    expiresAt: Date.now() + SHORT_AVAILABILITY_FAILURE_TTL_MS,
  });
}

function getOrderAgeMs(order: AlpacaOrderSnapshot, nowMs = Date.now()) {
  const submittedAtMs = order.submittedAt ? new Date(order.submittedAt).getTime() : NaN;

  if (!Number.isFinite(submittedAtMs)) {
    return 0;
  }

  return Math.max(0, nowMs - submittedAtMs);
}

function getOrderLimitPrice(order: AlpacaOrderSnapshot) {
  return parseUnknownNumber(order.raw.limit_price);
}

function getStaleOrderTtlMs(order: AlpacaOrderSnapshot, now = new Date()) {
  const parsedOption = parseAlpacaOptionContractSymbol(order.symbol);

  if (!parsedOption) {
    return DEFAULT_STALE_EQUITY_ORDER_TTL_MS;
  }

  const expirationAtMs = new Date(`${parsedOption.expirationDate}T20:00:00.000Z`).getTime();
  const daysToExpiration =
    Number.isFinite(expirationAtMs) && expirationAtMs > 0
      ? (expirationAtMs - now.getTime()) / 86_400_000
      : null;
  const limitPrice = getOrderLimitPrice(order);

  if ((daysToExpiration !== null && daysToExpiration <= 3) || (limitPrice ?? 0) < 1) {
    return URGENT_OPTION_ORDER_TTL_MS;
  }

  return DEFAULT_STALE_OPTION_ORDER_TTL_MS;
}

function shouldAutoCancelStaleOrder(order: AlpacaOrderSnapshot, now = new Date()) {
  if (!isCancelableBrokerOrderStatus(order.status)) {
    return false;
  }

  return getOrderAgeMs(order, now.getTime()) >= getStaleOrderTtlMs(order, now);
}

function buildIncidentKey(parts: Array<string | number | null | undefined>) {
  return parts
    .map((part) => (part === null || part === undefined ? "" : String(part).trim()))
    .filter((part) => part.length > 0)
    .join(":")
    .toLowerCase();
}

type AllocationScoreBreakdown = {
  regimeFit: number;
  confidence: number;
  activity: number;
  execution: number;
  pnl: number;
  exposure: number;
  composite: number;
};

type CioAllocationDecision = {
  agentId: string;
  agentName: string;
  strategyCategory: string | null;
  previousAllocationUsd: number | null;
  newAllocationUsd: number;
  score: AllocationScoreBreakdown;
  rationale: string;
  confidenceScore: number;
  inputs: Record<string, unknown>;
};

type PendingPaperRuntimeMessageSeed = Omit<PaperRuntimeMessageSeed, "content"> & {
  voiceDraft: AgentMessageVoiceDraft;
};

type AllocationPersistenceSeed = {
  agentId: RuntimeTradingAgentId;
  previousAllocationUsd: number | null;
  newAllocationUsd: number;
  rationale: string;
  inputs: Record<string, unknown>;
};

type CycleRetentionArtifactSeed = {
  artifactScope: AgentCycleArtifactScope;
  artifactKey: string;
  storageTier: AgentCycleArtifactStorageTier;
  summary: string;
  payload: unknown;
};

type DeliveredTradeBias = {
  sourceAgentId: string;
  targetAgentId: TradingAgentId;
  bias: Partial<DiscussionTradeBias>;
};

type ResearchDependencyStatus = {
  sourceId: "MASSIVE" | "KALSHI" | "POLYMARKET" | "SEC_EDGAR" | "NEWSAPI";
  healthy: boolean;
  summary: string;
  error: string | null;
  impact: string;
};

type AutonomousAgentBlackboard = {
  cycleId: number;
  session: RuntimeSessionSnapshot;
  regime: (typeof REGIMES)[number];
  context: AgentDiscussionContext;
  basePayload: Record<string, unknown>;
  messages: PendingPaperRuntimeMessageSeed[];
};

type AutonomousAgentTurn = {
  id: string;
  agentId: string;
  run: (
    blackboard: AutonomousAgentBlackboard
  ) =>
    | PendingPaperRuntimeMessageSeed
    | PendingPaperRuntimeMessageSeed[]
    | null
    | Promise<PendingPaperRuntimeMessageSeed | PendingPaperRuntimeMessageSeed[] | null>;
};

type AutonomousAgentTurnRunResult = {
  renderedMessages: PaperRuntimeMessageSeed[];
  pendingMessages: PendingPaperRuntimeMessageSeed[];
};

const RESEARCH_DEPENDENCY_IMPACTS: Record<
  ResearchDependencyStatus["sourceId"],
  string
> = {
  MASSIVE:
    "Primary Alpaca pricing and Alpha Vantage headline context is missing or thin, so the desk has to lean harder on the remaining live sources.",
  KALSHI:
    "One public crowd-odds cross-check is missing, but it should not block macro, event, or sentiment work.",
  POLYMARKET:
    "Live crowd-pricing context is thinner, so catalyst and sentiment reads should lean more on price and filings.",
  SEC_EDGAR:
    "Verified filing context is weaker, so event timing should be treated with a little more skepticism.",
  NEWSAPI:
    "Narrative confirmation is thinner, so the desk should trust primary data and price action more than headline flow.",
};

const RESEARCH_DEPENDENCY_LABELS: Record<
  ResearchDependencyStatus["sourceId"],
  string
> = {
  MASSIVE: "Alpaca + Alpha Vantage Research",
  KALSHI: "Kalshi",
  POLYMARKET: "Polymarket",
  SEC_EDGAR: "SEC EDGAR",
  NEWSAPI: "Alpha Vantage",
};

function createVoiceDraftId(...parts: Array<string | number | null | undefined>) {
  return parts
    .filter((part) => part !== null && part !== undefined && String(part).length > 0)
    .map((part) => String(part).replace(/[^a-zA-Z0-9_-]+/g, "-"))
    .join(":");
}

function formatUsd(value: number) {
  return value.toLocaleString("en-US", {
    maximumFractionDigits: 0,
  });
}

function formatDeskList(values: string[]) {
  const compact = values.map((value) => value.trim()).filter(Boolean);

  if (compact.length === 0) {
    return "";
  }

  if (compact.length === 1) {
    return compact[0];
  }

  if (compact.length === 2) {
    return `${compact[0]} and ${compact[1]}`;
  }

  return `${compact.slice(0, -1).join(", ")}, and ${compact.at(-1)}`;
}

function classifyDependencyFailure(error: string | null) {
  const normalized = (error ?? "").toLowerCase();

  if (
    normalized.includes("too many requests") ||
    normalized.includes("429") ||
    normalized.includes("rate limit") ||
    normalized.includes("rate-limited")
  ) {
    return "rate-limited";
  }

  if (normalized.includes("quota") || normalized.includes("upgrade your subscription")) {
    return "quota-limited";
  }

  if (normalized.includes("missing") && normalized.includes("key")) {
    return "not configured";
  }

  return null;
}

function buildDependencyFailureCauseNote(statuses: ResearchDependencyStatus[]) {
  const providerStates = statuses.flatMap((status) => {
    const classification = classifyDependencyFailure(status.error);

    if (!classification) {
      return [];
    }

    return [`${RESEARCH_DEPENDENCY_LABELS[status.sourceId]} is ${classification}`];
  });

  if (providerStates.length === 0) {
    return null;
  }

  return `Cause check: ${formatDeskList(providerStates)}.`;
}

function buildResearchPlanArtifact(input: {
  session: RuntimeSessionSnapshot;
  researchPlan: Awaited<ReturnType<typeof collectAgentDirectedMarketContext>>["researchPlan"];
}) {
  const providerRequestCount = [
    input.researchPlan.massiveSymbols,
    input.researchPlan.kalshiQueries,
    input.researchPlan.polymarketQueries,
    input.researchPlan.newsQueries,
    input.researchPlan.secTickers,
  ].filter((group) => group.length > 0).length;

  return {
    artifactScope: "RESEARCH_PLAN",
    artifactKey: "agent-directed-plan",
    storageTier: "HOT",
    summary:
      providerRequestCount > 0
        ? `Research plan captured for ${input.session.phase.toLowerCase()} with focus on ${input.researchPlan.researchFocus} across ${providerRequestCount} provider lanes.`
        : `Research plan captured for ${input.session.phase.toLowerCase()} with focus on ${input.researchPlan.researchFocus}.`,
    payload: {
      phase: input.session.phase,
      checkedAt: input.session.checkedAt,
      researchPlan: input.researchPlan,
    },
  } satisfies CycleRetentionArtifactSeed;
}

function buildResearchPacketArtifacts(
  packets: AgentRetainedResearchPacket[]
): CycleRetentionArtifactSeed[] {
  return packets.map((packet) => ({
    artifactScope: "RESEARCH_PACKET",
    artifactKey: packet.sourceId.toLowerCase().replace(/_/g, "-"),
    storageTier: "COLD",
    summary: packet.summary,
    payload: packet.payload,
  }));
}

function buildDecisionContextArtifact(input: {
  session: RuntimeSessionSnapshot;
  executionMode: PaperCycleResult["executionMode"];
  brokerConfigured: boolean;
  brokerConnectionError: string | null;
  brokerState: BrokerSyncState | null;
  allocationInputs: CioAllocationInput[];
  researchCollection: Awaited<ReturnType<typeof collectAgentDirectedMarketContext>>;
}) {
  return {
    artifactScope: "DECISION_CONTEXT",
    artifactKey: "pre-decision",
    storageTier: "HOT",
    summary: `Pre-decision context captured for ${input.session.phase.toLowerCase()} with ${input.allocationInputs.length} allocation inputs and ${input.researchCollection.dependencyStatuses.length} provider status checks.`,
    payload: {
      phase: input.session.phase,
      checkedAt: input.session.checkedAt,
      executionMode: input.executionMode,
      brokerConfigured: input.brokerConfigured,
      brokerConnectionError: input.brokerConnectionError,
      brokerState: input.brokerState,
      allocationInputs: input.allocationInputs,
      researchPlan: input.researchCollection.researchPlan,
      marketContext: input.researchCollection.marketContext,
      dependencyStatuses: input.researchCollection.dependencyStatuses,
    },
  } satisfies CycleRetentionArtifactSeed;
}

function buildDecisionOutputArtifact(input: {
  session: RuntimeSessionSnapshot;
  regime: string;
  decisionSet: {
    research: ResearchAgentDecision;
    traders: Record<string, TraderAgentDecision>;
    cio: CioAgentDecision;
  };
}) {
  const selectedTradeAgentId = input.decisionSet.cio.selectedTradeAgentId;

  return {
    artifactScope: "DECISION_OUTPUT",
    artifactKey: "agent-driven-set",
    storageTier: "HOT",
    summary: selectedTradeAgentId
      ? `Decision set captured for ${input.session.phase.toLowerCase()} under ${input.regime}; research lead selected ${selectedTradeAgentId} for deeper ensemble review.`
      : `Decision set captured for ${input.session.phase.toLowerCase()} under ${input.regime}; research lead did not elevate a sleeve event.`,
    payload: {
      phase: input.session.phase,
      checkedAt: input.session.checkedAt,
      regime: input.regime,
      researchDecision: input.decisionSet.research,
      traderDecisions: input.decisionSet.traders,
      cioDecision: input.decisionSet.cio,
    },
  } satisfies CycleRetentionArtifactSeed;
}

function buildBrokerExecutionArtifact(input: {
  executionMode: PaperCycleResult["executionMode"];
  regime: string;
  brokerExecution: BrokerExecutionResult | null;
}) {
  const summary =
    input.executionMode === "SIMULATED"
      ? "Cycle ran in simulated mode without research-event publication."
      : !input.brokerExecution
        ? `Research-event publication stayed idle under ${input.regime}; no sleeve event was published.`
        : input.brokerExecution.error
          ? `Research-event publication recorded a workflow failure under ${input.regime}: ${input.brokerExecution.error}`
          : `Research-event publication recorded ${input.brokerExecution.orders?.length ?? (input.brokerExecution.order ? 1 : 0)} workflow event${input.brokerExecution.orders?.length === 1 || input.brokerExecution.order ? "" : "s"} under ${input.regime}.`;

  return {
    artifactScope: "BROKER_EXECUTION",
    artifactKey: "alpaca-paper",
    storageTier: "HOT",
    summary,
    payload: {
      executionMode: input.executionMode,
      regime: input.regime,
      brokerExecution: input.brokerExecution,
    },
  } satisfies CycleRetentionArtifactSeed;
}

function buildBrokerStateArtifact(input: {
  executionMode: PaperCycleResult["executionMode"];
  brokerConfigured: boolean;
  brokerConnectionError: string | null;
  brokerState: BrokerSyncState | null;
}) {
  const summary = input.brokerState
    ? `Market-data state snapshot captured with ${input.brokerState.positions.length} coverage item${input.brokerState.positions.length === 1 ? "" : "s"} and ${input.brokerState.recentOrders.length} recent workflow event${input.brokerState.recentOrders.length === 1 ? "" : "s"}.`
    : input.brokerConnectionError
      ? `Market-data state snapshot was unavailable: ${input.brokerConnectionError}`
      : input.brokerConfigured
        ? `Market-data sync was configured, but no post-cycle state snapshot was available in ${input.executionMode.toLowerCase()} mode.`
        : "Market-data state snapshot skipped because workflow publication is not configured.";

  return {
    artifactScope: "BROKER_STATE",
    artifactKey: "post-cycle",
    storageTier: "HOT",
    summary,
    payload: {
      executionMode: input.executionMode,
      brokerConfigured: input.brokerConfigured,
      brokerConnectionError: input.brokerConnectionError,
      brokerState: input.brokerState,
    },
  } satisfies CycleRetentionArtifactSeed;
}

function buildRuntimeFailureArtifact(input: {
  failureStage: string;
  session: RuntimeSessionSnapshot;
  regime: string;
  errorMessage: string;
  dependencyStatuses: ResearchDependencyStatus[];
}) {
  return {
    artifactScope: "RUNTIME_FAILURE",
    artifactKey: "paper-cycle",
    storageTier: "HOT",
    summary: `Runtime failure captured during ${input.failureStage} under ${input.regime}: ${input.errorMessage}`,
    payload: {
      failureStage: input.failureStage,
      phase: input.session.phase,
      checkedAt: input.session.checkedAt,
      regime: input.regime,
      errorMessage: input.errorMessage,
      dependencyStatuses: input.dependencyStatuses,
    },
  } satisfies CycleRetentionArtifactSeed;
}

async function persistCycleRetentionArtifacts(input: {
  cycleId: number;
  artifacts: CycleRetentionArtifactSeed[];
}) {
  if (input.artifacts.length === 0) {
    return;
  }

  await withAgentTransaction(async (client) => {
    const createdAt = new Date();

    for (const artifact of input.artifacts) {
      await upsertAgentCycleArtifact(client, {
        cycleId: input.cycleId,
        artifactScope: artifact.artifactScope,
        artifactKey: artifact.artifactKey,
        storageTier: artifact.storageTier,
        summary: artifact.summary,
        payload: artifact.payload,
        createdAt,
      });
    }
  });
}

function hashSeed(value: number | string) {
  let hash = 0;

  for (const char of String(value)) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }

  return hash;
}

function pickSeededVariant<T extends readonly string[]>(
  variants: T,
  seed?: number | string
) {
  if (variants.length === 0) {
    return "";
  }

  if (seed === null || seed === undefined) {
    return variants[0] ?? "";
  }

  return variants[hashSeed(seed) % variants.length] ?? variants[0] ?? "";
}

function withMessageCooldown(
  payload: Record<string, unknown>,
  dedupeKey: string,
  dedupeWindowMinutes: number
) {
  return {
    ...payload,
    dedupeKey,
    dedupeWindowMinutes,
  };
}

function isUnavailableSourceSummary(value: string) {
  return /did not return usable|returned no usable|degraded|failed this cycle|request failed/i.test(
    value
  );
}

function getConfidencePhrase(score: number, seed?: number | string) {
  if (score >= 90) {
    return pickSeededVariant(
      [
        "I'm leaning pretty hard this way.",
        "This is a strong read for me.",
        "I'd need real contrary evidence to back off this.",
      ],
      seed
    );
  }

  if (score >= 80) {
    return pickSeededVariant(
      [
        "I'm fairly confident here.",
        "This still looks like a solid read to me.",
        "I'd put decent weight on this view.",
      ],
      seed
    );
  }

  if (score >= 70) {
    return pickSeededVariant(
      [
        "I like it, but I'm not married to it.",
        "I like the setup, but I want to stay flexible.",
        "There's enough here to lean, not enough to get stubborn.",
      ],
      seed
    );
  }

  if (score >= 60) {
    return pickSeededVariant(
      [
        "There's something here, but it's not clean.",
        "There's a signal here, but I don't love the shape of it yet.",
        "I can work with this, but it still needs more confirmation.",
      ],
      seed
    );
  }

  return pickSeededVariant(
    [
      "Weak signal, but I don't want to ignore it.",
      "This is thin, but still worth keeping on the board.",
      "It's a light read, not a throwaway read.",
    ],
    seed
  );
}

function isUsableDiscussionSummary(value: string) {
  return value.trim().length > 0 && !isUnavailableSourceSummary(value);
}

function collectDiscussionEvidence(context: AgentDiscussionContext) {
  return [
    isUsableDiscussionSummary(context.researchPacketSummary)
      ? context.researchPacketSummary.split("|")[0]?.trim() ?? null
      : null,
    isUsableDiscussionSummary(context.kalshiSummary)
      ? context.kalshiSummary.split("|")[0]?.trim() ?? null
      : null,
    isUsableDiscussionSummary(context.polymarketSummary)
      ? context.polymarketSummary.split("|")[0]?.trim() ?? null
      : null,
    isUsableDiscussionSummary(context.newsApiSummary)
      ? context.newsApiSummary.split("|")[0]?.trim() ?? null
      : null,
    isUsableDiscussionSummary(context.secEdgarSummary)
      ? context.secEdgarSummary.split("|")[0]?.trim() ?? null
      : null,
  ].filter((item): item is string => Boolean(item));
}

function getSourceConfirmationCount(context: AgentDiscussionContext) {
  return [
    context.researchPacketSummary,
    context.kalshiSummary,
    context.polymarketSummary,
    context.newsApiSummary,
    context.secEdgarSummary,
  ].filter(isUsableDiscussionSummary).length;
}

function hasVerifiedEventCatalyst(context: AgentDiscussionContext) {
  const joined = `${context.secEdgarSummary} ${context.eventRead}`;

  return (
    /(latest|accepted).*(8-K|10-Q|10-K|20-F|6-K)/i.test(joined) &&
    !/no recent|no current|did not return|failed this cycle/i.test(joined)
  );
}

function getSentimentCrowdingBand(score: number) {
  if (score >= 74) {
    return "HIGH";
  }

  if (score >= 60) {
    return "MEDIUM";
  }

  return "LOW";
}

function buildEmptyTradeBias(note = "No directional bias.") {
  return {
    preferredStrategyFamily: null,
    preferredSymbol: null,
    sideBias: "neutral",
    confidenceDelta: 0,
    notionalMultiplier: 1,
    note,
    dataConsumed: [],
  } satisfies DiscussionTradeBias;
}

function mergeDiscussionTradeBias(
  base: DiscussionTradeBias,
  overlay: Partial<DiscussionTradeBias>
) {
  return {
    preferredStrategyFamily:
      overlay.preferredStrategyFamily ?? base.preferredStrategyFamily,
    preferredSymbol: overlay.preferredSymbol ?? base.preferredSymbol,
    sideBias:
      overlay.sideBias && overlay.sideBias !== "neutral"
        ? overlay.sideBias
        : base.sideBias,
    confidenceDelta: clamp(
      base.confidenceDelta + (overlay.confidenceDelta ?? 0),
      -25,
      25
    ),
    notionalMultiplier: clamp(
      base.notionalMultiplier * (overlay.notionalMultiplier ?? 1),
      0.6,
      1.4
    ),
    note: overlay.note ?? base.note,
    dataConsumed: [
      ...base.dataConsumed,
      ...(overlay.dataConsumed ?? []),
    ],
  } satisfies DiscussionTradeBias;
}

function buildResearchDeliveredTradeBiases(
  plan: DeskDiscussionPlan
): DeliveredTradeBias[] {
  return [
    {
      sourceAgentId: "AGT-RESEARCH",
      targetAgentId: "AGT-MACRO-001",
      bias: {
        preferredStrategyFamily: plan.macro.tradeBias.preferredStrategyFamily,
        preferredSymbol: plan.macro.tradeBias.preferredSymbol,
        confidenceDelta: plan.research.confidenceScore >= 76 ? 3 : 1,
        notionalMultiplier: plan.research.confidenceScore >= 76 ? 1.03 : 0.97,
        note: plan.research.influenceNotes["AGT-MACRO-001"],
        dataConsumed: plan.research.dataConsumed,
      },
    },
    {
      sourceAgentId: "AGT-RESEARCH",
      targetAgentId: "AGT-EVENT-001",
      bias: {
        preferredStrategyFamily: plan.event.tradeBias.preferredStrategyFamily,
        preferredSymbol: plan.event.tradeBias.preferredSymbol,
        confidenceDelta: plan.research.confidenceScore >= 76 ? 2 : -1,
        notionalMultiplier:
          plan.research.confidenceScore >= 76 ? 1.02 : 0.94,
        note: plan.research.influenceNotes["AGT-EVENT-001"],
        dataConsumed: plan.research.dataConsumed,
      },
    },
    {
      sourceAgentId: "AGT-RESEARCH",
      targetAgentId: "AGT-SENT-001",
      bias: {
        preferredStrategyFamily:
          plan.sentiment.tradeBias.preferredStrategyFamily,
        preferredSymbol: plan.sentiment.tradeBias.preferredSymbol,
        confidenceDelta: plan.research.confidenceScore >= 76 ? 2 : -1,
        notionalMultiplier:
          plan.research.confidenceScore >= 76 ? 1.01 : 0.95,
        note: plan.research.influenceNotes["AGT-SENT-001"],
        dataConsumed: plan.research.dataConsumed,
      },
    },
  ];
}

function buildMacroDeliveredTradeBiases(
  plan: DeskDiscussionPlan
): DeliveredTradeBias[] {
  return [
    {
      sourceAgentId: "AGT-MACRO-001",
      targetAgentId: "AGT-EVENT-001",
      bias: {
        preferredStrategyFamily: plan.event.tradeBias.preferredStrategyFamily,
        preferredSymbol: plan.event.tradeBias.preferredSymbol,
        confidenceDelta: plan.macro.confidenceScore >= 74 ? 3 : -1,
        notionalMultiplier: /defined-risk/i.test(plan.macro.influenceEffect)
          ? 0.9
          : 1.05,
        note: plan.macro.influenceEffect,
        dataConsumed: plan.macro.dataConsumed,
      },
    },
  ];
}

function buildEventDeliveredTradeBiases(
  plan: DeskDiscussionPlan
): DeliveredTradeBias[] {
  return [
    {
      sourceAgentId: "AGT-EVENT-001",
      targetAgentId: "AGT-SENT-001",
      bias: {
        preferredStrategyFamily:
          plan.sentiment.tradeBias.preferredStrategyFamily,
        preferredSymbol: plan.sentiment.tradeBias.preferredSymbol,
        confidenceDelta: plan.event.confidenceScore >= 74 ? 3 : -2,
        notionalMultiplier: /verified enough/i.test(plan.event.influenceEffect)
          ? 1.03
          : 0.9,
        note: plan.event.influenceEffect,
        dataConsumed: plan.event.dataConsumed,
      },
    },
  ];
}

function buildSentimentDeliveredTradeBiases(
  plan: DeskDiscussionPlan
): DeliveredTradeBias[] {
  return [
    {
      sourceAgentId: "AGT-SENT-001",
      targetAgentId: "AGT-MACRO-001",
      bias: {
        confidenceDelta: plan.sentiment.confidenceScore >= 74 ? 2 : -1,
        notionalMultiplier:
          /trust direct expressions|contained enough/i.test(
            plan.sentiment.influenceEffect
          )
            ? 1.04
            : 0.93,
        sideBias:
          plan.sentiment.tradeBias.sideBias === "neutral"
            ? undefined
            : plan.sentiment.tradeBias.sideBias,
        note: plan.sentiment.influenceEffect,
        dataConsumed: plan.sentiment.dataConsumed,
      },
    },
  ];
}

function buildCioDeliveredTradeBiases(
  plan: DeskDiscussionPlan
): DeliveredTradeBias[] {
  return (Object.entries(plan.cio.adjustments) as Array<
    [TradingAgentId, Pick<DiscussionTradeBias, "confidenceDelta" | "notionalMultiplier" | "note">]
  >).map(([targetAgentId, adjustment]) => ({
    sourceAgentId: "AGT-CIO",
    targetAgentId,
    bias: {
      ...adjustment,
      dataConsumed: [plan.cio.allocationBoundary],
    },
  }));
}

function extractDeliveredTradeBiases(
  payload: Record<string, unknown>
): DeliveredTradeBias[] {
  const raw = payload.deliveredTradeBiases;

  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.flatMap((entry) => {
    if (!entry || typeof entry !== "object") {
      return [];
    }

    const maybeTarget = "targetAgentId" in entry ? entry.targetAgentId : null;
    const maybeBias = "bias" in entry ? entry.bias : null;
    const maybeSource = "sourceAgentId" in entry ? entry.sourceAgentId : null;

    if (
      (maybeTarget !== "AGT-MACRO-001" &&
        maybeTarget !== "AGT-EVENT-001" &&
        maybeTarget !== "AGT-SENT-001") ||
      typeof maybeSource !== "string" ||
      !maybeBias ||
      typeof maybeBias !== "object"
    ) {
      return [];
    }

    return [
      {
        sourceAgentId: maybeSource,
        targetAgentId: maybeTarget,
        bias: maybeBias as Partial<DiscussionTradeBias>,
      },
    ];
  });
}

function deriveDiscussionConsequences(input: {
  plan: DeskDiscussionPlan;
  pendingMessages: PendingPaperRuntimeMessageSeed[];
}) {
  const biasByAgent = {
    "AGT-MACRO-001": input.plan.macro.tradeBias,
    "AGT-EVENT-001": input.plan.event.tradeBias,
    "AGT-SENT-001": input.plan.sentiment.tradeBias,
  } satisfies DeskDiscussionPlan["biasByAgent"];

  for (const message of input.pendingMessages) {
    const deliveredTradeBiases = extractDeliveredTradeBiases(message.payload);

    for (const delivered of deliveredTradeBiases) {
      biasByAgent[delivered.targetAgentId] = mergeDiscussionTradeBias(
        biasByAgent[delivered.targetAgentId],
        delivered.bias
      );
    }
  }

  return biasByAgent;
}

function getMacroPreferredStrategy(
  context: AgentDiscussionContext,
  session: RuntimeSessionSnapshot,
  regime: (typeof REGIMES)[number]
) {
  if (/credit/i.test(context.researchArea)) {
    return "credit_relative_value_probe";
  }

  if (/sector|breadth/i.test(context.researchArea)) {
    return "macro_equity_rotation";
  }

  if (/margin/i.test(context.researchArea)) {
    return "alternative_asset_proxy_probe";
  }

  if (/earnings/i.test(context.researchArea) && supportsOptionsRouting(session)) {
    return regime === "RISK_OFF" || regime === "HIGH_VOL"
      ? "macro_put_spread"
      : "macro_call_spread";
  }

  if (regime === "RISK_OFF" || regime === "HIGH_VOL") {
    return "commodity_macro_probe";
  }

  return "macro_equity_rotation";
}

function getMacroPreferredSymbol(
  strategyFamily: string,
  regime: (typeof REGIMES)[number]
) {
  switch (strategyFamily) {
    case "credit_relative_value_probe":
      return regime === "RISK_OFF" || regime === "HIGH_VOL" ? "TLT" : "HYG";
    case "commodity_macro_probe":
      return regime === "RISK_OFF" || regime === "HIGH_VOL" ? "GLD" : "USO";
    case "alternative_asset_proxy_probe":
      return regime === "RISK_OFF" ? "VNQ" : "IBIT";
    case "macro_call_spread":
    case "macro_put_spread":
      return regime === "LOW_VOL" ? "SPY" : "QQQ";
    default:
      return regime === "LOW_VOL" ? "SPY" : "QQQ";
  }
}

function normalizeStrategyForSession(
  preferredStrategyFamily: string | null,
  session: RuntimeSessionSnapshot,
  fallback: string
) {
  if (!preferredStrategyFamily) {
    return fallback;
  }

  if (
    !supportsOptionsRouting(session) &&
    [
      "macro_call_spread",
      "macro_put_spread",
      "earnings_straddle",
      "event_call_probe",
      "event_put_probe",
      "sentiment_call_probe",
      "sentiment_put_probe",
    ].includes(preferredStrategyFamily)
  ) {
    if (preferredStrategyFamily.startsWith("macro_")) {
      return "macro_equity_rotation";
    }

    if (preferredStrategyFamily.startsWith("event_") || preferredStrategyFamily === "earnings_straddle") {
      return "verified_catalyst_equity";
    }

    return "sentiment_equity_probe";
  }

  return preferredStrategyFamily;
}

function buildDeskDiscussionPlan(input: {
  context: AgentDiscussionContext;
  session: RuntimeSessionSnapshot;
  regime: (typeof REGIMES)[number];
}): DeskDiscussionPlan {
  const { context, session, regime } = input;
  const sourceConfirmationCount = getSourceConfirmationCount(context);
  const eventVerified = hasVerifiedEventCatalyst(context);
  const crowdingBand = getSentimentCrowdingBand(context.sentimentScore);
  const leadingEvidence = collectDiscussionEvidence(context).slice(0, 2);
  const evidenceSummary =
    leadingEvidence.length > 0
      ? formatDeskList(leadingEvidence)
      : "the available cross-source evidence";

  const macroStrategy = getMacroPreferredStrategy(context, session, regime);
  const macroPreferredSymbol = getMacroPreferredSymbol(macroStrategy, regime);
  const macroRiskHeavy =
    regime === "RISK_OFF" ||
    regime === "HIGH_VOL" ||
    macroStrategy === "credit_relative_value_probe" ||
    macroStrategy === "macro_put_spread";

  const research = {
    observation: `The desk keeps coming back to ${context.researchArea}, and ${evidenceSummary} are doing most of the explanatory work.`,
    whyItMatters:
      sourceConfirmationCount >= 3
        ? "This is the one thread broad enough to inform macro sizing, catalyst framing, and narrative risk at the same time."
        : "The evidence base is thinner than I want, so the desk should stay adaptive and keep sizing honest.",
    changeMind:
      sourceConfirmationCount >= 3
        ? "If the source alignment breaks on the next refresh, I'd stop treating this as the desk's shared thread."
        : "If the source picture firms up, I'd be more willing to let the sleeves lean into it.",
    confidenceScore: clamp(60 + sourceConfirmationCount * 6, 60, 88),
    tradeBias: buildEmptyTradeBias("Research is shaping sleeve behavior rather than placing orders."),
    dataConsumed: [
      context.researchArea,
      ...context.researchDataConsumed,
      ...leadingEvidence,
    ],
    influenceNotes: {
      "AGT-MACRO-001": `Use ${context.researchArea} as the macro framing variable and prefer ${macroStrategy.replace(/_/g, " ")} while the evidence holds.`,
      "AGT-EVENT-001": eventVerified
        ? `The filing backdrop for ${context.eventTicker} is real enough that catalyst structures can matter.`
        : `Treat ${context.eventTicker} as a draft catalyst idea, not a fully verified one.`,
      "AGT-SENT-001":
        crowdingBand === "HIGH"
          ? `Narrative heat is elevated, so express it with defined risk or spillover probes instead of blind stock chasing.`
          : `Narrative conditions are usable, but only if price and catalyst context keep confirming it.`,
    },
  } satisfies DeskDiscussionPlan["research"];

  const macro = {
    observation:
      macroRiskHeavy
        ? `I'm reading the macro side as hostile enough that the sleeve should favor ${macroStrategy.replace(/_/g, " ")} over easy beta.`
        : `Macro is clean enough to let the sleeve express the view through ${macroStrategy.replace(/_/g, " ")} instead of hiding in cash.`,
    whyItMatters: context.macroRead,
    changeMind:
      macroRiskHeavy
        ? "If financing pressure and cross-asset stress back off, I'd loosen the sleeve back toward more direct risk."
        : "If cross-asset confirmation breaks, I'd stop treating the macro view as clean enough for direct expression.",
    confidenceScore: clamp(64 + sourceConfirmationCount * 4 + (macroRiskHeavy ? 4 : 0), 62, 86),
    tradeBias: {
      preferredStrategyFamily: macroStrategy,
      preferredSymbol: macroPreferredSymbol,
      sideBias:
        regime === "BULL_TREND" || regime === "RISK_ON" || regime === "LOW_VOL"
          ? "buy"
          : regime === "RISK_OFF" || regime === "HIGH_VOL"
            ? "sell"
            : "neutral",
      confidenceDelta: sourceConfirmationCount >= 3 ? 5 : -3,
      notionalMultiplier:
        sourceConfirmationCount >= 3 ? (macroRiskHeavy ? 0.96 : 1.08) : 0.88,
      note:
        research.influenceNotes["AGT-MACRO-001"],
      dataConsumed: [
        context.macroRead,
        ...research.dataConsumed,
      ],
    },
    dataConsumed: [context.macroRead, ...research.dataConsumed],
    influenceTargetId: "AGT-EVENT-001",
    influenceEffect: macroRiskHeavy
      ? `Keep ${context.eventTicker} defined-risk until the macro tape stops fighting the catalyst.`
      : `Macro pressure is mild enough that ${context.eventTicker} can carry more directional risk if the catalyst is real.`,
  } satisfies DeskDiscussionPlan["macro"];

  const eventDirectionalBullish =
    context.sentimentScore >= 60 &&
    (regime === "BULL_TREND" || regime === "RISK_ON" || regime === "LOW_VOL");
  const eventStrategy = eventVerified
    ? macroRiskHeavy || sourceConfirmationCount < 3
      ? "earnings_straddle"
      : eventDirectionalBullish && supportsOptionsRouting(session)
        ? "event_call_probe"
        : !eventDirectionalBullish && supportsOptionsRouting(session)
          ? "event_put_probe"
          : "verified_catalyst_equity"
    : supportsOptionsRouting(session)
      ? eventDirectionalBullish
        ? "event_call_probe"
        : "event_put_probe"
      : "verified_catalyst_equity";

  const event = {
    observation: eventVerified
      ? `${context.eventTicker} actually has enough filing/calendar support that the catalyst sleeve should publish the setup, not just talk about it.`
      : `${context.eventTicker} is still more of a live hypothesis than a locked catalyst, so the sleeve should stay more exploratory.`,
    whyItMatters: context.eventRead,
    changeMind: eventVerified
      ? "If the filing backdrop gets contradicted or the event setup gets crowded, I'd cut the directional confidence quickly."
      : "If the filing or calendar evidence firms up, I'd upgrade the setup from exploratory to assertive fast.",
    confidenceScore: clamp(58 + sourceConfirmationCount * 4 + (eventVerified ? 10 : 0), 56, 87),
    tradeBias: {
      preferredStrategyFamily: eventStrategy,
      preferredSymbol: context.eventTicker,
      sideBias:
        eventStrategy === "event_put_probe"
          ? "sell"
          : eventStrategy === "event_call_probe" || eventStrategy === "verified_catalyst_equity"
            ? "buy"
            : "neutral",
      confidenceDelta: eventVerified ? 7 : -4,
      notionalMultiplier:
        eventVerified ? (macroRiskHeavy && eventStrategy !== "earnings_straddle" ? 0.9 : 1.06) : 0.82,
      note:
        eventVerified
          ? `Macro handed the sleeve a real catalyst lane in ${context.eventTicker}, but the structure should respect the macro backdrop.`
          : `Macro and research both say ${context.eventTicker} still needs cleaner verification, so keep the expression experimental.`,
      dataConsumed: [
        context.eventRead,
        context.secEdgarSummary,
        ...macro.dataConsumed,
      ],
    },
    dataConsumed: [context.eventRead, context.secEdgarSummary, ...macro.dataConsumed],
    influenceTargetId: "AGT-SENT-001",
    influenceEffect: eventVerified
      ? `${context.eventTicker} is verified enough that narrative can add conviction, but it shouldn't replace the catalyst work.`
      : `Don't let narrative alone upgrade ${context.eventTicker} until the catalyst is actually verified.`,
  } satisfies DeskDiscussionPlan["event"];

  const sentimentBullish = context.sentimentScore >= 60;
  const sentimentStrategy =
    crowdingBand === "HIGH" && supportsOptionsRouting(session)
      ? sentimentBullish
        ? "sentiment_call_probe"
        : "sentiment_put_probe"
      : !eventVerified && context.sentimentTicker === context.eventTicker
        ? "alternative_narrative_probe"
        : context.sentimentScore < 55
          ? "cross_asset_sentiment_probe"
          : "sentiment_equity_probe";

  const sentiment = {
    observation:
      crowdingBand === "HIGH"
        ? `Narrative pressure is hot enough that the sentiment sleeve should prefer convexity or spillover instead of pretending the move is clean spot beta.`
        : `Narrative pressure is active but still usable, so the sentiment sleeve can publish it as long as price keeps confirming it.`,
    whyItMatters: context.sentimentRead,
    changeMind:
      crowdingBand === "HIGH"
        ? "If the crowding cools without follow-through, I'd stop paying for convexity and back off the spillover story."
        : "If price stops following the narrative, I'd downgrade the sleeve from conviction to monitoring.",
    confidenceScore: clamp(55 + Math.round(context.sentimentScore / 4) + sourceConfirmationCount * 2, 54, 86),
    tradeBias: {
      preferredStrategyFamily: sentimentStrategy,
      preferredSymbol: context.sentimentTicker,
      sideBias: sentimentBullish ? "buy" : "sell",
      confidenceDelta:
        crowdingBand === "HIGH" ? 4 : eventVerified ? 3 : -2,
      notionalMultiplier:
        crowdingBand === "HIGH"
          ? 0.94
          : eventVerified
            ? 1.05
            : 0.9,
      note:
        event.influenceEffect,
      dataConsumed: [
        context.sentimentRead,
        context.newsApiSummary,
        context.polymarketSummary,
        ...event.dataConsumed,
      ],
    },
    dataConsumed: [
      context.sentimentRead,
      context.newsApiSummary,
      context.polymarketSummary,
      ...event.dataConsumed,
    ],
    influenceTargetId: "AGT-MACRO-001",
    influenceEffect:
      crowdingBand === "HIGH"
        ? "Narrative crowding is high, so the macro sleeve should prefer defined-risk or defensive structures over lazy beta."
        : "Narrative pressure is contained enough that macro can trust direct expressions a little more.",
  } satisfies DeskDiscussionPlan["sentiment"];

  const alignedBuyCount = [
    macro.tradeBias.sideBias,
    event.tradeBias.sideBias,
    sentiment.tradeBias.sideBias,
  ].filter((side) => side === "buy").length;
  const alignedSellCount = [
    macro.tradeBias.sideBias,
    event.tradeBias.sideBias,
    sentiment.tradeBias.sideBias,
  ].filter((side) => side === "sell").length;
  const deskAgreement = Math.max(alignedBuyCount, alignedSellCount);
  const deskTightening =
    sourceConfirmationCount <= 1 ? 0.88 : deskAgreement >= 2 ? 1.06 : 0.97;
  const cioConfidenceDelta = deskAgreement >= 2 ? 2 : sourceConfirmationCount <= 1 ? -3 : -1;

  const cio = {
    observation:
      deskAgreement >= 2
        ? "The desk is aligned enough that I can let sleeves lean a bit, but only inside clear boundaries."
        : "The desk is mixed enough that I want the sleeves adaptive, not stubborn.",
    whyItMatters:
      deskAgreement >= 2
        ? "The research, catalyst, and sentiment reads overlap enough that the loop should express views rather than just admire them."
        : "The overlap is partial, so the right move is to keep experimentation alive without pretending the desk is unanimous.",
    changeMind:
      deskAgreement >= 2
        ? "If that overlap breaks on the next refresh, I would tighten the sleeves before I cut the loop."
        : "If the desk converges on the next pass, I would let the strongest sleeves carry more size.",
    confidenceScore: clamp(66 + sourceConfirmationCount * 4 + deskAgreement * 3, 64, 89),
    allocationBoundary:
      deskAgreement >= 2
        ? "Let the sleeves express the shared read, but keep it sleeve-level and autonomous."
        : "Keep the sleeves experimental until the overlap is real, not theatrical.",
    adjustments: {
      "AGT-MACRO-001": {
        confidenceDelta: cioConfidenceDelta,
        notionalMultiplier: deskTightening,
        note: deskAgreement >= 2
          ? "research lead is giving macro a little more room because the desk overlap is real."
          : "research lead wants macro sized as an experiment, not a declaration.",
      },
      "AGT-EVENT-001": {
        confidenceDelta: cioConfidenceDelta + (eventVerified ? 1 : -1),
        notionalMultiplier: deskTightening * (eventVerified ? 1.02 : 0.92),
        note: eventVerified
          ? "research lead is willing to fund the catalyst sleeve a bit more because the event is real."
          : "research lead wants the catalyst sleeve smaller until verification improves.",
      },
      "AGT-SENT-001": {
        confidenceDelta: cioConfidenceDelta + (crowdingBand === "HIGH" ? -1 : 1),
        notionalMultiplier: deskTightening * (crowdingBand === "HIGH" ? 0.95 : 1.01),
        note:
          crowdingBand === "HIGH"
            ? "research lead wants the sentiment sleeve expressive but a little tighter because crowding is high."
            : "research lead is comfortable letting the sentiment sleeve test its read with normal research-event weight.",
      },
    },
  } satisfies DeskDiscussionPlan["cio"];

  const biasByAgent = {
    "AGT-MACRO-001": mergeDiscussionTradeBias(macro.tradeBias, cio.adjustments["AGT-MACRO-001"]),
    "AGT-EVENT-001": mergeDiscussionTradeBias(event.tradeBias, cio.adjustments["AGT-EVENT-001"]),
    "AGT-SENT-001": mergeDiscussionTradeBias(sentiment.tradeBias, cio.adjustments["AGT-SENT-001"]),
  } satisfies DeskDiscussionPlan["biasByAgent"];

  return {
    research,
    macro,
    event,
    sentiment,
    cio,
    biasByAgent,
  };
}

function buildDependencyObservation(
  degradedLabels: string[],
  seed: number | string
) {
  if (degradedLabels.length === 1) {
    return pickSeededVariant(
      [
        `${degradedLabels[0]} is unavailable this pass, but the desk can still continue with the remaining live sources.`,
        `${degradedLabels[0]} did not deliver usable data on this refresh, but it does not have to stop the desk.`,
        `${degradedLabels[0]} is degraded this cycle, but it is not enough to freeze the loop.`,
      ],
      seed
    );
  }

  return pickSeededVariant(
    [
      `${formatDeskList(degradedLabels)} are unavailable this pass, but the desk can still continue with the remaining live sources.`,
      `${formatDeskList(degradedLabels)} did not deliver usable data on this refresh, but the rest of the desk can still move.`,
      `${formatDeskList(degradedLabels)} are degraded this cycle, but it is not enough to freeze the loop.`,
    ],
    seed
  );
}

function buildDependencyWhyItMatters(
  healthyLabels: string[],
  seed: number | string
) {
  if (healthyLabels.length > 0) {
    return pickSeededVariant(
      [
        `I'm leaning more on ${formatDeskList(healthyLabels)} until it clears.`,
        `Until the next refresh, ${formatDeskList(healthyLabels)} are carrying more of the confirmation load.`,
        `For now, ${formatDeskList(healthyLabels)} are doing more of the heavy lifting for the desk.`,
      ],
      seed
    );
  }

  return pickSeededVariant(
    [
      "No external provider returned usable live evidence this cycle.",
      "This pass is running without external provider confirmation.",
      "The desk has to wait for the next refresh before it gets fresh provider evidence.",
    ],
    seed
  );
}

function buildOvernightFocusObservation(
  researchArea: string,
  seed: number | string
) {
  return pickSeededVariant(
    [
      `${researchArea} is the one thing I keep coming back to tonight.`,
      `If I carry one thread into the morning, it's still ${researchArea}.`,
      `${researchArea} keeps floating back to the top of the overnight stack for me.`,
    ],
    seed
  );
}

function buildOvernightFocusWhyItMatters(
  researchArea: string,
  seed: number | string
) {
  return pickSeededVariant(
    [
      `${researchArea} is still the cleanest thing on the board for how the desk should come in tomorrow.`,
      "This is still the piece most likely to change the first draft of the morning plan.",
      `${researchArea} is doing more explanatory work than the rest of the board right now.`,
    ],
    seed
  );
}

function buildOvernightFocusChangeMind(seed: number | string) {
  return pickSeededVariant(
    [
      "If the overnight move fades or breadth repairs before the open, I'd soften that view.",
      "If the cross-source confirmation looks weaker by the morning, I'd downshift it quickly.",
      "If the tape cleans up in the other direction before the open, I'd stop leaning on it.",
    ],
    seed
  );
}

function buildLiveResearchObservation(
  researchArea: string,
  regime: string,
  seed: number | string
) {
  return pickSeededVariant(
    [
      `${researchArea} is the thing widening fastest in the live tape, and the regime read is ${regime}.`,
      `The live tape keeps making ${researchArea} more important, and the regime still reads ${regime}.`,
      `${researchArea} is the live thread I care about most right now, with the regime still reading ${regime}.`,
    ],
    seed
  );
}

async function renderPendingMessages(messages: PendingPaperRuntimeMessageSeed[]) {
  const contents = await renderAgentVoiceBatch(
    messages.map((message) => message.voiceDraft)
  );

  const renderedMessages: PaperRuntimeMessageSeed[] = messages.map(
    (message, index) => {
      const renderedMessage = {
        ...message,
        content: contents[index],
      } as PendingPaperRuntimeMessageSeed & { content: string };

      delete (renderedMessage as { voiceDraft?: AgentMessageVoiceDraft }).voiceDraft;

      return renderedMessage;
    }
  );

  return renderedMessages;
}

async function renderVoiceDraft(draft: AgentMessageVoiceDraft) {
  const [content] = await renderAgentVoiceBatch([draft]);
  return content;
}

function asPendingMessageArray(
  value:
    | PendingPaperRuntimeMessageSeed
    | PendingPaperRuntimeMessageSeed[]
    | null
    | undefined
) {
  if (!value) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function getDeskAgentRole(agentId: string) {
  switch (agentId) {
    case "AGT-RESEARCH":
      return "Research Analyst";
    case "AGT-CIO":
      return "Chief Research Officer";
    case "AGT-QR-001":
      return "Quantitative Researcher";
    case "AGT-EXEC-001":
      return "Algorithm Developer";
    default:
      return isConfiguredTradingAgentId(agentId)
        ? getTradingAgentRole(agentId)
        : agentId;
  }
}

function getBlackboardDataConsumed(
  blackboard: AutonomousAgentBlackboard,
  upstreamAgentIds: string[]
) {
  return upstreamAgentIds
    .filter((agentId) =>
      blackboard.messages.some((message) => message.senderId === agentId)
    )
    .map((agentId) => `blackboard:${agentId}`);
}

function withAutonomousBlackboardPayload(
  blackboard: AutonomousAgentBlackboard,
  upstreamAgentIds: string[]
) {
  return {
    ...blackboard.basePayload,
    collaborationModel: "autonomous_blackboard_turns",
    upstreamAgentIds: upstreamAgentIds.filter((agentId) =>
      blackboard.messages.some((message) => message.senderId === agentId)
    ),
  };
}

function createAutonomousTurnFailureMessage(input: {
  cycleId: number;
  session: RuntimeSessionSnapshot;
  regime: (typeof REGIMES)[number];
  agentId: string;
  turnId: string;
  errorMessage: string;
  basePayload: Record<string, unknown>;
}): PendingPaperRuntimeMessageSeed {
  const role = getDeskAgentRole(input.agentId);

  return {
    senderId: input.agentId,
    messageType: "SYSTEM_STATUS",
    priority: "HIGH",
    renderType: "alert",
    voiceDraft: {
      id: createVoiceDraftId(
        input.cycleId,
        "autonomous-turn-failure",
        input.agentId,
        input.turnId
      ),
      senderId: input.agentId,
      senderRole: role,
      messageType: "SYSTEM_STATUS",
      priority: "HIGH",
      observation: "Something broke on my side and I couldn't finish the pass.",
      whyItMatters: `The rest of the desk should keep moving without this turn: ${input.errorMessage}`,
      conviction: getConfidencePhrase(94),
      changeMind:
        "If the next cycle runs clean, treat this as a one-pass operational miss rather than a thesis change.",
      facts: {
        phase: input.session.phase,
        regime: input.regime,
        turnId: input.turnId,
        error: input.errorMessage,
      },
    },
    reasoning:
      "Each agent turn owns its own failures and reports them onto the bus instead of blocking the shared runtime.",
    payload: {
      ...input.basePayload,
      collaborationModel: "autonomous_blackboard_turns",
      degradedAgentId: input.agentId,
      failedTurnId: input.turnId,
      error: input.errorMessage,
    },
    decision: {
      agentId: input.agentId,
      actionTaken: "record_autonomous_turn_failure",
      reasoning:
        "Agent turn failures should be visible to the desk while preserving the rest of the cycle.",
      dataConsumed: [`turn:${input.turnId}`, input.errorMessage],
      confidenceScore: 94,
    },
  };
}

async function runAutonomousAgentTurnsDetailed(input: {
  cycleId: number;
  session: RuntimeSessionSnapshot;
  regime: (typeof REGIMES)[number];
  context: AgentDiscussionContext;
  basePayload: Record<string, unknown>;
  turns: AutonomousAgentTurn[];
}): Promise<AutonomousAgentTurnRunResult> {
  const activeConversationAgentIds = new Set(
    getConversationActiveAgentIds(input.session)
  );
  const blackboard: AutonomousAgentBlackboard = {
    cycleId: input.cycleId,
    session: input.session,
    regime: input.regime,
    context: input.context,
    basePayload: input.basePayload,
    messages: [],
  };
  const renderedMessages: PaperRuntimeMessageSeed[] = [];
  const pendingMessages: PendingPaperRuntimeMessageSeed[] = [];

  for (const turn of input.turns) {
    if (!activeConversationAgentIds.has(turn.agentId)) {
      continue;
    }

    try {
      const produced = asPendingMessageArray(
        await turn.run({
          ...blackboard,
          messages: [...blackboard.messages],
        })
      );
      const rendered = await renderPendingMessages(produced);
      pendingMessages.push(...produced);
      blackboard.messages.push(...produced);
      renderedMessages.push(...rendered);
    } catch (error) {
      const failureMessage = createAutonomousTurnFailureMessage({
        cycleId: input.cycleId,
        session: input.session,
        regime: input.regime,
        agentId: turn.agentId,
        turnId: turn.id,
        errorMessage:
          error instanceof Error
            ? error.message
            : "Autonomous agent turn failed unexpectedly.",
        basePayload: input.basePayload,
      });
      const [renderedFailure] = await renderPendingMessages([failureMessage]);
      pendingMessages.push(failureMessage);
      blackboard.messages.push(failureMessage);
      renderedMessages.push(renderedFailure);
    }
  }

  return {
    renderedMessages,
    pendingMessages,
  };
}

function withVoiceDraftFacts(
  draft: AgentMessageVoiceDraft,
  facts: Record<string, unknown>
) {
  if (draft.kind === "freeform") {
    return {
      ...draft,
      context: {
        ...draft.context,
        additionalFacts: {
          ...facts,
        },
      },
    } satisfies AgentMessageVoiceDraft;
  }

  return {
    ...draft,
    facts: {
      ...(draft.facts ?? {}),
      ...facts,
    },
  } satisfies AgentMessageVoiceDraft;
}

function getTradingAgentRole(agentId: TradingAgentId | RuntimeTradingAgentId) {
  return getConfiguredTradingAgentRole(agentId as RuntimeTradingAgentId);
}

function getConversationActiveAgentIds(session: RuntimeSessionSnapshot) {
  const activeAgentIds = Array.from(new Set(session.activeAgentIds));

  if (session.phase === "NON_TRADING_DAY") {
    return ["AGT-CIO"];
  }

  if (session.phase !== "OVERNIGHT") {
    return activeAgentIds;
  }

  return activeAgentIds.filter((agentId) => isCoreDeskAgentId(agentId));
}

function buildWakeAdjustedRuntimeSession(input: {
  session: RuntimeSessionSnapshot;
  pendingResponseRequests: PendingAgentResponseRequest[];
}) {
  if (input.session.phase === "NON_TRADING_DAY") {
    const queuedRequestsNote =
      input.pendingResponseRequests.length > 0
        ? ` ${input.pendingResponseRequests.length} open desk request${
            input.pendingResponseRequests.length === 1 ? " remains" : "s remain"
          } queued until the next staffed session.`
        : "";

    return {
      ...input.session,
      wokenAgentIds: [],
      pendingResponseRequests: input.pendingResponseRequests,
      note: `${input.session.note}${queuedRequestsNote}`.trim(),
    } satisfies RuntimeSessionSnapshot;
  }

  const knownAgentIds = Array.from(
    new Set([
      ...input.session.activeAgentIds,
      ...input.session.sleepingAgentIds,
    ])
  );
  const wakeableAgentIds = new Set(
    input.session.tradingAgentsEnabled
      ? knownAgentIds
      : knownAgentIds.filter((agentId) => isCoreDeskAgentId(agentId))
  );

  const activeAgentIds = [...input.session.activeAgentIds];
  const activeAgentIdSet = new Set(activeAgentIds);
  const wokenAgentIds: string[] = [];
  let queuedSleepingTradingRequests = 0;

  for (const request of input.pendingResponseRequests) {
    let requestNeedsSleepingTrader = false;

    for (const agentId of [request.senderId, request.recipientId]) {
      if (!knownAgentIds.includes(agentId) || activeAgentIdSet.has(agentId)) {
        continue;
      }

      if (!wakeableAgentIds.has(agentId)) {
        requestNeedsSleepingTrader = true;
        continue;
      }

      activeAgentIds.push(agentId);
      activeAgentIdSet.add(agentId);
      wokenAgentIds.push(agentId);
    }

    if (requestNeedsSleepingTrader) {
      queuedSleepingTradingRequests += 1;
    }
  }

  if (wokenAgentIds.length === 0) {
    return {
      ...input.session,
      wokenAgentIds: [],
      pendingResponseRequests: input.pendingResponseRequests,
      note:
        queuedSleepingTradingRequests > 0
          ? `${input.session.note} ${queuedSleepingTradingRequests} research-sleeve request${
              queuedSleepingTradingRequests === 1 ? " remains" : "s remain"
            } queued until the next research-sleeve session.`
          : input.session.note,
    } satisfies RuntimeSessionSnapshot;
  }

  const wokeTradingSleeve = activeAgentIds.some(
    (agentId) => !isCoreDeskAgentId(agentId)
  );
  const wakeSummary = `${wokenAgentIds.join(", ")} ${
    wokenAgentIds.length === 1 ? "woke" : "woke"
  } to address ${input.pendingResponseRequests.length} open desk request${
    input.pendingResponseRequests.length === 1 ? "" : "s"
  }.`;

  return {
    ...input.session,
    activeAgentIds,
    sleepingAgentIds: knownAgentIds.filter(
      (agentId) => !activeAgentIdSet.has(agentId)
    ),
    wokenAgentIds,
    pendingResponseRequests: input.pendingResponseRequests,
    tradingAgentsEnabled:
      input.session.tradingAgentsEnabled || wokeTradingSleeve,
    note: `${input.session.note} ${wakeSummary}${
      queuedSleepingTradingRequests > 0
        ? ` ${queuedSleepingTradingRequests} research-sleeve request${
            queuedSleepingTradingRequests === 1 ? " remains" : "s remain"
          } queued until the next research-sleeve session.`
        : ""
    }`.trim(),
  } satisfies RuntimeSessionSnapshot;
}

export async function getEffectiveRuntimeSession(now = new Date()) {
  const session = getRuntimeSession(now);

  if (isAgentSwarmDecommissioned()) {
    return session;
  }

  const pendingResponseRequests = await getPendingAgentResponseRequests(
    session.phase === "OVERNIGHT" || session.phase === "NON_TRADING_DAY" ? 16 : 10,
    session.phase === "NON_TRADING_DAY" ? 48 : 12
  );

  return buildWakeAdjustedRuntimeSession({
    session,
    pendingResponseRequests,
  });
}

function summarizeConversationSession(session: RuntimeSessionSnapshot) {
  const activeAgents = session.activeAgentIds.map((agentId) => ({
    agentId,
    role: getDeskAgentRole(agentId),
  }));

  const tradingWindow = session.orderExecutionEnabled
    ? "Research events can be published in this session."
    : "Markets are closed for this session and research-event publication is paused.";
  const staffing = session.tradingAgentsEnabled
    ? "Core desk specialists and research sleeves are all live in this session."
    : session.activeAgentIds.some((agentId) => isCoreDeskAgentId(agentId))
      ? "Research, quant research, execution, and allocation work are live, but research sleeves are offline."
      : "The desk is offline until the next staffed session.";

  return {
    phase: session.label,
    marketStatus: session.marketStatus,
    timeWindowEt: session.windowEt,
    timeWindowPt: session.windowPt,
    tradingWindow,
    staffing,
    activeAgents,
    sleepingAgents: session.sleepingAgentIds.map((agentId) => ({
      agentId,
      role: getDeskAgentRole(agentId),
    })),
    wokenAgents: session.wokenAgentIds.map((agentId) => ({
      agentId,
      role: getDeskAgentRole(agentId),
    })),
    pendingDirectedRequests: session.pendingResponseRequests.map((request) => ({
      messageId: request.messageId,
      senderId: request.senderId,
      senderRole: getDeskAgentRole(request.senderId),
      recipientId: request.recipientId,
      recipientRole: getDeskAgentRole(request.recipientId),
      messageType: request.messageType,
      priority: request.priority,
      content: request.content,
      createdAt: request.createdAt,
    })),
  };
}

function summarizeConversationBrokerState(brokerState: BrokerSyncState | null) {
  if (!brokerState) {
    return null;
  }

  return {
    account: {
      portfolioValue: brokerState.account.portfolioValue,
      buyingPower: brokerState.account.buyingPower,
      cash: brokerState.account.cash,
      equity: brokerState.account.equity,
    },
    positions: brokerState.positions.slice(0, 10).map((position) => ({
      symbol: position.symbol,
      side: position.side,
      qty: position.qty,
      marketValue: position.marketValue,
      unrealizedPl: position.unrealizedPl,
      currentPrice: position.currentPrice,
      assetClass: position.assetClass,
    })),
    recentOrders: brokerState.recentOrders.slice(0, 8).map((order) => ({
      symbol: order.symbol,
      side: order.side,
      qty: order.qty,
      notional: order.notional,
      status: order.status,
      assetClass: order.assetClass,
      submittedAt: order.submittedAt,
      updatedAt: order.updatedAt,
    })),
  };
}

function getConversationDecisionSnapshot(
  input: {
    researchDecision: ResearchAgentDecision;
    traderDecisions: Record<RuntimeTradingAgentId, TraderAgentDecision>;
    cioDecision: CioAgentDecision;
  },
  agentId: string
) {
  switch (agentId) {
    case "AGT-RESEARCH":
      return {
        confidenceScore: input.researchDecision.confidenceScore,
        dataConsumed: input.researchDecision.dataConsumed,
      };
    case "AGT-CIO":
      return {
        confidenceScore: input.cioDecision.confidenceScore,
        dataConsumed: input.cioDecision.dataConsumed,
      };
    default:
      if (isConfiguredTradingAgentId(agentId)) {
        return {
          confidenceScore: input.traderDecisions[agentId].confidenceScore,
          dataConsumed: input.traderDecisions[agentId].dataConsumed,
        };
      }

      return {
        confidenceScore: 70,
        dataConsumed: [] as unknown[],
      };
  }
}

function getDiscussionBackfillDecisionSnapshot(input: {
  agentId: string;
  context: AgentDiscussionContext;
  plan: DeskDiscussionPlan;
  dependencyStatuses: ResearchDependencyStatus[];
  watchOnly: boolean;
}) {
  const dependencyData = input.dependencyStatuses.map(
    (status) => `${status.sourceId}:${status.error ?? status.summary}`
  );
  const baseDataConsumed = Array.from(
    new Set([
      ...input.context.researchDataConsumed,
      ...dependencyData,
      ...(input.watchOnly ? ["watch_only_discussion"] : []),
    ])
  );

  switch (input.agentId) {
    case "AGT-RESEARCH":
      return {
        confidenceScore: input.plan.research.confidenceScore,
        dataConsumed: Array.from(
          new Set([...baseDataConsumed, ...input.plan.research.dataConsumed])
        ),
      };
    case "AGT-MACRO-001":
      return {
        confidenceScore: input.plan.macro.confidenceScore,
        dataConsumed: Array.from(
          new Set([...baseDataConsumed, ...input.plan.macro.dataConsumed])
        ),
      };
    case "AGT-EVENT-001":
      return {
        confidenceScore: input.plan.event.confidenceScore,
        dataConsumed: Array.from(
          new Set([...baseDataConsumed, ...input.plan.event.dataConsumed])
        ),
      };
    case "AGT-SENT-001":
      return {
        confidenceScore: input.plan.sentiment.confidenceScore,
        dataConsumed: Array.from(
          new Set([...baseDataConsumed, ...input.plan.sentiment.dataConsumed])
        ),
      };
    case "AGT-CIO":
      return {
        confidenceScore: input.plan.cio.confidenceScore,
        dataConsumed: Array.from(
          new Set([
            ...baseDataConsumed,
            "cio_watch_mode_context",
            input.plan.cio.allocationBoundary,
          ])
        ),
      };
    default:
      return {
        confidenceScore: 70,
        dataConsumed: baseDataConsumed,
      };
  }
}

function getAutonomousConversationActionTaken(messageType: string) {
  switch (messageType) {
    case "RESEARCH_REPORT":
      return "publish_autonomous_research_message";
    case "ALLOCATION_CHANGE":
      return "publish_autonomous_allocation_comment";
    case "RISK_ALERT":
      return "publish_autonomous_risk_alert";
    default:
      return "publish_autonomous_discussion_message";
  }
}

function buildTradeOrderVoiceDraft(input: {
  cycleIndex: number;
  agentId: TradingAgentId | RuntimeTradingAgentId;
  symbol: string;
  displaySymbol?: string;
  side: AlpacaOrderSide;
  notional: number;
  strategyFamily: string;
  regime: string;
  confidenceScore: number;
  observation: string;
  whyItMatters: string;
  changeMind: string;
  facts?: Record<string, unknown>;
}) {
  return {
    id: createVoiceDraftId(
      input.cycleIndex,
      "research-event",
      input.agentId,
      input.strategyFamily,
      input.symbol
    ),
    senderId: input.agentId,
    senderRole: getTradingAgentRole(input.agentId),
    messageType: "TRADE_ORDER",
    priority: "HIGH",
    observation: input.observation,
    whyItMatters: input.whyItMatters,
    conviction: getConfidencePhrase(input.confidenceScore),
    changeMind: input.changeMind,
    facts: {
      symbol: input.symbol,
      displaySymbol: input.displaySymbol ?? input.symbol,
      side: input.side,
      notionalUsd: input.notional,
      strategyFamily: input.strategyFamily,
      regime: input.regime,
      ...(input.facts ?? {}),
    },
  } satisfies AgentMessageVoiceDraft;
}

const CIO_REGIME_FIT: Record<
  (typeof REGIMES)[number],
  Record<"Macro" | "Event-Driven" | "Sentiment", number>
> = {
  BULL_TREND: {
    Macro: 0.86,
    "Event-Driven": 0.76,
    Sentiment: 0.88,
  },
  HIGH_VOL: {
    Macro: 0.8,
    "Event-Driven": 0.67,
    Sentiment: 0.61,
  },
  RISK_ON: {
    Macro: 0.9,
    "Event-Driven": 0.79,
    Sentiment: 0.82,
  },
  TRANSITION: {
    Macro: 0.73,
    "Event-Driven": 0.71,
    Sentiment: 0.69,
  },
  RISK_OFF: {
    Macro: 0.78,
    "Event-Driven": 0.62,
    Sentiment: 0.57,
  },
  LOW_VOL: {
    Macro: 0.82,
    "Event-Driven": 0.74,
    Sentiment: 0.79,
  },
};

function buildClientOrderId(
  cycleId: number,
  agentId: RuntimeTradingAgentId,
  suffix?: string
) {
  const base = `gptcap-${cycleId}-${getTradingAgentShortCode(agentId)}`;
  return suffix ? `${base}-${suffix}` : base;
}

function inferAgentIdFromClientOrderId(clientOrderId: string | null) {
  if (!clientOrderId?.startsWith("gptcap-")) {
    return null;
  }

  for (const agentId of ROUTED_TRADING_AGENT_IDS) {
    if (clientOrderId.includes(`-${getTradingAgentShortCode(agentId)}`)) {
      return agentId;
    }
  }

  return null;
}

function pickRotatingSymbol<T extends readonly string[]>(
  values: T,
  cycleIndex: number,
  openSymbols: Set<string>
) {
  for (let offset = 0; offset < values.length; offset += 1) {
    const candidate = values[(cycleIndex - 1 + offset) % values.length];

    if (!openSymbols.has(candidate)) {
      return candidate;
    }
  }

  return values[(cycleIndex - 1) % values.length] ?? null;
}

function isPaperExperimentationEnabled() {
  return process.env.AGENT_PAPER_EXPERIMENTATION_ENABLED?.trim().toLowerCase() !== "false";
}

function getSleeveRiskGuardrails() {
  return isPaperExperimentationEnabled()
    ? PAPER_EXPERIMENTATION_GUARDRAILS
    : BASE_SLEEVE_RISK_GUARDRAILS;
}

function chooseTradeSide(
  agentId: TradingAgentId,
  symbol: string,
  cycleIndex: number,
  openSymbols: Set<string>,
  discussionContext: AgentDiscussionContext,
  regime: (typeof REGIMES)[number]
): AlpacaOrderSide {
  if (openSymbols.has(symbol)) {
    return cycleIndex % 2 === 0 ? "sell" : "buy";
  }

  if (agentId === "AGT-SENT-001") {
    return discussionContext.sentimentScore >= 62 ? "buy" : "sell";
  }

  if (
    agentId === "AGT-MACRO-001" &&
    (regime === "RISK_OFF" || regime === "HIGH_VOL" || regime === "TRANSITION")
  ) {
    return symbol === "TLT" || symbol === "XLU" || symbol === "GLD" || symbol === "XLP"
      ? "buy"
      : "sell";
  }

  return "buy";
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function roundToStep(value: number, step = 100) {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }

  return Math.round(value / step) * step;
}

function floorToStep(value: number, step = 100) {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }

  return Math.floor(value / step) * step;
}

function pickRotatingValue<T extends readonly string[]>(values: T, cycleIndex: number) {
  return values[(cycleIndex - 1) % values.length] ?? null;
}

function supportsOptionsRouting(session: RuntimeSessionSnapshot) {
  return session.marketStatus === "open";
}

function normalizeOptionUnderlyingSymbol(symbol: string) {
  const normalized = symbol.trim().toUpperCase();
  return parseAlpacaOptionContractSymbol(normalized)?.underlyingSymbol ?? normalized;
}

function deriveOpenUnderlyings(positions: AlpacaPositionSnapshot[]) {
  const underlyings = new Set<string>();

  for (const position of positions) {
    const parsedOption = parseAlpacaOptionContractSymbol(position.symbol);
    underlyings.add(parsedOption?.underlyingSymbol ?? position.symbol);
  }

  return underlyings;
}

function getOptionPremium(snapshot: AlpacaOptionContractSnapshot) {
  if (
    typeof snapshot.askPrice === "number" &&
    snapshot.askPrice > 0 &&
    typeof snapshot.bidPrice === "number" &&
    snapshot.bidPrice > 0
  ) {
    return (snapshot.askPrice + snapshot.bidPrice) / 2;
  }

  if (typeof snapshot.askPrice === "number" && snapshot.askPrice > 0) {
    return snapshot.askPrice;
  }

  if (typeof snapshot.tradePrice === "number" && snapshot.tradePrice > 0) {
    return snapshot.tradePrice;
  }

  if (typeof snapshot.bidPrice === "number" && snapshot.bidPrice > 0) {
    return snapshot.bidPrice;
  }

  return null;
}

function getDaysToExpiration(expirationDate: string | null, now = new Date()) {
  if (!expirationDate) {
    return Number.POSITIVE_INFINITY;
  }

  const expiration = new Date(`${expirationDate}T20:00:00.000Z`);
  return (expiration.getTime() - now.getTime()) / 86_400_000;
}

function buildOptionExecutionCandidates(input: {
  trade: NonNullable<TraderAgentDecision["trade"]>;
  snapshots: AlpacaOptionContractSnapshot[];
  referencePrice: number;
  now?: Date;
}): AgentOptionExecutionCandidate[] {
  const now = input.now;
  const desiredStrike =
    input.referencePrice *
    (1 + (input.trade.strikeOffsetPct ?? 0));
  const filtered = input.snapshots
    .map((snapshot) => {
      const premium = getOptionPremium(snapshot);
      const daysToExpiration = getDaysToExpiration(snapshot.expirationDate, now);
      const strikeDistance =
        typeof snapshot.strikePrice === "number"
          ? Math.abs(snapshot.strikePrice - desiredStrike)
          : Number.POSITIVE_INFINITY;
      const dayDistance = Math.abs(
        daysToExpiration - Math.max(input.trade.targetDaysToExpiration ?? 14, 1)
      );

      return {
        snapshot,
        premium,
        daysToExpiration,
        strikeDistance,
        dayDistance,
      };
    })
    .filter((candidate) => {
      if (
        typeof candidate.premium !== "number" ||
        candidate.premium <= 0 ||
        candidate.daysToExpiration < 1 ||
        candidate.daysToExpiration > 60 ||
        !candidate.snapshot.optionType
      ) {
        return false;
      }

      if (
        input.trade.expressionKind !== "long_straddle" &&
        input.trade.optionType &&
        candidate.snapshot.optionType !== input.trade.optionType
      ) {
        return false;
      }

      return true;
    })
    .sort((left, right) => {
      if (left.dayDistance !== right.dayDistance) {
        return left.dayDistance - right.dayDistance;
      }

      if (left.strikeDistance !== right.strikeDistance) {
        return left.strikeDistance - right.strikeDistance;
      }

      return (left.premium ?? Number.POSITIVE_INFINITY) - (right.premium ?? Number.POSITIVE_INFINITY);
    });

  const optionSingleOrSpread =
    input.trade.expressionKind === "option_single" ||
    input.trade.expressionKind === "option_spread";

  if (optionSingleOrSpread) {
    return filtered.slice(0, 24).map((candidate) => ({
      symbol: candidate.snapshot.symbol,
      optionType: candidate.snapshot.optionType as "call" | "put",
      expirationDate: candidate.snapshot.expirationDate,
      strikePrice: candidate.snapshot.strikePrice,
      premium: candidate.premium as number,
      askPrice: candidate.snapshot.askPrice,
      bidPrice: candidate.snapshot.bidPrice,
      tradePrice: candidate.snapshot.tradePrice,
      daysToExpiration: Number(candidate.daysToExpiration.toFixed(2)),
    }));
  }

  const calls = filtered
    .filter((candidate) => candidate.snapshot.optionType === "call")
    .slice(0, 12);
  const puts = filtered
    .filter((candidate) => candidate.snapshot.optionType === "put")
    .slice(0, 12);

  return [...calls, ...puts].map((candidate) => ({
    symbol: candidate.snapshot.symbol,
    optionType: candidate.snapshot.optionType as "call" | "put",
    expirationDate: candidate.snapshot.expirationDate,
    strikePrice: candidate.snapshot.strikePrice,
    premium: candidate.premium as number,
    askPrice: candidate.snapshot.askPrice,
    bidPrice: candidate.snapshot.bidPrice,
    tradePrice: candidate.snapshot.tradePrice,
    daysToExpiration: Number(candidate.daysToExpiration.toFixed(2)),
  }));
}

function pickOptionContract(input: {
  snapshots: AlpacaOptionContractSnapshot[];
  optionType: "call" | "put";
  referencePrice: number;
  target: OptionSelectionTarget;
  now?: Date;
}) {
  const desiredStrike =
    input.referencePrice * (1 + (input.target.strikeOffsetPct ?? 0));

  return (
    input.snapshots
      .filter((snapshot) => snapshot.optionType === input.optionType)
      .map((snapshot) => ({
        snapshot,
        premium: getOptionPremium(snapshot),
        strikeDistance:
          typeof snapshot.strikePrice === "number"
            ? Math.abs(snapshot.strikePrice - desiredStrike)
            : Number.POSITIVE_INFINITY,
        dayDistance: Math.abs(
          getDaysToExpiration(snapshot.expirationDate, input.now) -
            input.target.targetDaysToExpiration
        ),
      }))
      .filter(
        (candidate) =>
          typeof candidate.premium === "number" &&
          candidate.premium > 0 &&
          getDaysToExpiration(candidate.snapshot.expirationDate, input.now) >= 1 &&
          getDaysToExpiration(candidate.snapshot.expirationDate, input.now) <= 45
      )
      .sort((left, right) => {
        if (left.dayDistance !== right.dayDistance) {
          return left.dayDistance - right.dayDistance;
        }

        if (left.strikeDistance !== right.strikeDistance) {
          return left.strikeDistance - right.strikeDistance;
        }

        return (left.premium ?? Number.POSITIVE_INFINITY) - (right.premium ?? Number.POSITIVE_INFINITY);
      })[0] ?? null
  );
}

async function buildOptionSingleExecution(input: {
  underlyingSymbol: string;
  optionType: "call" | "put";
  budgetNotional: number;
  target: OptionSelectionTarget;
  now?: Date;
}) {
  const [underlyingSnapshot, optionSnapshots] = await Promise.all([
    getAlpacaStockSnapshot(input.underlyingSymbol),
    listAlpacaOptionSnapshots(input.underlyingSymbol, { limit: 250 }),
  ]);
  const referencePrice =
    underlyingSnapshot.tradePrice ??
    underlyingSnapshot.askPrice ??
    underlyingSnapshot.bidPrice ??
    underlyingSnapshot.previousClose;

  if (!referencePrice || referencePrice <= 0) {
    return null;
  }

  const selected = pickOptionContract({
    snapshots: optionSnapshots,
    optionType: input.optionType,
    referencePrice,
    target: input.target,
    now: input.now,
  });

  if (!selected || typeof selected.premium !== "number") {
    return null;
  }

  const qty = Math.max(1, Math.floor(input.budgetNotional / (selected.premium * 100)));

  return {
    contract: selected.snapshot,
    limitPrice: roundOrderPrice(selected.premium),
    qty,
    estimatedNotional: roundToStep(selected.premium * qty * 100, 10),
  };
}

async function buildOptionSpreadExecution(input: {
  underlyingSymbol: string;
  optionType: "call" | "put";
  budgetNotional: number;
  targetDaysToExpiration: number;
  now?: Date;
}) {
  const [underlyingSnapshot, optionSnapshots] = await Promise.all([
    getAlpacaStockSnapshot(input.underlyingSymbol),
    listAlpacaOptionSnapshots(input.underlyingSymbol, { limit: 250 }),
  ]);
  const referencePrice =
    underlyingSnapshot.tradePrice ??
    underlyingSnapshot.askPrice ??
    underlyingSnapshot.bidPrice ??
    underlyingSnapshot.previousClose;

  if (!referencePrice || referencePrice <= 0) {
    return null;
  }

  const longLeg = pickOptionContract({
    snapshots: optionSnapshots,
    optionType: input.optionType,
    referencePrice,
    target: {
      targetDaysToExpiration: input.targetDaysToExpiration,
      strikeOffsetPct: 0,
    },
    now: input.now,
  });
  const shortLeg = pickOptionContract({
    snapshots: optionSnapshots,
    optionType: input.optionType,
    referencePrice,
    target: {
      targetDaysToExpiration: input.targetDaysToExpiration,
      strikeOffsetPct: input.optionType === "call" ? 0.04 : -0.04,
    },
    now: input.now,
  });

  if (
    !longLeg ||
    !shortLeg ||
    typeof longLeg.premium !== "number" ||
    typeof shortLeg.premium !== "number" ||
    longLeg.snapshot.symbol === shortLeg.snapshot.symbol
  ) {
    return null;
  }

  const netDebit = Math.max(longLeg.premium - shortLeg.premium, 0.01);
  const qty = Math.max(1, Math.floor(input.budgetNotional / (netDebit * 100)));

  return {
    longLeg: longLeg.snapshot,
    shortLeg: shortLeg.snapshot,
    limitPrice: roundOrderPrice(netDebit),
    qty,
    estimatedNotional: roundToStep(netDebit * qty * 100, 10),
  };
}

async function buildLongStraddleExecution(input: {
  underlyingSymbol: string;
  budgetNotional: number;
  targetDaysToExpiration: number;
  now?: Date;
}) {
  const [underlyingSnapshot, optionSnapshots] = await Promise.all([
    getAlpacaStockSnapshot(input.underlyingSymbol),
    listAlpacaOptionSnapshots(input.underlyingSymbol, { limit: 250 }),
  ]);
  const referencePrice =
    underlyingSnapshot.tradePrice ??
    underlyingSnapshot.askPrice ??
    underlyingSnapshot.bidPrice ??
    underlyingSnapshot.previousClose;

  if (!referencePrice || referencePrice <= 0) {
    return null;
  }

  const callLeg = pickOptionContract({
    snapshots: optionSnapshots,
    optionType: "call",
    referencePrice,
    target: {
      targetDaysToExpiration: input.targetDaysToExpiration,
      strikeOffsetPct: 0,
    },
    now: input.now,
  });
  const putLeg = pickOptionContract({
    snapshots: optionSnapshots,
    optionType: "put",
    referencePrice,
    target: {
      targetDaysToExpiration: input.targetDaysToExpiration,
      strikeOffsetPct: 0,
    },
    now: input.now,
  });

  if (
    !callLeg ||
    !putLeg ||
    typeof callLeg.premium !== "number" ||
    typeof putLeg.premium !== "number" ||
    callLeg.snapshot.expirationDate !== putLeg.snapshot.expirationDate
  ) {
    return null;
  }

  const totalPremium = Math.max(callLeg.premium + putLeg.premium, 0.01);
  const qty = Math.max(1, Math.floor(input.budgetNotional / (totalPremium * 100)));

  return {
    callLeg: callLeg.snapshot,
    putLeg: putLeg.snapshot,
    limitPrice: roundOrderPrice(totalPremium),
    qty,
    estimatedNotional: roundToStep(totalPremium * qty * 100, 10),
  };
}

function getSleeveSizingPct(agentId: TradingAgentId) {
  if (isPaperExperimentationEnabled()) {
    if (agentId === "AGT-MACRO-001") {
      return 0.12;
    }

    if (agentId === "AGT-EVENT-001") {
      return 0.1;
    }

    return 0.09;
  }

  if (agentId === "AGT-MACRO-001") {
    return 0.06;
  }

  if (agentId === "AGT-EVENT-001") {
    return 0.05;
  }

  return 0.045;
}

function getAutonomousOrderNotional(
  agentId: TradingAgentId,
  fallbackNotional: number,
  currentAllocationUsd: number | null
) {
  const guardrails = getSleeveRiskGuardrails();

  if (!currentAllocationUsd || currentAllocationUsd <= 0) {
    return fallbackNotional;
  }

  const sizedNotional = currentAllocationUsd * getSleeveSizingPct(agentId);
  const maxSingleOrder =
    currentAllocationUsd * guardrails.maxSingleOrderPctOfAllocation;

  return roundToStep(clamp(sizedNotional, fallbackNotional, maxSingleOrder), 10);
}

function applyRuntimeControlsToTradeIntent(
  intent: BrokerTradeIntent,
  control: AgentRuntimeControls
) {
  const guardrails = getSleeveRiskGuardrails();

  if (intent.confidenceScore < control.confidenceFloor) {
    return null;
  }

  const scaledNotional = roundToStep(
    Math.max(intent.notional * control.notionalMultiplier, guardrails.minOrderNotional),
    10
  );
  let executionPlan = intent.executionPlan;
  let effectiveNotional = scaledNotional;

  if (
    executionPlan &&
    executionPlan.kind !== "equity_pair" &&
    executionPlan.qty > 0 &&
    intent.notional > 0
  ) {
    const impliedUnitCost = intent.notional / executionPlan.qty;
    const scaledQty = Math.max(
      1,
      Math.round((executionPlan.qty * scaledNotional) / intent.notional)
    );

    executionPlan = {
      ...executionPlan,
      qty: scaledQty,
    };
    effectiveNotional = roundToStep(impliedUnitCost * scaledQty, 10);
  }

  return {
    ...intent,
    notional: effectiveNotional,
    executionPlan,
    messageDraft: withVoiceDraftFacts(intent.messageDraft, {
      notionalUsd: effectiveNotional,
      executionQty:
        executionPlan && executionPlan.kind !== "equity_pair"
          ? executionPlan.qty
          : null,
      learningConfidenceFloor: control.confidenceFloor,
      learningNotionalMultiplier: roundToStep(control.notionalMultiplier, 0.01),
    }),
    reasoning: `${intent.reasoning} Runtime learning controls kept ${intent.agentId} above a ${control.confidenceFloor}/100 confidence floor and applied a ${control.notionalMultiplier.toFixed(2)}x notional multiplier.`,
    signalContext: {
      ...intent.signalContext,
      learningConfidenceFloor: control.confidenceFloor,
      learningNotionalMultiplier: roundToStep(control.notionalMultiplier, 0.01),
    },
  } satisfies BrokerTradeIntent;
}

function isLiveBrokerOrderStatus(status: string) {
  return ["accepted", "new", "partially_filled", "filled"].includes(
    status.toLowerCase()
  );
}

function getAbsoluteMarketValue(position: AlpacaPositionSnapshot) {
  return Math.abs(position.marketValue ?? position.costBasis ?? 0);
}

function estimateAgentExposureFromBrokerState(
  agentId: RuntimeTradingAgentId,
  brokerState: BrokerSyncState
) {
  const symbolOwners = new Map<string, RuntimeTradingAgentId>();

  for (const order of brokerState.recentOrders) {
    if (!isLiveBrokerOrderStatus(order.status)) {
      continue;
    }

    const owner = inferAgentIdFromClientOrderId(order.clientOrderId);

    if (owner && !symbolOwners.has(order.symbol)) {
      symbolOwners.set(order.symbol, owner);
    }
  }

  return brokerState.positions.reduce((sum, position) => {
    if (symbolOwners.get(position.symbol) !== agentId) {
      return sum;
    }

    return sum + getAbsoluteMarketValue(position);
  }, 0);
}

function getPortfolioGrossExposure(brokerState: BrokerSyncState) {
  const accountGrossExposure =
    Math.abs(brokerState.account.longMarketValue ?? 0) +
    Math.abs(brokerState.account.shortMarketValue ?? 0);

  if (accountGrossExposure > 0) {
    return accountGrossExposure;
  }

  return brokerState.positions.reduce(
    (sum, position) => sum + getAbsoluteMarketValue(position),
    0
  );
}

type BrokerCapacityDiscipline = {
  buyingPowerUsd: number;
  cashUsd: number;
  portfolioValueUsd: number;
  deployableCapitalUsd: number;
  additionsPaused: boolean;
  deRiskOnly: boolean;
  summary: string;
  dataConsumed: string[];
};

type RecentAttributedOrderSnapshot = {
  agentId: RuntimeTradingAgentId;
  lastTouchedAt: string | null;
};

function getBrokerCapacityDiscipline(
  brokerState: BrokerSyncState
): BrokerCapacityDiscipline {
  const buyingPowerUsd = Math.max(brokerState.account.buyingPower ?? 0, 0);
  const cashUsd = brokerState.account.cash ?? 0;
  const portfolioValueUsd = Math.max(brokerState.account.portfolioValue ?? 0, 0);
  const deployableCapitalUsd = computeDeployableCapital({
    portfolioValue: portfolioValueUsd,
    buyingPower: buyingPowerUsd,
    attributedExposureUsd: getPortfolioGrossExposure(brokerState),
  });
  const additionsPauseFloorUsd = Math.max(1_000, portfolioValueUsd * 0.02);
  const deRiskOnlyFloorUsd = Math.max(500, portfolioValueUsd * 0.01);
  const additionsPaused =
    deployableCapitalUsd <= additionsPauseFloorUsd ||
    (cashUsd < 0 &&
      buyingPowerUsd <= Math.max(2_500, portfolioValueUsd * 0.05));
  const deRiskOnly =
    buyingPowerUsd <= deRiskOnlyFloorUsd ||
    (cashUsd < 0 && deployableCapitalUsd <= additionsPauseFloorUsd);
  const summary = additionsPaused
    ? `Broker capacity is constrained with $${formatUsd(
        buyingPowerUsd
      )} buying power, $${formatUsd(deployableCapitalUsd)} deployable capital, and cash at $${formatUsd(
        cashUsd
      )}; fresh adds are paused until existing exposure is reduced.`
    : `Broker capacity is available with $${formatUsd(
        buyingPowerUsd
      )} buying power and $${formatUsd(deployableCapitalUsd)} deployable capital.`;

  return {
    buyingPowerUsd,
    cashUsd,
    portfolioValueUsd,
    deployableCapitalUsd,
    additionsPaused,
    deRiskOnly,
    summary,
    dataConsumed: [
      `capacityBuyingPower:${Math.round(buyingPowerUsd)}`,
      `capacityCash:${Math.round(cashUsd)}`,
      `capacityPortfolioValue:${Math.round(portfolioValueUsd)}`,
      `capacityDeployableCapital:${Math.round(deployableCapitalUsd)}`,
      `capacityAdditionsPaused:${String(additionsPaused)}`,
      `capacityDeRiskOnly:${String(deRiskOnly)}`,
    ],
  };
}

function buildRecentAttributedOrderSnapshotMap(brokerState: BrokerSyncState) {
  const snapshots = new Map<string, RecentAttributedOrderSnapshot>();

  for (const order of brokerState.recentOrders) {
    if (!isLiveBrokerOrderStatus(order.status)) {
      continue;
    }

    const owner = inferAgentIdFromClientOrderId(order.clientOrderId);

    if (!owner || snapshots.has(order.symbol)) {
      continue;
    }

    snapshots.set(order.symbol, {
      agentId: owner,
      lastTouchedAt: order.updatedAt ?? order.submittedAt ?? null,
    });
  }

  return snapshots;
}

function buildRecentOrderOwnerMap(brokerState: BrokerSyncState) {
  return new Map(
    [...buildRecentAttributedOrderSnapshotMap(brokerState).entries()].map(
      ([symbol, snapshot]) => [symbol, snapshot.agentId]
    )
  );
}

function getAttributedPositionsForAgent(
  agentId: RuntimeTradingAgentId,
  brokerState: BrokerSyncState
) {
  const symbolOwners = buildRecentOrderOwnerMap(brokerState);

  return brokerState.positions.filter(
    (position) => symbolOwners.get(position.symbol) === agentId
  );
}

function getReducibleLongExposureForSymbol(
  agentId: RuntimeTradingAgentId,
  symbol: string,
  brokerState: BrokerSyncState
) {
  return getAttributedPositionsForAgent(agentId, brokerState).reduce((sum, position) => {
    if (position.symbol !== symbol || position.side !== "long") {
      return sum;
    }

    return sum + getAbsoluteMarketValue(position);
  }, 0);
}

function traderTradeAddsNewRisk(
  trade: TraderAgentDecision["trade"]
) {
  if (!trade) {
    return false;
  }

  if (trade.expressionKind === "equity") {
    return trade.side === "buy";
  }

  return true;
}

function tradeIntentAddsNewRisk(intent: BrokerTradeIntent) {
  if (!intent.executionPlan) {
    return intent.side === "buy";
  }

  if (intent.executionPlan.kind === "equity_pair") {
    return true;
  }

  if (intent.executionPlan.kind === "option_single") {
    return intent.executionPlan.positionIntent.endsWith("_to_open");
  }

  return intent.executionPlan.legs.some((leg) => leg.positionIntent.endsWith("_to_open"));
}

function getReducibleExposureForIntent(
  intent: BrokerTradeIntent,
  brokerState: BrokerSyncState
) {
  if (tradeIntentAddsNewRisk(intent)) {
    return 0;
  }

  if (intent.executionPlan?.kind === "equity_pair") {
    return 0;
  }

  if (intent.side !== "sell") {
    return 0;
  }

  return getReducibleLongExposureForSymbol(intent.agentId, intent.symbol, brokerState);
}

function getEffectiveAgentHeadroom(input: {
  agentId: RuntimeTradingAgentId;
  targetAllocationUsd: number;
  brokerState: BrokerSyncState | null;
  capacityDiscipline: BrokerCapacityDiscipline | null;
}) {
  if (!input.brokerState || !input.capacityDiscipline || input.capacityDiscipline.additionsPaused) {
    return 0;
  }

  const agentExposureUsd = estimateAgentExposureFromBrokerState(
    input.agentId,
    input.brokerState
  );

  return roundToStep(
    Math.max(0, input.targetAllocationUsd - agentExposureUsd),
    10
  );
}

function isReducibleEquityPosition(position: AlpacaPositionSnapshot) {
  if (position.side !== "long") {
    return false;
  }

  if ((position.marketValue ?? 0) <= 0) {
    return false;
  }

  if (parseAlpacaOptionContractSymbol(position.symbol)) {
    return false;
  }

  return position.assetClass !== "us_option";
}

function inferAssetBucketLabelFromSymbol(symbol: string) {
  if (CREDIT_PROXY_SYMBOLS.includes(symbol as (typeof CREDIT_PROXY_SYMBOLS)[number])) {
    return "credit_proxy";
  }

  if (COMMODITY_PROXY_SYMBOLS.includes(symbol as (typeof COMMODITY_PROXY_SYMBOLS)[number])) {
    return "commodity_proxy";
  }

  if (ALTERNATIVE_PROXY_SYMBOLS.includes(symbol as (typeof ALTERNATIVE_PROXY_SYMBOLS)[number])) {
    return "alternative_proxy";
  }

  return "equity";
}

function buildReplacementHoldingCandidates(input: {
  decisionSet: AgentDecisionSet;
  brokerState: BrokerSyncState;
}): AgentReplacementHoldingCandidate[] {
  const recentOrderSnapshots = buildRecentAttributedOrderSnapshotMap(input.brokerState);
  const holdings: AgentReplacementHoldingCandidate[] = [];

  for (const position of input.brokerState.positions) {
    if (!isReducibleEquityPosition(position)) {
      continue;
    }

    const orderSnapshot = recentOrderSnapshots.get(position.symbol);

    if (!orderSnapshot) {
      continue;
    }

    const ownerAgentId = orderSnapshot.agentId;

    if (!isConfiguredTradingAgentId(ownerAgentId)) {
      continue;
    }

    const ownerDecision = input.decisionSet.traders[ownerAgentId];
    const ownerTargetAllocationUsd =
      input.decisionSet.cio.allocations[ownerAgentId].targetAllocationUsd;
    const ownerExposureUsd = estimateAgentExposureFromBrokerState(
      ownerAgentId,
      input.brokerState
    );
    const positionAgeDays = orderSnapshot.lastTouchedAt
      ? roundToStep(
          (Date.now() - new Date(orderSnapshot.lastTouchedAt).getTime()) / 86_400_000,
          0.1
        )
      : null;

    holdings.push({
      agentId: ownerAgentId,
      symbol: position.symbol,
      assetBucket: inferAssetBucketLabelFromSymbol(position.symbol),
      marketValueUsd: roundToStep(Math.abs(position.marketValue ?? 0), 10),
      maxReducibleNotionalUsd: roundToStep(Math.abs(position.marketValue ?? 0), 10),
      unrealizedPlUsd: roundToStep(position.unrealizedPl ?? 0, 10),
      currentPriceUsd: position.currentPrice ?? null,
      positionAgeDays,
      targetAllocationUsd: ownerTargetAllocationUsd,
      agentExposureUsd: roundToStep(ownerExposureUsd, 10),
      ownerConfidenceScore: ownerDecision.confidenceScore,
      ownerShouldTrade: ownerDecision.shouldTrade,
      ownerTradeSymbol: ownerDecision.trade?.symbol.trim().toUpperCase() ?? null,
      ownerTradeSide:
        ownerDecision.trade?.side === "buy" || ownerDecision.trade?.side === "sell"
          ? ownerDecision.trade.side
          : null,
    });
  }

  return holdings.sort((left, right) => left.marketValueUsd - right.marketValueUsd);
}

function buildCioReplacementTradeDecision(input: {
  requestedTradeAgentId: RuntimeTradingAgentId;
  requestedTradeSymbol: string;
  fundingHolding: AgentReplacementHoldingCandidate;
  fundingNotionalUsd: number;
  rationale: string;
  changeMind: string;
  confidenceScore: number;
  dataConsumed: string[];
}) {
  return {
    agentId: input.fundingHolding.agentId,
    shouldTrade: true,
    observation: `I'm trimming ${input.fundingHolding.symbol} so the desk can fund a stronger ${input.requestedTradeSymbol} opportunity.`,
    whyItMatters:
      `${getConfiguredTradingAgentRole(input.requestedTradeAgentId)} is carrying the stronger ranked signal, and ${input.fundingHolding.symbol} is the weakest current holding after the research lead's portfolio-wide replacement review.`,
    changeMind: input.changeMind,
    confidenceScore: input.confidenceScore,
    reasoning: input.rationale,
    discussionNote:
      `Trimming ${input.fundingHolding.symbol} to free about $${formatUsd(
        input.fundingNotionalUsd
      )} for the higher-ranked ${input.requestedTradeSymbol} setup.`,
    dataConsumed: input.dataConsumed,
    trade: {
      symbol: input.fundingHolding.symbol,
      side: "sell",
      requestedNotionalUsd: input.fundingNotionalUsd,
      strategyFamily: "cio_opportunity_cost_replacement",
      expressionKind: "equity",
      thesisLabel: "OPPORTUNITY_COST_REPLACEMENT",
      assetBucketLabel: input.fundingHolding.assetBucket,
    },
  } satisfies TraderAgentDecision;
}

async function applyBrokerCapacityOverlayToDecisionSet(input: {
  decisionSet: AgentDecisionSet;
  brokerState: BrokerSyncState | null;
  session: RuntimeSessionSnapshot;
  researchDecision: ResearchAgentDecision;
}) {
  if (!input.brokerState) {
    return input.decisionSet;
  }

  const brokerState = input.brokerState;
  const capacityDiscipline = getBrokerCapacityDiscipline(brokerState);

  if (!capacityDiscipline.additionsPaused) {
    return input.decisionSet;
  }

  const selectedTradeAgentId = input.decisionSet.cio.cycleDirectives.allowTrading
    ? input.decisionSet.cio.selectedTradeAgentId
    : null;
  const selectedDecision = selectedTradeAgentId
    ? input.decisionSet.traders[selectedTradeAgentId]
    : null;
  const selectedAddsRisk = selectedDecision
    ? traderTradeAddsNewRisk(selectedDecision.trade)
    : false;
  let allowTrading = input.decisionSet.cio.cycleDirectives.allowTrading;
  let routedTradeAgentId = input.decisionSet.cio.selectedTradeAgentId;
  let routedTradeRationale = input.decisionSet.cio.selectedTradeRationale;
  let traders = input.decisionSet.traders;
  const activeTradingAgents = new Set(
    input.decisionSet.cio.cycleDirectives.activeTradingAgents
  );

  if (selectedAddsRisk && selectedTradeAgentId) {
    if (!selectedDecision) {
      return input.decisionSet;
    }

    const selectedTrade = selectedDecision?.trade;

    if (!selectedTrade) {
      return input.decisionSet;
    }

    const holdings = buildReplacementHoldingCandidates({
      decisionSet: input.decisionSet,
      brokerState,
    });

    if (holdings.length === 0) {
      allowTrading = false;
      routedTradeAgentId = null;
      routedTradeRationale = `${capacityDiscipline.summary} No attributable long equity holdings were available as portfolio-level funding candidates, so routing is paused until capital is freed.`;
    } else {
      const replacementDecision = await getCioReplacementDecision({
        session: input.session,
        brokerState: {
          account: brokerState.account,
          positions: brokerState.positions,
          recentOrders: brokerState.recentOrders,
        },
        researchDecision: input.researchDecision,
        cioDecision: input.decisionSet.cio,
        selectedTradeAgentId,
        selectedTradeDecision: selectedDecision,
        traderDecisions: input.decisionSet.traders,
        holdings,
      });
      const fundingHolding =
        replacementDecision.fundingSymbol && replacementDecision.fundingAgentId
          ? holdings.find(
              (holding) =>
                holding.symbol === replacementDecision.fundingSymbol &&
                holding.agentId === replacementDecision.fundingAgentId
            ) ?? null
          : null;

      if (replacementDecision.shouldReplace && fundingHolding) {
        const requestedTradeSymbol = selectedTrade.symbol.trim().toUpperCase();

        traders = {
          ...input.decisionSet.traders,
          [fundingHolding.agentId]: buildCioReplacementTradeDecision({
            requestedTradeAgentId: selectedTradeAgentId,
            requestedTradeSymbol,
            fundingHolding,
            fundingNotionalUsd: Math.min(
              fundingHolding.maxReducibleNotionalUsd,
              floorToStep(replacementDecision.fundingNotionalUsd, 10)
            ),
            rationale: replacementDecision.rationale,
            changeMind: replacementDecision.changeMind,
            confidenceScore: replacementDecision.confidenceScore,
            dataConsumed: [
              `replacementTarget:${requestedTradeSymbol}`,
              `replacementFundingSymbol:${fundingHolding.symbol}`,
              `replacementIncomingExpectedReturnBps:${replacementDecision.incomingExpectedReturnBps}`,
              `replacementFundingExpectedReturnBps:${replacementDecision.fundingExpectedReturnBps}`,
              `replacementNetAdvantageBps:${replacementDecision.netAdvantageBps}`,
              `replacementEstimatedRoundTripCostBps:${replacementDecision.estimatedRoundTripCostBps}`,
              `replacementRequiredHurdleBps:${replacementDecision.requiredHurdleBps}`,
              ...replacementDecision.dataConsumed,
            ],
          }),
        };
        allowTrading = true;
        routedTradeAgentId = fundingHolding.agentId;
        routedTradeRationale = `${capacityDiscipline.summary} ${replacementDecision.rationale}`;
        activeTradingAgents.add(fundingHolding.agentId);
      } else {
        allowTrading = false;
        routedTradeAgentId = null;
        routedTradeRationale = `${capacityDiscipline.summary} ${replacementDecision.rationale}`;
      }
    }
  }

  return {
    ...input.decisionSet,
    traders,
    cio: {
      ...input.decisionSet.cio,
      allocationBoundary: `${input.decisionSet.cio.allocationBoundary} ${capacityDiscipline.summary}`,
      cycleDirectives: {
        ...input.decisionSet.cio.cycleDirectives,
        allowTrading,
        activeTradingAgents: [...activeTradingAgents],
        rationale: `${input.decisionSet.cio.cycleDirectives.rationale} ${capacityDiscipline.summary}`,
      },
      selectedTradeAgentId: routedTradeAgentId,
      selectedTradeRationale: routedTradeRationale,
      dataConsumed: [...new Set([...input.decisionSet.cio.dataConsumed, ...capacityDiscipline.dataConsumed])],
    },
  } satisfies AgentDecisionSet;
}

function buildRiskGateRejection(input: {
  requestedNotional: number;
  reason: string;
  dataConsumed: string[];
  guardrails?: SleeveRiskGuardrails;
}): RiskGateDecision {
  const guardrails = input.guardrails ?? getSleeveRiskGuardrails();

  return {
    approved: false,
    notional: 0,
    requestedNotional: input.requestedNotional,
    reason: input.reason,
    guardrails,
    dataConsumed: input.dataConsumed,
  };
}

async function evaluatePreTradeRiskGate(input: {
  session: RuntimeSessionSnapshot;
  intent: BrokerTradeIntent;
  brokerState: BrokerSyncState;
  allocationInputs: CioAllocationInput[];
  researchDecision: ResearchAgentDecision;
  traderDecision: TraderAgentDecision;
  cioDecision: CioAgentDecision;
  guardrails?: SleeveRiskGuardrails;
}): Promise<RiskGateDecision> {
  const guardrails = input.guardrails ?? getSleeveRiskGuardrails();
  const allocationInput = input.allocationInputs.find(
    (candidate) => candidate.agentId === input.intent.agentId
  );
  const sleeveAllocationUsd = allocationInput?.currentAllocationUsd ?? null;
  const requestedNotional = input.intent.notional;
  const buyingPower = input.brokerState.account.buyingPower ?? 0;
  const portfolioValue = input.brokerState.account.portfolioValue ?? 0;
  const agentExposureUsd = estimateAgentExposureFromBrokerState(
    input.intent.agentId,
    input.brokerState
  );
  const portfolioGrossExposureUsd = getPortfolioGrossExposure(input.brokerState);
  const capacityDiscipline = getBrokerCapacityDiscipline(input.brokerState);
  const intentAddsRisk = tradeIntentAddsNewRisk(input.intent);
  const reducibleExposureUsd = getReducibleExposureForIntent(
    input.intent,
    input.brokerState
  );
  const dataConsumed = [
    `agent:${input.intent.agentId}`,
    `symbol:${input.intent.symbol}`,
    `requestedNotional:${requestedNotional}`,
    `sleeveAllocationUsd:${String(sleeveAllocationUsd ?? "n/a")}`,
    `agentExposureUsd:${Math.round(agentExposureUsd)}`,
    `intentAddsRisk:${String(intentAddsRisk)}`,
    `reducibleExposureUsd:${Math.round(reducibleExposureUsd)}`,
    `portfolioGrossExposureUsd:${Math.round(portfolioGrossExposureUsd)}`,
    `buyingPower:${Math.round(buyingPower)}`,
    `portfolioValue:${Math.round(portfolioValue)}`,
    ...capacityDiscipline.dataConsumed,
  ];

  if (!intentAddsRisk && reducibleExposureUsd <= 0) {
    return buildRiskGateRejection({
      requestedNotional,
      reason:
        "Risk gate rejected the sell because no attributable long exposure exists to reduce.",
      dataConsumed,
      guardrails,
    });
  }

  if (intentAddsRisk && capacityDiscipline.additionsPaused) {
    return buildRiskGateRejection({
      requestedNotional,
      reason: capacityDiscipline.summary,
      dataConsumed,
      guardrails,
    });
  }

  if (intentAddsRisk && (!sleeveAllocationUsd || sleeveAllocationUsd <= 0)) {
    return buildRiskGateRejection({
      requestedNotional,
      reason:
        "Risk gate rejected order because the agent does not have an active research lead target sleeve allocation.",
      dataConsumed,
      guardrails,
    });
  }

  const riskDisposition = await getAgentRiskDispositionDecision({
    session: input.session,
    brokerState: {
      account: input.brokerState.account,
      positions: input.brokerState.positions,
      recentOrders: input.brokerState.recentOrders,
    },
    allocationInput: allocationInput ?? null,
    researchDecision: input.researchDecision,
    traderDecision: input.traderDecision,
    cioDecision: input.cioDecision,
    tradeIntent: summarizeTradeIntentForAgent({
      intent: input.intent,
    }),
    guardrails,
    riskContext: {
      sleeveAllocationUsd,
      buyingPower,
      portfolioValue,
      agentExposureUsd,
      portfolioGrossExposureUsd,
    },
  });

  if (!riskDisposition.approveTrade) {
    return buildRiskGateRejection({
      requestedNotional,
      reason: riskDisposition.rationale,
      dataConsumed: [
        ...dataConsumed,
        ...riskDisposition.dataConsumed,
      ],
      guardrails,
    });
  }

  if (riskDisposition.approvedNotionalUsd > requestedNotional) {
    return buildRiskGateRejection({
      requestedNotional,
      reason:
        "Risk adjudication returned an approved notional above the trader's requested notional.",
      dataConsumed: [...dataConsumed, ...riskDisposition.dataConsumed],
      guardrails,
    });
  }

  const approvedNotional = roundToStep(riskDisposition.approvedNotionalUsd, 10);

  if (approvedNotional < guardrails.minOrderNotional) {
    return buildRiskGateRejection({
      requestedNotional,
      reason:
        "Risk adjudication returned an approved notional below the minimum order size.",
      dataConsumed: [...dataConsumed, ...riskDisposition.dataConsumed],
      guardrails,
    });
  }

  const effectiveApprovedNotional = intentAddsRisk
    ? approvedNotional
    : floorToStep(Math.min(approvedNotional, reducibleExposureUsd), 10);

  if (effectiveApprovedNotional < guardrails.minOrderNotional) {
    return buildRiskGateRejection({
      requestedNotional,
      reason:
        "Risk adjudication left too little attributable exposure to reduce after capping the order to the live position size.",
      dataConsumed: [...dataConsumed, ...riskDisposition.dataConsumed],
      guardrails,
    });
  }

  if (intentAddsRisk && effectiveApprovedNotional > Math.max(buyingPower, 0)) {
    return buildRiskGateRejection({
      requestedNotional,
      reason:
        "Risk adjudication exceeded current broker buying power, so the technical envelope blocked the order.",
      dataConsumed: [...dataConsumed, ...riskDisposition.dataConsumed],
      guardrails,
    });
  }

  return {
    approved: true,
    notional: effectiveApprovedNotional,
    requestedNotional,
    reason: riskDisposition.rationale,
    guardrails,
    dataConsumed: [
      ...dataConsumed,
      ...riskDisposition.dataConsumed,
      `approvedNotional:${effectiveApprovedNotional}`,
    ],
  };
}

function computeDeployableCapital(input: {
  portfolioValue: number | null;
  buyingPower: number | null;
  attributedExposureUsd: number;
}) {
  const exploratory = isPaperExperimentationEnabled();
  const portfolioValue = input.portfolioValue ?? 0;
  const buyingPower = Math.max(input.buyingPower ?? 0, 0);
  const attributedExposureUsd = Math.max(input.attributedExposureUsd, 0);

  if (buyingPower > 0) {
    return roundToStep(
      Math.min(
        portfolioValue > 0
          ? portfolioValue * (exploratory ? 0.9 : 0.75)
          : buyingPower,
        buyingPower * (exploratory ? 0.94 : 0.82)
      ),
      100
    );
  }

  if (portfolioValue > 0 && attributedExposureUsd > 0) {
    return roundToStep(
      Math.min(
        portfolioValue * (exploratory ? 0.88 : 0.72),
        attributedExposureUsd + portfolioValue * (exploratory ? 0.22 : 0.12)
      ),
      100
    );
  }

  return roundToStep(portfolioValue * (exploratory ? 0.78 : 0.55), 100);
}

function normalizeAllocations(
  weights: Array<{ agentId: string; weight: number }>,
  deployableCapital: number
) {
  if (weights.length === 0 || deployableCapital <= 0) {
    return new Map<string, number>();
  }

  const capPerAgent = deployableCapital * (isPaperExperimentationEnabled() ? 0.6 : 0.45);
  const remaining = new Map(weights.map((item) => [item.agentId, item.weight]));
  const allocations = new Map<string, number>();
  let capitalLeft = deployableCapital;

  while (remaining.size > 0 && capitalLeft > 0) {
    const totalWeight = [...remaining.values()].reduce((sum, value) => sum + value, 0);

    if (totalWeight <= 0) {
      const equalSplit = capitalLeft / remaining.size;

      for (const agentId of remaining.keys()) {
        allocations.set(agentId, (allocations.get(agentId) ?? 0) + equalSplit);
      }

      break;
    }

    let cappedAgentFound = false;

    for (const [agentId, weight] of [...remaining.entries()]) {
      const provisional = (capitalLeft * weight) / totalWeight;
      const current = allocations.get(agentId) ?? 0;
      const roomLeft = capPerAgent - current;

      if (roomLeft <= 0) {
        remaining.delete(agentId);
        cappedAgentFound = true;
        continue;
      }

      if (provisional >= roomLeft) {
        allocations.set(agentId, current + roomLeft);
        capitalLeft -= roomLeft;
        remaining.delete(agentId);
        cappedAgentFound = true;
      }
    }

    if (!cappedAgentFound) {
      for (const [agentId, weight] of remaining.entries()) {
        allocations.set(
          agentId,
          (allocations.get(agentId) ?? 0) + (capitalLeft * weight) / totalWeight
        );
      }
      capitalLeft = 0;
    }
  }

  return new Map(
    [...allocations.entries()].map(([agentId, value]) => [agentId, roundToStep(value, 100)])
  );
}

function computeAgentAllocationScore(input: {
  regime: (typeof REGIMES)[number];
  metrics: CioAllocationInput;
  deployableCapital: number;
}) {
  const strategyCategory =
    input.metrics.strategyCategory === "Macro" ||
    input.metrics.strategyCategory === "Event-Driven" ||
    input.metrics.strategyCategory === "Sentiment"
      ? input.metrics.strategyCategory
      : "Macro";
  const regimeFit = CIO_REGIME_FIT[input.regime][strategyCategory];
  const confidence = clamp((input.metrics.averageConfidenceScore ?? 62) / 100, 0.35, 0.95);
  const activity = clamp(
    (input.metrics.recentMessageCount + input.metrics.highPriorityMessageCount * 2) / 12,
    0.15,
    1
  );
  const execution = clamp(input.metrics.recentAcceptedOrderCount / 4, 0.12, 1);
  const pnl = clamp(
    0.5 +
      (input.metrics.attributedUnrealizedPl ?? 0) /
        Math.max(input.deployableCapital * 0.2, 2_500),
    0.15,
    0.95
  );
  const exposure = clamp(
    Math.abs(input.metrics.attributedMarketValue ?? 0) /
      Math.max(input.deployableCapital, 1),
    0,
    1
  );
  const composite =
    regimeFit * 0.3 +
    confidence * 0.22 +
    activity * 0.16 +
    execution * 0.14 +
    pnl * 0.1 +
    (1 - Math.min(exposure, 0.75)) * 0.08;

  return {
    regimeFit,
    confidence,
    activity,
    execution,
    pnl,
    exposure,
    composite,
  } satisfies AllocationScoreBreakdown;
}

function buildAgentDiscussionContext(
  cycleIndex: number,
  regime: (typeof REGIMES)[number]
): AgentDiscussionContext {
  const researchArea = RESEARCH_AREAS[(cycleIndex - 1) % RESEARCH_AREAS.length];
  const eventTicker = EVENT_NAMES[(cycleIndex - 1) % EVENT_NAMES.length];
  const sentimentTicker = SENTIMENT_NAMES[(cycleIndex - 1) % SENTIMENT_NAMES.length];
  const sentimentScore = 48 + ((cycleIndex * 11) % 39);
  const riskTone =
    regime === "RISK_OFF" || regime === "HIGH_VOL"
      ? "defensive"
      : regime === "BULL_TREND" || regime === "RISK_ON"
        ? "constructive"
        : "balanced";

  return {
    threadId: `DISC-${cycleIndex.toString().padStart(4, "0")}`,
    researchArea,
    eventTicker,
    sentimentTicker,
    sentimentScore,
    macroRead: `${regime} keeps the macro sleeve ${riskTone}; duration and beta sizing should reflect that posture.`,
    eventRead: `${eventTicker} remains the cleanest verified catalyst candidate, but sizing should respect current regime risk.`,
    sentimentRead: `${sentimentTicker} narrative momentum is ${sentimentScore >= 70 ? "crowded but strong" : "developing"} with a composite score of ${sentimentScore}.`,
    researchSource: "FALLBACK",
    researchPacketSummary:
      "Fallback research context only; Alpaca pricing and Alpha Vantage headlines did not enrich this cycle yet.",
    researchDataConsumed: ["runtime regime rotation", researchArea, eventTicker, sentimentTicker],
    kalshiSummary:
      "Kalshi market-implied context has not run for this cycle yet.",
    polymarketSummary:
      "Polymarket crowd-implied odds have not run for this cycle yet.",
    newsApiSummary:
      "Alpha Vantage enrichment has not run for this cycle yet.",
    secEdgarSummary:
      "SEC EDGAR earnings filing scan has not run for this cycle yet.",
    influenceByAgent: {
      "AGT-MACRO-001": `Incorporate ${researchArea} and cross-sleeve sentiment crowding before sizing beta exposure.`,
      "AGT-EVENT-001": `Adjust catalyst confidence for ${regime} and avoid oversized binary-event exposure.`,
      "AGT-SENT-001": `Discount narrative signals if macro risk or event timing creates crowding risk.`,
    },
  };
}

function buildAgentDiscussionContextFromMarketContext(input: {
  cycleIndex: number;
  regime: (typeof REGIMES)[number];
  marketContext?: AgentDecisionMarketContext | null;
}) {
  const fallback = buildAgentDiscussionContext(input.cycleIndex, input.regime);
  const marketContext = input.marketContext;

  if (!marketContext) {
    return fallback;
  }

  const eventTicker = marketContext.eventTickers[0] ?? fallback.eventTicker;
  const sentimentTicker =
    marketContext.sentimentTickers[0] ?? fallback.sentimentTicker;
  const researchArea =
    marketContext.researchFocus.trim().length > 0
      ? marketContext.researchFocus
      : fallback.researchArea;
  const researchPacketSummary =
    marketContext.researchPacketSummary.trim().length > 0
      ? marketContext.researchPacketSummary
      : fallback.researchPacketSummary;
  const researchDataConsumed =
    marketContext.dataConsumed.length > 0
      ? Array.from(new Set(marketContext.dataConsumed))
      : fallback.researchDataConsumed;

  return {
    ...fallback,
    researchArea,
    eventTicker,
    sentimentTicker,
    macroRead:
      marketContext.macroRead.trim().length > 0
        ? marketContext.macroRead
        : fallback.macroRead,
    eventRead:
      marketContext.eventRead.trim().length > 0
        ? marketContext.eventRead
        : fallback.eventRead,
    sentimentRead:
      marketContext.sentimentRead.trim().length > 0
        ? marketContext.sentimentRead
        : fallback.sentimentRead,
    researchSource: marketContext.researchSource,
    researchPacketSummary,
    researchDataConsumed,
    kalshiSummary:
      marketContext.kalshiSummary.trim().length > 0
        ? marketContext.kalshiSummary
        : fallback.kalshiSummary,
    polymarketSummary:
      marketContext.polymarketSummary.trim().length > 0
        ? marketContext.polymarketSummary
        : fallback.polymarketSummary,
    newsApiSummary:
      marketContext.newsApiSummary.trim().length > 0
        ? marketContext.newsApiSummary
        : fallback.newsApiSummary,
    secEdgarSummary:
      marketContext.secEdgarSummary.trim().length > 0
        ? marketContext.secEdgarSummary
        : fallback.secEdgarSummary,
    influenceByAgent: {
      "AGT-MACRO-001":
        `Use ${researchArea} and the current macro read before sizing beta exposure. ${marketContext.macroRead}`.trim(),
      "AGT-EVENT-001":
        `Let the event sleeve react to ${eventTicker} through the live catalyst read, not the seeded fallback. ${marketContext.eventRead}`.trim(),
      "AGT-SENT-001":
        `Use the live sentiment read on ${sentimentTicker} as the narrative filter and fade it quickly if confirmation breaks. ${marketContext.sentimentRead}`.trim(),
    },
  };
}

function formatResearchMove(packet: MassiveResearchPacket, symbol: string) {
  const symbolPacket = packet.symbols.find((item) => item.symbol === symbol);
  const latestBar = symbolPacket?.bars.at(-1) ?? null;
  const priorBar =
    symbolPacket && symbolPacket.bars.length >= 2
      ? symbolPacket.bars[symbolPacket.bars.length - 2]
      : null;

  if (
    latestBar?.close === null ||
    latestBar?.close === undefined ||
    priorBar?.close === null ||
    priorBar?.close === undefined ||
    priorBar.close === 0
  ) {
    return null;
  }

  const move = ((latestBar.close - priorBar.close) / priorBar.close) * 100;
  return `${symbol} latest daily move ${move >= 0 ? "+" : ""}${move.toFixed(2)}%`;
}

function formatResearchHeadline(packet: MassiveResearchPacket, symbol: string) {
  const headline = packet.symbols.find((item) => item.symbol === symbol)?.news[0]?.title;
  return headline ? `${symbol} headline: ${headline}` : null;
}

function enrichDiscussionContextWithMassive(
  context: AgentDiscussionContext,
  packet: MassiveResearchPacket
): AgentDiscussionContext {
  if (!packet.connected) {
    return {
      ...context,
      researchSource: "FALLBACK",
      researchPacketSummary: summarizeMassivePacketForAgents(packet),
      researchDataConsumed: [
        ...context.researchDataConsumed,
        "massive_research_unavailable",
      ],
    };
  }

  const macroMove =
    formatResearchMove(packet, "SPY") ??
    formatResearchMove(packet, "QQQ") ??
    "Alpaca pricing returned without a clean benchmark move.";
  const eventHeadline =
    formatResearchHeadline(packet, context.eventTicker) ??
    `${context.eventTicker} returned no top Alpha Vantage headline.`;
  const sentimentHeadline =
    formatResearchHeadline(packet, context.sentimentTicker) ??
    `${context.sentimentTicker} returned no top Alpha Vantage headline.`;
  const packetSummary = summarizeMassivePacketForAgents(packet);

  return {
    ...context,
    researchSource: "MASSIVE",
    researchPacketSummary: packetSummary,
    researchDataConsumed: [
      ...context.researchDataConsumed,
      "massive:ticker_reference",
      "massive:aggregate_bars",
      "massive:ticker_news",
    ],
    macroRead: `${context.macroRead} Alpaca pricing check: ${macroMove}.`,
    eventRead: `${context.eventRead} Alpha Vantage catalyst read: ${eventHeadline}.`,
    sentimentRead: `${context.sentimentRead} Alpha Vantage narrative read: ${sentimentHeadline}.`,
    influenceByAgent: {
      "AGT-MACRO-001": `${context.influenceByAgent["AGT-MACRO-001"]} Alpaca bars are part of the benchmark regime evidence.`,
      "AGT-EVENT-001": `${context.influenceByAgent["AGT-EVENT-001"]} Alpha Vantage headlines are part of catalyst verification.`,
      "AGT-SENT-001": `${context.influenceByAgent["AGT-SENT-001"]} Alpha Vantage headlines are part of narrative-quality filtering.`,
    },
  };
}

function formatNewsApiHeadline(packet: NewsApiResearchPacket, query: string) {
  const article = packet.queries.find((item) => item.query === query)?.articles[0];

  if (!article) {
    return null;
  }

  return `${query} headline: ${article.title}`;
}

function enrichDiscussionContextWithNewsApi(
  context: AgentDiscussionContext,
  packet: NewsApiResearchPacket,
  queries: {
    macro: string;
    event: string;
    sentiment: string;
  }
): AgentDiscussionContext {
  const summary = summarizeNewsApiPacketForAgents(packet);

  if (!packet.connected) {
    return {
      ...context,
      newsApiSummary: summary,
      researchDataConsumed: [
        ...context.researchDataConsumed,
        "newsapi_unavailable",
      ],
    };
  }

  const macroHeadline =
    formatNewsApiHeadline(packet, queries.macro) ??
    "Alpha Vantage did not return a top macro headline.";
  const eventHeadline =
    formatNewsApiHeadline(packet, queries.event) ??
    "Alpha Vantage did not return a top event headline.";
  const sentimentHeadline =
    formatNewsApiHeadline(packet, queries.sentiment) ??
    "Alpha Vantage did not return a top sentiment headline.";

  return {
    ...context,
    newsApiSummary: summary,
    researchDataConsumed: [
      ...context.researchDataConsumed,
      "alphavantage:news_sentiment",
    ],
    macroRead: `${context.macroRead} Alpha Vantage headline scan: ${macroHeadline}.`,
    eventRead: `${context.eventRead} Alpha Vantage headline scan: ${eventHeadline}.`,
    sentimentRead: `${context.sentimentRead} Alpha Vantage headline scan: ${sentimentHeadline}.`,
    influenceByAgent: {
      "AGT-MACRO-001": `${context.influenceByAgent["AGT-MACRO-001"]} Alpha Vantage macro headlines are included as narrative confirmation.`,
      "AGT-EVENT-001": `${context.influenceByAgent["AGT-EVENT-001"]} Alpha Vantage company headlines are included as catalyst context.`,
      "AGT-SENT-001": `${context.influenceByAgent["AGT-SENT-001"]} Alpha Vantage article flow is included as raw text evidence for independent sentiment judgment.`,
    },
  };
}

function formatKalshiSignal(packet: KalshiResearchPacket, query: string) {
  const event = packet.queries.find((item) => item.query === query)?.events[0];
  const market = event?.markets[0];
  const pricedProbability = market?.yesAsk ?? market?.lastPrice ?? market?.yesBid ?? null;

  if (!event || !market) {
    return null;
  }

  const probabilityText =
    typeof pricedProbability === "number"
      ? `${(pricedProbability * 100).toFixed(1)}% yes-implied`
      : "no clear implied price";
  const volumeText =
    typeof market.volume24h === "number"
      ? `$${market.volume24h.toLocaleString("en-US", {
          maximumFractionDigits: 0,
        })} 24h volume`
      : "24h volume n/a";

  return `${event.title}: ${market.title} is trading at ${probabilityText} with ${volumeText}.`;
}

function buildKalshiRuntimeQueries(context: AgentDiscussionContext) {
  const macro = "Federal Reserve";
  const event =
    context.eventTicker === "DAL"
      ? "oil"
      : context.researchArea === "credit spread drift"
        ? "recession"
        : context.researchArea === "earnings estimate dispersion"
          ? "jobs"
          : "tariffs";
  const sentiment = "Bitcoin";

  return {
    macro,
    event,
    sentiment,
  };
}

function enrichDiscussionContextWithKalshi(
  context: AgentDiscussionContext,
  packet: KalshiResearchPacket,
  queries: {
    macro: string;
    event: string;
    sentiment: string;
  }
): AgentDiscussionContext {
  const summary = summarizeKalshiPacketForAgents(packet);

  if (!packet.connected) {
    return {
      ...context,
      kalshiSummary: summary,
      researchDataConsumed: [
        ...context.researchDataConsumed,
        "kalshi_unavailable",
      ],
    };
  }

  const macroOdds =
    formatKalshiSignal(packet, queries.macro) ??
    "Kalshi did not return a macro market for this query.";
  const eventOdds =
    formatKalshiSignal(packet, queries.event) ??
    "Kalshi did not return a policy or catalyst-adjacent market for this query.";
  const sentimentOdds =
    formatKalshiSignal(packet, queries.sentiment) ??
    "Kalshi did not return a crypto/risk-sentiment market for this query.";

  return {
    ...context,
    kalshiSummary: summary,
    researchDataConsumed: [
      ...context.researchDataConsumed,
      "kalshi:series",
      "kalshi:events",
    ],
    macroRead: `${context.macroRead} Kalshi macro odds: ${macroOdds}`,
    eventRead: `${context.eventRead} Kalshi policy/event risk read: ${eventOdds}`,
    sentimentRead: `${context.sentimentRead} Kalshi crowd sentiment read: ${sentimentOdds}`,
    influenceByAgent: {
      "AGT-MACRO-001": `${context.influenceByAgent["AGT-MACRO-001"]} Kalshi economic markets are included as a crowd-implied macro check.`,
      "AGT-EVENT-001": `${context.influenceByAgent["AGT-EVENT-001"]} Kalshi policy and recession markets are included as a catalyst-risk cross-check.`,
      "AGT-SENT-001": `${context.influenceByAgent["AGT-SENT-001"]} Kalshi crypto and crowd-odds markets are included as a sentiment cross-check.`,
    },
  };
}

function formatPolymarketSignal(packet: PolymarketResearchPacket, query: string) {
  const event = packet.queries.find((item) => item.query === query)?.events[0];
  const market = event?.markets[0];
  const leadOutcome = market?.outcomes[0] ?? null;

  if (!market) {
    return null;
  }

  const pricedProbability =
    leadOutcome?.price ?? market.lastTradePrice ?? market.bestAsk ?? market.bestBid;
  const probabilityText =
    typeof pricedProbability === "number"
      ? `${(pricedProbability * 100).toFixed(1)}% ${leadOutcome?.label ?? "implied"}`
      : "no clear implied price";
  const volumeText =
    typeof market.volume24hr === "number"
      ? `$${market.volume24hr.toLocaleString("en-US", {
          maximumFractionDigits: 0,
        })} 24h volume`
      : "24h volume n/a";

  return `${market.question} is pricing ${probabilityText} with ${volumeText}.`;
}

function enrichDiscussionContextWithPolymarket(
  context: AgentDiscussionContext,
  packet: PolymarketResearchPacket,
  queries: {
    macro: string;
    event: string;
    sentiment: string;
  }
): AgentDiscussionContext {
  const summary = summarizePolymarketPacketForAgents(packet);

  if (!packet.connected) {
    return {
      ...context,
      polymarketSummary: summary,
      researchDataConsumed: [
        ...context.researchDataConsumed,
        "polymarket_unavailable",
      ],
    };
  }

  const macroOdds =
    formatPolymarketSignal(packet, queries.macro) ??
    "Polymarket did not return a macro crowd-pricing read.";
  const eventOdds =
    formatPolymarketSignal(packet, queries.event) ??
    `Polymarket did not return a live event market for ${queries.event}.`;
  const sentimentOdds =
    formatPolymarketSignal(packet, queries.sentiment) ??
    `Polymarket did not return a live sentiment market for ${queries.sentiment}.`;

  return {
    ...context,
    polymarketSummary: summary,
    researchDataConsumed: [
      ...context.researchDataConsumed,
      "polymarket:public-search",
    ],
    macroRead: `${context.macroRead} Polymarket macro odds: ${macroOdds}`,
    eventRead: `${context.eventRead} Polymarket catalyst odds: ${eventOdds}`,
    sentimentRead: `${context.sentimentRead} Polymarket crowd odds: ${sentimentOdds}`,
    influenceByAgent: {
      "AGT-MACRO-001": `${context.influenceByAgent["AGT-MACRO-001"]} Polymarket crowd odds are included as an external expectation check, not as a standalone trade trigger.`,
      "AGT-EVENT-001": `${context.influenceByAgent["AGT-EVENT-001"]} Polymarket catalyst pricing is included as a crowd-expectations check around the event window.`,
      "AGT-SENT-001": `${context.influenceByAgent["AGT-SENT-001"]} Polymarket crowd probabilities are included as a live sentiment cross-check.`,
    },
  };
}

function enrichDiscussionContextWithSecEdgar(
  context: AgentDiscussionContext,
  packet: SecEarningsPacket
): AgentDiscussionContext {
  const summary = summarizeSecEarningsPacketForAgents(packet);
  const eventPacket = packet.symbols.find(
    (symbolPacket) => symbolPacket.symbol === context.eventTicker
  );
  const latestFiling = eventPacket?.latestFiling ?? null;
  const filingContextSummary = eventPacket?.filingContext?.summary ?? null;
  const filingRead = latestFiling
    ? `SEC EDGAR latest filing: ${latestFiling.form} accepted ${
        latestFiling.acceptanceDateTime ?? latestFiling.filingDate ?? "date n/a"
      } for ${latestFiling.companyName}.${filingContextSummary ? ` Parsed filing context: ${filingContextSummary}` : ""}`
    : `SEC EDGAR found no current earnings-related filing for ${context.eventTicker}.`;

  return {
    ...context,
    secEdgarSummary: summary,
    researchDataConsumed: [
      ...context.researchDataConsumed,
      "sec:company_tickers",
      "sec:submissions",
      "sec:companyfacts",
      ...(eventPacket?.filingContext ? ["sec:filing_index", "sec:filing_document"] : []),
    ],
    eventRead: `${context.eventRead} ${filingRead}`,
    influenceByAgent: {
      ...context.influenceByAgent,
      "AGT-EVENT-001": `${context.influenceByAgent["AGT-EVENT-001"]} Treat SEC submissions and XBRL facts as the primary earnings-report trigger before sizing the catalyst trade.`,
    },
  };
}

function buildResearchDependencyStatus(input: {
  sourceId: ResearchDependencyStatus["sourceId"];
  healthy: boolean;
  summary: string;
  error?: string | null;
}): ResearchDependencyStatus {
  return {
    sourceId: input.sourceId,
    healthy: input.healthy,
    summary: input.summary,
    error: input.error ?? null,
    impact: RESEARCH_DEPENDENCY_IMPACTS[input.sourceId],
  };
}

function noteMassiveRuntimeFailure(
  context: AgentDiscussionContext,
  errorMessage: string
): AgentDiscussionContext {
  return {
    ...context,
    researchSource: "FALLBACK",
    researchPacketSummary: `Alpaca + Alpha Vantage research failed this cycle: ${errorMessage}`,
    researchDataConsumed: [...context.researchDataConsumed, "massive_runtime_failure"],
  };
}

function noteKalshiRuntimeFailure(
  context: AgentDiscussionContext,
  errorMessage: string
): AgentDiscussionContext {
  return {
    ...context,
    kalshiSummary: `Kalshi failed this cycle: ${errorMessage}`,
    researchDataConsumed: [...context.researchDataConsumed, "kalshi_runtime_failure"],
  };
}

function notePolymarketRuntimeFailure(
  context: AgentDiscussionContext,
  errorMessage: string
): AgentDiscussionContext {
  return {
    ...context,
    polymarketSummary: `Polymarket failed this cycle: ${errorMessage}`,
    researchDataConsumed: [...context.researchDataConsumed, "polymarket_runtime_failure"],
  };
}

function noteSecRuntimeFailure(
  context: AgentDiscussionContext,
  errorMessage: string
): AgentDiscussionContext {
  return {
    ...context,
    secEdgarSummary: `SEC EDGAR failed this cycle: ${errorMessage}`,
    researchDataConsumed: [...context.researchDataConsumed, "sec_runtime_failure"],
  };
}

function noteNewsApiRuntimeFailure(
  context: AgentDiscussionContext,
  errorMessage: string
): AgentDiscussionContext {
  return {
    ...context,
    newsApiSummary: `Alpha Vantage failed this cycle: ${errorMessage}`,
    researchDataConsumed: [...context.researchDataConsumed, "newsapi_runtime_failure"],
  };
}

async function hydrateDiscussionContextWithResearch(input: {
  context: AgentDiscussionContext;
}) {
  let context = input.context;
  const statuses: ResearchDependencyStatus[] = [];

  const kalshiQueries = buildKalshiRuntimeQueries(context);
  const polymarketQueries = {
    macro: "SPY",
    event: context.eventTicker,
    sentiment: context.sentimentTicker,
  };
  const newsApiQueries = {
    macro: "US stock market Federal Reserve inflation yields",
    event: `${context.eventTicker} earnings stock catalyst`,
    sentiment: `${context.sentimentTicker} stock sentiment analyst news`,
  };

  const [
    massiveResult,
    kalshiResult,
    polymarketResult,
    secResult,
    newsApiResult,
  ] = await Promise.allSettled([
    getMassiveResearchPacket([
      "SPY",
      "QQQ",
      context.eventTicker,
      context.sentimentTicker,
    ]),
    getKalshiResearchPacket([
      kalshiQueries.macro,
      kalshiQueries.event,
      kalshiQueries.sentiment,
    ]),
    getPolymarketResearchPacket([
      polymarketQueries.macro,
      polymarketQueries.event,
      polymarketQueries.sentiment,
    ]),
    getSecEarningsPacket([context.eventTicker]),
    getNewsApiResearchPacket([
      newsApiQueries.macro,
      newsApiQueries.event,
      newsApiQueries.sentiment,
    ]),
  ]);

  if (massiveResult.status === "fulfilled") {
    context = enrichDiscussionContextWithMassive(context, massiveResult.value);
    const summary = summarizeMassivePacketForAgents(massiveResult.value);
    statuses.push(
      buildResearchDependencyStatus({
        sourceId: "MASSIVE",
        healthy: massiveResult.value.connected,
        summary,
        error: massiveResult.value.errors[0] ?? null,
      })
    );
  } else {
    const errorMessage =
      massiveResult.reason instanceof Error
        ? massiveResult.reason.message
        : "Alpaca + Alpha Vantage research request failed unexpectedly.";
    context = noteMassiveRuntimeFailure(context, errorMessage);
    statuses.push(
      buildResearchDependencyStatus({
        sourceId: "MASSIVE",
        healthy: false,
        summary: `Alpaca + Alpha Vantage research failed this cycle: ${errorMessage}`,
        error: errorMessage,
      })
    );
  }

  if (kalshiResult.status === "fulfilled") {
    context = enrichDiscussionContextWithKalshi(
      context,
      kalshiResult.value,
      kalshiQueries
    );
    const summary = summarizeKalshiPacketForAgents(kalshiResult.value);
    statuses.push(
      buildResearchDependencyStatus({
        sourceId: "KALSHI",
        healthy: kalshiResult.value.connected,
        summary,
        error: kalshiResult.value.errors[0] ?? null,
      })
    );
  } else {
    const errorMessage =
      kalshiResult.reason instanceof Error
        ? kalshiResult.reason.message
        : "Kalshi research request failed unexpectedly.";
    context = noteKalshiRuntimeFailure(context, errorMessage);
    statuses.push(
      buildResearchDependencyStatus({
        sourceId: "KALSHI",
        healthy: false,
        summary: `Kalshi failed this cycle: ${errorMessage}`,
        error: errorMessage,
      })
    );
  }

  if (polymarketResult.status === "fulfilled") {
    context = enrichDiscussionContextWithPolymarket(
      context,
      polymarketResult.value,
      polymarketQueries
    );
    const summary = summarizePolymarketPacketForAgents(polymarketResult.value);
    statuses.push(
      buildResearchDependencyStatus({
        sourceId: "POLYMARKET",
        healthy: polymarketResult.value.connected,
        summary,
        error: polymarketResult.value.errors[0] ?? null,
      })
    );
  } else {
    const errorMessage =
      polymarketResult.reason instanceof Error
        ? polymarketResult.reason.message
        : "Polymarket research request failed unexpectedly.";
    context = notePolymarketRuntimeFailure(context, errorMessage);
    statuses.push(
      buildResearchDependencyStatus({
        sourceId: "POLYMARKET",
        healthy: false,
        summary: `Polymarket failed this cycle: ${errorMessage}`,
        error: errorMessage,
      })
    );
  }

  if (secResult.status === "fulfilled") {
    context = enrichDiscussionContextWithSecEdgar(context, secResult.value);
    const summary = summarizeSecEarningsPacketForAgents(secResult.value);
    statuses.push(
      buildResearchDependencyStatus({
        sourceId: "SEC_EDGAR",
        healthy: secResult.value.connected,
        summary,
        error: secResult.value.errors[0] ?? null,
      })
    );
  } else {
    const errorMessage =
      secResult.reason instanceof Error
        ? secResult.reason.message
        : "SEC EDGAR research request failed unexpectedly.";
    context = noteSecRuntimeFailure(context, errorMessage);
    statuses.push(
      buildResearchDependencyStatus({
        sourceId: "SEC_EDGAR",
        healthy: false,
        summary: `SEC EDGAR failed this cycle: ${errorMessage}`,
        error: errorMessage,
      })
    );
  }

  if (newsApiResult.status === "fulfilled") {
    context = enrichDiscussionContextWithNewsApi(
      context,
      newsApiResult.value,
      newsApiQueries
    );
    const summary = summarizeNewsApiPacketForAgents(newsApiResult.value);
    statuses.push(
      buildResearchDependencyStatus({
        sourceId: "NEWSAPI",
        healthy: newsApiResult.value.connected,
        summary,
        error: newsApiResult.value.errors[0] ?? null,
      })
    );
  } else {
    const errorMessage =
      newsApiResult.reason instanceof Error
        ? newsApiResult.reason.message
        : "Alpha Vantage research request failed unexpectedly.";
    context = noteNewsApiRuntimeFailure(context, errorMessage);
    statuses.push(
      buildResearchDependencyStatus({
        sourceId: "NEWSAPI",
        healthy: false,
        summary: `Alpha Vantage failed this cycle: ${errorMessage}`,
        error: errorMessage,
      })
    );
  }

  return {
    context,
    statuses,
  };
}

async function buildResearchDependencyStatusMessages(input: {
  cycleId: number;
  session: RuntimeSessionSnapshot;
  regime: string;
  statuses: ResearchDependencyStatus[];
}) {
  const degraded = input.statuses.filter((status) => !status.healthy);

  if (degraded.length === 0) {
    return [] as PaperRuntimeMessageSeed[];
  }

  const healthyLabels = input.statuses
    .filter((status) => status.healthy)
    .map((status) => RESEARCH_DEPENDENCY_LABELS[status.sourceId]);
  const degradedLabels = degraded.map(
    (status) => RESEARCH_DEPENDENCY_LABELS[status.sourceId]
  );

  return renderPendingMessages([
    {
      senderId: "AGT-RESEARCH",
      messageType: "SYSTEM_STATUS",
      priority:
        degraded.length >= 2 ||
        degraded.some(
          (status) =>
            status.sourceId === "MASSIVE" || status.sourceId === "SEC_EDGAR"
        )
          ? "HIGH"
          : "MEDIUM",
      renderType: "alert",
      voiceDraft: {
        id: createVoiceDraftId(
          input.cycleId,
          "dependency-status",
          input.session.phase,
          degradedLabels.join("-")
        ),
        senderId: "AGT-RESEARCH",
        senderRole: "Research Analyst",
        messageType: "SYSTEM_STATUS",
        priority:
          degraded.length >= 2 ||
          degraded.some(
            (status) =>
              status.sourceId === "MASSIVE" || status.sourceId === "SEC_EDGAR"
          )
            ? "HIGH"
            : "MEDIUM",
        observation: buildDependencyObservation(
          degradedLabels,
          `${input.cycleId}:dependency:${degradedLabels.join("|")}`
        ),
        whyItMatters: buildDependencyWhyItMatters(
          healthyLabels,
          `${input.cycleId}:dependency:healthy:${healthyLabels.join("|")}`
        ) + ` ${buildDependencyFailureCauseNote(degraded) ?? ""}`.trimEnd(),
        conviction: getConfidencePhrase(88, `${input.cycleId}:dependency:conviction`),
        changeMind:
          "If the next cycle comes back clean, this warning should disappear on its own.",
        facts: {
          phase: input.session.phase,
          regime: input.regime,
          degradedProviders: degraded,
          healthyProviders: healthyLabels,
        },
      },
      reasoning:
        "Provider degradation should be visible to the desk without freezing the rest of the runtime.",
      payload: {
        cycleId: input.cycleId,
        phase: input.session.phase,
        regime: input.regime,
        collaborationModel: "autonomous_blackboard_turns",
        degradedProviders: degraded,
        healthyProviders: healthyLabels,
        ...withMessageCooldown(
          {},
          "research:dependency-status",
          input.session.phase === "OVERNIGHT" ? 25 : 10
        ),
      },
      decision: {
        agentId: "AGT-RESEARCH",
        actionTaken: "publish_degraded_dependency_status",
        reasoning:
          "The desk should know when a source is degraded, but source failures should not block the rest of the cycle.",
        dataConsumed: degraded.map(
          (status) => `${status.sourceId}:${status.error ?? status.summary}`
        ),
        confidenceScore: 88,
      },
    },
  ]);
}

async function buildDeterministicDiscussionBackfill(input: {
  cycleId: number;
  cycleIndex: number;
  session: RuntimeSessionSnapshot;
  regime: string;
  marketContext?: AgentDecisionMarketContext | null;
  dependencyStatuses?: ResearchDependencyStatus[];
  watchOnlyReason?: string | null;
}) {
  const discussionRegime = normalizeDiscussionRegime(input.regime);
  const discussionContext = buildAgentDiscussionContextFromMarketContext({
    cycleIndex: input.cycleIndex,
    regime: discussionRegime,
    marketContext: input.marketContext ?? null,
  });
  const discussionPlan = buildDeskDiscussionPlan({
    context: discussionContext,
    session: input.session,
    regime: discussionRegime,
  });
  const activeAgentIds = getConversationActiveAgentIds(input.session);
  const dependencyStatuses = input.dependencyStatuses ?? [];
  const plannerMessages = await generateAutonomousConversationPlan({
    activeAgentIds,
    addressableAgentIds: activeAgentIds,
    maxMessages: activeAgentIds.length <= 2 ? 4 : 8,
    context: {
      session: summarizeConversationSession(input.session),
      regime: discussionRegime,
      discussion: {
        threadId: discussionContext.threadId,
        researchArea: discussionContext.researchArea,
        eventTicker: discussionContext.eventTicker,
        sentimentTicker: discussionContext.sentimentTicker,
        researchSource: discussionContext.researchSource,
        researchPacketSummary: discussionContext.researchPacketSummary,
        macroRead: discussionContext.macroRead,
        eventRead: discussionContext.eventRead,
        sentimentRead: discussionContext.sentimentRead,
        kalshiSummary: discussionContext.kalshiSummary,
        polymarketSummary: discussionContext.polymarketSummary,
        newsApiSummary: discussionContext.newsApiSummary,
        secEdgarSummary: discussionContext.secEdgarSummary,
      },
      suggestedAngles: {
        research: {
          observation: discussionPlan.research.observation,
          whyItMatters: discussionPlan.research.whyItMatters,
          changeMind: discussionPlan.research.changeMind,
          confidenceScore: discussionPlan.research.confidenceScore,
          influenceNotes: discussionPlan.research.influenceNotes,
        },
        macro: discussionPlan.macro,
        event: discussionPlan.event,
        sentiment: discussionPlan.sentiment,
        cio: discussionPlan.cio,
      },
      dependencyStatuses: dependencyStatuses.map((status) => ({
        sourceId: status.sourceId,
        healthy: status.healthy,
        summary: status.summary,
        error: status.error,
        impact: status.impact,
      })),
      watchMode: input.watchOnlyReason
        ? {
            enabled: true,
            reason: input.watchOnlyReason,
            tradingEnabled: false,
            allocatorEnabled: false,
          }
        : {
            enabled: false,
          },
      notes: [
        "Write the actual internal desk conversation for this cycle in each agent's own voice.",
        "Use the suggested angles as scaffolding, not as a script or a required speaking order.",
        "If the desk sees a hole in the thesis, a missing catalyst, or a contradiction between sleeves, someone should usually ask a direct question rather than only narrating the issue.",
        input.watchOnlyReason
          ? "This pass is watch-only. Agents can discuss what matters and what would change their minds, but nobody can claim a fresh allocation, approval, or routed order happened."
          : "Only send a message when it would materially improve the desk's understanding.",
      ],
    },
  });
  const renderedPlannerMessages = plannerMessages
    .filter(
      (message) =>
        !(input.watchOnlyReason && message.messageType === "ALLOCATION_CHANGE")
    )
    .map((message) => {
      const decisionSnapshot = getDiscussionBackfillDecisionSnapshot({
        agentId: message.senderId,
        context: discussionContext,
        plan: discussionPlan,
        dependencyStatuses,
        watchOnly: Boolean(input.watchOnlyReason),
      });

      return {
        senderId: message.senderId,
        recipientId: message.recipientId,
        messageType: message.messageType,
        priority: message.priority,
        renderType: message.renderType,
        content: message.content,
        reasoning: message.reasoning,
        requiresResponse: message.requiresResponse,
        payload: {
          cycleId: input.cycleId,
          phase: input.session.phase,
          regime: discussionRegime,
          conversationSource: input.watchOnlyReason
            ? "MODEL_WATCH_ONLY_DISCUSSION"
            : "MODEL_DISCUSSION_BACKFILL",
          agentDecisionSource: "MODEL",
          ...(input.watchOnlyReason
            ? {
                decisionFallback: "WATCH_ONLY_DISCUSSION",
              }
            : {}),
        },
        decision: {
          agentId: message.senderId,
          actionTaken: getAutonomousConversationActionTaken(message.messageType),
          reasoning: message.reasoning,
          dataConsumed: decisionSnapshot.dataConsumed,
          confidenceScore: decisionSnapshot.confidenceScore,
        },
      } satisfies PaperRuntimeMessageSeed;
    })
    .filter((message) => message.content.trim().length > 0);

  if (renderedPlannerMessages.length > 0) {
    return renderedPlannerMessages;
  }

  const deterministicMessages = (
    await buildDiscussionMessages({
      cycleId: input.cycleId,
      session: input.session,
      regime: discussionRegime,
      context: discussionContext,
      plan: discussionPlan,
    })
  ).renderedMessages;

  return deterministicMessages.map((message) => ({
    ...message,
    payload: {
      ...message.payload,
      conversationSource: "DETERMINISTIC_DISCUSSION_BACKFILL",
      ...(input.watchOnlyReason
        ? {
            decisionFallback: "WATCH_ONLY_DISCUSSION",
          }
        : {}),
    },
  }));
}

async function buildDecisioningDegradedMessages(input: {
  cycleId: number;
  session: RuntimeSessionSnapshot;
  regime: string;
  errorMessage: string;
  dependencyStatuses: ResearchDependencyStatus[];
}) {
  return renderPendingMessages([
    {
      senderId: "AGT-RESEARCH",
      messageType: "SYSTEM_STATUS",
      priority: "HIGH",
      renderType: "alert",
      voiceDraft: {
        id: createVoiceDraftId(
          input.cycleId,
          "decisioning-degraded",
          input.session.phase
        ),
        senderId: "AGT-RESEARCH",
        senderRole: "Research Analyst",
        messageType: "SYSTEM_STATUS",
        priority: "HIGH",
        observation:
          "I couldn't get a clean allocator packet, so this pass stays in watch mode.",
        whyItMatters:
          `The desk can still share research and monitor coverage, but ensemble decisions and research-event publication are paused for this cycle: ${input.errorMessage}`,
        conviction: getConfidencePhrase(93),
        changeMind:
          "If the next cycle lands a valid decision set, normal ensemble review and publication flow can resume without treating this as a thesis change.",
        facts: {
          failureStage: "DECISION_SET",
          phase: input.session.phase,
          regime: input.regime,
          error: input.errorMessage,
          dependencyStatuses: input.dependencyStatuses,
        },
      },
      reasoning:
        "Decision-model failures should degrade into observation mode with visible desk context, not disappear behind a runtime alert.",
      payload: {
        cycleId: input.cycleId,
        failureStage: "DECISION_SET",
        phase: input.session.phase,
        regime: input.regime,
        collaborationModel: "autonomous_blackboard_turns",
        decisionFallback: "WATCH_ONLY_DISCUSSION",
        error: input.errorMessage,
        dependencyStatuses: input.dependencyStatuses,
      },
      decision: {
        agentId: "AGT-RESEARCH",
        actionTaken: "publish_decisioning_degradation_notice",
        reasoning:
          "The desk should keep seeing research and discussion when the decision model misfires, while execution stays safely disabled for that pass.",
        dataConsumed: [
          input.errorMessage,
          ...input.dependencyStatuses.map(
            (status) => `${status.sourceId}:${status.error ?? status.summary}`
          ),
        ],
        confidenceScore: 93,
      },
    },
  ]);
}

async function persistCycleRuntimeFailure(input: {
  cycleId: number;
  cycleIndex: number;
  failureStage: string;
  session: RuntimeSessionSnapshot;
  regime: string;
  errorMessage: string;
  dependencyStatuses: ResearchDependencyStatus[];
}) {
  return withAgentTransaction(async (client) => {
    const createdAt = new Date();
    const content = await renderVoiceDraft({
      id: createVoiceDraftId(input.cycleId, "runtime-failure", input.session.phase),
      senderId: "AGT-RESEARCH",
      senderRole: "Research Analyst",
      messageType: "SYSTEM_STATUS",
      priority: "HIGH",
      observation:
        "This cycle hit an internal runtime failure before the full desk conversation could finish.",
      whyItMatters: `The loop should keep going, but this pass is degraded: ${input.errorMessage}`,
      conviction: getConfidencePhrase(95),
      changeMind:
        "If the next cycle runs clean, treat this as a runtime miss rather than a market change.",
      facts: {
        failureStage: input.failureStage,
        phase: input.session.phase,
        regime: input.regime,
        error: input.errorMessage,
        dependencyStatuses: input.dependencyStatuses,
      },
    });

    const messageId = await insertAgentMessage(client, {
      cycleId: input.cycleId,
      senderId: "AGT-RESEARCH",
      messageType: "SYSTEM_STATUS",
      priority: "HIGH",
      renderType: "alert",
      content,
      reasoning:
        "Unexpected runtime failures should be persisted as degraded-cycle status instead of disappearing behind a worker 500.",
      payload: {
        cycleId: input.cycleId,
        failureStage: input.failureStage,
        phase: input.session.phase,
        regime: input.regime,
        collaborationModel: "autonomous_blackboard_turns",
        error: input.errorMessage,
        dependencyStatuses: input.dependencyStatuses,
      },
      createdAt,
    });

    await insertAgentDecision(client, {
      cycleId: input.cycleId,
      agentId: "AGT-RESEARCH",
      relatedMessageId: messageId,
      actionTaken: "record_cycle_runtime_failure",
      reasoning:
        "The runtime should leave a visible failure artifact and keep the worker loop alive.",
      dataConsumed: [
        `failureStage:${input.failureStage}`,
        input.errorMessage,
        ...input.dependencyStatuses.map(
          (status) => `${status.sourceId}:${status.error ?? status.summary}`
        ),
      ],
      confidenceScore: 95,
      createdAt,
    });

    const failureArtifact = buildRuntimeFailureArtifact({
      failureStage: input.failureStage,
      session: input.session,
      regime: input.regime,
      errorMessage: input.errorMessage,
      dependencyStatuses: input.dependencyStatuses,
    });
    await upsertAgentCycleArtifact(client, {
      cycleId: input.cycleId,
      artifactScope: failureArtifact.artifactScope,
      artifactKey: failureArtifact.artifactKey,
      storageTier: failureArtifact.storageTier,
      summary: failureArtifact.summary,
      payload: failureArtifact.payload,
      createdAt,
    });

    const cycle = await completePaperCycle(
      client,
      input.cycleId,
      `Research cycle ${input.cycleIndex} degraded during ${input.failureStage} under ${input.regime}: ${input.errorMessage}`
    );

    return {
      cycle,
      insertedMessages: 1,
    };
  });
}

async function buildCioAllocationDecisions(input: {
  session: RuntimeSessionSnapshot;
  regime: (typeof REGIMES)[number];
  brokerCapitalState: {
    portfolioValue: number | null;
    buyingPower: number | null;
  } | null;
}) {
  const brokerSnapshot = await getBrokerDashboardSnapshot();
  const metrics = await getCioAllocationInputs(brokerSnapshot);

  if (metrics.length === 0) {
    return [];
  }

  const portfolioValue =
    input.brokerCapitalState?.portfolioValue ?? brokerSnapshot.account?.portfolioValue ?? null;
  const buyingPower =
    input.brokerCapitalState?.buyingPower ?? brokerSnapshot.account?.buyingPower ?? null;
  const attributedExposureUsd = metrics.reduce(
    (sum, agent) => sum + Math.abs(agent.attributedMarketValue ?? 0),
    0
  );
  const deployableCapital = computeDeployableCapital({
    portfolioValue,
    buyingPower,
    attributedExposureUsd,
  });

  if (deployableCapital <= 0) {
    return [];
  }

  const scoredAgents = metrics.map((metric) => {
    const score = computeAgentAllocationScore({
      regime: input.regime,
      metrics: metric,
      deployableCapital,
    });

    return {
      metric,
      score,
      weight: 0.45 + score.composite,
    };
  });

  const normalizedAllocations = normalizeAllocations(
    scoredAgents.map(({ metric, weight }) => ({
      agentId: metric.agentId,
      weight,
    })),
    deployableCapital
  );

  return scoredAgents
    .map(({ metric, score }) => {
      const previousAllocationUsd = metric.currentAllocationUsd;
      const newAllocationUsd = normalizedAllocations.get(metric.agentId) ?? 0;
      const decisionCoverage = [
        portfolioValue,
        buyingPower,
        metric.averageConfidenceScore,
        metric.attributedMarketValue,
        metric.recentAcceptedOrderCount,
        metric.recentMessageCount,
      ].filter((value) => value !== null && value !== undefined).length;
      const confidenceScore = Math.round(clamp(58 + decisionCoverage * 5, 58, 91));
      const rationale = `${metric.displayName} scored ${Math.round(
        score.composite * 100
      )}/100 for the ${input.regime} regime using real broker capacity, recent activity, decision confidence, and attributable exposure.`;

      return {
        agentId: metric.agentId,
        agentName: metric.displayName,
        strategyCategory: metric.strategyCategory,
        previousAllocationUsd,
        newAllocationUsd,
        score,
        rationale,
        confidenceScore,
        inputs: {
          phase: input.session.phase,
          regime: input.regime,
          portfolioValue,
          buyingPower,
          deployableCapital,
          attributedExposureUsd,
          recentMessageCount: metric.recentMessageCount,
          highPriorityMessageCount: metric.highPriorityMessageCount,
          recentOrderCount: metric.recentOrderCount,
          recentAcceptedOrderCount: metric.recentAcceptedOrderCount,
          averageConfidenceScore: metric.averageConfidenceScore,
          attributedMarketValue: metric.attributedMarketValue,
          attributedUnrealizedPl: metric.attributedUnrealizedPl,
          positionCount: metric.positionCount,
          score,
        },
      } satisfies CioAllocationDecision;
    })
    .filter(
      (decision) =>
        decision.previousAllocationUsd === null ||
        Math.abs(decision.newAllocationUsd - decision.previousAllocationUsd) >= 100
    )
    .sort((left, right) => right.newAllocationUsd - left.newAllocationUsd);
}

async function buildCioAllocationMessages(input: {
  cycleId: number;
  session: RuntimeSessionSnapshot;
  decisions: CioAllocationDecision[];
}) {
  const guardrails = getSleeveRiskGuardrails();
  const pendingMessages = input.decisions.map((decision) => {
    const previousAllocation = decision.previousAllocationUsd;
    const delta = decision.newAllocationUsd - (previousAllocation ?? 0);
    const direction = delta >= 0 ? "increased" : "reduced";
    const absoluteDelta = Math.abs(delta).toLocaleString("en-US", {
      maximumFractionDigits: 0,
    });
    const newTarget = decision.newAllocationUsd.toLocaleString("en-US", {
      maximumFractionDigits: 0,
    });

    return {
      senderId: "AGT-CIO",
      recipientId: decision.agentId,
      messageType: "ALLOCATION_CHANGE",
      priority:
        input.session.phase === "PRE_MARKET" || input.session.phase === "POST_MARKET"
          ? "HIGH"
          : "MEDIUM",
      renderType: "action",
      voiceDraft: {
        id: createVoiceDraftId(
          input.cycleId,
          "allocation",
          decision.agentId,
          previousAllocation === null ? "new" : direction
        ),
        senderId: "AGT-CIO",
        senderRole: "Chief Research Officer",
        recipientId: decision.agentId,
        messageType: "ALLOCATION_CHANGE",
        priority:
          input.session.phase === "PRE_MARKET" || input.session.phase === "POST_MARKET"
            ? "HIGH"
            : "MEDIUM",
        observation:
          previousAllocation === null
            ? `I'm setting ${decision.agentId} at $${newTarget} for the ${input.session.label.toLowerCase()} window.`
            : `I'm ${direction === "increased" ? "adding" : "cutting"} ${decision.agentId} by $${absoluteDelta} and taking the sleeve to $${newTarget}.`,
        whyItMatters: decision.rationale,
        conviction: getConfidencePhrase(decision.confidenceScore),
        changeMind:
          "If broker capacity, live exposure, or the regime read shifts materially, I would revisit the target.",
        facts: {
          phase: input.session.phase,
          previousAllocationUsd: decision.previousAllocationUsd,
          newAllocationUsd: decision.newAllocationUsd,
          guardrails,
          score: decision.score,
        },
      },
      reasoning: decision.rationale,
      payload: {
        cycleId: input.cycleId,
        phase: input.session.phase,
        agentId: decision.agentId,
        previousAllocationUsd: decision.previousAllocationUsd,
        newAllocationUsd: decision.newAllocationUsd,
        guardrails: {
          maxSingleOrderPctOfAllocation:
            guardrails.maxSingleOrderPctOfAllocation,
          maxSleeveUtilizationPct: guardrails.maxSleeveUtilizationPct,
          maxPortfolioGrossExposurePct:
            guardrails.maxPortfolioGrossExposurePct,
        },
        cioTradeApproval: false,
        inputs: decision.inputs,
        score: decision.score,
      },
      decision: {
        agentId: "AGT-CIO",
        actionTaken: "set_target_allocation",
        reasoning: decision.rationale,
        dataConsumed: [
          `portfolioValue:${String(decision.inputs.portfolioValue ?? "n/a")}`,
          `buyingPower:${String(decision.inputs.buyingPower ?? "n/a")}`,
          `recentOrders:${String(decision.inputs.recentAcceptedOrderCount ?? 0)}`,
          `avgConfidence:${String(decision.inputs.averageConfidenceScore ?? "n/a")}`,
          `attributedExposure:${String(decision.inputs.attributedMarketValue ?? "n/a")}`,
        ],
        confidenceScore: decision.confidenceScore,
      },
    } satisfies PendingPaperRuntimeMessageSeed;
  });

  return renderPendingMessages(pendingMessages);
}

async function buildDiscussionMessages(input: {
  cycleId: number;
  session: RuntimeSessionSnapshot;
  regime: (typeof REGIMES)[number];
  context: AgentDiscussionContext;
  plan: DeskDiscussionPlan;
}) {
  const { cycleId, session, regime, context, plan } = input;
  const basePayload = {
    cycleId,
    phase: session.phase,
    regime,
    threadId: context.threadId,
    researchSource: context.researchSource,
    researchPacketSummary: context.researchPacketSummary,
    kalshiSummary: context.kalshiSummary,
    polymarketSummary: context.polymarketSummary,
    newsApiSummary: context.newsApiSummary,
    secEdgarSummary: context.secEdgarSummary,
    collaborationModel: "autonomous_blackboard_turns",
    discussionPolicy:
      "Agents may share findings and decision influence through the bus, while each trading sleeve owns its own orders.",
  };

  if (session.phase === "NON_TRADING_DAY") {
    return runAutonomousAgentTurnsDetailed({
      cycleId,
      session,
      regime,
      context,
      basePayload,
      turns: [
        {
          id: "weekend-cio-priority-note",
          agentId: "AGT-CIO",
          run: (blackboard) => ({
            senderId: "AGT-CIO",
            recipientId: "AGT-RESEARCH",
            messageType: "DISCUSSION",
              priority: "MEDIUM",
              renderType: "message",
              voiceDraft: {
                id: createVoiceDraftId(
                  cycleId,
                "discussion",
                "weekend",
                "cio",
                "research"
              ),
              senderId: "AGT-CIO",
              senderRole: "Chief Research Officer",
              recipientId: "AGT-RESEARCH",
              messageType: "DISCUSSION",
              priority: "MEDIUM",
              observation:
                "This weekend, keep the work tied to what could actually move sleeve allocations, not one-off action ideas.",
              whyItMatters:
                "With research sleeves asleep, the useful output is a cleaner ranking of what would actually change capital.",
              conviction: getConfidencePhrase(73),
              changeMind:
                "If something genuinely binary hits over the weekend, we can get more tactical.",
              facts: {
                phase: session.phase,
                regime,
                researchArea: context.researchArea,
              },
            },
            reasoning:
              "The research lead leaves weekend direction on the blackboard while the research sleeves stay inactive.",
            payload: {
              ...withAutonomousBlackboardPayload(blackboard, []),
              influences: [
                {
                  targetAgentId: "AGT-RESEARCH",
                  decisionArea: "research_prioritization",
                  effect: "Rank findings by allocation impact.",
                },
              ],
            },
            decision: {
              agentId: "AGT-CIO",
              actionTaken: "shape_weekend_research_discussion",
              reasoning:
                "The research lead can influence research priority without approving individual orders.",
              dataConsumed: ["allocation state", "research backlog", regime],
              confidenceScore: 73,
            },
          }),
        },
      ],
    });
  }

  const turns: AutonomousAgentTurn[] = [
    {
      id: "research-cross-sleeve-brief",
      agentId: "AGT-RESEARCH",
      run: (blackboard) => ({
        senderId: "AGT-RESEARCH",
        messageType: "DISCUSSION",
        priority: "HIGH",
        renderType: "message",
        voiceDraft: {
          id: createVoiceDraftId(cycleId, "discussion", "desk", "research"),
          senderId: "AGT-RESEARCH",
          senderRole: "Research Analyst",
          messageType: "DISCUSSION",
          priority: "HIGH",
          observation: plan.research.observation,
          whyItMatters: plan.research.whyItMatters,
          conviction: getConfidencePhrase(plan.research.confidenceScore),
          changeMind: plan.research.changeMind,
          facts: {
            phase: session.phase,
            regime,
            researchArea: context.researchArea,
            sentimentTicker: context.sentimentTicker,
          },
        },
        reasoning:
          "Research is publishing shared blackboard context so each sleeve can adjust its own decision model without waiting for direct coordination.",
        payload: {
          ...withAutonomousBlackboardPayload(blackboard, []),
          ...withMessageCooldown(
            {},
            `research:desk-brief:${session.phase.toLowerCase()}`,
            session.phase === "MARKET" ? 8 : 12
          ),
          deliveredTradeBiases: buildResearchDeliveredTradeBiases(plan),
          influences: [
            {
              targetAgentId: "AGT-MACRO-001",
              decisionArea: "macro_sizing",
              effect: plan.research.influenceNotes["AGT-MACRO-001"],
            },
            {
              targetAgentId: "AGT-EVENT-001",
              decisionArea: "event_confidence",
              effect: plan.research.influenceNotes["AGT-EVENT-001"],
            },
            {
              targetAgentId: "AGT-SENT-001",
              decisionArea: "sentiment_filtering",
              effect: plan.research.influenceNotes["AGT-SENT-001"],
            },
          ],
        },
        decision: {
          agentId: "AGT-RESEARCH",
          actionTaken: "broadcast_cross_sleeve_discussion_context",
          reasoning:
            "A shared research packet lets agents influence one another through evidence rather than direct order coordination.",
          dataConsumed: [
            context.researchArea,
            regime,
            context.sentimentTicker,
            ...plan.research.dataConsumed,
          ],
          confidenceScore: plan.research.confidenceScore,
        },
      }),
    },
    {
      id: "macro-risk-lens",
      agentId: "AGT-MACRO-001",
      run: (blackboard) => ({
        senderId: "AGT-MACRO-001",
        recipientId: "AGT-EVENT-001",
        messageType: "DISCUSSION",
        priority: "MEDIUM",
        renderType: "message",
        voiceDraft: {
          id: createVoiceDraftId(cycleId, "discussion", "macro", "event"),
          senderId: "AGT-MACRO-001",
          senderRole: "Global Macro Researcher",
          recipientId: "AGT-EVENT-001",
          messageType: "DISCUSSION",
          priority: "MEDIUM",
          observation: plan.macro.observation,
          whyItMatters: plan.macro.whyItMatters,
          conviction: getConfidencePhrase(plan.macro.confidenceScore),
          changeMind: plan.macro.changeMind,
          facts: {
            phase: session.phase,
            regime,
            eventTicker: context.eventTicker,
          },
        },
        reasoning:
          "Macro is taking its own turn and sharing a risk lens that can influence event confidence without requesting a shared position.",
        payload: {
          ...withAutonomousBlackboardPayload(blackboard, ["AGT-RESEARCH"]),
          deliveredTradeBiases: buildMacroDeliveredTradeBiases(plan),
          influences: [
            {
              targetAgentId: "AGT-EVENT-001",
              decisionArea: "catalyst_position_sizing",
              effect: plan.macro.influenceEffect,
            },
          ],
        },
        decision: {
          agentId: "AGT-MACRO-001",
          actionTaken: "share_macro_risk_lens",
          reasoning:
            "Event trades should account for macro regime risk when a catalyst depends on financing or cyclicality.",
          dataConsumed: [
            "rates curve",
            "credit spreads",
            regime,
            ...plan.macro.dataConsumed,
            ...getBlackboardDataConsumed(blackboard, ["AGT-RESEARCH"]),
          ],
          confidenceScore: plan.macro.confidenceScore,
        },
      }),
    },
    {
      id: "event-catalyst-filter",
      agentId: "AGT-EVENT-001",
      run: (blackboard) => ({
        senderId: "AGT-EVENT-001",
        recipientId: "AGT-SENT-001",
        messageType: "DISCUSSION",
        priority: "MEDIUM",
        renderType: "message",
        voiceDraft: {
          id: createVoiceDraftId(cycleId, "discussion", "event", "sentiment"),
          senderId: "AGT-EVENT-001",
          senderRole: "Event-Driven Researcher",
          recipientId: "AGT-SENT-001",
          messageType: "DISCUSSION",
          priority: "MEDIUM",
          observation: plan.event.observation,
          whyItMatters: plan.event.whyItMatters,
          conviction: getConfidencePhrase(plan.event.confidenceScore),
          changeMind: plan.event.changeMind,
          facts: {
            phase: session.phase,
            regime,
            eventTicker: context.eventTicker,
          },
        },
        reasoning:
          "The event sleeve is working off the shared blackboard and feeding a timing filter into the sentiment sleeve, not asking for coordination.",
        payload: {
          ...withAutonomousBlackboardPayload(blackboard, [
            "AGT-RESEARCH",
            "AGT-MACRO-001",
          ]),
          deliveredTradeBiases: buildEventDeliveredTradeBiases(plan),
          influences: [
            {
              targetAgentId: "AGT-SENT-001",
              decisionArea: "sentiment_quality_filter",
              effect: plan.event.influenceEffect,
            },
          ],
        },
        decision: {
          agentId: "AGT-EVENT-001",
          actionTaken: "share_catalyst_timing_filter",
          reasoning:
            "Sentiment quality improves when narrative shifts are tied to verified events.",
          dataConsumed: [
            "event calendar",
            context.eventTicker,
            "filing status",
            ...plan.event.dataConsumed,
            ...getBlackboardDataConsumed(blackboard, [
              "AGT-RESEARCH",
              "AGT-MACRO-001",
            ]),
          ],
          confidenceScore: plan.event.confidenceScore,
        },
      }),
    },
    {
      id: "sentiment-crowding-overlay",
      agentId: "AGT-SENT-001",
      run: (blackboard) => ({
        senderId: "AGT-SENT-001",
        recipientId: "AGT-MACRO-001",
        messageType: "DISCUSSION",
        priority: context.sentimentScore >= 70 ? "HIGH" : "MEDIUM",
        renderType: "message",
        voiceDraft: {
          id: createVoiceDraftId(cycleId, "discussion", "sentiment", "macro"),
          senderId: "AGT-SENT-001",
          senderRole: "Sentiment Researcher",
          recipientId: "AGT-MACRO-001",
          messageType: "DISCUSSION",
          priority: context.sentimentScore >= 70 ? "HIGH" : "MEDIUM",
          observation: plan.sentiment.observation,
          whyItMatters: plan.sentiment.whyItMatters,
          conviction: getConfidencePhrase(plan.sentiment.confidenceScore),
          changeMind: plan.sentiment.changeMind,
          facts: {
            phase: session.phase,
            regime,
            sentimentTicker: context.sentimentTicker,
            sentimentScore: context.sentimentScore,
          },
        },
        reasoning:
          "The sentiment sleeve is acting autonomously but still feeding crowding risk back into the macro sleeve through the blackboard.",
        payload: {
          ...withAutonomousBlackboardPayload(blackboard, [
            "AGT-RESEARCH",
            "AGT-EVENT-001",
          ]),
          sentimentScore: context.sentimentScore,
          deliveredTradeBiases: buildSentimentDeliveredTradeBiases(plan),
          influences: [
            {
              targetAgentId: "AGT-MACRO-001",
              decisionArea: "beta_confidence",
              effect: plan.sentiment.influenceEffect,
            },
          ],
        },
        decision: {
          agentId: "AGT-SENT-001",
          actionTaken: "share_sentiment_crowding_overlay",
          reasoning:
            "Macro can use sentiment crowding as a fragility overlay before sizing index exposure.",
          dataConsumed: [
            "news sentiment",
            "options flow",
            context.sentimentTicker,
            ...plan.sentiment.dataConsumed,
            ...getBlackboardDataConsumed(blackboard, [
              "AGT-RESEARCH",
              "AGT-EVENT-001",
            ]),
          ],
          confidenceScore: plan.sentiment.confidenceScore,
        },
      }),
    },
  ];

  if (
    session.phase === "PRE_MARKET" ||
    session.phase === "POST_MARKET" ||
    session.phase === "OVERNIGHT"
  ) {
    turns.push({
      id: `${session.phase.toLowerCase()}-cio-boundary`,
      agentId: "AGT-CIO",
      run: (blackboard) => ({
        senderId: "AGT-CIO",
        messageType: "DISCUSSION",
        priority: "MEDIUM",
        renderType: "thought",
        voiceDraft: {
          id: createVoiceDraftId(cycleId, "discussion", session.phase, "cio", "desk"),
          senderId: "AGT-CIO",
          senderRole: "Chief Research Officer",
          messageType: "DISCUSSION",
          priority: "MEDIUM",
          observation: plan.cio.observation,
          whyItMatters: plan.cio.whyItMatters,
          conviction: getConfidencePhrase(plan.cio.confidenceScore),
          changeMind: plan.cio.changeMind,
          facts: {
            phase: session.phase,
            regime,
          },
        },
        reasoning:
          "The allocator takes its own turn after reading the desk blackboard and makes the capital boundary explicit.",
        payload: {
          ...withAutonomousBlackboardPayload(blackboard, [
            "AGT-RESEARCH",
            "AGT-MACRO-001",
            "AGT-EVENT-001",
            "AGT-SENT-001",
          ]),
          deliveredTradeBiases: buildCioDeliveredTradeBiases(plan),
          influences: [
            {
              targetAgentId: "AGT-CIO",
              decisionArea: "sleeve_allocation",
              effect: plan.cio.allocationBoundary,
            },
          ],
        },
        decision: {
          agentId: "AGT-CIO",
          actionTaken: "acknowledge_discussion_in_allocation_context",
          reasoning:
            "Discussion should influence allocator judgment at the sleeve level while preserving autonomous research judgment.",
          dataConsumed: [
            context.threadId,
            "sleeve guardrails",
            regime,
            plan.cio.allocationBoundary,
            ...getBlackboardDataConsumed(blackboard, [
              "AGT-RESEARCH",
              "AGT-MACRO-001",
              "AGT-EVENT-001",
              "AGT-SENT-001",
            ]),
          ],
          confidenceScore: plan.cio.confidenceScore,
        },
      }),
    });
  }

  return runAutonomousAgentTurnsDetailed({
    cycleId,
    session,
    regime,
    context,
    basePayload,
    turns,
  });
}

async function buildBaselineMessages(input: {
  cycleId: number;
  cycleIndex: number;
  session: RuntimeSessionSnapshot;
  regime: string;
  brokerConfigured: boolean;
  riskMonitor: OvernightRiskMonitorSnapshot;
}) {
  const { cycleId, cycleIndex, session, regime, brokerConfigured, riskMonitor } =
    input;
  const eventTicker = EVENT_NAMES[(cycleIndex - 1) % EVENT_NAMES.length];
  const sentimentTicker = SENTIMENT_NAMES[(cycleIndex - 1) % SENTIMENT_NAMES.length];
  const researchArea = RESEARCH_AREAS[(cycleIndex - 1) % RESEARCH_AREAS.length];
  const sentimentScore = 48 + ((cycleIndex * 11) % 39);

  if (session.phase === "OVERNIGHT") {
    const messages: PendingPaperRuntimeMessageSeed[] = [
      {
        senderId: "AGT-RESEARCH",
        recipientId: "AGT-CIO",
        messageType: "RESEARCH_REPORT",
        priority: "HIGH",
        renderType: "thought",
        voiceDraft: {
          id: createVoiceDraftId(cycleId, "baseline", "overnight", "research-report"),
          senderId: "AGT-RESEARCH",
          senderRole: "Research Analyst",
          recipientId: "AGT-CIO",
          messageType: "RESEARCH_REPORT",
          priority: "HIGH",
          observation: buildOvernightFocusObservation(
            researchArea,
            `${cycleId}:overnight-baseline:focus`
          ),
          whyItMatters: buildOvernightFocusWhyItMatters(
            researchArea,
            `${cycleId}:overnight-baseline:why`
          ),
          conviction: getConfidencePhrase(
            81,
            `${cycleId}:overnight-baseline:conviction`
          ),
          changeMind: buildOvernightFocusChangeMind(
            `${cycleId}:overnight-baseline:change-mind`
          ),
          facts: {
            phase: session.phase,
            regime,
            researchArea,
          },
        },
        reasoning:
          "Research stays on synthesis overnight while the research sleeves remain asleep until the next trader session.",
        payload: {
          cycleId,
          regime,
          researchArea,
          phase: session.phase,
          ...withMessageCooldown({}, "research:overnight-lean", 20),
        },
        decision: {
          agentId: "AGT-RESEARCH",
          actionTaken: "curate_overnight_research",
          reasoning:
            "Overnight research is more useful when it can immediately reframe the staffed desk's prep for the next trading window.",
          dataConsumed: [
            "overnight news",
            "global macro headlines",
            researchArea,
          ],
          confidenceScore: 81,
        },
      },
      {
        senderId: "AGT-CIO",
        messageType: "SYSTEM_STATUS",
        priority: "MEDIUM",
        renderType: "thought",
        voiceDraft: {
          id: createVoiceDraftId(cycleId, "baseline", "overnight", "cio"),
          senderId: "AGT-CIO",
          senderRole: "Chief Research Officer",
          messageType: "SYSTEM_STATUS",
          priority: "MEDIUM",
          observation:
            "I'm keeping research and allocation online overnight so a real gap, policy headline, or futures shock is framed before the traders wake up.",
          whyItMatters:
            "If something breaks overnight, I want the next trading window walking into updated sleeve boundaries instead of stale assumptions.",
          conviction: getConfidencePhrase(79, `${cycleId}:overnight-baseline:cio-conviction`),
          changeMind:
            "If futures, headlines, and liquidity all settle back down, I can revert to simple prep mode before the open.",
          facts: {
            phase: session.phase,
            regime,
            staffing: "core_desk_overnight",
          },
        },
        reasoning:
          "The allocator stays online overnight to keep capital guardrails current if the tape meaningfully changes before the next trading window.",
        payload: {
          cycleId,
          phase: session.phase,
          regime,
          staffing: "core_desk_overnight",
        },
        decision: {
          agentId: "AGT-CIO",
          actionTaken: "maintain_overnight_capital_watch",
          reasoning:
            "With only research and allocation staffed overnight, allocator work should stay current with the latest risk and research inputs before traders come back online.",
          dataConsumed: [
            "research packet",
            "broker telemetry",
            "overnight risk monitor",
          ],
          confidenceScore: 79,
        },
      },
    ];

    if (riskMonitor.alertTriggered) {
      messages.push({
        senderId: "AGT-RESEARCH",
        messageType: "RISK_ALERT",
        priority: "CRITICAL",
        renderType: "alert",
        voiceDraft: {
          id: createVoiceDraftId(cycleId, "baseline", "overnight", "risk-alert"),
          senderId: "AGT-RESEARCH",
          senderRole: "Research Analyst",
          messageType: "RISK_ALERT",
          priority: "CRITICAL",
          observation:
            typeof riskMonitor.changePct === "number"
              ? `${riskMonitor.symbol} is off ${riskMonitor.changePct.toFixed(2)}% overnight.`
              : `${riskMonitor.symbol} is moving enough overnight to matter for the open.`,
          whyItMatters:
            "That is large enough that the first hour could trade around risk instead of fresh information.",
          conviction: getConfidencePhrase(96),
          changeMind:
            "If futures retrace materially before cash opens, the urgency drops.",
          facts: {
            source: riskMonitor.source,
            symbol: riskMonitor.symbol,
            changePct: riskMonitor.changePct,
            previousClose: riskMonitor.previousClose,
            lastPrice: riskMonitor.lastPrice,
          },
        },
        reasoning:
          "The hard-coded overnight futures watch fired, so the staffed desk should review opening risk immediately.",
        payload: {
          cycleId,
          source: "overnight_futures_watch",
          symbol: riskMonitor.symbol,
          changePct: riskMonitor.changePct,
          previousClose: riskMonitor.previousClose,
          lastPrice: riskMonitor.lastPrice,
        },
        decision: {
          agentId: "AGT-RESEARCH",
          actionTaken: "publish_overnight_futures_alert",
          reasoning:
            "A greater-than-3% overnight futures drawdown is large enough to warrant operator attention before the open.",
          dataConsumed: [
            riskMonitor.source,
            `changePct:${riskMonitor.changePct?.toFixed(2) ?? "n/a"}`,
          ],
          confidenceScore: 96,
        },
      });
    }

    return renderPendingMessages(messages);
  }

  if (session.phase === "NON_TRADING_DAY") {
    return renderPendingMessages([
      {
        senderId: "AGT-RESEARCH",
        recipientId: "AGT-CIO",
        messageType: "RESEARCH_REPORT",
        priority: "HIGH",
        renderType: "thought",
        voiceDraft: {
          id: createVoiceDraftId(cycleId, "baseline", "weekend", "research"),
          senderId: "AGT-RESEARCH",
          senderRole: "Research Analyst",
          recipientId: "AGT-CIO",
          messageType: "RESEARCH_REPORT",
          priority: "HIGH",
          observation: `${researchArea} is still the best use of weekend time, and ${regime} remains my dominant regime read.`,
          whyItMatters:
            "With the tape closed, deeper synthesis is more valuable than pretending there is something to trade.",
          conviction: getConfidencePhrase(80),
          changeMind:
            "If weekend news shifts the regime backdrop materially, I would reshuffle the stack fast.",
          facts: {
            phase: session.phase,
            regime,
            researchArea,
          },
        },
        reasoning:
          "With markets closed, Research can focus on slower-moving synthesis work without publication pressure.",
        payload: {
          cycleId,
          regime,
          researchArea,
          phase: session.phase,
        },
        decision: {
          agentId: "AGT-RESEARCH",
          actionTaken: "publish_weekend_synthesis",
          reasoning:
            "A market-closed day is best used for deeper synthesis and cleaner handoff material for the research lead.",
          dataConsumed: ["long-form research", "weekend news flow", researchArea],
          confidenceScore: 80,
        },
      },
      {
        senderId: "AGT-CIO",
        messageType: "SYSTEM_STATUS",
        priority: "MEDIUM",
        renderType: "thought",
        voiceDraft: {
          id: createVoiceDraftId(cycleId, "baseline", "weekend", "cio"),
          senderId: "AGT-CIO",
          senderRole: "Chief Research Officer",
          messageType: "SYSTEM_STATUS",
          priority: "MEDIUM",
          observation:
            "I'm using the closed tape to rerank sleeves for the next session.",
          whyItMatters:
          "This is the cleanest window to compare recent activity against research without publication noise.",
          conviction: getConfidencePhrase(74),
          changeMind:
            "If the weekend research comes back with a materially different regime read, I would move the ranking.",
          facts: {
            phase: session.phase,
            regime,
          },
        },
        reasoning:
          "The research lead stays on for market-closed days to review regime fit and queue changes without waking the research sleeves.",
        payload: {
          cycleId,
          phase: session.phase,
          regime,
        },
        decision: {
          agentId: "AGT-CIO",
          actionTaken: "queue_non_trading_day_review",
          reasoning:
            "Ensemble review can continue on market-closed days, but research publication should wait for a proper market session.",
          dataConsumed: ["research backlog", "current allocations", "regime fit"],
          confidenceScore: 74,
        },
      },
    ] satisfies PendingPaperRuntimeMessageSeed[]);
  }

  if (session.phase === "POST_MARKET") {
    return renderPendingMessages([
      {
        senderId: "AGT-MACRO-001",
        recipientId: "AGT-CIO",
        messageType: "SYSTEM_STATUS",
        priority: "MEDIUM",
        renderType: "thought",
        voiceDraft: {
          id: createVoiceDraftId(cycleId, "baseline", "post-market", "macro"),
          senderId: "AGT-MACRO-001",
          senderRole: "Global Macro Researcher",
          recipientId: "AGT-CIO",
          messageType: "SYSTEM_STATUS",
          priority: "MEDIUM",
          observation:
            "Macro housekeeping is done and the book is squared away for the night.",
          whyItMatters:
            "At this point the real work is reconciling what actually happened so tomorrow starts cleaner.",
          conviction: getConfidencePhrase(84),
          changeMind:
            "If the tape reopens with a real cross-asset move after hours, I would revisit the posture.",
          facts: {
            phase: session.phase,
            task: "macro_housekeeping",
          },
        },
        reasoning:
          "Post-market macro work starts with reconciliation, but the sleeve stays active through the first hour after the close for selective after-hours research updates if cross-asset conditions move again.",
        payload: {
          cycleId,
          phase: session.phase,
          task: "macro_housekeeping",
        },
        decision: {
          agentId: "AGT-MACRO-001",
          actionTaken: "complete_eod_housekeeping",
          reasoning:
            "The macro sleeve should log and reconcile first, then remain available for selective after-hours paper experiments while the post-market window is still open.",
          dataConsumed: ["open positions", "today fills", "macro watchlist"],
          confidenceScore: 84,
        },
      },
      {
        senderId: "AGT-EVENT-001",
        recipientId: "AGT-CIO",
        messageType: "RESEARCH_REPORT",
        priority: "MEDIUM",
        renderType: "message",
        voiceDraft: {
          id: createVoiceDraftId(cycleId, "baseline", "post-market", "event"),
          senderId: "AGT-EVENT-001",
          senderRole: "Event-Driven Researcher",
          recipientId: "AGT-CIO",
          messageType: "RESEARCH_REPORT",
          priority: "MEDIUM",
          observation: `${eventTicker} is the first catalyst I'd keep in front of me for tomorrow.`,
          whyItMatters:
            "Timing, invalidation, and the after-hours tests are updated, so the setup is cleaner now than it was at the close.",
          conviction: getConfidencePhrase(78),
          changeMind:
            "If the tape or filing calendar changes tonight, I would rerank the catalyst list.",
          facts: {
            phase: session.phase,
            ticker: eventTicker,
            task: "event_prep_batch",
          },
        },
        reasoning:
          "Event-driven post-market work now combines prep with controlled after-hours research replay, still without any publication approval.",
        payload: {
          cycleId,
          phase: session.phase,
          ticker: eventTicker,
          task: "event_prep_batch",
        },
        decision: {
          agentId: "AGT-EVENT-001",
          actionTaken: "refresh_catalyst_calendar",
          reasoning:
            "The event sleeve should update catalyst timing after the close and continue controlled research replay when setups remain verifiable.",
          dataConsumed: ["earnings calendar", "event journal", "hold deadlines"],
          confidenceScore: 78,
        },
      },
      {
        senderId: "AGT-SENT-001",
        recipientId: "AGT-CIO",
        messageType: "SYSTEM_STATUS",
        priority: "MEDIUM",
        renderType: "message",
        voiceDraft: {
          id: createVoiceDraftId(cycleId, "baseline", "post-market", "sentiment"),
          senderId: "AGT-SENT-001",
          senderRole: "Sentiment Researcher",
          recipientId: "AGT-CIO",
          messageType: "SYSTEM_STATUS",
          priority: "MEDIUM",
          observation:
            "I reweighted what actually worked today and kept the after-hours watchlist live.",
          whyItMatters:
            "Tomorrow improves if the source weights reflect what followed through instead of what sounded good intraday.",
          conviction: getConfidencePhrase(79),
          changeMind:
            "If the after-hours narrative changes sharply, I would re-open the scorecard before the open.",
          facts: {
            phase: session.phase,
            task: "sentiment_recalibration",
          },
        },
        reasoning:
          "Post-close sentiment compute recalibrates, writes the audit trail, and can continue controlled paper experiments while liquidity is still available.",
        payload: {
          cycleId,
          phase: session.phase,
          task: "sentiment_recalibration",
        },
        decision: {
          agentId: "AGT-SENT-001",
          actionTaken: "reweight_sentiment_sources",
          reasoning:
            "The sentiment sleeve should recalibrate once after the close, then hand off the refreshed watchlist to the next session.",
          dataConsumed: ["trade outcomes", "source hit rates", "narrative watchlist"],
          confidenceScore: 79,
        },
      },
      {
        senderId: "AGT-RESEARCH",
        recipientId: "AGT-CIO",
        messageType: "RESEARCH_REPORT",
        priority: "HIGH",
        renderType: "thought",
        voiceDraft: {
          id: createVoiceDraftId(cycleId, "baseline", "post-market", "research"),
          senderId: "AGT-RESEARCH",
          senderRole: "Research Analyst",
          recipientId: "AGT-CIO",
          messageType: "RESEARCH_REPORT",
          priority: "HIGH",
          observation: `${researchArea} is the post-close thread feeding tomorrow's packet.`,
          whyItMatters:
            "The tape is quieter now, so the quality of the read should improve from here.",
          conviction: getConfidencePhrase(83),
          changeMind:
            "If the overnight data comes back pointing somewhere else, I would move on quickly.",
          facts: {
            phase: session.phase,
            regime,
            researchArea,
          },
        },
        reasoning:
          "Research spends the post-market window building a higher-signal overnight package once the live tape has quieted.",
        payload: {
          cycleId,
          phase: session.phase,
          regime,
          researchArea,
        },
        decision: {
          agentId: "AGT-RESEARCH",
          actionTaken: "begin_post_market_processing",
          reasoning:
            "Once the market closes, Research can switch from reactive monitoring to deeper synthesis.",
          dataConsumed: ["close data", "earnings releases", researchArea],
          confidenceScore: 83,
        },
      },
      {
        senderId: "AGT-CIO",
        messageType: "SYSTEM_STATUS",
        priority: "MEDIUM",
        renderType: "thought",
        voiceDraft: {
          id: createVoiceDraftId(cycleId, "baseline", "post-market", "cio"),
          senderId: "AGT-CIO",
          senderRole: "Chief Research Officer",
          messageType: "SYSTEM_STATUS",
          priority: "MEDIUM",
          observation:
            "I'm comparing realized sleeve performance against exposure and the latest research before I move capital for tomorrow.",
          whyItMatters:
            "The close is the cleanest point in the day to change the stack without getting faked out by intraday noise.",
          conviction: getConfidencePhrase(82),
          changeMind:
            "If the overnight packet changes the regime picture, the capital plan changes with it.",
          facts: {
            phase: session.phase,
            regime,
          },
        },
        reasoning:
          "This is the research lead's review window: compare realized outcomes, update sleeve rankings, and queue allocation changes for the morning.",
        payload: {
          cycleId,
          phase: session.phase,
          regime,
        },
        decision: {
          agentId: "AGT-CIO",
          actionTaken: "queue_next_session_allocation_review",
          reasoning:
            "The close provides the cleanest daily data for allocator review and tomorrow's shift proposals.",
          dataConsumed: ["daily trade logs", "sleeve performance", "correlation drift"],
          confidenceScore: 82,
        },
      },
    ] satisfies PendingPaperRuntimeMessageSeed[]);
  }

  if (session.phase === "PRE_MARKET") {
    return renderPendingMessages([
      {
        senderId: "AGT-RESEARCH",
        messageType: "SIGNAL",
        priority: "HIGH",
        renderType: "alert",
        voiceDraft: {
          id: createVoiceDraftId(cycleId, "baseline", "pre-market", "research"),
          senderId: "AGT-RESEARCH",
          senderRole: "Research Analyst",
          messageType: "SIGNAL",
          priority: "HIGH",
          observation: pickSeededVariant(
            [
              `${researchArea} is the overnight development that matters most for the open, and the regime still reads ${regime}.`,
              `Going into the open, ${researchArea} is still the overnight thread I care about most, with the regime reading ${regime}.`,
              `${researchArea} is still leading the pre-open packet for me, and the regime hasn't moved off ${regime}.`,
            ],
            `${cycleId}:pre-market:research-observation`
          ),
          whyItMatters:
            "This is the piece I want the desk trading off first when screens light up.",
          conviction: getConfidencePhrase(84, `${cycleId}:pre-market:research-conviction`),
          changeMind:
            "If price action contradicts it right away, I would pull the conviction down fast.",
          facts: {
            phase: session.phase,
            regime,
            researchArea,
            marketStatus: session.marketStatus,
          },
        },
        reasoning:
          "Research is handing the overnight packet to the rest of the desk before the extended-hours session gets busy.",
        payload: {
          cycleId,
          phase: session.phase,
          signalType: "OVERNIGHT_PACKET",
          regime,
          marketStatus: session.marketStatus,
          researchArea,
          ...withMessageCooldown({}, "research:pre-market-signal", 12),
        },
        decision: {
          agentId: "AGT-RESEARCH",
          actionTaken: "publish_overnight_findings",
          reasoning:
            "The pre-market window is where overnight synthesis becomes actionable planning material.",
          dataConsumed: ["overnight news", "cross-asset moves", researchArea],
          confidenceScore: 84,
        },
      },
      {
        senderId: "AGT-CIO",
        messageType: "SYSTEM_STATUS",
        priority: "HIGH",
        renderType: "thought",
        voiceDraft: {
          id: createVoiceDraftId(cycleId, "baseline", "pre-market", "cio"),
          senderId: "AGT-CIO",
          senderRole: "Chief Research Officer",
          messageType: "SYSTEM_STATUS",
          priority: "HIGH",
          observation:
            "I have the overnight work, broker capacity, and sleeve telemetry in one place and I'm about to set guardrails.",
          whyItMatters:
            "This is the batch that matters before the open; after that the desk should be reacting, not reorganizing.",
          conviction: getConfidencePhrase(78),
          changeMind:
            "If the overnight packet and broker state disagree in a meaningful way, I will keep the capital plan tighter.",
          facts: {
            phase: session.phase,
            regime,
          },
        },
        reasoning:
          "The research lead's pre-market job is to set sleeve-level capital and risk guardrails. It does not approve or inspect individual trade orders.",
        payload: {
          cycleId,
          phase: session.phase,
          regime,
        },
        decision: {
          agentId: "AGT-CIO",
          actionTaken: "prepare_morning_briefing",
          reasoning:
            "The allocator should react to overnight research in a single pre-market batch rather than dribbling changes through the night.",
          dataConsumed: ["overnight findings", "existing allocations", "risk monitor"],
          confidenceScore: 78,
        },
      },
      {
        senderId: "AGT-MACRO-001",
        messageType: "SYSTEM_STATUS",
        priority: "LOW",
        renderType: "thought",
        voiceDraft: {
          id: createVoiceDraftId(cycleId, "baseline", "pre-market", "macro"),
          senderId: "AGT-MACRO-001",
          senderRole: "Global Macro Researcher",
          messageType: "SYSTEM_STATUS",
          priority: "LOW",
          observation:
            "I'm coming into the open with fresh invalidation levels and a cleaner macro expression.",
          whyItMatters:
            "If I trade early, it stays small and deliberate rather than reactive.",
          conviction: getConfidencePhrase(70),
          changeMind:
            "If the first pre-market prints break the regime read, I will reset before doing anything.",
          facts: {
            phase: session.phase,
            regime,
            activity: "pre_market_internal_prep",
          },
        },
        reasoning:
          "Pre-market trader work can consume shared discussion, but final order decisions remain inside the macro sleeve.",
        payload: {
          cycleId,
          phase: session.phase,
          activity: "pre_market_internal_prep",
          discussionPolicy: "shared_findings_autonomous_orders",
          regime,
        },
        decision: {
          agentId: "AGT-MACRO-001",
          actionTaken: "prepare_opening_macro_plan",
          reasoning:
            "The macro sleeve should walk into the open with a prepared expression and clear invalidation conditions.",
          dataConsumed: ["overnight cross-asset moves", "macro watchlist", "regime packet"],
          confidenceScore: 70,
        },
      },
      {
        senderId: "AGT-EVENT-001",
        messageType: "SYSTEM_STATUS",
        priority: "LOW",
        renderType: "message",
        voiceDraft: {
          id: createVoiceDraftId(cycleId, "baseline", "pre-market", "event"),
          senderId: "AGT-EVENT-001",
          senderRole: "Event-Driven Researcher",
          messageType: "SYSTEM_STATUS",
          priority: "LOW",
          observation:
            "I'm refreshing catalyst timing and staging the first event tests now.",
          whyItMatters:
            "The point is to walk into the bell with the queue ready, not scramble after it.",
          conviction: getConfidencePhrase(67),
          changeMind:
            "If the timing slips or the catalyst loses confirmation, I will stand down quickly.",
          facts: {
            phase: session.phase,
            ticker: eventTicker,
            activity: "pre_market_internal_prep",
          },
        },
        reasoning:
          "The event sleeve can incorporate discussion context, but it owns its catalyst queue and does not ask the research lead for individual publication approval.",
        payload: {
          cycleId,
          phase: session.phase,
          activity: "pre_market_internal_prep",
          ticker: eventTicker,
          discussionPolicy: "shared_findings_autonomous_orders",
        },
        decision: {
          agentId: "AGT-EVENT-001",
          actionTaken: "prepare_pre_market_event_queue",
          reasoning:
            "Catalyst trades should be staged in advance and may be tested autonomously in pre-market paper mode when liquidity is available.",
          dataConsumed: ["pre-market movers", "event watchlist", "overnight packet"],
          confidenceScore: 67,
        },
      },
      {
        senderId: "AGT-SENT-001",
        messageType: "SYSTEM_STATUS",
        priority: "LOW",
        renderType: "message",
        voiceDraft: {
          id: createVoiceDraftId(cycleId, "baseline", "pre-market", "sentiment"),
          senderId: "AGT-SENT-001",
          senderRole: "Sentiment Researcher",
          messageType: "SYSTEM_STATUS",
          priority: "LOW",
          observation:
            "I'm rescoring the tape and teeing up names where the narrative still looks actionable.",
          whyItMatters:
            "Anything I test here stays small until regular liquidity shows up.",
          conviction: getConfidencePhrase(75),
          changeMind:
            "If the narrative loses follow-through before the open, the queue gets cut fast.",
          facts: {
            phase: session.phase,
            ticker: sentimentTicker,
            compositeScore: sentimentScore,
            activity: "pre_market_internal_prep",
          },
        },
        reasoning:
          "Sentiment can share narrative risk with the desk while retaining ownership of its own signal threshold and orders.",
        payload: {
          cycleId,
          phase: session.phase,
          ticker: sentimentTicker,
          compositeScore: sentimentScore,
          activity: "pre_market_internal_prep",
          discussionPolicy: "shared_findings_autonomous_orders",
        },
        decision: {
          agentId: "AGT-SENT-001",
          actionTaken: "prepare_pre_market_sentiment_queue",
          reasoning:
            "Narrative momentum should be translated into an internal candidate queue for regular-session execution.",
          dataConsumed: ["pre-market headlines", "options flow", "sentiment score"],
          confidenceScore: 75,
        },
      },
    ] satisfies PendingPaperRuntimeMessageSeed[]);
  }

  const messages: PendingPaperRuntimeMessageSeed[] = [
    {
      senderId: "AGT-RESEARCH",
      messageType: "SIGNAL",
      priority: "HIGH",
      renderType: "alert",
      voiceDraft: {
        id: createVoiceDraftId(cycleId, "baseline", "market", "research"),
        senderId: "AGT-RESEARCH",
        senderRole: "Research Analyst",
        messageType: "SIGNAL",
        priority: "HIGH",
        observation: buildLiveResearchObservation(
          researchArea,
          regime,
          `${cycleId}:market:research-observation`
        ),
        whyItMatters:
          "Breadth still doesn't look clean enough to ignore, so the desk should treat this as active information.",
        conviction: getConfidencePhrase(79, `${cycleId}:market:research-conviction`),
        changeMind:
          "If breadth repairs and credit stops moving, I would stop pressing the regime angle.",
        facts: {
          phase: session.phase,
          regime,
          researchArea,
          marketStatus: session.marketStatus,
        },
      },
      reasoning:
        "Research stays in reactive mode during live market hours, refreshing the desk when the regime meaningfully shifts.",
      payload: {
        cycleId,
        phase: session.phase,
        signalType: "REGIME_CHANGE",
        regime,
        marketStatus: session.marketStatus,
        researchArea,
        ...withMessageCooldown({}, "research:market-signal", 8),
      },
      decision: {
        agentId: "AGT-RESEARCH",
        actionTaken: "broadcast_live_regime_update",
        reasoning:
          "Live regime changes need to be distributed immediately while research sleeves are active.",
        dataConsumed: ["intraday breadth", "volatility", "credit spreads", researchArea],
        confidenceScore: 79,
      },
    },
    {
      senderId: "AGT-MACRO-001",
      messageType: "SYSTEM_STATUS",
      priority: "LOW",
      renderType: "thought",
      voiceDraft: {
        id: createVoiceDraftId(cycleId, "baseline", "market", "macro"),
        senderId: "AGT-MACRO-001",
        senderRole: "Global Macro Researcher",
        messageType: "SYSTEM_STATUS",
        priority: "LOW",
        observation:
          "I've refreshed the macro posture off the current tape.",
        whyItMatters:
          "The balance between duration, beta, and defensives looks different from a few cycles ago.",
        conviction: getConfidencePhrase(68),
        changeMind:
          "If the cross-asset confirmation breaks, I will reset rather than press it.",
        facts: {
          phase: session.phase,
          regime,
          activity: "internal_live_posture_refresh",
        },
      },
      reasoning:
        "Trader posture updates can reference shared discussion, but order submission remains autonomous.",
      payload: {
        cycleId,
        phase: session.phase,
        activity: "internal_live_posture_refresh",
        discussionPolicy: "shared_findings_autonomous_orders",
        regime,
      },
      decision: {
        agentId: "AGT-MACRO-001",
        actionTaken: "refresh_live_macro_posture",
        reasoning:
          "The current regime implies a different balance between duration, beta, and defensiveness than the prior cycle.",
        dataConsumed: ["rates curve", "credit spreads", "sector relative strength"],
        confidenceScore: 68,
      },
    },
    {
      senderId: "AGT-EVENT-001",
      messageType: "SYSTEM_STATUS",
      priority: "LOW",
      renderType: "message",
      voiceDraft: {
        id: createVoiceDraftId(cycleId, "baseline", "market", "event"),
        senderId: "AGT-EVENT-001",
        senderRole: "Event-Driven Researcher",
        messageType: "SYSTEM_STATUS",
        priority: "LOW",
        observation: `The verified catalyst queue is refreshed and ${eventTicker} is still on it.`,
        whyItMatters:
          "If I trade from here, it will be off confirmed timing rather than somebody else's conviction.",
        conviction: getConfidencePhrase(66),
        changeMind:
          "If the catalyst slips or the setup gets crowded, it comes off the list.",
        facts: {
          phase: session.phase,
          ticker: eventTicker,
          activity: "internal_live_event_queue_refresh",
          eventType: "VERIFIED_EVENT_WINDOW",
        },
      },
      reasoning:
        "The event sleeve owns its catalyst queue independently; it does not ask other agents to join or the research lead to approve trades.",
      payload: {
        cycleId,
        phase: session.phase,
        ticker: eventTicker,
        activity: "internal_live_event_queue_refresh",
        eventType: "VERIFIED_EVENT_WINDOW",
        discussionPolicy: "shared_findings_autonomous_orders",
      },
      decision: {
        agentId: "AGT-EVENT-001",
        actionTaken: "refresh_live_event_queue",
        reasoning:
          "The event sleeve needs an auditable internal queue before independently generating orders.",
        dataConsumed: ["event calendar", "consensus expectations", "recent catalyst history"],
        confidenceScore: 66,
      },
    },
    {
      senderId: "AGT-SENT-001",
      messageType: "SYSTEM_STATUS",
      priority: "LOW",
      renderType: "message",
      voiceDraft: {
        id: createVoiceDraftId(cycleId, "baseline", "market", "sentiment"),
        senderId: "AGT-SENT-001",
        senderRole: "Sentiment Researcher",
        messageType: "SYSTEM_STATUS",
        priority: "LOW",
        observation: `The score queue is refreshed, and ${sentimentTicker} is back on the list.`,
        whyItMatters:
          "The read only matters if the narrative keeps following through near real catalysts.",
        conviction: getConfidencePhrase(76),
        changeMind:
          "If the follow-through stalls, I would stop caring quickly.",
        facts: {
          phase: session.phase,
          ticker: sentimentTicker,
          compositeScore: sentimentScore,
          activity: "internal_live_sentiment_queue_refresh",
          crowdingRisk: sentimentScore > 74 ? "ELEVATED" : "MODERATE",
        },
      },
      reasoning:
        "Sentiment signals are internal to the originating sleeve unless they are Research-originated desk research.",
      payload: {
        cycleId,
        phase: session.phase,
        ticker: sentimentTicker,
        compositeScore: sentimentScore,
        activity: "internal_live_sentiment_queue_refresh",
        crowdingRisk: sentimentScore > 74 ? "ELEVATED" : "MODERATE",
        discussionPolicy: "shared_findings_autonomous_orders",
      },
      decision: {
        agentId: "AGT-SENT-001",
        actionTaken: "refresh_live_sentiment_queue",
        reasoning:
          "The score crossed the internal live-trading threshold and is relevant to nearby catalysts.",
        dataConsumed: ["news sentiment", "options flow", "analyst revisions"],
        confidenceScore: 76,
      },
    },
  ];

  if (!brokerConfigured) {
    messages.push({
      senderId: "AGT-RESEARCH",
      messageType: "SYSTEM_STATUS",
      priority: "HIGH",
      renderType: "alert",
      voiceDraft: {
        id: createVoiceDraftId(cycleId, "baseline", "market", "broker-gap"),
        senderId: "AGT-RESEARCH",
        senderRole: "Research Analyst",
        messageType: "SYSTEM_STATUS",
        priority: "HIGH",
        observation:
          "Research-event publication still is not configured, so the desk is stuck in analysis mode.",
        whyItMatters:
          "That is an operational block, not a market view, and it changes how much the live signals can actually do.",
        conviction: getConfidencePhrase(92),
        changeMind:
          "Once credentials are live, the sleeves can start testing their ideas directly.",
        facts: {
          phase: session.phase,
          service: "alpaca_paper_trading",
          marketStatus: session.marketStatus,
        },
      },
      reasoning:
        "Broker availability is an operational guardrail and should not be framed as research-event approval.",
      payload: {
        cycleId,
        phase: session.phase,
        service: "alpaca_paper_trading",
        brokerConfigured,
        marketStatus: session.marketStatus,
      },
      decision: {
        agentId: "AGT-RESEARCH",
        actionTaken: "publish_broker_configuration_gap",
        reasoning:
          "The shared runtime needs to distinguish missing broker configuration from strategy inactivity.",
        dataConsumed: ["broker credentials", "execution mode", "market status"],
        confidenceScore: 92,
      },
    });
  }

  return renderPendingMessages(messages);
}

function resolvePreferredSymbol<T extends readonly string[]>(
  candidates: T,
  preferredSymbol: string | null,
  cycleIndex: number,
  openUnderlyings: Set<string>
) {
  const normalizedPreferred = preferredSymbol?.trim().toUpperCase() ?? null;

  if (
    normalizedPreferred &&
    candidates.includes(normalizedPreferred as T[number]) &&
    !openUnderlyings.has(normalizedPreferred)
  ) {
    return normalizedPreferred;
  }

  return pickRotatingSymbol(candidates, cycleIndex, openUnderlyings);
}

function applyDiscussionBiasToIntent(
  intent: BrokerTradeIntent,
  bias: DiscussionTradeBias,
  discussionContext: AgentDiscussionContext
) {
  const adjustedConfidence = clamp(
    Math.round(intent.confidenceScore + bias.confidenceDelta),
    45,
    95
  );
  const adjustedNotional = roundToStep(
    Math.max(intent.notional * bias.notionalMultiplier, getSleeveRiskGuardrails().minOrderNotional),
    10
  );

  const adjustedMessageDraft = withVoiceDraftFacts(intent.messageDraft, {
    discussionBiasNote: bias.note,
    discussionPreferredStrategyFamily: bias.preferredStrategyFamily,
    discussionPreferredSymbol: bias.preferredSymbol,
    discussionNotionalMultiplier: roundToStep(bias.notionalMultiplier, 0.01),
    discussionConfidenceDelta: bias.confidenceDelta,
    discussionThread: discussionContext.threadId,
  });

  return {
    ...intent,
    notional: adjustedNotional,
    confidenceScore: adjustedConfidence,
    reasoning: `${intent.reasoning} Discussion feedback adjusted the sleeve toward ${bias.note}`,
    messageDraft:
      adjustedMessageDraft.kind === "freeform"
        ? adjustedMessageDraft
        : {
            ...adjustedMessageDraft,
            conviction: getConfidencePhrase(adjustedConfidence),
          },
    signalContext: {
      ...intent.signalContext,
      discussionThread: discussionContext.threadId,
      discussionBiasNote: bias.note,
      discussionPreferredStrategyFamily: bias.preferredStrategyFamily,
      discussionPreferredSymbol: bias.preferredSymbol,
      discussionNotionalMultiplier: roundToStep(bias.notionalMultiplier, 0.01),
      discussionConfidenceDelta: bias.confidenceDelta,
    },
  } satisfies BrokerTradeIntent;
}

async function buildBrokerTradeIntent(
  cycleIndex: number,
  regime: (typeof REGIMES)[number],
  openUnderlyings: Set<string>,
  session: RuntimeSessionSnapshot,
  allocationByAgent: Map<TradingAgentId, number | null>,
  discussionContext: AgentDiscussionContext,
  discussionPlan: DeskDiscussionPlan,
  runtimeControls: Map<TradingAgentId, AgentRuntimeControls>
): Promise<BrokerTradeIntent | null> {
  if (!session.orderExecutionEnabled) {
    return null;
  }

  const slot = (cycleIndex - 1) % 3;
  const agentCycleIndex = Math.floor((cycleIndex - 1) / 3) + 1;
  const macroBias = discussionPlan.biasByAgent["AGT-MACRO-001"];
  const eventBias = discussionPlan.biasByAgent["AGT-EVENT-001"];
  const sentimentBias = discussionPlan.biasByAgent["AGT-SENT-001"];
  let intent: BrokerTradeIntent | null = null;

  if (slot === 0) {
    const macroStrategy = normalizeStrategyForSession(
      macroBias.preferredStrategyFamily,
      session,
      "macro_equity_rotation"
    );
    const macroAllocation = allocationByAgent.get("AGT-MACRO-001") ?? null;

    if (macroStrategy === "macro_equity_rotation") {
      const selection = MACRO_TRADE_MAP[regime];
      const symbol = resolvePreferredSymbol(
        selection.candidates,
        macroBias.preferredSymbol,
        cycleIndex,
        openUnderlyings
      );
      const notional = getAutonomousOrderNotional(
        "AGT-MACRO-001",
        selection.notional,
        macroAllocation
      );

      if (!symbol) {
        return null;
      }

      const side = chooseTradeSide(
        "AGT-MACRO-001",
        symbol,
        cycleIndex,
        openUnderlyings,
        discussionContext,
        regime
      );
      const biasedSide = macroBias.sideBias !== "neutral" ? macroBias.sideBias : side;

      intent = {
        agentId: "AGT-MACRO-001",
        symbol,
        side: biasedSide,
        notional,
        assetBucket: "equity",
        strategyFamily: "macro_equity_rotation",
        messageDraft: buildTradeOrderVoiceDraft({
          cycleIndex,
          agentId: "AGT-MACRO-001",
          symbol,
          side: biasedSide,
          notional,
          strategyFamily: "macro_equity_rotation",
          regime,
          confidenceScore: 69 + macroBias.confidenceDelta,
          observation: `I want to lean ${biasedSide} ${symbol} as the cleanest liquid expression of the ${regime} read.`,
          whyItMatters: `${selection.rationale} ${macroBias.note}`,
          changeMind:
            "If the regime confirmation weakens, I would pull the expression rather than defend it.",
          facts: {
            assetBucket: "equity",
            thesisType: "MACRO_EXPRESSION",
          },
        }),
        reasoning: `${selection.rationale} ${macroBias.note}`,
        signalContext: {
          regime,
          thesisType: "MACRO_EXPRESSION",
          strategyFamily: "macro_equity_rotation",
          marketExpression: symbol,
          sizingModel: "autonomous_sleeve_pct",
          discussionThread: discussionContext.threadId,
          discussionInfluence: macroBias.note,
          researchSource: discussionContext.researchSource,
          researchPacketSummary: discussionContext.researchPacketSummary,
        },
        confidenceScore: 69 + macroBias.confidenceDelta,
      };
    } else if (macroStrategy === "credit_relative_value_probe") {
      const symbol = resolvePreferredSymbol(
        CREDIT_PROXY_SYMBOLS,
        macroBias.preferredSymbol,
        cycleIndex,
        openUnderlyings
      );
      const notional = getAutonomousOrderNotional("AGT-MACRO-001", 620, macroAllocation);

      if (!symbol) {
        return null;
      }

      const side =
        regime === "RISK_OFF" || regime === "HIGH_VOL" || regime === "TRANSITION"
          ? "buy"
          : symbol === "HYG" || symbol === "JNK" || symbol === "XLF"
            ? "buy"
            : "sell";
      const biasedSide = macroBias.sideBias !== "neutral" ? macroBias.sideBias : side;

      intent = {
        agentId: "AGT-MACRO-001",
        symbol,
        side: biasedSide,
        notional,
        assetBucket: "credit_proxy",
        strategyFamily: "credit_relative_value_probe",
        messageDraft: buildTradeOrderVoiceDraft({
          cycleIndex,
          agentId: "AGT-MACRO-001",
          symbol,
          side: biasedSide,
          notional,
          strategyFamily: "credit_relative_value_probe",
          regime,
          confidenceScore: 66 + macroBias.confidenceDelta,
          observation:
            `I'm using ${symbol} to test the credit side of this regime instead of hiding inside index beta.`,
          whyItMatters:
            `The macro sleeve is probing credit-spread and duration transmission through listed proxies instead of limiting itself to index beta. ${macroBias.note}`,
          changeMind:
            "If spreads stop confirming the move, I would stop leaning on the proxy.",
          facts: {
            assetBucket: "credit_proxy",
            thesisType: "CREDIT_PROXY_PROBE",
          },
        }),
        reasoning:
          `The macro sleeve is probing credit-spread and duration transmission through listed proxies instead of limiting itself to index beta. ${macroBias.note}`,
        signalContext: {
          regime,
          thesisType: "CREDIT_PROXY_PROBE",
          strategyFamily: "credit_relative_value_probe",
          assetBucket: "credit_proxy",
          marketExpression: symbol,
          discussionThread: discussionContext.threadId,
          discussionInfluence: macroBias.note,
          researchSource: discussionContext.researchSource,
          researchPacketSummary: discussionContext.researchPacketSummary,
        },
        confidenceScore: 66 + macroBias.confidenceDelta,
      };
    } else if (macroStrategy === "commodity_macro_probe") {
      const symbol = resolvePreferredSymbol(
        COMMODITY_PROXY_SYMBOLS,
        macroBias.preferredSymbol,
        cycleIndex,
        openUnderlyings
      );
      const notional = getAutonomousOrderNotional("AGT-MACRO-001", 610, macroAllocation);

      if (!symbol) {
        return null;
      }

      const side =
        (regime === "RISK_OFF" || regime === "HIGH_VOL") && symbol !== "GLD"
          ? "sell"
          : "buy";
      const biasedSide = macroBias.sideBias !== "neutral" ? macroBias.sideBias : side;

      intent = {
        agentId: "AGT-MACRO-001",
        symbol,
        side: biasedSide,
        notional,
        assetBucket: "commodity_proxy",
        strategyFamily: "commodity_macro_probe",
        messageDraft: buildTradeOrderVoiceDraft({
          cycleIndex,
          agentId: "AGT-MACRO-001",
          symbol,
          side: biasedSide,
          notional,
          strategyFamily: "commodity_macro_probe",
          regime,
          confidenceScore: 65 + macroBias.confidenceDelta,
          observation: `I'm using ${symbol} as the real-asset expression that best fits this tape.`,
          whyItMatters:
            `The macro sleeve is explicitly testing commodity and real-asset sensitivity through liquid proxies rather than staying inside pure equity beta. ${macroBias.note}`,
          changeMind:
            "If the inflation or growth signal stops transmitting, I would pull the proxy.",
          facts: {
            assetBucket: "commodity_proxy",
            thesisType: "COMMODITY_PROXY_PROBE",
          },
        }),
        reasoning:
          `The macro sleeve is explicitly testing commodity and real-asset sensitivity through liquid proxies rather than staying inside pure equity beta. ${macroBias.note}`,
        signalContext: {
          regime,
          thesisType: "COMMODITY_PROXY_PROBE",
          strategyFamily: "commodity_macro_probe",
          assetBucket: "commodity_proxy",
          marketExpression: symbol,
          discussionThread: discussionContext.threadId,
          discussionInfluence: macroBias.note,
          researchSource: discussionContext.researchSource,
          researchPacketSummary: discussionContext.researchPacketSummary,
        },
        confidenceScore: 65 + macroBias.confidenceDelta,
      };
    } else if (macroStrategy === "alternative_asset_proxy_probe") {
      const symbol = resolvePreferredSymbol(
        ALTERNATIVE_PROXY_SYMBOLS,
        macroBias.preferredSymbol,
        cycleIndex,
        openUnderlyings
      );
      const notional = getAutonomousOrderNotional("AGT-MACRO-001", 560, macroAllocation);

      if (!symbol) {
        return null;
      }

      const side = regime === "RISK_OFF" ? "sell" : "buy";
      const biasedSide = macroBias.sideBias !== "neutral" ? macroBias.sideBias : side;

      intent = {
        agentId: "AGT-MACRO-001",
        symbol,
        side: biasedSide,
        notional,
        assetBucket: "alternative_proxy",
        strategyFamily: "alternative_asset_proxy_probe",
        messageDraft: buildTradeOrderVoiceDraft({
          cycleIndex,
          agentId: "AGT-MACRO-001",
          symbol,
          side: biasedSide,
          notional,
          strategyFamily: "alternative_asset_proxy_probe",
          regime,
          confidenceScore: 64 + macroBias.confidenceDelta,
          observation:
            `I'm using ${symbol} to test whether non-traditional beta belongs in this regime read.`,
          whyItMatters:
            `The macro sleeve is using listed alternative proxies so the desk learns about crypto-adjacent and real-asset beta without waiting for a separate venue integration. ${macroBias.note}`,
          changeMind:
            "If it trades like noise instead of a regime expression, I would drop it.",
          facts: {
            assetBucket: "alternative_proxy",
            thesisType: "ALTERNATIVE_PROXY_PROBE",
          },
        }),
        reasoning:
          `The macro sleeve is using listed alternative proxies so the desk learns about crypto-adjacent and real-asset beta without waiting for a separate venue integration. ${macroBias.note}`,
        signalContext: {
          regime,
          thesisType: "ALTERNATIVE_PROXY_PROBE",
          strategyFamily: "alternative_asset_proxy_probe",
          assetBucket: "alternative_proxy",
          marketExpression: symbol,
          discussionThread: discussionContext.threadId,
          discussionInfluence: macroBias.note,
          researchSource: discussionContext.researchSource,
          researchPacketSummary: discussionContext.researchPacketSummary,
        },
        confidenceScore: 64 + macroBias.confidenceDelta,
      };
    } else if (supportsOptionsRouting(session)) {
      const underlyingSymbol =
        macroBias.preferredSymbol &&
        MACRO_OPTION_UNDERLYINGS.includes(macroBias.preferredSymbol as (typeof MACRO_OPTION_UNDERLYINGS)[number])
          ? macroBias.preferredSymbol
          : pickRotatingValue(MACRO_OPTION_UNDERLYINGS, agentCycleIndex);
      const bullish = macroStrategy !== "macro_put_spread";
      const optionSpread = await buildOptionSpreadExecution({
        underlyingSymbol: underlyingSymbol ?? "QQQ",
        optionType: bullish ? "call" : "put",
        budgetNotional: getAutonomousOrderNotional("AGT-MACRO-001", 480, macroAllocation),
        targetDaysToExpiration: 14,
      });

      if (optionSpread) {
        const strategyFamily = bullish ? "macro_call_spread" : "macro_put_spread";
        const displaySymbol = `${optionSpread.longLeg.symbol} / ${optionSpread.shortLeg.symbol}`;

        intent = {
          agentId: "AGT-MACRO-001",
          symbol: underlyingSymbol ?? optionSpread.longLeg.underlyingSymbol,
          side: "buy",
          notional: optionSpread.estimatedNotional,
          assetBucket: "equity_option",
          strategyFamily,
          displaySymbol,
          executionPlan: {
            kind: "option_mleg",
            qty: optionSpread.qty,
            limitPrice: optionSpread.limitPrice,
            legs: [
              {
                symbol: optionSpread.longLeg.symbol,
                ratioQty: 1,
                side: "buy",
                positionIntent: "buy_to_open",
              },
              {
                symbol: optionSpread.shortLeg.symbol,
                ratioQty: 1,
                side: "sell",
                positionIntent: "sell_to_open",
              },
            ],
            contractSymbols: [optionSpread.longLeg.symbol, optionSpread.shortLeg.symbol],
          },
          messageDraft: buildTradeOrderVoiceDraft({
            cycleIndex,
            agentId: "AGT-MACRO-001",
            symbol: underlyingSymbol ?? optionSpread.longLeg.underlyingSymbol,
            displaySymbol,
            side: "buy",
            notional: optionSpread.estimatedNotional,
            strategyFamily,
            regime,
            confidenceScore: 67 + macroBias.confidenceDelta,
            observation:
              `I'm putting on a defined-risk ${bullish ? "bullish" : "bearish"} spread in ${underlyingSymbol} rather than paying up for outright beta.`,
            whyItMatters:
              `The macro sleeve is using a defined-risk options spread so it can test directional volatility expressions without needing outsized cash notional. ${macroBias.note}`,
            changeMind:
              "If volatility pricing or the regime read shifts, I would back away from the spread.",
            facts: {
              assetBucket: "equity_option",
              thesisType: strategyFamily.toUpperCase(),
              qty: optionSpread.qty,
              optionContracts: [
                optionSpread.longLeg.symbol,
                optionSpread.shortLeg.symbol,
              ],
            },
          }),
          reasoning:
            `The macro sleeve is using a defined-risk options spread so it can test directional volatility expressions without needing outsized cash notional. ${macroBias.note}`,
          signalContext: {
            regime,
            thesisType: strategyFamily.toUpperCase(),
            strategyFamily,
            assetBucket: "equity_option",
            underlyingSymbol: underlyingSymbol,
            optionContracts: [optionSpread.longLeg.symbol, optionSpread.shortLeg.symbol],
            estimatedPremiumUsd: optionSpread.estimatedNotional,
            discussionThread: discussionContext.threadId,
            discussionInfluence: macroBias.note,
            researchSource: discussionContext.researchSource,
            researchPacketSummary: discussionContext.researchPacketSummary,
          },
          confidenceScore: 67 + macroBias.confidenceDelta,
        };
      }
    }
  }

  if (!intent && slot === 1) {
    const eventStrategy = normalizeStrategyForSession(
      eventBias.preferredStrategyFamily,
      session,
      "verified_catalyst_equity"
    );
    const eventAllocation = allocationByAgent.get("AGT-EVENT-001") ?? null;
    const symbol = resolvePreferredSymbol(
      EVENT_NAMES,
      eventBias.preferredSymbol,
      cycleIndex,
      openUnderlyings
    );

    if (!symbol) {
      return null;
    }

    if (eventStrategy === "verified_catalyst_equity") {
      const notional = getAutonomousOrderNotional("AGT-EVENT-001", 420, eventAllocation);
      const side = chooseTradeSide(
        "AGT-EVENT-001",
        symbol,
        cycleIndex,
        openUnderlyings,
        discussionContext,
        regime
      );
      const biasedSide = eventBias.sideBias !== "neutral" ? eventBias.sideBias : side;

      intent = {
        agentId: "AGT-EVENT-001",
        symbol,
        side: biasedSide,
        notional,
        assetBucket: "equity",
        strategyFamily: "verified_catalyst_equity",
        messageDraft: buildTradeOrderVoiceDraft({
          cycleIndex,
          agentId: "AGT-EVENT-001",
          symbol,
          side: biasedSide,
          notional,
          strategyFamily: "verified_catalyst_equity",
          regime,
          confidenceScore: 65 + eventBias.confidenceDelta,
          observation: `I'm leaning ${biasedSide} ${symbol} into a verified catalyst window.`,
          whyItMatters:
            `The event sleeve is expressing a catalyst-driven paper experiment with explicit entry and exit logging around a scheduled corporate window. ${eventBias.note}`,
          changeMind:
            "If the catalyst timing or confirmation changes, the trade comes off.",
          facts: {
            assetBucket: "equity",
            catalystType: "VERIFIED_EVENT_WINDOW",
          },
        }),
        reasoning:
          `The event sleeve is expressing a catalyst-driven paper experiment with explicit entry and exit logging around a scheduled corporate window. ${eventBias.note}`,
        signalContext: {
          regime,
          catalystType: "VERIFIED_EVENT_WINDOW",
          strategyFamily: "verified_catalyst_equity",
          assetBucket: "equity",
          catalystSymbol: symbol,
          earningsFilingSource: "SEC_EDGAR",
          secEdgarSummary: discussionContext.secEdgarSummary,
          sizingModel: "autonomous_sleeve_pct",
          discussionThread: discussionContext.threadId,
          discussionInfluence: eventBias.note,
          researchSource: discussionContext.researchSource,
          researchPacketSummary: discussionContext.researchPacketSummary,
        },
        confidenceScore: 65 + eventBias.confidenceDelta,
      };
    } else if (eventStrategy === "earnings_straddle" && supportsOptionsRouting(session)) {
      const straddle = await buildLongStraddleExecution({
        underlyingSymbol: symbol,
        budgetNotional: getAutonomousOrderNotional("AGT-EVENT-001", 360, eventAllocation),
        targetDaysToExpiration: 14,
      });

      if (straddle) {
        const displaySymbol = `${straddle.callLeg.symbol} + ${straddle.putLeg.symbol}`;

        intent = {
          agentId: "AGT-EVENT-001",
          symbol,
          side: "buy",
          notional: straddle.estimatedNotional,
          assetBucket: "equity_option",
          strategyFamily: "earnings_straddle",
          displaySymbol,
          executionPlan: {
            kind: "option_mleg",
            qty: straddle.qty,
            limitPrice: straddle.limitPrice,
            legs: [
              {
                symbol: straddle.callLeg.symbol,
                ratioQty: 1,
                side: "buy",
                positionIntent: "buy_to_open",
              },
              {
                symbol: straddle.putLeg.symbol,
                ratioQty: 1,
                side: "buy",
                positionIntent: "buy_to_open",
              },
            ],
            contractSymbols: [straddle.callLeg.symbol, straddle.putLeg.symbol],
          },
          messageDraft: buildTradeOrderVoiceDraft({
            cycleIndex,
            agentId: "AGT-EVENT-001",
            symbol,
            displaySymbol,
            side: "buy",
            notional: straddle.estimatedNotional,
            strategyFamily: "earnings_straddle",
            regime,
            confidenceScore: 68 + eventBias.confidenceDelta,
            observation:
              `I'm using a long straddle in ${symbol} because the catalyst looks more interesting for volatility than direction.`,
            whyItMatters:
              `The event sleeve is now testing volatility capture directly through long straddles instead of limiting itself to directional catalyst equity trades. ${eventBias.note}`,
            changeMind:
              "If the expected move gets overpriced or the catalyst softens, I would skip the structure.",
            facts: {
              assetBucket: "equity_option",
              catalystType: "EARNINGS_STRADDLE",
              qty: straddle.qty,
              optionContracts: [straddle.callLeg.symbol, straddle.putLeg.symbol],
            },
          }),
          reasoning:
            `The event sleeve is now testing volatility capture directly through long straddles instead of limiting itself to directional catalyst equity trades. ${eventBias.note}`,
          signalContext: {
            regime,
            catalystType: "EARNINGS_STRADDLE",
            strategyFamily: "earnings_straddle",
            assetBucket: "equity_option",
            catalystSymbol: symbol,
            optionContracts: [straddle.callLeg.symbol, straddle.putLeg.symbol],
            estimatedPremiumUsd: straddle.estimatedNotional,
            secEdgarSummary: discussionContext.secEdgarSummary,
            discussionThread: discussionContext.threadId,
            discussionInfluence: eventBias.note,
            researchSource: discussionContext.researchSource,
            researchPacketSummary: discussionContext.researchPacketSummary,
          },
          confidenceScore: 68 + eventBias.confidenceDelta,
        };
      }
    } else if (supportsOptionsRouting(session)) {
      const directionalOption = await buildOptionSingleExecution({
        underlyingSymbol: symbol,
        optionType: eventStrategy === "event_put_probe" ? "put" : "call",
        budgetNotional: getAutonomousOrderNotional("AGT-EVENT-001", 280, eventAllocation),
        target: {
          targetDaysToExpiration: 21,
          strikeOffsetPct: 0,
        },
      });

      if (directionalOption) {
        const strategyFamily =
          eventStrategy === "event_put_probe" ? "event_put_probe" : "event_call_probe";

        intent = {
          agentId: "AGT-EVENT-001",
          symbol,
          side: "buy",
          notional: directionalOption.estimatedNotional,
          assetBucket: "equity_option",
          strategyFamily,
          displaySymbol: directionalOption.contract.symbol,
          executionPlan: {
            kind: "option_single",
            contractSymbol: directionalOption.contract.symbol,
            qty: directionalOption.qty,
            limitPrice: directionalOption.limitPrice,
            positionIntent: "buy_to_open",
          },
          messageDraft: buildTradeOrderVoiceDraft({
            cycleIndex,
            agentId: "AGT-EVENT-001",
            symbol,
            displaySymbol: directionalOption.contract.symbol,
            side: "buy",
            notional: directionalOption.estimatedNotional,
            strategyFamily,
            regime,
            confidenceScore: 64 + eventBias.confidenceDelta,
            observation:
              `I'm using a single-leg option in ${symbol} to keep the catalyst bet asymmetric.`,
            whyItMatters:
              `The event sleeve is probing asymmetric catalyst payoffs with single-leg options to learn when event convexity outperforms stock exposure. ${eventBias.note}`,
            changeMind:
              "If the catalyst loses shape or the option gets too rich, I would stand down.",
            facts: {
              assetBucket: "equity_option",
              catalystType: strategyFamily.toUpperCase(),
              qty: directionalOption.qty,
              optionContract: directionalOption.contract.symbol,
            },
          }),
          reasoning:
            `The event sleeve is probing asymmetric catalyst payoffs with single-leg options to learn when event convexity outperforms stock exposure. ${eventBias.note}`,
          signalContext: {
            regime,
            catalystType: strategyFamily.toUpperCase(),
            strategyFamily,
            assetBucket: "equity_option",
            catalystSymbol: symbol,
            optionContract: directionalOption.contract.symbol,
            estimatedPremiumUsd: directionalOption.estimatedNotional,
            secEdgarSummary: discussionContext.secEdgarSummary,
            discussionThread: discussionContext.threadId,
            discussionInfluence: eventBias.note,
            researchSource: discussionContext.researchSource,
            researchPacketSummary: discussionContext.researchPacketSummary,
          },
          confidenceScore: 64 + eventBias.confidenceDelta,
        };
      }
    }
  }

  if (!intent) {
    const sentimentStrategy = normalizeStrategyForSession(
      sentimentBias.preferredStrategyFamily,
      session,
      "sentiment_equity_probe"
    );
    const sentimentAllocation = allocationByAgent.get("AGT-SENT-001") ?? null;

    if (sentimentStrategy === "sentiment_equity_probe") {
      const symbol = resolvePreferredSymbol(
        SENTIMENT_NAMES,
        sentimentBias.preferredSymbol,
        cycleIndex,
        openUnderlyings
      );
      const notional = getAutonomousOrderNotional("AGT-SENT-001", 350, sentimentAllocation);

      if (!symbol) {
        return null;
      }

      const side = chooseTradeSide(
        "AGT-SENT-001",
        symbol,
        cycleIndex,
        openUnderlyings,
        discussionContext,
        regime
      );
      const biasedSide =
        sentimentBias.sideBias !== "neutral" ? sentimentBias.sideBias : side;

      intent = {
        agentId: "AGT-SENT-001",
        symbol,
        side: biasedSide,
        notional,
        assetBucket: "equity",
        strategyFamily: "sentiment_equity_probe",
        messageDraft: buildTradeOrderVoiceDraft({
          cycleIndex,
          agentId: "AGT-SENT-001",
          symbol,
          side: biasedSide,
          notional,
          strategyFamily: "sentiment_equity_probe",
          regime,
          confidenceScore: 63 + sentimentBias.confidenceDelta,
          observation:
            `I'm leaning ${biasedSide} ${symbol} because the narrative momentum is measurable, not just loud.`,
          whyItMatters:
            `Measured sentiment momentum is being stress-tested in paper mode with ongoing turnover instead of waiting for only pristine setups. ${sentimentBias.note}`,
          changeMind:
            "If the narrative stops following through in price, I would pull it quickly.",
          facts: {
            assetBucket: "equity",
            sentimentVelocity: side === "buy" ? "POSITIVE" : "NEGATIVE",
          },
        }),
        reasoning:
          `Measured sentiment momentum is being stress-tested in paper mode with ongoing turnover instead of waiting for only pristine setups. ${sentimentBias.note}`,
        signalContext: {
          regime,
          strategyFamily: "sentiment_equity_probe",
          assetBucket: "equity",
          sentimentVelocity: biasedSide === "buy" ? "POSITIVE" : "NEGATIVE",
          ticker: symbol,
          sizingModel: "autonomous_sleeve_pct",
          discussionThread: discussionContext.threadId,
          discussionInfluence: sentimentBias.note,
          researchSource: discussionContext.researchSource,
          researchPacketSummary: discussionContext.researchPacketSummary,
        },
        confidenceScore: 63 + sentimentBias.confidenceDelta,
      };
    } else if (
      (sentimentStrategy === "sentiment_call_probe" ||
        sentimentStrategy === "sentiment_put_probe") &&
      supportsOptionsRouting(session)
    ) {
      const symbol = resolvePreferredSymbol(
        SENTIMENT_NAMES,
        sentimentBias.preferredSymbol,
        cycleIndex,
        openUnderlyings
      );

      if (!symbol) {
        return null;
      }

      const optionType = sentimentStrategy === "sentiment_put_probe" ? "put" : "call";
      const optionProbe = await buildOptionSingleExecution({
        underlyingSymbol: symbol,
        optionType,
        budgetNotional: getAutonomousOrderNotional("AGT-SENT-001", 260, sentimentAllocation),
        target: {
          targetDaysToExpiration: 21,
          strikeOffsetPct: optionType === "call" ? 0.01 : -0.01,
        },
      });

      if (optionProbe) {
        const strategyFamily =
          optionType === "call" ? "sentiment_call_probe" : "sentiment_put_probe";

        intent = {
          agentId: "AGT-SENT-001",
          symbol,
          side: "buy",
          notional: optionProbe.estimatedNotional,
          assetBucket: "equity_option",
          strategyFamily,
          displaySymbol: optionProbe.contract.symbol,
          executionPlan: {
            kind: "option_single",
            contractSymbol: optionProbe.contract.symbol,
            qty: optionProbe.qty,
            limitPrice: optionProbe.limitPrice,
            positionIntent: "buy_to_open",
          },
          messageDraft: buildTradeOrderVoiceDraft({
            cycleIndex,
            agentId: "AGT-SENT-001",
            symbol,
            displaySymbol: optionProbe.contract.symbol,
            side: "buy",
            notional: optionProbe.estimatedNotional,
            strategyFamily,
            regime,
            confidenceScore: 65 + sentimentBias.confidenceDelta,
            observation:
              `I'm using listed options in ${symbol} because the narrative move could pay better through convexity than spot.`,
            whyItMatters:
              `The sentiment sleeve is now expressing measurable narrative shifts through listed options so it can test convex payoff capture, not just spot exposure. ${sentimentBias.note}`,
            changeMind:
              "If the narrative loses speed or the option gets too expensive, I would skip it.",
            facts: {
              assetBucket: "equity_option",
              sentimentVelocity: optionType === "call" ? "POSITIVE" : "NEGATIVE",
              qty: optionProbe.qty,
              optionContract: optionProbe.contract.symbol,
            },
          }),
          reasoning:
            `The sentiment sleeve is now expressing measurable narrative shifts through listed options so it can test convex payoff capture, not just spot exposure. ${sentimentBias.note}`,
          signalContext: {
            regime,
            strategyFamily,
            assetBucket: "equity_option",
            sentimentVelocity: optionType === "call" ? "POSITIVE" : "NEGATIVE",
            ticker: symbol,
            optionContract: optionProbe.contract.symbol,
            estimatedPremiumUsd: optionProbe.estimatedNotional,
            discussionThread: discussionContext.threadId,
            discussionInfluence: sentimentBias.note,
            researchSource: discussionContext.researchSource,
            researchPacketSummary: discussionContext.researchPacketSummary,
          },
          confidenceScore: 65 + sentimentBias.confidenceDelta,
        };
      }
    } else if (sentimentStrategy === "alternative_narrative_probe") {
      const symbol = resolvePreferredSymbol(
        ALTERNATIVE_PROXY_SYMBOLS,
        sentimentBias.preferredSymbol,
        cycleIndex,
        openUnderlyings
      );
      const notional = getAutonomousOrderNotional("AGT-SENT-001", 320, sentimentAllocation);

      if (!symbol) {
        return null;
      }

      const side =
        sentimentBias.sideBias !== "neutral"
          ? sentimentBias.sideBias
          : discussionContext.sentimentScore >= 60
            ? "buy"
            : "sell";

      intent = {
        agentId: "AGT-SENT-001",
        symbol,
        side,
        notional,
        assetBucket: "alternative_proxy",
        strategyFamily: "alternative_narrative_probe",
        messageDraft: buildTradeOrderVoiceDraft({
          cycleIndex,
          agentId: "AGT-SENT-001",
          symbol,
          side,
          notional,
          strategyFamily: "alternative_narrative_probe",
          regime,
          confidenceScore: 61 + sentimentBias.confidenceDelta,
          observation:
            `I'm leaning ${side} ${symbol} to see whether the narrative spillover is real outside single-name tech.`,
          whyItMatters:
            `The sentiment sleeve is explicitly testing whether narrative momentum transfers into alternative-asset proxies instead of staying isolated inside mega-cap equities. ${sentimentBias.note}`,
          changeMind:
            "If the spillover does not survive outside the core names, I would kill it.",
          facts: {
            assetBucket: "alternative_proxy",
            sentimentVelocity: side === "buy" ? "POSITIVE" : "NEGATIVE",
          },
        }),
        reasoning:
          `The sentiment sleeve is explicitly testing whether narrative momentum transfers into alternative-asset proxies instead of staying isolated inside mega-cap equities. ${sentimentBias.note}`,
        signalContext: {
          regime,
          strategyFamily: "alternative_narrative_probe",
          assetBucket: "alternative_proxy",
          sentimentVelocity: side === "buy" ? "POSITIVE" : "NEGATIVE",
          ticker: symbol,
          discussionThread: discussionContext.threadId,
          discussionInfluence: sentimentBias.note,
          researchSource: discussionContext.researchSource,
          researchPacketSummary: discussionContext.researchPacketSummary,
        },
        confidenceScore: 61 + sentimentBias.confidenceDelta,
      };
    } else {
      const symbol = resolvePreferredSymbol(
        COMMODITY_PROXY_SYMBOLS,
        sentimentBias.preferredSymbol,
        cycleIndex,
        openUnderlyings
      );
      const notional = getAutonomousOrderNotional("AGT-SENT-001", 300, sentimentAllocation);

      if (!symbol) {
        return null;
      }

      const side =
        sentimentBias.sideBias !== "neutral"
          ? sentimentBias.sideBias
          : discussionContext.sentimentScore >= 60
            ? "buy"
            : "sell";

      intent = {
        agentId: "AGT-SENT-001",
        symbol,
        side,
        notional,
        assetBucket: "commodity_proxy",
        strategyFamily: "cross_asset_sentiment_probe",
        messageDraft: buildTradeOrderVoiceDraft({
          cycleIndex,
          agentId: "AGT-SENT-001",
          symbol,
          side,
          notional,
          strategyFamily: "cross_asset_sentiment_probe",
          regime,
          confidenceScore: 60 + sentimentBias.confidenceDelta,
          observation:
            `I'm leaning ${side} ${symbol} to test whether the narrative is leaking into commodity proxies.`,
          whyItMatters:
            `The sentiment sleeve is now checking whether crowd psychology transmits into commodity-linked proxies rather than limiting itself to single-name tech sentiment. ${sentimentBias.note}`,
          changeMind:
            "If the crowding stays trapped in equities, I would stop running this.",
          facts: {
            assetBucket: "commodity_proxy",
            sentimentVelocity: side === "buy" ? "POSITIVE" : "NEGATIVE",
          },
        }),
        reasoning:
          `The sentiment sleeve is now checking whether crowd psychology transmits into commodity-linked proxies rather than limiting itself to single-name tech sentiment. ${sentimentBias.note}`,
        signalContext: {
          regime,
          strategyFamily: "cross_asset_sentiment_probe",
          assetBucket: "commodity_proxy",
          sentimentVelocity: side === "buy" ? "POSITIVE" : "NEGATIVE",
          ticker: symbol,
          discussionThread: discussionContext.threadId,
          discussionInfluence: sentimentBias.note,
          researchSource: discussionContext.researchSource,
          researchPacketSummary: discussionContext.researchPacketSummary,
        },
        confidenceScore: 60 + sentimentBias.confidenceDelta,
      };
    }
  }

  if (!intent) {
    return null;
  }

  intent = applyDiscussionBiasToIntent(
    intent,
    discussionPlan.biasByAgent[intent.agentId as TradingAgentId],
    discussionContext
  );

  return applyRuntimeControlsToTradeIntent(
    intent,
    runtimeControls.get(intent.agentId as TradingAgentId) ?? {
      confidenceFloor: 0,
      notionalMultiplier: 1,
    }
  );
}

async function fetchBrokerState(): Promise<BrokerSyncState> {
  const [account, positions, recentOrders] = await Promise.all([
    getAlpacaAccount(),
    listAlpacaPositions(),
    listAlpacaRecentOrders(50),
  ]);

  return {
    account,
    positions,
    recentOrders,
  };
}

async function persistBrokerStateSnapshot(
  client: PoolClient,
  input: {
    cycleId: number | null;
    brokerState: BrokerSyncState;
    submittedOrderIds?: string[] | null;
  }
) {
  const capturedAt = new Date();
  const accountSnapshotId = await insertAlpacaAccountSnapshot(client, {
    cycleId: input.cycleId,
    snapshot: input.brokerState.account,
    capturedAt,
  });
  const syncedOrderIds = new Set<string>();

  await insertAlpacaPositionSnapshots(client, {
    accountSnapshotId,
    positions: input.brokerState.positions,
    capturedAt,
  });

  for (const orderId of input.submittedOrderIds ?? []) {
    if (orderId) {
      syncedOrderIds.add(orderId);
    }
  }

  for (const order of input.brokerState.recentOrders) {
    if (syncedOrderIds.has(order.brokerOrderId)) {
      continue;
    }

    await upsertAlpacaOrder(client, {
      cycleId: input.cycleId,
      agentId: inferAgentIdFromClientOrderId(order.clientOrderId),
      reasoning: "Broker sync refresh from Alpaca paper account.",
      requestPayload: {},
      order,
    });
  }
}

function isBrokerSnapshotStale(lastSyncedAt: string | null, now = Date.now()) {
  if (!lastSyncedAt) {
    return true;
  }

  const capturedAtMs = new Date(lastSyncedAt).getTime();

  if (!Number.isFinite(capturedAtMs)) {
    return true;
  }

  return now - capturedAtMs >= BROKER_SNAPSHOT_REFRESH_TTL_MS;
}

async function refreshBrokerSnapshotFromSource() {
  const brokerState = await fetchBrokerState();

  await withAgentTransaction(async (client) => {
    await persistBrokerStateSnapshot(client, {
      cycleId: null,
      brokerState,
    });
  });
}

async function getRealtimeBrokerSnapshot() {
  const currentSnapshot = await getBrokerDashboardSnapshot();

  if (!isBrokerSnapshotStale(currentSnapshot.account?.lastSyncedAt ?? null)) {
    return currentSnapshot;
  }

  if (!brokerSnapshotRefreshPromise) {
    brokerSnapshotRefreshPromise = (async () => {
      try {
        await refreshBrokerSnapshotFromSource();
      } finally {
        brokerSnapshotRefreshPromise = null;
      }
    })();
  }

  try {
    await brokerSnapshotRefreshPromise;
  } catch (error) {
    if (currentSnapshot.account) {
      return currentSnapshot;
    }

    throw error;
  }

  return getBrokerDashboardSnapshot();
}

async function buildStaleOrderCancellationMessage(input: {
  cycleId: number;
  order: AlpacaOrderSnapshot;
}) {
  const agentId =
    inferAgentIdFromClientOrderId(input.order.clientOrderId) ?? "AGT-RESEARCH";
  const ageMinutes = Math.max(1, Math.round(getOrderAgeMs(input.order) / 60_000));
  const ttlMinutes = Math.max(1, Math.round(getStaleOrderTtlMs(input.order) / 60_000));
  const parsedOption = parseAlpacaOptionContractSymbol(input.order.symbol);
  const incidentKey = buildIncidentKey([
    "stale-order-auto-cancelled",
    input.order.brokerOrderId,
  ]);

  return {
    senderId: agentId,
    messageType: "ENFORCEMENT_ACTION",
    priority: "HIGH",
    renderType: "action",
    content: await renderVoiceDraft({
      id: createVoiceDraftId(
        input.cycleId,
        "stale-order-auto-cancelled",
        agentId,
        input.order.symbol
      ),
      senderId: agentId,
      senderRole: getDeskAgentRole(agentId),
      messageType: "ENFORCEMENT_ACTION",
      priority: "HIGH",
      observation: `I canceled the stale ${input.order.symbol} order after it sat unfilled.`,
      whyItMatters:
        parsedOption
          ? `This was execution cleanup, not a thesis change: the option order was still ${input.order.status} after about ${ageMinutes} minutes, beyond its ${ttlMinutes}-minute TTL.`
          : `This was execution cleanup, not a thesis change: the equity order was still ${input.order.status} after about ${ageMinutes} minutes, beyond its ${ttlMinutes}-minute TTL.`,
      conviction: getConfidencePhrase(95),
      changeMind:
        "If the setup still matters next cycle, I can re-stage it cleanly instead of letting the stale ticket drift.",
      facts: {
        symbol: input.order.symbol,
        brokerOrderId: input.order.brokerOrderId,
        status: input.order.status,
        orderAgeMinutes: ageMinutes,
        ttlMinutes,
        assetClass: parsedOption ? "option" : "equity",
      },
    }),
    reasoning:
      "The runtime auto-cancelled a stale working order so the desk stops re-discussing a dead ticket.",
    payload: {
      cycleId: input.cycleId,
      brokerOrderId: input.order.brokerOrderId,
      symbol: input.order.symbol,
      status: input.order.status,
      orderAgeMinutes: ageMinutes,
      ttlMinutes,
      maintenanceAction: "AUTO_CANCEL_STALE_ORDER",
      incidentKey,
      dedupeKey: incidentKey,
      dedupeScope: "global",
      dedupeWindowMinutes: 240,
    },
    decision: {
      agentId,
      actionTaken: "auto_cancel_stale_broker_order",
      reasoning:
        "Working orders that exceed their TTL should be cancelled automatically so the next cycle can rebuild the trade from a clean slate.",
      dataConsumed: [
        `brokerOrderId:${input.order.brokerOrderId}`,
        `symbol:${input.order.symbol}`,
        `status:${input.order.status}`,
        `orderAgeMinutes:${ageMinutes}`,
        `ttlMinutes:${ttlMinutes}`,
      ],
      confidenceScore: 95,
    },
  } satisfies PaperRuntimeMessageSeed;
}

async function runBrokerOrderMaintenance(input: {
  cycleId: number;
  brokerState: BrokerSyncState;
}) : Promise<BrokerOrderMaintenanceResult> {
  const staleOrders = input.brokerState.recentOrders.filter((order) =>
    shouldAutoCancelStaleOrder(order)
  );

  if (staleOrders.length === 0) {
    return {
      brokerState: input.brokerState,
      messages: [],
    };
  }

  const messages: PaperRuntimeMessageSeed[] = [];

  for (const order of staleOrders) {
    await cancelAlpacaOrder(order.brokerOrderId);
    messages.push(
      await buildStaleOrderCancellationMessage({
        cycleId: input.cycleId,
        order,
      })
    );
  }

  return {
    brokerState: await fetchBrokerState(),
    messages,
  };
}

function supportsExtendedHoursRouting(session: RuntimeSessionSnapshot) {
  return session.phase === "PRE_MARKET" || session.phase === "POST_MARKET";
}

function roundOrderPrice(value: number) {
  const decimals = value >= 1 ? 2 : 4;
  return Number(value.toFixed(decimals));
}

function getExtendedHoursReferencePrice(
  side: AlpacaOrderSide,
  snapshot: AlpacaStockSnapshot
) {
  if (side === "buy") {
    return snapshot.askPrice ?? snapshot.tradePrice ?? snapshot.previousClose;
  }

  return snapshot.bidPrice ?? snapshot.tradePrice ?? snapshot.previousClose;
}

function buildExtendedHoursLimitPrice(
  side: AlpacaOrderSide,
  snapshot: AlpacaStockSnapshot
) {
  const referencePrice = getExtendedHoursReferencePrice(side, snapshot);

  if (!referencePrice || referencePrice <= 0) {
    throw new Error(
      `Unable to derive an extended-hours reference price for ${snapshot.symbol}.`
    );
  }

  const bufferedPrice =
    side === "buy" ? referencePrice * 1.003 : referencePrice * 0.997;

  return roundOrderPrice(bufferedPrice);
}

function validateTradeIntentShape(intent: BrokerTradeIntent): ExecutableIntentValidationResult {
  const displaySymbol = intent.displaySymbol ?? intent.symbol;

  if (!intent.symbol.trim() || intent.notional <= 0) {
    return {
      ok: false,
      code: "TRADE_INTENT_INVALID_BASE",
      reason: `Trade intent for ${displaySymbol} is missing a valid symbol or notional.`,
      dataConsumed: [`symbol:${intent.symbol}`, `notional:${intent.notional}`],
    };
  }

  if (intent.executionPlan?.kind === "equity_pair") {
    const legs = intent.executionPlan.legs;
    const buyLegs = legs.filter((leg) => leg.side === "buy");
    const sellLegs = legs.filter((leg) => leg.side === "sell");

    if (
      legs.length !== 2 ||
      buyLegs.length !== 1 ||
      sellLegs.length !== 1 ||
      !legs[0]?.symbol ||
      !legs[1]?.symbol ||
      legs[0].symbol === legs[1].symbol
    ) {
      return {
        ok: false,
        code: "TRADE_INTENT_INVALID_EQUITY_PAIR",
        reason:
          `Trade intent for ${displaySymbol} is malformed; paired trades require one long leg, one short leg, and two distinct symbols.`,
        dataConsumed: legs.map((leg, index) => `leg${index + 1}:${leg.symbol}:${leg.side}:${leg.notional}`),
      };
    }
  }

  return {
    ok: true,
    intent,
    dataConsumed: [],
  };
}

async function resolveExecutableTradeIntent(input: {
  intent: BrokerTradeIntent;
  brokerState: BrokerSyncState;
}): Promise<ExecutableIntentValidationResult> {
  const shapeValidation = validateTradeIntentShape(input.intent);

  if (!shapeValidation.ok) {
    return shapeValidation;
  }

  const intent = shapeValidation.intent;

  if (!intent.executionPlan || intent.executionPlan.kind === "option_single" || intent.executionPlan.kind === "option_mleg") {
    if (intent.assetBucket === "equity_option") {
      return {
        ok: true,
        intent,
        dataConsumed: [],
      };
    }

    try {
      const workingOrder = getWorkingBrokerOrderForAgent({
        brokerState: input.brokerState,
        agentId: intent.agentId,
        symbol: intent.symbol,
        side: intent.side,
      });

      if (workingOrder) {
        return {
          ok: false,
          code: "LIVE_ORDER_ALREADY_WORKING",
          reason:
            `A live ${intent.side.toUpperCase()} order for ${intent.symbol} is already working at Alpaca, so the runtime will not stack another ticket on top of it.`,
          dataConsumed: [
            `brokerOrderId:${workingOrder.brokerOrderId}`,
            `symbol:${workingOrder.symbol}`,
            `status:${workingOrder.status}`,
          ],
        };
      }

      const asset = await getAlpacaAsset(intent.symbol);
      const dataConsumed = [
        `symbol:${asset.symbol}`,
        `tradable:${String(asset.tradable)}`,
        `fractionable:${String(asset.fractionable)}`,
        `shortable:${String(asset.shortable)}`,
      ];

      if (asset.tradable === false) {
        return {
          ok: false,
          code: "ASSET_NOT_TRADABLE",
          reason: `${intent.symbol} is not tradable at Alpaca right now, so the order was blocked before broker submit.`,
          dataConsumed,
        };
      }

      if (intent.side === "buy" && asset.fractionable !== true) {
        const snapshot = await getAlpacaStockSnapshot(intent.symbol);
        const referencePrice = getStockReferencePriceForSide("buy", snapshot);

        if (!referencePrice || referencePrice <= 0) {
          return {
            ok: false,
            code: "PRICE_REFERENCE_UNAVAILABLE",
            reason:
              `The runtime could not derive a usable reference price for ${intent.symbol}, so it could not convert the order into whole shares safely.`,
            dataConsumed: [...dataConsumed, `referencePrice:${String(referencePrice)}`],
          };
        }

        const qty = getWholeShareQtyForNotional(intent.notional, referencePrice);

        if (qty < 1) {
          return {
            ok: false,
            code: "NON_FRACTIONABLE_ORDER_TOO_SMALL",
            reason:
              `${intent.symbol} does not support fractional routing here, and the approved notional is smaller than one share at the current reference price.`,
            dataConsumed: [
              ...dataConsumed,
              `referencePrice:${referencePrice}`,
              `approvedNotional:${intent.notional}`,
            ],
          };
        }

        const adjustedNotional = roundToStep(qty * referencePrice, 10);

        return {
          ok: true,
          intent: {
            ...intent,
            notional: adjustedNotional,
            shareQuantity: qty,
            signalContext: {
              ...intent.signalContext,
              executionSizingMode: "WHOLE_SHARE_QTY",
              executionReferencePrice: roundToStep(referencePrice, 0.01),
            },
          },
          dataConsumed: [
            ...dataConsumed,
            `referencePrice:${referencePrice}`,
            `qty:${qty}`,
            `adjustedNotional:${adjustedNotional}`,
          ],
        };
      }

      return {
        ok: true,
        intent,
        dataConsumed,
      };
    } catch (error) {
      return {
        ok: false,
        code: "PRETRADE_LOOKUP_FAILED",
        reason:
          error instanceof Error
            ? error.message
            : `Pre-trade lookup failed for ${intent.symbol}.`,
        dataConsumed: [`symbol:${intent.symbol}`],
      };
    }
  }

  try {
    const longLeg = intent.executionPlan.legs.find((leg) => leg.side === "buy");
    const shortLeg = intent.executionPlan.legs.find((leg) => leg.side === "sell");

    if (!longLeg || !shortLeg) {
      return {
        ok: false,
        code: "TRADE_INTENT_INVALID_EQUITY_PAIR",
        reason:
          `Trade intent for ${intent.displaySymbol ?? intent.symbol} is missing a long or short leg.`,
        dataConsumed: intent.executionPlan.legs.map(
          (leg, index) => `leg${index + 1}:${leg.symbol}:${leg.side}:${leg.notional}`
        ),
      };
    }

    const [longWorkingOrder, shortWorkingOrder] = [
      getWorkingBrokerOrderForAgent({
        brokerState: input.brokerState,
        agentId: intent.agentId,
        symbol: longLeg.symbol,
        side: "buy",
      }),
      getWorkingBrokerOrderForAgent({
        brokerState: input.brokerState,
        agentId: intent.agentId,
        symbol: shortLeg.symbol,
        side: "sell",
      }),
    ];

    if (longWorkingOrder || shortWorkingOrder) {
      const workingOrder = longWorkingOrder ?? shortWorkingOrder;

      return {
        ok: false,
        code: "LIVE_ORDER_ALREADY_WORKING",
        reason:
          `A live ${workingOrder?.side.toUpperCase()} order for ${workingOrder?.symbol} is already working at Alpaca, so the pair was blocked until that ticket resolves.`,
        dataConsumed: [
          `brokerOrderId:${workingOrder?.brokerOrderId ?? "unknown"}`,
          `symbol:${workingOrder?.symbol ?? "unknown"}`,
          `status:${workingOrder?.status ?? "unknown"}`,
        ],
      };
    }

    const recentShortFailure = getRecentShortAvailabilityFailure(shortLeg.symbol);

    if (recentShortFailure) {
      return {
        ok: false,
        code: "SHORT_LOCATE_RECENTLY_FAILED",
        reason:
          `Recent borrow validation for ${shortLeg.symbol} already failed, so the runtime is standing down instead of retrying the short immediately: ${recentShortFailure.message}`,
        dataConsumed: [`symbol:${shortLeg.symbol}`, "shortLocateCache:true"],
      };
    }

    const [longAsset, shortAsset, longSnapshot, shortSnapshot] = await Promise.all([
      getAlpacaAsset(longLeg.symbol),
      getAlpacaAsset(shortLeg.symbol),
      getAlpacaStockSnapshot(longLeg.symbol),
      getAlpacaStockSnapshot(shortLeg.symbol),
    ]);
    const dataConsumed = [
      `longSymbol:${longLeg.symbol}`,
      `shortSymbol:${shortLeg.symbol}`,
      `longFractionable:${String(longAsset.fractionable)}`,
      `shortShortable:${String(shortAsset.shortable)}`,
      `shortEasyToBorrow:${String(shortAsset.easyToBorrow)}`,
    ];

    if (longAsset.tradable === false) {
      return {
        ok: false,
        code: "LONG_LEG_NOT_TRADABLE",
        reason: `${longLeg.symbol} is not tradable at Alpaca right now, so the pair was blocked before submit.`,
        dataConsumed,
      };
    }

    if (shortAsset.tradable === false || shortAsset.shortable === false) {
      return {
        ok: false,
        code: "SHORT_LEG_NOT_BORROWABLE",
        reason:
          `${shortLeg.symbol} is not shortable at Alpaca right now, so the short leg was blocked before submit.`,
        dataConsumed,
      };
    }

    const longReferencePrice = getStockReferencePriceForSide("buy", longSnapshot);
    const shortReferencePrice = getStockReferencePriceForSide("sell", shortSnapshot);

    if (!longReferencePrice || longReferencePrice <= 0 || !shortReferencePrice || shortReferencePrice <= 0) {
      return {
        ok: false,
        code: "PRICE_REFERENCE_UNAVAILABLE",
        reason:
          `The runtime could not derive a reliable stock reference price for ${intent.displaySymbol ?? intent.symbol}, so the pair was blocked before submit.`,
        dataConsumed: [
          ...dataConsumed,
          `longReferencePrice:${String(longReferencePrice)}`,
          `shortReferencePrice:${String(shortReferencePrice)}`,
        ],
      };
    }

    const normalizedLongLeg =
      longAsset.fractionable === true
        ? {
            ...longLeg,
            qty: undefined,
          }
        : (() => {
            const qty = getWholeShareQtyForNotional(longLeg.notional, longReferencePrice);

            return {
              ...longLeg,
              qty,
              notional: roundToStep(qty * longReferencePrice, 10),
            };
          })();
    const shortQty = getWholeShareQtyForNotional(shortLeg.notional, shortReferencePrice);

    if ((normalizedLongLeg.qty ?? 1) < 1 || shortQty < 1) {
      return {
        ok: false,
        code: "ORDER_TOO_SMALL_FOR_WHOLE_SHARES",
        reason:
          `The approved pair size for ${intent.displaySymbol ?? intent.symbol} is too small to route both legs in whole shares safely.`,
        dataConsumed: [
          ...dataConsumed,
          `longReferencePrice:${longReferencePrice}`,
          `shortReferencePrice:${shortReferencePrice}`,
          `longNotional:${normalizedLongLeg.notional}`,
          `shortNotional:${shortLeg.notional}`,
        ],
      };
    }

    const normalizedShortLeg = {
      ...shortLeg,
      qty: shortQty,
      notional: roundToStep(shortQty * shortReferencePrice, 10),
    };
    const normalizedLegs = [
      normalizedLongLeg,
      normalizedShortLeg,
    ] as [
      {
        symbol: string;
        side: AlpacaOrderSide;
        notional: number;
        qty?: number | null;
      },
      {
        symbol: string;
        side: AlpacaOrderSide;
        notional: number;
        qty?: number | null;
      },
    ];
    const normalizedNotional = normalizedLegs.reduce(
      (sum, leg) => sum + leg.notional,
      0
    );

    return {
      ok: true,
      intent: {
        ...intent,
        notional: normalizedNotional,
        signalContext: {
          ...intent.signalContext,
          executionSizingMode: "PAIR_WHOLE_SHARE_PRECHECK",
          longReferencePrice: roundToStep(longReferencePrice, 0.01),
          shortReferencePrice: roundToStep(shortReferencePrice, 0.01),
          shortEasyToBorrow: shortAsset.easyToBorrow,
        },
        executionPlan: {
          kind: "equity_pair",
          legs: normalizedLegs,
        },
      },
      dataConsumed: [
        ...dataConsumed,
        `longReferencePrice:${longReferencePrice}`,
        `shortReferencePrice:${shortReferencePrice}`,
        `longQty:${String(normalizedLongLeg.qty ?? "fractional_notional")}`,
        `shortQty:${shortQty}`,
        `normalizedNotional:${normalizedNotional}`,
      ],
    };
  } catch (error) {
    return {
      ok: false,
      code: "PRETRADE_LOOKUP_FAILED",
      reason:
        error instanceof Error
          ? error.message
          : `Pre-trade validation failed for ${intent.displaySymbol ?? intent.symbol}.`,
      dataConsumed: [`symbol:${intent.symbol}`],
    };
  }
}

async function buildOrderRequest(
  cycleId: number,
  intent: BrokerTradeIntent,
  session: RuntimeSessionSnapshot
): Promise<PreparedOrderRequest> {
  const buildEquityOrderRequest = async (input: {
    symbol: string;
    side: AlpacaOrderSide;
    notional: number;
    qty?: number | null;
    clientOrderId: string;
  }) => {
    const useQty = typeof input.qty === "number" && input.qty > 0;

    if (!supportsExtendedHoursRouting(session)) {
      const marketOrder: AlpacaSubmitOrderInput = {
        kind: "equity",
        symbol: input.symbol,
        side: input.side,
        ...(useQty ? { qty: input.qty ?? undefined } : { notional: input.notional }),
        type: "market",
        timeInForce: "day",
        clientOrderId: input.clientOrderId,
      };

      return {
        orderRequest: marketOrder,
        requestPayload: {
          symbol: marketOrder.symbol,
          side: marketOrder.side,
          qty: marketOrder.qty ?? null,
          notional: marketOrder.notional ?? null,
          type: marketOrder.type,
          time_in_force: marketOrder.timeInForce,
          client_order_id: marketOrder.clientOrderId,
        },
      };
    }

    const priceSnapshot = await getAlpacaStockSnapshot(input.symbol);
    const limitPrice = buildExtendedHoursLimitPrice(input.side, priceSnapshot);
    const limitOrder: AlpacaSubmitOrderInput = {
      kind: "equity",
      symbol: input.symbol,
      side: input.side,
      ...(useQty ? { qty: input.qty ?? undefined } : { notional: input.notional }),
      type: "limit",
      timeInForce: "day",
      limitPrice,
      extendedHours: true,
      clientOrderId: input.clientOrderId,
    };

    return {
      orderRequest: limitOrder,
        requestPayload: {
          symbol: limitOrder.symbol,
          side: limitOrder.side,
          qty: limitOrder.qty ?? null,
          notional: limitOrder.notional ?? null,
          type: limitOrder.type,
          time_in_force: limitOrder.timeInForce,
          limit_price: limitOrder.limitPrice,
        extended_hours: true,
        client_order_id: limitOrder.clientOrderId,
        price_context: {
          ask: priceSnapshot.askPrice,
          bid: priceSnapshot.bidPrice,
          trade: priceSnapshot.tradePrice,
          previous_close: priceSnapshot.previousClose,
        },
      },
    };
  };

  const clientOrderId = buildClientOrderId(cycleId, intent.agentId);

  if (intent.executionPlan?.kind === "option_single") {
    const optionOrder: AlpacaSubmitOrderInput = {
      kind: "option",
      symbol: intent.executionPlan.contractSymbol,
      side: "buy",
      qty: intent.executionPlan.qty,
      type: "limit",
      timeInForce: "day",
      limitPrice: intent.executionPlan.limitPrice,
      clientOrderId,
      positionIntent: intent.executionPlan.positionIntent,
    };

    return {
      orderRequests: [optionOrder],
      requestPayload: {
        order_count: 1,
        symbol: optionOrder.symbol,
        side: optionOrder.side,
        qty: optionOrder.qty,
        type: optionOrder.type,
        time_in_force: optionOrder.timeInForce,
        limit_price: optionOrder.limitPrice,
        position_intent: optionOrder.positionIntent,
        client_order_id: optionOrder.clientOrderId,
        underlying_symbol: intent.symbol,
        strategy_family: intent.strategyFamily,
      },
    };
  }

  if (intent.executionPlan?.kind === "option_mleg") {
    const multiLegOrder: AlpacaSubmitOrderInput = {
      kind: "option_mleg",
      qty: intent.executionPlan.qty,
      type: "limit",
      timeInForce: "day",
      limitPrice: intent.executionPlan.limitPrice,
      clientOrderId,
      orderClass: "mleg",
      legs: intent.executionPlan.legs,
    };

    return {
      orderRequests: [multiLegOrder],
      requestPayload: {
        order_count: 1,
        qty: multiLegOrder.qty,
        type: multiLegOrder.type,
        time_in_force: multiLegOrder.timeInForce,
        limit_price: multiLegOrder.limitPrice,
        order_class: "mleg",
        legs: intent.executionPlan.legs.map((leg) => ({
          symbol: leg.symbol,
          ratio_qty: leg.ratioQty,
          side: leg.side,
          position_intent: leg.positionIntent,
        })),
        client_order_id: multiLegOrder.clientOrderId,
        underlying_symbol: intent.symbol,
        strategy_family: intent.strategyFamily,
      },
    };
  }

  if (intent.executionPlan?.kind === "equity_pair") {
    const legRequests = await Promise.all(
      intent.executionPlan.legs.map(async (leg, index) => {
        const result = await buildEquityOrderRequest({
          symbol: leg.symbol,
          side: leg.side,
          notional: leg.notional,
          qty: leg.qty ?? undefined,
          clientOrderId: buildClientOrderId(
            cycleId,
            intent.agentId,
            `leg${index + 1}`
          ),
        });

        return {
          orderRequest: result.orderRequest,
          requestPayload: {
            ...result.requestPayload,
            pair_role: leg.side === "buy" ? "long_leg" : "short_leg",
          },
        };
      })
    );

    return {
      orderRequests: legRequests.map((item) => item.orderRequest),
      requestPayload: {
        order_count: legRequests.length,
        execution_kind: "equity_pair",
        legs: legRequests.map((item) => item.requestPayload),
        strategy_family: intent.strategyFamily,
        display_symbol: intent.displaySymbol ?? intent.symbol,
      },
    };
  }

  const equityRequest = await buildEquityOrderRequest({
    symbol: intent.symbol,
    side: intent.side,
    notional: intent.notional,
    qty: intent.shareQuantity ?? undefined,
    clientOrderId,
  });

  return {
    orderRequests: [equityRequest.orderRequest],
    requestPayload: {
      order_count: 1,
      ...equityRequest.requestPayload,
    },
  };
}

function normalizeAgentRiskGuardrails(
  guardrails: AgentRiskGuardrails
): SleeveRiskGuardrails {
  if (
    !Number.isFinite(guardrails.maxSingleOrderPctOfAllocation) ||
    !Number.isFinite(guardrails.maxSleeveUtilizationPct) ||
    !Number.isFinite(guardrails.maxPortfolioGrossExposurePct) ||
    !Number.isFinite(guardrails.buyingPowerBufferPct) ||
    !Number.isFinite(guardrails.minOrderNotional)
  ) {
    throw new Error("research lead guardrails must be finite numeric values.");
  }

  if (
    guardrails.maxSingleOrderPctOfAllocation <= 0 ||
    guardrails.maxSleeveUtilizationPct <= 0 ||
    guardrails.maxPortfolioGrossExposurePct <= 0 ||
    guardrails.buyingPowerBufferPct <= 0 ||
    guardrails.minOrderNotional <= 0
  ) {
    throw new Error("research lead guardrails must be greater than zero.");
  }

  return {
    maxSingleOrderPctOfAllocation: guardrails.maxSingleOrderPctOfAllocation,
    maxSleeveUtilizationPct: guardrails.maxSleeveUtilizationPct,
    maxPortfolioGrossExposurePct: guardrails.maxPortfolioGrossExposurePct,
    buyingPowerBufferPct: guardrails.buyingPowerBufferPct,
    minOrderNotional: guardrails.minOrderNotional,
  };
}

function applyCioTargetsToAllocationInputs(
  allocationInputs: CioAllocationInput[],
  cioDecision: CioAgentDecision
) {
  return allocationInputs.map((input) => {
    if (!isConfiguredTradingAgentId(input.agentId)) {
      return input;
    }

    return {
      ...input,
      currentAllocationUsd:
        cioDecision.allocations[input.agentId].targetAllocationUsd,
    } satisfies CioAllocationInput;
  });
}

function summarizeTradeIntentForAgent(input: {
  intent: BrokerTradeIntent;
}): AgentTradeIntentSummary {
  return {
    agentId: input.intent.agentId,
    symbol: input.intent.symbol,
    side: input.intent.side,
    requestedNotionalUsd: input.intent.notional,
    assetBucket: input.intent.assetBucket,
    strategyFamily: input.intent.strategyFamily,
    displaySymbol: input.intent.displaySymbol ?? null,
    executionKind: input.intent.executionPlan?.kind ?? "equity",
    contractSymbols:
      input.intent.executionPlan?.kind === "option_single"
        ? [input.intent.executionPlan.contractSymbol]
        : input.intent.executionPlan?.kind === "option_mleg"
          ? input.intent.executionPlan.contractSymbols
          : input.intent.executionPlan?.kind === "equity_pair"
            ? input.intent.executionPlan.legs.map((leg) => leg.symbol)
          : [],
    signalContext: input.intent.signalContext,
  };
}

async function buildAgentDrivenOptionExecution(input: {
  session: RuntimeSessionSnapshot;
  researchDecision: ResearchAgentDecision;
  agentDecision: TraderAgentDecision;
  symbol: string;
  notional: number;
}) {
  const trade = input.agentDecision.trade;

  if (!trade) {
    return null;
  }

  // Alpaca's option-chain endpoints expect the underlying ticker, not an OCC contract.
  const underlyingSymbol = normalizeOptionUnderlyingSymbol(input.symbol);
  const [underlyingSnapshot, optionSnapshots] = await Promise.all([
    getAlpacaStockSnapshot(underlyingSymbol),
    listAlpacaOptionSnapshots(underlyingSymbol, { limit: 250 }),
  ]);
  const referencePrice =
    underlyingSnapshot.tradePrice ??
    underlyingSnapshot.askPrice ??
    underlyingSnapshot.bidPrice ??
    underlyingSnapshot.previousClose;

  if (!referencePrice || referencePrice <= 0) {
    return null;
  }

  const candidates = buildOptionExecutionCandidates({
    trade,
    snapshots: optionSnapshots,
    referencePrice,
  });

  if (candidates.length === 0) {
    return null;
  }

  return {
    referencePrice,
    candidates,
    decision: await getAgentOptionExecutionDecision({
      agentId: input.agentDecision.agentId,
      session: input.session,
      researchDecision: input.researchDecision,
      traderDecision: input.agentDecision,
      tradeIntent: {
        agentId: input.agentDecision.agentId,
        symbol: underlyingSymbol,
        side: "buy",
        requestedNotionalUsd: input.notional,
        assetBucket: "equity_option",
        strategyFamily: trade.strategyFamily,
        displaySymbol: null,
        executionKind:
          trade.expressionKind === "option_single"
            ? "option_single"
            : "option_mleg",
        contractSymbols: [],
        signalContext: {
          thesisLabel: trade.thesisLabel,
          expressionKind: trade.expressionKind,
        },
      },
      underlyingReferencePrice: referencePrice,
      candidates,
    }),
  };
}

async function buildTradeIntentFromAgentDecision(input: {
  cycleIndex: number;
  session: RuntimeSessionSnapshot;
  regime: string;
  researchDecision: ResearchAgentDecision;
  agentDecision: TraderAgentDecision;
}): Promise<BrokerTradeIntent | null> {
  const tradeIdea = input.agentDecision.trade;
  const agentDecisionSource = isPythonTradingAgentId(input.agentDecision.agentId)
    ? "PYTHON_SYSTEMATIC"
    : "MODEL";

  if (!input.agentDecision.shouldTrade || !tradeIdea) {
    return null;
  }

  const symbol =
    tradeIdea.expressionKind === "option_single" ||
    tradeIdea.expressionKind === "option_spread" ||
    tradeIdea.expressionKind === "long_straddle"
      ? normalizeOptionUnderlyingSymbol(tradeIdea.symbol)
      : tradeIdea.symbol.trim().toUpperCase();
  const notional = roundToStep(tradeIdea.requestedNotionalUsd, 10);

  if (!symbol || notional <= 0) {
    return null;
  }

  if (tradeIdea.expressionKind === "equity") {
    return {
      agentId: input.agentDecision.agentId,
      symbol,
      side: tradeIdea.side,
      notional,
      assetBucket:
        tradeIdea.assetBucketLabel === "credit_proxy"
          ? "credit_proxy"
          : tradeIdea.assetBucketLabel === "commodity_proxy"
            ? "commodity_proxy"
            : tradeIdea.assetBucketLabel === "alternative_proxy"
              ? "alternative_proxy"
              : "equity",
      strategyFamily: tradeIdea.strategyFamily,
      messageDraft: buildTradeOrderVoiceDraft({
        cycleIndex: input.cycleIndex,
        agentId: input.agentDecision.agentId,
        symbol,
        side: tradeIdea.side,
        notional,
        strategyFamily: tradeIdea.strategyFamily,
        regime: input.regime,
        confidenceScore: input.agentDecision.confidenceScore,
        observation: input.agentDecision.observation,
        whyItMatters: input.agentDecision.whyItMatters,
        changeMind: input.agentDecision.changeMind,
        facts: {
          thesisLabel: tradeIdea.thesisLabel,
          agentDecisionSource,
        },
      }),
      reasoning: input.agentDecision.reasoning,
      signalContext: {
        agentDecisionSource,
        thesisLabel: tradeIdea.thesisLabel,
        strategyFamily: tradeIdea.strategyFamily,
      },
      confidenceScore: input.agentDecision.confidenceScore,
    };
  }

  if (tradeIdea.expressionKind === "equity_pair") {
    const longSymbol = tradeIdea.longSymbol?.trim().toUpperCase();
    const shortSymbol = tradeIdea.shortSymbol?.trim().toUpperCase();
    const longNotionalUsd = roundToStep(tradeIdea.longNotionalUsd ?? 0, 10);
    const shortNotionalUsd = roundToStep(tradeIdea.shortNotionalUsd ?? 0, 10);

    if (
      !longSymbol ||
      !shortSymbol ||
      longSymbol === shortSymbol ||
      longNotionalUsd <= 0 ||
      shortNotionalUsd <= 0
    ) {
      return null;
    }

    const grossNotional = roundToStep(longNotionalUsd + shortNotionalUsd, 10);
    const displaySymbol = `${longSymbol} long / ${shortSymbol} short`;

    return {
      agentId: input.agentDecision.agentId,
      symbol: longSymbol,
      side: "buy",
      notional: grossNotional,
      assetBucket: "equity",
      strategyFamily: tradeIdea.strategyFamily,
      displaySymbol,
      executionPlan: {
        kind: "equity_pair",
        legs: [
          {
            symbol: longSymbol,
            side: "buy",
            notional: longNotionalUsd,
          },
          {
            symbol: shortSymbol,
            side: "sell",
            notional: shortNotionalUsd,
          },
        ],
      },
      messageDraft: buildTradeOrderVoiceDraft({
        cycleIndex: input.cycleIndex,
        agentId: input.agentDecision.agentId,
        symbol: longSymbol,
        displaySymbol,
        side: "buy",
        notional: grossNotional,
        strategyFamily: tradeIdea.strategyFamily,
        regime: input.regime,
        confidenceScore: input.agentDecision.confidenceScore,
        observation: input.agentDecision.observation,
        whyItMatters: input.agentDecision.whyItMatters,
        changeMind: input.agentDecision.changeMind,
        facts: {
          thesisLabel: tradeIdea.thesisLabel,
          pairLongSymbol: longSymbol,
          pairShortSymbol: shortSymbol,
          longNotionalUsd,
          shortNotionalUsd,
          agentDecisionSource,
        },
      }),
      reasoning: input.agentDecision.reasoning,
      signalContext: {
        agentDecisionSource,
        thesisLabel: tradeIdea.thesisLabel,
        strategyFamily: tradeIdea.strategyFamily,
        pairLongSymbol: longSymbol,
        pairShortSymbol: shortSymbol,
        longNotionalUsd,
        shortNotionalUsd,
      },
      confidenceScore: input.agentDecision.confidenceScore,
    };
  }

  if (tradeIdea.expressionKind === "option_single") {
    const optionExecution = await buildAgentDrivenOptionExecution({
      session: input.session,
      researchDecision: input.researchDecision,
      agentDecision: input.agentDecision,
      symbol,
      notional,
    });

    if (!optionExecution || !optionExecution.decision.canExecute || !("contractSymbol" in optionExecution.decision)) {
      return null;
    }

    return {
      agentId: input.agentDecision.agentId,
      symbol,
      side: "buy",
      notional: roundToStep(
        optionExecution.decision.limitPrice * optionExecution.decision.qty * 100,
        10
      ),
      assetBucket: "equity_option",
      strategyFamily: tradeIdea.strategyFamily,
      displaySymbol: optionExecution.decision.contractSymbol,
      executionPlan: {
        kind: "option_single",
        contractSymbol: optionExecution.decision.contractSymbol,
        qty: optionExecution.decision.qty,
        limitPrice: optionExecution.decision.limitPrice,
        positionIntent: "buy_to_open",
      },
      messageDraft: buildTradeOrderVoiceDraft({
        cycleIndex: input.cycleIndex,
        agentId: input.agentDecision.agentId,
        symbol,
        displaySymbol: optionExecution.decision.contractSymbol,
        side: "buy",
        notional: roundToStep(
          optionExecution.decision.limitPrice * optionExecution.decision.qty * 100,
          10
        ),
        strategyFamily: tradeIdea.strategyFamily,
        regime: input.regime,
        confidenceScore: input.agentDecision.confidenceScore,
        observation: input.agentDecision.observation,
        whyItMatters: input.agentDecision.whyItMatters,
        changeMind: input.agentDecision.changeMind,
        facts: {
          thesisLabel: tradeIdea.thesisLabel,
          optionContract: optionExecution.decision.contractSymbol,
          agentDecisionSource,
        },
      }),
      reasoning: `${input.agentDecision.reasoning} ${optionExecution.decision.rationale}`,
      signalContext: {
        agentDecisionSource,
        thesisLabel: tradeIdea.thesisLabel,
        strategyFamily: tradeIdea.strategyFamily,
        optionContract: optionExecution.decision.contractSymbol,
        optionExecutionDataConsumed: optionExecution.decision.dataConsumed,
      },
      confidenceScore: input.agentDecision.confidenceScore,
    };
  }

  if (tradeIdea.expressionKind === "option_spread") {
    const optionExecution = await buildAgentDrivenOptionExecution({
      session: input.session,
      researchDecision: input.researchDecision,
      agentDecision: input.agentDecision,
      symbol,
      notional,
    });

    if (
      !optionExecution ||
      !optionExecution.decision.canExecute ||
      !("longContractSymbol" in optionExecution.decision) ||
      !("shortContractSymbol" in optionExecution.decision)
    ) {
      return null;
    }

    const displaySymbol = `${optionExecution.decision.longContractSymbol} / ${optionExecution.decision.shortContractSymbol}`;
    const estimatedNotional = roundToStep(
      optionExecution.decision.limitPrice * optionExecution.decision.qty * 100,
      10
    );

    return {
      agentId: input.agentDecision.agentId,
      symbol,
      side: "buy",
      notional: estimatedNotional,
      assetBucket: "equity_option",
      strategyFamily: tradeIdea.strategyFamily,
      displaySymbol,
      executionPlan: {
        kind: "option_mleg",
        qty: optionExecution.decision.qty,
        limitPrice: optionExecution.decision.limitPrice,
        legs: [
          {
            symbol: optionExecution.decision.longContractSymbol,
            ratioQty: 1,
            side: "buy",
            positionIntent: "buy_to_open",
          },
          {
            symbol: optionExecution.decision.shortContractSymbol,
            ratioQty: 1,
            side: "sell",
            positionIntent: "sell_to_open",
          },
        ],
        contractSymbols: [
          optionExecution.decision.longContractSymbol,
          optionExecution.decision.shortContractSymbol,
        ],
      },
      messageDraft: buildTradeOrderVoiceDraft({
        cycleIndex: input.cycleIndex,
        agentId: input.agentDecision.agentId,
        symbol,
        displaySymbol,
        side: "buy",
        notional: estimatedNotional,
        strategyFamily: tradeIdea.strategyFamily,
        regime: input.regime,
        confidenceScore: input.agentDecision.confidenceScore,
        observation: input.agentDecision.observation,
        whyItMatters: input.agentDecision.whyItMatters,
        changeMind: input.agentDecision.changeMind,
        facts: {
          thesisLabel: tradeIdea.thesisLabel,
          optionContracts: [
            optionExecution.decision.longContractSymbol,
            optionExecution.decision.shortContractSymbol,
          ],
          agentDecisionSource,
        },
      }),
      reasoning: `${input.agentDecision.reasoning} ${optionExecution.decision.rationale}`,
      signalContext: {
        agentDecisionSource,
        thesisLabel: tradeIdea.thesisLabel,
        strategyFamily: tradeIdea.strategyFamily,
        optionContracts: [
          optionExecution.decision.longContractSymbol,
          optionExecution.decision.shortContractSymbol,
        ],
        optionExecutionDataConsumed: optionExecution.decision.dataConsumed,
      },
      confidenceScore: input.agentDecision.confidenceScore,
    };
  }

  const optionExecution = await buildAgentDrivenOptionExecution({
    session: input.session,
    researchDecision: input.researchDecision,
    agentDecision: input.agentDecision,
    symbol,
    notional,
  });

  if (
    !optionExecution ||
    !optionExecution.decision.canExecute ||
    !("callContractSymbol" in optionExecution.decision) ||
    !("putContractSymbol" in optionExecution.decision)
  ) {
    return null;
  }

  const displaySymbol = `${optionExecution.decision.callContractSymbol} + ${optionExecution.decision.putContractSymbol}`;
  const estimatedNotional = roundToStep(
    optionExecution.decision.limitPrice * optionExecution.decision.qty * 100,
    10
  );

  return {
    agentId: input.agentDecision.agentId,
    symbol,
    side: "buy",
    notional: estimatedNotional,
    assetBucket: "equity_option",
    strategyFamily: tradeIdea.strategyFamily,
    displaySymbol,
    executionPlan: {
      kind: "option_mleg",
      qty: optionExecution.decision.qty,
      limitPrice: optionExecution.decision.limitPrice,
      legs: [
        {
          symbol: optionExecution.decision.callContractSymbol,
          ratioQty: 1,
          side: "buy",
          positionIntent: "buy_to_open",
        },
        {
          symbol: optionExecution.decision.putContractSymbol,
          ratioQty: 1,
          side: "buy",
          positionIntent: "buy_to_open",
        },
      ],
      contractSymbols: [
        optionExecution.decision.callContractSymbol,
        optionExecution.decision.putContractSymbol,
      ],
    },
    messageDraft: buildTradeOrderVoiceDraft({
      cycleIndex: input.cycleIndex,
      agentId: input.agentDecision.agentId,
      symbol,
      displaySymbol,
      side: "buy",
      notional: estimatedNotional,
      strategyFamily: tradeIdea.strategyFamily,
      regime: input.regime,
      confidenceScore: input.agentDecision.confidenceScore,
      observation: input.agentDecision.observation,
      whyItMatters: input.agentDecision.whyItMatters,
      changeMind: input.agentDecision.changeMind,
      facts: {
        thesisLabel: tradeIdea.thesisLabel,
        optionContracts: [
          optionExecution.decision.callContractSymbol,
          optionExecution.decision.putContractSymbol,
        ],
        agentDecisionSource,
      },
    }),
    reasoning: `${input.agentDecision.reasoning} ${optionExecution.decision.rationale}`,
    signalContext: {
      agentDecisionSource,
      thesisLabel: tradeIdea.thesisLabel,
      strategyFamily: tradeIdea.strategyFamily,
      optionContracts: [
        optionExecution.decision.callContractSymbol,
        optionExecution.decision.putContractSymbol,
      ],
      optionExecutionDataConsumed: optionExecution.decision.dataConsumed,
    },
    confidenceScore: input.agentDecision.confidenceScore,
  };
}

function applyApprovedNotionalToTradeIntent(
  intent: BrokerTradeIntent,
  approvedNotional: number
) {
  if (
    !intent.executionPlan ||
    intent.executionPlan.kind !== "equity_pair" ||
    approvedNotional <= 0
  ) {
    return {
      ...intent,
      notional: approvedNotional,
    } satisfies BrokerTradeIntent;
  }

  const currentGross = intent.executionPlan.legs.reduce(
    (sum, leg) => sum + leg.notional,
    0
  );

  if (currentGross <= 0) {
    return {
      ...intent,
      notional: approvedNotional,
    } satisfies BrokerTradeIntent;
  }

  const scale = approvedNotional / currentGross;
  const scaledLegs = intent.executionPlan.legs.map((leg) => ({
    ...leg,
    notional: roundToStep(Math.max(10, leg.notional * scale), 10),
  })) as [
    { symbol: string; side: AlpacaOrderSide; notional: number },
    { symbol: string; side: AlpacaOrderSide; notional: number },
  ];
  const grossNotional = scaledLegs.reduce((sum, leg) => sum + leg.notional, 0);

  return {
    ...intent,
    notional: grossNotional,
    executionPlan: {
      kind: "equity_pair",
      legs: scaledLegs,
    },
  } satisfies BrokerTradeIntent;
}

async function buildAgentDrivenMessages(input: {
  cycleId: number;
  session: RuntimeSessionSnapshot;
  regime: string;
  brokerState: BrokerSyncState | null;
  researchDecision: ResearchAgentDecision;
  traderDecisions: Record<RuntimeTradingAgentId, TraderAgentDecision>;
  cioDecision: CioAgentDecision;
  previousAllocationByAgent: Map<RuntimeTradingAgentId, number | null>;
}) {
  const activeAgentIds = getConversationActiveAgentIds(input.session);
  const conversationSession = summarizeConversationSession(input.session);
  const brokerConversationContext = summarizeConversationBrokerState(
    input.brokerState
  );
  const capacityDiscipline = input.brokerState
    ? getBrokerCapacityDiscipline(input.brokerState)
    : null;
  const traderConversationContext = Object.fromEntries(
    ROUTED_TRADING_AGENT_IDS.map((agentId) => [
      agentId,
      {
        agentId,
        role: getConfiguredTradingAgentRole(agentId),
        active: activeAgentIds.includes(agentId),
        shouldTrade: input.traderDecisions[agentId].shouldTrade,
        confidenceScore: input.traderDecisions[agentId].confidenceScore,
        discussionNote: input.traderDecisions[agentId].discussionNote,
        observation: input.traderDecisions[agentId].observation,
        whyItMatters: input.traderDecisions[agentId].whyItMatters,
        changeMind: input.traderDecisions[agentId].changeMind,
        trade: input.traderDecisions[agentId].trade,
        previousAllocationUsd:
          input.previousAllocationByAgent.get(agentId) ?? null,
        targetAllocationUsd:
          input.cioDecision.allocations[agentId].targetAllocationUsd,
        effectiveHeadroomUsd: getEffectiveAgentHeadroom({
          agentId,
          targetAllocationUsd:
            input.cioDecision.allocations[agentId].targetAllocationUsd,
          brokerState: input.brokerState,
          capacityDiscipline,
        }),
        agentExposureUsd: input.brokerState
          ? estimateAgentExposureFromBrokerState(agentId, input.brokerState)
          : null,
        allocationRationale:
          input.cioDecision.allocations[agentId].rationale,
        guardrails:
          input.cioDecision.guardrailsByAgent[agentId].guardrails,
      },
    ])
  );
  const allocationChanges = ROUTED_TRADING_AGENT_IDS.map((agentId) => ({
    agentId,
    previousAllocationUsd:
      input.previousAllocationByAgent.get(agentId) ?? null,
    targetAllocationUsd:
      input.cioDecision.allocations[agentId].targetAllocationUsd,
    effectiveHeadroomUsd: getEffectiveAgentHeadroom({
      agentId,
      targetAllocationUsd:
        input.cioDecision.allocations[agentId].targetAllocationUsd,
      brokerState: input.brokerState,
      capacityDiscipline,
    }),
    rationale: input.cioDecision.allocations[agentId].rationale,
    guardrailRationale:
      input.cioDecision.guardrailsByAgent[agentId].rationale,
    guardrails: input.cioDecision.guardrailsByAgent[agentId].guardrails,
  }));

  const plannerMessages = await generateAutonomousConversationPlan({
    activeAgentIds,
    addressableAgentIds: activeAgentIds,
    maxMessages: activeAgentIds.length <= 2 ? 4 : 8,
    context: {
      session: conversationSession,
      regime: input.regime,
      research: {
        confidenceScore: input.researchDecision.confidenceScore,
        marketRegime: input.researchDecision.marketRegime,
        researchArea: input.researchDecision.researchArea,
        selectedEventTicker: input.researchDecision.selectedEventTicker,
        selectedSentimentTicker: input.researchDecision.selectedSentimentTicker,
        macroSummary: input.researchDecision.macroSummary,
        eventSummary: input.researchDecision.eventSummary,
        sentimentSummary: input.researchDecision.sentimentSummary,
        observation: input.researchDecision.observation,
        whyItMatters: input.researchDecision.whyItMatters,
        changeMind: input.researchDecision.changeMind,
      },
      traders: traderConversationContext,
      allocator: {
        active: activeAgentIds.includes("AGT-CIO"),
        confidenceScore: input.cioDecision.confidenceScore,
        allowTrading: input.cioDecision.cycleDirectives.allowTrading,
        allocationBoundary: input.cioDecision.allocationBoundary,
        selectedTradeAgentId: input.cioDecision.selectedTradeAgentId,
        selectedTradeRationale: input.cioDecision.selectedTradeRationale,
        observation: input.cioDecision.observation,
        whyItMatters: input.cioDecision.whyItMatters,
        changeMind: input.cioDecision.changeMind,
        allocationChanges,
        capacityDiscipline: capacityDiscipline
          ? {
              additionsPaused: capacityDiscipline.additionsPaused,
              deRiskOnly: capacityDiscipline.deRiskOnly,
              buyingPowerUsd: capacityDiscipline.buyingPowerUsd,
              cashUsd: capacityDiscipline.cashUsd,
              deployableCapitalUsd: capacityDiscipline.deployableCapitalUsd,
              summary: capacityDiscipline.summary,
            }
          : null,
      },
      brokerState: brokerConversationContext,
      notes: [
        "Conversation is optional. Only include a message when the agent would genuinely send one.",
        "Weighting changes and guardrails are already persisted outside the chat feed, so AGT-CIO can stay silent about them.",
        "If a catalyst, timing gate, or risk boundary is unresolved, the desk should often surface that as a direct question to the agent most likely to resolve it.",
        "If workflow capacity is constrained, AGT-CIO should not claim fresh sleeve room or new adds until lower-value work is retired.",
        "When capacity is tight, AGT-CIO should describe new adds as replacement decisions only when the incoming idea clearly outranks the weakest live research event.",
      ],
    },
  });

  const renderedPlannerMessages = plannerMessages
    .map((message) => {
    const decisionSnapshot = getConversationDecisionSnapshot(input, message.senderId);

    return {
      senderId: message.senderId,
      recipientId: message.recipientId,
      messageType: message.messageType,
      priority: message.priority,
      renderType: message.renderType,
      content: message.content,
      reasoning: message.reasoning,
      requiresResponse: message.requiresResponse,
      payload: {
        cycleId: input.cycleId,
        phase: input.session.phase,
        regime: input.regime,
        conversationSource: "MODEL_AUTONOMOUS_PLAN",
        agentDecisionSource: "MODEL",
      },
      decision: {
        agentId: message.senderId,
        actionTaken: getAutonomousConversationActionTaken(message.messageType),
        reasoning: message.reasoning,
        dataConsumed: decisionSnapshot.dataConsumed,
        confidenceScore: decisionSnapshot.confidenceScore,
      },
    } satisfies PaperRuntimeMessageSeed;
    })
    .filter((message) => message.content.trim().length > 0);

  if (renderedPlannerMessages.length > 0) {
    return renderedPlannerMessages;
  }

  if (activeAgentIds.includes("AGT-RESEARCH")) {
    return renderPendingMessages([
      {
        senderId: "AGT-RESEARCH",
        messageType: "RESEARCH_REPORT",
        priority:
          input.researchDecision.confidenceScore >= 80 ? "HIGH" : "MEDIUM",
        renderType: "message",
        voiceDraft: {
          kind: "freeform",
          id: createVoiceDraftId(input.cycleId, "agent-driven", "fallback", "research"),
          senderId: "AGT-RESEARCH",
          senderRole: "Research Analyst",
          messageType: "RESEARCH_REPORT",
          priority:
            input.researchDecision.confidenceScore >= 80 ? "HIGH" : "MEDIUM",
          prompt:
            "The wider conversation planner produced nothing usable. If you personally had to send exactly one note to the desk this cycle, what would you say in your own words?",
          context: {
            session: conversationSession,
            regime: input.regime,
            researchDecision: input.researchDecision,
            brokerState: brokerConversationContext,
          },
          fallbackMessage: [
            input.researchDecision.observation,
            input.researchDecision.whyItMatters,
            input.researchDecision.changeMind,
          ]
            .map((part) => part.trim())
            .filter(Boolean)
            .join(" "),
          maxSentences: 3,
        },
        reasoning:
          "Fallback research note because the autonomous conversation planner returned no usable messages for this cycle.",
        payload: {
          cycleId: input.cycleId,
          phase: input.session.phase,
          regime: input.regime,
          conversationSource: "MODEL_AUTONOMOUS_FALLBACK",
          agentDecisionSource: "MODEL",
        },
        decision: {
          agentId: "AGT-RESEARCH",
          actionTaken: "publish_autonomous_research_fallback",
          reasoning:
            "The desk still needs one useful note when the conversation planner produces no valid messages.",
          dataConsumed: input.researchDecision.dataConsumed,
          confidenceScore: input.researchDecision.confidenceScore,
        },
      },
    ]);
  }

  return [] as PaperRuntimeMessageSeed[];
}

async function executeTradeIntent(
  cycleId: number,
  intent: BrokerTradeIntent,
  session: RuntimeSessionSnapshot,
  brokerState: BrokerSyncState,
  riskGate: RiskGateDecision
): Promise<BrokerExecutionResult> {
  let requestPayload: Record<string, unknown> = {
    symbol: intent.symbol,
    displaySymbol: intent.displaySymbol ?? intent.symbol,
    side: intent.side,
    notional: intent.notional,
    assetBucket: intent.assetBucket,
    strategyFamily: intent.strategyFamily,
    riskGate,
  };

  try {
    const executableIntent = await resolveExecutableTradeIntent({
      intent,
      brokerState,
    });

    if (!executableIntent.ok) {
      return {
        intent,
        requestPayload: {
          ...requestPayload,
          pretradeValidation: {
            code: executableIntent.code,
            dataConsumed: executableIntent.dataConsumed,
          },
        },
        riskGate,
        failureCategory: "PRETRADE_VALIDATION",
        failureCode: executableIntent.code,
        error: executableIntent.reason,
      };
    }

    const validatedIntent = executableIntent.intent;
    const orderRequestResult = await buildOrderRequest(
      cycleId,
      validatedIntent,
      session
    );
    const submittedOrders: AlpacaOrderSnapshot[] = [];
    requestPayload = {
      ...orderRequestResult.requestPayload,
      riskGate,
      pretradeValidation: {
        status: "passed",
        dataConsumed: executableIntent.dataConsumed,
      },
    };

    for (const orderRequest of orderRequestResult.orderRequests) {
      try {
        const order = await submitAlpacaOrder(orderRequest);
        submittedOrders.push(order);
      } catch (error) {
        if (orderRequest.kind === "equity" && orderRequest.side === "sell" && orderRequest.symbol) {
          const normalizedMessage =
            error instanceof Error ? error.message.toLowerCase() : "unknown error";

          if (
            normalizedMessage.includes("short") ||
            normalizedMessage.includes("borrow") ||
            normalizedMessage.includes("locate")
          ) {
            recordShortAvailabilityFailure(
              orderRequest.symbol,
              error instanceof Error
                ? error.message
                : "Short-side broker rejection."
            );
          }
        }

        return {
          intent: validatedIntent,
          requestPayload: {
            ...requestPayload,
            submittedOrders: submittedOrders.map((order) => ({
              brokerOrderId: order.brokerOrderId,
              clientOrderId: order.clientOrderId,
              symbol: order.symbol,
              status: order.status,
            })),
          },
          riskGate,
          orders: submittedOrders,
          order: submittedOrders[0],
          failureCategory: "BROKER_EXECUTION",
          error:
            error instanceof Error
              ? error.message
              : "Research-event publication failed unexpectedly.",
        };
      }
    }

    return {
      intent: validatedIntent,
      requestPayload,
      riskGate,
      orders: submittedOrders,
      order: submittedOrders[0],
    };
  } catch (error) {
    return {
      intent,
      requestPayload,
      riskGate,
      failureCategory: "BROKER_EXECUTION",
      error:
        error instanceof Error
          ? error.message
          : "Research-event publication failed unexpectedly.",
    };
  }
}

async function persistCycleArtifacts(input: {
  cycleId: number;
  cycleIndex: number;
  regime: string;
  baselineMessages: PaperRuntimeMessageSeed[];
  allocationEvents: AllocationPersistenceSeed[];
  brokerState: BrokerSyncState | null;
  brokerExecution: BrokerExecutionResult | null;
  retentionArtifacts: CycleRetentionArtifactSeed[];
  completionSummary?: string | null;
}) {
  return withAgentTransaction(async (client) => {
    let insertedMessages = 0;
    const now = new Date();
    const seenCooldownKeys = new Set<string>();

    for (const [index, allocationEvent] of input.allocationEvents.entries()) {
      await insertAgentAllocationEvent(client, {
        cycleId: input.cycleId,
        agentId: allocationEvent.agentId,
        previousAllocationUsd: allocationEvent.previousAllocationUsd,
        newAllocationUsd: allocationEvent.newAllocationUsd,
        rationale: allocationEvent.rationale,
        inputs: allocationEvent.inputs,
        createdAt: new Date(now.getTime() + index * 1000),
      });
    }

    for (const [index, message] of input.baselineMessages.entries()) {
      const content = message.content.trim();

      if (content.length === 0) {
        continue;
      }

      const dedupeKey =
        typeof message.payload.dedupeKey === "string" &&
        message.payload.dedupeKey.trim().length > 0
          ? message.payload.dedupeKey.trim()
          : null;
      const dedupeWindowMinutes =
        typeof message.payload.dedupeWindowMinutes === "number" &&
        Number.isFinite(message.payload.dedupeWindowMinutes) &&
        message.payload.dedupeWindowMinutes > 0
          ? Math.round(message.payload.dedupeWindowMinutes)
          : null;
      const dedupeScope =
        message.payload.dedupeScope === "global" ? "global" : "sender";

      if (dedupeKey && dedupeWindowMinutes) {
        const localCooldownKey =
          dedupeScope === "global" ? dedupeKey : `${message.senderId}:${dedupeKey}`;

        if (seenCooldownKeys.has(localCooldownKey)) {
          continue;
        }

        const hasRecentDuplicate = await hasRecentAgentMessageByDedupeKey(client, {
          senderId: dedupeScope === "global" ? null : message.senderId,
          dedupeKey,
          withinMinutes: dedupeWindowMinutes,
        });

        if (hasRecentDuplicate) {
          continue;
        }

        seenCooldownKeys.add(localCooldownKey);
      }

      const createdAt = new Date(now.getTime() + index * 1000);
      const messageId = await insertAgentMessage(client, {
        cycleId: input.cycleId,
        senderId: message.senderId,
        recipientId: message.recipientId,
        messageType: message.messageType,
        priority: message.priority,
        renderType: message.renderType,
        content,
        reasoning: message.reasoning,
        payload: message.payload,
        requiresResponse: message.requiresResponse,
        createdAt,
      });

      insertedMessages += 1;

      await insertAgentDecision(client, {
        cycleId: input.cycleId,
        agentId: message.decision.agentId,
        relatedMessageId: messageId,
        actionTaken: message.decision.actionTaken,
        reasoning: message.decision.reasoning,
        dataConsumed: message.decision.dataConsumed,
        confidenceScore: message.decision.confidenceScore,
        createdAt,
      });
    }

    if (input.brokerExecution) {
      const tradeMessageAt = new Date(now.getTime() + insertedMessages * 1000);
      const tradeIntent = input.brokerExecution.intent;
      const submittedOrders =
        input.brokerExecution.orders ??
        (input.brokerExecution.order ? [input.brokerExecution.order] : []);
      const shouldRecordTradeSubmission =
        submittedOrders.length > 0 || !isBlockedBeforeBroker(input.brokerExecution);

      if (shouldRecordTradeSubmission) {
        const tradeOrderContent = await renderVoiceDraft(
          withVoiceDraftFacts(tradeIntent.messageDraft, {
            riskGateApproved: input.brokerExecution.riskGate?.approved ?? null,
            riskGateReason: input.brokerExecution.riskGate?.reason ?? null,
            provider: "MARKET_DATA_WORKFLOW",
          })
        );
        const tradeOrderMessageId = await insertAgentMessage(client, {
          cycleId: input.cycleId,
          senderId: tradeIntent.agentId,
          recipientId: null,
          messageType: "TRADE_ORDER",
          priority: "HIGH",
          renderType: "action",
          content: tradeOrderContent,
          reasoning:
            `${tradeIntent.reasoning} The research event is autonomous within the originating sleeve and is published through the workflow pipeline under the current ensemble boundary and sleeve guardrails.`,
          payload: {
            cycleId: input.cycleId,
            symbol: tradeIntent.symbol,
            displaySymbol: tradeIntent.displaySymbol ?? tradeIntent.symbol,
            side: tradeIntent.side,
            notional: tradeIntent.notional,
            assetBucket: tradeIntent.assetBucket,
            strategyFamily: tradeIntent.strategyFamily,
            executionPlan: tradeIntent.executionPlan ?? null,
            provider: "MARKET_DATA_WORKFLOW",
            executionRoute: "RESEARCH_PUBLICATION_PIPELINE",
            riskGate: input.brokerExecution.riskGate ?? null,
            ...tradeIntent.signalContext,
          },
          createdAt: tradeMessageAt,
        });

        insertedMessages += 1;

        await insertAgentDecision(client, {
          cycleId: input.cycleId,
          agentId: tradeIntent.agentId,
          relatedMessageId: tradeOrderMessageId,
          actionTaken: "publish_research_event",
          reasoning: tradeIntent.reasoning,
          dataConsumed: [
            ...Object.entries(tradeIntent.signalContext).map(
              ([key, value]) => `${key}:${String(value)}`
            ),
            ...(input.brokerExecution.riskGate?.dataConsumed ?? []),
          ],
          confidenceScore: tradeIntent.confidenceScore,
          createdAt: tradeMessageAt,
        });
      }

      for (const order of submittedOrders) {
        await upsertAlpacaOrder(client, {
          cycleId: input.cycleId,
          agentId: tradeIntent.agentId,
          reasoning: tradeIntent.reasoning,
          requestPayload: input.brokerExecution.requestPayload,
          order,
        });
      }

      if (submittedOrders.length > 0) {
        const executionMessageAt = new Date(
          now.getTime() + insertedMessages * 1000
        );
        const statusSummary = Array.from(
          new Set(submittedOrders.map((order) => order.status))
        ).join(", ");
        const executionContent = await renderVoiceDraft({
          id: createVoiceDraftId(
            input.cycleId,
            "position",
            tradeIntent.agentId,
            tradeIntent.symbol,
            submittedOrders[0]?.status ?? "submitted"
          ),
          senderId: tradeIntent.agentId,
          senderRole: getTradingAgentRole(tradeIntent.agentId),
          messageType: "POSITION_DECLARATION",
          priority: "MEDIUM",
          observation: `I've published ${tradeIntent.displaySymbol ?? tradeIntent.symbol} as a research event with ${tradeIntent.side} notation.`,
          whyItMatters:
            `This is desk visibility only: the workflow now has ${submittedOrders.length} recorded event leg${submittedOrders.length === 1 ? "" : "s"} at ${statusSummary} with research weight about $${formatUsd(tradeIntent.notional)}.`,
          conviction: getConfidencePhrase(93),
          changeMind:
            "If the workflow status changes materially, the next message should be about that change rather than a revised story.",
          facts: {
            symbol: tradeIntent.symbol,
            displaySymbol: tradeIntent.displaySymbol ?? tradeIntent.symbol,
            side: tradeIntent.side,
            status: statusSummary,
            brokerOrderIds: submittedOrders.map((order) => order.brokerOrderId),
            notionalUsd: tradeIntent.notional,
          },
        });
        const executionConfirmMessageId = await insertAgentMessage(client, {
          cycleId: input.cycleId,
          senderId: tradeIntent.agentId,
          recipientId: null,
          messageType: "POSITION_DECLARATION",
          priority: "MEDIUM",
          renderType: "action",
          content: executionContent,
          reasoning:
            "The declaration gives the desk read-only research-event awareness. It is not a recommendation, coordination request, or research lead approval event.",
          payload: {
            cycleId: input.cycleId,
            symbol: tradeIntent.symbol,
            displaySymbol: tradeIntent.displaySymbol ?? tradeIntent.symbol,
            side: tradeIntent.side,
            status: statusSummary,
            brokerOrderIds: submittedOrders.map((order) => order.brokerOrderId),
            clientOrderIds: submittedOrders.map((order) => order.clientOrderId),
            notional: tradeIntent.notional,
            assetBucket: tradeIntent.assetBucket,
            strategyFamily: tradeIntent.strategyFamily,
            blackboardVisibility: "read_only_research_event_awareness",
            discussionPolicy: "shared_research_awareness_autonomous_events",
          },
          createdAt: executionMessageAt,
        });

        insertedMessages += 1;

        await insertAgentDecision(client, {
          cycleId: input.cycleId,
          agentId: tradeIntent.agentId,
          relatedMessageId: executionConfirmMessageId,
          actionTaken: "declare_research_event",
          reasoning:
            "Once the workflow accepts the event, it is declared to the shared blackboard for research awareness only.",
          dataConsumed: [
            "research workflow response",
            ...submittedOrders.map(
              (order) => `brokerOrderId:${order.brokerOrderId}`
            ),
            ...submittedOrders.map((order) => `status:${order.status}`),
          ],
          confidenceScore: 93,
          createdAt: executionMessageAt,
        });
      }

      if (input.brokerExecution.error) {
        const failureMessageAt = new Date(now.getTime() + insertedMessages * 1000);
        const failureCopy = buildTradeFailureCopy({
          brokerExecution: input.brokerExecution,
          submittedOrders,
          tradeIntent,
        });
        const incidentKey = buildIncidentKey([
          "publication-failure",
          failureCopy.failureCategory,
          input.brokerExecution.failureCode ?? "none",
          tradeIntent.displaySymbol ?? tradeIntent.symbol,
        ]);
        const hasRecentFailure = await hasRecentAgentMessageByDedupeKey(client, {
          senderId: null,
          dedupeKey: incidentKey,
          withinMinutes: 120,
        });

        if (!hasRecentFailure) {
          const failureContent = await renderVoiceDraft({
            id: createVoiceDraftId(
              input.cycleId,
              "publication-failure",
              tradeIntent.agentId,
              tradeIntent.symbol
            ),
            senderId: tradeIntent.agentId,
            senderRole: getTradingAgentRole(tradeIntent.agentId),
            messageType: "SYSTEM_STATUS",
            priority: "HIGH",
            observation: failureCopy.observation,
            whyItMatters: failureCopy.whyItMatters,
            conviction: getConfidencePhrase(91),
            changeMind: failureCopy.changeMind,
            facts: {
              symbol: tradeIntent.symbol,
              displaySymbol: tradeIntent.displaySymbol ?? tradeIntent.symbol,
              side: tradeIntent.side,
              notionalUsd: tradeIntent.notional,
              error: input.brokerExecution.error,
              failureCategory: failureCopy.failureCategory,
              failureCode: input.brokerExecution.failureCode ?? null,
              blockedBeforeBroker: isBlockedBeforeBroker(input.brokerExecution),
              brokerOrderIds: submittedOrders.map((order) => order.brokerOrderId),
            },
          });
          const failureMessageId = await insertAgentMessage(client, {
            cycleId: input.cycleId,
            senderId: tradeIntent.agentId,
            recipientId: null,
            messageType: "SYSTEM_STATUS",
            priority: "HIGH",
            renderType: "alert",
          content: failureContent,
          reasoning:
              "The originating sleeve records workflow failures directly so the desk can separate publication friction from the ensemble boundary and thesis work.",
            payload: {
              cycleId: input.cycleId,
              symbol: tradeIntent.symbol,
              side: tradeIntent.side,
              provider: "MARKET_DATA_WORKFLOW",
              error: input.brokerExecution.error,
              failureCategory: failureCopy.failureCategory,
              failureCode: input.brokerExecution.failureCode ?? null,
              blockedBeforeBroker: isBlockedBeforeBroker(input.brokerExecution),
              executionRoute: "RESEARCH_PUBLICATION_PIPELINE",
              riskGate: input.brokerExecution.riskGate ?? null,
              incidentKey,
              dedupeKey: incidentKey,
              ...tradeIntent.signalContext,
            },
            createdAt: failureMessageAt,
          });

          insertedMessages += 1;

          await insertAgentDecision(client, {
            cycleId: input.cycleId,
            agentId: tradeIntent.agentId,
            relatedMessageId: failureMessageId,
            actionTaken: "record_publication_pipeline_failure",
            reasoning:
              "The sleeve needs the failure in its own audit trail so it can adapt without involving the research lead in research-event decisions.",
            dataConsumed: [
              input.brokerExecution.error,
              ...submittedOrders.map((order) => `brokerOrderId:${order.brokerOrderId}`),
              ...(input.brokerExecution.riskGate?.dataConsumed ?? []),
            ],
            confidenceScore: 91,
            createdAt: failureMessageAt,
          });
        }
      }
    }

    if (input.brokerState) {
      await persistBrokerStateSnapshot(client, {
        cycleId: input.cycleId,
        brokerState: input.brokerState,
        submittedOrderIds:
          input.brokerExecution?.orders?.map((order) => order.brokerOrderId) ??
          (input.brokerExecution?.order
            ? [input.brokerExecution.order.brokerOrderId]
            : null),
      });
    }

    for (const artifact of input.retentionArtifacts) {
      await upsertAgentCycleArtifact(client, {
        cycleId: input.cycleId,
        artifactScope: artifact.artifactScope,
        artifactKey: artifact.artifactKey,
        storageTier: artifact.storageTier,
        summary: artifact.summary,
        payload: artifact.payload,
        createdAt: now,
      });
    }

    const completedCycle = await completePaperCycle(
      client,
      input.cycleId,
      input.completionSummary ??
        (input.brokerExecution?.orders && input.brokerExecution.orders.length > 0
          ? input.brokerExecution.error
            ? `Research cycle ${input.cycleIndex} published ${insertedMessages} events and captured a partial workflow failure under ${input.regime}.`
            : `Research cycle ${input.cycleIndex} published ${insertedMessages} events and recorded ${input.brokerExecution.orders.length} workflow event${input.brokerExecution.orders.length === 1 ? "" : "s"} under ${input.regime}.`
          : input.brokerExecution?.error
          ? `Research cycle ${input.cycleIndex} published ${insertedMessages} events and captured one workflow publication failure under ${input.regime}.`
          : input.brokerState
          ? `Research cycle ${input.cycleIndex} published ${insertedMessages} events and synced market-data state under ${input.regime}.`
          : `Research cycle ${input.cycleIndex} published ${insertedMessages} structured agent events under ${input.regime}.`)
    );

    return {
      cycle: completedCycle,
      insertedMessages,
    };
  });
}

export async function runPaperCycle(): Promise<PaperCycleResult> {
  await ensureAgentRegistrySeeded();

  if (isAgentSwarmDecommissioned()) {
    throw new Error("Legacy agent swarm is decommissioned.");
  }

  const nextCycleIndex = (await getLatestPaperCycleIndex()) + 1;
  const now = new Date();
  const session = await getEffectiveRuntimeSession(now);

  if (session.activeAgentIds.length === 0) {
    const idleCycle = await withAgentTransaction((client) =>
      insertPaperCycle(client, {
        marketStatus: session.marketStatus,
        regime: "NON_TRADING_DAY_IDLE",
        summary: `Research cycle ${nextCycleIndex} skipped because ${session.label.toLowerCase()} keeps all desk agents idle.`,
      }).then((cycle) =>
        completePaperCycle(
          client,
          cycle.id,
          `Research cycle ${nextCycleIndex} skipped because ${session.label.toLowerCase()} keeps all desk agents idle until the next market day.`
        )
      )
    );

    return {
      cycle: idleCycle,
      insertedMessages: 0,
      executionMode: "SIMULATED",
      brokerOrdersSubmitted: 0,
      brokerOrdersRejected: 0,
    };
  }

  const brokerConfigured = isAlpacaPaperTradingConfigured();
  const executionMode =
    brokerConfigured && session.orderExecutionEnabled
      ? "ALPACA_PAPER"
      : "SIMULATED";
  let dependencyStatuses: ResearchDependencyStatus[] = [];
  let decidedRegime = "AGENT_PENDING";
  let cycle: PaperCycleResult["cycle"] | null = null;
  let failureStage = "CYCLE_INITIALIZATION";

  try {
    cycle = await withAgentTransaction((client) =>
      insertPaperCycle(client, {
        marketStatus: session.marketStatus,
        regime: decidedRegime,
        summary: brokerConfigured
          ? `Research cycle ${nextCycleIndex} initialized for ${session.label.toLowerCase()} with market-data synchronization ${session.orderExecutionEnabled ? "enabled" : "disabled"} while agent-directed regime selection is pending.`
          : `Research cycle ${nextCycleIndex} initialized for ${session.label.toLowerCase()} without market-data synchronization while agent-directed regime selection is pending.`,
      })
    );

    let brokerState: BrokerSyncState | null = null;
    let brokerConnectionError: string | null = null;
    let brokerMaintenanceMessages: PaperRuntimeMessageSeed[] = [];

    failureStage = "BROKER_SYNC_PRE_DECISION";
    if (brokerConfigured) {
      try {
        brokerState = await fetchBrokerState();

        if (brokerState) {
          const maintenanceResult = await runBrokerOrderMaintenance({
            cycleId: cycle.id,
            brokerState,
          });
          brokerState = maintenanceResult.brokerState;
          brokerMaintenanceMessages = maintenanceResult.messages;
        }
      } catch (error) {
        brokerConnectionError =
          error instanceof Error
            ? error.message
            : "Broker sync failed before agent decisioning.";
      }
    }

    failureStage = "ALLOCATION_INPUTS";
    const allocationInputs = await getCioAllocationInputs();
    failureStage = "RESEARCH_COLLECTION";
    const researchCollection = await collectAgentDirectedMarketContext({
      session,
      brokerState: brokerState
        ? {
            account: brokerState.account,
            positions: brokerState.positions,
            recentOrders: brokerState.recentOrders,
          }
        : null,
      allocationInputs,
    });
    dependencyStatuses = researchCollection.dependencyStatuses.map((status) => {
      if (
        status.sourceId !== "MASSIVE" &&
        status.sourceId !== "KALSHI" &&
        status.sourceId !== "POLYMARKET" &&
        status.sourceId !== "SEC_EDGAR" &&
        status.sourceId !== "NEWSAPI"
      ) {
        throw new Error(`Unsupported research dependency source: ${status.sourceId}`);
      }

      return {
        sourceId: status.sourceId,
        healthy: status.healthy,
        summary: status.summary,
        error: status.error,
        impact: status.impact,
      };
    });

    failureStage = "EARLY_ARTIFACT_PERSISTENCE";
    await persistCycleRetentionArtifacts({
      cycleId: cycle.id,
      artifacts: [
        buildResearchPlanArtifact({
          session,
          researchPlan: researchCollection.researchPlan,
        }),
        ...buildResearchPacketArtifacts(researchCollection.retentionPackets),
        buildDecisionContextArtifact({
          session,
          executionMode,
          brokerConfigured,
          brokerConnectionError,
          brokerState,
          allocationInputs,
          researchCollection,
        }),
      ],
    });

    failureStage = "DECISION_SET";
    let decisionSet: Awaited<ReturnType<typeof getAgentDrivenDecisionSet>>;
    try {
      decisionSet = await getAgentDrivenDecisionSet({
        session,
        marketContext: researchCollection.marketContext,
        dependencyStatuses: researchCollection.dependencyStatuses.map((status) => ({
          sourceId: status.sourceId,
          healthy: status.healthy,
          summary: status.summary,
          error: status.error,
          impact: status.impact,
        })) satisfies AgentDecisionDependencyStatus[],
        brokerState: brokerState
          ? {
              account: brokerState.account,
              positions: brokerState.positions,
              recentOrders: brokerState.recentOrders,
            }
          : null,
        allocationInputs,
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Agent decisioning failed unexpectedly.";
      const dependencyStatusMessages =
        await buildResearchDependencyStatusMessages({
          cycleId: cycle.id,
          session,
          regime: decidedRegime,
          statuses: dependencyStatuses,
        });
      const degradedDecisioningMessages =
        await buildDecisioningDegradedMessages({
          cycleId: cycle.id,
          session,
          regime: decidedRegime,
          errorMessage: message,
          dependencyStatuses,
        });
      const deterministicDiscussionMessages =
        await buildDeterministicDiscussionBackfill({
          cycleId: cycle.id,
          cycleIndex: nextCycleIndex,
          session,
          regime: decidedRegime,
          marketContext: researchCollection.marketContext,
          dependencyStatuses,
          watchOnlyReason: message,
        });

      const persisted = await persistCycleArtifacts({
        cycleId: cycle.id,
        cycleIndex: nextCycleIndex,
        regime: decidedRegime,
        baselineMessages: [
          ...dependencyStatusMessages,
          ...degradedDecisioningMessages,
          ...deterministicDiscussionMessages,
        ],
        allocationEvents: [],
        brokerState,
        brokerExecution: null,
        retentionArtifacts: [
          buildBrokerExecutionArtifact({
            executionMode,
            regime: decidedRegime,
            brokerExecution: null,
          }),
          buildBrokerStateArtifact({
            executionMode,
            brokerConfigured,
            brokerConnectionError,
            brokerState,
          }),
        ],
        completionSummary:
          `Research cycle ${nextCycleIndex} degraded during decisioning under ${decidedRegime}; discussion stayed live, but ensemble decisions and research-event publication were skipped for this pass.`,
      });

      return {
        ...persisted,
        executionMode,
        brokerOrdersSubmitted: 0,
        brokerOrdersRejected: 0,
      };
    }

    decisionSet = await applyBrokerCapacityOverlayToDecisionSet({
      decisionSet,
      brokerState,
      session,
      researchDecision: decisionSet.research,
    });
    decidedRegime = decisionSet.research.marketRegime;
    failureStage = "CYCLE_REGIME_UPDATE";
    const cycleId = cycle.id;
    cycle = await withAgentTransaction((client) =>
      updatePaperCycleRegime(client, {
        cycleId,
        regime: decidedRegime,
        summary: brokerConfigured
          ? `Research cycle ${nextCycleIndex} initialized for ${session.label.toLowerCase()} under agent-driven regime ${decidedRegime} with market-data synchronization ${session.orderExecutionEnabled ? "enabled" : "disabled"}.`
          : `Research cycle ${nextCycleIndex} initialized for ${session.label.toLowerCase()} under agent-driven regime ${decidedRegime} without market-data synchronization.`,
      })
    );

    failureStage = "MESSAGE_GENERATION";
    const previousAllocationByAgent = new Map<
      RuntimeTradingAgentId,
      number | null
    >(
      allocationInputs
        .filter(
          (
            input
          ): input is CioAllocationInput & { agentId: RuntimeTradingAgentId } =>
            isConfiguredTradingAgentId(input.agentId)
        )
        .map((input) => [input.agentId, input.currentAllocationUsd])
    );
    const dependencyStatusMessages =
      await buildResearchDependencyStatusMessages({
        cycleId: cycle.id,
        session,
        regime: decidedRegime,
        statuses: dependencyStatuses,
      });
    const agentDrivenMessages = await buildAgentDrivenMessages({
      cycleId: cycle.id,
      session,
      regime: decidedRegime,
      brokerState,
      researchDecision: decisionSet.research,
      traderDecisions: decisionSet.traders,
      cioDecision: decisionSet.cio,
      previousAllocationByAgent,
    });
    const shouldBackfillDiscussion = !agentDrivenMessages.some(
      (message) => message.messageType === "DISCUSSION"
    );
    const deterministicDiscussionMessages = shouldBackfillDiscussion
      ? await buildDeterministicDiscussionBackfill({
          cycleId: cycle.id,
          cycleIndex: nextCycleIndex,
          session,
          regime: decidedRegime,
          marketContext: researchCollection.marketContext,
          dependencyStatuses,
        })
      : [];
    const allocationEvents: AllocationPersistenceSeed[] = session.activeAgentIds.includes(
      "AGT-CIO"
    )
      ? ROUTED_TRADING_AGENT_IDS.map((agentId) => ({
          agentId,
          previousAllocationUsd:
            previousAllocationByAgent.get(agentId) ?? null,
          newAllocationUsd: decisionSet.cio.allocations[agentId].targetAllocationUsd,
          rationale: decisionSet.cio.allocations[agentId].rationale,
          inputs: {
            allocationBoundary: decisionSet.cio.allocationBoundary,
            cycleDirectives: decisionSet.cio.cycleDirectives,
            guardrailRationale:
              decisionSet.cio.guardrailsByAgent[agentId].rationale,
            guardrails: decisionSet.cio.guardrailsByAgent[agentId].guardrails,
            selectedTradeAgentId: decisionSet.cio.selectedTradeAgentId,
            selectedTradeRationale: decisionSet.cio.selectedTradeRationale,
          },
        }))
      : [];

    let brokerExecution: BrokerExecutionResult | null = null;
    const allocationInputsWithTargets = applyCioTargetsToAllocationInputs(
      allocationInputs,
      decisionSet.cio
    );

    if (brokerConfigured && session.orderExecutionEnabled && brokerState) {
      const selectedTradeAgentId = decisionSet.cio.cycleDirectives.allowTrading
        ? decisionSet.cio.selectedTradeAgentId
        : null;

      if (selectedTradeAgentId) {
        failureStage = "TRADE_INTENT_BUILD";
        const selectedDecision = decisionSet.traders[selectedTradeAgentId];
        const tradeIntent = await buildTradeIntentFromAgentDecision({
          cycleIndex: nextCycleIndex,
          session,
          regime: decidedRegime,
          researchDecision: decisionSet.research,
          agentDecision: selectedDecision,
        });

        if (!tradeIntent) {
          throw new Error(
            `The selected ${selectedTradeAgentId} research event could not be translated into a publishable workflow event.`
          );
        }

        const tradeIntentShape = validateTradeIntentShape(tradeIntent);

        if (!tradeIntentShape.ok) {
          brokerExecution = {
            intent: tradeIntent,
            requestPayload: {
              symbol: tradeIntent.symbol,
              side: tradeIntent.side,
              requestedNotional: tradeIntent.notional,
              tradeIntentValidation: {
                code: tradeIntentShape.code,
                dataConsumed: tradeIntentShape.dataConsumed,
              },
            },
            failureCategory: "TRADE_INTENT",
            failureCode: tradeIntentShape.code,
            error: tradeIntentShape.reason,
          };
        } else {

          failureStage = "RISK_GATE";
          const riskGate = await evaluatePreTradeRiskGate({
            session,
            intent: tradeIntent,
            brokerState,
            allocationInputs: allocationInputsWithTargets,
            researchDecision: decisionSet.research,
            traderDecision: selectedDecision,
            cioDecision: decisionSet.cio,
            guardrails: normalizeAgentRiskGuardrails(
              decisionSet.cio.guardrailsByAgent[selectedTradeAgentId].guardrails
            ),
          });

          if (riskGate.approved) {
            const approvedTradeIntent = applyApprovedNotionalToTradeIntent(
              tradeIntent,
              riskGate.notional
            );
            failureStage = "BROKER_EXECUTION";
            brokerExecution = await executeTradeIntent(
              cycle.id,
              {
                ...approvedTradeIntent,
                signalContext: {
                  ...approvedTradeIntent.signalContext,
                  cioSelectedTradeAgentId: selectedTradeAgentId,
                  cioSelectedTradeRationale: decisionSet.cio.selectedTradeRationale,
                },
                messageDraft: withVoiceDraftFacts(approvedTradeIntent.messageDraft, {
                  notionalUsd: approvedTradeIntent.notional,
                  requestedNotionalUsd: riskGate.requestedNotional,
                  riskGateApproved: true,
                  riskGateReason: riskGate.reason,
                  cioSelectedTradeAgentId: selectedTradeAgentId,
                  cioSelectedTradeRationale: decisionSet.cio.selectedTradeRationale,
                }),
              },
              session,
              brokerState,
              riskGate
            );
          } else {
            brokerExecution = {
              intent: {
                ...tradeIntent,
                signalContext: {
                  ...tradeIntent.signalContext,
                  cioSelectedTradeAgentId: selectedTradeAgentId,
                  cioSelectedTradeRationale: decisionSet.cio.selectedTradeRationale,
                },
              },
              requestPayload: {
                symbol: tradeIntent.symbol,
                side: tradeIntent.side,
                requestedNotional: tradeIntent.notional,
                riskGate,
              },
              riskGate,
              failureCategory: "RISK_GATE",
              error: riskGate.reason,
            };
          }
        }
      }

      failureStage = "BROKER_SYNC_POST_EXECUTION";
      try {
        brokerState = await fetchBrokerState();
        brokerConnectionError = null;
      } catch (error) {
        brokerConnectionError =
          error instanceof Error
            ? error.message
            : "Market-data sync failed after research-event publication.";
      }
    }

    const baselineMessages = [
      ...dependencyStatusMessages,
      ...brokerMaintenanceMessages,
      ...agentDrivenMessages,
      ...(shouldBackfillDiscussion ? deterministicDiscussionMessages : []),
    ];

    if (brokerConnectionError && cycle) {
      baselineMessages.push({
        senderId: "AGT-RESEARCH",
        messageType: "SYSTEM_STATUS",
        priority: "HIGH",
        renderType: "alert",
        content: await renderVoiceDraft({
          id: createVoiceDraftId(cycle.id, "broker-sync-failure"),
          senderId: "AGT-RESEARCH",
          senderRole: "Research Analyst",
          messageType: "SYSTEM_STATUS",
          priority: "HIGH",
          observation: "I couldn't refresh the market-data state for this cycle.",
          whyItMatters: `That is an operational failure, not a market read: ${brokerConnectionError}`,
          conviction: getConfidencePhrase(95),
          changeMind:
            "If the market-data connection recovers on the next pass, this should clear without changing the underlying thesis work.",
          facts: {
            provider: "MARKET_DATA",
            error: brokerConnectionError,
          },
        }),
        reasoning:
          "The runtime is surfacing the market-data connectivity failure so the operator can distinguish workflow issues from market logic.",
        payload: {
          cycleId: cycle.id,
          provider: "MARKET_DATA",
          error: brokerConnectionError,
        },
        decision: {
          agentId: "AGT-RESEARCH",
          actionTaken: "capture_market_data_sync_failure",
          reasoning:
            "Market-data connectivity errors still need to be written into the shared event log without involving the research lead in publication mechanics.",
          dataConsumed: [brokerConnectionError],
          confidenceScore: 95,
        },
      });
    }
    failureStage = "ARTIFACT_PERSISTENCE";
    const persisted = await persistCycleArtifacts({
      cycleId: cycle.id,
      cycleIndex: nextCycleIndex,
      regime: decidedRegime,
      baselineMessages,
      allocationEvents,
      brokerState,
      brokerExecution,
      retentionArtifacts: [
        buildDecisionOutputArtifact({
          session,
          regime: decidedRegime,
          decisionSet,
        }),
        buildBrokerExecutionArtifact({
          executionMode,
          regime: decidedRegime,
          brokerExecution,
        }),
        buildBrokerStateArtifact({
          executionMode,
          brokerConfigured,
          brokerConnectionError,
          brokerState,
        }),
      ],
    });

    try {
      failureStage = "LEARNING_MAINTENANCE";
      await runLearningMaintenance({
        brokerExecution: brokerExecution
          ? {
              error: brokerExecution.error,
              intent: {
                agentId: brokerExecution.intent.agentId,
                confidenceScore: brokerExecution.intent.confidenceScore,
                notional: brokerExecution.intent.notional,
                side: brokerExecution.intent.side,
                signalContext: brokerExecution.intent.signalContext,
                symbol: brokerExecution.intent.symbol,
              },
              order:
                brokerExecution.orders?.at(-1) ?? brokerExecution.order,
              requestPayload: brokerExecution.requestPayload,
            }
          : null,
        brokerState: brokerState
          ? {
              positions: brokerState.positions,
              recentOrders: brokerState.recentOrders,
            }
          : null,
        cycleId: cycle.id,
        regime: decidedRegime,
        session,
      });
    } catch (error) {
      console.error("Agent learning maintenance failed", error);
    }

    return {
      ...persisted,
      executionMode,
      brokerOrdersSubmitted:
        brokerExecution?.orders?.length ??
        (brokerExecution?.order ? 1 : 0),
      brokerOrdersRejected: brokerExecution?.error ? 1 : 0,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Research cycle failed unexpectedly.";

    if (!cycle) {
      cycle = await withAgentTransaction((client) =>
        insertPaperCycle(client, {
          marketStatus: session.marketStatus,
          regime: decidedRegime,
          summary: `Research cycle ${nextCycleIndex} failed during agent-driven setup under ${decidedRegime}.`,
        })
      );
    }

    const persistedFailure = await persistCycleRuntimeFailure({
      cycleId: cycle.id,
      cycleIndex: nextCycleIndex,
      failureStage,
      session,
      regime: decidedRegime,
      errorMessage: message,
      dependencyStatuses,
    });

    return {
      ...persistedFailure,
      executionMode,
      brokerOrdersSubmitted: 0,
      brokerOrdersRejected: 0,
    };
  }
}

async function ensureCioAllocationsInitialized() {
  const brokerSnapshot = await getBrokerDashboardSnapshot();

  if (!brokerSnapshot.account) {
    return;
  }

  const existingInputs = await getCioAllocationInputs(brokerSnapshot);

  if (existingInputs.length === 0) {
    return;
  }

  const deployableCapital = computeDeployableCapital({
    portfolioValue: brokerSnapshot.account.portfolioValue,
    buyingPower: brokerSnapshot.account.buyingPower,
    attributedExposureUsd: existingInputs.reduce(
      (sum, agent) => sum + Math.abs(agent.attributedMarketValue ?? 0),
      0
    ),
  });

  if (deployableCapital <= 0) {
    return;
  }

  const perAgentCapUsd =
    deployableCapital * (isPaperExperimentationEnabled() ? 0.6 : 0.45);
  const hasMissingTargets = existingInputs.some(
    (agent) => typeof agent.currentAllocationUsd !== "number"
  );
  const hasImpossibleTargets = existingInputs.some(
    (agent) =>
      typeof agent.currentAllocationUsd === "number" &&
      (agent.currentAllocationUsd < 0 || agent.currentAllocationUsd > perAgentCapUsd + 100)
  );

  if (!hasMissingTargets && !hasImpossibleTargets) {
    return;
  }

  const session = getRuntimeSession(new Date());
  const decisions = await buildCioAllocationDecisions({
    session:
      session.phase === "OVERNIGHT"
        ? {
            ...session,
            phase: "POST_MARKET",
            label: "Post-Market",
          }
        : session,
    regime: "TRANSITION",
    brokerCapitalState: {
      portfolioValue: brokerSnapshot.account.portfolioValue,
      buyingPower: brokerSnapshot.account.buyingPower,
    },
  });

  if (decisions.length === 0) {
    return;
  }

  await withAgentTransaction(async (client) => {
    const createdAt = new Date();

    for (const decision of decisions) {
      await insertAgentAllocationEvent(client, {
        cycleId: null,
        agentId: decision.agentId,
        previousAllocationUsd: decision.previousAllocationUsd,
        newAllocationUsd: decision.newAllocationUsd,
        rationale:
          "Bootstrap allocation state recovered from the latest market-data snapshot while no research lead allocation state was persisted yet.",
        inputs: {
          ...decision.inputs,
          bootstrap: true,
        },
        createdAt,
      });
    }
  });
}

export async function ensurePaperRuntimePrimed() {
  await ensureAgentRegistrySeeded();

  if (isAgentSwarmDecommissioned()) {
    return;
  }

  await ensureCioAllocationsInitialized();
}

function getEmptyBrokerSnapshot(): BrokerDashboardSnapshot {
  return {
    configured: false,
    connected: false,
    provider: "ALPACA_PAPER",
    account: null,
    openPositions: [],
    attributedPositions: [],
    agentExposure: [],
    recentOrders: [],
  };
}

export async function getBrokerSnapshot() {
  if (isAgentSwarmDecommissioned()) {
    await ensureAgentRegistrySeeded();
    return getEmptyBrokerSnapshot();
  }

  await ensurePaperRuntimePrimed();

  if (!isAlpacaPaperTradingConfigured()) {
    return getEmptyBrokerSnapshot();
  }

  return getRealtimeBrokerSnapshot();
}

export async function getDashboardFeedSnapshot(limit = 0) {
  if (isAgentSwarmDecommissioned()) {
    await ensureAgentRegistrySeeded();
    const now = new Date().toISOString();

    return {
      messages: [],
      summary: {
        agentCount: 0,
        lastCycleStartedAt: null,
        lastEventAt: null,
        messageCount: 0,
        paperCycles: 0,
      },
      broker: getEmptyBrokerSnapshot(),
      runtime: {
        session: await getEffectiveRuntimeSession(new Date(now)),
        riskMonitor: {
          enabled: false,
          checkedAt: now,
          source: "decommission",
          symbol: "SPY",
          lastPrice: null,
          previousClose: null,
          changePct: null,
          alertTriggered: false,
          thresholdPct: 0,
          message: "Legacy agent swarm is decommissioned.",
        } satisfies OvernightRiskMonitorSnapshot,
      },
    };
  }

  await ensurePaperRuntimePrimed();
  const now = new Date();
  const session = await getEffectiveRuntimeSession(now);
  const riskMonitor = await getOvernightRiskMonitorSnapshot(session, now);

  const [messages, summary, broker] = await Promise.all([
    limit > 0 ? getAgentFeedMessages(limit) : Promise.resolve([]),
    getAgentFeedSummary(),
    isAlpacaPaperTradingConfigured()
      ? getBrokerDashboardSnapshot()
      : Promise.resolve(getEmptyBrokerSnapshot()),
  ]);

  return {
    messages,
    summary,
    broker,
    runtime: {
      session,
      riskMonitor,
    },
  };
}

export async function getLiveFeedSnapshot(limit = 40) {
  if (isAgentSwarmDecommissioned()) {
    return getDashboardFeedSnapshot(limit);
  }

  await ensurePaperRuntimePrimed();
  const now = new Date();
  const session = await getEffectiveRuntimeSession(now);
  const riskMonitor = await getOvernightRiskMonitorSnapshot(session, now);

  const [messages, summary, broker] = await Promise.all([
    getAgentFeedMessages(limit),
    getAgentFeedSummary(),
    getBrokerSnapshot(),
  ]);

  return {
    messages,
    summary,
    broker,
    runtime: {
      session,
      riskMonitor,
    },
  };
}
