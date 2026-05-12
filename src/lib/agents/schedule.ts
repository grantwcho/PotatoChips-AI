import "server-only";

import type {
  OvernightRiskMonitorSnapshot,
  RuntimePhase,
  RuntimeSessionSnapshot,
} from "@/lib/agents/types";
import { CORE_DESK_AGENT_IDS } from "@/lib/agents/core-agent-config";
import { isAgentSwarmDecommissioned } from "@/lib/agents/decommission";
import { TRADING_AGENT_IDS } from "@/lib/agents/trading-agent-config";
import { recordApiActivityEventSafe } from "@/lib/data/alloydb/api-activity";

const ALL_SWARM_AGENTS = [
  ...CORE_DESK_AGENT_IDS,
  ...TRADING_AGENT_IDS,
] as const;

const MARKET_TIMEZONE = "America/New_York";
const OPERATOR_TIMEZONE = "America/Los_Angeles";

function isForceAllAgentsActiveEnabled() {
  return process.env.AGENT_FORCE_ALL_ACTIVE?.trim().toLowerCase() === "true";
}

function isForceAllAgentsIdleEnabled() {
  return process.env.AGENT_FORCE_ALL_IDLE?.trim().toLowerCase() === "true";
}

const SESSION_WINDOWS: Record<
  RuntimePhase,
  {
    windowEt: string;
    windowPt: string;
  }
> = {
  PRE_MARKET: {
    windowEt: "08:30-09:30 ET",
    windowPt: "05:30-06:30 PT",
  },
  MARKET: {
    windowEt: "09:30-16:00 ET",
    windowPt: "06:30-13:00 PT",
  },
  POST_MARKET: {
    windowEt: "16:00-17:00 ET",
    windowPt: "13:00-14:00 PT",
  },
  OVERNIGHT: {
    windowEt: "17:00-08:30 ET",
    windowPt: "14:00-05:30 PT",
  },
  NON_TRADING_DAY: {
    windowEt: "All day ET",
    windowPt: "All day PT",
  },
};

function getEasternParts(now: Date) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: MARKET_TIMEZONE,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(now);
  const weekday = parts.find((part) => part.type === "weekday")?.value ?? "Mon";
  const year = Number(parts.find((part) => part.type === "year")?.value ?? "1970");
  const month = Number(parts.find((part) => part.type === "month")?.value ?? "1");
  const day = Number(parts.find((part) => part.type === "day")?.value ?? "1");
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");

  return {
    weekday,
    year,
    month,
    day,
    totalMinutes: hour * 60 + minute,
  };
}

function getUtcWeekday(year: number, month: number, day: number) {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function addUtcDays(
  date: { year: number; month: number; day: number },
  offsetDays: number
) {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day));
  shifted.setUTCDate(shifted.getUTCDate() + offsetDays);

  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

function getObservedFixedHolidayDate(year: number, month: number, day: number) {
  const observed = new Date(Date.UTC(year, month - 1, day));
  const weekday = observed.getUTCDay();

  if (weekday === 6) {
    observed.setUTCDate(observed.getUTCDate() - 1);
  } else if (weekday === 0) {
    observed.setUTCDate(observed.getUTCDate() + 1);
  }

  return {
    year: observed.getUTCFullYear(),
    month: observed.getUTCMonth() + 1,
    day: observed.getUTCDate(),
  };
}

function getNthWeekdayOfMonth(
  year: number,
  month: number,
  weekday: number,
  occurrence: number
) {
  const firstWeekday = getUtcWeekday(year, month, 1);
  const offset = (weekday - firstWeekday + 7) % 7;
  return 1 + offset + (occurrence - 1) * 7;
}

function getLastWeekdayOfMonth(year: number, month: number, weekday: number) {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const lastWeekday = getUtcWeekday(year, month, lastDay);
  const offset = (lastWeekday - weekday + 7) % 7;
  return lastDay - offset;
}

function getEasterSunday(year: number) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;

  return { month, day };
}

function isSameEasternDate(
  target: { year: number; month: number; day: number },
  candidate: { year: number; month: number; day: number }
) {
  return (
    target.year === candidate.year &&
    target.month === candidate.month &&
    target.day === candidate.day
  );
}

function isNyseHoliday(parts: { year: number; month: number; day: number }) {
  const fixedHolidays = [
    getObservedFixedHolidayDate(parts.year, 1, 1),
    getObservedFixedHolidayDate(parts.year + 1, 1, 1),
    getObservedFixedHolidayDate(parts.year, 6, 19),
    getObservedFixedHolidayDate(parts.year, 7, 4),
    getObservedFixedHolidayDate(parts.year, 12, 25),
  ];

  if (fixedHolidays.some((holiday) => isSameEasternDate(parts, holiday))) {
    return true;
  }

  if (
    (parts.month === 1 &&
      parts.day === getNthWeekdayOfMonth(parts.year, 1, 1, 3)) ||
    (parts.month === 2 &&
      parts.day === getNthWeekdayOfMonth(parts.year, 2, 1, 3)) ||
    (parts.month === 5 &&
      parts.day === getLastWeekdayOfMonth(parts.year, 5, 1)) ||
    (parts.month === 9 &&
      parts.day === getNthWeekdayOfMonth(parts.year, 9, 1, 1)) ||
    (parts.month === 11 &&
      parts.day === getNthWeekdayOfMonth(parts.year, 11, 4, 4))
  ) {
    return true;
  }

  const easterSunday = getEasterSunday(parts.year);
  const goodFriday = new Date(
    Date.UTC(parts.year, easterSunday.month - 1, easterSunday.day)
  );
  goodFriday.setUTCDate(goodFriday.getUTCDate() - 2);

  return isSameEasternDate(parts, {
    year: goodFriday.getUTCFullYear(),
    month: goodFriday.getUTCMonth() + 1,
    day: goodFriday.getUTCDate(),
  });
}

function isNyseTradingDate(parts: { year: number; month: number; day: number }) {
  const weekday = getUtcWeekday(parts.year, parts.month, parts.day);

  return weekday !== 0 && weekday !== 6 && !isNyseHoliday(parts);
}

export function getRuntimeSession(now: Date): RuntimeSessionSnapshot {
  const { year, month, day, totalMinutes } = getEasternParts(now);
  const easternDate = { year, month, day };
  const isTradingDay = isNyseTradingDate(easternDate);

  if (isAgentSwarmDecommissioned()) {
    return {
      phase: "NON_TRADING_DAY",
      label: "Decommissioned",
      marketStatus: "closed",
      isTradingDay,
      referenceTimezone: MARKET_TIMEZONE,
      operatorTimezone: OPERATOR_TIMEZONE,
      windowEt: SESSION_WINDOWS.NON_TRADING_DAY.windowEt,
      windowPt: SESSION_WINDOWS.NON_TRADING_DAY.windowPt,
      activeAgentIds: [],
      sleepingAgentIds: [],
      wokenAgentIds: [],
      pendingResponseRequests: [],
      tradingAgentsEnabled: false,
      orderExecutionEnabled: false,
      note:
        "The legacy research lead, research, quant, execution, and agent orchestration stack has been fully decommissioned.",
      checkedAt: now.toISOString(),
    };
  }

  const forceAllAgentsIdle = isForceAllAgentsIdleEnabled();
  const forceAllAgentsActive = isForceAllAgentsActiveEnabled();
  const overnightStartDate =
    totalMinutes < 420 ? addUtcDays(easternDate, -1) : easternDate;
  const overnightEndDate =
    totalMinutes < 420 ? easternDate : addUtcDays(easternDate, 1);
  const isStaffedWorkNight =
    isNyseTradingDate(overnightStartDate) && isNyseTradingDate(overnightEndDate);

  let phase: RuntimePhase;
  let label: string;
  let marketStatus: RuntimeSessionSnapshot["marketStatus"];
  let activeAgentIds: string[];
  let tradingAgentsEnabled: boolean;
  let orderExecutionEnabled: boolean;
  let note: string;
  let windowEt: string;
  let windowPt: string;

  if (forceAllAgentsIdle) {
    phase = "NON_TRADING_DAY";
    label = "Operator Halt";
    marketStatus = "closed";
    activeAgentIds = [];
    tradingAgentsEnabled = false;
    orderExecutionEnabled = false;
    note =
      "Operator halt is active. Research, quant, execution, and every research sleeve are held idle until the halt is lifted.";
    ({ windowEt, windowPt } = SESSION_WINDOWS.NON_TRADING_DAY);
  } else if (!isTradingDay) {
    phase = "NON_TRADING_DAY";
    label = "Market-Closed Day";
    marketStatus = "closed";
    activeAgentIds = [];
    tradingAgentsEnabled = false;
    orderExecutionEnabled = false;
    note =
      "Markets are closed and every desk agent is held idle until the next market day.";
    ({ windowEt, windowPt } = SESSION_WINDOWS.NON_TRADING_DAY);
  } else if (totalMinutes >= 510 && totalMinutes < 570) {
    phase = "PRE_MARKET";
    label = "Pre-Market";
    marketStatus = "pre-market";
    activeAgentIds = [...ALL_SWARM_AGENTS];
    tradingAgentsEnabled = true;
    orderExecutionEnabled = true;
    note =
      "The full research desk is active for the final hour before the open. Core specialists publish overnight context, the research lead sets sleeve guardrails, and research sleeves may publish pre-market review updates.";
    ({ windowEt, windowPt } = SESSION_WINDOWS.PRE_MARKET);
  } else if (totalMinutes >= 570 && totalMinutes < 960) {
    phase = "MARKET";
    label = "Market Hours";
    marketStatus = "open";
    activeAgentIds = [...ALL_SWARM_AGENTS];
    tradingAgentsEnabled = true;
    orderExecutionEnabled = true;
    note =
      "Core desk specialists and research sleeves are active. Agents publish autonomous research updates while the research lead stays online for live sleeve oversight and ensemble context.";
    ({ windowEt, windowPt } = SESSION_WINDOWS.MARKET);
  } else if (totalMinutes >= 960 && totalMinutes < 1020) {
    phase = "POST_MARKET";
    label = "Post-Market";
    marketStatus = "after-hours";
    activeAgentIds = [...ALL_SWARM_AGENTS];
    tradingAgentsEnabled = true;
    orderExecutionEnabled = true;
    note =
      "The full research desk stays active through the first hour after the close for after-hours evidence review, reconciliation, and next-session prep.";
    ({ windowEt, windowPt } = SESSION_WINDOWS.POST_MARKET);
  } else if (isStaffedWorkNight) {
    phase = "OVERNIGHT";
    label = "Overnight";
    marketStatus = "closed";
    activeAgentIds = [...CORE_DESK_AGENT_IDS];
    tradingAgentsEnabled = false;
    orderExecutionEnabled = false;
    note =
      "The research lead plus the core research desk stay staffed overnight on work nights while research sleeves sleep until the next pre-market hour. The overnight futures monitor stays armed, but publication routing remains paused.";
    ({ windowEt, windowPt } = SESSION_WINDOWS.OVERNIGHT);
  } else {
    phase = "NON_TRADING_DAY";
    label = "Market-Closed Night";
    marketStatus = "closed";
    activeAgentIds = [];
    tradingAgentsEnabled = false;
    orderExecutionEnabled = false;
    note =
      "Markets are closed and the desk stays offline through weekend and holiday overnights until the next staffed session.";
    ({ windowEt, windowPt } = SESSION_WINDOWS.OVERNIGHT);
  }

  if (forceAllAgentsActive && phase !== "NON_TRADING_DAY") {
    activeAgentIds = [...ALL_SWARM_AGENTS];
    tradingAgentsEnabled = true;
    note = `${note} Testing override keeps the full desk awake outside the normal staffing schedule.`;
  }

  return {
    phase,
    label,
    marketStatus,
    isTradingDay,
    referenceTimezone: MARKET_TIMEZONE,
    operatorTimezone: OPERATOR_TIMEZONE,
    windowEt,
    windowPt,
    activeAgentIds,
    sleepingAgentIds: ALL_SWARM_AGENTS.filter(
      (agentId) => !activeAgentIds.includes(agentId)
    ),
    wokenAgentIds: [],
    pendingResponseRequests: [],
    tradingAgentsEnabled,
    orderExecutionEnabled,
    note,
    checkedAt: now.toISOString(),
  };
}

export async function getOvernightRiskMonitorSnapshot(
  session: RuntimeSessionSnapshot,
  now: Date
): Promise<OvernightRiskMonitorSnapshot> {
  const base: OvernightRiskMonitorSnapshot = {
    enabled: session.phase === "OVERNIGHT",
    checkedAt: now.toISOString(),
    source: "Yahoo Finance ES=F chart endpoint",
    symbol: "ES=F",
    lastPrice: null,
    previousClose: null,
    changePct: null,
    alertTriggered: false,
    thresholdPct: -3,
    message:
      session.phase === "OVERNIGHT"
        ? "Overnight futures monitor armed."
        : "Overnight futures monitor idle outside the overnight window.",
  };

  if (session.phase !== "OVERNIGHT") {
    return base;
  }

  const startedAt = Date.now();

  try {
    const response = await fetch(
      "https://query1.finance.yahoo.com/v8/finance/chart/ES=F?interval=5m&range=1d",
      {
        cache: "no-store",
      }
    );
    const responsePayload = response.ok
      ? ((await response.clone().json().catch(() => ({}))) as Record<string, unknown>)
      : ((await response.clone().text().catch(() => "")) as string);

    await recordApiActivityEventSafe({
      service: "YAHOO_FINANCE",
      category: "INFRASTRUCTURE",
      operation: "overnight-futures-monitor",
      method: "GET",
      url: "https://query1.finance.yahoo.com/v8/finance/chart/ES=F?interval=5m&range=1d",
      statusCode: response.status,
      durationMs: Date.now() - startedAt,
      responseHeaders: response.headers,
      responsePayload,
      errorMessage: response.ok ? null : `HTTP ${response.status}`,
    });

    if (!response.ok) {
      return {
        ...base,
        message: `Overnight futures monitor could not reach the price source (HTTP ${response.status}).`,
      };
    }

    const json = (await response.json()) as {
      chart?: {
        result?: Array<{
          meta?: {
            previousClose?: number;
            regularMarketPrice?: number;
          };
        }>;
      };
    };

    const meta = json.chart?.result?.[0]?.meta;
    const previousClose =
      typeof meta?.previousClose === "number" ? meta.previousClose : null;
    const lastPrice =
      typeof meta?.regularMarketPrice === "number"
        ? meta.regularMarketPrice
        : null;
    const changePct =
      previousClose && lastPrice
        ? ((lastPrice - previousClose) / previousClose) * 100
        : null;
    const alertTriggered = typeof changePct === "number" && changePct <= -3;

    return {
      ...base,
      previousClose,
      lastPrice,
      changePct,
      alertTriggered,
      message: alertTriggered
        ? `Overnight futures alert: S&P futures are down ${changePct.toFixed(
            2
          )}% versus the prior close. Review opening risk before the market opens.`
        : typeof changePct === "number"
        ? `Overnight futures stable at ${changePct.toFixed(
            2
          )}% versus the prior close.`
        : "Overnight futures monitor could not calculate a valid percentage move.",
    };
  } catch (error) {
    await recordApiActivityEventSafe({
      service: "YAHOO_FINANCE",
      category: "INFRASTRUCTURE",
      operation: "overnight-futures-monitor",
      method: "GET",
      url: "https://query1.finance.yahoo.com/v8/finance/chart/ES=F?interval=5m&range=1d",
      durationMs: Date.now() - startedAt,
      errorMessage:
        error instanceof Error
          ? error.message
          : "Yahoo Finance overnight monitor failed unexpectedly.",
    });
    return {
      ...base,
      message:
        error instanceof Error
          ? `Overnight futures monitor failed: ${error.message}`
          : "Overnight futures monitor failed unexpectedly.",
    };
  }
}
