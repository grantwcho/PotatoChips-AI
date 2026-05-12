import "server-only";

export type DecisionProvider = "openai" | "anthropic";
export type DecisionModelRoute = "desk" | "cio" | "hr";

export type DecisionModelRouteConfig = {
  route: DecisionModelRoute;
  label: string;
  description: string;
  providerOrder: readonly DecisionProvider[];
  anthropicModel: string;
  openAiModel: string;
  configuredProviders: DecisionProvider[];
};

function getConfiguredProviderPreference(): DecisionProvider | "auto" {
  const preferred = process.env.AGENT_DECISION_PROVIDER?.trim().toLowerCase();

  if (preferred === "anthropic") {
    return "anthropic";
  }

  if (preferred === "openai") {
    return "openai";
  }

  return "auto";
}

function firstNonEmpty(...values: Array<string | null | undefined>) {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }

  return null;
}

export function formatDecisionProvider(provider: DecisionProvider) {
  return provider === "openai" ? "OpenAI" : "Anthropic";
}

export function isDecisionProviderConfigured(provider: DecisionProvider) {
  if (provider === "openai") {
    return Boolean(process.env.OPENAI_API_KEY?.trim());
  }

  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

function getDefaultProviderOrder() {
  const preferred = getConfiguredProviderPreference();

  if (preferred === "openai") {
    return ["openai", "anthropic"] as const;
  }

  return ["anthropic", "openai"] as const;
}

export function getDecisionModelRouteConfig(
  route: DecisionModelRoute
): DecisionModelRouteConfig {
  const providerOrder = getDefaultProviderOrder();

  if (route === "desk") {
    return {
      route,
      label: "Desk",
      description:
        "Research and trading sleeves that generate ideas, react to news, and write live desk logs.",
      providerOrder,
      anthropicModel:
        firstNonEmpty(
          process.env.AGENT_DESK_ANTHROPIC_MODEL,
          process.env.AGENT_DECISION_ANTHROPIC_MODEL
        ) ?? "claude-sonnet-4-6",
      openAiModel:
        firstNonEmpty(
          process.env.AGENT_DESK_OPENAI_MODEL,
          process.env.AGENT_DECISION_OPENAI_MODEL
        ) ?? "gpt-4.1",
      configuredProviders: providerOrder.filter((provider) =>
        isDecisionProviderConfigured(provider)
      ),
    };
  }

  if (route === "cio") {
    return {
      route,
      label: "CIO",
      description:
        "Allocator, guardrail, replacement, and portfolio-level risk decisions.",
      providerOrder,
      anthropicModel:
        firstNonEmpty(
          process.env.AGENT_CIO_ANTHROPIC_MODEL,
          process.env.AGENT_DECISION_ANTHROPIC_MODEL
        ) ?? "claude-opus-4-6",
      openAiModel:
        firstNonEmpty(
          process.env.AGENT_CIO_OPENAI_MODEL,
          process.env.AGENT_DECISION_OPENAI_MODEL
        ) ?? "gpt-4.1",
      configuredProviders: providerOrder.filter((provider) =>
        isDecisionProviderConfigured(provider)
      ),
    };
  }

  return {
    route,
    label: "AI HR",
    description:
      "Wrapped-model recruiting evaluations, adversarial reviews, and final hiring recommendations.",
    providerOrder,
    anthropicModel:
      firstNonEmpty(
        process.env.HR_AGENT_ANTHROPIC_MODEL,
        process.env.HR_AGENT_CLAUDE_MODEL,
        process.env.AGENT_CIO_ANTHROPIC_MODEL,
        process.env.AGENT_DECISION_ANTHROPIC_MODEL
      ) ?? "claude-opus-4-6",
    openAiModel:
      firstNonEmpty(
        process.env.HR_AGENT_OPENAI_MODEL,
        process.env.AGENT_CIO_OPENAI_MODEL,
        process.env.AGENT_DECISION_OPENAI_MODEL
      ) ?? "gpt-4.1-mini",
    configuredProviders: providerOrder.filter((provider) =>
      isDecisionProviderConfigured(provider)
    ),
  };
}

export function listDecisionModelRouteConfigs() {
  return (["desk", "cio", "hr"] as const).map((route) =>
    getDecisionModelRouteConfig(route)
  );
}

export function getDecisionModelRouteForAgent(agentId: string): DecisionModelRoute {
  return agentId === "AGT-CIO" ? "cio" : "desk";
}
