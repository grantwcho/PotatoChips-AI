// ============================================================================
// Potato Chips AI — Mock Data Layer
// All data is internally consistent: agent performance reconciles with research
// events, and coverage maps match agent focus areas.
// ============================================================================

// --- Seed-based pseudo-random for deterministic data ---
function seededRandom(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

const rand = seededRandom(42);

function randBetween(min: number, max: number) {
  return min + rand() * (max - min);
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(rand() * arr.length)];
}

// --- Types ---
export type AgentStatus = "live" | "paper" | "paused" | "evaluation";
export type AgentType = "internal" | "external";
export type Strategy = "Stat Arb" | "Macro" | "Event-Driven" | "Sentiment" | "Multi-Strategy";
export type Tier = "Platinum" | "Gold" | "Silver" | "Bronze";
export type AlertSeverity = "critical" | "warning" | "info";
export type ConflictStatus = "active" | "resolved" | "escalated";

export interface Agent {
  id: string;
  name: string;
  type: AgentType;
  strategy: Strategy;
  status: AgentStatus;
  tier: Tier;
  capitalAllocated: number;
  dailyPnl: number;
  totalPnl: number;
  sharpe30d: number;
  maxDrawdown: number;
  correlationScore: number;
  contributor: string | null;
  deployedDate: string;
  winRate: number;
  avgHoldPeriod: string;
  profitFactor: number;
  annualizedReturn: number;
  sortino: number;
  totalReturn: number;
}

export interface Position {
  ticker: string;
  netPosition: number;
  direction: "Long" | "Short";
  notionalValue: number;
  agentsHolding: number;
  avgEntry: number;
  currentPrice: number;
  unrealizedPnl: number;
  pctOfNav: number;
  sector: string;
  agentBreakdown: { agentId: string; size: number; entry: number }[];
}

export interface Trade {
  id: string;
  timestamp: string;
  agentId: string;
  agentName: string;
  ticker: string;
  action: "BUY" | "SELL" | "SHORT" | "COVER";
  qty: number;
  price: number;
  notional: number;
  confidence: number;
  strategy: Strategy;
  slippage: number;
  status: "Filled" | "Partial" | "Rejected" | "Pending";
  reasoning: string;
}

export interface Alert {
  id: string;
  severity: AlertSeverity;
  source: string;
  timestamp: string;
  description: string;
  status: "new" | "acknowledged" | "resolved";
  type: string;
}

export interface Conflict {
  id: string;
  ticker: string;
  agentAId: string;
  agentAName: string;
  agentBId: string;
  agentBName: string;
  agentADirection: "Long" | "Short";
  agentBDirection: "Long" | "Short";
  netPosition: number;
  resolution: string;
  status: ConflictStatus;
  timestamp: string;
}

export interface Contributor {
  id: string;
  name: string;
  agentsSubmitted: number;
  agentsLive: number;
  totalEarnings: number;
  pendingPayout: number;
  contractStatus: "Active" | "Pending" | "Inactive";
  agentIds: string[];
}

export interface Tier1Agent {
  role: "CIO" | "CRO" | "COO";
  name: string;
  status: "active" | "idle" | "alert";
  lastAction: string;
  lastActionTime: string;
  metrics: Record<string, string>;
}

// --- Constants ---
const STRATEGIES: Strategy[] = ["Stat Arb", "Macro", "Event-Driven", "Sentiment", "Multi-Strategy"];
const TICKERS = [
  "AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA", "JPM", "GS", "BAC",
  "JNJ", "PFE", "UNH", "XOM", "CVX", "COP", "HD", "LOW", "TGT", "COST",
  "DIS", "NFLX", "CRM", "ADBE", "INTC", "AMD", "QCOM", "MRK", "ABT", "TMO",
  "BRK.B", "V", "MA", "WMT", "PG", "KO", "PEP", "MCD", "NKE", "SBUX",
];

const SECTORS: Record<string, string> = {
  AAPL: "Technology", MSFT: "Technology", GOOGL: "Technology", AMZN: "Consumer Discretionary",
  NVDA: "Technology", META: "Technology", TSLA: "Consumer Discretionary",
  JPM: "Financials", GS: "Financials", BAC: "Financials", V: "Financials", MA: "Financials",
  JNJ: "Healthcare", PFE: "Healthcare", UNH: "Healthcare", MRK: "Healthcare", ABT: "Healthcare", TMO: "Healthcare",
  XOM: "Energy", CVX: "Energy", COP: "Energy",
  HD: "Consumer Discretionary", LOW: "Consumer Discretionary", TGT: "Consumer Discretionary", COST: "Consumer Staples",
  DIS: "Communication Services", NFLX: "Communication Services",
  CRM: "Technology", ADBE: "Technology", INTC: "Technology", AMD: "Technology", QCOM: "Technology",
  "BRK.B": "Financials", WMT: "Consumer Staples", PG: "Consumer Staples", KO: "Consumer Staples",
  PEP: "Consumer Staples", MCD: "Consumer Discretionary", NKE: "Consumer Discretionary", SBUX: "Consumer Discretionary",
};

const CONTRIBUTOR_NAMES = [
  "Elena Kowalski", "James Okafor", "Priya Sharma", "Marcus Chen",
  "Sofia Andersson", "Raj Patel", "Lena Fischer", "David Kim",
];

const AGENT_NAMES = [
  "Sentinel", "Meridian", "Arbiter", "Nexus", "Prism", "Vanguard", "Catalyst",
  "Horizon", "Apex", "Zenith", "Spectra", "Quantum", "Atlas", "Echo",
  "Forge", "Drift", "Pulse", "Cipher", "Vector", "Stratos", "Helix", "Nova",
];

const STRATEGY_ID_PREFIXES: Record<Strategy, string> = {
  "Stat Arb": "STATARB",
  Macro: "MACRO",
  "Event-Driven": "EVENT",
  Sentiment: "SENTIMENT",
  "Multi-Strategy": "MULTI",
};

const REASONING_TEMPLATES = [
  "Detected mean-reversion signal on {ticker}. 20-day z-score at {z}, RSI oversold at {rsi}. Historical win rate for this setup: {wr}%.",
  "Momentum breakout on {ticker}. Price cleared 52-week resistance with {vol}x average volume. Tracking with tight invalidation at {stop}.",
  "Earnings surprise catalyst for {ticker}. EPS beat by {beat}%, revenue guidance raised. Post-earnings drift model suggests {drift}% upside.",
  "Cross-asset signal: {ticker} diverging from sector peers by {div} std devs. Paired evidence check with sector ETF context.",
  "Sentiment shift detected for {ticker}. News sentiment score moved from {s1} to {s2} in 24h. Options flow confirming directional bias.",
  "Macro regime change detected. Yield curve steepening changes {ticker} sector context. Adjusting confidence based on vol regime.",
  "Statistical arbitrage opportunity: {ticker} vs peer spread at {spread} std devs. Mean half-life estimated at {halflife} days.",
  "Risk reduction review. Correlation with existing ensemble elevated at {corr}. Trimming research weight to maintain decorrelation target.",
];

// --- Agent Generation ---
function generateAgents(): Agent[] {
  const agents: Agent[] = [];
  const statuses: AgentStatus[] = ["live", "live", "live", "live", "live", "live", "live", "live",
    "live", "live", "live", "live", "live", "live", "live", "live", "live", "live",
    "paper", "paper", "paused", "evaluation"];
  const strategyCounters = Object.fromEntries(
    STRATEGIES.map((strategy) => [strategy, 0])
  ) as Record<Strategy, number>;

  for (let i = 0; i < 22; i++) {
    const isExternal = i >= 14;
    const contributorIndex = isExternal ? (i - 14) % CONTRIBUTOR_NAMES.length : -1;
    const status = statuses[i];
    const strategy = STRATEGIES[i % STRATEGIES.length];
    strategyCounters[strategy] += 1;
    const strategyIndex = strategyCounters[strategy];
    const capital = status === "live" ? randBetween(2_000_000, 15_000_000) : (status === "paper" ? randBetween(500_000, 2_000_000) : 0);
    const dailyPnl = status === "live" ? randBetween(-150_000, 300_000) : (status === "paper" ? randBetween(-50_000, 100_000) : 0);
    const sharpe = randBetween(0.5, 3.2);
    const totalPnl = randBetween(-500_000, 5_000_000);
    const tiers: Tier[] = ["Platinum", "Gold", "Silver", "Bronze"];
    const tier = sharpe > 2.5 ? tiers[0] : sharpe > 1.8 ? tiers[1] : sharpe > 1.0 ? tiers[2] : tiers[3];

    agents.push({
      id: `${STRATEGY_ID_PREFIXES[strategy]}-${String(strategyIndex).padStart(3, "0")}`,
      name: AGENT_NAMES[i],
      type: isExternal ? "external" : "internal",
      strategy,
      status,
      tier,
      capitalAllocated: Math.round(capital),
      dailyPnl: Math.round(dailyPnl),
      totalPnl: Math.round(totalPnl),
      sharpe30d: parseFloat(sharpe.toFixed(2)),
      maxDrawdown: parseFloat(randBetween(-2, -18).toFixed(1)),
      correlationScore: parseFloat(randBetween(0.05, 0.65).toFixed(2)),
      contributor: isExternal ? CONTRIBUTOR_NAMES[contributorIndex] : null,
      deployedDate: `2025-${String(Math.floor(randBetween(1, 12))).padStart(2, "0")}-${String(Math.floor(randBetween(1, 28))).padStart(2, "0")}`,
      winRate: parseFloat(randBetween(42, 68).toFixed(1)),
      avgHoldPeriod: `${Math.floor(randBetween(1, 14))}d ${Math.floor(randBetween(0, 23))}h`,
      profitFactor: parseFloat(randBetween(0.8, 2.8).toFixed(2)),
      annualizedReturn: parseFloat(randBetween(-5, 45).toFixed(1)),
      sortino: parseFloat(randBetween(0.3, 4.5).toFixed(2)),
      totalReturn: parseFloat(randBetween(-8, 65).toFixed(1)),
    });
  }
  return agents;
}

// --- Position Generation ---
function generatePositions(agents: Agent[]): Position[] {
  const positions: Position[] = [];
  const usedTickers = TICKERS.slice(0, 40);

  for (let i = 0; i < 40; i++) {
    const ticker = usedTickers[i];
    const isLong = rand() > 0.35;
    const numAgents = Math.floor(randBetween(1, 5));
    const price = randBetween(30, 500);
    const entry = price * (1 + randBetween(-0.08, 0.05));
    const size = Math.floor(randBetween(500, 15000));
    const notional = size * price;
    const unrealized = size * (price - entry) * (isLong ? 1 : -1);

    const breakdown: { agentId: string; size: number; entry: number }[] = [];
    const liveAgents = agents.filter((a) => a.status === "live");
    for (let j = 0; j < numAgents && j < liveAgents.length; j++) {
      const agent = liveAgents[(i * 3 + j) % liveAgents.length];
      breakdown.push({
        agentId: agent.id,
        size: Math.floor(size / numAgents),
        entry: parseFloat((entry + randBetween(-2, 2)).toFixed(2)),
      });
    }

    positions.push({
      ticker,
      netPosition: size,
      direction: isLong ? "Long" : "Short",
      notionalValue: Math.round(notional),
      agentsHolding: numAgents,
      avgEntry: parseFloat(entry.toFixed(2)),
      currentPrice: parseFloat(price.toFixed(2)),
      unrealizedPnl: Math.round(unrealized),
      pctOfNav: parseFloat((notional / 127_400_000 * 100).toFixed(2)),
      sector: SECTORS[ticker] || "Other",
      agentBreakdown: breakdown,
    });
  }
  return positions;
}

// --- Research event generation ---
function generateTrades(agents: Agent[]): Trade[] {
  const trades: Trade[] = [];
  const actions: Trade["action"][] = ["BUY", "SELL", "SHORT", "COVER"];
  const liveAgents = agents.filter((a) => a.status === "live" || a.status === "paper");
  const now = new Date("2026-04-07T16:00:00Z");

  for (let i = 0; i < 500; i++) {
    const agent = liveAgents[i % liveAgents.length];
    const daysAgo = Math.floor(randBetween(0, 30));
    const hoursAgo = Math.floor(randBetween(0, 8));
    const date = new Date(now.getTime() - daysAgo * 86400000 - hoursAgo * 3600000);
    const ticker = pick(TICKERS.slice(0, 30));
    const action = pick(actions);
    const price = randBetween(30, 500);
    const qty = Math.floor(randBetween(50, 3000));
    const confidence = Math.floor(randBetween(35, 98));
    const slippage = parseFloat(randBetween(-0.05, 0.15).toFixed(3));
    const statusOpts: Trade["status"][] = ["Filled", "Filled", "Filled", "Filled", "Partial", "Rejected", "Pending"];

    const template = pick(REASONING_TEMPLATES);
    const reasoning = template
      .replace("{ticker}", ticker)
      .replace("{z}", randBetween(-2.5, 2.5).toFixed(1))
      .replace("{rsi}", Math.floor(randBetween(20, 80)).toString())
      .replace("{wr}", Math.floor(randBetween(55, 75)).toString())
      .replace("{vol}", randBetween(1.5, 4.0).toFixed(1))
      .replace("{stop}", (price * 0.97).toFixed(2))
      .replace("{beat}", randBetween(5, 25).toFixed(0))
      .replace("{drift}", randBetween(2, 8).toFixed(1))
      .replace("{div}", randBetween(1.5, 3.0).toFixed(1))
      .replace("{s1}", randBetween(-0.5, 0.2).toFixed(2))
      .replace("{s2}", randBetween(0.3, 0.9).toFixed(2))
      .replace("{spread}", randBetween(1.8, 3.5).toFixed(1))
      .replace("{halflife}", Math.floor(randBetween(3, 12)).toString())
      .replace("{corr}", randBetween(0.6, 0.9).toFixed(2));

    trades.push({
      id: `TRD-${String(i + 1).padStart(5, "0")}`,
      timestamp: date.toISOString(),
      agentId: agent.id,
      agentName: agent.name,
      ticker,
      action,
      qty,
      price: parseFloat(price.toFixed(2)),
      notional: Math.round(qty * price),
      confidence,
      strategy: agent.strategy,
      slippage,
      status: pick(statusOpts),
      reasoning,
    });
  }

  return trades.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

// --- Alert Generation ---
function generateAlerts(agents: Agent[]): Alert[] {
  const alertAgents = agents.filter((agent) => agent.status !== "evaluation");
  const alertTypes = [
    { type: "drawdown", severity: "critical" as AlertSeverity, desc: "{agentId} drawdown exceeded 5% threshold — currently at {val}%" },
    { type: "frequency", severity: "warning" as AlertSeverity, desc: "{agentId} research-event frequency spike: {val}x normal rate in last hour" },
    { type: "concentration", severity: "warning" as AlertSeverity, desc: "Single-name concentration limit approaching: {ticker} at {val}% of NAV" },
    { type: "strategy_drift", severity: "warning" as AlertSeverity, desc: "{agentId} researching outside declared strategy category — {val} events flagged" },
    { type: "correlation", severity: "warning" as AlertSeverity, desc: "Correlation spike between {agentAId} and {agentBId}: {val}" },
    { type: "forced_liquidation", severity: "critical" as AlertSeverity, desc: "CRO forced liquidation: {agentId} position in {ticker} reduced by {val}%" },
    { type: "data_latency", severity: "info" as AlertSeverity, desc: "Market data feed latency elevated: {val}ms average (threshold: 50ms)" },
    { type: "conflict_escalated", severity: "critical" as AlertSeverity, desc: "Agent conflict escalated for human review: {agentAId} vs {agentBId} on {ticker}" },
    { type: "risk_limit", severity: "warning" as AlertSeverity, desc: "Gross exposure at {val}% of maximum — approaching limit" },
    { type: "agent_offline", severity: "critical" as AlertSeverity, desc: "{agentId} unresponsive for {val} minutes — automatic pause triggered" },
  ];

  const now = new Date("2026-04-07T16:00:00Z");
  const statuses: Alert["status"][] = ["new", "new", "acknowledged", "acknowledged", "resolved"];

  return Array.from({ length: 20 }, (_, i) => {
    const template = alertTypes[i % alertTypes.length];
    const agentId = pick(alertAgents).id;
    const agentAId = pick(alertAgents).id;
    const agentBId = pick(alertAgents).id;
    const hoursAgo = randBetween(0.1, 72);
    const date = new Date(now.getTime() - hoursAgo * 3600000);
    const desc = template.desc
      .replace("{agentId}", agentId)
      .replace("{agentAId}", agentAId)
      .replace("{agentBId}", agentBId)
      .replace("{ticker}", pick(TICKERS.slice(0, 10)))
      .replace("{val}", randBetween(2, 95).toFixed(1));

    return {
      id: `ALT-${String(i + 1).padStart(3, "0")}`,
      severity: template.severity,
      source: pick(alertAgents).id,
      timestamp: date.toISOString(),
      description: desc,
      status: pick(statuses),
      type: template.type,
    };
  }).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

// --- Conflict Generation ---
function generateConflicts(agents: Agent[]): Conflict[] {
  const liveAgents = agents.filter((a) => a.status === "live");
  const resolutions = ["CIO arbitrated — net-off", "Both allowed (natural hedge)", "Agent A overridden", "Agent B overridden", "Escalated to human"];
  const now = new Date("2026-04-07T16:00:00Z");

  return Array.from({ length: 8 }, (_, i) => {
    const a = liveAgents[i % liveAgents.length];
    const b = liveAgents[(i + 5) % liveAgents.length];
    const ticker = pick(TICKERS.slice(0, 15));
    const hoursAgo = randBetween(0.5, 120);
    const statuses: ConflictStatus[] = i < 3 ? ["active"] : i < 6 ? ["resolved"] : ["escalated"];

    return {
      id: `CNF-${String(i + 1).padStart(3, "0")}`,
      ticker,
      agentAId: a.id,
      agentAName: a.name,
      agentBId: b.id,
      agentBName: b.name,
      agentADirection: "Long" as const,
      agentBDirection: "Short" as const,
      netPosition: Math.round(randBetween(-5000, 5000)),
      resolution: pick(resolutions),
      status: statuses[0],
      timestamp: new Date(now.getTime() - hoursAgo * 3600000).toISOString(),
    };
  });
}

// --- Contributor Generation ---
function generateContributors(agents: Agent[]): Contributor[] {
  return CONTRIBUTOR_NAMES.map((name, i) => {
    const extAgents = agents.filter((a) => a.contributor === name);
    return {
      id: `CTR-${String(i + 1).padStart(3, "0")}`,
      name,
      agentsSubmitted: extAgents.length + Math.floor(randBetween(1, 3)),
      agentsLive: extAgents.filter((a) => a.status === "live").length,
      totalEarnings: Math.round(randBetween(15_000, 450_000)),
      pendingPayout: Math.round(randBetween(2_000, 45_000)),
      contractStatus: pick(["Active", "Active", "Active", "Pending", "Inactive"]) as Contributor["contractStatus"],
      agentIds: extAgents.map((a) => a.id),
    };
  });
}

// --- Tier 1 Agents ---
export const tier1Agents: Tier1Agent[] = [
  {
    role: "CIO",
    name: "Archon",
    status: "active",
    lastAction: "Reallocated $2.1M from MACRO-002 to EVENT-001 based on 30-day momentum",
    lastActionTime: "12 min ago",
    metrics: {
      "Portfolio Sharpe": "1.87",
      "Allocation Efficiency": "91.3%",
      "Active Agents": "18",
    },
  },
  {
    role: "CRO",
    name: "Guardian",
    status: "active",
    lastAction: "Reduced SENTIMENT-003 TSLA position by 30% — single-name concentration limit",
    lastActionTime: "47 min ago",
    metrics: {
      "Portfolio VaR (95%)": "$1.24M",
      "Max Drawdown": "-3.2%",
      "Risk Limit Util.": "67%",
    },
  },
  {
    role: "COO",
    name: "Conductor",
    status: "idle",
    lastAction: "Processed $34.2K contributor payout to Elena Kowalski",
    lastActionTime: "2h ago",
    metrics: {
      "Avg Slippage": "0.023%",
      "System Uptime": "99.97%",
      "Pending Payouts": "$127.4K",
    },
  },
];

// --- Intraday P&L curve ---
export function generateIntradayPnl(): { time: string; pnl: number; sp500: number }[] {
  const points: { time: string; pnl: number; sp500: number }[] = [];
  let pnl = 0;
  let sp = 0;
  for (let h = 9; h <= 16; h++) {
    for (let m = h === 9 ? 30 : 0; m < 60; m += 15) {
      if (h === 16 && m > 0) break;
      pnl += randBetween(-80_000, 120_000);
      sp += randBetween(-0.08, 0.1);
      points.push({
        time: `${h}:${String(m).padStart(2, "0")}`,
        pnl: Math.round(pnl),
        sp500: parseFloat(sp.toFixed(2)),
      });
    }
  }
  return points;
}

// --- Agent P&L contributions for bar chart ---
export function generateAgentDailyContributions(agents: Agent[]): { id: string; name: string; pnl: number }[] {
  return agents
    .filter((a) => a.status === "live")
    .map((a) => ({ id: a.id, name: a.name, pnl: a.dailyPnl }))
    .sort((a, b) => b.pnl - a.pnl);
}

// --- Monthly returns heatmap ---
export function generateMonthlyReturns(): { month: string; year: number; ret: number }[] {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const data: { month: string; year: number; ret: number }[] = [];
  for (const year of [2025, 2026]) {
    const maxMonth = year === 2026 ? 3 : 12;
    for (let m = 0; m < maxMonth; m++) {
      data.push({ month: months[m], year, ret: parseFloat(randBetween(-6, 10).toFixed(1)) });
    }
  }
  return data;
}

// --- Cumulative P&L curve for agent detail ---
export function generateCumulativePnl(): { date: string; pnl: number; drawdown: number }[] {
  const data: { date: string; pnl: number; drawdown: number }[] = [];
  let pnl = 0;
  let peak = 0;
  for (let d = 0; d < 365; d++) {
    const date = new Date(2025, 3, 7 + d);
    pnl += randBetween(-40_000, 60_000);
    peak = Math.max(peak, pnl);
    const dd = peak > 0 ? ((pnl - peak) / peak) * 100 : 0;
    data.push({
      date: date.toISOString().split("T")[0],
      pnl: Math.round(pnl),
      drawdown: parseFloat(dd.toFixed(2)),
    });
  }
  return data;
}

// --- Rolling Sharpe for agent detail ---
export function generateRollingSharpe(): { date: string; s30: number; s60: number; s90: number }[] {
  const data: { date: string; s30: number; s60: number; s90: number }[] = [];
  let s30 = randBetween(1.0, 2.5);
  let s60 = randBetween(1.0, 2.5);
  let s90 = randBetween(1.0, 2.5);
  for (let d = 0; d < 180; d++) {
    const date = new Date(2025, 10, 7 + d);
    s30 += randBetween(-0.15, 0.15); s30 = Math.max(0.2, Math.min(3.5, s30));
    s60 += randBetween(-0.08, 0.08); s60 = Math.max(0.2, Math.min(3.5, s60));
    s90 += randBetween(-0.05, 0.05); s90 = Math.max(0.2, Math.min(3.5, s90));
    data.push({
      date: date.toISOString().split("T")[0],
      s30: parseFloat(s30.toFixed(2)),
      s60: parseFloat(s60.toFixed(2)),
      s90: parseFloat(s90.toFixed(2)),
    });
  }
  return data;
}

// --- Regime analysis ---
export interface RegimeData {
  regime: string;
  trades: number;
  winRate: number;
  avgReturn: number;
  sharpe: number;
}

export function generateRegimeAnalysis(): RegimeData[] {
  return [
    { regime: "Bull Market", trades: Math.floor(randBetween(40, 80)), winRate: parseFloat(randBetween(55, 70).toFixed(1)), avgReturn: parseFloat(randBetween(0.3, 1.2).toFixed(2)), sharpe: parseFloat(randBetween(1.5, 2.8).toFixed(2)) },
    { regime: "Bear Market", trades: Math.floor(randBetween(30, 60)), winRate: parseFloat(randBetween(40, 58).toFixed(1)), avgReturn: parseFloat(randBetween(-0.5, 0.4).toFixed(2)), sharpe: parseFloat(randBetween(0.3, 1.5).toFixed(2)) },
    { regime: "High Volatility", trades: Math.floor(randBetween(50, 90)), winRate: parseFloat(randBetween(45, 62).toFixed(1)), avgReturn: parseFloat(randBetween(0.1, 0.9).toFixed(2)), sharpe: parseFloat(randBetween(0.8, 2.0).toFixed(2)) },
    { regime: "Low Volatility", trades: Math.floor(randBetween(20, 50)), winRate: parseFloat(randBetween(50, 65).toFixed(1)), avgReturn: parseFloat(randBetween(0.1, 0.5).toFixed(2)), sharpe: parseFloat(randBetween(1.0, 2.5).toFixed(2)) },
    { regime: "Risk-On", trades: Math.floor(randBetween(35, 70)), winRate: parseFloat(randBetween(52, 68).toFixed(1)), avgReturn: parseFloat(randBetween(0.2, 1.0).toFixed(2)), sharpe: parseFloat(randBetween(1.2, 2.6).toFixed(2)) },
    { regime: "Risk-Off", trades: Math.floor(randBetween(25, 55)), winRate: parseFloat(randBetween(42, 60).toFixed(1)), avgReturn: parseFloat(randBetween(-0.3, 0.6).toFixed(2)), sharpe: parseFloat(randBetween(0.5, 1.8).toFixed(2)) },
  ];
}

// --- Stress test scenarios ---
export interface StressScenario {
  scenario: string;
  impact: number;
  impactPct: number;
  worstAgent: string;
  keyDriver: string;
}

export const stressScenarios: StressScenario[] = [
  { scenario: "2008 Financial Crisis", impact: -8_420_000, impactPct: -6.61, worstAgent: "MACRO-001", keyDriver: "Financials overweight exposure" },
  { scenario: "COVID March 2020", impact: -5_130_000, impactPct: -4.03, worstAgent: "EVENT-002", keyDriver: "Equity momentum reversal" },
  { scenario: "Rate Shock +200bps", impact: -3_870_000, impactPct: -3.04, worstAgent: "SENTIMENT-001", keyDriver: "Growth/tech overweight" },
  { scenario: "Tech Sector -20%", impact: -6_940_000, impactPct: -5.45, worstAgent: "STATARB-001", keyDriver: "NVDA, AAPL concentration" },
  { scenario: "Flash Crash", impact: -2_150_000, impactPct: -1.69, worstAgent: "MULTI-002", keyDriver: "Illiquid small-cap coverage" },
  { scenario: "Liquidity Freeze", impact: -4_560_000, impactPct: -3.58, worstAgent: "EVENT-003", keyDriver: "Coverage size vs ADV" },
];

// --- Risk limits ---
export interface RiskLimit {
  name: string;
  current: number;
  limit: number;
  unit: string;
}

export const riskLimits: RiskLimit[] = [
  { name: "Max Gross Exposure", current: 78, limit: 100, unit: "%" },
  { name: "Max Single-Name Concentration", current: 62, limit: 100, unit: "%" },
  { name: "Max Sector Tilt", current: 41, limit: 100, unit: "%" },
  { name: "Max Drawdown Tolerance", current: 23, limit: 100, unit: "%" },
  { name: "Max Net Exposure", current: 34, limit: 60, unit: "%" },
  { name: "Max Agent Allocation", current: 11.8, limit: 15, unit: "%" },
];

// --- Sector exposure ---
export function generateSectorExposure(): { sector: string; long: number; short: number; net: number }[] {
  return [
    { sector: "Technology", long: 28.4, short: -8.2, net: 20.2 },
    { sector: "Financials", long: 14.1, short: -6.5, net: 7.6 },
    { sector: "Healthcare", long: 11.3, short: -3.1, net: 8.2 },
    { sector: "Consumer Disc.", long: 9.7, short: -5.8, net: 3.9 },
    { sector: "Energy", long: 7.2, short: -4.3, net: 2.9 },
    { sector: "Consumer Staples", long: 5.1, short: -1.2, net: 3.9 },
    { sector: "Comm. Services", long: 4.8, short: -2.7, net: 2.1 },
    { sector: "Industrials", long: 3.2, short: -1.5, net: 1.7 },
  ];
}

// --- Factor exposure ---
export function generateFactorExposure(): { factor: string; current: number; target: number }[] {
  return [
    { factor: "Market Beta", current: 0.34, target: 0.30 },
    { factor: "Size (SMB)", current: -0.12, target: 0.00 },
    { factor: "Value (HML)", current: 0.08, target: 0.05 },
    { factor: "Momentum (UMD)", current: 0.21, target: 0.15 },
    { factor: "Volatility", current: -0.18, target: -0.10 },
  ];
}

// --- Activity feed events ---
export interface ActivityEvent {
  id: string;
  timestamp: string;
  agentId: string;
  type: "trade" | "allocation" | "alert" | "promotion" | "risk";
  description: string;
}

export function generateActivityFeed(): ActivityEvent[] {
  const events: ActivityEvent[] = [
    { id: "EVT-001", timestamp: "2026-04-07T15:47:00Z", agentId: "EVENT-001", type: "trade", description: "Published NVDA catalyst research note (confidence: 87)" },
    { id: "EVT-002", timestamp: "2026-04-07T15:32:00Z", agentId: "STATARB-001", type: "trade", description: "Published AAPL relative-value anomaly review (confidence: 72)" },
    { id: "EVT-003", timestamp: "2026-04-07T15:18:00Z", agentId: "CIO-001", type: "allocation", description: "Reweighted research attention from MACRO-002 → EVENT-001 (30d momentum)" },
    { id: "EVT-004", timestamp: "2026-04-07T14:55:00Z", agentId: "CRO-001", type: "risk", description: "Reduced SENTIMENT-003 TSLA review priority by 30% — concentration limit" },
    { id: "EVT-005", timestamp: "2026-04-07T14:41:00Z", agentId: "EVENT-002", type: "trade", description: "Published META downside catalyst review (confidence: 64)" },
    { id: "EVT-006", timestamp: "2026-04-07T14:22:00Z", agentId: "MULTI-003", type: "alert", description: "Drawdown alert: -4.8% intraday (threshold: -5%)" },
    { id: "EVT-007", timestamp: "2026-04-07T13:58:00Z", agentId: "MULTI-004", type: "promotion", description: "MULTI-004 (Helix) promoted from review queue → published research" },
    { id: "EVT-008", timestamp: "2026-04-07T13:33:00Z", agentId: "MULTI-001", type: "trade", description: "Published JPM quality screen review (confidence: 91)" },
    { id: "EVT-009", timestamp: "2026-04-07T13:15:00Z", agentId: "CIO-001", type: "allocation", description: "Increased STATARB-001 research weight after stronger evidence quality" },
    { id: "EVT-010", timestamp: "2026-04-07T12:48:00Z", agentId: "SENTIMENT-002", type: "trade", description: "Closed XOM narrative-risk review (confidence: 78)" },
    { id: "EVT-011", timestamp: "2026-04-07T12:20:00Z", agentId: "CRO-001", type: "risk", description: "VaR limit warning: 89% utilization — monitoring" },
    { id: "EVT-012", timestamp: "2026-04-07T11:55:00Z", agentId: "MULTI-003", type: "trade", description: "Published GOOGL earnings-sensitivity review (confidence: 83)" },
    { id: "EVT-013", timestamp: "2026-04-07T11:30:00Z", agentId: "MACRO-001", type: "trade", description: "Published BAC macro-pressure review (confidence: 69)" },
    { id: "EVT-014", timestamp: "2026-04-07T11:02:00Z", agentId: "COO-001", type: "allocation", description: "Processed $34.2K contributor payout to Elena Kowalski" },
    { id: "EVT-015", timestamp: "2026-04-07T10:45:00Z", agentId: "SENTIMENT-001", type: "trade", description: "Published TSLA sentiment downside review (confidence: 56)" },
  ];
  return events;
}

// --- Allocation history for stacked area chart ---
export function generateAllocationHistory(agentIds: string[] = []): { date: string; [agentId: string]: number | string }[] {
  const series = [...agentIds, "Other"];
  const data: { date: string; [agentId: string]: number | string }[] = [];
  const values: Record<string, number> = {};
  series.forEach((agentId) => { values[agentId] = randBetween(5, 20); });

  for (let d = 0; d < 90; d++) {
    const date = new Date(2026, 0, 7 + d);
    const entry: { date: string; [agentId: string]: number | string } = { date: date.toISOString().split("T")[0] };
    series.forEach((agentId) => {
      values[agentId] += randBetween(-1, 1.5);
      values[agentId] = Math.max(2, Math.min(30, values[agentId]));
      entry[agentId] = parseFloat(values[agentId].toFixed(1));
    });
    data.push(entry);
  }
  return data;
}

// --- Build and export all data ---
export const agents = generateAgents();
export const positions = generatePositions(agents);
export const trades = generateTrades(agents);
export const alerts = generateAlerts(agents);
export const conflicts = generateConflicts(agents);
export const contributors = generateContributors(agents);
export const intradayPnl = generateIntradayPnl();
export const agentContributions = generateAgentDailyContributions(agents);
export const sectorExposure = generateSectorExposure();
export const factorExposure = generateFactorExposure();
export const activityFeed = generateActivityFeed();

// --- Fund-level summary stats ---
export const fundStats = {
  aum: 127_400_000,
  dailyPnl: agents.filter((a) => a.status === "live").reduce((s, a) => s + a.dailyPnl, 0),
  dailyPnlPct: 0,
  activeAgents: 5,
  totalAgents: 5,
  portfolioSharpe: 1.87,
  netExposure: 34,
  openAlerts: alerts.filter((a) => a.status === "new").length,
  criticalAlerts: alerts.filter((a) => a.severity === "critical" && a.status === "new").length,
};
fundStats.dailyPnlPct = parseFloat(((fundStats.dailyPnl / fundStats.aum) * 100).toFixed(2));
