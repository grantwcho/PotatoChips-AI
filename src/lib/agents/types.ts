export const AGENT_PRIORITIES = [
  "LOW",
  "MEDIUM",
  "HIGH",
  "CRITICAL",
] as const;

export const AGENT_RENDER_TYPES = [
  "thought",
  "message",
  "action",
  "alert",
] as const;

export const AGENT_STATUSES = [
  "ACTIVE",
  "PAUSED",
  "PAPER",
  "EVALUATION",
  "OFFLINE",
] as const;

export const STRATEGY_CATEGORIES = [
  "Statistical Arbitrage",
  "Trend Following",
  "Volatility",
  "Macro",
  "Event-Driven",
  "Sentiment",
  "Market-Making",
  "Multi-Strategy",
] as const;

export const BUS_MESSAGE_TYPES = [
  "SIGNAL",
  "POSITION_DECLARATION",
  "CONFLICT_FLAG",
  "RESEARCH_REPORT",
  "RISK_ALERT",
  "ALLOCATION_CHANGE",
  "SYSTEM_STATUS",
  "TRADE_ORDER",
  "EXECUTION_CONFIRM",
  "ATTRIBUTION_REPORT",
  "ENFORCEMENT_ACTION",
  "DISCUSSION",
] as const;

export type AgentPriority = (typeof AGENT_PRIORITIES)[number];
export type AgentRenderType = (typeof AGENT_RENDER_TYPES)[number];
export type AgentStatus = (typeof AGENT_STATUSES)[number];
export type StrategyCategory = (typeof STRATEGY_CATEGORIES)[number];
export type BusMessageType = (typeof BUS_MESSAGE_TYPES)[number];
export type AgentTier = 1 | 2 | 3;

export type AgentSeed = {
  id: string;
  displayName: string;
  role: string;
  tier: AgentTier;
  reportsTo: string | null;
  directReports: string[];
  strategyCategory: StrategyCategory | null;
  status: AgentStatus;
  paperEnabled: boolean;
  currentAllocationUsd: number | null;
  maxAllocationUsd: number | null;
  metadata: Record<string, unknown>;
  subscriptions: BusMessageType[];
  objectiveFunction: string;
  systemPrompt: string;
  constraints: Record<string, unknown>;
  config: Record<string, unknown>;
};

export type AgentMessageRecord = {
  id: string;
  timestamp: string;
  senderId: string;
  senderName: string;
  senderRole: string;
  recipientId: string | null;
  recipientName: string | null;
  messageType: string;
  priority: AgentPriority;
  renderType: AgentRenderType;
  content: string;
  reasoning: string;
  payload: Record<string, unknown>;
};

export type PaperCycleRecord = {
  id: number;
  runMode: "PAPER" | "LIVE";
  marketStatus: string;
  regime: string | null;
  summary: string | null;
  startedAt: string;
  completedAt: string | null;
};

export type AgentDecisionSeed = {
  agentId: string;
  actionTaken: string;
  reasoning: string;
  dataConsumed: unknown[];
  confidenceScore: number;
};

export type PaperRuntimeMessageSeed = {
  senderId: string;
  recipientId?: string | null;
  messageType: string;
  priority: AgentPriority;
  renderType: AgentRenderType;
  content: string;
  reasoning: string;
  payload: Record<string, unknown>;
  requiresResponse?: boolean;
  decision: AgentDecisionSeed;
};

export type PaperCycleResult = {
  cycle: PaperCycleRecord;
  insertedMessages: number;
  executionMode: "SIMULATED" | "ALPACA_PAPER";
  brokerOrdersSubmitted: number;
  brokerOrdersRejected: number;
};

export type RuntimePhase =
  | "PRE_MARKET"
  | "MARKET"
  | "POST_MARKET"
  | "OVERNIGHT"
  | "NON_TRADING_DAY";

export type RuntimeSessionSnapshot = {
  phase: RuntimePhase;
  label: string;
  marketStatus: "pre-market" | "open" | "after-hours" | "closed";
  isTradingDay: boolean;
  referenceTimezone: string;
  operatorTimezone: string;
  windowEt: string;
  windowPt: string;
  activeAgentIds: string[];
  sleepingAgentIds: string[];
  wokenAgentIds: string[];
  pendingResponseRequests: Array<{
    messageId: string;
    senderId: string;
    recipientId: string;
    messageType: string;
    priority: AgentPriority;
    content: string;
    createdAt: string;
  }>;
  tradingAgentsEnabled: boolean;
  orderExecutionEnabled: boolean;
  note: string;
  checkedAt: string;
};

export type OvernightRiskMonitorSnapshot = {
  enabled: boolean;
  checkedAt: string;
  source: string;
  symbol: string;
  lastPrice: number | null;
  previousClose: number | null;
  changePct: number | null;
  alertTriggered: boolean;
  thresholdPct: number;
  message: string;
};
