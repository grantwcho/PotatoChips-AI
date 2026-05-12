export type BaseModelMetadata = {
  id: string;
  label: string;
  license?: string;
  provider?: string;
};

function titleCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function extractAnthropicModelId(value: string) {
  const match = value.match(
    /\bclaude[-_\s]+(opus|sonnet|haiku)[-_\s]+(\d+)(?:[-_.\s]+(\d+))?(?:[-_\s]+(thinking))?\b/i
  );

  if (!match) {
    return null;
  }

  const [, family, major, minor, thinking] = match;
  const version = minor ? `${major}-${minor}` : major;

  return `claude-${family.toLowerCase()}-${version}${
    thinking ? "-thinking" : ""
  }`;
}

function extractGenericModelId(value: string) {
  const match = value.match(
    /\b(?:gpt|gemini|grok|llama|mistral|muse)-[a-z0-9][a-z0-9._-]*\b/i
  );

  return match?.[0].toLowerCase() ?? null;
}

export function extractSpecificBaseModelId(
  values: Array<string | null | undefined>
) {
  for (const value of values) {
    if (!value?.trim()) {
      continue;
    }

    const anthropicModelId = extractAnthropicModelId(value);

    if (anthropicModelId) {
      return anthropicModelId;
    }

    const genericModelId = extractGenericModelId(value);

    if (genericModelId) {
      return genericModelId;
    }
  }

  return undefined;
}

export function normalizeBaseModelId(
  value: string | null | undefined,
  context: Array<string | null | undefined> = []
) {
  const specificModelId = extractSpecificBaseModelId([value, ...context]);

  if (specificModelId) {
    return specificModelId;
  }

  const trimmed = value?.trim();

  return trimmed || undefined;
}

function formatClaudeModelLabel(modelId: string) {
  const match = modelId.match(
    /^claude-(opus|sonnet|haiku)-(\d+)(?:-(\d+))?(-thinking)?$/i
  );

  if (!match) {
    return null;
  }

  const [, family, major, minor, thinking] = match;
  const version = minor ? `${major}.${minor}` : major;

  return `Claude ${titleCase(family.toLowerCase())} ${version}${
    thinking ? " Thinking" : ""
  }`;
}

function formatGenericModelLabel(modelId: string) {
  if (/^gpt-/i.test(modelId)) {
    return modelId.replace(/^gpt/i, "GPT");
  }

  return modelId
    .split("-")
    .map((part) => {
      if (/^(ai|api|gpt|llm)$/i.test(part)) {
        return part.toUpperCase();
      }

      return titleCase(part);
    })
    .join(" ");
}

function inferModelProvider(modelId: string) {
  const normalized = modelId.toLowerCase();

  if (normalized.startsWith("claude") || normalized.includes("anthropic")) {
    return "Anthropic";
  }

  if (normalized.startsWith("gpt") || normalized.includes("openai")) {
    return "OpenAI";
  }

  if (normalized.startsWith("gemini")) {
    return "Google";
  }

  if (normalized.startsWith("llama") || normalized.startsWith("muse")) {
    return "Meta";
  }

  if (normalized.startsWith("grok")) {
    return "xAI";
  }

  if (normalized.startsWith("mistral")) {
    return "Mistral";
  }

  return undefined;
}

export function getBaseModelMetadata(
  value: string | null | undefined
): BaseModelMetadata | null {
  const modelId = normalizeBaseModelId(value);

  if (!modelId) {
    return null;
  }

  return {
    id: modelId,
    label: formatClaudeModelLabel(modelId) ?? formatGenericModelLabel(modelId),
    license: inferModelProvider(modelId) ? "Proprietary" : undefined,
    provider: inferModelProvider(modelId),
  };
}

export function formatBaseModelLabel(value: string | null | undefined) {
  return getBaseModelMetadata(value)?.label ?? "TBD";
}
