import "server-only";

export const TRADING_AGENT_IDS = [
  "AGT-MACRO-001",
  "AGT-EVENT-001",
  "AGT-SENT-001",
  "AGT-STATARB-001",
  "AGT-TREND-001",
  "AGT-VOL-001",
] as const;

export const PYTHON_TRADING_AGENT_IDS = [
  "AGT-STATARB-001",
  "AGT-TREND-001",
  "AGT-VOL-001",
] as const;

export type TradingAgentId = (typeof TRADING_AGENT_IDS)[number];
export type PythonTradingAgentId = (typeof PYTHON_TRADING_AGENT_IDS)[number];

const TRADING_AGENT_ROLES: Record<TradingAgentId, string> = {
  "AGT-MACRO-001": "Global Macro Researcher",
  "AGT-EVENT-001": "Event-Driven Researcher",
  "AGT-SENT-001": "Sentiment Researcher",
  "AGT-STATARB-001": "Statistical Arbitrage Researcher",
  "AGT-TREND-001": "Systematic Trend Follower",
  "AGT-VOL-001": "Volatility Researcher",
};

const TRADING_AGENT_SHORT_CODES: Record<TradingAgentId, string> = {
  "AGT-MACRO-001": "macro",
  "AGT-EVENT-001": "event",
  "AGT-SENT-001": "sent",
  "AGT-STATARB-001": "statarb",
  "AGT-TREND-001": "trend",
  "AGT-VOL-001": "vol",
};

export function isTradingAgentId(value: unknown): value is TradingAgentId {
  return typeof value === "string" && (TRADING_AGENT_IDS as readonly string[]).includes(value);
}

export function isPythonTradingAgentId(value: unknown): value is PythonTradingAgentId {
  return typeof value === "string" && (PYTHON_TRADING_AGENT_IDS as readonly string[]).includes(value);
}

export function getTradingAgentRole(agentId: TradingAgentId) {
  return TRADING_AGENT_ROLES[agentId];
}

export function getTradingAgentShortCode(agentId: TradingAgentId) {
  return TRADING_AGENT_SHORT_CODES[agentId];
}
