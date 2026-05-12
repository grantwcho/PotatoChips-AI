import "server-only";

import { createHash } from "node:crypto";
import path from "node:path";
import type {
  Adapter as SubmissionAdapterRecord,
  Attestation as SubmissionAttestationRecord,
  InterpretationCard as SubmissionCardRecord,
  Prisma,
} from "@/lib/prisma-client";
import {
  DependencyType,
  SubmissionProcessingStage,
  SubmissionSource,
  SubmissionStatus,
} from "@/lib/prisma-client";
import { ATTESTATION_TEXT } from "@/lib/attestation";
import { prisma } from "@/lib/prisma";
import {
  PARSED_SUBMISSION_ARTIFACT,
  SIGNED_BUNDLE_ARTIFACT,
  SUBMISSION_SOURCE_LABELS,
  SUBMISSION_STAGE_LABELS,
} from "@/lib/submissions/constants";
import type { StockResearchAgent } from "@/lib/stocks/types";
import { decryptSecretValue } from "@/lib/submissions/crypto";
import {
  cloneGithubRepository,
  getGithubRepositoryViewUrl,
} from "@/lib/submissions/github/client";
import { parseSubmissionSource } from "@/lib/submissions/parser";
import { ensureSubmissionSchema } from "@/lib/submissions/schema";
import { getStorageAdapter } from "@/lib/submissions/storage/local";
import { normalizeBaseModelId } from "@/lib/stocks/model-metadata";
import type {
  AiHrAdapter,
  AiHrCard,
  SubmissionDetail,
  ParsedSubmission,
  SubmissionPublicationStatus,
} from "@/lib/submissions/types";

export class SubmissionHttpError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = "SubmissionHttpError";
  }
}

async function getSubmissionRecord(submissionId: string) {
  await ensureSubmissionSchema();

  return prisma.submission.findUnique({
    where: {
      id: submissionId,
    },
    include: {
      adapter: true,
      attestation: true,
      card: {
        include: {
          dependencies: {
            orderBy: {
              sortOrder: "asc",
            },
          },
        },
      },
      user: true,
    },
  });
}

function assertMutableSubmission(submission: { status: SubmissionStatus }) {
  if (submission.status === SubmissionStatus.SIGNED) {
    throw new SubmissionHttpError(
      "This submission is immutable after signing.",
      409
    );
  }
}

function normalizeRiskEnvelope(value: unknown) {
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value) as Record<string, unknown>;

      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      return {};
    }
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function normalizeEmail(value: string) {
  const normalized = value.trim().toLowerCase();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new SubmissionHttpError("Please enter a valid email address.", 400);
  }

  return normalized;
}

function mapCardRecord(record: SubmissionCardRecord & {
  dependencies: Array<{
    details: unknown;
    name: string;
    type: DependencyType;
  }>;
}) {
  const originalSnapshot =
    typeof record.originalSnapshot === "string"
      ? normalizeRiskEnvelope(record.originalSnapshot)
      : {};

  return {
    aiHrNotes: record.aiHrNotes,
    assetUniverse: record.assetUniverse,
    capitalRangeMax: record.capitalRangeMax,
    capitalRangeMin: record.capitalRangeMin,
    claimedEdge: record.claimedEdge,
    decisionCadence: record.decisionCadence,
    dependencies: record.dependencies.map((dependency) => ({
      details:
        typeof dependency.details === "string"
          ? normalizeRiskEnvelope(dependency.details)
          : {},
      name: dependency.name,
      type: dependency.type,
    })),
    editedByUser: record.editedByUser,
    entryPoint: record.entryPoint,
    executionMode: record.executionMode,
    generatedAt: record.generatedAt.toISOString(),
    id: record.id,
    killSwitchBehavior: record.killSwitchBehavior,
    originalSnapshot,
    riskEnvelope: normalizeRiskEnvelope(record.riskEnvelope),
    strategyClassification: record.strategyClassification,
    timeframe: record.timeframe,
  };
}

function mapAdapterRecord(record: SubmissionAdapterRecord) {
  return {
    code: record.code,
    editedByUser: record.editedByUser,
    generatedAt: record.generatedAt.toISOString(),
    id: record.id,
    language: record.language,
    originalCode: record.originalCode,
    originalRationale: record.originalRationale,
    rationale: record.rationale,
  };
}

function mapAttestationRecord(record: SubmissionAttestationRecord) {
  return {
    agreedAt: record.agreedAt.toISOString(),
    attestationText: record.attestationText,
    id: record.id,
    signerEmail: record.signerEmail,
    signerName: record.signerName,
  };
}

function parseParsedSubmissionSnapshot(value: string | null | undefined) {
  if (!value?.trim()) {
    return null;
  }

  try {
    return JSON.parse(value) as ParsedSubmission;
  } catch (error) {
    console.warn("Stored parsed submission snapshot is not valid JSON.", {
      error: error instanceof Error ? error.message : error,
    });
    return null;
  }
}

const SUBMISSION_PUBLICATION_STATUSES = new Set<SubmissionPublicationStatus>([
  "APPROVED",
  "PENDING",
  "REJECTED",
  "REMOVED",
]);

function normalizePublicationStatus(
  value: string | null | undefined
): SubmissionPublicationStatus {
  return SUBMISSION_PUBLICATION_STATUSES.has(value as SubmissionPublicationStatus)
    ? (value as SubmissionPublicationStatus)
    : "PENDING";
}

function slugifyPublicAgent(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function uniqueValues(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

type SubmissionSourceIdentity = {
  createdAt: Date;
  githubRepoFullName?: string | null;
  id: string;
  source: SubmissionSource;
  updatedAt: Date;
  uploadContentHash?: string | null;
};

export function getSubmissionSourceKey(submission: {
  githubRepoFullName?: string | null;
  id: string;
  source: SubmissionSource;
  uploadContentHash?: string | null;
}) {
  const repoFullName = submission.githubRepoFullName?.trim().toLowerCase();

  if (submission.source === SubmissionSource.GITHUB && repoFullName) {
    return `github:${repoFullName}`;
  }

  const uploadHash = submission.uploadContentHash?.trim().toLowerCase();

  if (submission.source === SubmissionSource.UPLOAD && uploadHash) {
    return `upload:${uploadHash}`;
  }

  return `submission:${submission.id}`;
}

export function selectLatestSubmissionsBySource<T extends SubmissionSourceIdentity>(
  submissions: T[]
) {
  const seen = new Set<string>();

  return [...submissions]
    .sort((left, right) => {
      const updatedDelta = right.updatedAt.getTime() - left.updatedAt.getTime();

      if (updatedDelta !== 0) {
        return updatedDelta;
      }

      const createdDelta = right.createdAt.getTime() - left.createdAt.getTime();

      if (createdDelta !== 0) {
        return createdDelta;
      }

      return right.id.localeCompare(left.id);
    })
    .filter((submission) => {
      const key = getSubmissionSourceKey(submission);

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    });
}

function firstStringValue(
  value: Record<string, unknown> | null | undefined,
  keys: string[]
) {
  if (!value) {
    return null;
  }

  for (const key of keys) {
    const candidate = value[key];

    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  return null;
}

function inferSubmittedAgentName(detail: SubmissionDetail) {
  return (
    detail.agentName?.trim() ||
    detail.parsedSubmission?.manifest?.name?.trim() ||
    detail.githubRepoFullName?.split("/").filter(Boolean).at(-1) ||
    `Submission ${detail.id.slice(0, 8)}`
  );
}

function inferSubmitter(detail: SubmissionDetail): StockResearchAgent["submitter"] {
  const githubLogin = detail.user.githubLogin?.trim();
  const name =
    detail.user.name?.trim() ||
    githubLogin ||
    detail.githubRepoFullName?.split("/").filter(Boolean).at(0) ||
    "Potato Chips AI";

  return {
    affiliation: null,
    name,
    profileUrl: githubLogin ? `https://github.com/${githubLogin}` : null,
  };
}

function inferBaseModel(detail: SubmissionDetail) {
  const manifestRaw = detail.parsedSubmission?.manifest?.raw ?? null;
  const rawModel = firstStringValue(manifestRaw, [
    "base_model",
    "baseModel",
    "llm_model",
    "model",
    "anthropic_model",
    "openai_model",
  ]);

  if (rawModel) {
    return rawModel;
  }

  const dependencyText = detail.card?.dependencies
    .map((dependency) => `${dependency.name} ${JSON.stringify(dependency.details)}`)
    .join("\n");
  const haystack = [
    inferSubmittedAgentName(detail),
    detail.agentName,
    detail.githubRepoFullName,
    detail.description,
    detail.card?.aiHrNotes,
    detail.parsedSubmission?.manifest?.description,
    dependencyText,
    detail.parsedSubmission?.detectedEnvVars.join("\n"),
  ]
    .filter(Boolean)
    .join("\n");
  const normalizedModel = normalizeBaseModelId(rawModel, [haystack]);

  if (normalizedModel) {
    return normalizedModel;
  }

  if (/anthropic|claude/i.test(haystack)) {
    return "Claude";
  }

  if (/openai|gpt/i.test(haystack)) {
    return "OpenAI";
  }

  return undefined;
}

function buildPublicAgentSlug(detail: SubmissionDetail) {
  const base =
    slugifyPublicAgent(inferSubmittedAgentName(detail)) ||
    slugifyPublicAgent(detail.githubRepoFullName ?? "") ||
    "submitted-agent";

  return `${base}-${detail.id.slice(0, 8).toLowerCase()}`;
}

function buildPublicAgentDataSources(detail: SubmissionDetail) {
  const dependencySources = detail.card?.dependencies.map((dependency) => dependency.name) ?? [];
  const urlSources = detail.parsedSubmission?.detectedUrls.slice(0, 4) ?? [];
  const declaredSources =
    detail.card?.assetUniverse && detail.card.assetUniverse !== "Unknown"
      ? [`Asset universe: ${detail.card.assetUniverse}`]
      : [];

  const sources = uniqueValues([
    ...dependencySources,
    ...urlSources,
    ...declaredSources,
    detail.githubRepoFullName ? `Repository: ${detail.githubRepoFullName}` : "",
  ]);

  return sources.length > 0
    ? sources.slice(0, 6)
    : ["Submitted source package and operator-managed runtime credentials."];
}

function buildPublicAgentSnapshot(detail: SubmissionDetail): StockResearchAgent {
  const agentName = inferSubmittedAgentName(detail);
  const slug = buildPublicAgentSlug(detail);
  const strategy = detail.card?.strategyClassification || "Submitted research agent";
  const cadence = detail.card?.decisionCadence || "On demand";
  const focus =
    detail.card?.assetUniverse ||
    detail.parsedSubmission?.manifest?.tags.join(", ") ||
    "AI semiconductors";
  const summary =
    detail.description ||
    detail.card?.claimedEdge ||
    detail.parsedSubmission?.manifest?.description ||
    "Approved submitted agent for the AI semiconductor research roster.";

  return {
    apiRequestCount: 0,
    bountyUsd: 500,
    code: `SUB-${detail.id.slice(0, 8).toUpperCase()}`,
    collaboration: [
      "Reviewed by the Potato Chips AI admin team before publication.",
      "Designed to contribute a distinct research lane to the AI semiconductor roster.",
    ],
    communicationStyle:
      "Concise source-grounded research notes with citations and uncertainty called out where available.",
    dataSources: buildPublicAgentDataSources(detail),
    focus,
    fullPrompt:
      detail.parsedSubmission?.manifest?.description ||
      detail.card?.aiHrNotes ||
      "Approved submitted agent. Full source remains attached to the original submission record.",
    guardrails: [
      detail.card?.killSwitchBehavior || "Operator review remains required before production use.",
      "Runtime secrets are supplied by Potato Chips AI managed credentials, not by the submitting user.",
    ],
    handle: `PC-${slug.toUpperCase()}`,
    llmModel: inferBaseModel(detail),
    name: agentName,
    naturalLanguageFormat:
      "Returns a freeform research response through the submitted agent contract.",
    researchLoop: [
      {
        cadence,
        description:
          detail.card?.claimedEdge ||
          "Responds to admin and platform research prompts using the submitted implementation.",
      },
    ],
    researchType: strategy,
    role: strategy,
    roleDescription:
      detail.card?.aiHrNotes ||
      detail.card?.claimedEdge ||
      "Submitted agent approved for the public AI semiconductor research table.",
    slug,
    status: "live",
    structuredOutputExample: JSON.stringify(
      {
        answer: "Freeform research response from the submitted agent.",
        response_type: "freeform",
        status: "ok",
      },
      null,
      2
    ),
    submittedAt: detail.createdAt,
    submitter: inferSubmitter(detail),
    summary,
    updatedAt: new Date().toISOString(),
  };
}

function parsePublicAgentSnapshot(
  value: string | null | undefined,
  submissionId: string
): StockResearchAgent | null {
  if (!value?.trim()) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as Partial<StockResearchAgent>;

    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      typeof parsed.code !== "string" ||
      typeof parsed.handle !== "string" ||
      typeof parsed.name !== "string" ||
      typeof parsed.role !== "string" ||
      typeof parsed.summary !== "string" ||
      typeof parsed.roleDescription !== "string" ||
      typeof parsed.focus !== "string" ||
      !Array.isArray(parsed.dataSources) ||
      !Array.isArray(parsed.researchLoop) ||
      !Array.isArray(parsed.collaboration) ||
      !Array.isArray(parsed.guardrails) ||
      typeof parsed.structuredOutputExample !== "string" ||
      typeof parsed.naturalLanguageFormat !== "string" ||
      typeof parsed.communicationStyle !== "string" ||
      typeof parsed.fullPrompt !== "string"
    ) {
      console.warn("Stored public agent snapshot is missing required fields.", {
        submissionId,
      });
      return null;
    }

    const agent = parsed as StockResearchAgent;
    const llmModel = normalizeBaseModelId(agent.llmModel, [
      agent.name,
      agent.handle,
      agent.slug,
      agent.summary,
      agent.roleDescription,
      agent.fullPrompt,
      agent.dataSources.join("\n"),
    ]);

    return {
      ...agent,
      llmModel: llmModel ?? agent.llmModel,
      slug: agent.slug ?? slugifyPublicAgent(agent.handle.replace(/^PC-/i, "")),
      status: agent.status === "planned" ? "planned" : "live",
    };
  } catch (error) {
    console.warn("Stored public agent snapshot is not valid JSON.", {
      error: error instanceof Error ? error.message : error,
      submissionId,
    });
    return null;
  }
}

function publicAgentMatchesSlug(agent: StockResearchAgent, normalizedSlug: string) {
  const candidates = [
    agent.slug,
    slugifyPublicAgent(agent.handle.replace(/^PC-/i, "")),
    slugifyPublicAgent(agent.code),
    slugifyPublicAgent(agent.name),
    agent.handle.toLowerCase(),
    agent.code.toLowerCase(),
  ];

  return candidates.some((candidate) => candidate === normalizedSlug);
}

export async function listApprovedPublicAgentSnapshots(): Promise<
  StockResearchAgent[]
> {
  await ensureSubmissionSchema();

  const submissions = await prisma.submission.findMany({
    where: {
      publicationStatus: "APPROVED",
    },
    orderBy: [
      {
        reviewedAt: "desc",
      },
      {
        updatedAt: "desc",
      },
    ],
    select: {
      id: true,
      publicAgentSnapshot: true,
    },
  });

  return submissions
    .map((submission) =>
      parsePublicAgentSnapshot(submission.publicAgentSnapshot, submission.id)
    )
    .filter((agent): agent is StockResearchAgent => Boolean(agent));
}

export async function getApprovedPublicAgentSnapshotBySlug(
  slug: string
): Promise<StockResearchAgent | null> {
  await ensureSubmissionSchema();

  const normalizedSlug = slug.trim().toLowerCase();

  if (!normalizedSlug) {
    return null;
  }

  const submission = await prisma.submission.findFirst({
    where: {
      publicAgentSlug: normalizedSlug,
      publicationStatus: "APPROVED",
    },
    orderBy: [
      {
        reviewedAt: "desc",
      },
      {
        updatedAt: "desc",
      },
    ],
    select: {
      id: true,
      publicAgentSnapshot: true,
    },
  });

  const directMatch = submission
    ? parsePublicAgentSnapshot(submission.publicAgentSnapshot, submission.id)
    : null;

  if (directMatch) {
    return directMatch;
  }

  const approvedAgents = await listApprovedPublicAgentSnapshots();

  return (
    approvedAgents.find((agent) => publicAgentMatchesSlug(agent, normalizedSlug)) ??
    null
  );
}

async function cacheParsedSubmissionSnapshot(input: {
  parsedSubmission: ParsedSubmission;
  submissionId: string;
}) {
  await prisma.submission.update({
    where: {
      id: input.submissionId,
    },
    data: {
      parsedSubmissionSnapshot: JSON.stringify(input.parsedSubmission),
    },
  });
}

export async function persistParsedSubmissionArtifact(input: {
  parsedSubmission: ParsedSubmission;
  submissionId: string;
}) {
  await ensureSubmissionSchema();

  const storage = getStorageAdapter();
  const storageWrite = storage
    .writeJson(
      input.submissionId,
      PARSED_SUBMISSION_ARTIFACT,
      input.parsedSubmission
    )
    .catch((error) => {
      console.warn("Unable to write parsed submission filesystem cache.", {
        error: error instanceof Error ? error.message : error,
        submissionId: input.submissionId,
      });
    });

  await cacheParsedSubmissionSnapshot(input);
  await storageWrite;
}

async function readParsedSubmissionForRecord(submission: {
  githubBranch?: string | null;
  githubCommitSha?: string | null;
  githubRepoFullName?: string | null;
  id: string;
  parsedSubmissionSnapshot?: string | null;
  source?: SubmissionSource;
  user?: {
    accessToken?: string | null;
  } | null;
}) {
  const storage = getStorageAdapter();
  const cachedArtifact = await storage.readJson<ParsedSubmission>(
    submission.id,
    PARSED_SUBMISSION_ARTIFACT
  );

  if (cachedArtifact) {
    if (!submission.parsedSubmissionSnapshot) {
      await cacheParsedSubmissionSnapshot({
        parsedSubmission: cachedArtifact,
        submissionId: submission.id,
      }).catch((error) => {
        console.warn("Unable to backfill parsed submission DB snapshot.", {
          error: error instanceof Error ? error.message : error,
          submissionId: submission.id,
        });
      });
    }

    return cachedArtifact;
  }

  const durableSnapshot = parseParsedSubmissionSnapshot(
    submission.parsedSubmissionSnapshot
  );

  if (durableSnapshot) {
    await storage
      .writeJson(submission.id, PARSED_SUBMISSION_ARTIFACT, durableSnapshot)
      .catch((error) => {
        console.warn("Unable to restore parsed submission filesystem cache.", {
          error: error instanceof Error ? error.message : error,
          submissionId: submission.id,
        });
      });

    return durableSnapshot;
  }

  if (
    submission.source !== SubmissionSource.GITHUB ||
    !submission.githubRepoFullName ||
    !submission.githubBranch ||
    !submission.githubCommitSha
  ) {
    return null;
  }

  let accessToken: string | null = null;

  try {
    accessToken = decryptSecretValue(submission.user?.accessToken);
  } catch (error) {
    console.warn("Unable to decrypt GitHub token for parsed submission rehydrate.", {
      error: error instanceof Error ? error.message : error,
      submissionId: submission.id,
    });
    return null;
  }

  if (!accessToken) {
    return null;
  }

  try {
    const result = await cloneGithubRepository({
      accessToken,
      branch: submission.githubBranch,
      commitSha: submission.githubCommitSha,
      repoFullName: submission.githubRepoFullName,
      submissionId: submission.id,
    });
    const parsedSubmission = await parseSubmissionSource(result.sourcePath);

    await persistParsedSubmissionArtifact({
      parsedSubmission,
      submissionId: submission.id,
    });

    return parsedSubmission;
  } catch (error) {
    console.warn("Unable to rehydrate parsed submission from GitHub.", {
      error: error instanceof Error ? error.message : error,
      submissionId: submission.id,
    });
    return null;
  }
}

export async function createAnonymousSubmissionUser() {
  await ensureSubmissionSchema();

  return prisma.user.create({
    data: {},
  });
}

export async function createSubmissionRecord(input: {
  agentName?: string | null;
  description: string;
  documentationPath?: string | null;
  githubBranch?: string | null;
  githubCommitSha?: string | null;
  githubRepoFullName?: string | null;
  id?: string;
  linkedinProfileUrl?: string | null;
  processingStage?: SubmissionProcessingStage | null;
  source: SubmissionSource;
  storagePath: string;
  uploadContentHash?: string | null;
  userId: string;
}) {
  await ensureSubmissionSchema();

  return prisma.submission.create({
    data: {
      agentName: input.agentName ?? null,
      description: input.description.trim(),
      documentationPath: input.documentationPath ?? null,
      githubBranch: input.githubBranch ?? null,
      githubCommitSha: input.githubCommitSha ?? null,
      githubRepoFullName: input.githubRepoFullName ?? null,
      id: input.id,
      linkedinProfileUrl: input.linkedinProfileUrl ?? null,
      processingStage: input.processingStage ?? SubmissionProcessingStage.SOURCE_ACQUISITION,
      source: input.source,
      status: SubmissionStatus.PROCESSING,
      storagePath: input.storagePath,
      uploadContentHash: input.uploadContentHash ?? null,
      userId: input.userId,
    },
  });
}

export async function getSubmissionUpdatePrefill(submissionId: string) {
  await ensureSubmissionSchema();

  const submission = await prisma.submission.findUnique({
    where: {
      id: submissionId,
    },
    select: {
      agentName: true,
      description: true,
      githubBranch: true,
      githubCommitSha: true,
      githubRepoFullName: true,
      id: true,
      linkedinProfileUrl: true,
      status: true,
      user: {
        select: {
          githubLogin: true,
          id: true,
          name: true,
        },
      },
    },
  });

  if (!submission) {
    return null;
  }

  return {
    agentName: submission.agentName,
    description: submission.description,
    githubBranch: submission.githubBranch,
    githubCommitSha: submission.githubCommitSha,
    githubRepoFullName: submission.githubRepoFullName,
    id: submission.id,
    linkedinProfileUrl: submission.linkedinProfileUrl,
    status: submission.status,
    user: submission.user,
  };
}

export async function getSubmissionDetail(submissionId: string): Promise<SubmissionDetail | null> {
  const submission = await getSubmissionRecord(submissionId);

  if (!submission) {
    return null;
  }

  const parsedSubmission = await readParsedSubmissionForRecord(submission);

  return {
    adapter: submission.adapter ? mapAdapterRecord(submission.adapter) : null,
    agentName: submission.agentName,
    attestation: submission.attestation
      ? mapAttestationRecord(submission.attestation)
      : null,
    card: submission.card ? mapCardRecord(submission.card) : null,
    createdAt: submission.createdAt.toISOString(),
    description: submission.description,
    documentationPath: submission.documentationPath,
    githubBranch: submission.githubBranch,
    githubCommitSha: submission.githubCommitSha,
    githubRepoFullName: submission.githubRepoFullName,
    id: submission.id,
    linkedinProfileUrl: submission.linkedinProfileUrl,
    parsedSubmission,
    publicationStatus: normalizePublicationStatus(submission.publicationStatus),
    processingError: submission.processingError,
    processingStage: submission.processingStage,
    processingStageLabel: submission.processingStage
      ? SUBMISSION_STAGE_LABELS[submission.processingStage]
      : null,
    processingStageMessage: submission.processingStageMessage,
    source: submission.source,
    sourceLabel: SUBMISSION_SOURCE_LABELS[submission.source],
    sourceViewUrl: submission.githubRepoFullName
      ? getGithubRepositoryViewUrl(
          submission.githubRepoFullName,
          submission.githubCommitSha
        )
      : null,
    status: submission.status,
    publicAgentSlug: submission.publicAgentSlug,
    reviewedAt: submission.reviewedAt?.toISOString() ?? null,
    storagePath: submission.storagePath,
    updatedAt: submission.updatedAt.toISOString(),
    uploadContentHash: submission.uploadContentHash,
    user: {
      email: submission.user.email,
      githubLogin: submission.user.githubLogin,
      id: submission.user.id,
      name: submission.user.name,
    },
  };
}

export async function requireSubmission(submissionId: string) {
  const submission = await getSubmissionRecord(submissionId);

  if (!submission) {
    throw new SubmissionHttpError("Submission not found.", 404);
  }

  return submission;
}

export async function updateSubmissionStage(input: {
  submissionId: string;
  message?: string | null;
  stage?: SubmissionProcessingStage | null;
}) {
  await ensureSubmissionSchema();

  return prisma.submission.update({
    where: {
      id: input.submissionId,
    },
    data: {
      processingError: null,
      processingStage: input.stage ?? null,
      processingStageMessage: input.message ?? null,
      status: SubmissionStatus.PROCESSING,
    },
  });
}

export async function failSubmission(input: {
  message: string;
  submissionId: string;
}) {
  await ensureSubmissionSchema();

  return prisma.submission.update({
    where: {
      id: input.submissionId,
    },
    data: {
      processingError: input.message,
      processingStageMessage: input.message,
      status: SubmissionStatus.FAILED,
    },
  });
}

export async function persistSubmissionInterpretation(input: {
  adapter: AiHrAdapter;
  card: AiHrCard;
  submissionId: string;
}) {
  const submission = await requireSubmission(input.submissionId);
  assertMutableSubmission(submission);

  const dependencyRows = input.card.dependencies.map((dependency, index) => ({
    details: JSON.stringify(dependency.details),
    name: dependency.name,
    sortOrder: index,
    type: dependency.type,
  }));

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.dependency.deleteMany({
      where: {
        cardId: submission.card?.id ?? "__missing__",
      },
    });

    await tx.interpretationCard.upsert({
      where: {
        submissionId: input.submissionId,
      },
      create: {
        aiHrNotes: input.card.aiHrNotes,
        assetUniverse: input.card.assetUniverse,
        capitalRangeMax: input.card.capitalRangeMax,
        capitalRangeMin: input.card.capitalRangeMin,
        claimedEdge: input.card.claimedEdge,
        decisionCadence: input.card.decisionCadence,
        editedByUser: false,
        entryPoint: input.card.entryPoint,
        executionMode: input.card.executionMode,
        killSwitchBehavior: input.card.killSwitchBehavior,
        originalSnapshot: JSON.stringify(input.card),
        riskEnvelope: JSON.stringify(input.card.riskEnvelope),
        strategyClassification: input.card.strategyClassification,
        submissionId: input.submissionId,
        timeframe: input.card.timeframe,
        dependencies: {
          create: dependencyRows,
        },
      },
      update: {
        aiHrNotes: input.card.aiHrNotes,
        assetUniverse: input.card.assetUniverse,
        capitalRangeMax: input.card.capitalRangeMax,
        capitalRangeMin: input.card.capitalRangeMin,
        claimedEdge: input.card.claimedEdge,
        decisionCadence: input.card.decisionCadence,
        editedByUser: false,
        entryPoint: input.card.entryPoint,
        executionMode: input.card.executionMode,
        killSwitchBehavior: input.card.killSwitchBehavior,
        originalSnapshot: JSON.stringify(input.card),
        riskEnvelope: JSON.stringify(input.card.riskEnvelope),
        strategyClassification: input.card.strategyClassification,
        timeframe: input.card.timeframe,
        dependencies: {
          create: dependencyRows,
        },
      },
    });

    await tx.adapter.upsert({
      where: {
        submissionId: input.submissionId,
      },
      create: {
        code: input.adapter.code,
        editedByUser: false,
        language: input.adapter.language,
        originalCode: input.adapter.code,
        originalRationale: input.adapter.rationale,
        rationale: input.adapter.rationale,
        submissionId: input.submissionId,
      },
      update: {
        code: input.adapter.code,
        editedByUser: false,
        language: input.adapter.language,
        originalCode: input.adapter.code,
        originalRationale: input.adapter.rationale,
        rationale: input.adapter.rationale,
      },
    });

    await tx.submission.update({
      where: {
        id: input.submissionId,
      },
      data: {
        processingError: null,
        processingStage: null,
        processingStageMessage: null,
        status: SubmissionStatus.READY_FOR_REVIEW,
      },
    });
  });
}

export async function updateSubmissionCardByUser(input: {
  card: Omit<AiHrCard, "aiHrNotes"> & { aiHrNotes?: string };
  submissionId: string;
}) {
  const submission = await requireSubmission(input.submissionId);
  assertMutableSubmission(submission);

  if (!submission.card) {
    throw new SubmissionHttpError("Submission card not found.", 404);
  }

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.dependency.deleteMany({
      where: {
        cardId: submission.card!.id,
      },
    });

    await tx.interpretationCard.update({
      where: {
        submissionId: input.submissionId,
      },
      data: {
        assetUniverse: input.card.assetUniverse,
        capitalRangeMax: input.card.capitalRangeMax,
        capitalRangeMin: input.card.capitalRangeMin,
        claimedEdge: input.card.claimedEdge,
        decisionCadence: input.card.decisionCadence,
        editedByUser: true,
        entryPoint: input.card.entryPoint,
        executionMode: input.card.executionMode,
        killSwitchBehavior: input.card.killSwitchBehavior,
        riskEnvelope: JSON.stringify(input.card.riskEnvelope),
        strategyClassification: input.card.strategyClassification,
        timeframe: input.card.timeframe,
        dependencies: {
          create: input.card.dependencies.map((dependency, index) => ({
            details: JSON.stringify(dependency.details),
            name: dependency.name,
            sortOrder: index,
            type: dependency.type,
          })),
        },
      },
    });
  });
}

export async function updateSubmissionAdapterByUser(input: {
  code: string;
  submissionId: string;
}) {
  const submission = await requireSubmission(input.submissionId);
  assertMutableSubmission(submission);

  if (!submission.adapter) {
    throw new SubmissionHttpError("Submission adapter not found.", 404);
  }

  return prisma.adapter.update({
    where: {
      submissionId: input.submissionId,
    },
    data: {
      code: input.code,
      editedByUser: true,
    },
  });
}

export async function signSubmission(input: {
  ipAddress?: string | null;
  signerEmail: string;
  signerName: string;
  submissionId: string;
  userAgent?: string | null;
}) {
  const submission = await requireSubmission(input.submissionId);
  assertMutableSubmission(submission);

  if (submission.status !== SubmissionStatus.READY_FOR_REVIEW) {
    throw new SubmissionHttpError(
      "This submission is not ready to be signed yet.",
      409
    );
  }

  const signerName = input.signerName.trim();

  if (!signerName) {
    throw new SubmissionHttpError("Signature name is required.", 400);
  }

  const signerEmail = normalizeEmail(input.signerEmail);

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.user.update({
      where: {
        id: submission.userId,
      },
      data: {
        email: signerEmail,
        name: signerName,
      },
    });

    await tx.attestation.create({
      data: {
        attestationText: ATTESTATION_TEXT,
        ipAddress: input.ipAddress ?? null,
        signerEmail,
        signerName,
        submissionId: input.submissionId,
        userAgent: input.userAgent ?? null,
      },
    });

    await tx.submission.update({
      where: {
        id: input.submissionId,
      },
      data: {
        status: SubmissionStatus.SIGNED,
      },
    });
  });

  const bundle = await buildSignedBundle(input.submissionId);
  const storage = getStorageAdapter();
  await storage.writeJson(input.submissionId, SIGNED_BUNDLE_ARTIFACT, bundle);

  return bundle;
}

export async function acceptSubmissionDirectly(input: {
  ipAddress?: string | null;
  signerEmail: string;
  signerName: string;
  submissionId: string;
  userAgent?: string | null;
}) {
  const submission = await requireSubmission(input.submissionId);
  assertMutableSubmission(submission);

  const signerName = input.signerName.trim();

  if (!signerName) {
    throw new SubmissionHttpError("Submitter name is required.", 400);
  }

  const signerEmail = normalizeEmail(input.signerEmail);

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.user.update({
      where: {
        id: submission.userId,
      },
      data: {
        email: signerEmail,
        name: signerName,
      },
    });

    await tx.attestation.upsert({
      where: {
        submissionId: input.submissionId,
      },
      create: {
        attestationText: ATTESTATION_TEXT,
        ipAddress: input.ipAddress ?? null,
        signerEmail,
        signerName,
        submissionId: input.submissionId,
        userAgent: input.userAgent ?? null,
      },
      update: {
        attestationText: ATTESTATION_TEXT,
        ipAddress: input.ipAddress ?? null,
        signerEmail,
        signerName,
        userAgent: input.userAgent ?? null,
      },
    });

    await tx.submission.update({
      where: {
        id: input.submissionId,
      },
      data: {
        processingError: null,
        processingStage: null,
        processingStageMessage: null,
        status: SubmissionStatus.SIGNED,
      },
    });
  });

  const bundle = await buildSignedBundle(input.submissionId);
  const storage = getStorageAdapter();
  await storage.writeJson(input.submissionId, SIGNED_BUNDLE_ARTIFACT, bundle);

  return bundle;
}

export async function approveSubmissionForPublication(submissionId: string) {
  const detail = await getSubmissionDetail(submissionId);

  if (!detail) {
    throw new SubmissionHttpError("Submission not found.", 404);
  }

  const publicAgent = buildPublicAgentSnapshot(detail);

  await prisma.submission.update({
    where: {
      id: submissionId,
    },
    data: {
      publicAgentSlug: publicAgent.slug,
      publicAgentSnapshot: JSON.stringify(publicAgent),
      publicationStatus: "APPROVED",
      reviewedAt: new Date(),
    },
  });

  return getSubmissionDetail(submissionId);
}

export async function rejectSubmissionForPublication(submissionId: string) {
  await requireSubmission(submissionId);

  await prisma.submission.update({
    where: {
      id: submissionId,
    },
    data: {
      publicAgentSlug: null,
      publicAgentSnapshot: null,
      publicationStatus: "REJECTED",
      reviewedAt: new Date(),
    },
  });

  return getSubmissionDetail(submissionId);
}

export async function removeSubmissionFromPublication(submissionId: string) {
  await requireSubmission(submissionId);

  await prisma.submission.update({
    where: {
      id: submissionId,
    },
    data: {
      publicAgentSlug: null,
      publicAgentSnapshot: null,
      publicationStatus: "REMOVED",
      reviewedAt: new Date(),
    },
  });

  return getSubmissionDetail(submissionId);
}

export async function buildSignedBundle(submissionId: string) {
  const detail = await getSubmissionDetail(submissionId);

  if (!detail) {
    throw new SubmissionHttpError("Submission not found.", 404);
  }

  if (!detail.attestation) {
    throw new SubmissionHttpError("Submission has not been signed yet.", 409);
  }

  return {
    adapter: detail.adapter,
    attestation: detail.attestation,
    card: detail.card,
    parsedSubmission: detail.parsedSubmission,
    submission: {
      agentName: detail.agentName,
      createdAt: detail.createdAt,
      description: detail.description,
      documentationPath: detail.documentationPath,
      githubBranch: detail.githubBranch,
      githubCommitSha: detail.githubCommitSha,
      githubRepoFullName: detail.githubRepoFullName,
      id: detail.id,
      source: detail.source,
      status: detail.status,
      uploadContentHash: detail.uploadContentHash,
      user: detail.user,
    },
  };
}

export async function getSignedBundle(submissionId: string) {
  const storage = getStorageAdapter();
  const existingBundle = await storage.readJson<Record<string, unknown>>(
    submissionId,
    SIGNED_BUNDLE_ARTIFACT
  );

  if (existingBundle) {
    return existingBundle;
  }

  return buildSignedBundle(submissionId);
}

export async function getSubmissionBundleFileName(submissionId: string) {
  const submission = await requireSubmission(submissionId);
  const baseName =
    submission.agentName?.trim().replace(/[^a-zA-Z0-9._-]+/g, "-") ||
    submission.id;
  return `${baseName}-submission-bundle.json`;
}

export function getUploadContentHash(input: Array<{ bytes: Buffer; relativePath: string }>) {
  const hash = createHash("sha256");

  for (const file of [...input].sort((a, b) => a.relativePath.localeCompare(b.relativePath))) {
    hash.update(`${file.relativePath}\n`);
    hash.update(file.bytes);
    hash.update("\n");
  }

  return hash.digest("hex");
}

export function inferDocumentationStoragePath(fileName: string) {
  return path.posix.join("documentation", fileName);
}
