import type { DashboardAgentRow } from "@/lib/dashboard/types";

export type OperatorSystemDefinition = {
  id: string;
  name: string;
  description: string;
  pricingTier: string;
  apiEndpoint: string;
  allocationLogic: string;
  category: string;
  agentKeywords: string[];
};

export type OperatorSystem = OperatorSystemDefinition & {
  agents: DashboardAgentRow[];
  allocatedCapitalUsd: number;
};

const SYSTEM_DEFINITIONS: OperatorSystemDefinition[] = [
  {
    id: "mas-earnings",
    name: "Earnings MAS",
    description:
      "Multi-agent earnings intelligence surface sold through chat and API for pre- and post-print workflows.",
    pricingTier: "Institutional",
    apiEndpoint: "/v1/mas/earnings",
    allocationLogic:
      "Weighted synthesis across event, research, and sentiment specialists with conservative ensemble gating.",
    category: "event-driven",
    agentKeywords: ["event", "research", "sentiment", "earnings", "filing"],
  },
  {
    id: "mas-macro",
    name: "Macro MAS",
    description:
      "Cross-asset macro monitoring product for rates, risk, volatility, and policy-sensitive positioning.",
    pricingTier: "Pro",
    apiEndpoint: "/v1/mas/macro",
    allocationLogic:
      "Blend macro, trend, and volatility sleeves with exposure throttles from the operator risk layer.",
    category: "macro",
    agentKeywords: ["macro", "trend", "volatility", "rates", "policy"],
  },
  {
    id: "mas-market-neutral",
    name: "Market Neutral MAS",
    description:
      "Market-neutral API built from quant, stat-arb, and execution-aware agents for low-beta research output.",
    pricingTier: "Enterprise",
    apiEndpoint: "/v1/mas/market-neutral",
    allocationLogic:
      "Capital allocation follows correlation-aware sleeve selection with paper-to-live promotion thresholds.",
    category: "systematic",
    agentKeywords: ["statistical", "quant", "execution", "arb", "market neutral", "systematic"],
  },
];

function normalize(value: string | null | undefined) {
  return (value ?? "").toLowerCase();
}

function matchesKeywords(agent: DashboardAgentRow, keywords: string[]) {
  const haystack = [
    agent.id,
    agent.displayName,
    agent.role,
    agent.strategyCategory ?? "",
    agent.status,
  ]
    .join(" ")
    .toLowerCase();

  return keywords.some((keyword) => haystack.includes(keyword));
}

export function getOperatorSystemDefinitions() {
  return SYSTEM_DEFINITIONS;
}

export function buildOperatorSystems(agents: DashboardAgentRow[]): OperatorSystem[] {
  return SYSTEM_DEFINITIONS.map((definition) => {
    const matchingAgents = agents.filter((agent) =>
      matchesKeywords(agent, definition.agentKeywords)
    );

    const uniqueAgents =
      matchingAgents.length > 0
        ? matchingAgents
        : agents.filter((agent) => {
            const role = normalize(agent.role);

            if (definition.id === "mas-earnings") {
              return role.includes("research") || role.includes("event");
            }

            if (definition.id === "mas-macro") {
              return role.includes("macro") || role.includes("trend");
            }

            return role.includes("quant") || role.includes("execution");
          });

    return {
      ...definition,
      agents: uniqueAgents,
      allocatedCapitalUsd: uniqueAgents.reduce(
        (total, agent) => total + (agent.currentAllocationUsd ?? 0),
        0
      ),
    };
  });
}
