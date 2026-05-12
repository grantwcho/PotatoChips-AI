import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import type { AiHrResponse, ParsedSubmission } from "@/lib/submissions/types";

const AI_HR_MODEL = "claude-sonnet-4-5";
const AI_HR_SYSTEM_PROMPT = `You are AI HR for Potato Chips AI, an AI-native financial research platform. A developer has submitted a research agent for evaluation. Your job is to read their code and produce:

1. A structured interpretation card describing what the agent does, its dependencies, and its risk envelope.
2. An adapter module (Python) that wraps the developer's code into our BaseAgent interface so it can run in our sandbox.

The BaseAgent interface is:

class BaseAgent:
    def on_tick(self, market_state: MarketState) -> list[Intent]: ...
    def on_fill(self, fill_event: FillEvent) -> None: ...
    def on_news(self, news_event: NewsEvent) -> None: ...
    def get_positions(self) -> dict[str, Position]: ...
    def should_halt(self) -> tuple[bool, str]: ...

Identify the developer's entry point and write an adapter subclass that routes our lifecycle calls to their code. If the code is a historical replay script rather than an interactive agent, say so explicitly in executionMode and write the adapter to wrap whatever research function is callable.

Be honest about ambiguity. If you can't identify a kill-switch, say "not declared" rather than inventing one. If dependencies are unclear, list them with details.confidence = "low". If the submission doesn't appear to be an agent at all (for example a pure research notebook), flag it in aiHrNotes.

Respond with ONLY a JSON object matching this TypeScript type:

type Response = {
  card: {
    strategyClassification: string;
    assetUniverse: string;
    timeframe: string;
    decisionCadence: string;
    capitalRangeMin: number | null;
    capitalRangeMax: number | null;
    claimedEdge: string;
    killSwitchBehavior: string;
    entryPoint: string;
    executionMode: "STREAMING" | "SCHEDULED" | "BACKTEST_ONLY" | "UNKNOWN";
    riskEnvelope: Record<string, unknown>;
    dependencies: Array<{
      type: "LLM_API" | "DATA_API" | "MODEL_WEIGHTS" | "PLATFORM_TOOL" | "CUSTOM";
      name: string;
      details: Record<string, unknown>;
    }>;
    aiHrNotes: string;
  };
  adapter: {
    code: string;
    language: "python";
    rationale: string;
  };
};`;

function getAnthropicClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();

  if (!apiKey) {
    throw new Error("Missing ANTHROPIC_API_KEY.");
  }

  return new Anthropic({ apiKey });
}

type NonStreamingMessage = Awaited<ReturnType<Anthropic["messages"]["create"]>> & {
  content: Array<{ text?: string }>;
};

function renderUserPrompt(input: {
  agentName: string | null;
  description: string;
  parsedSubmission: ParsedSubmission;
}) {
  const manifestSummary = input.parsedSubmission.manifest
    ? JSON.stringify(
        {
          agentId: input.parsedSubmission.manifest.agentId,
          kind: input.parsedSubmission.manifest.kind,
          metrics: input.parsedSubmission.manifest.metrics,
          name: input.parsedSubmission.manifest.name,
          path: input.parsedSubmission.manifest.path,
          responseFormats: input.parsedSubmission.manifest.responseFormats,
          schemaVersion: input.parsedSubmission.manifest.schemaVersion,
          templateVersion: input.parsedSubmission.templateVersion,
          validation: input.parsedSubmission.manifest.validation,
        },
        null,
        2
      )
    : "(none found)";
  const keyFiles = input.parsedSubmission.keyFiles
    .map(
      (file) =>
        `## ${file.path}\n\`\`\`${file.language}\n${file.content}\n\`\`\``
    )
    .join("\n\n");

  return `# Submission summary
Agent name: ${input.agentName?.trim() || "(unnamed)"}
Developer description: ${input.description}

# File tree
${input.parsedSubmission.fileTree.join("\n")}

# Detected imports
${input.parsedSubmission.detectedImports.join("\n") || "(none detected)"}

# Detected URLs
${input.parsedSubmission.detectedUrls.join("\n") || "(none detected)"}

# Detected env vars
${input.parsedSubmission.detectedEnvVars.join("\n") || "(none detected)"}

# Parsed manifest
${manifestSummary}

# Key files
${keyFiles || "(no key files extracted)"}`;
}

function extractTextContent(response: NonStreamingMessage) {
  return response.content
    .map((block: { text?: string }) => {
      if ("text" in block) {
        return block.text;
      }

      return "";
    })
    .join("")
    .trim();
}

function getJsonCandidates(text: string) {
  const trimmed = text.trim();
  const candidates = new Set<string>();

  if (trimmed.length > 0) {
    candidates.add(trimmed);
  }

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);

  if (fencedMatch?.[1]) {
    candidates.add(fencedMatch[1].trim());
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");

  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.add(trimmed.slice(firstBrace, lastBrace + 1).trim());
  }

  return [...candidates];
}

function tryParseAiHrResponse(text: string) {
  for (const candidate of getJsonCandidates(text)) {
    try {
      return JSON.parse(candidate) as AiHrResponse;
    } catch {
      continue;
    }
  }

  throw new Error("We couldn’t parse the review output.");
}

function basename(value: string) {
  const normalized = value.replace(/\\/g, "/");
  const segments = normalized.split("/").filter(Boolean);
  return segments.at(-1) ?? value;
}

function summarizeList(values: string[], limit = 4) {
  const visible = values.slice(0, limit);

  if (visible.length === 0) {
    return "";
  }

  if (values.length <= limit) {
    return visible.join(", ");
  }

  return `${visible.join(", ")} and ${values.length - limit} more`;
}

function inferFallbackExecutionMode(parsedSubmission: ParsedSubmission | null) {
  const paths = [
    ...(parsedSubmission?.fileTree ?? []),
    ...(parsedSubmission?.keyFiles.map((file) => file.path) ?? []),
  ].map((path) => path.toLowerCase());

  if (paths.some((path) => path.endsWith(".ipynb") || path.includes("backtest"))) {
    return "BACKTEST_ONLY" as const;
  }

  if (
    paths.some(
      (path) =>
        path.endsWith("main.py") ||
        path.endsWith("agent.py") ||
        path.endsWith("strategy.py") ||
        path.endsWith("main.ts") ||
        path.endsWith("index.ts") ||
        path.endsWith("index.js")
    )
  ) {
    return "SCHEDULED" as const;
  }

  return "UNKNOWN" as const;
}

export function buildFallbackAiHrResponse(input: {
  agentName: string | null;
  description: string;
  failure: unknown;
  parsedSubmission: ParsedSubmission | null;
}): AiHrResponse {
  const parsed = input.parsedSubmission;
  const failureMessage =
    input.failure instanceof Error
      ? input.failure.message
      : "We could not complete the automated review.";
  const keyFiles = parsed?.keyFiles.map((file) => file.path) ?? [];
  const fileTree = parsed?.fileTree ?? [];
  const imports = parsed?.detectedImports ?? [];
  const envVars = parsed?.detectedEnvVars ?? [];
  const urls = parsed?.detectedUrls ?? [];

  const findings: string[] = [];
  const issues: string[] = [];

  findings.push(
    parsed
      ? `Recovered ${fileTree.length} file${fileTree.length === 1 ? "" : "s"} and ${keyFiles.length} key review file${keyFiles.length === 1 ? "" : "s"}.`
      : "The automated review did not recover a parsed file tree before failing."
  );

  if (keyFiles.length > 0) {
    findings.push(`Most relevant files: ${summarizeList(keyFiles.map((file) => basename(file)), 3)}.`);
  }

  if (imports.length > 0) {
    findings.push(`Detected dependencies and imports including ${summarizeList(imports)}.`);
  }

  issues.push(
    `Automated review failed before we could finish a structured interpretation: ${failureMessage}`
  );

  if (keyFiles.length === 0) {
    issues.push("No confident strategy entry point was extracted from the submission.");
  }

  if (urls.length > 0) {
    issues.push(`The submission appears to call external services or URLs: ${summarizeList(urls)}.`);
  }

  if (envVars.length > 0) {
    issues.push(`The submission depends on undeclared runtime configuration or secrets: ${summarizeList(envVars)}.`);
  }

  issues.push(
    "Because we could not complete the full review, execution safety, kill-switch behavior, and operational limits are not verified."
  );

  const judgment =
    "Reject as submitted for now. Do not accept this model as-is until the blocking review issue is fixed and the submission is rerun.";

  const aiHrNotes = [
    `Judgment: ${judgment}`,
    "",
    "What we found:",
    ...findings.map((item) => `- ${item}`),
    "",
    "Bugs and potential issues:",
    ...issues.map((item) => `- ${item}`),
  ].join("\n");

  return {
    adapter: {
      code: `from typing import Any\n\nclass BaseAgent:\n    def on_tick(self, market_state: Any) -> list:\n        raise NotImplementedError\n\n    def on_fill(self, fill_event: Any) -> None:\n        raise NotImplementedError\n\n    def on_news(self, news_event: Any) -> None:\n        raise NotImplementedError\n\n    def get_positions(self) -> dict:\n        raise NotImplementedError\n\n    def should_halt(self) -> tuple[bool, str]:\n        raise NotImplementedError\n\n\nclass SubmittedAgentFallbackAdapter(BaseAgent):\n    \"\"\"Quarantine stub generated because automated review could not safely wrap this submission.\"\"\"\n\n    def on_tick(self, market_state: Any) -> list:\n        return []\n\n    def on_fill(self, fill_event: Any) -> None:\n        return None\n\n    def on_news(self, news_event: Any) -> None:\n        return None\n\n    def get_positions(self) -> dict:\n        return {}\n\n    def should_halt(self) -> tuple[bool, str]:\n        return True, \"Fallback adapter: automated review failed, so this submission should not run as-is.\"\n`,
      language: "python",
      rationale:
        "We could not safely generate a real adapter, so this quarantine stub halts execution immediately and documents that the submission requires manual follow-up.",
    },
    card: {
      aiHrNotes,
      assetUniverse: "unverified",
      capitalRangeMax: null,
      capitalRangeMin: null,
      claimedEdge: input.description.trim() || "No developer description was provided.",
      decisionCadence: "unverified",
      dependencies: [
        ...imports.slice(0, 6).map((name) => ({
          details: { source: "detected_import" },
          name,
          type: "CUSTOM" as const,
        })),
        ...urls.slice(0, 4).map((url) => ({
          details: { source: "detected_url", url },
          name: url,
          type: "DATA_API" as const,
        })),
      ],
      entryPoint: keyFiles[0] ?? "not confidently identified",
      executionMode: inferFallbackExecutionMode(parsed),
      killSwitchBehavior: "not verified because automated review failed before completion",
      riskEnvelope: {
        decision: "REJECT_AS_SUBMITTED",
        envVarCount: envVars.length,
        extractedFileCount: fileTree.length,
        keyFiles,
        reviewFailure: failureMessage,
        reviewMode: "fallback",
        urlCount: urls.length,
      },
      strategyClassification: "Fallback review packet",
      timeframe: "unknown",
    },
  };
}

function normalizeExecutionMode(value: string) {
  switch (value) {
    case "STREAMING":
    case "SCHEDULED":
    case "BACKTEST_ONLY":
    case "UNKNOWN":
      return value;
    default:
      return "UNKNOWN";
  }
}

function normalizeAiHrResponse(value: AiHrResponse): AiHrResponse {
  return {
    adapter: {
      code: value.adapter?.code ?? "",
      language: "python",
      rationale: value.adapter?.rationale ?? "",
    },
    card: {
      aiHrNotes: value.card?.aiHrNotes ?? "",
      assetUniverse: value.card?.assetUniverse ?? "unknown",
      capitalRangeMax:
        typeof value.card?.capitalRangeMax === "number"
          ? value.card.capitalRangeMax
          : null,
      capitalRangeMin:
        typeof value.card?.capitalRangeMin === "number"
          ? value.card.capitalRangeMin
          : null,
      claimedEdge: value.card?.claimedEdge ?? "",
      decisionCadence: value.card?.decisionCadence ?? "unknown",
      dependencies: Array.isArray(value.card?.dependencies)
        ? value.card.dependencies.map((dependency) => ({
            details:
              dependency.details &&
              typeof dependency.details === "object" &&
              !Array.isArray(dependency.details)
                ? dependency.details
                : {},
            name: dependency.name ?? "Unknown dependency",
            type: dependency.type,
          }))
        : [],
      entryPoint: value.card?.entryPoint ?? "unknown",
      executionMode: normalizeExecutionMode(value.card?.executionMode ?? "UNKNOWN"),
      killSwitchBehavior: value.card?.killSwitchBehavior ?? "not declared",
      riskEnvelope:
        value.card?.riskEnvelope &&
        typeof value.card.riskEnvelope === "object" &&
        !Array.isArray(value.card.riskEnvelope)
          ? value.card.riskEnvelope
          : {},
      strategyClassification: value.card?.strategyClassification ?? "unknown",
      timeframe: value.card?.timeframe ?? "unknown",
    },
  };
}

export async function interpretSubmissionWithAiHr(input: {
  agentName: string | null;
  description: string;
  parsedSubmission: ParsedSubmission;
}) {
  const client = getAnthropicClient();
  const userPrompt = renderUserPrompt(input);

  const initial = await client.messages.create({
    max_tokens: 8_000,
    messages: [
      {
        content: userPrompt,
        role: "user",
      },
    ],
    model: AI_HR_MODEL,
    stream: false,
    system: AI_HR_SYSTEM_PROMPT,
    temperature: 0.2,
  }) as NonStreamingMessage;

  const initialText = extractTextContent(initial);

  try {
    return normalizeAiHrResponse(tryParseAiHrResponse(initialText));
  } catch {
    const repair = await client.messages.create({
      max_tokens: 8_000,
      messages: [
        {
          content: userPrompt,
          role: "user",
        },
        {
          content: initialText,
          role: "assistant",
        },
        {
          content:
            "Your previous response was not valid JSON. Return exactly one valid JSON object only. Do not use markdown fences, commentary, or trailing text.",
          role: "user",
        },
      ],
      model: AI_HR_MODEL,
      stream: false,
      system: AI_HR_SYSTEM_PROMPT,
      temperature: 0.2,
    }) as NonStreamingMessage;
    const repairedText = extractTextContent(repair);

    try {
      return normalizeAiHrResponse(tryParseAiHrResponse(repairedText));
    } catch {
      throw new Error("We couldn’t parse the review output after two attempts.");
    }
  }
}
