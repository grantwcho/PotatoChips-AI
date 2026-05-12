export type TradingComplianceRuntimeConfig = {
  section475fElectionEnabled: boolean;
  washSaleWindowDays: number;
  antiRoundTripWindowMinutes: number;
  section13WarningPct: number;
  section16WarningPct: number;
  hsrThresholdUsd: number;
  cancelToExecutionRatioMax: number;
  orderToExecutionRatioMax: number;
  minOrderSampleForBehaviorReview: number;
  endWindowMinutes: number;
  endWindowConcentrationPctNav: number;
};

function parseBooleanEnv(value: string | undefined, fallback: boolean) {
  if (!value) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();

  if (normalized === "true") {
    return true;
  }

  if (normalized === "false") {
    return false;
  }

  return fallback;
}

function parseNumberEnv(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getTradingComplianceRuntimeConfig(): TradingComplianceRuntimeConfig {
  return {
    section475fElectionEnabled: parseBooleanEnv(
      process.env.AGENT_COMPLIANCE_475F_ELECTION_ENABLED,
      false
    ),
    washSaleWindowDays: parseNumberEnv(
      process.env.AGENT_COMPLIANCE_WASH_SALE_WINDOW_DAYS,
      30
    ),
    antiRoundTripWindowMinutes: parseNumberEnv(
      process.env.AGENT_COMPLIANCE_ANTI_ROUND_TRIP_WINDOW_MINUTES,
      60
    ),
    section13WarningPct: parseNumberEnv(
      process.env.AGENT_COMPLIANCE_SECTION13D_WARNING_PCT,
      4.5
    ),
    section16WarningPct: parseNumberEnv(
      process.env.AGENT_COMPLIANCE_SECTION16_WARNING_PCT,
      9.5
    ),
    hsrThresholdUsd: parseNumberEnv(
      process.env.AGENT_COMPLIANCE_HSR_WARNING_USD,
      120_000_000
    ),
    cancelToExecutionRatioMax: parseNumberEnv(
      process.env.AGENT_COMPLIANCE_CANCEL_TO_EXECUTION_RATIO_MAX,
      8
    ),
    orderToExecutionRatioMax: parseNumberEnv(
      process.env.AGENT_COMPLIANCE_ORDER_TO_EXECUTION_RATIO_MAX,
      20
    ),
    minOrderSampleForBehaviorReview: parseNumberEnv(
      process.env.AGENT_COMPLIANCE_MIN_ORDER_SAMPLE,
      10
    ),
    endWindowMinutes: parseNumberEnv(
      process.env.AGENT_COMPLIANCE_END_WINDOW_MINUTES,
      5
    ),
    endWindowConcentrationPctNav: parseNumberEnv(
      process.env.AGENT_COMPLIANCE_END_WINDOW_POSITION_PCT_NAV,
      5
    ),
  };
}

export const TRADING_COMPLIANCE_PROMPT_BLOCK = `
RESEARCH GOVERNANCE DIRECTIVE:
- The platform crowdsources AI agents for financial research. Agents do not invest, allocate firm capital, place orders, or route transactions.
- Treat all market data, filings, news, and model outputs as research context only. Do not frame any output as an instruction, recommendation, or offer to buy or sell a security.
- Aggregate provenance, source reliability, freshness, conflicts, and methodology limits across every agent before elevating a research event.
- Never simulate cross-agent execution, opposing flow, autonomous routing, or market-manipulation scenarios as if they were platform behavior.
- Ownership, tax, brokerage, and reporting questions are outside the agent workflow. Escalate them instead of generating operational instructions.
- If legal, source-provenance, methodology, or market-structure context is ambiguous, emit a research governance alert instead of a prescriptive action.
`.trim();
