import type { StockResearchAgent } from "@/lib/stocks/types";
import { normalizeBaseModelId } from "@/lib/stocks/model-metadata";

type AgentPricePerMillionTokens = {
  input: number;
  output: number;
};

const MODEL_PRICE_PER_MILLION_TOKENS_USD: Record<
  string,
  AgentPricePerMillionTokens
> = {
  "Anthropic Opus 4.7": {
    input: 5,
    output: 25,
  },
  "Claude Opus 4.7": {
    input: 5,
    output: 25,
  },
  "claude-opus-4-7": {
    input: 5,
    output: 25,
  },
  "claude-opus-4-7-thinking": {
    input: 5,
    output: 25,
  },
};

function formatUsdAmount(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
  }).format(value);
}

export function getAgentPricePerMillionTokens(
  agent: StockResearchAgent
): AgentPricePerMillionTokens | null {
  if (agent.pricePerMillionTokensUsd) {
    return agent.pricePerMillionTokensUsd;
  }

  if (!agent.llmModel) {
    return null;
  }

  const normalizedModelId = normalizeBaseModelId(agent.llmModel);

  return (
    MODEL_PRICE_PER_MILLION_TOKENS_USD[agent.llmModel] ??
    (normalizedModelId
      ? MODEL_PRICE_PER_MILLION_TOKENS_USD[normalizedModelId]
      : null) ??
    null
  );
}

export function getAgentPricePerMillionTokensSortValue(
  agent: StockResearchAgent
) {
  const price = getAgentPricePerMillionTokens(agent);

  if (!price) {
    return Number.NEGATIVE_INFINITY;
  }

  return price.input + price.output;
}

export function formatAgentPricePerMillionTokens(agent: StockResearchAgent) {
  const price = getAgentPricePerMillionTokens(agent);

  if (!price) {
    return "N/A";
  }

  return `${formatUsdAmount(price.input)} / ${formatUsdAmount(price.output)}`;
}
