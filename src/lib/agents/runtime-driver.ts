import "server-only";

import { getAgentFeedSummary } from "@/lib/agents/repository";
import type { RuntimeSessionSnapshot } from "@/lib/agents/types";
import { isAgentSwarmDecommissioned } from "@/lib/agents/decommission";
import { getEffectiveRuntimeSession, runPaperCycle } from "@/lib/agents/runtime";

const INLINE_RETRY_FLOOR_MS = 5_000;

let inlineHeartbeatPromise: Promise<void> | null = null;
let lastInlineHeartbeatAt = 0;

function getHeartbeatIntervalMs(session: RuntimeSessionSnapshot) {
  if (session.pendingResponseRequests.length > 0) {
    switch (session.phase) {
      case "MARKET":
        return 15_000;
      case "PRE_MARKET":
      case "POST_MARKET":
      case "OVERNIGHT":
        return 20_000;
      case "NON_TRADING_DAY":
        return 90_000;
    }
  }

  switch (session.phase) {
    case "MARKET":
      return 15_000;
    case "PRE_MARKET":
    case "POST_MARKET":
    case "OVERNIGHT":
      return 30_000;
    case "NON_TRADING_DAY":
      return 900_000;
  }
}

function getCycleFreshnessWindowMs(session: RuntimeSessionSnapshot) {
  if (session.pendingResponseRequests.length > 0) {
    switch (session.phase) {
      case "MARKET":
        return 90_000;
      case "PRE_MARKET":
      case "POST_MARKET":
      case "OVERNIGHT":
        return 2 * 60_000;
      case "NON_TRADING_DAY":
        return 5 * 60_000;
    }
  }

  switch (session.phase) {
    case "MARKET":
      return 10 * 60_000;
    case "PRE_MARKET":
    case "POST_MARKET":
    case "OVERNIGHT":
      return 15 * 60_000;
    case "NON_TRADING_DAY":
      return 2 * 60 * 60_000;
  }
}

function parseTimestamp(value: string | null) {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function runInlineHeartbeatIfNeeded() {
  if (isAgentSwarmDecommissioned()) {
    return;
  }

  const now = new Date();
  const session = await getEffectiveRuntimeSession(now);

  if (session.activeAgentIds.length === 0) {
    return;
  }

  const summary = await getAgentFeedSummary();
  const latestMessageAt = parseTimestamp(summary.lastEventAt);
  const latestCycleStartedAt = parseTimestamp(summary.lastCycleStartedAt);
  const heartbeatIntervalMs = getHeartbeatIntervalMs(session);
  const cycleFreshnessWindowMs = getCycleFreshnessWindowMs(session);
  const isFeedFresh =
    latestMessageAt !== null && Date.now() - latestMessageAt < heartbeatIntervalMs;
  const isCycleFresh =
    latestCycleStartedAt !== null &&
    Date.now() - latestCycleStartedAt < cycleFreshnessWindowMs;

  if (summary.messageCount > 0 && isFeedFresh) {
    return;
  }

  if (isCycleFresh) {
    return;
  }

  if (Date.now() - lastInlineHeartbeatAt < Math.min(INLINE_RETRY_FLOOR_MS, heartbeatIntervalMs)) {
    return;
  }

  lastInlineHeartbeatAt = Date.now();
  await runPaperCycle();
}

export function scheduleInlinePaperRuntimeHeartbeat() {
  if (isAgentSwarmDecommissioned()) {
    return;
  }

  if (inlineHeartbeatPromise) {
    return;
  }

  inlineHeartbeatPromise = runInlineHeartbeatIfNeeded()
    .catch((error) => {
      console.error("Inline paper runtime heartbeat failed", error);
    })
    .finally(() => {
      inlineHeartbeatPromise = null;
    });
}
