import "server-only";

import {
  alerts as mockAlerts,
  positions as mockPositions,
  trades as mockTrades,
  intradayPnl as mockIntradayPnl,
} from "@/lib/mock-data";
import { isAgentSwarmDecommissioned } from "@/lib/agents/decommission";
import type {
  DashboardActivityEvent,
  DashboardAgentAllocationContribution,
  DashboardAgentBusMessageDetail,
  DashboardAgentDecisionContribution,
  DashboardAgentDetailData,
  DashboardAgentExposure,
  DashboardAgentResearchTrace,
  DashboardAgentRow,
  DashboardAlertRecord,
  DashboardAlertsData,
  DashboardAllocationData,
  DashboardContributorsData,
  DashboardDecisionRuntimeDiagnostic,
  DashboardDiscussionData,
  DashboardDiscussionMessage,
  DashboardOverviewData,
  DashboardPortfolioData,
  DashboardPortfolioHistoryPoint,
  DashboardPortfolioHistoryRange,
  DashboardPortfolioPosition,
  DashboardPortfolioStatistic,
  DashboardProviderDiagnostic,
  DashboardResearchData,
  DashboardResearchFeedItem,
  DashboardRiskData,
  DashboardSettingsData,
  DashboardSummaryData,
  DashboardTradeRecord,
  DashboardTradesData,
} from "@/lib/dashboard/types";

type PreviewAgentDefinition = {
  id: string;
  displayName: string;
  role: string;
  tier: number;
  status: string;
  strategyCategory: string | null;
  reportsTo: string | null;
  currentAllocationUsd: number | null;
  maxAllocationUsd: number | null;
  objectiveFunction: string | null;
  subscriptions: string[];
  directReports: string[];
  constraints: Record<string, unknown>;
  config: Record<string, unknown>;
  activatedAt: string;
};

type PreviewMessageDefinition = {
  id: string;
  minutesAgo: number;
  senderId: string;
  recipientId: string | null;
  messageType: string;
  priority: string;
  renderType: string;
  content: string;
  reasoning: string;
  payload: Record<string, unknown>;
};

type PreviewOverride = {
  id: string;
  createdAt: string;
  actionTaken: string;
  operatorDirective: string;
  recommendation: string | null;
};

type PreviewState = {
  nowIso: string;
  summary: DashboardSummaryData;
  overview: DashboardOverviewData;
  discussionMessages: DashboardDiscussionMessage[];
  discussion: DashboardDiscussionData;
  portfolio: DashboardPortfolioData;
  trades: DashboardTradeRecord[];
  risk: DashboardRiskData;
  contributors: DashboardContributorsData;
  agents: DashboardAgentRow[];
  agentDetails: Map<string, DashboardAgentDetailData>;
  alerts: DashboardAlertRecord[];
  allocation: DashboardAllocationData;
  settings: DashboardSettingsData;
  research: DashboardResearchData;
};

const PREVIEW_AGENT_DEFINITIONS: PreviewAgentDefinition[] = [
  {
    id: "AGT-CIO",
    displayName: "Jacob",
    role: "Chief Research Officer",
    tier: 1,
    status: "ACTIVE",
    strategyCategory: null,
    reportsTo: null,
    currentAllocationUsd: null,
    maxAllocationUsd: null,
    objectiveFunction:
      "Size research attention across sleeves with orthogonality, coverage breadth, and quality guardrails.",
    subscriptions: ["coverage.snapshot", "quality.monitor", "desk.messages", "allocation.events"],
    directReports: [
      "AGT-RESEARCH",
      "AGT-QR-001",
      "AGT-EXEC-001",
      "AGT-STATARB-001",
      "AGT-MACRO-001",
      "AGT-EVENT-001",
      "AGT-SENT-001",
      "AGT-TREND-001",
      "AGT-VOL-001",
    ],
    constraints: {
      maxGrossExposurePct: 165,
      maxSleeveAllocationPct: 22,
      requireOrthogonality: true,
    },
    config: {
      modelClass: "preview-opus",
      cadence: "continuous",
    },
    activatedAt: "2026-01-06T16:00:00.000Z",
  },
  {
    id: "AGT-RESEARCH",
    displayName: "Priya",
    role: "Research Analyst",
    tier: 1,
    status: "ACTIVE",
    strategyCategory: null,
    reportsTo: "AGT-CIO",
    currentAllocationUsd: null,
    maxAllocationUsd: null,
    objectiveFunction:
      "Synthesize macro, event, and cross-asset research into desk-ready research framing.",
    subscriptions: ["news.flow", "prediction.markets", "sec.filings"],
    directReports: [],
    constraints: {
      publishOnly: true,
      noDirectRouting: true,
    },
    config: {
      modelClass: "preview-opus",
      reportWindowHours: 24,
    },
    activatedAt: "2026-01-06T16:05:00.000Z",
  },
  {
    id: "AGT-QR-001",
    displayName: "Neel",
    role: "Quantitative Researcher",
    tier: 2,
    status: "ACTIVE",
    strategyCategory: null,
    reportsTo: "AGT-CIO",
    currentAllocationUsd: null,
    maxAllocationUsd: null,
    objectiveFunction:
      "Kill weak hypotheses fast and turn surviving signals into reproducible, statistically defensible research.",
    subscriptions: [
      "knowledge.base",
      "desk.research",
      "evaluation.quality",
      "strategy.correlation",
    ],
    directReports: [],
    constraints: {
      cannotTrade: true,
      preregistrationRequired: true,
      oosLockedUntilFinalEvaluation: true,
    },
    config: {
      modelClass: "preview-opus",
      cadence: "continuous",
      cumulativeTestCountTracked: true,
    },
    activatedAt: "2026-01-06T16:10:00.000Z",
  },
  {
    id: "AGT-EXEC-001",
    displayName: "Nick",
    role: "Research Systems Developer",
    tier: 2,
    status: "ACTIVE",
    strategyCategory: null,
    reportsTo: "AGT-CIO",
    currentAllocationUsd: null,
    maxAllocationUsd: null,
    objectiveFunction:
      "Turn signal specs into low-latency, observable, production-safe research workflows with better evaluation quality and fewer surprises.",
    subscriptions: [
      "workflow.telemetry",
      "research.events",
      "quality.monitor",
      "desk.research",
    ],
    directReports: [],
    constraints: {
      cannotInventAlpha: true,
      testsRequired: true,
      killSwitchesMandatory: true,
    },
    config: {
      modelClass: "preview-opus",
      cadence: "continuous",
      tcaWindowDays: 30,
    },
    activatedAt: "2026-01-06T16:15:00.000Z",
  },
  {
    id: "AGT-STATARB-001",
    displayName: "Tim",
    role: "Statistical Researcher",
    tier: 2,
    status: "ACTIVE",
    strategyCategory: "Stat Arb",
    reportsTo: "AGT-CIO",
    currentAllocationUsd: 24_000,
    maxAllocationUsd: 32_000,
    objectiveFunction: "Research short-horizon mean reversion with tight evidence windows and fast invalidation.",
    subscriptions: ["price.microstructure", "desk.research", "research.events"],
    directReports: [],
    constraints: {
      maxSingleNamePct: 12,
      averageHoldHours: 18,
    },
    config: {
      modelClass: "preview-sonnet",
      turnoverProfile: "high",
    },
    activatedAt: "2026-01-09T14:00:00.000Z",
  },
  {
    id: "AGT-MACRO-001",
    displayName: "David",
    role: "Macro Researcher",
    tier: 2,
    status: "ACTIVE",
    strategyCategory: "Macro",
    reportsTo: "AGT-CIO",
    currentAllocationUsd: 26_000,
    maxAllocationUsd: 34_000,
    objectiveFunction: "Research macro regime shifts through liquid index, rates, and sector evidence.",
    subscriptions: ["macro.calendar", "desk.research", "prediction.markets"],
    directReports: [],
    constraints: {
      maxThemeOverlapPct: 35,
      requiredCatalyst: true,
    },
    config: {
      modelClass: "preview-sonnet",
      turnoverProfile: "medium",
    },
    activatedAt: "2026-01-10T14:00:00.000Z",
  },
  {
    id: "AGT-EVENT-001",
    displayName: "Kalla",
    role: "Event-Driven Researcher",
    tier: 2,
    status: "ACTIVE",
    strategyCategory: "Event-Driven",
    reportsTo: "AGT-CIO",
    currentAllocationUsd: 22_000,
    maxAllocationUsd: 30_000,
    objectiveFunction: "Research catalyst windows with explicit timing, probability, and downside framing.",
    subscriptions: ["earnings.calendar", "filings", "desk.research"],
    directReports: [],
    constraints: {
      maxHoldingDays: 7,
      requireCatalystDate: true,
    },
    config: {
      modelClass: "preview-sonnet",
      turnoverProfile: "medium",
    },
    activatedAt: "2026-01-11T14:00:00.000Z",
  },
  {
    id: "AGT-SENT-001",
    displayName: "Riya",
    role: "Sentiment Researcher",
    tier: 2,
    status: "ACTIVE",
    strategyCategory: "Sentiment",
    reportsTo: "AGT-CIO",
    currentAllocationUsd: 18_000,
    maxAllocationUsd: 26_000,
    objectiveFunction: "Research crowding, positioning, and tone shifts before they fully print in price.",
    subscriptions: ["headline.velocity", "options.flow", "desk.research"],
    directReports: [],
    constraints: {
      maxGapRiskPct: 4,
      requireLiquidityFloor: true,
    },
    config: {
      modelClass: "preview-sonnet",
      turnoverProfile: "medium",
    },
    activatedAt: "2026-01-12T14:00:00.000Z",
  },
  {
    id: "AGT-TREND-001",
    displayName: "Mira",
    role: "Trend Researcher",
    tier: 3,
    status: "ACTIVE",
    strategyCategory: "Trend",
    reportsTo: "AGT-CIO",
    currentAllocationUsd: 16_000,
    maxAllocationUsd: 24_000,
    objectiveFunction: "Hold persistent moves that pass trend strength, liquidity, and correlation filters.",
    subscriptions: ["price.trend", "risk.monitor"],
    directReports: [],
    constraints: {
      minimumTrendDays: 5,
      maxNetExposurePct: 40,
    },
    config: {
      modelClass: "preview-sonnet",
      turnoverProfile: "low",
    },
    activatedAt: "2026-01-13T14:00:00.000Z",
  },
  {
    id: "AGT-VOL-001",
    displayName: "Noah",
    role: "Volatility Researcher",
    tier: 3,
    status: "ACTIVE",
    strategyCategory: "Volatility",
    reportsTo: "AGT-CIO",
    currentAllocationUsd: 12_000,
    maxAllocationUsd: 20_000,
    objectiveFunction: "Research volatility dislocations while minimizing overlap with directional sleeves.",
    subscriptions: ["vol.surface", "risk.monitor"],
    directReports: [],
    constraints: {
      maxSingleThemePct: 10,
      requireHedgePairing: true,
    },
    config: {
      modelClass: "preview-sonnet",
      turnoverProfile: "medium",
    },
    activatedAt: "2026-01-14T14:00:00.000Z",
  },
];

const PREVIEW_TRADER_IDS = PREVIEW_AGENT_DEFINITIONS.filter(
  (definition) => definition.strategyCategory
).map((definition) => definition.id);

const PREVIEW_DECISION_RUNTIME: DashboardDecisionRuntimeDiagnostic = {
  configured: true,
  providerLabel: "Local Preview",
  modelLabel: "Mock dashboard data",
  statusDetail:
    "DEV_DASHBOARD_BYPASS is enabled, so customer pages are rendering from deterministic preview data instead of the live runtime.",
};

const PREVIEW_OVERRIDES: PreviewOverride[] = [];

let previewState: PreviewState | null = null;

const DECOMMISSIONED_DECISION_RUNTIME: DashboardDecisionRuntimeDiagnostic = {
  configured: false,
  providerLabel: "Decommissioned",
  modelLabel: "Legacy agent swarm disabled",
  statusDetail:
    "The legacy CIO, research, quant, execution, and agent orchestration stack has been fully decommissioned.",
};

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function formatPtTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function formatPtDay(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

function formatPtMonth(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    month: "short",
    year: "2-digit",
  }).format(new Date(value));
}

function formatHistoryLabel(value: string, range: DashboardPortfolioHistoryRange) {
  if (range === "1D") {
    return formatPtTime(value);
  }

  if (range === "MAX") {
    return formatPtMonth(value);
  }

  return formatPtDay(value);
}

function formatAudience(recipientId: string | null, recipientName: string | null) {
  if (recipientId) {
    return recipientName ? `${recipientName} (${recipientId})` : recipientId;
  }

  return "Shared blackboard";
}

function formatCompactCurrency(value: number | null) {
  if (!isFiniteNumber(value)) {
    return "—";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatSignedCurrency(value: number | null, maximumFractionDigits = 0) {
  if (!isFiniteNumber(value)) {
    return "—";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits,
    signDisplay: "always",
  }).format(value);
}

function getPreviewAgentDefinition(agentId: string) {
  return PREVIEW_AGENT_DEFINITIONS.find((definition) => definition.id === agentId) ?? null;
}

function getPreviewAgentName(agentId: string) {
  return getPreviewAgentDefinition(agentId)?.displayName ?? agentId;
}

function createPreviewMessageTimestamp(now: Date, minutesAgo: number) {
  return new Date(now.getTime() - minutesAgo * 60_000).toISOString();
}

function createPreviewDiscussionMessages(now: Date): DashboardDiscussionMessage[] {
  const definitions: PreviewMessageDefinition[] = [
    {
      id: "MSG-010",
      minutesAgo: 2,
      senderId: "AGT-CIO",
      recipientId: null,
      messageType: "DISCUSSION",
      priority: "MEDIUM",
      renderType: "message",
      content:
        "Defer the re-entry unless evidence quality improves into the close. StatArb already has most of the attention weight we want in this tape.",
      reasoning:
        "Cross-sleeve overlap is still elevated, and the desk does not need another correlated thesis while volatility is widening.",
      payload: {
        threadId: "thread-tariffs",
        decisionInfluence: "Allocation bias remains capped until overnight tariff risk clears.",
      },
    },
    {
      id: "MSG-009",
      minutesAgo: 4,
      senderId: "AGT-MACRO-001",
      recipientId: "AGT-CIO",
      messageType: "DISCUSSION",
      priority: "HIGH",
      renderType: "message",
      content:
        "Kalshi came back clean on tariff escalation risk, but overnight gap risk is still the main thing that can move the whole coverage set at once.",
      reasoning:
        "Crowd-implied odds improved, but the scenario still concentrates gap exposure in the same names already emphasized by the desk.",
      payload: {
        threadId: "thread-tariffs",
        influences: [{ targetAgentId: "AGT-CIO", effect: "keep overnight gross capped" }],
      },
    },
    {
      id: "MSG-008",
      minutesAgo: 6,
      senderId: "AGT-STATARB-001",
      recipientId: "AGT-CIO",
      messageType: "DISCUSSION",
      priority: "MEDIUM",
      renderType: "message",
      content:
        "UUP still looks clean after the DBC reset. I would rather wait for tomorrow's open than force the thesis into weakening breadth.",
      reasoning:
        "The mean-reversion evidence is intact, but signal quality deteriorates sharply during a liquidity pocket.",
      payload: {
        threadId: "thread-tariffs",
        influences: [{ targetAgentId: "AGT-CIO", effect: "defer UUP re-entry" }],
      },
    },
    {
      id: "MSG-007",
      minutesAgo: 8,
      senderId: "AGT-EVENT-001",
      recipientId: "AGT-CIO",
      messageType: "SIGNAL",
      priority: "HIGH",
      renderType: "action",
      content:
        "I want first look at META on the next policy headline. If the tariff tape cools without a vol reset, that is the cleanest catalyst sleeve on the board.",
      reasoning:
        "Event risk remains binary, but the payoff is still favorable if the market gets one clean headline without a second-order macro shock.",
      payload: {
        threadId: "thread-meta",
        decisionInfluence: "Reserve event sleeve dry powder for META headline follow-through.",
      },
    },
    {
      id: "MSG-006",
      minutesAgo: 12,
      senderId: "AGT-RESEARCH",
      recipientId: null,
      messageType: "RESEARCH_REPORT",
      priority: "MEDIUM",
      renderType: "message",
      content:
        "Macro read-through is still mixed: rates are calm, but the tariff headline cadence is fast enough that crowd positioning can flip before cash open.",
      reasoning:
        "Kalshi odds cooled, Polymarket liquidity improved, and the linked filings do not yet confirm a broader demand shock.",
      payload: {
        threadId: "thread-tariffs",
        decisionInfluence: "Macro shock probability lower, but overnight gap risk still elevated.",
        watchSymbols: ["UUP", "META", "QQQ"],
      },
    },
    {
      id: "MSG-005",
      minutesAgo: 15,
      senderId: "AGT-SENT-001",
      recipientId: "AGT-CIO",
      messageType: "DISCUSSION",
      priority: "MEDIUM",
      renderType: "message",
      content:
        "Crowding in QQQ longs is easing, but not enough for me to press the sleeve harder right here. I would rather react after cash liquidity shows up.",
      reasoning:
        "Headline velocity improved, but options flow is still too one-sided to call this a clean sentiment reset.",
      payload: {
        threadId: "thread-qqq",
        decisionInfluence: "Hold current QQQ sentiment sleeve size.",
      },
    },
    {
      id: "MSG-004",
      minutesAgo: 18,
      senderId: "AGT-CIO",
      recipientId: "AGT-STATARB-001",
      messageType: "ALLOCATION_CHANGE",
      priority: "MEDIUM",
      renderType: "action",
      content:
        "Raising StatArb target by $3K for the next session while keeping Macro capped until overnight event risk clears.",
      reasoning:
        "The StatArb sleeve is the cleanest source of non-consensus P&L in the current tape and adds less overlap than another macro expression.",
      payload: {
        threadId: "thread-allocation",
        agentId: "AGT-STATARB-001",
        newAllocationUsd: 27000,
      },
    },
    {
      id: "MSG-003",
      minutesAgo: 24,
      senderId: "AGT-RESEARCH",
      recipientId: "AGT-SENT-001",
      messageType: "SIGNAL",
      priority: "MEDIUM",
      renderType: "message",
      content:
        "Crowd odds on the next Fed surprise are compressing again. Watch QQQ, NVDA, and UUP if rates start to lift back through the overnight highs.",
      reasoning:
        "The cross-asset move has not confirmed yet, but the setup is close enough that the desk should keep the names on watch.",
      payload: {
        threadId: "thread-qqq",
        watchSymbols: ["QQQ", "NVDA", "UUP"],
      },
    },
    {
      id: "MSG-002",
      minutesAgo: 31,
      senderId: "AGT-MACRO-001",
      recipientId: null,
      messageType: "DISCUSSION",
      priority: "LOW",
      renderType: "message",
      content:
        "Dollar strength is no longer doing all the work on its own. If UUP continues higher from here, it probably needs a new macro catalyst.",
      reasoning:
        "The rate backdrop is supportive, but the move has stalled enough that we need fresh information before pressing size.",
      payload: {
        threadId: "thread-uup",
      },
    },
    {
      id: "MSG-001",
      minutesAgo: 38,
      senderId: "AGT-STATARB-001",
      recipientId: null,
      messageType: "DISCUSSION",
      priority: "LOW",
      renderType: "message",
      content:
        "Spread compression in AMD versus the semi basket is still intact. I am happy holding what we have rather than reaching for more size late.",
      reasoning:
        "The setup is working, and adding late would worsen entry quality without materially improving expected value.",
      payload: {
        threadId: "thread-amd",
      },
    },
  ];

  return definitions
    .map((definition) => {
      const senderDefinition = getPreviewAgentDefinition(definition.senderId);
      const recipientDefinition = definition.recipientId
        ? getPreviewAgentDefinition(definition.recipientId)
        : null;
      const payload = { ...definition.payload };
      const influenceSummary =
        typeof payload.decisionInfluence === "string" ? payload.decisionInfluence : null;
      const threadId =
        typeof payload.threadId === "string" ? payload.threadId : null;

      return {
        id: definition.id,
        timestamp: createPreviewMessageTimestamp(now, definition.minutesAgo),
        senderId: definition.senderId,
        senderName: senderDefinition?.displayName ?? definition.senderId,
        senderRole: senderDefinition?.role ?? "Researcher",
        recipientId: definition.recipientId,
        recipientName: recipientDefinition?.displayName ?? definition.recipientId,
        messageType: definition.messageType,
        priority: definition.priority,
        renderType: definition.renderType,
        content: definition.content,
        reasoning: definition.reasoning,
        payload,
        influenceSummary,
        threadId,
      } satisfies DashboardDiscussionMessage;
    })
    .sort(
      (left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime()
    );
}

function createIntradayHistory(now: Date, latestValue: number) {
  const lastPnl = mockIntradayPnl.at(-1)?.pnl ?? 0;
  const offset = latestValue - lastPnl;
  const baseline = (mockIntradayPnl[0]?.pnl ?? 0) + offset;

  return mockIntradayPnl.map((point) => {
    const [hourString, minuteString] = point.time.split(":");
    const timestamp = new Date(now);
    timestamp.setHours(Number(hourString), Number(minuteString), 0, 0);
    const portfolioValue = offset + point.pnl;
    const pnl = portfolioValue - baseline;

    return {
      timestamp: timestamp.toISOString(),
      time: formatPtTime(timestamp.toISOString()),
      portfolioValue,
      pnl,
      pnlPct: baseline !== 0 ? pnl / baseline : null,
    } satisfies DashboardPortfolioHistoryPoint;
  });
}

function createSyntheticHistory(input: {
  latestValue: number;
  pointCount: number;
  stepMs: number;
  startMultiplier: number;
  amplitude: number;
  range: DashboardPortfolioHistoryRange;
  now: Date;
}) {
  const { latestValue, pointCount, stepMs, startMultiplier, amplitude, range, now } = input;
  const startValue = latestValue * startMultiplier;
  const lastWave = Math.sin((pointCount - 1) / 5) * amplitude + Math.cos((pointCount - 1) / 11) * amplitude * 0.55;

  return Array.from({ length: pointCount }, (_, index) => {
    const progress = pointCount === 1 ? 1 : index / (pointCount - 1);
    const timestamp = new Date(now.getTime() - (pointCount - 1 - index) * stepMs).toISOString();
    const rawWave =
      Math.sin(index / 5) * amplitude + Math.cos(index / 11) * amplitude * 0.55;
    const value = startValue + (latestValue - startValue) * progress + (rawWave - lastWave);
    const pnl = value - startValue;

    return {
      timestamp,
      time: formatHistoryLabel(timestamp, range),
      portfolioValue: Number(value.toFixed(2)),
      pnl: Number(pnl.toFixed(2)),
      pnlPct: startValue !== 0 ? pnl / startValue : null,
    } satisfies DashboardPortfolioHistoryPoint;
  });
}

function createPortfolioHistories(now: Date, latestValue: number) {
  const oneDay = createIntradayHistory(now, latestValue);

  return {
    "1D": oneDay,
    "1M": createSyntheticHistory({
      latestValue,
      pointCount: 31,
      stepMs: 24 * 60 * 60 * 1000,
      startMultiplier: 0.962,
      amplitude: 980,
      range: "1M",
      now,
    }),
    "1Y": createSyntheticHistory({
      latestValue,
      pointCount: 252,
      stepMs: 24 * 60 * 60 * 1000,
      startMultiplier: 0.84,
      amplitude: 2_350,
      range: "1Y",
      now,
    }),
    MAX: createSyntheticHistory({
      latestValue,
      pointCount: 520,
      stepMs: 24 * 60 * 60 * 1000,
      startMultiplier: 0.76,
      amplitude: 3_200,
      range: "MAX",
      now,
    }),
  } satisfies Record<DashboardPortfolioHistoryRange, DashboardPortfolioHistoryPoint[]>;
}

function mapAgentReference(
  sourceId: string,
  assignedIds: Map<string, string>,
  nextIndexRef: { value: number }
) {
  if (sourceId === "CIO-001" || sourceId === "AGT-CIO") {
    return "AGT-CIO";
  }

  if (sourceId === "CRO-001" || sourceId === "COO-001") {
    return "AGT-CIO";
  }

  if (assignedIds.has(sourceId)) {
    return assignedIds.get(sourceId)!;
  }

  const mappedId = PREVIEW_TRADER_IDS[nextIndexRef.value % PREVIEW_TRADER_IDS.length];
  nextIndexRef.value += 1;
  assignedIds.set(sourceId, mappedId);
  return mappedId;
}

function rewriteAgentReferences(
  content: string,
  assignedIds: Map<string, string>,
  nextIndexRef: { value: number }
) {
  return content.replace(/\b(?:[A-Z]+(?:-[A-Z]+)?-\d{3}|CIO-001|CRO-001|COO-001)\b/g, (match) =>
    mapAgentReference(match, assignedIds, nextIndexRef)
  );
}

function buildPreviewTradingData(now: Date, portfolioValue: number) {
  const assignedIds = new Map<string, string>();
  const nextIndexRef = { value: 0 };
  const selectedPositions = mockPositions.slice(0, 10);
  const selectedTrades = mockTrades.slice(0, 24);
  const rawPositionAbsTotal = selectedPositions.reduce(
    (sum, position) => sum + Math.abs(position.notionalValue),
    0
  );
  const targetGrossExposure = portfolioValue * 1.38;
  const positionScale = rawPositionAbsTotal > 0 ? targetGrossExposure / rawPositionAbsTotal : 1;
  const tradeScale = positionScale * 0.92;
  const ownerAccumulator = new Map<
    string,
    {
      marketValue: number;
      unrealizedPl: number;
      positionCount: number;
    }
  >();
  const latestTradeTimeByAgentSymbol = new Map<string, string>();
  const orderCountByAgentSymbol = new Map<string, number>();

  const trades: DashboardTradeRecord[] = selectedTrades.map((trade, index) => {
    const agentId = mapAgentReference(trade.agentId, assignedIds, nextIndexRef);
    const notional = Number((trade.notional * tradeScale).toFixed(2));
    const qty = trade.price > 0 ? Number((notional / trade.price).toFixed(4)) : null;
    const timestamp = new Date(now.getTime() - index * 27 * 60_000).toISOString();
    const tickerKey = `${agentId}:${trade.ticker}`;

    latestTradeTimeByAgentSymbol.set(tickerKey, timestamp);
    orderCountByAgentSymbol.set(tickerKey, (orderCountByAgentSymbol.get(tickerKey) ?? 0) + 1);

    return {
      id: trade.id,
      timestamp,
      agentId,
      agentName: getPreviewAgentName(agentId),
      ticker: trade.ticker,
      action: trade.action,
      qty,
      price: Number(trade.price.toFixed(2)),
      notional,
      confidence: trade.confidence,
      status: trade.status,
      reasoning: rewriteAgentReferences(trade.reasoning, assignedIds, nextIndexRef),
      strategyLabel: trade.strategy,
      requestPayload: {
        preview: true,
      },
      riskGateReason: null,
      riskGateInputs: [],
    };
  });

  const positions: DashboardPortfolioPosition[] = selectedPositions.map((position) => {
    const currentPrice = Number(position.currentPrice.toFixed(2));
    const marketValueAbs = position.notionalValue * positionScale;
    const side = position.direction === "Short" ? "short" : "long";
    const signedMarketValue = side === "short" ? -marketValueAbs : marketValueAbs;
    const qty = currentPrice > 0 ? Number((marketValueAbs / currentPrice).toFixed(4)) : null;
    const avgEntryPrice = Number(position.avgEntry.toFixed(2));
    const unrealizedPl =
      qty !== null
        ? Number(
            (
              qty *
              (currentPrice - avgEntryPrice) *
              (side === "short" ? -1 : 1)
            ).toFixed(2)
          )
        : null;
    const totalBreakdownSize = position.agentBreakdown.reduce(
      (sum, breakdown) => sum + Math.max(0, breakdown.size),
      0
    );

    const owners = position.agentBreakdown.map((breakdown) => {
      const ownerAgentId = mapAgentReference(breakdown.agentId, assignedIds, nextIndexRef);
      const share =
        totalBreakdownSize > 0 ? breakdown.size / totalBreakdownSize : 1 / position.agentBreakdown.length;
      const attributedMarketValue = Number((signedMarketValue * share).toFixed(2));
      const attributedQty = qty !== null ? Number((qty * share).toFixed(4)) : null;
      const attributedUnrealizedPl =
        unrealizedPl !== null ? Number((unrealizedPl * share).toFixed(2)) : null;
      const ownerKey = `${ownerAgentId}:${position.ticker}`;
      const existingOwnerTotals = ownerAccumulator.get(ownerAgentId) ?? {
        marketValue: 0,
        unrealizedPl: 0,
        positionCount: 0,
      };

      ownerAccumulator.set(ownerAgentId, {
        marketValue: existingOwnerTotals.marketValue + attributedMarketValue,
        unrealizedPl:
          existingOwnerTotals.unrealizedPl + (attributedUnrealizedPl ?? 0),
        positionCount: existingOwnerTotals.positionCount + 1,
      });

      return {
        agentId: ownerAgentId,
        attributedQty,
        attributedMarketValue,
        attributedUnrealizedPl,
        netSubmittedNotional: attributedMarketValue,
        orderCount: orderCountByAgentSymbol.get(ownerKey) ?? 1,
        lastOrderAt: latestTradeTimeByAgentSymbol.get(ownerKey) ?? null,
      };
    });

    return {
      symbol: position.ticker,
      side,
      qty,
      marketValue: Number(signedMarketValue.toFixed(2)),
      currentPrice,
      avgEntryPrice,
      unrealizedPl,
      pctOfNav: Number(((signedMarketValue / portfolioValue) * 100).toFixed(2)),
      owners,
      unattributedMarketValue: null,
    };
  });

  const agentExposure: DashboardAgentExposure[] = PREVIEW_AGENT_DEFINITIONS.map((definition) => {
    const totals = ownerAccumulator.get(definition.id);

    return {
      agentId: definition.id,
      positionCount: totals?.positionCount ?? 0,
      attributedMarketValue: totals ? Number(totals.marketValue.toFixed(2)) : null,
      attributedUnrealizedPl: totals ? Number(totals.unrealizedPl.toFixed(2)) : null,
    };
  }).filter(
    (exposure) =>
      exposure.positionCount > 0 ||
      isFiniteNumber(exposure.attributedMarketValue) ||
      isFiniteNumber(exposure.attributedUnrealizedPl)
  );

  return {
    trades,
    positions,
    agentExposure: agentExposure.sort(
      (left, right) =>
        Math.abs(right.attributedMarketValue ?? 0) - Math.abs(left.attributedMarketValue ?? 0)
    ),
  };
}

function buildPreviewAlerts(
  now: Date,
  assignedIds: Map<string, string>,
  nextIndexRef: { value: number }
) {
  return mockAlerts.slice(0, 12).map((alert, index) => ({
    id: alert.id,
    timestamp: new Date(now.getTime() - (index * 73 + 12) * 60_000).toISOString(),
    severity: alert.severity,
    source: mapAgentReference(alert.source, assignedIds, nextIndexRef),
    description: rewriteAgentReferences(alert.description, assignedIds, nextIndexRef),
    status: "new",
    messageType:
      alert.severity === "critical"
        ? "RISK_ALERT"
        : alert.type === "data_latency"
          ? "SYSTEM_STATUS"
          : "ALERT",
  } satisfies DashboardAlertRecord));
}

function buildPreviewActivityFeed(input: {
  trades: DashboardTradeRecord[];
  alerts: DashboardAlertRecord[];
}) {
  const tradeEvents: DashboardActivityEvent[] = input.trades.slice(0, 5).map((trade) => ({
    id: `research-${trade.id}`,
    timestamp: trade.timestamp ?? new Date().toISOString(),
    agentId: trade.agentId ?? "AGT-CIO",
    agentName: trade.agentName,
    type: "research",
    description: `Published ${trade.ticker} research update with ${formatCompactCurrency(trade.notional)} of evidence weight.`,
  }));

  const allocationEvents: DashboardActivityEvent[] = [
    {
      id: "alloc-001",
      timestamp: new Date(new Date(tradeEvents[0]?.timestamp ?? new Date().toISOString()).getTime() - 11 * 60_000).toISOString(),
      agentId: "AGT-CIO",
      agentName: "Jacob",
      type: "allocation",
      description: "Raised Stat Arb target allocation after overnight overlap improved.",
    },
    {
      id: "research-001",
      timestamp: new Date(new Date(tradeEvents[0]?.timestamp ?? new Date().toISOString()).getTime() - 19 * 60_000).toISOString(),
      agentId: "AGT-RESEARCH",
      agentName: "Priya",
      type: "research",
      description: "Published a tariff-risk brief linking Kalshi odds, filings, and overnight futures.",
    },
  ];

  const alertEvents: DashboardActivityEvent[] = input.alerts.slice(0, 2).map((alert) => ({
    id: `alert-${alert.id}`,
    timestamp: alert.timestamp,
    agentId: alert.source,
    agentName: getPreviewAgentName(alert.source),
    type: "alert",
    description: alert.description,
  }));

  return [...tradeEvents, ...allocationEvents, ...alertEvents].sort(
    (left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime()
  );
}

function buildPortfolioStatistics(portfolioValue: number): DashboardPortfolioStatistic[] {
  return [
    {
      label: "Sharpe Ratio",
      display: "1.37",
      value: 1.37,
      detail: "Preview 1Y return path, 249 daily observations.",
      tone: "positive",
    },
    {
      label: "Sortino Ratio",
      display: "2.27",
      value: 2.27,
      detail: "Downside-vol adjusted return in local preview mode.",
      tone: "positive",
    },
    {
      label: "Calmar Ratio",
      display: "2.05",
      value: 2.05,
      detail: "Annualized return divided by preview max drawdown.",
      tone: "positive",
    },
    {
      label: "Max Drawdown",
      display: "-19.55%",
      value: -19.55,
      detail: "Peak-to-trough decline over the preview 1Y path.",
      tone: "negative",
    },
    {
      label: "VaR 95%",
      display: "$3,513",
      value: 3513,
      detail: "Preview one-period historical loss threshold.",
      tone: "negative",
    },
    {
      label: "CVaR 95%",
      display: "$5,171",
      value: 5171,
      detail: "Average preview loss beyond the VaR threshold.",
      tone: "negative",
    },
    {
      label: "Exposure / Leverage",
      display: "161.5% / 1.62x",
      value: 1.615,
      detail: "Gross market value over preview net asset value.",
      tone: "neutral",
    },
    {
      label: "Net Exposure",
      display: "61.54%",
      value: 61.54,
      detail: `Directional exposure after netting longs and shorts on ${formatCompactCurrency(portfolioValue)} of NAV.`,
      tone: "neutral",
    },
    {
      label: "Cash Buffer",
      display: "-61.53%",
      value: -61.53,
      detail: "Preview leverage reserve after grossing up the active sleeves.",
      tone: "negative",
    },
  ];
}

function buildProviderDiagnostics(nowIso: string): DashboardProviderDiagnostic[] {
  return [
    {
      id: "preview-market-data",
      label: "Local Market Data Preview",
      configured: true,
      connected: true,
      purpose: "Deterministic local research state for design and layout work.",
      capabilities: [
        "Coverage value sample",
        "Coverage sample",
        "Research feed sample",
        "Alert sample",
      ],
      statusDetail: "Using local preview data instead of a live market-data connection.",
      lastCheckedAt: nowIso,
    },
    {
      id: "preview-research",
      label: "Research Preview",
      configured: true,
      connected: true,
      purpose: "Sample headlines, filings, and prediction-market context for the customer portal.",
      capabilities: [
        "Headline cards",
        "Prediction-market cards",
        "Filing cards",
        "Research report cards",
      ],
      statusDetail: "Rendering static research packets for local portal iteration.",
      lastCheckedAt: nowIso,
    },
    {
      id: "preview-routing",
      label: "Model Routing Preview",
      configured: true,
      connected: true,
      purpose: "Represents the desk's layered model router without invoking the live runtime.",
      capabilities: [
        "Desk routing status",
        "CIO routing status",
        "HR routing status",
      ],
      statusDetail: "Desk pages are in preview mode, so no model calls are being made.",
      lastCheckedAt: nowIso,
    },
  ];
}

function buildResearchFeed(now: Date, watchSymbols: string[]): DashboardResearchFeedItem[] {
  const items: DashboardResearchFeedItem[] = [
    {
      id: "research-brief-001",
      timestamp: new Date(now.getTime() - 14 * 60_000).toISOString(),
      sourceId: "agent",
      sourceLabel: "Research Desk",
      category: "research-report",
      title: "Overnight tariff risk brief",
      summary:
        "Desk synthesis linking crowd odds, sector sensitivity, and the names most likely to gap at the next open.",
      symbol: watchSymbols[0] ?? null,
      href: null,
      imageUrl: "/research-feed-demo/research-brief.svg",
      meta: ["Desk note", "Local preview", "Macro + event overlap"],
    },
    {
      id: "massive-001",
      timestamp: new Date(now.getTime() - 26 * 60_000).toISOString(),
      sourceId: "massive",
      sourceLabel: "Alpaca + Alpha Vantage",
      category: "market",
      title: "NVDA holds its overnight range while semis stabilize",
      summary:
        "Price action cooled without a full unwind, leaving the event and sentiment sleeves on watch rather than forcing size.",
      symbol: "NVDA",
      href: null,
      imageUrl: "/research-feed-demo/semis-market.svg",
      meta: ["Market move", "Semis", "Watch only"],
    },
    {
      id: "alphavantage-001",
      timestamp: new Date(now.getTime() - 39 * 60_000).toISOString(),
      sourceId: "alphavantage",
      sourceLabel: "Alpha Vantage",
      category: "headline",
      title: "AAPL supply-chain chatter resurfaces ahead of the next tariff window",
      summary:
        "Headline tone improved versus the prior session, but not enough for the desk to treat it as a clean all-clear.",
      symbol: "AAPL",
      href: null,
      imageUrl: "/research-feed-demo/supply-chain.svg",
      meta: ["Headline", "Supply chain", "Cross-check with pricing"],
    },
    {
      id: "kalshi-001",
      timestamp: new Date(now.getTime() - 55 * 60_000).toISOString(),
      sourceId: "kalshi",
      sourceLabel: "Kalshi",
      category: "prediction-market",
      title: "Fed surprise probability slips below 30%",
      summary:
        "Macro desk uses the odds move as a secondary input, not a standalone allocation trigger.",
      symbol: null,
      href: null,
      imageUrl: "/research-feed-demo/rates-odds.svg",
      meta: ["Prediction market", "Rates", "Overnight macro context"],
    },
    {
      id: "polymarket-001",
      timestamp: new Date(now.getTime() - 71 * 60_000).toISOString(),
      sourceId: "polymarket",
      sourceLabel: "Polymarket",
      category: "prediction-market",
      title: "Policy headline odds tighten after the morning rumor cycle",
      summary:
        "Event sleeve keeps dry powder available because crowd odds are stabilizing faster than realized volatility.",
      symbol: null,
      href: null,
      imageUrl: "/research-feed-demo/policy-odds.svg",
      meta: ["Prediction market", "Policy", "Event sleeve watch"],
    },
    {
      id: "sec-001",
      timestamp: new Date(now.getTime() - 96 * 60_000).toISOString(),
      sourceId: "sec",
      sourceLabel: "SEC EDGAR",
      category: "filing",
      title: "DAL 8-K added to the airline catalyst stack",
      summary:
        "Filing context remains neutral, but it keeps the event book attentive to travel-linked risk into the next session.",
      symbol: "DAL",
      href: null,
      imageUrl: "/research-feed-demo/sec-filing.svg",
      meta: ["Filing", "Event risk", "Travel"],
    },
  ];

  return items.sort(
    (left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime()
  );
}

function createAgentRows(input: {
  messages: DashboardDiscussionMessage[];
  agentExposure: DashboardAgentExposure[];
  trades: DashboardTradeRecord[];
}) {
  const exposureByAgentId = new Map(
    input.agentExposure.map((exposure) => [exposure.agentId, exposure])
  );

  return PREVIEW_AGENT_DEFINITIONS.map((definition) => {
    const sentMessages = input.messages.filter((message) => message.senderId === definition.id);
    const agentTrades = input.trades.filter((trade) => trade.agentId === definition.id);
    const exposure = exposureByAgentId.get(definition.id);

    return {
      id: definition.id,
      displayName: definition.displayName,
      role: definition.role,
      tier: definition.tier,
      status: definition.status,
      activatedAt: definition.activatedAt,
      terminatedAt: null,
      strategyCategory: definition.strategyCategory,
      reportsTo: definition.reportsTo,
      currentAllocationUsd: definition.currentAllocationUsd,
      maxAllocationUsd: definition.maxAllocationUsd,
      attributedMarketValue: exposure?.attributedMarketValue ?? null,
      attributedUnrealizedPl: exposure?.attributedUnrealizedPl ?? null,
      positionCount: exposure?.positionCount ?? 0,
      recentMessageCount: sentMessages.length,
      recentOrderCount: agentTrades.length,
      lastMessageAt: sentMessages[0]?.timestamp ?? null,
      lastOrderAt: agentTrades[0]?.timestamp ?? null,
    } satisfies DashboardAgentRow;
  });
}

function buildAgentRecentMessages(
  agentId: string,
  busMessages: DashboardAgentBusMessageDetail[]
): DashboardActivityEvent[] {
  return busMessages.slice(0, 12).map((message) => ({
    id: message.id,
    timestamp: message.timestamp,
    agentId: message.senderId,
    agentName: message.senderName,
    type:
      message.messageType === "ALLOCATION_CHANGE"
        ? "allocation"
        : message.messageType === "RISK_ALERT"
          ? "alert"
          : message.messageType === "RESEARCH_REPORT" || message.messageType === "SIGNAL"
            ? "research"
            : message.messageType === "TRADE_ORDER"
              ? "trade"
              : "status",
    description:
      message.senderId === agentId
        ? message.content
        : `${message.senderName ?? message.senderId} to ${message.audience}: ${message.content}`,
  }));
}

function buildResearchTrace(
  agentId: string,
  messages: DashboardDiscussionMessage[]
): DashboardAgentResearchTrace[] {
  const researchMessages = messages.filter(
    (message) =>
      message.senderId === "AGT-RESEARCH" &&
      (message.messageType === "RESEARCH_REPORT" || message.messageType === "SIGNAL")
  );

  const relevantMessages =
    agentId === "AGT-RESEARCH"
      ? researchMessages
      : researchMessages.filter(
          (message) =>
            message.recipientId === null ||
            message.recipientId === agentId ||
            message.payload.watchSymbols !== undefined
        );

  return relevantMessages.slice(0, 4).map((message) => {
    const downstream = messages
      .filter(
        (candidate) =>
          candidate.id !== message.id &&
          candidate.threadId &&
          candidate.threadId === message.threadId &&
          candidate.senderId !== "AGT-RESEARCH" &&
          new Date(candidate.timestamp).getTime() >= new Date(message.timestamp).getTime()
      )
      .slice(0, 4)
      .map((candidate) => ({
        id: candidate.id,
        timestamp: candidate.timestamp,
        agentId: candidate.senderId,
        agentName: candidate.senderName,
        messageType: candidate.messageType,
        content: candidate.content,
      }));

    return {
      id: message.id,
      cycleId: null,
      timestamp: message.timestamp,
      sourceAgentId: message.senderId,
      sourceAgentName: message.senderName,
      messageType: message.messageType,
      content: message.content,
      reasoning: message.reasoning,
      audience: formatAudience(message.recipientId, message.recipientName),
      payload: message.payload,
      downstream,
    } satisfies DashboardAgentResearchTrace;
  });
}

function buildDecisionContributions(
  agentId: string,
  agentTrades: DashboardTradeRecord[],
  messages: DashboardDiscussionMessage[]
): DashboardAgentDecisionContribution[] {
  const relatedMessage =
    messages.find((message) => message.senderId === agentId) ??
    messages.find((message) => message.recipientId === agentId) ??
    null;

  const tradeContributions = agentTrades.slice(0, 3).map((trade, index) => ({
    id: `decision-${agentId}-${index + 1}`,
    cycleId: null,
    timestamp: trade.timestamp ?? new Date().toISOString(),
    actionTaken:
      trade.action === "BUY" || trade.action === "SELL"
        ? "publish_research_update"
        : "declare_research_context",
    reasoning: trade.reasoning,
    dataConsumed: [
      trade.strategyLabel ?? "Desk review",
      "price action",
      "research context",
    ],
    confidenceScore: clamp(trade.confidence ?? 76, 50, 99),
    relatedMessageId: relatedMessage?.id ?? null,
    relatedMessageType: relatedMessage?.messageType ?? null,
    relatedMessageContent: relatedMessage?.content ?? null,
    relatedMessagePayload: relatedMessage?.payload ?? {},
  }));

  if (agentId !== "AGT-CIO") {
    return tradeContributions;
  }

  return [
    {
      id: "decision-AGT-CIO-allocation",
      cycleId: null,
      timestamp: messages[0]?.timestamp ?? new Date().toISOString(),
      actionTaken: "set_target_allocation",
      reasoning:
        "Raised Stat Arb modestly and held Macro steady to keep overlap and overnight gap risk inside the current book limits.",
      dataConsumed: [
        "desk discussion",
        "ensemble overlap",
        "prediction-market context",
        "coverage exposure",
      ],
      confidenceScore: 88,
      relatedMessageId: "MSG-004",
      relatedMessageType: "ALLOCATION_CHANGE",
      relatedMessageContent:
        "Raising StatArb target by $3K for the next session while keeping Macro capped until overnight event risk clears.",
      relatedMessagePayload: {
        agentId: "AGT-STATARB-001",
        newAllocationUsd: 27_000,
      },
    },
    ...tradeContributions,
  ];
}

function buildAllocationContributions(agentId: string): DashboardAgentAllocationContribution[] {
  const statArb = getPreviewAgentDefinition("AGT-STATARB-001");
  const macro = getPreviewAgentDefinition("AGT-MACRO-001");
  const event = getPreviewAgentDefinition("AGT-EVENT-001");
  const now = new Date();
  const baseEvents: DashboardAgentAllocationContribution[] = [
    {
      id: "alloc-AGT-STATARB-001",
      cycleId: null,
      timestamp: new Date(now.getTime() - 18 * 60_000).toISOString(),
      targetAgentId: "AGT-STATARB-001",
      targetAgentName: statArb?.displayName ?? "Tim",
      previousAllocationUsd: 24_000,
      newAllocationUsd: 27_000,
      reasoning: "Raised Stat Arb slightly after overlap improved and event risk cooled.",
      inputs: {
        overlapScore: 0.42,
        sleeveSharpe: 1.9,
      },
    },
    {
      id: "alloc-AGT-MACRO-001",
      cycleId: null,
      timestamp: new Date(now.getTime() - 34 * 60_000).toISOString(),
      targetAgentId: "AGT-MACRO-001",
      targetAgentName: macro?.displayName ?? "David",
      previousAllocationUsd: 28_000,
      newAllocationUsd: 26_000,
      reasoning: "Trimmed Macro until the overnight tariff headline cycle is clearer.",
      inputs: {
        overlapScore: 0.67,
        overnightGapRisk: "elevated",
      },
    },
    {
      id: "alloc-AGT-EVENT-001",
      cycleId: null,
      timestamp: new Date(now.getTime() - 52 * 60_000).toISOString(),
      targetAgentId: "AGT-EVENT-001",
      targetAgentName: event?.displayName ?? "Kalla",
      previousAllocationUsd: 20_000,
      newAllocationUsd: 22_000,
      reasoning: "Reserved dry powder for catalyst-driven follow-through in META and DAL.",
      inputs: {
        catalystWindow: "next session",
        liquidityScore: 0.81,
      },
    },
  ];

  if (agentId === "AGT-CIO") {
    return baseEvents;
  }

  return baseEvents.filter((event) => event.targetAgentId === agentId);
}

function buildAgentDetailData(input: {
  agent: DashboardAgentRow;
  messages: DashboardDiscussionMessage[];
  trades: DashboardTradeRecord[];
  positions: DashboardPortfolioPosition[];
}) {
  const definition = getPreviewAgentDefinition(input.agent.id);
  const busMessages = input.messages
    .filter(
      (message) =>
        message.senderId === input.agent.id || message.recipientId === input.agent.id
    )
    .map((message) => ({
      id: message.id,
      cycleId: null,
      timestamp: message.timestamp,
      senderId: message.senderId,
      senderName: message.senderName,
      recipientId: message.recipientId,
      recipientName: message.recipientName,
      messageType: message.messageType,
      priority: message.priority,
      renderType: message.renderType,
      content: message.content,
      reasoning: message.reasoning,
      payload: message.payload,
      audience: formatAudience(message.recipientId, message.recipientName),
    } satisfies DashboardAgentBusMessageDetail));
  const recentTrades = input.trades.filter((trade) => trade.agentId === input.agent.id).slice(0, 20);
  const positions = input.positions
    .flatMap((position) =>
      position.owners
        .filter((owner) => owner.agentId === input.agent.id)
        .map((owner) => ({
          symbol: position.symbol,
          side: position.side,
          currentPrice: position.currentPrice,
          attributedQty: owner.attributedQty,
          attributedMarketValue: owner.attributedMarketValue,
          attributedUnrealizedPl: owner.attributedUnrealizedPl,
          lastOrderAt: owner.lastOrderAt,
        }))
    )
    .sort(
      (left, right) =>
        Math.abs(right.attributedMarketValue ?? 0) -
        Math.abs(left.attributedMarketValue ?? 0)
    );
  const researchTrace = buildResearchTrace(input.agent.id, input.messages);
  const decisionContributions = buildDecisionContributions(
    input.agent.id,
    recentTrades,
    input.messages
  );
  const allocationContributions = buildAllocationContributions(input.agent.id);

  return {
    agent: input.agent,
    objectiveFunction: definition?.objectiveFunction ?? null,
    subscriptions: definition?.subscriptions ?? [],
    directReports: definition?.directReports ?? [],
    constraints: definition?.constraints ?? {},
    config: definition?.config ?? {},
    recentMessages: buildAgentRecentMessages(input.agent.id, busMessages),
    busMessages,
    researchTrace,
    decisionContributions,
    allocationContributions,
    contributionSummary: {
      researchItemsProduced:
        input.agent.id === "AGT-RESEARCH"
          ? researchTrace.length
          : busMessages.filter((message) => message.senderId === input.agent.id).length,
      researchItemsConsumed:
        input.agent.id === "AGT-RESEARCH" ? 0 : researchTrace.length,
      decisionsLogged: decisionContributions.length,
      tradesRouted: recentTrades.length,
      allocationEvents: allocationContributions.length,
    },
    recentTrades,
    positions,
  } satisfies DashboardAgentDetailData;
}

function buildPreviewState(): PreviewState {
  const now = new Date();
  const nowIso = now.toISOString();
  const latestPortfolioValue = 148_580.79;
  const portfolioHistories = createPortfolioHistories(now, latestPortfolioValue);
  const oneDayHistory = portfolioHistories["1D"];
  const latestOneDayPoint = oneDayHistory.at(-1) ?? null;
  const firstOneDayPoint = oneDayHistory[0] ?? null;
  const portfolioValue = latestOneDayPoint?.portfolioValue ?? latestPortfolioValue;
  const dailyPnl =
    latestOneDayPoint && firstOneDayPoint
      ? Number((latestOneDayPoint.portfolioValue - firstOneDayPoint.portfolioValue).toFixed(2))
      : null;
  const dailyPnlPct =
    latestOneDayPoint && firstOneDayPoint && firstOneDayPoint.portfolioValue !== 0
      ? Number(
          (
            ((latestOneDayPoint.portfolioValue - firstOneDayPoint.portfolioValue) /
              firstOneDayPoint.portfolioValue) *
            100
          ).toFixed(2)
        )
      : null;

  const messages = createPreviewDiscussionMessages(now);
  const tradingData = buildPreviewTradingData(now, portfolioValue);
  const alerts = buildPreviewAlerts(
    now,
    new Map<string, string>(),
    { value: PREVIEW_TRADER_IDS.length }
  );
  const agents = createAgentRows({
    messages,
    agentExposure: tradingData.agentExposure,
    trades: tradingData.trades,
  });
  const summary: DashboardSummaryData = {
    portfolioValue: Number(portfolioValue.toFixed(2)),
    dailyPnl,
    dailyPnlPct,
    activeAgents: agents.filter((agent) => agent.status === "ACTIVE").length,
    totalAgents: agents.length,
    recentAlerts: alerts.length,
    criticalAlerts: alerts.filter((alert) => alert.severity === "critical").length,
    brokerConnected: true,
    latestAccountTimestamp: nowIso,
    recruitingPipelineCount: 2,
  };
  const activityFeed = buildPreviewActivityFeed({
    trades: tradingData.trades,
    alerts,
  });
  const recentlyActiveAgentIds = Array.from(
    new Set(
      messages
        .filter(
          (message) =>
            new Date(message.timestamp).getTime() >= now.getTime() - 30 * 60_000
        )
        .map((message) => message.senderId)
    )
  );
  const portfolioStatistics = buildPortfolioStatistics(portfolioValue);
  const overview: DashboardOverviewData = {
    summary,
    portfolioHistory: oneDayHistory,
    portfolioHistories,
    portfolioStatistics,
    portfolioPositions: tradingData.positions,
    activeAgentIds: agents
      .filter((agent) => agent.status === "ACTIVE")
      .map((agent) => agent.id),
    recentlyActiveAgentIds,
    activityFeed,
    runtimeNote:
      "Local preview mode is active. Layout and component styling reflect deterministic sample data while the live runtime stays disabled.",
    activePhaseLabel: "Local Preview",
  };
  const discussion: DashboardDiscussionData = {
    decisionRuntime: PREVIEW_DECISION_RUNTIME,
    messages,
    summary: {
      agentCount: agents.length,
      messageCount: messages.length,
      discussionCount: messages.filter((message) => message.messageType === "DISCUSSION").length,
      latestMessageAt: messages[0]?.timestamp ?? null,
    },
  };
  const portfolio: DashboardPortfolioData = {
    portfolioValue: summary.portfolioValue,
    positions: tradingData.positions,
    agentExposure: tradingData.agentExposure,
    recentTrades: tradingData.trades,
    latestAccountTimestamp: nowIso,
  };
  const risk: DashboardRiskData = {
    metrics: [
      {
        label: "Portfolio Value",
        value: summary.portfolioValue,
        display: formatCompactCurrency(summary.portfolioValue),
      },
      {
        label: "Gross Exposure",
        value: 161.5,
        display: "161.5%",
      },
      {
        label: "Net Exposure",
        value: 61.54,
        display: "61.54%",
      },
      {
        label: "Current Drawdown",
        value: -4.22,
        display: "-4.22%",
        tone: "negative",
      },
      {
        label: "Cash Buffer",
        value: -61.53,
        display: "-61.53%",
        tone: "negative",
      },
      {
        label: "Latest P&L",
        value: summary.dailyPnl,
        display: formatSignedCurrency(summary.dailyPnl),
        tone: isFiniteNumber(summary.dailyPnl)
          ? summary.dailyPnl >= 0
            ? "positive"
            : "negative"
          : "neutral",
      },
    ],
    limits: [
      { name: "Largest Position Share", current: 12.4, limit: 15, unit: "%" },
      { name: "Top 5 Concentration", current: 46.8, limit: 55, unit: "%" },
      { name: "Cash Buffer Share", current: -61.53, limit: 0, unit: "%" },
      { name: "Agent Attribution Coverage", current: 100, limit: 100, unit: "%" },
    ],
    alerts: alerts.slice(0, 8),
    notes: [
      "Local preview mode is active, so these research-quality metrics are illustrative rather than connected to live data.",
      "Use this mode for design and layout iteration without a live runtime or database connection.",
    ],
  };
  const contributors: DashboardContributorsData = {
    instrumented: false,
    message:
      "Contributor and payout ledgers are hidden in local preview mode to keep the portal focused on design iteration.",
    roster: [],
  };
  const allocationAgents = agents.filter((agent) => isFiniteNumber(agent.currentAllocationUsd));
  const allocatedCapitalUsd = allocationAgents.reduce(
    (sum, agent) => sum + (agent.currentAllocationUsd ?? 0),
    0
  );
  const cashReserveUsd = summary.portfolioValue
    ? Number((summary.portfolioValue - allocatedCapitalUsd).toFixed(2))
    : null;
  const allocation: DashboardAllocationData = {
    portfolioValue: summary.portfolioValue,
    allocatedCapitalUsd,
    cashReserveUsd,
    cashReservePct:
      summary.portfolioValue && summary.portfolioValue !== 0 && isFiniteNumber(cashReserveUsd)
        ? Number(((cashReserveUsd / summary.portfolioValue) * 100).toFixed(2))
        : null,
    agents: allocationAgents,
    recentChanges: buildAllocationContributions("AGT-CIO").map((event) => ({
      id: event.id,
      timestamp: event.timestamp,
      actorId: "AGT-CIO",
      actorName: "Jacob",
      targetAgentId: event.targetAgentId,
      targetAgentName: event.targetAgentName,
      content: `${event.targetAgentId} allocation updated.`,
      reasoning: event.reasoning,
      previousAllocationUsd: event.previousAllocationUsd,
      newAllocationUsd: event.newAllocationUsd,
    })),
    instrumented: true,
    message:
      "Allocation history is preview-only in local mode, but it keeps the CIO page and charts reviewable during design work.",
  };
  const providerDiagnostics = buildProviderDiagnostics(nowIso);
  const settings: DashboardSettingsData = {
    brokerConfigured: true,
    brokerConnected: true,
    brokerProvider: "Local Preview",
    decisionRuntime: PREVIEW_DECISION_RUNTIME,
    providerDiagnostics,
    runtimePhase: "Local Preview",
    runtimeNote:
      "Local preview mode bypasses AlloyDB, market-data sync, and runtime heartbeats so the customer portal can be styled safely on localhost.",
    activeAgentIds: overview.activeAgentIds,
    sleepingAgentIds: [],
    overrides: PREVIEW_OVERRIDES,
    agents,
  };
  const watchSymbols = Array.from(
    new Set([
      ...tradingData.positions.slice(0, 5).map((position) => position.symbol),
      ...tradingData.trades.slice(0, 5).map((trade) => trade.ticker),
      "SPY",
      "QQQ",
    ])
  ).slice(0, 6);
  const research: DashboardResearchData = {
    checkedAt: nowIso,
    watchSymbols,
    providerDiagnostics,
    feed: buildResearchFeed(now, watchSymbols),
  };
  const agentDetails = new Map<string, DashboardAgentDetailData>(
    agents.map((agent) => [
      agent.id,
      buildAgentDetailData({
        agent,
        messages,
        trades: tradingData.trades,
        positions: tradingData.positions,
      }),
    ])
  );

  return {
    nowIso,
    summary,
    overview,
    discussionMessages: messages,
    discussion,
    portfolio,
    trades: tradingData.trades,
    risk,
    contributors,
    agents,
    agentDetails,
    alerts,
    allocation,
    settings,
    research,
  };
}

function buildDecommissionedPreviewState(): PreviewState {
  const nowIso = new Date().toISOString();
  const summary: DashboardSummaryData = {
    portfolioValue: null,
    dailyPnl: null,
    dailyPnlPct: null,
    activeAgents: 0,
    totalAgents: 0,
    recentAlerts: 0,
    criticalAlerts: 0,
    brokerConnected: false,
    latestAccountTimestamp: null,
    recruitingPipelineCount: 0,
  };

  return {
    nowIso,
    summary,
    overview: {
      summary,
      portfolioHistory: [],
      portfolioHistories: {
        "1D": [],
        "1M": [],
        "1Y": [],
        MAX: [],
      },
      portfolioStatistics: [],
      portfolioPositions: [],
      activeAgentIds: [],
      recentlyActiveAgentIds: [],
      activityFeed: [],
      runtimeNote:
        "The legacy CIO, research, quant, execution, and agent orchestration stack has been fully decommissioned.",
      activePhaseLabel: "Decommissioned",
    },
    discussionMessages: [],
    discussion: {
      decisionRuntime: DECOMMISSIONED_DECISION_RUNTIME,
      messages: [],
      summary: {
        agentCount: 0,
        messageCount: 0,
        discussionCount: 0,
        latestMessageAt: null,
      },
    },
    portfolio: {
      portfolioValue: null,
      positions: [],
      agentExposure: [],
      recentTrades: [],
      latestAccountTimestamp: null,
    },
    trades: [],
    risk: {
      metrics: [],
      limits: [],
      alerts: [],
      notes: [
        "No legacy desk exposure is active because the CIO, research, quant, execution, and research sleeves are decommissioned.",
      ],
    },
    contributors: {
      instrumented: false,
      message:
        "No contributor attribution is running because the legacy agent marketplace preview stack is decommissioned.",
      roster: [],
    },
    agents: [],
    agentDetails: new Map(),
    alerts: [],
    allocation: {
      portfolioValue: null,
      allocatedCapitalUsd: null,
      cashReserveUsd: null,
      cashReservePct: null,
      agents: [],
      recentChanges: [],
      instrumented: false,
      message: "No active allocations. The legacy desk is fully decommissioned.",
    },
    settings: {
      brokerConfigured: false,
      brokerConnected: false,
      brokerProvider: "ALPACA_PAPER",
      decisionRuntime: DECOMMISSIONED_DECISION_RUNTIME,
      providerDiagnostics: [],
      runtimePhase: "Decommissioned",
      runtimeNote:
        "The legacy CIO, research, quant, execution, and agent orchestration stack has been fully decommissioned.",
      activeAgentIds: [],
      sleepingAgentIds: [],
      overrides: [],
      agents: [],
    },
    research: {
      checkedAt: nowIso,
      watchSymbols: [],
      providerDiagnostics: [],
      feed: [],
    },
  };
}

function getPreviewState() {
  if (!previewState) {
    previewState = isAgentSwarmDecommissioned()
      ? buildDecommissionedPreviewState()
      : buildPreviewState();
  }

  return previewState;
}

export function getLocalPreviewSummaryData() {
  return getPreviewState().summary;
}

export function getLocalPreviewDiscussionData(limit = 120): DashboardDiscussionData {
  const state = getPreviewState();
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(limit, 200)) : 120;

  return {
    ...state.discussion,
    messages: state.discussionMessages.slice(0, safeLimit),
    summary: {
      ...state.discussion.summary,
      messageCount: Math.min(state.discussion.summary.messageCount, safeLimit),
      discussionCount: state.discussionMessages
        .slice(0, safeLimit)
        .filter((message) => message.messageType === "DISCUSSION").length,
    },
  };
}

export function getLocalPreviewOverviewData() {
  return getPreviewState().overview;
}

export function getLocalPreviewPortfolioData() {
  return getPreviewState().portfolio;
}

export function getLocalPreviewTradesData(): DashboardTradesData {
  const state = getPreviewState();

  return {
    trades: state.trades,
    availableAgents: state.agents.map((agent) => ({
      id: agent.id,
      name: agent.displayName,
    })),
  };
}

export function getLocalPreviewAlertsData(): DashboardAlertsData {
  const state = getPreviewState();

  return {
    decisionRuntime: state.discussion.decisionRuntime,
    alerts: state.alerts,
  };
}

export function getLocalPreviewRiskData() {
  return getPreviewState().risk;
}

export function getLocalPreviewContributorsData() {
  return getPreviewState().contributors;
}

export function getLocalPreviewAgentsData() {
  return getPreviewState().agents;
}

export function getLocalPreviewAgentDetailData(agentId: string): DashboardAgentDetailData {
  return (
    getPreviewState().agentDetails.get(agentId) ?? {
      agent: null,
      objectiveFunction: null,
      subscriptions: [],
      directReports: [],
      constraints: {},
      config: {},
      recentMessages: [],
      busMessages: [],
      researchTrace: [],
      decisionContributions: [],
      allocationContributions: [],
      contributionSummary: {
        researchItemsProduced: 0,
        researchItemsConsumed: 0,
        decisionsLogged: 0,
        tradesRouted: 0,
        allocationEvents: 0,
      },
      recentTrades: [],
      positions: [],
    }
  );
}

export function getLocalPreviewAllocationData() {
  return getPreviewState().allocation;
}

export function getLocalPreviewSettingsData() {
  return getPreviewState().settings;
}

export function getLocalPreviewResearchData() {
  return getPreviewState().research;
}
