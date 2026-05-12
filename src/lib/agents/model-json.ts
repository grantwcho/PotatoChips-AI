import "server-only";

import {
  formatDecisionProvider,
  getDecisionModelRouteConfig,
  listDecisionModelRouteConfigs,
  type DecisionModelRoute,
  type DecisionProvider,
} from "@/lib/agents/model-routing";
import { recordApiActivityEventSafe } from "@/lib/data/alloydb/api-activity";

type JsonRecord = Record<string, unknown>;
export type JsonSchema = Record<string, unknown>;
type ParsedModelPayload = {
  content: string;
  provider: DecisionProvider;
};
type RequestConfiguredJsonObjectInput<T> = {
  systemPrompt: string;
  userPrompt: string;
  errorContext: string;
  validate?: (payload: JsonRecord) => T;
  maxAttemptsPerProvider?: number;
  anthropicSchema?: JsonSchema;
  route?: DecisionModelRoute;
};

export type DecisionModelRuntimeStatus = {
  configured: boolean;
  preferredProvider: DecisionProvider | "auto";
  providerLabel: string;
  configuredProviders: DecisionProvider[];
  modelLabel: string;
  statusDetail: string;
};

function asNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getDecisionTemperature() {
  return clamp(asNumber(process.env.AGENT_DECISION_TEMPERATURE) ?? 0.2, 0, 1);
}

export function getDecisionModelRuntimeStatus(): DecisionModelRuntimeStatus {
  const routeConfigs = listDecisionModelRouteConfigs();
  const configuredProviders = Array.from(
    new Set(routeConfigs.flatMap((route) => route.configuredProviders))
  );
  const configured = routeConfigs.every(
    (route) => route.configuredProviders.length > 0
  );
  const providerLabel = "Layered Router";
  const modelLabel =
    configuredProviders.length > 0
      ? routeConfigs
          .map((route) => {
            const primaryProvider = route.providerOrder[0];
            const primaryModel =
              primaryProvider === "anthropic"
                ? route.anthropicModel
                : route.openAiModel;
            return `${route.label}: ${primaryModel}`;
          })
          .join(" | ")
      : "None";

  if (!configured) {
    return {
      configured: false,
      preferredProvider: "auto",
      providerLabel,
      configuredProviders,
      modelLabel,
      statusDetail:
        "Missing OPENAI_API_KEY and ANTHROPIC_API_KEY. Desk, research lead, and HR routing need at least one provider key before autonomous decisions can run.",
    };
  }

  return {
    configured: true,
    preferredProvider: "auto",
    providerLabel,
    configuredProviders,
    modelLabel,
    statusDetail: routeConfigs
      .map((route) => {
        const [primaryProvider, fallbackProvider] = route.providerOrder;
        const primaryModel =
          primaryProvider === "anthropic"
            ? route.anthropicModel
            : route.openAiModel;
        const fallbackModel =
          fallbackProvider === "anthropic"
            ? route.anthropicModel
            : route.openAiModel;

        return `${route.label} uses ${formatDecisionProvider(
          primaryProvider
        )} ${primaryModel} first, then ${formatDecisionProvider(
          fallbackProvider
        )} ${fallbackModel}.`;
      })
      .join(" "),
  };
}

function extractJsonObject(value: string) {
  const normalized = value
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
  const firstBrace = normalized.indexOf("{");

  if (firstBrace === -1) {
    throw new Error("Decision model did not return a JSON object.");
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = firstBrace; index < normalized.length; index += 1) {
    const character = normalized[index];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }

      if (character === "\\") {
        escaped = true;
        continue;
      }

      if (character === '"') {
        inString = false;
      }

      continue;
    }

    if (character === '"') {
      inString = true;
      continue;
    }

    if (character === "{") {
      depth += 1;
      continue;
    }

    if (character === "}") {
      depth -= 1;

      if (depth === 0) {
        return normalized.slice(firstBrace, index + 1);
      }
    }
  }

  throw new Error("Decision model returned an incomplete JSON object.");
}

function buildValidationRetryPrompt(userPrompt: string, errorMessage: string) {
  return [
    userPrompt,
    "",
    "CORRECTION REQUIRED:",
    `The previous response was invalid: ${errorMessage}`,
    "Return one corrected JSON object only.",
    "Do not wrap the JSON in markdown.",
    "Do not omit required fields, especially required numeric and boolean fields.",
    "Keep the response strictly aligned with the requested output shape.",
  ].join("\n");
}

function buildJsonRepairPrompt(rawJson: string, errorMessage: string) {
  return [
    "The JSON object below is close, but it is syntactically invalid.",
    "Repair the JSON only.",
    "Preserve the intended values and field names whenever possible.",
    "Return exactly one corrected JSON object.",
    "Do not wrap the JSON in markdown.",
    "",
    `PARSE ERROR: ${errorMessage}`,
    "",
    "BROKEN JSON:",
    rawJson.trim(),
  ].join("\n");
}

async function tryOpenAiJson(input: {
  systemPrompt: string;
  userPrompt: string;
  route: DecisionModelRoute;
}): Promise<ParsedModelPayload | null> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();

  if (!apiKey) {
    return null;
  }

  const startedAt = Date.now();
  const requestHeaders = {
    "content-type": "application/json",
    authorization: `Bearer ${apiKey}`,
  };
  const routeConfig = getDecisionModelRouteConfig(input.route);
  const requestPayload = {
    model: routeConfig.openAiModel,
    temperature: getDecisionTemperature(),
    response_format: {
      type: "json_object",
    },
    messages: [
      {
        role: "system",
        content: input.systemPrompt,
      },
      {
        role: "user",
        content: input.userPrompt,
      },
    ],
  };
  let statusCode: number | null = null;
  let responseHeaders: Headers | null = null;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify(requestPayload),
    });
    statusCode = response.status;
    responseHeaders = response.headers;
    const payload = (await response.json().catch(() => ({}))) as {
      choices?: Array<{
        message?: {
          content?: string;
        };
      }>;
      error?: { message?: string };
    };

    await recordApiActivityEventSafe({
      service: "OPENAI",
      category: "MODEL",
      operation: "chat.completions",
      method: "POST",
      url: "https://api.openai.com/v1/chat/completions",
      statusCode,
      durationMs: Date.now() - startedAt,
      requestHeaders,
      requestPayload,
      responseHeaders,
      responsePayload: payload,
      errorMessage: response.ok ? null : payload.error?.message ?? null,
      metadata: {
        purpose: "agent-decision-json",
        route: input.route,
      },
    });

    if (!response.ok) {
      throw new Error(payload.error?.message ?? `OpenAI returned HTTP ${response.status}.`);
    }

    const content = payload.choices?.[0]?.message?.content?.trim();

    if (!content) {
      throw new Error("OpenAI returned an empty decision payload.");
    }

    return {
      content,
      provider: "openai",
    };
  } catch (error) {
    if (statusCode === null) {
      await recordApiActivityEventSafe({
        service: "OPENAI",
        category: "MODEL",
        operation: "chat.completions",
        method: "POST",
        url: "https://api.openai.com/v1/chat/completions",
        durationMs: Date.now() - startedAt,
        requestHeaders,
        requestPayload,
        responseHeaders,
        errorMessage:
          error instanceof Error ? error.message : "OpenAI request failed unexpectedly.",
        metadata: {
          purpose: "agent-decision-json",
          route: input.route,
        },
      });
    }

    throw error;
  }
}

async function tryAnthropicJson(input: {
  systemPrompt: string;
  userPrompt: string;
  schema?: JsonSchema;
  route: DecisionModelRoute;
}): Promise<ParsedModelPayload | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();

  if (!apiKey) {
    return null;
  }

  const startedAt = Date.now();
  const requestHeaders = {
    "content-type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
  };
  const routeConfig = getDecisionModelRouteConfig(input.route);
  const requestPayload = {
    model: routeConfig.anthropicModel,
    max_tokens: 3200,
    temperature: getDecisionTemperature(),
    system: input.systemPrompt,
    ...(input.schema
      ? {
          output_config: {
            format: {
              type: "json_schema",
              schema: input.schema,
            },
          },
        }
      : {}),
    messages: [
      {
        role: "user",
        content: input.userPrompt,
      },
    ],
  };
  let statusCode: number | null = null;
  let responseHeaders: Headers | null = null;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify(requestPayload),
    });
    statusCode = response.status;
    responseHeaders = response.headers;
    const payload = (await response.json().catch(() => ({}))) as {
      content?: Array<{ type?: string; text?: string }>;
      error?: { message?: string };
      stop_reason?: string | null;
    };

    await recordApiActivityEventSafe({
      service: "ANTHROPIC",
      category: "MODEL",
      operation: "messages",
      method: "POST",
      url: "https://api.anthropic.com/v1/messages",
      statusCode,
      durationMs: Date.now() - startedAt,
      requestHeaders,
      requestPayload,
      responseHeaders,
      responsePayload: payload,
      errorMessage: response.ok ? null : payload.error?.message ?? null,
      metadata: {
        purpose: "agent-decision-json",
        route: input.route,
      },
    });

    if (!response.ok) {
      throw new Error(payload.error?.message ?? `Anthropic returned HTTP ${response.status}.`);
    }

    if (payload.stop_reason === "max_tokens") {
      throw new Error(
        "Anthropic hit max_tokens before finishing the structured decision payload."
      );
    }

    const content = payload.content
      ?.filter((item) => item.type === "text" && typeof item.text === "string")
      .map((item) => item.text)
      .join("\n")
      .trim();

    if (!content) {
      throw new Error("Anthropic returned an empty decision payload.");
    }

    return {
      content,
      provider: "anthropic",
    };
  } catch (error) {
    if (statusCode === null) {
      await recordApiActivityEventSafe({
        service: "ANTHROPIC",
        category: "MODEL",
        operation: "messages",
        method: "POST",
        url: "https://api.anthropic.com/v1/messages",
        durationMs: Date.now() - startedAt,
        requestHeaders,
        requestPayload,
        responseHeaders,
        errorMessage:
          error instanceof Error
            ? error.message
            : "Anthropic request failed unexpectedly.",
        metadata: {
          purpose: "agent-decision-json",
          route: input.route,
        },
      });
    }

    throw error;
  }
}

export async function requestConfiguredJsonObject<T = JsonRecord>(
  input: RequestConfiguredJsonObjectInput<T>
): Promise<T> {
  const route = input.route ?? "desk";
  const providerOrder = getDecisionModelRouteConfig(route).providerOrder;
  const errors: string[] = [];
  const maxAttemptsPerProvider = Math.max(1, input.maxAttemptsPerProvider ?? 2);

  for (const provider of providerOrder) {
    let userPrompt = input.userPrompt;

    for (let attempt = 1; attempt <= maxAttemptsPerProvider; attempt += 1) {
      const attemptLabel =
        maxAttemptsPerProvider > 1 ? `${provider} attempt ${attempt}` : provider;

      try {
        const payload =
          provider === "openai"
            ? await tryOpenAiJson({
                route,
                systemPrompt: input.systemPrompt,
                userPrompt,
              })
            : await tryAnthropicJson({
                route,
                systemPrompt: input.systemPrompt,
                userPrompt,
                schema: input.anthropicSchema,
              });

        if (!payload) {
          break;
        }

        try {
          const parsed = JSON.parse(extractJsonObject(payload.content)) as JsonRecord;

          return input.validate
            ? input.validate(parsed)
            : ((parsed as unknown) as T);
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : "Decision request failed unexpectedly.";

          errors.push(`${attemptLabel}: ${message}`);

          if (attempt < maxAttemptsPerProvider) {
            userPrompt =
              message.includes("JSON object") ||
              message.includes("JSON at position") ||
              message.includes("unterminated") ||
              message.includes("Expected")
                ? buildJsonRepairPrompt(payload.content, message)
                : buildValidationRetryPrompt(input.userPrompt, message);
          }
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Decision request failed unexpectedly.";

        errors.push(`${attemptLabel}: ${message}`);

        if (attempt < maxAttemptsPerProvider) {
          userPrompt = buildValidationRetryPrompt(input.userPrompt, message);
        }
      }
    }
  }

  throw new Error(
    errors.length > 0
      ? `No decision model could satisfy ${input.errorContext}: ${errors.join(" | ")}`
      : "No decision model is configured. Set OPENAI_API_KEY or ANTHROPIC_API_KEY for agent decisioning."
  );
}
