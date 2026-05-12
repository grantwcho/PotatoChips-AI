export type DashboardSummaryData = {
  portfolioValue: number | null;
  dailyPnl: number | null;
  dailyPnlPct: number | null;
  activeAgents: number;
  totalAgents: number;
  recentAlerts: number;
  criticalAlerts: number;
  brokerConnected: boolean;
  latestAccountTimestamp: string | null;
  recruitingPipelineCount: number;
};

export type DashboardActivityEvent = {
  id: string;
  timestamp: string;
  agentId: string;
  agentName: string | null;
  type: "trade" | "allocation" | "alert" | "research" | "status";
  description: string;
};

export type DashboardAgentBusMessageDetail = {
  id: string;
  cycleId: number | null;
  timestamp: string;
  senderId: string;
  senderName: string | null;
  recipientId: string | null;
  recipientName: string | null;
  messageType: string;
  priority: string;
  renderType: string;
  content: string;
  reasoning: string;
  payload: Record<string, unknown>;
  audience: string;
};

export type DashboardAgentDecisionContribution = {
  id: string;
  cycleId: number | null;
  timestamp: string;
  actionTaken: string;
  reasoning: string;
  dataConsumed: string[];
  confidenceScore: number;
  relatedMessageId: string | null;
  relatedMessageType: string | null;
  relatedMessageContent: string | null;
  relatedMessagePayload: Record<string, unknown>;
};

export type DashboardAgentResearchTrace = {
  id: string;
  cycleId: number | null;
  timestamp: string;
  sourceAgentId: string;
  sourceAgentName: string | null;
  messageType: string;
  content: string;
  reasoning: string;
  audience: string;
  payload: Record<string, unknown>;
  downstream: Array<{
    id: string;
    timestamp: string;
    agentId: string;
    agentName: string | null;
    messageType: string;
    content: string;
  }>;
};

export type DashboardAgentAllocationContribution = {
  id: string;
  cycleId: number | null;
  timestamp: string;
  targetAgentId: string;
  targetAgentName: string | null;
  previousAllocationUsd: number | null;
  newAllocationUsd: number | null;
  reasoning: string;
  inputs: Record<string, unknown>;
};

export type DashboardPortfolioHistoryRange = "1D" | "1M" | "1Y" | "MAX";

export type DashboardPortfolioHistoryPoint = {
  timestamp: string;
  time: string;
  portfolioValue: number;
  pnl: number;
  pnlPct: number | null;
};

export type DashboardPortfolioStatistic = {
  label: string;
  display: string;
  value: number | null;
  detail: string;
  tone?: "positive" | "negative" | "neutral";
};

export type DashboardOverviewData = {
  summary: DashboardSummaryData;
  portfolioHistory: DashboardPortfolioHistoryPoint[];
  portfolioHistories: Record<DashboardPortfolioHistoryRange, DashboardPortfolioHistoryPoint[]>;
  portfolioStatistics: DashboardPortfolioStatistic[];
  portfolioPositions: DashboardPortfolioPosition[];
  activeAgentIds: string[];
  recentlyActiveAgentIds: string[];
  activityFeed: DashboardActivityEvent[];
  runtimeNote: string;
  activePhaseLabel: string;
};

export type DashboardDiscussionMessage = {
  id: string;
  timestamp: string;
  senderId: string;
  senderName: string;
  senderRole: string;
  recipientId: string | null;
  recipientName: string | null;
  messageType: string;
  priority: string;
  renderType: string;
  content: string;
  reasoning: string;
  payload: Record<string, unknown>;
  influenceSummary: string | null;
  threadId: string | null;
};

export type DashboardDiscussionData = {
  decisionRuntime: DashboardDecisionRuntimeDiagnostic;
  messages: DashboardDiscussionMessage[];
  summary: {
    agentCount: number;
    messageCount: number;
    discussionCount: number;
    latestMessageAt: string | null;
  };
};

export type DashboardPositionOwner = {
  agentId: string;
  attributedQty: number | null;
  attributedMarketValue: number | null;
  attributedUnrealizedPl: number | null;
  netSubmittedNotional: number | null;
  orderCount: number;
  lastOrderAt: string | null;
};

export type DashboardPortfolioPosition = {
  symbol: string;
  side: string | null;
  qty: number | null;
  marketValue: number | null;
  currentPrice: number | null;
  avgEntryPrice: number | null;
  unrealizedPl: number | null;
  pctOfNav: number | null;
  owners: DashboardPositionOwner[];
  unattributedMarketValue: number | null;
};

export type DashboardAgentExposure = {
  agentId: string;
  positionCount: number;
  attributedMarketValue: number | null;
  attributedUnrealizedPl: number | null;
};

export type DashboardPortfolioData = {
  portfolioValue: number | null;
  positions: DashboardPortfolioPosition[];
  agentExposure: DashboardAgentExposure[];
  recentTrades: DashboardTradeRecord[];
  latestAccountTimestamp: string | null;
};

export type DashboardBacktestRange =
  | "1W"
  | "1M"
  | "3M"
  | "6M"
  | "1Y"
  | "2Y"
  | "5Y"
  | "MAX";

export type DashboardBacktestCurvePoint = {
  date: string;
  label: string;
  value: number;
  normalizedValue: number;
};

export type DashboardBacktestBenchmark = {
  symbol: string;
  start: string;
  end: string;
  totalReturn: number | null;
  curve: DashboardBacktestCurvePoint[];
};

export type DashboardBacktestRun = {
  agentId: string;
  displayName: string;
  role: string;
  status: "completed" | "unsupported" | "error";
  supportNote: string | null;
  error: string | null;
  start: string;
  end: string;
  totalReturn: number | null;
  benchmarkReturn: number | null;
  alpha: number | null;
  cagr: number | null;
  sharpe: number | null;
  maxDrawdown: number | null;
  winRate: number | null;
  tradeCount: number | null;
  curve: DashboardBacktestCurvePoint[];
  extraMetrics: Array<{
    label: string;
    value: number | string | null;
    format: "percent" | "number" | "text";
  }>;
};

export type DashboardBacktestAgentOption = {
  id: string;
  displayName: string;
  role: string;
  supported: boolean;
  supportNote: string | null;
};

export type DashboardBacktestRangeOption = {
  key: DashboardBacktestRange;
  label: string;
  start: string;
  end: string;
};

export type DashboardBacktestConfig = {
  defaultRange: DashboardBacktestRange;
  defaultAgentIds: string[];
  benchmarkSymbol: string;
  availableRanges: DashboardBacktestRangeOption[];
  availableAgents: DashboardBacktestAgentOption[];
};

export type DashboardBacktestData = {
  range: DashboardBacktestRange;
  start: string;
  end: string;
  generatedAt: string;
  benchmark: DashboardBacktestBenchmark | null;
  runs: DashboardBacktestRun[];
};

export type DashboardTradeRecord = {
  id: string;
  timestamp: string | null;
  agentId: string | null;
  agentName: string | null;
  ticker: string;
  action: "BUY" | "SELL" | "SHORT" | "COVER";
  qty: number | null;
  price: number | null;
  notional: number | null;
  confidence: number | null;
  status: string;
  reasoning: string;
  strategyLabel: string | null;
  requestPayload?: Record<string, unknown>;
  riskGateReason?: string | null;
  riskGateInputs?: string[];
};

export type DashboardTradesData = {
  trades: DashboardTradeRecord[];
  availableAgents: Array<{
    id: string;
    name: string;
  }>;
};

export type DashboardAlertRecord = {
  id: string;
  timestamp: string;
  severity: "critical" | "warning" | "info";
  source: string;
  description: string;
  status: "new";
  messageType: string;
};

export type DashboardAlertsData = {
  decisionRuntime: DashboardDecisionRuntimeDiagnostic;
  alerts: DashboardAlertRecord[];
};

export type DashboardRiskMetric = {
  label: string;
  value: number | null;
  display: string;
  tone?: "positive" | "negative" | "neutral";
};

export type DashboardRiskLimit = {
  name: string;
  current: number | null;
  limit: number;
  unit: string;
};

export type DashboardRiskData = {
  metrics: DashboardRiskMetric[];
  limits: DashboardRiskLimit[];
  alerts: DashboardAlertRecord[];
  notes: string[];
};

export type DashboardContributorRosterRow = {
  name: string;
  agentsSubmitted: number;
  agentsLive: number;
  totalEarnings: number | null;
  pendingPayout: number | null;
  contractStatus: string;
};

export type DashboardContributorsData = {
  instrumented: boolean;
  message: string;
  roster: DashboardContributorRosterRow[];
};

export type DashboardAgentRow = {
  id: string;
  displayName: string;
  role: string;
  tier: number;
  status: string;
  activatedAt: string | null;
  terminatedAt: string | null;
  strategyCategory: string | null;
  reportsTo: string | null;
  currentAllocationUsd: number | null;
  maxAllocationUsd: number | null;
  attributedMarketValue: number | null;
  attributedUnrealizedPl: number | null;
  positionCount: number;
  recentMessageCount: number;
  recentOrderCount: number;
  lastMessageAt: string | null;
  lastOrderAt: string | null;
};

export type DashboardAgentDetailData = {
  agent: DashboardAgentRow | null;
  objectiveFunction: string | null;
  subscriptions: string[];
  directReports: string[];
  constraints: Record<string, unknown>;
  config: Record<string, unknown>;
  recentMessages: DashboardActivityEvent[];
  busMessages: DashboardAgentBusMessageDetail[];
  researchTrace: DashboardAgentResearchTrace[];
  decisionContributions: DashboardAgentDecisionContribution[];
  allocationContributions: DashboardAgentAllocationContribution[];
  contributionSummary: {
    researchItemsProduced: number;
    researchItemsConsumed: number;
    decisionsLogged: number;
    tradesRouted: number;
    allocationEvents: number;
  };
  recentTrades: DashboardTradeRecord[];
  positions: Array<{
    symbol: string;
    side: string | null;
    currentPrice: number | null;
    attributedQty: number | null;
    attributedMarketValue: number | null;
    attributedUnrealizedPl: number | null;
    lastOrderAt: string | null;
  }>;
};

export type DashboardAllocationEvent = {
  id: string;
  timestamp: string;
  actorId: string;
  actorName: string;
  targetAgentId: string | null;
  targetAgentName: string | null;
  content: string;
  reasoning: string;
  previousAllocationUsd: number | null;
  newAllocationUsd: number | null;
};

export type DashboardAllocationData = {
  portfolioValue: number | null;
  allocatedCapitalUsd: number | null;
  cashReserveUsd: number | null;
  cashReservePct: number | null;
  agents: DashboardAgentRow[];
  recentChanges: DashboardAllocationEvent[];
  instrumented: boolean;
  message: string;
};

export type DashboardProviderDiagnostic = {
  id: string;
  label: string;
  configured: boolean;
  connected: boolean;
  purpose: string;
  capabilities: string[];
  statusDetail: string;
  lastCheckedAt: string;
};

export type DashboardDecisionRuntimeDiagnostic = {
  configured: boolean;
  providerLabel: string;
  modelLabel: string;
  statusDetail: string;
};

export type DashboardSettingsData = {
  brokerConfigured: boolean;
  brokerConnected: boolean;
  brokerProvider: string;
  decisionRuntime: DashboardDecisionRuntimeDiagnostic;
  providerDiagnostics: DashboardProviderDiagnostic[];
  runtimePhase: string;
  runtimeNote: string;
  activeAgentIds: string[];
  sleepingAgentIds: string[];
  overrides: Array<{
    id: string;
    createdAt: string;
    actionTaken: string;
    operatorDirective: string;
    recommendation: string | null;
  }>;
  agents: DashboardAgentRow[];
};

export type DashboardResearchFeedItem = {
  id: string;
  timestamp: string;
  sourceId: "agent" | "kalshi" | "massive" | "polymarket" | "alphavantage" | "sec";
  sourceLabel: string;
  category:
    | "market"
    | "headline"
    | "filing"
    | "prediction-market"
    | "research-report";
  title: string;
  summary: string;
  symbol: string | null;
  href: string | null;
  imageUrl?: string | null;
  meta: string[];
};

export type DashboardResearchData = {
  checkedAt: string;
  watchSymbols: string[];
  providerDiagnostics: DashboardProviderDiagnostic[];
  feed: DashboardResearchFeedItem[];
};

export type DashboardQuantLabSummaryMetric = {
  label: string;
  value: string;
  detail: string;
  tone?: "positive" | "negative" | "neutral";
};

export type DashboardQuantLabStrategyCard = {
  id: string;
  label: string;
  ownerName: string;
  ownerAgentId: string;
  stage: "research" | "paper" | "deployed";
  benchmarkStatus: "pass" | "watch" | "miss";
  latestCommitId: string;
  latestCommitHash: string;
  latestTitle: string;
  summary: string;
};

export type DashboardQuantLabCommitRow = {
  id: string;
  commitHash: string;
  timestamp: string;
  category: string;
  title: string;
  agentId: string;
  agentName: string;
  agentRole: string;
  strategyLabel: string;
  status: "research" | "paper" | "deployed";
  summary: string;
  benchmarkHighlights: string[];
  learnedFromPastIterations: boolean;
  learnedFromDeployments: boolean;
};

export type DashboardQuantLabCodeSnippet = {
  label: string;
  path: string;
  language: string;
  caption: string;
  startLine: number;
  endLine: number;
  code: string;
};

export type DashboardQuantLabBenchmarkMetric = {
  label: string;
  value: string;
  detail: string;
  tone?: "positive" | "negative" | "neutral";
};

export type DashboardQuantLabKpiCheck = {
  label: string;
  target: string;
  actual: string;
  status: "pass" | "watch" | "miss";
};

export type DashboardQuantLabData = {
  checkedAt: string;
  runtimeStatus: {
    headline: string;
    detail: string;
    headShortHash: string | null;
    changedFilesCount: number | null;
  };
  summaryMetrics: DashboardQuantLabSummaryMetric[];
  strategies: DashboardQuantLabStrategyCard[];
  commits: DashboardQuantLabCommitRow[];
};

export type DashboardQuantLabCommitDetailData = {
  checkedAt: string;
  commit: DashboardQuantLabCommitRow | null;
  strategySummary: string;
  codeSummary: string;
  intent: string;
  deploymentStage: string;
  deploymentNote: string;
  usedKnowledgeBase: boolean;
  learnedFromPastIterations: boolean;
  learnedFromDeployments: boolean;
  learningEvidence: string[];
  benchmarkMetrics: DashboardQuantLabBenchmarkMetric[];
  kpiChecks: DashboardQuantLabKpiCheck[];
  codeSnippets: DashboardQuantLabCodeSnippet[];
  relatedCommits: DashboardQuantLabCommitRow[];
};
