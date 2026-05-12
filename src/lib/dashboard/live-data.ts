import "server-only";

import { cache } from "react";
import type { QueryResultRow } from "pg";
import { isDevDashboardBypassEnabled } from "@/lib/auth/session";
import { isAgentSwarmDecommissioned } from "@/lib/agents/decommission";
import {
  getAgentFeedMessages,
  getAgentFeedSummary,
  getBrokerDashboardSnapshot as getPersistedBrokerDashboardSnapshot,
} from "@/lib/agents/repository";
import { getDecisionModelRuntimeStatus } from "@/lib/agents/model-json";
import { getDashboardFeedSnapshot } from "@/lib/agents/runtime";
import { getAlloyDbPool } from "@/lib/data/alloydb/client";
import {
  getLocalPreviewAgentDetailData,
  getLocalPreviewAgentsData,
  getLocalPreviewAlertsData,
  getLocalPreviewAllocationData,
  getLocalPreviewContributorsData,
  getLocalPreviewDiscussionData,
  getLocalPreviewOverviewData,
  getLocalPreviewPortfolioData,
  getLocalPreviewResearchData,
  getLocalPreviewRiskData,
  getLocalPreviewSettingsData,
  getLocalPreviewSummaryData,
  getLocalPreviewTradesData,
} from "@/lib/dashboard/local-preview";
import {
  getDashboardQuantLabCommitDetailDataInternal,
  getDashboardQuantLabDataInternal,
} from "@/lib/dashboard/quant-lab";
import {
  getMassiveResearchPacket,
  isMassiveConfigured,
} from "@/lib/research/massive";
import {
  getKalshiResearchPacket,
  isKalshiConfigured,
} from "@/lib/research/kalshi";
import {
  getNewsApiResearchPacket,
  isNewsApiConfigured,
} from "@/lib/research/newsapi";
import {
  getPolymarketResearchPacket,
  isPolymarketConfigured,
} from "@/lib/research/polymarket";
import {
  getSecEarningsPacket,
  isSecUserAgentConfigured,
} from "@/lib/research/sec-edgar";
import {
  getAlpacaPortfolioHistory,
  getAlpacaStockBars,
  isAlpacaPaperTradingConfigured,
} from "@/lib/trading/alpaca";
import { getRecruitingPipelineCount } from "@/lib/hr-agent/repository";
import type {
  DashboardActivityEvent,
  DashboardAgentDetailData,
  DashboardAgentAllocationContribution,
  DashboardAgentBusMessageDetail,
  DashboardAgentDecisionContribution,
  DashboardAgentRow,
  DashboardAgentResearchTrace,
  DashboardAlertRecord,
  DashboardAlertsData,
  DashboardAllocationData,
  DashboardAllocationEvent,
  DashboardContributorsData,
  DashboardDecisionRuntimeDiagnostic,
  DashboardDiscussionData,
  DashboardOverviewData,
  DashboardPortfolioHistoryPoint,
  DashboardPortfolioHistoryRange,
  DashboardPortfolioStatistic,
  DashboardPortfolioData,
  DashboardPortfolioPosition,
  DashboardProviderDiagnostic,
  DashboardQuantLabCommitDetailData,
  DashboardQuantLabData,
  DashboardResearchData,
  DashboardResearchFeedItem,
  DashboardRiskData,
  DashboardSettingsData,
  DashboardSummaryData,
  DashboardTradeRecord,
  DashboardTradesData,
} from "@/lib/dashboard/types";

type AccountHistoryRow = QueryResultRow & {
  captured_at: Date;
  cash: string | null;
  equity: string | null;
  id: number | string;
  portfolio_value: string | null;
};

type AgentRosterRow = QueryResultRow & {
  created_at: Date | null;
  current_allocation_usd: string | null;
  direct_reports: unknown;
  display_name: string;
  id: string;
  last_message_at: Date | null;
  last_order_at: Date | null;
  max_allocation_usd: string | null;
  objective_function: string | null;
  paper_enabled: boolean;
  recent_message_count: string;
  recent_order_count: string;
  reports_to: string | null;
  role: string;
  status: string;
  strategy_category: string | null;
  subscriptions: unknown;
  tier: number;
  updated_at: Date | null;
};

// These legacy office-staff rows still exist in the registry but are not part of the current desk.
const HIDDEN_LEGACY_AGENT_IDS = new Set(["AGT-COO", "AGT-CRO", "AGT-ATTRIB"]);

type TradeRow = QueryResultRow & {
  agent_id: string | null;
  agent_name: string | null;
  broker_order_id: string;
  filled_avg_price: string | null;
  notional: string | null;
  qty: string | null;
  status: string;
  strategy_category: string | null;
  submitted_at: Date | null;
  submitted_reasoning: string | null;
  symbol: string;
  updated_at: Date | null;
  side: string;
  request_payload: unknown;
};

type AlertRow = QueryResultRow & {
  created_at: Date;
  display_name: string;
  id: string;
  message_type: string;
  priority: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  content: string;
  sender_id: string;
};

type AlertCountRow = QueryResultRow & {
  critical_alerts: string;
  recent_alerts: string;
};

type RecentActivityMessageRow = QueryResultRow & {
  content: string;
  created_at: Date;
  id: string;
  message_type: string;
  priority: string;
  sender_id: string;
  sender_name: string | null;
};

type RecentActivityDecisionRow = QueryResultRow & {
  id: string;
  created_at: Date;
  agent_id: string;
  action_taken: string;
  related_message_payload: unknown;
};

function getDashboardDecisionRuntimeDiagnostic(): DashboardDecisionRuntimeDiagnostic {
  const status = getDecisionModelRuntimeStatus();

  return {
    configured: status.configured,
    providerLabel: status.providerLabel,
    modelLabel: status.modelLabel,
    statusDetail: status.statusDetail,
  };
}

type OverrideRow = QueryResultRow & {
  action_taken: string;
  created_at: Date;
  id: string;
  operator_directive: string;
  recommendation: string | null;
};

type AllocationEventRow = QueryResultRow & {
  cycle_id?: string | number | null;
  created_at: Date;
  id: string;
  inputs?: unknown;
  new_allocation_usd: string | null;
  previous_allocation_usd: string | null;
  rationale: string;
  target_agent_id: string;
  target_agent_name: string;
};

type PositionEntryRow = QueryResultRow & {
  avg_entry_price: string | null;
  current_price: string | null;
  market_value: string | null;
  qty: string | null;
  side: string | null;
  symbol: string;
  unrealized_pl: string | null;
};

type AgentMessageDetailRow = QueryResultRow & {
  id: string;
  cycle_id: string | number | null;
  created_at: Date;
  sender_id: string;
  sender_name: string | null;
  recipient_id: string | null;
  recipient_name: string | null;
  message_type: string;
  priority: string;
  render_type: string;
  content: string;
  reasoning: string;
  payload: unknown;
};

type AgentDecisionContributionRow = QueryResultRow & {
  id: string;
  cycle_id: string | number | null;
  created_at: Date;
  action_taken: string;
  reasoning: string;
  data_consumed: unknown;
  confidence_score: number;
  related_message_id: string | null;
  related_message_type: string | null;
  related_message_content: string | null;
  related_message_payload: unknown;
};

type ResearchDownstreamRow = QueryResultRow & {
  research_message_id: string;
  id: string;
  created_at: Date;
  sender_id: string;
  sender_name: string | null;
  message_type: string;
  content: string;
};

type DashboardFeedSnapshot = Awaited<ReturnType<typeof getDashboardFeedSnapshot>>;
type DashboardBrokerSnapshot = Awaited<
  ReturnType<typeof getPersistedBrokerDashboardSnapshot>
>;
type DashboardAccountHistoryPoint = {
  id: number;
  capturedAt: string;
  equity: number | null;
  cash: number | null;
  portfolioValue: number | null;
};

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

function toIso(value: Date | null) {
  return value ? value.toISOString() : null;
}

function toArray(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

function toRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toNullableNumber(value: unknown) {
  const parsed = parseNumeric(value);
  return typeof parsed === "number" ? parsed : null;
}

function toCycleId(value: unknown) {
  const parsed = parseNumeric(value);
  return typeof parsed === "number" ? parsed : null;
}

function formatAudience(recipientId: string | null, recipientName: string | null) {
  if (recipientId) {
    return recipientName ? `${recipientName} (${recipientId})` : recipientId;
  }

  return "Shared blackboard";
}

function extractRiskGateReason(payload: Record<string, unknown>) {
  const riskGate = toRecord(payload.riskGate);
  const reason = riskGate.reason;

  return typeof reason === "string" ? reason : null;
}

function extractRiskGateInputs(payload: Record<string, unknown>) {
  const riskGate = toRecord(payload.riskGate);
  const dataConsumed = riskGate.dataConsumed;

  return Array.isArray(dataConsumed) ? dataConsumed.map((item) => String(item)) : [];
}

function formatPtTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function formatActivityCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function getEtDateKey(value: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function formatMessageAsActivityType(
  messageType: string,
  priority?: string
): "trade" | "allocation" | "alert" | "research" | "status" {
  if (messageType === "TRADE_ORDER" || messageType === "POSITION_DECLARATION") {
    return "trade";
  }

  if (messageType === "ALLOCATION_CHANGE") {
    return "allocation";
  }

  if (messageType === "RESEARCH_REPORT" || messageType === "SIGNAL") {
    return "research";
  }

  if (messageType === "RISK_ALERT" || priority === "CRITICAL") {
    return "alert";
  }

  return "status";
}

function truncateActivitySummary(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }

  const slice = value.slice(0, maxLength - 1);
  const lastSpace = slice.lastIndexOf(" ");
  const safeSlice = lastSpace >= Math.floor(maxLength * 0.6) ? slice.slice(0, lastSpace) : slice;

  return `${safeSlice.trimEnd()}…`;
}

function humanizeActionFragment(value: string) {
  return value
    .split("_")
    .filter(Boolean)
    .map((part, index) => {
      if (part.toUpperCase() === part && part.length <= 5) {
        return part;
      }

      const lower = part.toLowerCase();
      return index === 0 ? lower : `${lower.charAt(0).toUpperCase()}${lower.slice(1)}`;
    })
    .join(" ");
}

function formatDecisionAsActivityType(
  actionTaken: string
): "trade" | "allocation" | "alert" | "research" | "status" {
  if (
    actionTaken === "publish_research_event" ||
    actionTaken === "declare_research_event"
  ) {
    return "research";
  }

  if (actionTaken === "set_target_allocation") {
    return "allocation";
  }

  if (
    actionTaken.includes("failure") ||
    actionTaken.includes("degradation") ||
    actionTaken.includes("alert") ||
    actionTaken.includes("gap")
  ) {
    return "alert";
  }

  if (
    actionTaken.includes("research") ||
    actionTaken.includes("findings") ||
    actionTaken.includes("briefing") ||
    actionTaken.includes("synthesis") ||
    actionTaken.includes("regime") ||
    actionTaken.includes("macro") ||
    actionTaken.includes("sentiment") ||
    actionTaken.includes("catalyst")
  ) {
    return "research";
  }

  return "status";
}

function formatDecisionAsActivityDescription(input: {
  actionTaken: string;
  payload: Record<string, unknown>;
}) {
  const { actionTaken, payload } = input;
  const symbol = typeof payload.symbol === "string" ? payload.symbol : null;
  const targetAgentId = typeof payload.agentId === "string" ? payload.agentId : null;
  const newAllocationUsd =
    typeof payload.newAllocationUsd === "number"
      ? payload.newAllocationUsd
      : typeof payload.newAllocationUsd === "string"
        ? Number(payload.newAllocationUsd)
        : null;
  const notional =
    typeof payload.notional === "number"
      ? payload.notional
      : typeof payload.notional === "string"
        ? Number(payload.notional)
        : null;

  switch (actionTaken) {
    case "set_target_allocation":
      if (targetAgentId && typeof newAllocationUsd === "number" && Number.isFinite(newAllocationUsd)) {
        return `Set ${targetAgentId} target allocation to ${formatActivityCurrency(newAllocationUsd)}.`;
      }
      return "Updated sleeve target allocation.";
    case "publish_research_event": {
      if (symbol && typeof notional === "number" && Number.isFinite(notional)) {
        return `Published ${symbol} research event with ${formatActivityCurrency(notional)} of evidence weight.`;
      }
      if (symbol) {
        return `Published ${symbol} research event.`;
      }
      return "Published a research event.";
    }
    case "declare_research_event":
      return symbol ? `Declared live research context for ${symbol}.` : "Declared live research context.";
    case "publish_decisioning_degradation_notice":
      return "Flagged decisioning degradation and switched the desk into watch mode.";
    case "record_cycle_runtime_failure":
      return "Recorded a cycle runtime failure before the desk completed its pass.";
    case "record_publication_pipeline_failure":
      return "Recorded a research workflow failure during publication routing.";
    case "capture_market_data_sync_failure":
      return "Logged a market-data sync failure before decisioning.";
    case "publish_degraded_dependency_status":
      return "Published degraded dependency status for the current research pass.";
    default:
      break;
  }

  if (actionTaken.startsWith("publish_")) {
    return `Published ${humanizeActionFragment(actionTaken.slice("publish_".length))}.`;
  }

  if (actionTaken.startsWith("share_")) {
    return `Published ${humanizeActionFragment(actionTaken.slice("share_".length))}.`;
  }

  if (actionTaken.startsWith("broadcast_")) {
    return `Broadcast ${humanizeActionFragment(actionTaken.slice("broadcast_".length))}.`;
  }

  if (actionTaken.startsWith("refresh_")) {
    return `Refreshed ${humanizeActionFragment(actionTaken.slice("refresh_".length))}.`;
  }

  if (actionTaken.startsWith("prepare_")) {
    return `Prepared ${humanizeActionFragment(actionTaken.slice("prepare_".length))}.`;
  }

  if (actionTaken.startsWith("queue_")) {
    return `Queued ${humanizeActionFragment(actionTaken.slice("queue_".length))}.`;
  }

  if (actionTaken.startsWith("curate_")) {
    return `Curated ${humanizeActionFragment(actionTaken.slice("curate_".length))}.`;
  }

  if (actionTaken.startsWith("begin_")) {
    return `Started ${humanizeActionFragment(actionTaken.slice("begin_".length))}.`;
  }

  if (actionTaken.startsWith("complete_")) {
    return `Completed ${humanizeActionFragment(actionTaken.slice("complete_".length))}.`;
  }

  if (actionTaken.startsWith("reweight_")) {
    return `Reweighted ${humanizeActionFragment(actionTaken.slice("reweight_".length))}.`;
  }

  return truncateActivitySummary(
    `${humanizeActionFragment(actionTaken).replace(/^./, (char) => char.toUpperCase())}.`,
    160
  );
}

function buildOverviewActivityFeed(
  decisions: Array<{
    id: string;
    timestamp: string;
    agentId: string;
    actionTaken: string;
    payload: Record<string, unknown>;
  }>
): DashboardActivityEvent[] {
  return decisions.map((decision) => ({
    id: decision.id,
    timestamp: decision.timestamp,
    agentId: decision.agentId,
    agentName: null,
    type: formatDecisionAsActivityType(decision.actionTaken),
    description: formatDecisionAsActivityDescription({
      actionTaken: decision.actionTaken,
      payload: decision.payload,
    }),
  }));
}

function collectRecentlyActiveAgentIds(
  messages: Array<{
    timestamp: string;
    senderId: string;
  }>,
  now = new Date(),
  windowMs = 30 * 60 * 1000
) {
  const threshold = now.getTime() - windowMs;

  return Array.from(
    new Set(
      messages
        .filter((message) => {
          const timestamp = new Date(message.timestamp).getTime();
          return Number.isFinite(timestamp) && timestamp >= threshold;
        })
        .map((message) => message.senderId)
    )
  );
}

function extractDiscussionThreadId(payload: Record<string, unknown>) {
  const threadId = payload.threadId ?? payload.discussionThread;

  return typeof threadId === "string" ? threadId : null;
}

function extractInfluenceSummary(payload: Record<string, unknown>) {
  const influence = payload.decisionInfluence;

  if (typeof influence === "string" && influence.trim().length > 0) {
    return influence;
  }

  const influences = payload.influences;

  if (!Array.isArray(influences)) {
    return null;
  }

  const labels = influences
    .map((item) => {
      const record = toRecord(item);
      const targetAgentId = record.targetAgentId;
      const effect = record.effect ?? record.adjustment ?? record.decisionArea;

      if (typeof targetAgentId !== "string" || typeof effect !== "string") {
        return null;
      }

      return `${targetAgentId}: ${effect}`;
    })
    .filter((label): label is string => Boolean(label));

  return labels.length > 0 ? labels.join(" · ") : null;
}

function mapAlertSeverity(
  priority: AlertRow["priority"]
): DashboardAlertRecord["severity"] {
  if (priority === "CRITICAL") {
    return "critical";
  }

  if (priority === "HIGH") {
    return "warning";
  }

  return "info";
}

function mapAgentRow(row: AgentRosterRow): DashboardAgentRow {
  return {
    id: row.id,
    displayName: row.display_name,
    role: row.role,
    tier: row.tier,
    status: row.status,
    activatedAt: toIso(row.created_at),
    terminatedAt: row.status === "OFFLINE" ? toIso(row.updated_at) : null,
    strategyCategory: row.strategy_category,
    reportsTo: row.reports_to,
    currentAllocationUsd: parseNumeric(row.current_allocation_usd),
    maxAllocationUsd: parseNumeric(row.max_allocation_usd),
    attributedMarketValue: null,
    attributedUnrealizedPl: null,
    positionCount: 0,
    recentMessageCount: Number(row.recent_message_count ?? 0),
    recentOrderCount: Number(row.recent_order_count ?? 0),
    lastMessageAt: toIso(row.last_message_at),
    lastOrderAt: toIso(row.last_order_at),
  };
}

function isHiddenLegacyAgent(agentId: string) {
  return HIDDEN_LEGACY_AGENT_IDS.has(agentId);
}

function createEmptyDashboardAgentDetailData(): DashboardAgentDetailData {
  return {
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
  };
}

async function queryRecentActivityMessageRows(pool: ReturnType<typeof getAlloyDbPool>) {
  return pool.query<RecentActivityMessageRow>(
    `
      with latest_sender_messages as (
        select distinct on (m.sender_id)
          m.id::text as id,
          m.created_at,
          m.sender_id,
          sender.display_name as sender_name,
          m.message_type,
          m.priority,
          m.content
        from agent_messages m
        join agents sender on sender.id = m.sender_id
        left join agents recipient on recipient.id = m.recipient_id
        where sender.paper_enabled = true
          and sender.status in ('ACTIVE', 'PAPER')
          and (
            m.recipient_id is null
            or (
              recipient.paper_enabled = true
              and recipient.status in ('ACTIVE', 'PAPER')
            )
          )
        order by m.sender_id asc, m.created_at desc, m.id desc
      )
      select
        id,
        created_at,
        sender_id,
        sender_name,
        message_type,
        priority,
        content
      from latest_sender_messages
      order by created_at desc, id desc
      limit 12
    `
  );
}

async function queryRecentActivityDecisionRows(pool: ReturnType<typeof getAlloyDbPool>) {
  return pool.query<RecentActivityDecisionRow>(
    `
      with latest_agent_actions as (
        select distinct on (d.agent_id)
          d.id::text as id,
          d.created_at,
          d.agent_id,
          d.action_taken,
          m.payload as related_message_payload
        from agent_decisions d
        join agents actor on actor.id = d.agent_id
        left join agent_messages m on m.id = d.related_message_id
        where actor.paper_enabled = true
          and actor.status in ('ACTIVE', 'PAPER')
          and d.action_taken <> 'publish_autonomous_discussion_message'
        order by d.agent_id asc, d.created_at desc, d.id desc
      )
      select
        id,
        created_at,
        agent_id,
        action_taken,
        related_message_payload
      from latest_agent_actions
      order by created_at desc, id desc
      limit 12
    `
  );
}

async function queryAgentRosterRows(pool: ReturnType<typeof getAlloyDbPool>) {
  if (isAgentSwarmDecommissioned()) {
    return { rows: [] as AgentRosterRow[] };
  }

  return pool.query<AgentRosterRow>(
    `
      select
        a.id,
        a.display_name,
        a.role,
        a.tier,
        a.created_at,
        a.updated_at,
        a.reports_to,
        a.strategy_category,
        a.status,
        a.paper_enabled,
        a.current_allocation_usd,
        a.max_allocation_usd,
        c.objective_function,
        c.subscriptions,
        c.direct_reports,
        (
          select count(*)::text
          from agent_messages m
          where m.sender_id = a.id
            and m.created_at >= now() - interval '7 days'
        ) as recent_message_count,
        (
          select max(m.created_at)
          from agent_messages m
          where m.sender_id = a.id
        ) as last_message_at,
        (
          select count(*)::text
          from alpaca_orders o
          where o.agent_id = a.id
        ) as recent_order_count,
        (
          select max(coalesce(o.updated_at, o.submitted_at))
          from alpaca_orders o
          where o.agent_id = a.id
        ) as last_order_at
      from agents a
      left join agent_configs c on c.agent_id = a.id
      order by
        case when a.status = 'OFFLINE' then 1 else 0 end asc,
        a.tier asc,
        a.id asc
    `
  );
}

async function queryAccountHistoryRows(pool: ReturnType<typeof getAlloyDbPool>) {
  return pool.query<AccountHistoryRow>(
    `
      with latest_account as (
        select account_id
        from alpaca_account_snapshots
        order by captured_at desc, id desc
        limit 1
      )
      select
        id,
        equity,
        cash,
        portfolio_value,
        captured_at
      from alpaca_account_snapshots
      where account_id = (select account_id from latest_account)
      order by captured_at desc, id desc
      limit 240
    `
  );
}

async function queryTradeRows(pool: ReturnType<typeof getAlloyDbPool>) {
  return pool.query<TradeRow>(
    `
      select
        o.broker_order_id,
        o.agent_id,
        a.display_name as agent_name,
        a.strategy_category,
        o.symbol,
        o.side,
        o.status,
        o.qty,
        o.notional,
        o.filled_avg_price,
        o.submitted_reasoning,
        o.request_payload,
        o.submitted_at,
        o.updated_at
      from alpaca_orders o
      left join agents a on a.id = o.agent_id
      order by coalesce(o.updated_at, o.submitted_at) desc nulls last, o.broker_order_id desc
      limit 100
    `
  );
}

async function queryAlertRows(pool: ReturnType<typeof getAlloyDbPool>) {
  return pool.query<AlertRow>(
    `
      select
        m.id::text as id,
        m.created_at,
        m.message_type,
        m.priority,
        m.content,
        m.sender_id,
        sender.display_name
      from agent_messages m
      join agents sender on sender.id = m.sender_id
      where sender.paper_enabled = true
        and (
          m.render_type = 'alert'
          or m.message_type = 'RISK_ALERT'
          or m.priority = 'CRITICAL'
        )
      order by m.created_at desc, m.id desc
      limit 50
    `
  );
}

async function queryAlertCounts(pool: ReturnType<typeof getAlloyDbPool>) {
  return pool.query<AlertCountRow>(
    `
      select
        count(*)::text as recent_alerts,
        count(*) filter (where m.priority = 'CRITICAL')::text as critical_alerts
      from agent_messages m
      join agents sender on sender.id = m.sender_id
      where sender.paper_enabled = true
        and (
          m.render_type = 'alert'
          or m.message_type = 'RISK_ALERT'
          or m.priority = 'CRITICAL'
        )
    `
  );
}

async function queryAllocationRows(pool: ReturnType<typeof getAlloyDbPool>) {
  return pool.query<AllocationEventRow>(
    `
      select
        e.id::text as id,
        e.cycle_id,
        e.created_at,
        e.previous_allocation_usd,
        e.new_allocation_usd,
        e.rationale,
        e.inputs,
        e.agent_id as target_agent_id,
        target.display_name as target_agent_name
      from agent_allocation_events e
      join agents target on target.id = e.agent_id
      order by e.created_at desc, e.id desc
      limit 30
    `
  );
}

async function queryOverrideRows(pool: ReturnType<typeof getAlloyDbPool>) {
  return pool.query<OverrideRow>(
    `
      select
        id::text as id,
        operator_directive,
        recommendation,
        action_taken,
        created_at
      from operator_overrides
      order by created_at desc
      limit 20
    `
  );
}

async function queryPositionEntryRows(pool: ReturnType<typeof getAlloyDbPool>) {
  return pool.query<PositionEntryRow>(
    `
      with latest_account as (
        select id
        from alpaca_account_snapshots
        order by captured_at desc, id desc
        limit 1
      )
      select
        symbol,
        side,
        qty,
        avg_entry_price,
        market_value,
        unrealized_pl,
        current_price
      from alpaca_position_snapshots
      where account_snapshot_id = (select id from latest_account)
      order by abs(coalesce(market_value, 0)) desc, symbol asc
    `
  );
}

function mapDashboardAgentRows(
  rows: AgentRosterRow[],
  broker: Awaited<ReturnType<typeof getPersistedBrokerDashboardSnapshot>>
) {
  const exposureByAgent = new Map(
    broker.agentExposure.map((exposure) => [exposure.agentId, exposure])
  );

  return rows
    .filter((row) => !isHiddenLegacyAgent(row.id))
    .map((row) => {
      const exposure = exposureByAgent.get(row.id);

      return {
        ...mapAgentRow(row),
        attributedMarketValue: exposure?.attributedMarketValue ?? null,
        attributedUnrealizedPl: exposure?.attributedUnrealizedPl ?? null,
        positionCount: exposure?.positionCount ?? 0,
      };
    });
}

function mapAccountHistoryRows(rows: AccountHistoryRow[]): DashboardAccountHistoryPoint[] {
  return [...rows]
    .reverse()
    .map((row) => ({
      id: Number(row.id),
      capturedAt: row.captured_at.toISOString(),
      equity: parseNumeric(row.equity),
      cash: parseNumeric(row.cash),
      portfolioValue: parseNumeric(row.portfolio_value),
    }));
}

function mapTradeRows(rows: TradeRow[]): DashboardTradeRecord[] {
  return rows.map((row) => {
    const requestPayload = toRecord(row.request_payload);

    return {
      id: row.broker_order_id,
      timestamp: toIso(row.updated_at ?? row.submitted_at),
      agentId: row.agent_id,
      agentName: row.agent_name,
      ticker: row.symbol,
      action: row.side.toUpperCase() === "SELL" ? "SELL" : "BUY",
      qty: parseNumeric(row.qty),
      price: parseNumeric(row.filled_avg_price),
      notional: parseNumeric(row.notional),
      confidence: null,
      status: row.status,
      reasoning: row.submitted_reasoning ?? "No submission reasoning was logged for this order.",
      strategyLabel: row.strategy_category,
      requestPayload,
      riskGateReason: extractRiskGateReason(requestPayload),
      riskGateInputs: extractRiskGateInputs(requestPayload),
    };
  });
}

function mapAlertRows(rows: AlertRow[]): DashboardAlertRecord[] {
  return rows.map((row) => ({
    id: row.id,
    timestamp: row.created_at.toISOString(),
    severity: mapAlertSeverity(row.priority),
    source: row.sender_id,
    description: row.content,
    status: "new",
    messageType: row.message_type,
  }));
}

function mapAllocationRows(rows: AllocationEventRow[]): DashboardAllocationEvent[] {
  return rows.map((row) => ({
    id: row.id,
    timestamp: row.created_at.toISOString(),
    actorId: "AGT-CIO",
    actorName: "CIO",
    targetAgentId: row.target_agent_id,
    targetAgentName: row.target_agent_name,
    content:
      typeof parseNumeric(row.new_allocation_usd) === "number"
        ? `Set ${row.target_agent_id} target allocation to ${new Intl.NumberFormat("en-US", {
            style: "currency",
            currency: "USD",
            maximumFractionDigits: 0,
          }).format(parseNumeric(row.new_allocation_usd) ?? 0)}.`
        : `Updated ${row.target_agent_id} target allocation.`,
    reasoning: row.rationale,
    previousAllocationUsd: parseNumeric(row.previous_allocation_usd),
    newAllocationUsd: parseNumeric(row.new_allocation_usd),
  }));
}

function mapOverrideRows(rows: OverrideRow[]) {
  return rows.map((row) => ({
    id: row.id,
    createdAt: row.created_at.toISOString(),
    actionTaken: row.action_taken,
    operatorDirective: row.operator_directive,
    recommendation: row.recommendation,
  }));
}

function mapPositionEntryBySymbol(rows: PositionEntryRow[]) {
  return new Map(
    rows.map((row) => [
      row.symbol,
      {
        avgEntryPrice: parseNumeric(row.avg_entry_price),
        currentPrice: parseNumeric(row.current_price),
      },
    ])
  );
}

const getCachedDashboardFeedSnapshot = cache(async () => getDashboardFeedSnapshot());

const getCachedDashboardBrokerSnapshot = cache(async () =>
  getPersistedBrokerDashboardSnapshot()
);

async function loadDashboardFeedSnapshot(fresh = false): Promise<DashboardFeedSnapshot> {
  return fresh ? getDashboardFeedSnapshot() : getCachedDashboardFeedSnapshot();
}

async function loadDashboardBrokerSnapshot(fresh = false): Promise<DashboardBrokerSnapshot> {
  return fresh
    ? getPersistedBrokerDashboardSnapshot()
    : getCachedDashboardBrokerSnapshot();
}

async function buildBaseDashboardContext(options?: { refreshFeedSnapshot?: boolean }) {
  const pool = getAlloyDbPool();

  const [
    feedSnapshot,
    recentActivityRowsResult,
    recentActivityDecisionRowsResult,
    agentRowsResult,
    accountHistoryResult,
    tradeRowsResult,
    alertRowsResult,
    allocationRowsResult,
    overrideRowsResult,
    latestPositionsResult,
  ] =
    await Promise.all([
      loadDashboardFeedSnapshot(options?.refreshFeedSnapshot ?? false),
      queryRecentActivityMessageRows(pool),
      queryRecentActivityDecisionRows(pool),
      queryAgentRosterRows(pool),
      queryAccountHistoryRows(pool),
      queryTradeRows(pool),
      queryAlertRows(pool),
      queryAllocationRows(pool),
      queryOverrideRows(pool),
      queryPositionEntryRows(pool),
    ]);

  const broker = feedSnapshot.broker;
  const agents = mapDashboardAgentRows(agentRowsResult.rows, broker);
  const accountHistory = mapAccountHistoryRows(accountHistoryResult.rows);
  const alerts = mapAlertRows(alertRowsResult.rows);
  const trades = mapTradeRows(tradeRowsResult.rows);
  const allocationEvents = mapAllocationRows(allocationRowsResult.rows);
  const overrides = mapOverrideRows(overrideRowsResult.rows);
  const positionEntryBySymbol = mapPositionEntryBySymbol(latestPositionsResult.rows);

  return {
    feedSnapshot,
    recentActivityMessages: recentActivityRowsResult.rows.map((row) => ({
      id: row.id,
      timestamp: row.created_at.toISOString(),
      senderId: row.sender_id,
      senderName: row.sender_name,
      messageType: row.message_type,
      priority: row.priority,
      content: row.content,
    })),
    recentActivityDecisions: recentActivityDecisionRowsResult.rows.map((row) => ({
      id: row.id,
      timestamp: row.created_at.toISOString(),
      agentId: row.agent_id,
      actionTaken: row.action_taken,
      payload: toRecord(row.related_message_payload),
    })),
    agents,
    accountHistory,
    broker,
    alerts,
    trades,
    allocationEvents,
    overrides,
    positionEntryBySymbol,
  };
}

const getBaseDashboardContext = cache(buildBaseDashboardContext);

async function loadBaseDashboardContext(fresh = false) {
  return fresh
    ? buildBaseDashboardContext({ refreshFeedSnapshot: true })
    : getBaseDashboardContext();
}

function computeDailyPnl(accountHistory: DashboardAccountHistoryPoint[]) {
  const latest = accountHistory.at(-1);

  if (!latest || typeof latest.portfolioValue !== "number") {
    return {
      dailyPnl: null,
      dailyPnlPct: null,
    };
  }

  const latestDateKey = getEtDateKey(latest.capturedAt);
  const sameDayHistory = accountHistory.filter(
    (point) =>
      point.portfolioValue !== null && getEtDateKey(point.capturedAt) === latestDateKey
  );
  const baseline = sameDayHistory[0];

  if (!baseline || typeof baseline.portfolioValue !== "number") {
    return {
      dailyPnl: null,
      dailyPnlPct: null,
    };
  }

  const dailyPnl = latest.portfolioValue - baseline.portfolioValue;
  const dailyPnlPct =
    baseline.portfolioValue !== 0 ? (dailyPnl / baseline.portfolioValue) * 100 : null;

  return {
    dailyPnl,
    dailyPnlPct,
  };
}

function buildDashboardSummary(input: {
  feedSnapshot: DashboardFeedSnapshot;
  accountHistory: DashboardAccountHistoryPoint[];
  recentAlerts: number;
  criticalAlerts: number;
  recruitingPipelineCount: number;
}): DashboardSummaryData {
  const { feedSnapshot, accountHistory, recentAlerts, criticalAlerts, recruitingPipelineCount } =
    input;
  const latestPoint = accountHistory.at(-1);
  const { dailyPnl, dailyPnlPct } = computeDailyPnl(accountHistory);
  const broker = feedSnapshot.broker;

  return {
    portfolioValue: broker.account?.portfolioValue ?? latestPoint?.portfolioValue ?? null,
    dailyPnl,
    dailyPnlPct,
    activeAgents: feedSnapshot.runtime.session.activeAgentIds.length,
    totalAgents: feedSnapshot.summary.agentCount,
    recentAlerts,
    criticalAlerts,
    brokerConnected: broker.connected,
    latestAccountTimestamp: broker.account?.lastSyncedAt ?? null,
    recruitingPipelineCount,
  };
}

function buildDecommissionedDashboardSummaryData(
  recruitingPipelineCount: number
): DashboardSummaryData {
  return {
    portfolioValue: null,
    dailyPnl: null,
    dailyPnlPct: null,
    activeAgents: 0,
    totalAgents: 0,
    recentAlerts: 0,
    criticalAlerts: 0,
    brokerConnected: false,
    latestAccountTimestamp: null,
    recruitingPipelineCount,
  };
}

const PORTFOLIO_HISTORY_RANGES: DashboardPortfolioHistoryRange[] = [
  "1D",
  "1M",
  "1Y",
  "MAX",
];

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

function formatHistoryPointLabel(value: string, range: DashboardPortfolioHistoryRange) {
  if (range === "1D") {
    return formatPtTime(value);
  }

  if (range === "MAX") {
    return formatPtMonth(value);
  }

  return formatPtDay(value);
}

function getRangeStartDate(range: DashboardPortfolioHistoryRange, latestDate: Date) {
  const startDate = new Date(latestDate);

  if (range === "1M") {
    startDate.setMonth(startDate.getMonth() - 1);
    return startDate;
  }

  if (range === "1Y") {
    startDate.setFullYear(startDate.getFullYear() - 1);
    return startDate;
  }

  return null;
}

function buildSnapshotPortfolioHistory(
  accountHistory: Array<{ capturedAt: string; portfolioValue: number | null }>,
  range: DashboardPortfolioHistoryRange
): DashboardPortfolioHistoryPoint[] {
  const latestDateKey = accountHistory.length
    ? getEtDateKey(accountHistory.at(-1)!.capturedAt)
    : null;
  const latestDate = accountHistory.length
    ? new Date(accountHistory.at(-1)!.capturedAt)
    : new Date();
  const rangeStartDate = getRangeStartDate(range, latestDate);
  const rangeSeries =
    range === "1D" && latestDateKey
      ? accountHistory.filter((point) => getEtDateKey(point.capturedAt) === latestDateKey)
      : accountHistory.filter((point) => {
          return !rangeStartDate || new Date(point.capturedAt) >= rangeStartDate;
        });
  const fallbackSeries = rangeSeries.length > 0 ? rangeSeries : accountHistory.slice(-12);
  const baseline = fallbackSeries[0]?.portfolioValue ?? null;

  return fallbackSeries
    .filter((point) => typeof point.portfolioValue === "number")
    .map((point) => {
      const portfolioValue = point.portfolioValue ?? 0;
      const pnl = typeof baseline === "number" ? portfolioValue - baseline : 0;

      return {
        timestamp: point.capturedAt,
        time: formatHistoryPointLabel(point.capturedAt, range),
        portfolioValue,
        pnl,
        pnlPct: typeof baseline === "number" && baseline !== 0 ? pnl / baseline : null,
      };
    });
}

function mapPortfolioHistoryPoints(
  range: DashboardPortfolioHistoryRange,
  points: Array<{ timestamp: string; equity: number | null; profitLoss: number | null }>,
  baseValue: number | null
): DashboardPortfolioHistoryPoint[] {
  const firstEquity = points.find((point) => typeof point.equity === "number")?.equity ?? null;
  const baseline = baseValue ?? firstEquity;

  return points
    .filter((point) => typeof point.equity === "number")
    .map((point) => {
      const portfolioValue = point.equity ?? 0;
      const pnl =
        typeof baseline === "number"
          ? portfolioValue - baseline
          : point.profitLoss ?? 0;

      return {
        timestamp: point.timestamp,
        time: formatHistoryPointLabel(point.timestamp, range),
        portfolioValue,
        pnl,
        pnlPct: typeof baseline === "number" && baseline !== 0 ? pnl / baseline : null,
      };
    });
}

async function getAlpacaPortfolioHistorySeries(
  accountHistory: Array<{ capturedAt: string; portfolioValue: number | null }>,
  range: DashboardPortfolioHistoryRange,
  currentPortfolioValue: number | null
): Promise<DashboardPortfolioHistoryPoint[]> {
  if (!isAlpacaPaperTradingConfigured()) {
    return buildSnapshotPortfolioHistory(accountHistory, range);
  }

  try {
    if (range !== "1D") {
      const period = range === "1M" ? "1M" : range === "1Y" ? "1A" : "all";
      const history = await getAlpacaPortfolioHistory({
        period,
        timeframe: "1D",
      });

      const mappedHistory = mapPortfolioHistoryPoints(range, history.points, history.baseValue);

      if (
        typeof currentPortfolioValue === "number" &&
        currentPortfolioValue > 0 &&
        mappedHistory.length > 0 &&
        (mappedHistory.every((point) => point.portfolioValue === 0) ||
          Math.abs((mappedHistory.at(-1)?.portfolioValue ?? 0) - currentPortfolioValue) >
            currentPortfolioValue * 0.9)
      ) {
        return buildSnapshotPortfolioHistory(accountHistory, range);
      }

      return mappedHistory;
    }

    const [marketHoursHistory, continuousHistory] = await Promise.all([
      getAlpacaPortfolioHistory({
        period: "1D",
        timeframe: "1Min",
        intradayReporting: "market_hours",
      }),
      getAlpacaPortfolioHistory({
        period: "1D",
        timeframe: "1Min",
        intradayReporting: "continuous",
      }),
    ]);
    const baseValue =
      marketHoursHistory.baseValue ??
      continuousHistory.baseValue ??
      continuousHistory.points.find((point) => typeof point.equity === "number")?.equity ??
      null;
    const mappedHistory = mapPortfolioHistoryPoints(range, continuousHistory.points, baseValue);

    if (
      typeof currentPortfolioValue === "number" &&
      currentPortfolioValue > 0 &&
      mappedHistory.length > 0 &&
      (mappedHistory.every((point) => point.portfolioValue === 0) ||
        Math.abs((mappedHistory.at(-1)?.portfolioValue ?? 0) - currentPortfolioValue) >
          currentPortfolioValue * 0.9)
    ) {
      return buildSnapshotPortfolioHistory(accountHistory, range);
    }

    return mappedHistory;
  } catch {
    return buildSnapshotPortfolioHistory(accountHistory, range);
  }
}

async function getDashboardPortfolioHistories(
  accountHistory: Array<{ capturedAt: string; portfolioValue: number | null }>,
  currentPortfolioValue: number | null
) {
  const entries = await Promise.all(
    PORTFOLIO_HISTORY_RANGES.map(async (range) => [
      range,
      await getAlpacaPortfolioHistorySeries(accountHistory, range, currentPortfolioValue),
    ] as const)
  );

  return Object.fromEntries(entries) as Record<
    DashboardPortfolioHistoryRange,
    DashboardPortfolioHistoryPoint[]
  >;
}

type PortfolioReturnPoint = {
  timestamp: string;
  value: number;
};

function getReturnSeries(
  history: DashboardPortfolioHistoryPoint[]
): PortfolioReturnPoint[] {
  const sortedHistory = history
    .filter((point) => point.portfolioValue > 0)
    .slice()
    .sort(
      (left, right) =>
        new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime()
    );
  const returns: PortfolioReturnPoint[] = [];

  for (let index = 1; index < sortedHistory.length; index += 1) {
    const previous = sortedHistory[index - 1];
    const current = sortedHistory[index];

    if (previous.portfolioValue > 0) {
      returns.push({
        timestamp: current.timestamp,
        value: current.portfolioValue / previous.portfolioValue - 1,
      });
    }
  }

  return returns;
}

function mean(values: number[]) {
  return values.length > 0
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;
}

function standardDeviation(values: number[]) {
  if (values.length < 2) {
    return null;
  }

  const average = mean(values);

  if (typeof average !== "number") {
    return null;
  }

  const variance =
    values.reduce((sum, value) => sum + (value - average) ** 2, 0) /
    (values.length - 1);

  return Math.sqrt(variance);
}

function percentile(values: number[], percentileRank: number) {
  if (values.length === 0) {
    return null;
  }

  const sortedValues = values.slice().sort((left, right) => left - right);
  const index = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.floor((sortedValues.length - 1) * percentileRank))
  );

  return sortedValues[index];
}

function calculateMaxDrawdown(history: DashboardPortfolioHistoryPoint[]) {
  let peak = 0;
  let maxDrawdown = 0;

  for (const point of history) {
    peak = Math.max(peak, point.portfolioValue);

    if (peak > 0) {
      maxDrawdown = Math.min(maxDrawdown, point.portfolioValue / peak - 1);
    }
  }

  return maxDrawdown;
}

function calculateAnnualizedReturn(history: DashboardPortfolioHistoryPoint[]) {
  const sortedHistory = history
    .filter((point) => point.portfolioValue > 0)
    .slice()
    .sort(
      (left, right) =>
        new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime()
    );
  const first = sortedHistory[0];
  const latest = sortedHistory.at(-1);

  if (!first || !latest || first.timestamp === latest.timestamp) {
    return null;
  }

  const elapsedYears =
    (new Date(latest.timestamp).getTime() - new Date(first.timestamp).getTime()) /
    (365.25 * 24 * 60 * 60 * 1000);

  if (elapsedYears <= 0 || first.portfolioValue <= 0) {
    return null;
  }

  return (latest.portfolioValue / first.portfolioValue) ** (1 / elapsedYears) - 1;
}

function calculateBetaAndCorrelation(
  portfolioReturns: PortfolioReturnPoint[],
  benchmarkReturns: PortfolioReturnPoint[]
) {
  const portfolioReturnByDate = new Map(
    portfolioReturns.map((point) => [getEtDateKey(point.timestamp), point.value])
  );
  const alignedReturns = benchmarkReturns
    .map((benchmarkPoint) => {
      const portfolioReturn = portfolioReturnByDate.get(getEtDateKey(benchmarkPoint.timestamp));

      return typeof portfolioReturn === "number"
        ? { portfolioReturn, benchmarkReturn: benchmarkPoint.value }
        : null;
    })
    .filter((point): point is { portfolioReturn: number; benchmarkReturn: number } =>
      Boolean(point)
    );

  if (alignedReturns.length < 3) {
    return { beta: null, correlation: null };
  }

  const portfolioValues = alignedReturns.map((point) => point.portfolioReturn);
  const benchmarkValues = alignedReturns.map((point) => point.benchmarkReturn);
  const averagePortfolioReturn = mean(portfolioValues);
  const averageBenchmarkReturn = mean(benchmarkValues);
  const portfolioStdDev = standardDeviation(portfolioValues);
  const benchmarkStdDev = standardDeviation(benchmarkValues);

  if (
    typeof averagePortfolioReturn !== "number" ||
    typeof averageBenchmarkReturn !== "number" ||
    typeof portfolioStdDev !== "number" ||
    typeof benchmarkStdDev !== "number" ||
    benchmarkStdDev === 0
  ) {
    return { beta: null, correlation: null };
  }

  const covariance =
    alignedReturns.reduce(
      (sum, point) =>
        sum +
        (point.portfolioReturn - averagePortfolioReturn) *
          (point.benchmarkReturn - averageBenchmarkReturn),
      0
    ) /
    (alignedReturns.length - 1);

  return {
    beta: covariance / benchmarkStdDev ** 2,
    correlation: covariance / (portfolioStdDev * benchmarkStdDev),
  };
}

async function getBenchmarkReturns(history: DashboardPortfolioHistoryPoint[]) {
  if (!isAlpacaPaperTradingConfigured() || history.length < 3) {
    return [];
  }

  try {
    const sortedHistory = history
      .slice()
      .sort(
        (left, right) =>
          new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime()
      );
    const bars = await getAlpacaStockBars("SPY", {
      start: sortedHistory[0].timestamp,
      end: sortedHistory.at(-1)?.timestamp ?? new Date().toISOString(),
      timeframe: "1Day",
    });

    return getReturnSeries(
      bars
        .filter((bar) => typeof bar.close === "number")
        .map((bar) => ({
          timestamp: bar.timestamp,
          time: formatPtDay(bar.timestamp),
          portfolioValue: bar.close ?? 0,
          pnl: 0,
          pnlPct: null,
        }))
    );
  } catch {
    return [];
  }
}

function pickStatisticsHistory(
  histories: Record<DashboardPortfolioHistoryRange, DashboardPortfolioHistoryPoint[]>
) {
  for (const range of ["1Y", "MAX", "1M", "1D"] satisfies DashboardPortfolioHistoryRange[]) {
    if (histories[range].length >= 3) {
      return {
        range,
        history: histories[range],
      };
    }
  }

  return {
    range: "1D" as const,
    history: histories["1D"],
  };
}

function formatRatio(value: number | null) {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(2) : "—";
}

function formatStatisticPercent(value: number | null) {
  return typeof value === "number" && Number.isFinite(value)
    ? `${(value * 100).toFixed(2)}%`
    : "—";
}

function formatStatisticUsd(value: number | null) {
  return typeof value === "number" && Number.isFinite(value)
    ? new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      }).format(value)
    : "—";
}

async function buildPortfolioStatistics(
  histories: Record<DashboardPortfolioHistoryRange, DashboardPortfolioHistoryPoint[]>,
  broker: DashboardBrokerSnapshot
): Promise<DashboardPortfolioStatistic[]> {
  const { range, history } = pickStatisticsHistory(histories);
  const returns = getReturnSeries(history);
  const returnValues = returns.map((point) => point.value);
  const averageReturn = mean(returnValues);
  const returnStdDev = standardDeviation(returnValues);
  const downsideStdDev = standardDeviation(returnValues.filter((value) => value < 0));
  const annualizationFactor = range === "1D" ? 252 * 390 : 252;
  const sharpeRatio =
    typeof averageReturn === "number" &&
    typeof returnStdDev === "number" &&
    returnStdDev > 0
      ? (averageReturn / returnStdDev) * Math.sqrt(annualizationFactor)
      : null;
  const sortinoRatio =
    typeof averageReturn === "number" &&
    typeof downsideStdDev === "number" &&
    downsideStdDev > 0
      ? (averageReturn / downsideStdDev) * Math.sqrt(annualizationFactor)
      : null;
  const maxDrawdown = calculateMaxDrawdown(history);
  const annualizedReturn = calculateAnnualizedReturn(history);
  const calmarRatio =
    typeof annualizedReturn === "number" && maxDrawdown < 0
      ? annualizedReturn / Math.abs(maxDrawdown)
      : null;
  const latestPortfolioValue =
    broker.account?.portfolioValue ?? history.at(-1)?.portfolioValue ?? null;
  const varReturn = percentile(returnValues, 0.05);
  const cvarReturns =
    typeof varReturn === "number"
      ? returnValues.filter((value) => value <= varReturn)
      : [];
  const cvarReturn = mean(cvarReturns);
  const var95 =
    typeof latestPortfolioValue === "number" &&
    typeof varReturn === "number"
      ? Math.abs(Math.min(varReturn, 0) * latestPortfolioValue)
      : null;
  const cvar95 =
    typeof latestPortfolioValue === "number" &&
    typeof cvarReturn === "number"
      ? Math.abs(Math.min(cvarReturn, 0) * latestPortfolioValue)
      : null;
  const benchmarkReturns = await getBenchmarkReturns(history);
  const { beta, correlation } = calculateBetaAndCorrelation(returns, benchmarkReturns);
  const grossExposureUsd = broker.openPositions.reduce(
    (sum, position) => sum + Math.abs(position.marketValue ?? 0),
    0
  );
  const netExposureUsd = broker.openPositions.reduce((sum, position) => {
    const direction = position.side === "short" ? -1 : 1;
    return sum + direction * Math.abs(position.marketValue ?? 0);
  }, 0);
  const grossExposure =
    typeof latestPortfolioValue === "number" && latestPortfolioValue !== 0
      ? grossExposureUsd / latestPortfolioValue
      : null;
  const netExposure =
    typeof latestPortfolioValue === "number" && latestPortfolioValue !== 0
      ? netExposureUsd / latestPortfolioValue
      : null;
  const cashBuffer =
    typeof broker.account?.cash === "number" &&
    typeof latestPortfolioValue === "number" &&
    latestPortfolioValue !== 0
      ? broker.account.cash / latestPortfolioValue
      : null;
  const sampleDetail = `${range} Alpaca history, ${returns.length} return observations`;

  return [
    {
      label: "Sharpe Ratio",
      display: formatRatio(sharpeRatio),
      value: sharpeRatio,
      detail: sampleDetail,
      tone:
        typeof sharpeRatio === "number"
          ? sharpeRatio >= 1
            ? "positive"
            : sharpeRatio < 0
              ? "negative"
              : "neutral"
          : "neutral",
    },
    {
      label: "Sortino Ratio",
      display: formatRatio(sortinoRatio),
      value: sortinoRatio,
      detail: "Downside-vol adjusted return",
    },
    {
      label: "Calmar Ratio",
      display: formatRatio(calmarRatio),
      value: calmarRatio,
      detail: "Annual return divided by max drawdown",
    },
    {
      label: "Max Drawdown",
      display: formatStatisticPercent(maxDrawdown),
      value: maxDrawdown,
      detail: "Peak-to-trough observed research portfolio value",
      tone: maxDrawdown < 0 ? "negative" : "neutral",
    },
    {
      label: "VaR 95%",
      display: formatStatisticUsd(var95),
      value: var95,
      detail: "Historical one-period loss threshold",
      tone: "negative",
    },
    {
      label: "CVaR 95%",
      display: formatStatisticUsd(cvar95),
      value: cvar95,
      detail: "Average loss beyond VaR threshold",
      tone: "negative",
    },
    {
      label: "Beta",
      display: formatRatio(beta),
      value: beta,
      detail: "Daily return beta versus SPY",
    },
    {
      label: "Correlation",
      display: formatRatio(correlation),
      value: correlation,
      detail: "Daily return correlation versus SPY",
    },
    {
      label: "Exposure / Leverage",
      display:
        typeof grossExposure === "number"
          ? `${(grossExposure * 100).toFixed(1)}% / ${grossExposure.toFixed(2)}x`
          : "—",
      value: grossExposure,
      detail: "Gross market value over equity",
    },
    {
      label: "Net Exposure",
      display: formatStatisticPercent(netExposure),
      value: netExposure,
      detail: "Directional exposure after shorts",
    },
    {
      label: "Cash Buffer",
      display: formatStatisticPercent(cashBuffer),
      value: cashBuffer,
      detail: "Cash as a share of research portfolio value",
      tone:
        typeof cashBuffer === "number" && cashBuffer < 0
          ? "negative"
          : "neutral",
    },
  ];
}

function mapDashboardPortfolioPositions(
  broker: DashboardBrokerSnapshot,
  positionEntryBySymbol: Map<
    string,
    {
      avgEntryPrice: number | null;
      currentPrice: number | null;
    }
  >,
  portfolioValue: number | null
): DashboardPortfolioPosition[] {
  return broker.attributedPositions
    .map((position) => {
      const entry = positionEntryBySymbol.get(position.symbol);

      return {
        symbol: position.symbol,
        side: position.side,
        qty: position.qty,
        marketValue: position.marketValue,
        currentPrice: entry?.currentPrice ?? position.currentPrice,
        avgEntryPrice: entry?.avgEntryPrice ?? null,
        unrealizedPl: position.unrealizedPl,
        pctOfNav:
          typeof position.marketValue === "number" &&
          typeof portfolioValue === "number" &&
          portfolioValue !== 0
            ? (Math.abs(position.marketValue) / portfolioValue) * 100
            : null,
        owners: position.owners,
        unattributedMarketValue: position.unattributedMarketValue,
      };
    })
    .sort(
      (left, right) =>
        Math.abs(right.marketValue ?? 0) - Math.abs(left.marketValue ?? 0)
    );
}

export async function getDashboardSummaryData(options?: {
  fresh?: boolean;
}): Promise<DashboardSummaryData> {
  if (isDevDashboardBypassEnabled()) {
    return getLocalPreviewSummaryData();
  }

  if (isAgentSwarmDecommissioned()) {
    return buildDecommissionedDashboardSummaryData(await getRecruitingPipelineCount());
  }

  const pool = getAlloyDbPool();
  const [feedSnapshot, accountHistoryResult, alertCountsResult, recruitingPipelineCount] =
    await Promise.all([
      loadDashboardFeedSnapshot(options?.fresh),
      queryAccountHistoryRows(pool),
      queryAlertCounts(pool),
      getRecruitingPipelineCount(),
    ]);
  const accountHistory = mapAccountHistoryRows(accountHistoryResult.rows);
  const alertCounts = alertCountsResult.rows[0];

  return buildDashboardSummary({
    feedSnapshot,
    accountHistory,
    recentAlerts: Number(alertCounts?.recent_alerts ?? 0),
    criticalAlerts: Number(alertCounts?.critical_alerts ?? 0),
    recruitingPipelineCount,
  });
}

export async function getDashboardDiscussionData(limit = 120): Promise<DashboardDiscussionData> {
  if (isDevDashboardBypassEnabled()) {
    return getLocalPreviewDiscussionData(limit);
  }

  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(limit, 200)) : 120;
  const [messages, summary] = await Promise.all([
    getAgentFeedMessages(safeLimit),
    getAgentFeedSummary(),
  ]);

  return {
    decisionRuntime: getDashboardDecisionRuntimeDiagnostic(),
    messages: messages.map((message) => ({
      id: message.id,
      timestamp: message.timestamp,
      senderId: message.senderId,
      senderName: message.senderName,
      senderRole: message.senderRole,
      recipientId: message.recipientId,
      recipientName: message.recipientName,
      messageType: message.messageType,
      priority: message.priority,
      renderType: message.renderType,
      content: message.content,
      reasoning: message.reasoning,
      payload: message.payload,
      influenceSummary: extractInfluenceSummary(message.payload),
      threadId: extractDiscussionThreadId(message.payload),
    })),
    summary: {
      agentCount: summary.agentCount,
      messageCount: summary.messageCount,
      discussionCount: messages.filter((message) => message.messageType === "DISCUSSION").length,
      latestMessageAt: summary.lastEventAt,
    },
  };
}

export async function getDashboardOverviewData(options?: {
  fresh?: boolean;
}): Promise<DashboardOverviewData> {
  if (isDevDashboardBypassEnabled()) {
    return getLocalPreviewOverviewData();
  }

  const pool = getAlloyDbPool();
  const [
    {
      feedSnapshot,
      recentActivityDecisions,
      recentActivityMessages,
      accountHistory,
      broker,
      positionEntryBySymbol,
    },
    alertCountsResult,
    recruitingPipelineCount,
  ] = await Promise.all([
    loadBaseDashboardContext(options?.fresh),
    queryAlertCounts(pool),
    getRecruitingPipelineCount(),
  ]);
  const alertCounts = alertCountsResult.rows[0];
  const summary = buildDashboardSummary({
    feedSnapshot,
    accountHistory,
    recentAlerts: Number(alertCounts?.recent_alerts ?? 0),
    criticalAlerts: Number(alertCounts?.critical_alerts ?? 0),
    recruitingPipelineCount,
  });
  const portfolioHistories = await getDashboardPortfolioHistories(
    accountHistory,
    broker.account?.portfolioValue ?? null
  );
  const portfolioHistory = portfolioHistories["1D"];
  const portfolioStatistics = await buildPortfolioStatistics(portfolioHistories, broker);
  const latestHistoryPoint = portfolioHistory.at(-1);
  const summaryWithHistory = {
    ...summary,
    portfolioValue:
      broker.account?.portfolioValue ??
      latestHistoryPoint?.portfolioValue ??
      summary.portfolioValue,
    dailyPnl: latestHistoryPoint?.pnl ?? summary.dailyPnl,
    dailyPnlPct:
      typeof latestHistoryPoint?.pnlPct === "number"
        ? latestHistoryPoint.pnlPct * 100
        : summary.dailyPnlPct,
  };
  const portfolioPositions = mapDashboardPortfolioPositions(
    broker,
    positionEntryBySymbol,
    summaryWithHistory.portfolioValue
  );
  const recentlyActiveAgentIds = collectRecentlyActiveAgentIds(
    recentActivityMessages
  );

  return {
    summary: summaryWithHistory,
    portfolioHistory,
    portfolioHistories,
    portfolioStatistics,
    portfolioPositions,
    activeAgentIds: feedSnapshot.runtime.session.activeAgentIds,
    recentlyActiveAgentIds,
    activityFeed: buildOverviewActivityFeed(recentActivityDecisions),
    runtimeNote: feedSnapshot.runtime.session.note,
    activePhaseLabel: feedSnapshot.runtime.session.label,
  };
}

export async function getDashboardPortfolioData(options?: {
  fresh?: boolean;
}): Promise<DashboardPortfolioData> {
  if (isDevDashboardBypassEnabled()) {
    return getLocalPreviewPortfolioData();
  }

  const pool = getAlloyDbPool();
  const [broker, latestPositionsResult, tradeRowsResult] = await Promise.all([
    loadDashboardBrokerSnapshot(options?.fresh),
    queryPositionEntryRows(pool),
    queryTradeRows(pool),
  ]);
  const positionEntryBySymbol = mapPositionEntryBySymbol(latestPositionsResult.rows);
  const trades = mapTradeRows(tradeRowsResult.rows);
  const portfolioValue = broker.account?.portfolioValue ?? null;

  return {
    portfolioValue,
    latestAccountTimestamp: broker.account?.lastSyncedAt ?? null,
    positions: mapDashboardPortfolioPositions(
      broker,
      positionEntryBySymbol,
      portfolioValue
    ),
    agentExposure: broker.agentExposure,
    recentTrades: trades,
  };
}

export async function getDashboardTradesData(): Promise<DashboardTradesData> {
  if (isDevDashboardBypassEnabled()) {
    return getLocalPreviewTradesData();
  }

  const pool = getAlloyDbPool();
  const [tradeRowsResult, agentRowsResult] = await Promise.all([
    queryTradeRows(pool),
    queryAgentRosterRows(pool),
  ]);
  const trades = mapTradeRows(tradeRowsResult.rows);
  const agents = agentRowsResult.rows
    .filter((row) => !isHiddenLegacyAgent(row.id))
    .map(mapAgentRow);

  return {
    trades,
    availableAgents: agents.map((agent) => ({
      id: agent.id,
      name: agent.displayName,
    })),
  };
}

export async function getDashboardAlertsData(): Promise<DashboardAlertsData> {
  if (isDevDashboardBypassEnabled()) {
    return getLocalPreviewAlertsData();
  }

  const alertRowsResult = await queryAlertRows(getAlloyDbPool());

  return {
    decisionRuntime: getDashboardDecisionRuntimeDiagnostic(),
    alerts: mapAlertRows(alertRowsResult.rows),
  };
}

export async function getDashboardRiskData(): Promise<DashboardRiskData> {
  if (isDevDashboardBypassEnabled()) {
    return getLocalPreviewRiskData();
  }

  const { broker, alerts, feedSnapshot, accountHistory } = await getBaseDashboardContext();
  const portfolioValue = broker.account?.portfolioValue ?? null;
  const positions = broker.openPositions;
  const { dailyPnl } = computeDailyPnl(accountHistory);
  const peakValue = accountHistory.reduce((peak, point) => {
    return typeof point.portfolioValue === "number"
      ? Math.max(peak, point.portfolioValue)
      : peak;
  }, 0);
  const latestValue = broker.account?.portfolioValue ?? accountHistory.at(-1)?.portfolioValue ?? null;
  const drawdownPct =
    typeof latestValue === "number" && peakValue > 0
      ? ((latestValue - peakValue) / peakValue) * 100
      : null;

  const grossExposure =
    typeof portfolioValue === "number" && portfolioValue !== 0
      ? (positions.reduce((sum, position) => sum + Math.abs(position.marketValue ?? 0), 0) /
          portfolioValue) *
        100
      : null;
  const netExposure =
    typeof portfolioValue === "number" && portfolioValue !== 0
      ? (positions.reduce((sum, position) => {
          const direction = position.side === "short" ? -1 : 1;
          return sum + direction * Math.abs(position.marketValue ?? 0);
        }, 0) /
          portfolioValue) *
        100
      : null;
  const largestPositionShare =
    typeof portfolioValue === "number" && portfolioValue !== 0
      ? Math.max(
          0,
          ...positions.map((position) => (Math.abs(position.marketValue ?? 0) / portfolioValue) * 100)
        )
      : null;
  const cashBuffer =
    typeof broker.account?.cash === "number" && typeof portfolioValue === "number" && portfolioValue !== 0
      ? (broker.account.cash / portfolioValue) * 100
      : null;
  const attributedCoverage =
    typeof portfolioValue === "number" && portfolioValue !== 0
      ? (broker.agentExposure.reduce(
          (sum, agent) => sum + Math.abs(agent.attributedMarketValue ?? 0),
          0
        ) /
          portfolioValue) *
        100
      : null;
  const topFiveConcentration =
    typeof portfolioValue === "number" && portfolioValue !== 0
      ? broker.openPositions
          .slice()
          .sort(
            (left, right) =>
              Math.abs(right.marketValue ?? 0) - Math.abs(left.marketValue ?? 0)
          )
          .slice(0, 5)
          .reduce((sum, position) => sum + Math.abs(position.marketValue ?? 0), 0) /
          portfolioValue *
        100
      : null;

  return {
    metrics: [
      {
        label: "Research Portfolio Value",
        value: portfolioValue,
        display:
          typeof portfolioValue === "number"
            ? new Intl.NumberFormat("en-US", {
                style: "currency",
                currency: "USD",
                maximumFractionDigits: 0,
              }).format(portfolioValue)
            : "—",
      },
      {
        label: "Gross Exposure",
        value: grossExposure,
        display: typeof grossExposure === "number" ? `${grossExposure.toFixed(1)}%` : "—",
      },
      {
        label: "Net Exposure",
        value: netExposure,
        display: typeof netExposure === "number" ? `${netExposure.toFixed(1)}%` : "—",
      },
      {
        label: "Current Drawdown",
        value: drawdownPct,
        display: typeof drawdownPct === "number" ? `${drawdownPct.toFixed(2)}%` : "—",
        tone: typeof drawdownPct === "number" && drawdownPct < 0 ? "negative" : "neutral",
      },
      {
        label: "Cash Buffer",
        value: cashBuffer,
        display: typeof cashBuffer === "number" ? `${cashBuffer.toFixed(1)}%` : "—",
        tone: typeof cashBuffer === "number" && cashBuffer < 0 ? "negative" : "neutral",
      },
      {
        label: "Latest P&L",
        value: dailyPnl,
        display:
          typeof dailyPnl === "number"
            ? new Intl.NumberFormat("en-US", {
                style: "currency",
                currency: "USD",
                maximumFractionDigits: 0,
              }).format(dailyPnl)
            : "—",
        tone:
          typeof dailyPnl === "number"
            ? dailyPnl >= 0
              ? "positive"
              : "negative"
            : "neutral",
      },
    ],
    limits: [
      {
        name: "Largest Position Share",
        current: largestPositionShare,
        limit: 100,
        unit: "%",
      },
      {
        name: "Top 5 Concentration",
        current: topFiveConcentration,
        limit: 100,
        unit: "%",
      },
      {
        name: "Cash Buffer Share",
        current: cashBuffer,
        limit: 100,
        unit: "%",
      },
      {
        name: "Agent Attribution Coverage",
        current: attributedCoverage,
        limit: 100,
        unit: "%",
      },
    ],
    alerts: alerts.slice(0, 12),
    notes: [
      feedSnapshot.runtime.session.note,
      feedSnapshot.runtime.riskMonitor.message,
      "Stress tests, VaR, beta, and factor exposures are not instrumented yet, so this page only shows live research coverage observations.",
    ],
  };
}

export async function getDashboardContributorsData(): Promise<DashboardContributorsData> {
  if (isDevDashboardBypassEnabled()) {
    return getLocalPreviewContributorsData();
  }

  return {
    instrumented: false,
    message:
      "Contributor contracts, payout ledgers, and the application pipeline are not instrumented in AlloyDB yet. This page now stays honest instead of showing fabricated roster and payout numbers.",
    roster: [],
  };
}

export async function getDashboardAgentsData() {
  if (isDevDashboardBypassEnabled()) {
    return getLocalPreviewAgentsData();
  }

  const pool = getAlloyDbPool();
  const [broker, agentRowsResult] = await Promise.all([
    loadDashboardBrokerSnapshot(),
    queryAgentRosterRows(pool),
  ]);

  return mapDashboardAgentRows(agentRowsResult.rows, broker);
}

function mapMessageDetail(row: AgentMessageDetailRow): DashboardAgentBusMessageDetail {
  return {
    id: row.id,
    cycleId: toCycleId(row.cycle_id),
    timestamp: row.created_at.toISOString(),
    senderId: row.sender_id,
    senderName: row.sender_name,
    recipientId: row.recipient_id,
    recipientName: row.recipient_name,
    messageType: row.message_type,
    priority: row.priority,
    renderType: row.render_type,
    content: row.content,
    reasoning: row.reasoning,
    payload: toRecord(row.payload),
    audience: formatAudience(row.recipient_id, row.recipient_name),
  };
}

function mapDecisionContribution(
  row: AgentDecisionContributionRow
): DashboardAgentDecisionContribution {
  return {
    id: row.id,
    cycleId: toCycleId(row.cycle_id),
    timestamp: row.created_at.toISOString(),
    actionTaken: row.action_taken,
    reasoning: row.reasoning,
    dataConsumed: toArray(row.data_consumed),
    confidenceScore: Number(row.confidence_score ?? 0),
    relatedMessageId: row.related_message_id,
    relatedMessageType: row.related_message_type,
    relatedMessageContent: row.related_message_content,
    relatedMessagePayload: toRecord(row.related_message_payload),
  };
}

function mapAllocationContribution(
  row: AllocationEventRow
): DashboardAgentAllocationContribution {
  return {
    id: row.id,
    cycleId: toCycleId(row.cycle_id ?? null),
    timestamp: row.created_at.toISOString(),
    targetAgentId: row.target_agent_id,
    targetAgentName: row.target_agent_name,
    previousAllocationUsd: toNullableNumber(row.previous_allocation_usd),
    newAllocationUsd: toNullableNumber(row.new_allocation_usd),
    reasoning: row.rationale,
    inputs: toRecord(row.inputs),
  };
}

export async function getDashboardAgentDetailData(
  agentId: string
): Promise<DashboardAgentDetailData> {
  if (isDevDashboardBypassEnabled()) {
    return getLocalPreviewAgentDetailData(agentId);
  }

  if (isAgentSwarmDecommissioned()) {
    return createEmptyDashboardAgentDetailData();
  }

  if (isHiddenLegacyAgent(agentId)) {
    return createEmptyDashboardAgentDetailData();
  }

  const pool = getAlloyDbPool();
  const [broker, tradeRowsResult, detailResult] = await Promise.all([
    loadDashboardBrokerSnapshot(),
    queryTradeRows(pool),
    pool.query<AgentRosterRow>(
      `
        select
          a.id,
          a.display_name,
          a.role,
          a.tier,
          a.reports_to,
          a.strategy_category,
          a.status,
          a.paper_enabled,
          a.current_allocation_usd,
          a.max_allocation_usd,
          c.objective_function,
          c.subscriptions,
          c.direct_reports,
          c.constraints,
          c.config,
          (
            select count(*)::text
            from agent_messages m
            where m.sender_id = a.id
              and m.created_at >= now() - interval '7 days'
          ) as recent_message_count,
          (
            select max(m.created_at)
            from agent_messages m
            where m.sender_id = a.id
          ) as last_message_at,
          (
            select count(*)::text
            from alpaca_orders o
            where o.agent_id = a.id
          ) as recent_order_count,
          (
            select max(coalesce(o.updated_at, o.submitted_at))
            from alpaca_orders o
            where o.agent_id = a.id
          ) as last_order_at
        from agents a
        left join agent_configs c on c.agent_id = a.id
        where a.id = $1
        limit 1
      `,
      [agentId]
    ),
  ]);
  const trades = mapTradeRows(tradeRowsResult.rows);

  const row = detailResult.rows[0];

  if (!row) {
    return createEmptyDashboardAgentDetailData();
  }

  const [
    messageRowsResult,
    decisionRowsResult,
    researchRowsResult,
    downstreamRowsResult,
    allocationContributionRowsResult,
  ] = await Promise.all([
    pool.query<AgentMessageDetailRow>(
      `
        select
          m.id::text as id,
          m.cycle_id,
          m.created_at,
          m.sender_id,
          sender.display_name as sender_name,
          m.recipient_id,
          recipient.display_name as recipient_name,
          m.message_type,
          m.priority,
          m.render_type,
          m.content,
          m.reasoning,
          m.payload
        from agent_messages m
        join agents sender on sender.id = m.sender_id
        left join agents recipient on recipient.id = m.recipient_id
        where m.sender_id = $1
           or m.recipient_id = $1
        order by m.created_at desc, m.id desc
        limit 30
      `,
      [agentId]
    ),
    pool.query<AgentDecisionContributionRow>(
      `
        select
          d.id::text as id,
          d.cycle_id,
          d.created_at,
          d.action_taken,
          d.reasoning,
          d.data_consumed,
          d.confidence_score,
          d.related_message_id::text as related_message_id,
          m.message_type as related_message_type,
          m.content as related_message_content,
          m.payload as related_message_payload
        from agent_decisions d
        left join agent_messages m on m.id = d.related_message_id
        where d.agent_id = $1
        order by d.created_at desc, d.id desc
        limit 30
      `,
      [agentId]
    ),
    pool.query<AgentMessageDetailRow>(
      `
        with relevant_cycles as (
          select distinct cycle_id
          from agent_messages
          where cycle_id is not null
            and (sender_id = $1 or recipient_id = $1)
          union
          select distinct cycle_id
          from agent_decisions
          where cycle_id is not null
            and agent_id = $1
          union
          select distinct cycle_id
          from alpaca_orders
          where cycle_id is not null
            and agent_id = $1
        )
        select
          m.id::text as id,
          m.cycle_id,
          m.created_at,
          m.sender_id,
          sender.display_name as sender_name,
          m.recipient_id,
          recipient.display_name as recipient_name,
          m.message_type,
          m.priority,
          m.render_type,
          m.content,
          m.reasoning,
          m.payload
        from agent_messages m
        join agents sender on sender.id = m.sender_id
        left join agents recipient on recipient.id = m.recipient_id
        where m.sender_id = 'AGT-RESEARCH'
          and m.message_type in ('RESEARCH_REPORT', 'SIGNAL')
          and (
            $1 = 'AGT-RESEARCH'
            or m.recipient_id = $1
            or m.cycle_id in (select cycle_id from relevant_cycles)
          )
        order by m.created_at desc, m.id desc
        limit 18
      `,
      [agentId]
    ),
    pool.query<ResearchDownstreamRow>(
      `
        with relevant_cycles as (
          select distinct cycle_id
          from agent_messages
          where cycle_id is not null
            and (sender_id = $1 or recipient_id = $1)
          union
          select distinct cycle_id
          from agent_decisions
          where cycle_id is not null
            and agent_id = $1
          union
          select distinct cycle_id
          from alpaca_orders
          where cycle_id is not null
            and agent_id = $1
        ),
        selected_research as (
          select m.id, m.cycle_id, m.created_at
          from agent_messages m
          where m.sender_id = 'AGT-RESEARCH'
            and m.message_type in ('RESEARCH_REPORT', 'SIGNAL')
            and (
              $1 = 'AGT-RESEARCH'
              or m.recipient_id = $1
              or m.cycle_id in (select cycle_id from relevant_cycles)
            )
          order by m.created_at desc, m.id desc
          limit 18
        )
        select
          r.id::text as research_message_id,
          downstream.id::text as id,
          downstream.created_at,
          downstream.sender_id,
          sender.display_name as sender_name,
          downstream.message_type,
          downstream.content
        from selected_research r
        join agent_messages downstream
          on downstream.cycle_id = r.cycle_id
         and downstream.created_at > r.created_at
         and downstream.sender_id <> 'AGT-RESEARCH'
        join agents sender on sender.id = downstream.sender_id
        where downstream.message_type in (
          'ALLOCATION_CHANGE',
          'TRADE_ORDER',
          'POSITION_DECLARATION',
          'SYSTEM_STATUS',
          'RISK_ALERT',
          'EXECUTION_CONFIRM'
        )
        order by r.created_at desc, downstream.created_at asc, downstream.id asc
        limit 80
      `,
      [agentId]
    ),
    pool.query<AllocationEventRow>(
      `
        select
          e.id::text as id,
          e.cycle_id,
          e.created_at,
          e.previous_allocation_usd,
          e.new_allocation_usd,
          e.rationale,
          e.inputs,
          e.agent_id as target_agent_id,
          target.display_name as target_agent_name
        from agent_allocation_events e
        join agents target on target.id = e.agent_id
        where $1 = 'AGT-CIO'
           or e.agent_id = $1
        order by e.created_at desc, e.id desc
        limit 20
      `,
      [agentId]
    ),
  ]);

  const busMessages = messageRowsResult.rows.map(mapMessageDetail);
  const decisionContributions = decisionRowsResult.rows.map(mapDecisionContribution);
  const allocationContributions =
    allocationContributionRowsResult.rows.map(mapAllocationContribution);
  const downstreamByResearchId = new Map<
    string,
    DashboardAgentResearchTrace["downstream"]
  >();

  for (const downstream of downstreamRowsResult.rows) {
    const existing = downstreamByResearchId.get(downstream.research_message_id) ?? [];

    if (existing.length < 4) {
      existing.push({
        id: downstream.id,
        timestamp: downstream.created_at.toISOString(),
        agentId: downstream.sender_id,
        agentName: downstream.sender_name,
        messageType: downstream.message_type,
        content: downstream.content,
      });
    }

    downstreamByResearchId.set(downstream.research_message_id, existing);
  }

  const researchTrace: DashboardAgentResearchTrace[] = researchRowsResult.rows.map((message) => ({
    id: message.id,
    cycleId: toCycleId(message.cycle_id),
    timestamp: message.created_at.toISOString(),
    sourceAgentId: message.sender_id,
    sourceAgentName: message.sender_name,
    messageType: message.message_type,
    content: message.content,
    reasoning: message.reasoning,
    audience: formatAudience(message.recipient_id, message.recipient_name),
    payload: toRecord(message.payload),
    downstream: downstreamByResearchId.get(message.id) ?? [],
  }));
  const recentTrades = trades.filter((trade) => trade.agentId === agentId).slice(0, 20);

  return {
    agent: mapAgentRow(row),
    objectiveFunction: row.objective_function,
    subscriptions: toArray(row.subscriptions),
    directReports: toArray(row.direct_reports),
    constraints: toRecord((row as QueryResultRow & { constraints?: unknown }).constraints),
    config: toRecord((row as QueryResultRow & { config?: unknown }).config),
    recentMessages: busMessages
      .slice(0, 12)
      .map((message) => ({
        id: message.id,
        timestamp: message.timestamp,
        agentId: message.senderId,
        agentName: message.senderName,
        type: formatMessageAsActivityType(message.messageType, message.priority),
        description: message.content,
      })),
    busMessages,
    researchTrace,
    decisionContributions,
    allocationContributions,
    contributionSummary: {
      researchItemsProduced:
        agentId === "AGT-RESEARCH"
          ? researchTrace.length
          : busMessages.filter(
              (message) =>
                message.senderId === agentId &&
                (message.messageType === "RESEARCH_REPORT" || message.messageType === "SIGNAL")
            ).length,
      researchItemsConsumed: agentId === "AGT-RESEARCH" ? 0 : researchTrace.length,
      decisionsLogged: decisionContributions.length,
      tradesRouted: recentTrades.length,
      allocationEvents: allocationContributions.length,
    },
    recentTrades,
    positions: broker.attributedPositions
      .flatMap((position) =>
        position.owners
          .filter((owner) => owner.agentId === agentId)
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
      ),
  };
}

export async function getDashboardAllocationData(): Promise<DashboardAllocationData> {
  if (isDevDashboardBypassEnabled()) {
    return getLocalPreviewAllocationData();
  }

  const pool = getAlloyDbPool();
  const [broker, agentRowsResult, allocationRowsResult] = await Promise.all([
    loadDashboardBrokerSnapshot(),
    queryAgentRosterRows(pool),
    queryAllocationRows(pool),
  ]);
  const agents = mapDashboardAgentRows(agentRowsResult.rows, broker);
  const allocationEvents = mapAllocationRows(allocationRowsResult.rows);
  const allocatedAgents = agents.filter((agent) => typeof agent.currentAllocationUsd === "number");
  const portfolioValue = broker.account?.portfolioValue ?? null;
  const allocatedCapitalUsd = allocatedAgents.reduce(
    (sum, agent) => sum + (agent.currentAllocationUsd ?? 0),
    0
  );
  const cashReserveUsd =
    typeof portfolioValue === "number" ? Math.max(portfolioValue - allocatedCapitalUsd, 0) : null;
  const cashReservePct =
    typeof portfolioValue === "number" && portfolioValue > 0 && typeof cashReserveUsd === "number"
      ? (cashReserveUsd / portfolioValue) * 100
      : null;

  return {
    portfolioValue,
    allocatedCapitalUsd,
    cashReserveUsd,
    cashReservePct,
    agents: allocatedAgents,
    recentChanges: allocationEvents,
    instrumented: allocationEvents.length > 0,
    message:
      "The coordinator target table shows deployable research sleeves plus the explicit research reserve. Current reserve sizing comes from the hard-coded coverage guardrail, not an individual researcher.",
  };
}

function isSimpleTicker(value: string | null | undefined) {
  return typeof value === "string" && /^[A-Z]{1,5}$/.test(value.trim().toUpperCase());
}

function buildResearchWatchSymbols(input: {
  broker: DashboardBrokerSnapshot;
  trades: DashboardTradeRecord[];
}) {
  const candidates = [
    ...input.broker.openPositions.map((position) => position.symbol),
    ...input.trades.map((trade) => trade.ticker),
    "SPY",
    "QQQ",
    "AAPL",
    "AMD",
    "PLTR",
    "DAL",
  ];

  return Array.from(
    new Set(
      candidates
        .map((symbol) => symbol.trim().toUpperCase())
        .filter((symbol) => isSimpleTicker(symbol))
    )
  ).slice(0, 6);
}

function buildPolymarketWatchQueries(watchSymbols: string[]) {
  return Array.from(new Set([...watchSymbols, "SPY"]))
    .filter(Boolean)
    .slice(0, 6);
}

function buildKalshiWatchQueries(watchSymbols: string[]) {
  const hasCryptoExposure = watchSymbols.some((symbol) =>
    ["IBIT", "BITO", "COIN", "MSTR"].includes(symbol)
  );
  const hasEnergyExposure = watchSymbols.some((symbol) =>
    ["XLE", "USO", "DBA", "COPX", "DAL"].includes(symbol)
  );

  return Array.from(
    new Set([
      "Federal Reserve",
      "inflation",
      "jobs",
      "recession",
      hasCryptoExposure ? "Bitcoin" : null,
      hasEnergyExposure ? "oil" : null,
    ])
  )
    .filter((query): query is string => Boolean(query))
    .slice(0, 6);
}

function truncateText(value: string | null | undefined, maxLength = 220) {
  if (!value) {
    return null;
  }

  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1).trimEnd()}...`;
}

function isNewsworthyMarketMove(changePct: number | null, headlineCount: number) {
  if (headlineCount > 0) {
    return true;
  }

  return typeof changePct === "number" && Math.abs(changePct) >= 2;
}

async function getResearchProviderPackets(input: {
  massiveSymbols: string[];
  kalshiQueries: string[];
  polymarketQueries: string[];
  newsQueries: string[];
  secSymbols: string[];
}) {
  const checkedAt = new Date().toISOString();
  const [massivePacket, newsApiPacket, kalshiPacket, polymarketPacket, secPacket] =
    await Promise.all([
      getMassiveResearchPacket(input.massiveSymbols).catch((error) => ({
        configured: isMassiveConfigured(),
        connected: false,
        checkedAt,
        symbols: [],
        errors: [
          error instanceof Error
            ? error.message
            : "Research pricing/headline provider check failed.",
        ],
      })),
      getNewsApiResearchPacket(input.newsQueries).catch((error) => ({
        configured: isNewsApiConfigured(),
        connected: false,
        hasUsableArticles: false,
        checkedAt,
        queries: [],
        errors: [
          error instanceof Error ? error.message : "Alpha Vantage provider check failed.",
        ],
      })),
      getKalshiResearchPacket(input.kalshiQueries).catch((error) => ({
        configured: isKalshiConfigured(),
        connected: false,
        checkedAt,
        queries: [],
        errors: [error instanceof Error ? error.message : "Kalshi provider check failed."],
      })),
      getPolymarketResearchPacket(input.polymarketQueries).catch((error) => ({
        configured: isPolymarketConfigured(),
        connected: false,
        checkedAt,
        queries: [],
        errors: [
          error instanceof Error ? error.message : "Polymarket provider check failed.",
        ],
      })),
      getSecEarningsPacket(input.secSymbols).catch((error) => ({
        configured: true,
        connected: false,
        checkedAt,
        customUserAgent: isSecUserAgentConfigured(),
        symbols: [],
        errors: [
          error instanceof Error ? error.message : "SEC EDGAR provider check failed.",
        ],
      })),
    ]);

  return {
    massivePacket,
    kalshiPacket,
    polymarketPacket,
    newsApiPacket,
    secPacket,
  };
}

function buildProviderDiagnostics(input: {
  broker: DashboardBrokerSnapshot;
  massivePacket: Awaited<ReturnType<typeof getMassiveResearchPacket>>;
  kalshiPacket: Awaited<ReturnType<typeof getKalshiResearchPacket>>;
  polymarketPacket: Awaited<ReturnType<typeof getPolymarketResearchPacket>>;
  newsApiPacket: Awaited<ReturnType<typeof getNewsApiResearchPacket>>;
  secPacket: Awaited<ReturnType<typeof getSecEarningsPacket>>;
}) {
  const { broker, massivePacket, kalshiPacket, polymarketPacket, newsApiPacket, secPacket } = input;
  const checkedAt = new Date().toISOString();
  const massiveSymbol = massivePacket.symbols[0] ?? null;
  const massiveDetailParts = [
    massiveSymbol?.details?.name
      ? `Reference: ${massiveSymbol.details.name}`
      : null,
    massiveSymbol?.bars.length
      ? `Bars: ${massiveSymbol.bars.length}`
      : null,
    massiveSymbol?.news.length
      ? `News: ${massiveSymbol.news.length}`
      : null,
  ].filter(Boolean);
  const kalshiQuery = kalshiPacket.queries[0] ?? null;
  const kalshiMarket = kalshiQuery?.events[0]?.markets[0] ?? null;
  const newsApiQuery = newsApiPacket.queries[0] ?? null;
  const polymarketQuery = polymarketPacket.queries[0] ?? null;
  const polymarketMarket = polymarketQuery?.events[0]?.markets[0] ?? null;
  const secSymbol = secPacket.symbols[0] ?? null;

  return [
    {
      id: "alpaca-paper",
      label: "Alpaca Market Data",
      configured: isAlpacaPaperTradingConfigured(),
      connected: broker.connected,
      purpose: "Market-data context and research state for Macro, Event, and Sentiment research sleeves.",
      capabilities: [
        "Sync market-data context",
        "Read coverage snapshots",
        "Read recent research events",
        "Fetch watchlist context",
        "Fetch stock snapshots and bars",
        "Fetch research portfolio history",
      ],
      statusDetail: broker.connected
        ? `Connected to ${broker.provider}; ${broker.openPositions.length} coverage item(s), ${broker.recentOrders.length} recent research event(s).`
        : broker.configured
          ? `${broker.provider} credentials are configured, but the latest market-data sync did not connect.`
          : "Alpaca market-data credentials are missing.",
      lastCheckedAt: checkedAt,
    },
    {
      id: "massive-research",
      label: "Alpaca + Alpha Vantage Research",
      configured: massivePacket.configured,
      connected: massivePacket.connected,
      purpose:
        "Combined research pricing and headline context built from Alpaca market bars and Alpha Vantage news.",
      capabilities: [
        "Alpaca historical stock bars",
        "Benchmark price context",
        "Alpha Vantage ticker headlines",
        "Headline-linked research packet enrichment",
        "Desk research summaries",
      ],
      statusDetail: massivePacket.connected
        ? `Connected; ${massiveDetailParts.join(", ") || "Research packet returned usable data"}.`
        : massivePacket.configured
          ? massivePacket.errors[0] ?? "Alpaca and Alpha Vantage returned no usable research data."
          : "Neither Alpaca market data nor Alpha Vantage is configured.",
      lastCheckedAt: massivePacket.checkedAt,
    },
    {
      id: "kalshi-public",
      label: "Kalshi",
      configured: kalshiPacket.configured,
      connected: kalshiPacket.connected,
      purpose:
        "Public market-implied probabilities across economics, policy, crypto, and event-risk contracts.",
      capabilities: [
        "Series discovery",
        "Open event market data",
        "Yes/No implied probabilities",
        "24h volume",
        "Open interest",
        "Economic and policy contracts",
      ],
      statusDetail: kalshiPacket.connected
        ? `Connected; ${
            kalshiMarket?.title ?? kalshiQuery?.events[0]?.title ?? "query set returned usable Kalshi markets"
          }.`
        : kalshiPacket.errors[0] ?? "Kalshi returned no usable market-implied context.",
      lastCheckedAt: kalshiPacket.checkedAt,
    },
    {
      id: "polymarket-gamma",
      label: "Polymarket Gamma",
      configured: polymarketPacket.configured,
      connected: polymarketPacket.connected,
      purpose:
        "Public prediction-market discovery and crowd-odds context for macro, catalyst, and sentiment research.",
      capabilities: [
        "Public market search",
        "Yes/No implied odds",
        "Liquidity and spread context",
        "24h volume",
        "Open interest",
        "Event metadata",
      ],
      statusDetail: polymarketPacket.connected
        ? `Connected; ${
            polymarketMarket?.question ?? polymarketQuery?.events[0]?.title ?? "query set returned usable markets"
          }.`
        : polymarketPacket.errors[0] ??
          "Polymarket returned no usable prediction-market context.",
      lastCheckedAt: polymarketPacket.checkedAt,
    },
    {
      id: "alphavantage-research",
      label: "Alpha Vantage News",
      configured: newsApiPacket.configured,
      connected: newsApiPacket.connected,
      purpose:
        "Supplemental market news source for macro narratives, event catalysts, and independent sentiment analysis by the agents.",
      capabilities: [
        "Ticker-filtered market news",
        "Topic-filtered market news",
        "Source attribution",
        "Event news confirmation",
        "Sentiment article flow",
      ],
      statusDetail: newsApiPacket.connected
        ? newsApiPacket.hasUsableArticles
          ? `Connected; ${newsApiQuery?.articles.length ?? 0} article(s) returned for the current watched query set.`
          : "Connected; request succeeded but the current watched query set returned no relevant articles."
        : newsApiPacket.configured
          ? newsApiPacket.errors[0] ?? "Alpha Vantage returned no usable article data."
          : "ALPHA_VANTAGE_API_KEY is missing.",
      lastCheckedAt: newsApiPacket.checkedAt,
    },
    {
      id: "sec-edgar",
      label: "SEC EDGAR",
      configured: true,
      connected: secPacket.connected,
      purpose:
        "Keyless real-time submissions and XBRL company facts for earnings reports and filing catalysts.",
      capabilities: [
        "Ticker to CIK lookup",
        "Real-time submissions",
        "8-K/10-Q/10-K monitoring",
        "Company XBRL facts",
        "Earnings filing links",
      ],
      statusDetail: secPacket.connected
        ? `Connected; ${secSymbol?.symbol ?? "AAPL"} latest earnings filing ${
            secSymbol?.latestFiling?.form ?? "n/a"
          }, custom User-Agent: ${secPacket.customUserAgent ? "yes" : "no"}.`
        : secPacket.errors[0] ?? "SEC EDGAR returned no usable filing data.",
      lastCheckedAt: secPacket.checkedAt,
    },
  ];
}

async function getProviderDiagnostics(
  broker: DashboardBrokerSnapshot
): Promise<DashboardProviderDiagnostic[]> {
  const packets = await getResearchProviderPackets({
    massiveSymbols: ["SPY"],
    kalshiQueries: ["Federal Reserve", "inflation", "jobs"],
    polymarketQueries: ["SPY", "AAPL"],
    newsQueries: ["stock market"],
    secSymbols: ["AAPL"],
  });

  return buildProviderDiagnostics({
    broker,
    massivePacket: packets.massivePacket,
    kalshiPacket: packets.kalshiPacket,
    polymarketPacket: packets.polymarketPacket,
    newsApiPacket: packets.newsApiPacket,
    secPacket: packets.secPacket,
  });
}

export async function getDashboardSettingsData(): Promise<DashboardSettingsData> {
  if (isDevDashboardBypassEnabled()) {
    return getLocalPreviewSettingsData();
  }

  const pool = getAlloyDbPool();
  const [feedSnapshot, agentRowsResult, overrideRowsResult] = await Promise.all([
    loadDashboardFeedSnapshot(),
    queryAgentRosterRows(pool),
    queryOverrideRows(pool),
  ]);
  const broker = feedSnapshot.broker;
  const agents = mapDashboardAgentRows(agentRowsResult.rows, broker);
  const overrides = mapOverrideRows(overrideRowsResult.rows);

  return {
    brokerConfigured: broker.configured,
    brokerConnected: broker.connected,
    brokerProvider: broker.provider,
    decisionRuntime: getDashboardDecisionRuntimeDiagnostic(),
    providerDiagnostics: await getProviderDiagnostics(broker),
    runtimePhase: feedSnapshot.runtime.session.label,
    runtimeNote: feedSnapshot.runtime.session.note,
    activeAgentIds: feedSnapshot.runtime.session.activeAgentIds,
    sleepingAgentIds: feedSnapshot.runtime.session.sleepingAgentIds,
    overrides,
    agents,
  };
}

function buildResearchFeed(input: {
  checkedAt: string;
  massivePacket: Awaited<ReturnType<typeof getMassiveResearchPacket>>;
  kalshiPacket: Awaited<ReturnType<typeof getKalshiResearchPacket>>;
  polymarketPacket: Awaited<ReturnType<typeof getPolymarketResearchPacket>>;
  newsApiPacket: Awaited<ReturnType<typeof getNewsApiResearchPacket>>;
  secPacket: Awaited<ReturnType<typeof getSecEarningsPacket>>;
}) {
  const { checkedAt, massivePacket, kalshiPacket, polymarketPacket, newsApiPacket, secPacket } = input;
  const items: DashboardResearchFeedItem[] = [];

  for (const symbolPacket of massivePacket.symbols) {
    const latestBar = symbolPacket.bars.at(-1);
    const priorBar =
      symbolPacket.bars.length >= 2
        ? symbolPacket.bars[symbolPacket.bars.length - 2]
        : null;
    const changePct =
      typeof latestBar?.close === "number" &&
      typeof priorBar?.close === "number" &&
      priorBar.close !== 0
        ? ((latestBar.close - priorBar.close) / priorBar.close) * 100
        : null;

    if (latestBar && isNewsworthyMarketMove(changePct, symbolPacket.news.length)) {
      items.push({
        id: `massive-bar-${symbolPacket.symbol}-${latestBar.timestamp}`,
        timestamp: latestBar.timestamp || checkedAt,
        sourceId: "massive",
        sourceLabel: "Alpaca + Alpha Vantage",
        category: "market",
        title: `${symbolPacket.symbol} ${typeof latestBar.close === "number" ? latestBar.close.toFixed(2) : "n/a"}${typeof changePct === "number" ? ` (${changePct >= 0 ? "+" : ""}${changePct.toFixed(2)}%)` : ""}`,
        summary:
          symbolPacket.news[0]?.title ??
          symbolPacket.details?.name ??
          "Notable market move from Alpaca pricing.",
        symbol: symbolPacket.symbol,
        href: symbolPacket.news[0]?.articleUrl ?? null,
        imageUrl: symbolPacket.news[0]?.imageUrl ?? null,
        meta: [
          typeof changePct === "number" && Math.abs(changePct) >= 2 ? "Notable move" : "Market bar",
          symbolPacket.details?.primaryExchange ?? "Exchange n/a",
          symbolPacket.news.length ? `${symbolPacket.news.length} linked headline(s)` : "No linked headlines",
        ],
      });
    }

    for (const newsItem of symbolPacket.news.slice(0, 2)) {
      items.push({
        id: `massive-news-${newsItem.id}`,
        timestamp: newsItem.publishedUtc ?? checkedAt,
        sourceId: "massive",
        sourceLabel: "Alpaca + Alpha Vantage",
        category: "headline",
        title: newsItem.title,
        summary: newsItem.description ?? "Ticker-linked headline from Alpha Vantage news.",
        symbol: symbolPacket.symbol,
        href: newsItem.articleUrl,
        imageUrl: newsItem.imageUrl ?? null,
        meta: [
          "Ticker news",
          newsItem.publisherName ?? "Publisher n/a",
          symbolPacket.symbol,
        ],
      });
    }
  }

  const seenKalshiItems = new Set<string>();

  for (const queryPacket of kalshiPacket.queries) {
    for (const event of queryPacket.events.slice(0, 2)) {
      const market = event.markets[0] ?? null;

      if (!market) {
        continue;
      }

      const id = `kalshi-market-${market.ticker}`;

      if (seenKalshiItems.has(id)) {
        continue;
      }

      seenKalshiItems.add(id);

      const impliedProbability = market.yesAsk ?? market.lastPrice ?? market.yesBid ?? null;
      const volumeText =
        typeof market.volume24h === "number"
          ? market.volume24h.toLocaleString("en-US", {
              maximumFractionDigits: 0,
            })
          : null;
      const openInterestText =
        typeof market.openInterest === "number"
          ? market.openInterest.toLocaleString("en-US", {
              maximumFractionDigits: 0,
            })
          : null;

      items.push({
        id,
        timestamp: event.openTime ?? event.closeTime ?? checkedAt,
        sourceId: "kalshi",
        sourceLabel: "Kalshi",
        category: "prediction-market",
        title:
          typeof impliedProbability === "number"
            ? `${market.title} (${(impliedProbability * 100).toFixed(1)}% yes-implied)`
            : market.title,
        summary: event.subtitle ?? event.title,
        symbol: null,
        href: null,
        imageUrl: market.imageUrl ?? event.imageUrl ?? null,
        meta: [
          `Query: ${queryPacket.query}`,
          volumeText ? `24h volume ${volumeText}` : "24h volume n/a",
          openInterestText ? `Open interest ${openInterestText}` : "Open interest n/a",
        ],
      });
    }
  }

  const seenPolymarketItems = new Set<string>();

  for (const queryPacket of polymarketPacket.queries) {
    for (const event of queryPacket.events.slice(0, 2)) {
      const market = event.markets[0] ?? null;
      const id = market ? `polymarket-market-${market.id}` : `polymarket-event-${event.id}`;

      if (seenPolymarketItems.has(id)) {
        continue;
      }

      seenPolymarketItems.add(id);

      const leadOutcome = market?.outcomes[0] ?? null;
      const impliedProbability =
        leadOutcome?.price ?? market?.lastTradePrice ?? market?.bestAsk ?? market?.bestBid ?? null;
      const volumeTag =
        typeof market?.volume24hr === "number"
          ? `24h volume $${market.volume24hr.toLocaleString("en-US", {
              maximumFractionDigits: 0,
            })}`
          : typeof event.volume24hr === "number"
            ? `24h volume $${event.volume24hr.toLocaleString("en-US", {
                maximumFractionDigits: 0,
              })}`
            : "24h volume n/a";

      items.push({
        id,
        timestamp: market?.updatedAt ?? event.updatedAt ?? event.startDate ?? checkedAt,
        sourceId: "polymarket",
        sourceLabel: "Polymarket",
        category: "prediction-market",
        title:
          market && typeof impliedProbability === "number"
            ? `${market.question} (${(impliedProbability * 100).toFixed(1)}% ${leadOutcome?.label ?? "implied"})`
            : market?.question ?? event.title,
        summary:
          truncateText(event.description) ??
          event.title ??
          "Prediction-market event returned by Polymarket search.",
        symbol: isSimpleTicker(queryPacket.query) ? queryPacket.query : null,
        href: market?.url ?? event.url,
        imageUrl: market?.imageUrl ?? event.imageUrl ?? null,
        meta: [
          `Query: ${queryPacket.query}`,
          volumeTag,
          typeof event.openInterest === "number"
            ? `Open interest $${event.openInterest.toLocaleString("en-US", {
                maximumFractionDigits: 0,
              })}`
            : "Open interest n/a",
        ],
      });
    }
  }

  for (const queryPacket of newsApiPacket.queries) {
    for (const article of queryPacket.articles.slice(0, 2)) {
      items.push({
        id: `alphavantage-${queryPacket.query}-${article.url ?? article.title}`,
        timestamp: article.publishedAt ?? checkedAt,
        sourceId: "alphavantage",
        sourceLabel: "Alpha Vantage",
        category: "headline",
        title: article.title,
        summary: article.description ?? "Headline returned by Alpha Vantage market news search.",
        symbol: isSimpleTicker(queryPacket.query) ? queryPacket.query : null,
        href: article.url,
        imageUrl: article.imageUrl ?? null,
        meta: [
          `Query: ${queryPacket.query}`,
          article.sourceName ?? "Source n/a",
        ],
      });
    }
  }

  for (const symbolPacket of secPacket.symbols) {
    const filing = symbolPacket.latestFiling;

    if (!filing) {
      continue;
    }

    const factSummary = [
      symbolPacket.facts.revenue?.value ? "Revenue fact" : null,
      symbolPacket.facts.netIncome?.value ? "Net income fact" : null,
      symbolPacket.facts.epsDiluted?.value ? "Diluted EPS fact" : null,
    ]
      .filter(Boolean)
      .join(", ");

    items.push({
      id: `sec-${filing.accessionNumber}`,
      timestamp:
        filing.acceptanceDateTime ??
        filing.filingDate ??
        checkedAt,
      sourceId: "sec",
      sourceLabel: "SEC EDGAR",
      category: "filing",
      title: `${symbolPacket.symbol} ${filing.form}`,
      summary:
        symbolPacket.filingContext?.summary ??
        filing.primaryDocDescription ??
        `${symbolPacket.match?.title ?? symbolPacket.symbol} filing detected.`,
      symbol: symbolPacket.symbol,
      href: filing.filingUrl ?? filing.indexUrl,
      meta: [
        "Filing",
        filing.filingDate ?? "Date n/a",
        symbolPacket.filingContext?.sourceDocumentName ?? "Primary filing document",
        factSummary || "No XBRL facts parsed",
      ],
    });
  }

  return items
    .sort(
      (left, right) =>
        new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime()
    )
    .slice(0, 48);
}

export async function getDashboardResearchData(options?: {
  fresh?: boolean;
}): Promise<DashboardResearchData> {
  if (isDevDashboardBypassEnabled()) {
    return getLocalPreviewResearchData();
  }

  const pool = getAlloyDbPool();
  const [broker, tradeRowsResult] = await Promise.all([
    loadDashboardBrokerSnapshot(options?.fresh),
    queryTradeRows(pool),
  ]);
  const trades = mapTradeRows(tradeRowsResult.rows);
  const checkedAt = new Date().toISOString();
  const watchSymbols = buildResearchWatchSymbols({ broker, trades });
  const equityWatchSymbols = watchSymbols.filter((symbol) => isSimpleTicker(symbol)).slice(0, 4);
  const kalshiQueries = buildKalshiWatchQueries(watchSymbols);
  const polymarketQueries = buildPolymarketWatchQueries(watchSymbols);
  const packets = await getResearchProviderPackets({
    massiveSymbols: watchSymbols.slice(0, 4),
    kalshiQueries,
    polymarketQueries,
    newsQueries: [...equityWatchSymbols.slice(0, 3), "stock market"],
    secSymbols: equityWatchSymbols.slice(0, 4),
  });

  return {
    checkedAt,
    watchSymbols,
    providerDiagnostics: buildProviderDiagnostics({
      broker,
      massivePacket: packets.massivePacket,
      kalshiPacket: packets.kalshiPacket,
      polymarketPacket: packets.polymarketPacket,
      newsApiPacket: packets.newsApiPacket,
      secPacket: packets.secPacket,
    }),
    feed: buildResearchFeed({
      checkedAt,
      massivePacket: packets.massivePacket,
      kalshiPacket: packets.kalshiPacket,
      polymarketPacket: packets.polymarketPacket,
      newsApiPacket: packets.newsApiPacket,
      secPacket: packets.secPacket,
    }),
  };
}

export async function getDashboardQuantLabData(options?: {
  fresh?: boolean;
}): Promise<DashboardQuantLabData> {
  void options;
  return getDashboardQuantLabDataInternal();
}

export async function getDashboardQuantLabCommitDetailData(
  commitId: string
): Promise<DashboardQuantLabCommitDetailData> {
  return getDashboardQuantLabCommitDetailDataInternal(commitId);
}

export const getDashboardAgentFeedSummary = cache(async () => getAgentFeedSummary());

export const getDashboardBrokerSnapshot = getCachedDashboardBrokerSnapshot;
