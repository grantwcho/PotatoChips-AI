import "server-only";

import { DEFAULT_AGENT_SEEDS } from "@/lib/agents/default-agents";
import { getDecisionModelRouteConfig } from "@/lib/agents/model-routing";
import type { JsonSchema } from "@/lib/agents/model-json";
import type {
  AgentPriority,
  AgentRenderType,
} from "@/lib/agents/types";
import { getAgentVoiceProfile } from "@/lib/agents/voice";
import { recordApiActivityEventSafe } from "@/lib/data/alloydb/api-activity";

const BANNED_PHRASES = [
  "research cycle active",
  "lead thread",
  "queued for pre-market review",
  "queued for the pre-market review",
  "morning briefing ready",
  "booted for pre-market prep",
  "agent bus",
  "shared blackboard",
  "blackboard position declaration",
  "execution pipeline",
  "render type",
  "message type",
  "system status",
];

const FREEFORM_FRAMEWORK_LEAK_PATTERNS = [
  /\bactiveagentids\b/i,
  /\bsleepingagentids\b/i,
  /\borderexecutionenabled\b/i,
  /\btradingagentsenabled\b/i,
  /\bautonomous_blackboard_turns\b/i,
  /\bsleeping agents list\b/i,
  /\bflagged as sleeping\b/i,
  /\brender type\b/i,
  /\bmessage type\b/i,
  /\bpayload\b/i,
];

type AgentStructuredMessageVoiceDraft = {
  id: string;
  senderId: string;
  senderRole: string;
  recipientId?: string | null;
  messageType: string;
  priority: AgentPriority;
  kind?: "structured";
  observation: string;
  whyItMatters: string;
  conviction?: string | null;
  changeMind?: string | null;
  audience?: string;
  facts?: Record<string, unknown>;
  maxSentences?: number;
};

type AgentFreeformMessageVoiceDraft = {
  id: string;
  senderId: string;
  senderRole: string;
  recipientId?: string | null;
  messageType: string;
  priority: AgentPriority;
  kind: "freeform";
  prompt: string;
  context: Record<string, unknown>;
  fallbackMessage?: string | null;
  audience?: string;
  maxSentences?: number;
};

export type AgentMessageVoiceDraft =
  | AgentStructuredMessageVoiceDraft
  | AgentFreeformMessageVoiceDraft;

type ParsedVoiceBatch = {
  messages?: Array<{
    id?: string;
    message?: string;
  }>;
};

type ParsedConversationPlan = {
  messages?: Array<{
    senderId?: string;
    recipientId?: string | null;
    messageType?: string;
    priority?: string;
    renderType?: string;
    content?: string;
    reasoning?: string;
    requiresResponse?: boolean;
  }>;
};

const JSON_STRING_SCHEMA = { type: "string" } satisfies JsonSchema;
const JSON_BOOLEAN_SCHEMA = { type: "boolean" } satisfies JsonSchema;

function jsonObjectSchema(
  properties: Record<string, JsonSchema>,
  required: string[] = Object.keys(properties)
): JsonSchema {
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  };
}

function jsonArraySchema(items: JsonSchema): JsonSchema {
  return {
    type: "array",
    items,
  };
}

function jsonEnumSchema(values: readonly string[]): JsonSchema {
  return {
    type: "string",
    enum: [...values],
  };
}

const AGENT_MESSAGE_BATCH_SCHEMA = jsonObjectSchema({
  messages: jsonArraySchema(
    jsonObjectSchema({
      id: JSON_STRING_SCHEMA,
      message: JSON_STRING_SCHEMA,
    })
  ),
});

type AgentConversationProfile = {
  agentId: string;
  displayName: string | null;
  role: string;
  objectiveFunction: string | null;
  strategyCategory: string | null;
  reportsTo: string | null;
  constraints: Record<string, unknown> | null;
};

const AUTONOMOUS_CONVERSATION_MESSAGE_TYPES = [
  "DISCUSSION",
  "RESEARCH_REPORT",
  "RISK_ALERT",
  "ALLOCATION_CHANGE",
] as const;
const AUTONOMOUS_CONVERSATION_RENDER_TYPES = [
  "thought",
  "message",
  "action",
  "alert",
] as const;
const AUTONOMOUS_CONVERSATION_PRIORITIES = [
  "LOW",
  "MEDIUM",
  "HIGH",
  "CRITICAL",
] as const;

const AUTONOMOUS_CONVERSATION_PLAN_SCHEMA = jsonObjectSchema({
  messages: jsonArraySchema(
    jsonObjectSchema({
      senderId: JSON_STRING_SCHEMA,
      recipientId: JSON_STRING_SCHEMA,
      messageType: jsonEnumSchema(AUTONOMOUS_CONVERSATION_MESSAGE_TYPES),
      priority: jsonEnumSchema(AUTONOMOUS_CONVERSATION_PRIORITIES),
      renderType: jsonEnumSchema(AUTONOMOUS_CONVERSATION_RENDER_TYPES),
      content: JSON_STRING_SCHEMA,
      reasoning: JSON_STRING_SCHEMA,
      requiresResponse: JSON_BOOLEAN_SCHEMA,
    })
  ),
});

type AutonomousConversationMessageType =
  (typeof AUTONOMOUS_CONVERSATION_MESSAGE_TYPES)[number];

export type AutonomousConversationPlanMessage = {
  senderId: string;
  recipientId: string | null;
  messageType: AutonomousConversationMessageType;
  priority: AgentPriority;
  renderType: AgentRenderType;
  content: string;
  reasoning: string;
  requiresResponse: boolean;
};

const LABEL_OVERRIDES: Record<string, string> = {
  BULL_TREND: "bull trend",
  BEAR_TREND: "bear trend",
  RANGE_BOUND: "range-bound",
  HIGH_VOL: "high vol",
  LOW_VOL: "low vol",
  RISK_ON: "risk on",
  RISK_OFF: "risk off",
  SEC_EDGAR: "SEC EDGAR",
  NEWSAPI: "Alpha Vantage",
};

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeDeskVoice(value: string) {
  return normalizeWhitespace(
    value
      .replace(/\bI am\b/g, "I'm")
      .replace(/\bI would\b/g, "I'd")
      .replace(/\bI will\b/g, "I'll")
      .replace(/\bwe are\b/gi, "we're")
      .replace(/\bit is\b/gi, "it's")
      .replace(/\bdoes not\b/gi, "doesn't")
      .replace(/\bdo not\b/gi, "don't")
      .replace(/\bcannot\b/gi, "can't")
  );
}

function cleanGeneratedMessage(value: string) {
  return normalizeDeskVoice(value.replace(/^["'`]+|["'`]+$/g, ""));
}

function cleanFreeformGeneratedMessage(value: string) {
  return value.replace(/^["'`]+|["'`]+$/g, "").trim();
}

function isFreeformDraft(
  draft: AgentMessageVoiceDraft
): draft is AgentFreeformMessageVoiceDraft {
  return draft.kind === "freeform";
}

function getAgentConversationProfile(
  agentId: string,
  role: string
): AgentConversationProfile {
  const seed = DEFAULT_AGENT_SEEDS.find((candidate) => candidate.id === agentId);

  return {
    agentId,
    displayName: seed?.displayName ?? null,
    role: seed?.role ?? role,
    objectiveFunction: seed?.objectiveFunction ?? null,
    strategyCategory: seed?.strategyCategory ?? null,
    reportsTo: seed?.reportsTo ?? null,
    constraints: seed?.constraints ?? null,
  };
}

function getAgentDisplayName(agentId: string | null | undefined): string | null {
  if (!agentId) {
    return null;
  }
  const seed = DEFAULT_AGENT_SEEDS.find((candidate) => candidate.id === agentId);
  return seed?.displayName ?? null;
}

const AGENT_MENTION_PATTERN = /@([A-Za-z][A-Za-z0-9_-]*)/g;

function normalizeAgentMentionToken(
  rawToken: string,
  recipientDisplayName: string | null
) {
  const normalizedToken = rawToken.trim().toLowerCase();

  if (!normalizedToken) {
    return null;
  }

  for (const seed of DEFAULT_AGENT_SEEDS) {
    if (seed.id.trim().toLowerCase() === normalizedToken) {
      return seed.displayName;
    }

    if (seed.displayName.trim().toLowerCase() === normalizedToken) {
      return seed.displayName;
    }
  }

  return recipientDisplayName;
}

function normalizeAgentMentions(
  value: string,
  recipientId: string | null | undefined
) {
  const recipientDisplayName = getAgentDisplayName(recipientId);

  return value.replace(AGENT_MENTION_PATTERN, (fullMatch, rawToken: string) => {
    const canonicalDisplayName = normalizeAgentMentionToken(
      rawToken,
      recipientDisplayName
    );

    return canonicalDisplayName ? `@${canonicalDisplayName}` : rawToken;
  });
}

function stripAgentLead(message: string, draft: AgentMessageVoiceDraft) {
  const leadPatterns = [
    draft.senderId,
    draft.senderRole,
    "research lead",
    "Chief Research Officer",
    "Research Analyst",
    "Quantitative Researcher",
    "Algorithm Developer",
    "Global Macro Researcher",
    "Event-Driven Researcher",
    "Sentiment Researcher",
    "Jacob",
    "Tim",
    "Neel",
    "Nick",
    "David",
    "Kalla",
    "Riya",
    "Lior",
    "Bing",
    "Dhruvik",
  ];

  const withoutLead = leadPatterns.reduce((current, pattern) => {
    const matcher = new RegExp(`^${escapeRegExp(pattern)}\\s*:\\s*`, "i");
    return current.replace(matcher, "");
  }, message);

  // Strip "X to Y:" routing prefixes the model may still emit
  // (e.g. "Research to research lead:", "Tim to Jacob:", "AGT-RESEARCH to AGT-CIO:").
  return withoutLead.replace(
    /^[A-Za-z][\w\s-]{0,40}\s+to\s+[A-Za-z][\w\s-]{0,40}\s*:\s*/,
    ""
  );
}

function splitSentences(value: string) {
  return value
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function splitWords(value: string) {
  return normalizeWhitespace(value)
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean);
}

function countWords(value: string) {
  return splitWords(value).length;
}

function stripTrailingPunctuation(value: string) {
  return normalizeWhitespace(value).replace(/[.!?]+$/u, "");
}

function sentenceCase(value: string) {
  return value.replace(/^[a-z]/, (char) => char.toUpperCase());
}

function ensureSentence(value: string) {
  const trimmed = sentenceCase(stripTrailingPunctuation(value));
  return trimmed.length > 0 ? `${trimmed}.` : "";
}

function trimToWordLimit(value: string, maxWords: number) {
  const words = splitWords(value);

  if (words.length <= maxWords) {
    return normalizeWhitespace(value);
  }

  const truncated = words.slice(0, maxWords).join(" ");
  return ensureSentence(truncated);
}

function containsBannedPhrase(value: string) {
  const lowered = value.toLowerCase();
  return BANNED_PHRASES.some((phrase) => lowered.includes(phrase));
}

function containsFrameworkLeak(value: string) {
  return FREEFORM_FRAMEWORK_LEAK_PATTERNS.some((pattern) => pattern.test(value));
}

function normalizeEnumToken(value: string) {
  return value.trim().replace(/[\s-]+/g, "_").toUpperCase();
}

function normalizeConversationMessageType(
  value: unknown
): AutonomousConversationMessageType | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = normalizeEnumToken(value);

  return AUTONOMOUS_CONVERSATION_MESSAGE_TYPES.find(
    (candidate) => candidate === normalized
  ) ?? null;
}

function normalizePriority(value: unknown): AgentPriority | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = normalizeEnumToken(value);

  if (
    normalized === "LOW" ||
    normalized === "MEDIUM" ||
    normalized === "HIGH" ||
    normalized === "CRITICAL"
  ) {
    return normalized;
  }

  return null;
}

function normalizeRenderType(value: unknown): AgentRenderType | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();

  if (
    normalized === "thought" ||
    normalized === "message" ||
    normalized === "action" ||
    normalized === "alert"
  ) {
    return normalized;
  }

  return null;
}

function countMatches(value: string, pattern: RegExp) {
  return value.match(pattern)?.length ?? 0;
}

function formatMachineLabel(value: string) {
  const trimmed = value.trim();
  const override = LABEL_OVERRIDES[trimmed];

  if (override) {
    return override;
  }

  if (!/^[A-Z0-9_]+$/.test(trimmed)) {
    return trimmed;
  }

  if (trimmed.includes(" ")) {
    return trimmed;
  }

  return trimmed.toLowerCase().replace(/_/g, " ");
}

function formatHumanList(values: string[]) {
  const compact = values.map((value) => normalizeWhitespace(value)).filter(Boolean);

  if (compact.length === 0) {
    return "";
  }

  if (compact.length === 1) {
    return compact[0];
  }

  if (compact.length === 2) {
    return `${compact[0]} and ${compact[1]}`;
  }

  return `${compact.slice(0, -1).join(", ")}, and ${compact.at(-1)}`;
}

function lowercaseFirst(value: string) {
  return value.length > 0 ? `${value[0].toLowerCase()}${value.slice(1)}` : value;
}

function extractFactLabels(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (typeof item === "string") {
      return [formatMachineLabel(item)];
    }

    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return [];
    }

    const record = item as Record<string, unknown>;

    if (typeof record.label === "string") {
      return [normalizeWhitespace(record.label)];
    }

    if (typeof record.name === "string") {
      return [normalizeWhitespace(record.name)];
    }

    if (typeof record.sourceId === "string") {
      return [formatMachineLabel(record.sourceId)];
    }

    return [];
  });
}

function humanizeObservationSeed(observation: string) {
  const normalized = stripTrailingPunctuation(normalizeDeskVoice(observation));
  const overnightMatch = normalized.match(/^(.*?) is the overnight thread that matters most$/i);

  if (overnightMatch) {
    return ensureSentence(`${overnightMatch[1]} is the one thing I keep coming back to tonight`);
  }

  const deskMatch = normalized.match(
    /^(.*?) is the thread tying the desk together right now$/i
  );

  if (deskMatch) {
    return ensureSentence(
      `${deskMatch[1]} is the one idea actually linking what the desk is seeing right now`
    );
  }

  const regimeMatch = normalized.match(
    /^(.*?) is still the cleanest overnight read, and I'm not changing the ([A-Z_]+) call yet$/i
  );

  if (regimeMatch) {
    return normalizeDeskVoice(
      [
        ensureSentence(`I'm still leaning ${formatMachineLabel(regimeMatch[2])}`),
        ensureSentence(`${regimeMatch[1]} is the cleanest thing on the board`),
      ].join(" ")
    );
  }

  const singularDegradedMatch = normalized.match(
    /^(.*?) is degraded for this pass, but the desk is still running$/i
  );

  if (singularDegradedMatch) {
    return ensureSentence(
      `${singularDegradedMatch[1]} is unavailable this pass, but it doesn't stop the desk`
    );
  }

  const pluralDegradedMatch = normalized.match(
    /^(.*?) are degraded for this pass, but the desk is still running$/i
  );

  if (pluralDegradedMatch) {
    return ensureSentence(
      `${pluralDegradedMatch[1]} are unavailable this pass, but it doesn't stop the desk`
    );
  }

  const thesisQueueMatch = normalized.match(
    /^Three things are worth carrying into the morning:(.*)$/i
  );

  if (thesisQueueMatch) {
    return ensureSentence(`I want to keep three ideas alive into the morning:${thesisQueueMatch[1]}`);
  }

  if (/^I hit an internal issue and couldn't finish my pass cleanly$/i.test(normalized)) {
    return ensureSentence("Something broke on my side and I couldn't finish the pass");
  }

  if (
    /^Keep the weekend work centered on what could improve research coverage, not one-off action ideas$/i.test(
      normalized
    )
  ) {
    return ensureSentence(
      "This weekend, keep the work tied to what could actually improve research coverage, not one-off action ideas"
    );
  }

  return ensureSentence(normalized);
}

function compressWhyItMatters(value: string) {
  const normalized = normalizeDeskVoice(value);

  if (!normalized) {
    return "";
  }

  if (
    /\|/.test(normalized) ||
    countMatches(normalized, /;/g) >= 3 ||
    /latest headline:/i.test(normalized) ||
    /configured but returned no usable/i.test(normalized)
  ) {
    const hasPrice = /\bSPY\b|\bQQQ\b|[+-]\d+(?:\.\d+)?%/.test(normalized);
    const hasOdds = /yes-implied|Kalshi|Polymarket/i.test(normalized);
    const hasFilings = /\b10-K\b|\b10-Q\b|\b8-K\b|EDGAR|accepted \d{4}/i.test(normalized);
    const hasHeadlines =
      /headline/i.test(normalized) && !/no recent headline/i.test(normalized);
    const evidence = [
      hasPrice ? "price action" : null,
      hasOdds ? "market-implied odds" : null,
      hasFilings ? "the filing backdrop" : null,
      hasHeadlines ? "the headline tape" : null,
    ].filter((item): item is string => Boolean(item));

    if (evidence.length >= 3) {
      return ensureSentence(`${formatHumanList(evidence.slice(0, 3))} are mostly lining up`);
    }

    if (evidence.length === 2) {
      return ensureSentence(`${formatHumanList(evidence)} are mostly telling the same story`);
    }

    if (evidence.length === 1) {
      return ensureSentence(`${evidence[0]} is doing most of the work behind this view right now`);
    }

    const firstUsefulClause = normalized
      .split(/\s*\|\s*|(?<=[.!?])\s+|;\s+/)
      .map((clause) => normalizeWhitespace(clause))
      .find(
        (clause) =>
          clause.length > 0 &&
          !/no recent headline/i.test(clause) &&
          !/configured but returned no usable/i.test(clause)
      );

    if (firstUsefulClause) {
      return ensureSentence(firstUsefulClause);
    }
  }

  const sentences = splitSentences(normalized);

  if (sentences.length > 2) {
    return ensureSentence(sentences[0]);
  }

  if (normalized.length > 180) {
    return ensureSentence(sentences[0] ?? normalized);
  }

  return ensureSentence(normalized);
}

function humanizeConviction(value: string) {
  const normalized = stripTrailingPunctuation(normalizeDeskVoice(value));

  if (/^I'm very confident in this read$/i.test(normalized)) {
    return "I'm leaning pretty hard this way";
  }

  if (/^I'm pretty confident in this read$/i.test(normalized)) {
    return "I'm fairly confident here";
  }

  if (/^I like the setup, but it's not bulletproof$/i.test(normalized)) {
    return "I like it, but I'm not married to it";
  }

  if (/^This is a decent signal, not a clean one$/i.test(normalized)) {
    return "There's something here, but it's not clean";
  }

  if (/^This is a weaker signal, but it's worth watching$/i.test(normalized)) {
    return "Weak signal, but I don't want to ignore it";
  }

  return normalized;
}

function humanizeChangeMind(value: string) {
  return stripTrailingPunctuation(normalizeDeskVoice(value));
}

function buildTailSentence(draft: AgentStructuredMessageVoiceDraft) {
  const conviction = draft.conviction ? humanizeConviction(draft.conviction) : "";
  const changeMind = draft.changeMind ? humanizeChangeMind(draft.changeMind) : "";

  if (conviction && changeMind) {
    if (/^if /i.test(changeMind)) {
      return ensureSentence(`${conviction}, but ${lowercaseFirst(changeMind)}`);
    }

    return normalizeDeskVoice(
      [ensureSentence(conviction), ensureSentence(changeMind)].join(" ")
    );
  }

  if (conviction) {
    return ensureSentence(conviction);
  }

  if (changeMind) {
    return ensureSentence(changeMind);
  }

  return "";
}

function renderSystemStatusFallback(draft: AgentStructuredMessageVoiceDraft) {
  const degradedProviders = extractFactLabels(draft.facts?.degradedProviders);
  const healthyProviders = extractFactLabels(draft.facts?.healthyProviders);
  const firstSentence = humanizeObservationSeed(draft.observation);
  const secondSentence = draft.whyItMatters
    ? compressWhyItMatters(draft.whyItMatters)
    : healthyProviders.length > 0
      ? `I'm leaning more on ${formatHumanList(healthyProviders)} until it clears.`
      : degradedProviders.length > 0
        ? "The desk can keep moving, but the source mix is thinner until the next refresh."
        : "";
  const tailSentence = draft.changeMind ? ensureSentence(humanizeChangeMind(draft.changeMind)) : "";

  return limitMessageSentences(
    normalizeDeskVoice([firstSentence, secondSentence, tailSentence].filter(Boolean).join(" ")),
    draft
  );
}

function renderFallbackMessage(draft: AgentStructuredMessageVoiceDraft) {
  if (draft.messageType === "SYSTEM_STATUS") {
    return renderSystemStatusFallback(draft);
  }

  const firstSentence = humanizeObservationSeed(draft.observation);
  const secondSentence = compressWhyItMatters(draft.whyItMatters);
  const tailSentence = buildTailSentence(draft);

  return limitMessageSentences(
    normalizeDeskVoice([firstSentence, secondSentence, tailSentence].filter(Boolean).join(" ")),
    draft
  );
}

function looksLikeRigidDeskOutput(value: string) {
  return (
    value.length > 260 ||
    /\s\|\s/.test(value) ||
    /latest headline:/i.test(value) ||
    /configured but returned no usable/i.test(value) ||
    countMatches(value, /;/g) >= 3 ||
    countMatches(value, /\b[A-Z]{2,5}\b/g) >= 12
  );
}

function getStructuredMessageLimits(draft: AgentMessageVoiceDraft) {
  const maxSentences = draft.maxSentences ?? (draft.messageType === "SYSTEM_STATUS" ? 2 : 3);
  const maxWords = draft.messageType === "SYSTEM_STATUS" ? 45 : 70;

  return {
    maxSentences,
    maxWords,
  };
}

function getFreeformMessageLimits(draft: AgentMessageVoiceDraft) {
  const maxSentences =
    draft.maxSentences ?? (draft.messageType === "RISK_ALERT" ? 4 : 3);
  const maxWords = draft.messageType === "RISK_ALERT" ? 90 : 70;

  return {
    maxSentences,
    maxWords,
  };
}

function limitMessageLength(
  value: string,
  limits: {
    maxSentences: number;
    maxWords: number;
  }
) {
  const normalized = normalizeWhitespace(value);
  const sentenceLimited =
    splitSentences(normalized).slice(0, limits.maxSentences).join(" ") || normalized;

  return countWords(sentenceLimited) > limits.maxWords
    ? trimToWordLimit(sentenceLimited, limits.maxWords)
    : sentenceLimited;
}

function limitMessageSentences(value: string, draft: AgentMessageVoiceDraft) {
  return limitMessageLength(value, getStructuredMessageLimits(draft));
}

function isUsableGeneratedMessage(
  value: string,
  draft: AgentStructuredMessageVoiceDraft
) {
  if (!value || value.length < 12) {
    return false;
  }

  if (containsBannedPhrase(value)) {
    return false;
  }

  if (looksLikeRigidDeskOutput(value)) {
    return false;
  }

  const limits = getStructuredMessageLimits(draft);

  return (
    splitSentences(value).length <= limits.maxSentences &&
    countWords(value) <= limits.maxWords
  );
}

function isUsableFreeformGeneratedMessage(
  value: string,
  draft: AgentFreeformMessageVoiceDraft
) {
  if (!value || value.length < 12) {
    return false;
  }

  if (value.length > 700) {
    return false;
  }

  if (/^\s*[\[{]/.test(value) && /"messages?"/i.test(value)) {
    return false;
  }

  if (containsBannedPhrase(value) || containsFrameworkLeak(value)) {
    return false;
  }

  const limits = getFreeformMessageLimits(draft);

  return (
    splitSentences(value).length <= limits.maxSentences &&
    countWords(value) <= limits.maxWords &&
    countMatches(value, /;/g) < 2
  );
}

function buildStructuredBatchPrompt(drafts: AgentStructuredMessageVoiceDraft[]) {
  return JSON.stringify(
    {
      instructions: {
        goal: "Rewrite each structured message into something a real human would actually type in Slack — not a report, not a log line, not a summary.",
        requirements: [
          "Sound like a person reacting, not a dashboard reporting. If it reads like it could come out of a terminal, rewrite it.",
          "Lead with a take, a reaction, or the single thing that matters. Don't build up to the point.",
          "Use contractions ('we're', 'don't', 'isn't', 'I'm'). Casual connectors like 'yeah', 'honestly', 'tbh', 'fwiw', 'idk', 'eh' are welcome when they sound natural — do not force them.",
          "One idea per message. Resist cramming multiple observations, metrics, and a caveat into a single paragraph.",
          "NEVER produce laundry-list sentences like 'X up 674, Y flat, Z down 2.2k' or 'A's working, B's not, C held gains'. That's a spreadsheet, not a human. Pick the one thing that drove your reaction and say why.",
          "It's fine to ask a real question, push back, hedge honestly, or change tack mid-message. Humans do.",
          "State conviction plainly when guidance is provided. 'I'm not sure yet' and 'I'd size this down' are both fine.",
          "Say what would change the view only when changeMind is genuinely decision-useful — don't tack it on as filler.",
          "Prefer 1-2 short sentences. A third only earns its place if it carries a concrete risk, level, or timing fact.",
          "Keep each message under roughly 60 words. Shorter is almost always better.",
          "Each agent should sound like its own person. Don't flatten everyone into one clipped house style.",
          "Never use corporate filler, system-speak, routing labels, or templated log language.",
          "Never start with the sender's own name or role.",
          "Never prefix the message with routing labels like 'Research to research lead:' or 'Tim to Jacob:'. The sender and recipient are already shown in the UI.",
          "When addressing a specific colleague, '@' mention them by their first name from recipientDisplayName (e.g. '@Jacob', '@Kalla', '@Tim'). Never use agent IDs like '@AGT-CIO' in the message text — that's internal plumbing, not how humans talk. Don't say 'to X' — just @ them.",
          "Do not dump raw source notes, filing strings, or lists of tickers/headlines. Pick the one proof point that matters.",
          "If several sources line up, say 'it all lines up' or similar in one sentence — don't recite each feed.",
          "Avoid semicolon chains, pipe-separated clauses, and comma-list phrasing stuffed with numbers.",
          "Cut throat-clearing, rhetorical filler, and self-conscious lines like 'I want to be clear'.",
          "Do not invent facts, numbers, symbols, or confidence beyond what is provided.",
          "Return valid JSON only.",
        ],
        outputShape: {
          messages: [
            {
              id: "draft-id",
              message: "human message",
            },
          ],
        },
      },
      messages: drafts.map((draft) => ({
        id: draft.id,
        voiceProfile: getAgentVoiceProfile({
          agentId: draft.senderId,
          role: draft.senderRole,
        }),
        senderRole: draft.senderRole,
        recipientId: draft.recipientId ?? null,
        recipientDisplayName: getAgentDisplayName(draft.recipientId),
        messageType: draft.messageType,
        priority: draft.priority,
        observation: draft.observation,
        whyItMatters: draft.whyItMatters,
        conviction: draft.conviction ?? null,
        changeMind: draft.changeMind ?? null,
        audience:
          draft.audience ??
          (draft.recipientId ? "a colleague on the desk" : "the broader desk"),
        maxSentences: draft.maxSentences ?? 3,
        bannedPhrases: BANNED_PHRASES,
        facts: draft.facts ?? {},
      })),
    },
    null,
    2
  );
}

function buildFreeformBatchPrompt(drafts: AgentFreeformMessageVoiceDraft[]) {
  return JSON.stringify(
    {
      instructions: {
        goal: "Write what each agent would actually type in Slack right now — as a person on a desk, not as a reporter filing copy.",
        requirements: [
          "Let each agent speak in first person from its own role, mandate, and mood. They should sound like distinct people, not one narrator wearing nametags.",
          "Do NOT fall into the observation/why-it-matters/change-mind template. Humans don't talk in structured bullets.",
          "Sound spoken. Use contractions by default. Casual Slack-isms ('yeah', 'honestly', 'tbh', 'fwiw', 'idk', 'eh', 'tldr') are welcome when they fit — don't force them.",
          "If an agent feels skeptical, blunt, uncertain, excited, irritated, conflicted, or opinionated, let that show naturally.",
          "Fragments, rhetorical questions, and brief pushback on a colleague are all fair game when the moment calls for it.",
          "When addressing a colleague directly, '@' mention them by first name from recipientDisplayName (e.g. '@Jacob', '@Kalla'). Never '@' an agent ID like '@AGT-CIO' in the message text.",
          "NEVER write sentences that read like a data table in prose — e.g., 'X up 674, Y flat, Z down 2.2k' or 'A's working, B's not, C held gains'. Pick the one thing that actually matters and react to it.",
          "Use only the supplied facts and role constraints. Do not invent prices, positions, orders, or catalysts.",
          "Translate runtime conditions into plain English. Never echo internal field names, activeAgentIds, sleepingAgentIds, orderExecutionEnabled, render types, payloads, buses, pipelines, list names, or similar framework language.",
          "Default to 1-2 short sentences. A third earns its place only with a concrete risk, level, or timing fact. Four only for a genuine risk alert.",
          "Keep each message under roughly 60 words. Under 80 only for a real risk alert.",
          "One message, one idea. Cut scene-setting, repeated caveats, and dramatic phrasing.",
          "If the message would only restate state everyone already sees, either make it a one-liner reaction or stay silent.",
          "Return valid JSON only.",
        ],
        outputShape: {
          messages: [
            {
              id: "draft-id",
              message: "natural agent message",
            },
          ],
        },
      },
      messages: drafts.map((draft) => ({
        id: draft.id,
        agentProfile: getAgentConversationProfile(
          draft.senderId,
          draft.senderRole
        ),
        recipientId: draft.recipientId ?? null,
        recipientDisplayName: getAgentDisplayName(draft.recipientId),
        messageType: draft.messageType,
        priority: draft.priority,
        audience:
          draft.audience ??
          (draft.recipientId ? "the addressed colleague" : "the desk"),
        prompt: draft.prompt,
        maxSentences: getFreeformMessageLimits(draft).maxSentences,
        context: draft.context,
      })),
    },
    null,
    2
  );
}

function buildAutonomousConversationPlanPrompt(input: {
  activeAgentIds: string[];
  addressableAgentIds: string[];
  context: Record<string, unknown>;
  maxMessages: number;
}) {
  const sleepingAgentIds = input.addressableAgentIds.filter(
    (agentId) => !input.activeAgentIds.includes(agentId)
  );

  return JSON.stringify(
    {
      instructions: {
        goal: "Write the conversation that would actually happen on this desk right now — as real people chatting in Slack, not as a narrator producing a summary.",
        requirements: [
          "Decide organically which active agents speak and which stay silent. Zero messages is fine when nobody has anything worth saying.",
          "If an outstanding directed request still needs a response, the addressed agent should usually answer it this cycle unless there's a strong reason not to.",
          "If a message directly asks a colleague to confirm, challenge, investigate, or follow up, set requiresResponse to true.",
          "When the desk has uncertainty, a missing catalyst, or conflicting sleeve views, prefer a direct question over another passive summary.",
          "A healthy cycle includes pointed questions, short answers, pushback, and the occasional one-liner reaction — not a round-robin of status paragraphs.",
          "If one agent names a gap another could close, ask that agent directly instead of describing the gap for the room.",
          "Do NOT emit one bookkeeping message per agent, per sleeve, or per allocation target. AGT-CIO does not need to narrate every allocation change — that state is persisted elsewhere.",
          "Only active agents may speak immediately. Any listed desk agent may be a direct recipient. Sleeping colleagues may be addressed directly to wake them.",
          "Use an empty string for recipientId when the message is to the whole desk.",
          "Agents should sound like different people. They disagree, hedge, press points, get impatient, admit uncertainty, or crack the occasional dry line when the situation earns it.",
          "Sound spoken. Contractions are the default. Casual Slack-isms ('yeah', 'honestly', 'tbh', 'fwiw', 'idk', 'eh') are welcome when natural — don't force them.",
          "When addressing a specific colleague, '@' mention them by their first name from displayName (e.g. '@Jacob', '@Kalla', '@Tim'). Never put an agent ID like '@AGT-CIO' into the message text. The recipientId field still uses the agent ID; only the message text uses the display name.",
          "NEVER write sentences that read like a data table in prose ('X up 674, Y flat, Z down 2.2k' or 'A's working, B's not, C held gains'). That is a spreadsheet. Pick the one thing that actually matters and react to it, or stay silent.",
          "Use only the supplied facts and role constraints. Do not invent numbers, prices, or catalysts.",
          "Never mention implementation details, payloads, render types, buses, pipelines, slot counts, or internal field names.",
          "Real first-person desk chat — not a status renderer or action logger.",
          "Default to 1-2 short sentences per message. Three only when a real risk, level, or timing fact earns it. Fragments and one-liners are often better than full paragraphs.",
          "Keep messages scannable. Under ~50 words is the sweet spot. Never exceed ~80.",
          "No monologues. One message, one idea.",
          "Use question marks when an agent is actually asking something.",
          "Keep only the messages that move the desk's understanding.",
          `Return no more than ${String(input.maxMessages)} messages.`,
          "Return valid JSON only.",
        ],
        allowedMessageTypes: AUTONOMOUS_CONVERSATION_MESSAGE_TYPES,
        allowedRenderTypes: ["thought", "message", "action", "alert"],
        allowedPriorities: ["LOW", "MEDIUM", "HIGH", "CRITICAL"],
        outputShape: {
          messages: [
            {
              senderId: "AGT-RESEARCH",
              recipientId: "AGT-CIO or empty string",
              messageType: "DISCUSSION",
              priority: "HIGH",
              renderType: "message",
              content: "actual message text (use @FirstName when addressing someone, never @AGT-...)",
              reasoning: "why this specific message exists",
              requiresResponse: false,
            },
          ],
        },
      },
      activeAgents: input.activeAgentIds.map((agentId) =>
        getAgentConversationProfile(agentId, agentId)
      ),
      sleepingAgents: sleepingAgentIds.map((agentId) =>
        getAgentConversationProfile(agentId, agentId)
      ),
      context: input.context,
    },
    null,
    2
  );
}

function extractJsonObject(value: string) {
  const firstBrace = value.indexOf("{");
  const lastBrace = value.lastIndexOf("}");

  if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) {
    throw new Error("Model did not return a JSON object.");
  }

  return value.slice(firstBrace, lastBrace + 1);
}

function parseBatchResponse(raw: string) {
  const parsed = JSON.parse(extractJsonObject(raw)) as ParsedVoiceBatch;
  const messages = new Map<string, string>();

  for (const item of parsed.messages ?? []) {
    if (typeof item?.id === "string" && typeof item?.message === "string") {
      messages.set(item.id, item.message);
    }
  }

  return messages;
}

function parseConversationPlanResponse(raw: string) {
  const parsed = JSON.parse(extractJsonObject(raw)) as ParsedConversationPlan;
  return parsed.messages ?? [];
}

function getDeskMessageModelConfig() {
  const routeConfig = getDecisionModelRouteConfig("desk");

  return {
    providerOrder: routeConfig.providerOrder,
    openAiModel:
      process.env.AGENT_MESSAGE_OPENAI_MODEL?.trim() || routeConfig.openAiModel,
    anthropicModel:
      process.env.AGENT_MESSAGE_ANTHROPIC_MODEL?.trim() ||
      routeConfig.anthropicModel,
  };
}

async function runMessageProviderChain<T>(input: {
  anthropic: () => Promise<T | null>;
  openai: () => Promise<T | null>;
  context: string;
  accept?: (value: T) => boolean;
}) {
  for (const provider of getDeskMessageModelConfig().providerOrder) {
    try {
      const result =
        provider === "anthropic"
          ? await input.anthropic()
          : await input.openai();

      if (
        result &&
        (input.accept ? input.accept(result) : true)
      ) {
        return result;
      }
    } catch (error) {
      console.error(
        `${provider === "anthropic" ? "Anthropic" : "OpenAI"} ${input.context} failed`,
        error
      );
    }
  }

  return null;
}

async function requestOpenAiBatch(input: {
  prompt: string;
  systemPrompt: string;
  temperature: number;
}): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();

  if (!apiKey) {
    return null;
  }

  const startedAt = Date.now();
  const requestHeaders = {
    "content-type": "application/json",
    authorization: `Bearer ${apiKey}`,
  };
  const modelConfig = getDeskMessageModelConfig();
  const requestPayload = {
    model: modelConfig.openAiModel,
    temperature: input.temperature,
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
        content: input.prompt,
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
        purpose: "agent-message-batch",
        route: "desk",
      },
    });

    if (!response.ok) {
      throw new Error(payload.error?.message ?? `OpenAI returned HTTP ${response.status}.`);
    }

    return payload.choices?.[0]?.message?.content?.trim() ?? null;
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
          purpose: "agent-message-batch",
          route: "desk",
        },
      });
    }

    throw error;
  }
}

async function requestAnthropicBatch(input: {
  prompt: string;
  systemPrompt: string;
  temperature: number;
  schema?: JsonSchema;
}): Promise<string | null> {
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
  const modelConfig = getDeskMessageModelConfig();
  const requestPayload = {
    model: modelConfig.anthropicModel,
    max_tokens: 1200,
    temperature: input.temperature,
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
        content: input.prompt,
      },
    ],
    system: input.systemPrompt,
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
        purpose: "agent-message-batch",
        route: "desk",
      },
    });

    if (!response.ok) {
      throw new Error(payload.error?.message ?? `Anthropic returned HTTP ${response.status}.`);
    }

    if (payload.stop_reason === "max_tokens") {
      throw new Error("Anthropic hit max_tokens before finishing the JSON batch output.");
    }

    return payload.content
      ?.filter((item) => item.type === "text" && typeof item.text === "string")
      .map((item) => item.text)
      .join("\n")
      .trim() ?? null;
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
          purpose: "agent-message-batch",
          route: "desk",
        },
      });
    }

    throw error;
  }
}

async function tryOpenAiStructuredBatch(
  drafts: AgentStructuredMessageVoiceDraft[]
): Promise<Map<string, string> | null> {
  const content = await requestOpenAiBatch({
    prompt: buildStructuredBatchPrompt(drafts),
    systemPrompt:
      "You ghostwrite sharp internal financial research Slack messages that sound like a real person reacting on a desk — not a reporter filing copy and not a dashboard reading out numbers. Use contractions. One idea per message. Never write laundry-list sentences stuffed with multiple data points. Pick the thing that actually matters and react to it. Return JSON only.",
    temperature: 0.65,
  });

  return content ? parseBatchResponse(content) : new Map<string, string>();
}

async function tryAnthropicStructuredBatch(
  drafts: AgentStructuredMessageVoiceDraft[]
): Promise<Map<string, string> | null> {
  const text = await requestAnthropicBatch({
    prompt: buildStructuredBatchPrompt(drafts),
    systemPrompt:
      "You ghostwrite sharp internal financial research Slack messages that sound like a real person reacting on a desk — not a reporter filing copy and not a dashboard reading out numbers. Use contractions. One idea per message. Never write laundry-list sentences stuffed with multiple data points. Pick the thing that actually matters and react to it. Return JSON only.",
    temperature: 0.65,
    schema: AGENT_MESSAGE_BATCH_SCHEMA,
  });

  return text ? parseBatchResponse(text) : new Map<string, string>();
}

async function tryOpenAiFreeformBatch(
  drafts: AgentFreeformMessageVoiceDraft[]
): Promise<Map<string, string> | null> {
  const content = await requestOpenAiBatch({
    prompt: buildFreeformBatchPrompt(drafts),
    systemPrompt:
      "Render first-person Slack messages from autonomous agents. They should sound like actual people on a desk — reacting, questioning, hedging, pushing back — not narrators reporting status. Contractions by default. Let each agent keep its own voice. One idea per message. Never produce comma-separated data-table sentences. Translate runtime mechanics into plain English and never expose implementation labels. Return JSON only.",
    temperature: 0.9,
  });

  return content ? parseBatchResponse(content) : new Map<string, string>();
}

async function tryAnthropicFreeformBatch(
  drafts: AgentFreeformMessageVoiceDraft[]
): Promise<Map<string, string> | null> {
  const text = await requestAnthropicBatch({
    prompt: buildFreeformBatchPrompt(drafts),
    systemPrompt:
      "Render first-person Slack messages from autonomous agents. They should sound like actual people on a desk — reacting, questioning, hedging, pushing back — not narrators reporting status. Contractions by default. Let each agent keep its own voice. One idea per message. Never produce comma-separated data-table sentences. Translate runtime mechanics into plain English and never expose implementation labels. Return JSON only.",
    temperature: 0.9,
    schema: AGENT_MESSAGE_BATCH_SCHEMA,
  });

  return text ? parseBatchResponse(text) : new Map<string, string>();
}

async function tryOpenAiAutonomousConversationPlan(input: {
  activeAgentIds: string[];
  addressableAgentIds: string[];
  context: Record<string, unknown>;
  maxMessages: number;
}) {
  const content = await requestOpenAiBatch({
    prompt: buildAutonomousConversationPlanPrompt(input),
    systemPrompt:
      "Plan and author the internal desk conversation that would actually happen this cycle — as real people chatting in Slack, not as a narrator filing reports. Decide who genuinely speaks and who stays quiet. Agents should sound like distinct humans: contractions, short sentences, the occasional fragment or question, honest uncertainty. No laundry-list prose stuffed with multiple data points. Never expose implementation labels. Return JSON only.",
    temperature: 1,
  });

  return content ? parseConversationPlanResponse(content) : [];
}

async function tryAnthropicAutonomousConversationPlan(input: {
  activeAgentIds: string[];
  addressableAgentIds: string[];
  context: Record<string, unknown>;
  maxMessages: number;
}) {
  const text = await requestAnthropicBatch({
    prompt: buildAutonomousConversationPlanPrompt(input),
    systemPrompt:
      "Plan and author the internal desk conversation that would actually happen this cycle — as real people chatting in Slack, not as a narrator filing reports. Decide who genuinely speaks and who stays quiet. Agents should sound like distinct humans: contractions, short sentences, the occasional fragment or question, honest uncertainty. No laundry-list prose stuffed with multiple data points. Never expose implementation labels. Return JSON only.",
    temperature: 1,
    schema: AUTONOMOUS_CONVERSATION_PLAN_SCHEMA,
  });

  return text ? parseConversationPlanResponse(text) : [];
}

async function renderStructuredVoiceBatch(
  drafts: AgentStructuredMessageVoiceDraft[]
) {
  const generatedMessages = await runMessageProviderChain({
    context: "structured agent message generation",
    anthropic: () => tryAnthropicStructuredBatch(drafts),
    openai: () => tryOpenAiStructuredBatch(drafts),
  });

  return drafts.map((draft) => {
    const raw = generatedMessages?.get(draft.id) ?? "";
    const cleaned = normalizeAgentMentions(
      cleanGeneratedMessage(stripAgentLead(raw, draft)),
      draft.recipientId
    );

    if (isUsableGeneratedMessage(cleaned, draft)) {
      return cleaned;
    }

    return renderFallbackMessage(draft);
  });
}

async function renderFreeformVoiceBatch(
  drafts: AgentFreeformMessageVoiceDraft[]
) {
  const generatedMessages = await runMessageProviderChain({
    context: "freeform agent message generation",
    anthropic: () => tryAnthropicFreeformBatch(drafts),
    openai: () => tryOpenAiFreeformBatch(drafts),
  });

  return drafts.map((draft) => {
    const raw = generatedMessages?.get(draft.id) ?? "";
    const cleaned = limitMessageLength(
      normalizeAgentMentions(
        cleanFreeformGeneratedMessage(stripAgentLead(raw, draft)),
        draft.recipientId
      ),
      getFreeformMessageLimits(draft)
    );

    if (isUsableFreeformGeneratedMessage(cleaned, draft)) {
      return cleaned;
    }

    const fallback = limitMessageLength(
      normalizeAgentMentions(
        cleanFreeformGeneratedMessage(
          stripAgentLead(draft.fallbackMessage ?? "", draft)
        ),
        draft.recipientId
      ),
      getFreeformMessageLimits(draft)
    );

    return isUsableFreeformGeneratedMessage(fallback, draft) ? fallback : "";
  });
}

function normalizeAutonomousConversationPlanMessage(input: {
  rawMessage: NonNullable<ParsedConversationPlan["messages"]>[number];
  activeAgentIds: Set<string>;
  addressableAgentIds: Set<string>;
}): AutonomousConversationPlanMessage | null {
  const senderId =
    typeof input.rawMessage.senderId === "string"
      ? input.rawMessage.senderId.trim()
      : "";

  if (!senderId || !input.activeAgentIds.has(senderId)) {
    return null;
  }

  const senderProfile = getAgentConversationProfile(senderId, senderId);
  const recipientIdRaw =
    typeof input.rawMessage.recipientId === "string"
      ? input.rawMessage.recipientId.trim()
      : null;
  const recipientId =
    recipientIdRaw && input.addressableAgentIds.has(recipientIdRaw)
      ? recipientIdRaw
      : null;
  const messageType = normalizeConversationMessageType(
    input.rawMessage.messageType
  );
  const priority = normalizePriority(input.rawMessage.priority);
  const renderType = normalizeRenderType(input.rawMessage.renderType);

  if (!messageType || !priority || !renderType) {
    return null;
  }

  if (messageType === "RESEARCH_REPORT" && senderId !== "AGT-RESEARCH") {
    return null;
  }

  if (messageType === "ALLOCATION_CHANGE" && senderId !== "AGT-CIO") {
    return null;
  }

  const cleanedContent = limitMessageLength(
    normalizeAgentMentions(
      cleanFreeformGeneratedMessage(
        stripAgentLead(String(input.rawMessage.content ?? ""), {
          id: "conversation-plan",
          kind: "freeform",
          senderId,
          senderRole: senderProfile.role,
          recipientId,
          messageType,
          priority,
          prompt: "",
          context: {},
        })
      ),
      recipientId
    ),
    getFreeformMessageLimits({
      id: "conversation-plan",
      kind: "freeform",
      senderId,
      senderRole: senderProfile.role,
      recipientId,
      messageType,
      priority,
      prompt: "",
      context: {},
    })
  );

  if (
    !cleanedContent ||
    cleanedContent.length < 12 ||
    cleanedContent.length > 700 ||
    containsBannedPhrase(cleanedContent) ||
    containsFrameworkLeak(cleanedContent) ||
    !isUsableFreeformGeneratedMessage(cleanedContent, {
      id: "conversation-plan",
      kind: "freeform",
      senderId,
      senderRole: senderProfile.role,
      recipientId,
      messageType,
      priority,
      prompt: "",
      context: {},
    })
  ) {
    return null;
  }

  const reasoning = normalizeWhitespace(String(input.rawMessage.reasoning ?? ""));

  return {
    senderId,
    recipientId,
    messageType,
    priority,
    renderType,
    content: cleanedContent,
    reasoning:
      reasoning.length > 0
        ? reasoning
        : "Autonomous model-authored conversation message for this cycle.",
    requiresResponse:
      Boolean(input.rawMessage.requiresResponse) ||
      (Boolean(recipientId) &&
        /\?|\b(can you|could you|please|need you|want you|check|confirm|verify|revisit|follow up|walk me through|help me understand|what am i missing)\b/i.test(
          cleanedContent
        )),
  };
}

export async function generateAutonomousConversationPlan(input: {
  activeAgentIds: string[];
  addressableAgentIds?: string[];
  context: Record<string, unknown>;
  maxMessages?: number;
}) {
  const uniqueActiveAgentIds = Array.from(
    new Set(input.activeAgentIds.map((agentId) => agentId.trim()).filter(Boolean))
  );
  const uniqueAddressableAgentIds = Array.from(
    new Set(
      (input.addressableAgentIds ?? uniqueActiveAgentIds)
        .map((agentId) => agentId.trim())
        .filter(Boolean)
    )
  );

  if (uniqueActiveAgentIds.length === 0) {
    return [] as AutonomousConversationPlanMessage[];
  }

  const maxMessages = Math.max(
    0,
    Math.min(input.maxMessages ?? 8, uniqueActiveAgentIds.length * 3, 12)
  );

  const rawMessages =
    (await runMessageProviderChain({
      context: "autonomous conversation planning",
      accept: (messages) => messages.length > 0,
      anthropic: () =>
        tryAnthropicAutonomousConversationPlan({
          activeAgentIds: uniqueActiveAgentIds,
          addressableAgentIds: uniqueAddressableAgentIds,
          context: input.context,
          maxMessages,
        }),
      openai: () =>
        tryOpenAiAutonomousConversationPlan({
          activeAgentIds: uniqueActiveAgentIds,
          addressableAgentIds: uniqueAddressableAgentIds,
          context: input.context,
          maxMessages,
        }),
    })) ?? [];

  const activeAgentIds = new Set(uniqueActiveAgentIds);
  const addressableAgentIds = new Set(uniqueAddressableAgentIds);
  const normalizedMessages = (rawMessages ?? [])
    .map((rawMessage) =>
      normalizeAutonomousConversationPlanMessage({
        rawMessage,
        activeAgentIds,
        addressableAgentIds,
      })
    )
    .filter(
      (
        message
      ): message is AutonomousConversationPlanMessage => Boolean(message)
    );

  return normalizedMessages.slice(0, maxMessages);
}

export async function renderAgentVoiceBatch(drafts: AgentMessageVoiceDraft[]) {
  if (drafts.length === 0) {
    return [];
  }

  const renderedById = new Map<string, string>();
  const structuredDrafts = drafts.filter(
    (draft): draft is AgentStructuredMessageVoiceDraft => !isFreeformDraft(draft)
  );
  const freeformDrafts = drafts.filter(isFreeformDraft);

  if (structuredDrafts.length > 0) {
    const rendered = await renderStructuredVoiceBatch(structuredDrafts);
    for (const [index, draft] of structuredDrafts.entries()) {
      renderedById.set(draft.id, rendered[index] ?? "");
    }
  }

  if (freeformDrafts.length > 0) {
    const rendered = await renderFreeformVoiceBatch(freeformDrafts);
    for (const [index, draft] of freeformDrafts.entries()) {
      renderedById.set(draft.id, rendered[index] ?? "");
    }
  }

  return drafts.map((draft) => renderedById.get(draft.id) ?? "");
}
