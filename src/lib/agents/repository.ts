import "server-only";

import { randomUUID } from "node:crypto";
import type { PoolClient, QueryResultRow } from "pg";
import { DEFAULT_AGENT_SEEDS } from "@/lib/agents/default-agents";
import type {
  AgentMessageRecord,
  AgentSeed,
  PaperCycleRecord,
} from "@/lib/agents/types";
import { isAgentSwarmDecommissioned } from "@/lib/agents/decommission";
import { getAlloyDbPool } from "@/lib/data/alloydb/client";
import type {
  AlpacaAccountSnapshot,
  BrokerAgentExposure,
  BrokerAttributedPosition,
  AlpacaOrderSnapshot,
  AlpacaPositionSnapshot,
  BrokerDashboardSnapshot,
} from "@/lib/trading/types";

type AgentFeedMessageRow = QueryResultRow & {
  content: string;
  created_at: Date;
  id: string;
  message_type: string;
  payload: Record<string, unknown>;
  priority: AgentMessageRecord["priority"];
  reasoning: string;
  recipient_id: string | null;
  recipient_name: string | null;
  render_type: AgentMessageRecord["renderType"];
  sender_id: string;
  sender_name: string;
  sender_role: string;
};

type PaperCycleRow = QueryResultRow & {
  completed_at: Date | null;
  id: number | string;
  market_status: string;
  regime: string | null;
  run_mode: "PAPER" | "LIVE";
  started_at: Date;
  summary: string | null;
};

type FeedSummaryRow = QueryResultRow & {
  agent_count: string;
  last_cycle_started_at: Date | null;
  last_event_at: Date | null;
  message_count: string;
  paper_cycles: string;
};

type PendingAgentResponseRequestRow = QueryResultRow & {
  content: string;
  created_at: Date;
  id: string;
  message_type: string;
  priority: AgentMessageRecord["priority"];
  recipient_id: string;
  sender_id: string;
};

type AlpacaAccountSnapshotRow = QueryResultRow & {
  account_id: string;
  account_status: string | null;
  buying_power: string | null;
  captured_at: Date;
  cash: string | null;
  daytrade_count: number | null;
  equity: string | null;
  id: string | number;
  portfolio_value: string | null;
};

type AlpacaPositionSnapshotRow = QueryResultRow & {
  current_price: string | null;
  market_value: string | null;
  qty: string | null;
  side: string | null;
  symbol: string;
  unrealized_pl: string | null;
};

type AlpacaOrderRow = QueryResultRow & {
  agent_id: string | null;
  broker_order_id: string;
  client_order_id: string | null;
  notional: string | null;
  qty: string | null;
  side: string;
  status: string;
  submitted_at: Date | null;
  symbol: string;
  updated_at: Date | null;
};

type AgentOrderAttributionRow = QueryResultRow & {
  agent_id: string;
  last_order_at: Date | null;
  net_submitted_notional: string | null;
  order_count: string;
  symbol: string;
};

type TradingAgentAllocationInputRow = QueryResultRow & {
  average_confidence_score: string | null;
  current_allocation_usd: string | null;
  display_name: string;
  high_priority_message_count: string;
  id: string;
  last_message_at: Date | null;
  last_order_at: Date | null;
  max_allocation_usd: string | null;
  recent_accepted_order_count: string;
  recent_message_count: string;
  recent_order_count: string;
  role: string;
  strategy_category: string | null;
};

export type AgentCycleArtifactScope =
  | "RESEARCH_PLAN"
  | "RESEARCH_PACKET"
  | "DECISION_CONTEXT"
  | "DECISION_OUTPUT"
  | "BROKER_EXECUTION"
  | "BROKER_STATE"
  | "RUNTIME_FAILURE";

export type AgentCycleArtifactStorageTier = "HOT" | "COLD";

export type CioAllocationInput = {
  agentId: string;
  displayName: string;
  role: string;
  strategyCategory: string | null;
  currentAllocationUsd: number | null;
  maxAllocationUsd: number | null;
  recentMessageCount: number;
  highPriorityMessageCount: number;
  recentOrderCount: number;
  recentAcceptedOrderCount: number;
  averageConfidenceScore: number | null;
  attributedMarketValue: number | null;
  attributedUnrealizedPl: number | null;
  positionCount: number;
  lastOrderAt: string | null;
  lastMessageAt: string | null;
};

export type FeedSummary = {
  agentCount: number;
  lastCycleStartedAt: string | null;
  lastEventAt: string | null;
  messageCount: number;
  paperCycles: number;
};

export type PendingAgentResponseRequest = {
  messageId: string;
  senderId: string;
  recipientId: string;
  messageType: string;
  priority: AgentMessageRecord["priority"];
  content: string;
  createdAt: string;
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

function normalizeBrokerSymbol(symbol: string | null | undefined) {
  if (typeof symbol !== "string") {
    return null;
  }

  const normalized = symbol.trim().toUpperCase();
  return normalized.length > 0 ? normalized : null;
}

function roundNullable(value: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return Number(value.toFixed(2));
}

function laterIsoTimestamp(left: Date | null, right: Date | null) {
  if (!left) {
    return right;
  }

  if (!right) {
    return left;
  }

  return left.getTime() >= right.getTime() ? left : right;
}

function buildAttributedPositionOwnership(
  positions: Array<{
    symbol: string;
    side: string | null;
    qty: string | number | null;
    market_value: string | number | null;
    unrealized_pl: string | number | null;
    current_price: string | number | null;
  }>,
  attributionRows: AgentOrderAttributionRow[]
) {
  const attributionBySymbol = new Map<string, AgentOrderAttributionRow[]>();

  for (const row of attributionRows) {
    const symbol = normalizeBrokerSymbol(row.symbol);

    if (!symbol) {
      continue;
    }

    const list = attributionBySymbol.get(symbol) ?? [];
    list.push(row);
    attributionBySymbol.set(symbol, list);
  }

  const attributedPositions: BrokerAttributedPosition[] = positions.map((row) => {
    const symbol = normalizeBrokerSymbol(row.symbol);
    const qty = parseNumeric(row.qty);
    const marketValue = parseNumeric(row.market_value);
    const unrealizedPl = parseNumeric(row.unrealized_pl);
    const mergedOwners = new Map<
      string,
      {
        agentId: string;
        baseNotional: number;
        orderCount: number;
        lastOrderAt: Date | null;
      }
    >();

    for (const owner of (symbol ? attributionBySymbol.get(symbol) : []) ?? []) {
      const baseNotional = Math.abs(parseNumeric(owner.net_submitted_notional) ?? 0);

      if (baseNotional <= 0) {
        continue;
      }

      const existing = mergedOwners.get(owner.agent_id);

      if (existing) {
        existing.baseNotional += baseNotional;
        existing.orderCount += Number(owner.order_count ?? 0);
        existing.lastOrderAt = laterIsoTimestamp(existing.lastOrderAt, owner.last_order_at);
        continue;
      }

      mergedOwners.set(owner.agent_id, {
        agentId: owner.agent_id,
        baseNotional,
        orderCount: Number(owner.order_count ?? 0),
        lastOrderAt: owner.last_order_at,
      });
    }

    const owners = [...mergedOwners.values()].sort(
      (left, right) =>
        right.baseNotional - left.baseNotional || left.agentId.localeCompare(right.agentId)
    );
    const totalBaseNotional = owners.reduce((sum, owner) => sum + owner.baseNotional, 0);

    const normalizedOwners = owners.map((owner) => {
      const ratio = totalBaseNotional > 0 ? owner.baseNotional / totalBaseNotional : 0;

      return {
        agentId: owner.agentId,
        attributedQty: roundNullable(typeof qty === "number" ? qty * ratio : null),
        attributedMarketValue: roundNullable(
          typeof marketValue === "number" ? marketValue * ratio : null
        ),
        attributedUnrealizedPl: roundNullable(
          typeof unrealizedPl === "number" ? unrealizedPl * ratio : null
        ),
        netSubmittedNotional: roundNullable(owner.baseNotional),
        orderCount: owner.orderCount,
        lastOrderAt: owner.lastOrderAt ? owner.lastOrderAt.toISOString() : null,
      };
    });

    const attributedMarketValue = normalizedOwners.reduce(
      (sum, owner) => sum + (owner.attributedMarketValue ?? 0),
      0
    );
    const attributedQty = normalizedOwners.reduce(
      (sum, owner) => sum + (owner.attributedQty ?? 0),
      0
    );
    const attributedUnrealizedPl = normalizedOwners.reduce(
      (sum, owner) => sum + (owner.attributedUnrealizedPl ?? 0),
      0
    );

    return {
      symbol: row.symbol,
      side: row.side,
      qty,
      marketValue,
      unrealizedPl,
      currentPrice: parseNumeric(row.current_price),
      owners: normalizedOwners,
      unattributedQty: roundNullable(typeof qty === "number" ? qty - attributedQty : null),
      unattributedMarketValue: roundNullable(
        typeof marketValue === "number" ? marketValue - attributedMarketValue : null
      ),
      unattributedUnrealizedPl: roundNullable(
        typeof unrealizedPl === "number" ? unrealizedPl - attributedUnrealizedPl : null
      ),
    };
  });

  const agentExposureMap = new Map<string, BrokerAgentExposure>();

  for (const position of attributedPositions) {
    for (const owner of position.owners) {
      const current = agentExposureMap.get(owner.agentId) ?? {
        agentId: owner.agentId,
        positionCount: 0,
        attributedMarketValue: 0,
        attributedUnrealizedPl: 0,
      };

      current.positionCount += 1;
      current.attributedMarketValue =
        (current.attributedMarketValue ?? 0) + (owner.attributedMarketValue ?? 0);
      current.attributedUnrealizedPl =
        (current.attributedUnrealizedPl ?? 0) + (owner.attributedUnrealizedPl ?? 0);

      agentExposureMap.set(owner.agentId, current);
    }
  }

  const agentExposure = [...agentExposureMap.values()]
    .map((row) => ({
      ...row,
      attributedMarketValue: roundNullable(row.attributedMarketValue),
      attributedUnrealizedPl: roundNullable(row.attributedUnrealizedPl),
    }))
    .sort(
      (left, right) =>
        Math.abs(right.attributedMarketValue ?? 0) -
        Math.abs(left.attributedMarketValue ?? 0)
    );

  return {
    attributedPositions,
    agentExposure,
  };
}

async function upsertAgent(client: PoolClient, seed: AgentSeed) {
  await client.query(
    `
      insert into agents (
        id,
        display_name,
        role,
        tier,
        reports_to,
        strategy_category,
        status,
        paper_enabled,
        current_allocation_usd,
        max_allocation_usd,
        metadata,
        updated_at
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, now())
      on conflict (id) do update
      set
        display_name = excluded.display_name,
        role = excluded.role,
        tier = excluded.tier,
        reports_to = excluded.reports_to,
        strategy_category = excluded.strategy_category,
        status = excluded.status,
        paper_enabled = excluded.paper_enabled,
        current_allocation_usd = coalesce(agents.current_allocation_usd, excluded.current_allocation_usd),
        max_allocation_usd = excluded.max_allocation_usd,
        metadata = excluded.metadata,
        updated_at = now()
    `,
    [
      seed.id,
      seed.displayName,
      seed.role,
      seed.tier,
      seed.reportsTo,
      seed.strategyCategory,
      seed.status,
      seed.paperEnabled,
      seed.currentAllocationUsd,
      seed.maxAllocationUsd,
      JSON.stringify(seed.metadata),
    ]
  );

  await client.query(
    `
      insert into agent_configs (
        agent_id,
        objective_function,
        system_prompt,
        subscriptions,
        direct_reports,
        constraints,
        config,
        updated_at
      )
      values ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb, now())
      on conflict (agent_id) do update
      set
        objective_function = excluded.objective_function,
        system_prompt = excluded.system_prompt,
        subscriptions = excluded.subscriptions,
        direct_reports = excluded.direct_reports,
        constraints = excluded.constraints,
        config = excluded.config,
        updated_at = now()
    `,
    [
      seed.id,
      seed.objectiveFunction,
      seed.systemPrompt,
      JSON.stringify(seed.subscriptions),
      JSON.stringify(seed.directReports),
      JSON.stringify(seed.constraints),
      JSON.stringify(seed.config),
    ]
  );
}

function mapPaperCycle(row: PaperCycleRow): PaperCycleRecord {
  return {
    id: Number(row.id),
    runMode: row.run_mode,
    marketStatus: row.market_status,
    regime: row.regime,
    summary: row.summary,
    startedAt: row.started_at.toISOString(),
    completedAt: row.completed_at ? row.completed_at.toISOString() : null,
  };
}

function mapAgentMessage(row: AgentFeedMessageRow): AgentMessageRecord {
  return {
    id: row.id,
    timestamp: row.created_at.toISOString(),
    senderId: row.sender_id,
    senderName: row.sender_name,
    senderRole: row.sender_role,
    recipientId: row.recipient_id,
    recipientName: row.recipient_name,
    messageType: row.message_type,
    priority: row.priority,
    renderType: row.render_type,
    content: row.content,
    reasoning: row.reasoning,
    payload: row.payload ?? {},
  };
}

export async function withAgentTransaction<T>(
  fn: (client: PoolClient) => Promise<T>
) {
  const pool = getAlloyDbPool();
  const client = await pool.connect();

  try {
    await client.query("begin");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function ensureAgentRegistrySeeded(client?: PoolClient) {
  if (isAgentSwarmDecommissioned()) {
    const disableQuery = `
      update agents
      set
        status = 'OFFLINE',
        paper_enabled = false,
        updated_at = now()
    `;

    if (client) {
      await client.query(disableQuery);
      return;
    }

    await withAgentTransaction(async (tx) => {
      await tx.query(disableQuery);
    });
    return;
  }

  const seedIds = DEFAULT_AGENT_SEEDS.map((seed) => seed.id);

  if (client) {
    for (const seed of DEFAULT_AGENT_SEEDS) {
      await upsertAgent(client, seed);
    }

    await client.query(
      `
        update agents
        set
          status = 'OFFLINE',
          paper_enabled = false,
          updated_at = now()
        where id <> all($1::text[])
      `,
      [seedIds]
    );
    return;
  }

  await withAgentTransaction(async (tx) => {
    for (const seed of DEFAULT_AGENT_SEEDS) {
      await upsertAgent(tx, seed);
    }

    await tx.query(
      `
        update agents
        set
          status = 'OFFLINE',
          paper_enabled = false,
          updated_at = now()
        where id <> all($1::text[])
      `,
      [seedIds]
    );
  });
}

export async function getAgentMessageCount(client?: PoolClient) {
  const runner = client ?? getAlloyDbPool();
  const result = await runner.query<{ count: string }>(
    `
      select count(*)::text as count
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
    `
  );

  return Number(result.rows[0]?.count ?? 0);
}

export async function getLatestPaperCycleIndex(client?: PoolClient) {
  const runner = client ?? getAlloyDbPool();
  const result = await runner.query<{ id: number | null }>(
    "select max(id) as id from agent_cycles where run_mode = 'PAPER'"
  );

  return Number(result.rows[0]?.id ?? 0);
}

export async function insertPaperCycle(
  client: PoolClient,
  input: {
    marketStatus: string;
    regime: string;
    summary: string;
  }
) {
  const result = await client.query<PaperCycleRow>(
    `
      insert into agent_cycles (run_mode, market_status, regime, summary)
      values ('PAPER', $1, $2, $3)
      returning id, run_mode, market_status, regime, summary, started_at, completed_at
    `,
    [input.marketStatus, input.regime, input.summary]
  );

  return mapPaperCycle(result.rows[0]);
}

export async function completePaperCycle(
  client: PoolClient,
  cycleId: number,
  summary: string
) {
  const result = await client.query<PaperCycleRow>(
    `
      update agent_cycles
      set summary = $2, completed_at = now()
      where id = $1
      returning id, run_mode, market_status, regime, summary, started_at, completed_at
    `,
    [cycleId, summary]
  );

  return mapPaperCycle(result.rows[0]);
}

export async function updatePaperCycleRegime(
  client: PoolClient,
  input: {
    cycleId: number;
    regime: string;
    summary?: string | null;
  }
) {
  const result = await client.query<PaperCycleRow>(
    `
      update agent_cycles
      set
        regime = $2,
        summary = coalesce($3, summary)
      where id = $1
      returning id, run_mode, market_status, regime, summary, started_at, completed_at
    `,
    [input.cycleId, input.regime, input.summary ?? null]
  );

  return mapPaperCycle(result.rows[0]);
}

export async function insertAgentMessage(
  client: PoolClient,
  input: {
    cycleId: number;
    senderId: string;
    recipientId?: string | null;
    messageType: string;
    priority: string;
    renderType: string;
    content: string;
    reasoning: string;
    payload: Record<string, unknown>;
    requiresResponse?: boolean;
    createdAt: Date;
  }
) {
  const id = randomUUID();

  await client.query(
    `
      insert into agent_messages (
        id,
        cycle_id,
        sender_id,
        recipient_id,
        message_type,
        priority,
        render_type,
        content,
        reasoning,
        payload,
        requires_response,
        created_at
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
        $9,
        $10::jsonb,
        $11,
        $12
      )
    `,
    [
      id,
      input.cycleId,
      input.senderId,
      input.recipientId ?? null,
      input.messageType,
      input.priority,
      input.renderType,
      input.content,
      input.reasoning,
      JSON.stringify(input.payload),
      Boolean(input.requiresResponse),
      input.createdAt,
    ]
  );

  return id;
}

export async function hasRecentAgentMessageByDedupeKey(
  client: PoolClient,
  input: {
    senderId?: string | null;
    dedupeKey: string;
    withinMinutes: number;
  }
) {
  const result = await client.query<{ has_recent: boolean }>(
    `
      select exists(
        select 1
        from agent_messages
        where ($1::text is null or sender_id = $1)
          and payload->>'dedupeKey' = $2
          and created_at >= now() - ($3::int * interval '1 minute')
      ) as has_recent
    `,
    [input.senderId ?? null, input.dedupeKey, Math.max(1, Math.round(input.withinMinutes))]
  );

  return result.rows[0]?.has_recent ?? false;
}

export async function getPendingAgentResponseRequests(
  limit = 12,
  withinHours = 12
) {
  const result = await getAlloyDbPool().query<PendingAgentResponseRequestRow>(
    `
      select
        m.id::text as id,
        m.created_at,
        m.sender_id,
        m.recipient_id,
        m.message_type,
        m.priority,
        m.content
      from agent_messages m
      join agents sender on sender.id = m.sender_id
      join agents recipient on recipient.id = m.recipient_id
      where m.recipient_id is not null
        and coalesce(m.requires_response, false) = true
        and m.created_at >= now() - ($2::int * interval '1 hour')
        and sender.paper_enabled = true
        and sender.status in ('ACTIVE', 'PAPER')
        and recipient.paper_enabled = true
        and recipient.status in ('ACTIVE', 'PAPER')
        and not exists (
          select 1
          from agent_messages response
          where response.sender_id = m.recipient_id
            and response.created_at > m.created_at
            and (
              response.recipient_id is null
              or response.recipient_id = m.sender_id
            )
        )
      order by m.created_at desc, m.id desc
      limit $1
    `,
    [Math.max(1, limit), Math.max(1, Math.round(withinHours))]
  );

  return result.rows.map((row) => ({
    messageId: row.id,
    senderId: row.sender_id,
    recipientId: row.recipient_id,
    messageType: row.message_type,
    priority: row.priority,
    content: row.content,
    createdAt: row.created_at.toISOString(),
  })) satisfies PendingAgentResponseRequest[];
}

export async function insertAgentDecision(
  client: PoolClient,
  input: {
    cycleId: number;
    agentId: string;
    relatedMessageId: string;
    actionTaken: string;
    reasoning: string;
    dataConsumed: unknown[];
    confidenceScore: number;
    createdAt: Date;
  }
) {
  await client.query(
    `
      insert into agent_decisions (
        id,
        cycle_id,
        agent_id,
        related_message_id,
        action_taken,
        reasoning,
        data_consumed,
        confidence_score,
        created_at
      )
      values (
        $1::uuid,
        $2,
        $3,
        $4::uuid,
        $5,
        $6,
        $7::jsonb,
        $8,
        $9
      )
    `,
    [
      randomUUID(),
      input.cycleId,
      input.agentId,
      input.relatedMessageId,
      input.actionTaken,
      input.reasoning,
      JSON.stringify(input.dataConsumed),
      input.confidenceScore,
      input.createdAt,
    ]
  );
}

export async function upsertAgentCycleArtifact(
  client: PoolClient,
  input: {
    cycleId: number;
    artifactScope: AgentCycleArtifactScope;
    artifactKey: string;
    storageTier: AgentCycleArtifactStorageTier;
    summary: string;
    payload: unknown;
    createdAt: Date;
  }
) {
  const id = randomUUID();

  await client.query(
    `
      insert into agent_cycle_artifacts (
        id,
        cycle_id,
        artifact_scope,
        artifact_key,
        storage_tier,
        summary,
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
        $7::jsonb,
        $8,
        $8
      )
      on conflict (cycle_id, artifact_scope, artifact_key)
      do update set
        storage_tier = excluded.storage_tier,
        summary = excluded.summary,
        payload = excluded.payload,
        updated_at = excluded.updated_at
    `,
    [
      id,
      input.cycleId,
      input.artifactScope,
      input.artifactKey,
      input.storageTier,
      input.summary,
      JSON.stringify(input.payload),
      input.createdAt,
    ]
  );
}

export async function getAgentFeedMessages(limit = 40) {
  const result = await getAlloyDbPool().query<AgentFeedMessageRow>(
    `
      select
        m.id::text as id,
        m.created_at,
        m.sender_id,
        sender.display_name as sender_name,
        sender.role as sender_role,
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
      where sender.paper_enabled = true
        and sender.status in ('ACTIVE', 'PAPER')
        and (
          m.recipient_id is null
          or (
            recipient.paper_enabled = true
            and recipient.status in ('ACTIVE', 'PAPER')
          )
        )
      order by m.created_at desc, m.id desc
      limit $1
    `,
    [limit]
  );

  return result.rows.map(mapAgentMessage);
}

export async function getAgentFeedSummary() {
  const result = await getAlloyDbPool().query<FeedSummaryRow>(
    `
      select
        (
          select count(*)::text
          from agents
          where paper_enabled = true
            and status in ('ACTIVE', 'PAPER')
        ) as agent_count,
        (
          select count(*)::text
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
        ) as message_count,
        (select count(*)::text from agent_cycles where run_mode = 'PAPER') as paper_cycles,
        (
          select max(started_at)
          from agent_cycles
          where run_mode = 'PAPER'
        ) as last_cycle_started_at,
        (
          select max(m.created_at)
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
        ) as last_event_at
    `
  );

  const row = result.rows[0];

  return {
    agentCount: Number(row?.agent_count ?? 0),
    lastCycleStartedAt: row?.last_cycle_started_at
      ? row.last_cycle_started_at.toISOString()
      : null,
    messageCount: Number(row?.message_count ?? 0),
    paperCycles: Number(row?.paper_cycles ?? 0),
    lastEventAt: row?.last_event_at ? row.last_event_at.toISOString() : null,
  } satisfies FeedSummary;
}

export async function insertAlpacaAccountSnapshot(
  client: PoolClient,
  input: {
    cycleId: number | null;
    snapshot: AlpacaAccountSnapshot;
    capturedAt: Date;
  }
) {
  const result = await client.query<{ id: number | string }>(
    `
      insert into alpaca_account_snapshots (
        cycle_id,
        account_id,
        account_status,
        equity,
        cash,
        buying_power,
        portfolio_value,
        long_market_value,
        short_market_value,
        multiplier,
        daytrade_count,
        pattern_day_trader,
        alpaca_request_id,
        raw_payload,
        captured_at
      )
      values (
        $1,
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
        $12,
        $13,
        $14::jsonb,
        $15
      )
      returning id
    `,
    [
      input.cycleId,
      input.snapshot.accountId,
      input.snapshot.status,
      input.snapshot.equity,
      input.snapshot.cash,
      input.snapshot.buyingPower,
      input.snapshot.portfolioValue,
      input.snapshot.longMarketValue,
      input.snapshot.shortMarketValue,
      input.snapshot.multiplier,
      input.snapshot.daytradeCount,
      input.snapshot.patternDayTrader,
      input.snapshot.requestId,
      JSON.stringify(input.snapshot.raw),
      input.capturedAt,
    ]
  );

  return Number(result.rows[0]?.id ?? 0);
}

export async function insertAlpacaPositionSnapshots(
  client: PoolClient,
  input: {
    accountSnapshotId: number;
    positions: AlpacaPositionSnapshot[];
    capturedAt: Date;
  }
) {
  if (input.positions.length === 0) {
    return;
  }

  for (const position of input.positions) {
    await client.query(
      `
        insert into alpaca_position_snapshots (
          account_snapshot_id,
          symbol,
          side,
          qty,
          avg_entry_price,
          market_value,
          cost_basis,
          unrealized_pl,
          current_price,
          exchange,
          asset_class,
          raw_payload,
          captured_at
        )
        values (
          $1,
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
          $12::jsonb,
          $13
        )
      `,
      [
        input.accountSnapshotId,
        position.symbol,
        position.side,
        position.qty,
        position.avgEntryPrice,
        position.marketValue,
        position.costBasis,
        position.unrealizedPl,
        position.currentPrice,
        position.exchange,
        position.assetClass,
        JSON.stringify(position.raw),
        input.capturedAt,
      ]
    );
  }
}

export async function upsertAlpacaOrder(
  client: PoolClient,
  input: {
    cycleId: number | null;
    agentId: string | null;
    reasoning: string;
    requestPayload: Record<string, unknown>;
    order: AlpacaOrderSnapshot;
  }
) {
  await client.query(
    `
      insert into alpaca_orders (
        id,
        cycle_id,
        agent_id,
        broker_order_id,
        client_order_id,
        symbol,
        side,
        order_type,
        time_in_force,
        qty,
        notional,
        filled_qty,
        filled_avg_price,
        status,
        submitted_reasoning,
        request_payload,
        response_payload,
        alpaca_request_id,
        submitted_at,
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
        $9,
        $10,
        $11,
        $12,
        $13,
        $14,
        $15,
        $16::jsonb,
        $17::jsonb,
        $18,
        $19,
        $20
      )
      on conflict (broker_order_id) do update
      set
        cycle_id = excluded.cycle_id,
        agent_id = excluded.agent_id,
        client_order_id = excluded.client_order_id,
        symbol = excluded.symbol,
        side = excluded.side,
        order_type = excluded.order_type,
        time_in_force = excluded.time_in_force,
        qty = excluded.qty,
        notional = excluded.notional,
        filled_qty = excluded.filled_qty,
        filled_avg_price = excluded.filled_avg_price,
        status = excluded.status,
        submitted_reasoning = excluded.submitted_reasoning,
        request_payload = excluded.request_payload,
        response_payload = excluded.response_payload,
        alpaca_request_id = excluded.alpaca_request_id,
        submitted_at = excluded.submitted_at,
        updated_at = excluded.updated_at
    `,
    [
      randomUUID(),
      input.cycleId,
      input.agentId,
      input.order.brokerOrderId,
      input.order.clientOrderId,
      input.order.symbol,
      input.order.side,
      input.order.orderType,
      input.order.timeInForce,
      input.order.qty,
      input.order.notional,
      input.order.filledQty,
      input.order.filledAvgPrice,
      input.order.status,
      input.reasoning,
      JSON.stringify(input.requestPayload),
      JSON.stringify(input.order.raw),
      input.order.requestId,
      input.order.submittedAt,
      input.order.updatedAt,
    ]
  );
}

export async function getCioAllocationInputs(
  brokerSnapshot?: BrokerDashboardSnapshot
): Promise<CioAllocationInput[]> {
  const runner = getAlloyDbPool();
  const exposureByAgent = new Map(
    (brokerSnapshot ?? (await getBrokerDashboardSnapshot())).agentExposure.map((row) => [
      row.agentId,
      row,
    ])
  );

  const result = await runner.query<TradingAgentAllocationInputRow>(
    `
      select
        a.id,
        a.display_name,
        a.role,
        a.strategy_category,
        a.current_allocation_usd,
        a.max_allocation_usd,
        (
          select count(*)::text
          from agent_messages m
          where m.sender_id = a.id
            and m.created_at >= now() - interval '7 days'
        ) as recent_message_count,
        (
          select count(*)::text
          from agent_messages m
          where m.sender_id = a.id
            and m.priority in ('HIGH', 'CRITICAL')
            and m.created_at >= now() - interval '7 days'
        ) as high_priority_message_count,
        (
          select max(m.created_at)
          from agent_messages m
          where m.sender_id = a.id
        ) as last_message_at,
        (
          select count(*)::text
          from alpaca_orders o
          where o.agent_id = a.id
            and coalesce(o.updated_at, o.submitted_at) >= now() - interval '14 days'
        ) as recent_order_count,
        (
          select count(*)::text
          from alpaca_orders o
          where o.agent_id = a.id
            and lower(o.status) in ('accepted', 'new', 'partially_filled', 'filled')
            and coalesce(o.updated_at, o.submitted_at) >= now() - interval '14 days'
        ) as recent_accepted_order_count,
        (
          select max(coalesce(o.updated_at, o.submitted_at))
          from alpaca_orders o
          where o.agent_id = a.id
        ) as last_order_at,
        (
          select round(avg(d.confidence_score)::numeric, 2)::text
          from agent_decisions d
          where d.agent_id = a.id
            and d.created_at >= now() - interval '7 days'
        ) as average_confidence_score
      from agents a
      where a.paper_enabled = true
        and a.status in ('ACTIVE', 'PAPER')
        and a.strategy_category is not null
      order by a.id asc
    `
  );

  return result.rows.map((row) => {
    const exposure = exposureByAgent.get(row.id);

    return {
      agentId: row.id,
      displayName: row.display_name,
      role: row.role,
      strategyCategory: row.strategy_category,
      currentAllocationUsd: parseNumeric(row.current_allocation_usd),
      maxAllocationUsd: parseNumeric(row.max_allocation_usd),
      recentMessageCount: Number(row.recent_message_count ?? 0),
      highPriorityMessageCount: Number(row.high_priority_message_count ?? 0),
      recentOrderCount: Number(row.recent_order_count ?? 0),
      recentAcceptedOrderCount: Number(row.recent_accepted_order_count ?? 0),
      averageConfidenceScore: parseNumeric(row.average_confidence_score),
      attributedMarketValue: exposure?.attributedMarketValue ?? null,
      attributedUnrealizedPl: exposure?.attributedUnrealizedPl ?? null,
      positionCount: exposure?.positionCount ?? 0,
      lastOrderAt: row.last_order_at ? row.last_order_at.toISOString() : null,
      lastMessageAt: row.last_message_at ? row.last_message_at.toISOString() : null,
    };
  });
}

export async function insertAgentAllocationEvent(
  client: PoolClient,
  input: {
    cycleId: number | null;
    agentId: string;
    previousAllocationUsd: number | null;
    newAllocationUsd: number;
    rationale: string;
    inputs: Record<string, unknown>;
    createdAt: Date;
  }
) {
  await client.query(
    `
      insert into agent_allocation_events (
        id,
        cycle_id,
        agent_id,
        previous_allocation_usd,
        new_allocation_usd,
        rationale,
        inputs,
        created_at
      )
      values (
        $1::uuid,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7::jsonb,
        $8
      )
    `,
    [
      randomUUID(),
      input.cycleId,
      input.agentId,
      input.previousAllocationUsd,
      input.newAllocationUsd,
      input.rationale,
      JSON.stringify(input.inputs),
      input.createdAt,
    ]
  );

  await client.query(
    `
      update agents
      set current_allocation_usd = $2,
          updated_at = now()
      where id = $1
    `,
    [input.agentId, input.newAllocationUsd]
  );
}

export async function getBrokerDashboardSnapshot(): Promise<BrokerDashboardSnapshot> {
  const latestAccountResult = await getAlloyDbPool().query<AlpacaAccountSnapshotRow>(
    `
      select
        id,
        account_id,
        account_status,
        equity,
        cash,
        buying_power,
        portfolio_value,
        daytrade_count,
        captured_at
      from alpaca_account_snapshots
      order by captured_at desc, id desc
      limit 1
    `
  );

  const latestAccount = latestAccountResult.rows[0];

  if (!latestAccount) {
    return {
      configured: true,
      connected: false,
      provider: "ALPACA_PAPER",
      account: null,
      openPositions: [],
      attributedPositions: [],
      agentExposure: [],
      recentOrders: [],
    };
  }

  const [positionsResult, ordersResult, attributionResult] = await Promise.all([
    getAlloyDbPool().query<AlpacaPositionSnapshotRow>(
      `
        select
          symbol,
          side,
          qty,
          market_value,
          unrealized_pl,
          current_price
        from alpaca_position_snapshots
        where account_snapshot_id = $1
        order by abs(coalesce(market_value, 0)) desc, symbol asc
      `,
      [latestAccount.id]
    ),
    getAlloyDbPool().query<AlpacaOrderRow>(
      `
        select
          broker_order_id,
          client_order_id,
          agent_id,
          symbol,
          side,
          status,
          qty,
          notional,
          submitted_at,
          updated_at
        from alpaca_orders
        order by coalesce(updated_at, submitted_at) desc nulls last, broker_order_id desc
        limit 10
      `
    ),
    getAlloyDbPool().query<AgentOrderAttributionRow>(
      `
        with expanded_order_symbols as (
          select
            o.agent_id,
            attribution_symbol.symbol,
            o.side,
            o.filled_qty,
            o.filled_avg_price,
            o.notional,
            o.updated_at,
            o.submitted_at,
            o.broker_order_id
          from alpaca_orders o
          cross join lateral (
            with leg_symbols as (
              select distinct upper(nullif(btrim(leg ->> 'symbol'), '')) as symbol
              from (
                select jsonb_array_elements(
                  case
                    when jsonb_typeof(o.response_payload -> 'legs') = 'array'
                      then o.response_payload -> 'legs'
                    else '[]'::jsonb
                  end
                ) as leg
                union all
                select jsonb_array_elements(
                  case
                    when jsonb_typeof(o.request_payload -> 'legs') = 'array'
                      then o.request_payload -> 'legs'
                    else '[]'::jsonb
                  end
                ) as leg
              ) extracted_legs
              where nullif(btrim(leg ->> 'symbol'), '') is not null
            )
            select symbol
            from leg_symbols
            union all
            select upper(nullif(btrim(o.symbol), ''))
            where not exists (select 1 from leg_symbols)
          ) attribution_symbol
          where o.agent_id is not null
            and lower(o.status) not in ('rejected', 'canceled', 'cancelled', 'expired')
            and attribution_symbol.symbol is not null
        )
        select
          agent_id,
          symbol,
          count(distinct broker_order_id)::text as order_count,
          max(coalesce(updated_at, submitted_at)) as last_order_at,
          sum(
            case
              when lower(side) = 'buy' then coalesce(filled_qty * filled_avg_price, notional, 0)
              when lower(side) = 'sell' then -coalesce(filled_qty * filled_avg_price, notional, 0)
              else 0
            end
          )::text as net_submitted_notional
        from expanded_order_symbols
        group by agent_id, symbol
      `
    ),
  ]);
  const { attributedPositions, agentExposure } = buildAttributedPositionOwnership(
    positionsResult.rows,
    attributionResult.rows
  );

  return {
    configured: true,
    connected: true,
    provider: "ALPACA_PAPER",
    account: {
      accountId: latestAccount.account_id,
      status: latestAccount.account_status,
      equity: parseNumeric(latestAccount.equity),
      cash: parseNumeric(latestAccount.cash),
      buyingPower: parseNumeric(latestAccount.buying_power),
      portfolioValue: parseNumeric(latestAccount.portfolio_value),
      lastSyncedAt: latestAccount.captured_at.toISOString(),
    },
    openPositions: positionsResult.rows.map((row) => ({
      symbol: row.symbol,
      side: row.side,
      qty: parseNumeric(row.qty),
      marketValue: parseNumeric(row.market_value),
      unrealizedPl: parseNumeric(row.unrealized_pl),
      currentPrice: parseNumeric(row.current_price),
    })),
    attributedPositions,
    agentExposure,
    recentOrders: ordersResult.rows.map((row) => ({
      brokerOrderId: row.broker_order_id,
      clientOrderId: row.client_order_id,
      agentId: row.agent_id,
      symbol: row.symbol,
      side: row.side,
      status: row.status,
      qty: parseNumeric(row.qty),
      notional: parseNumeric(row.notional),
      submittedAt: row.submitted_at ? row.submitted_at.toISOString() : null,
      updatedAt: row.updated_at ? row.updated_at.toISOString() : null,
    })),
  };
}
