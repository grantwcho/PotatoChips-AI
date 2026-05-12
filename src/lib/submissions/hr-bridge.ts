import "server-only";

import AdmZip from "adm-zip";
import { createHash } from "node:crypto";
import { access, copyFile, mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { AgentApplication, AgentSubmissionInput } from "@/lib/hr-agent/models/agent-application";
import { createAgentApplication, getHrApplicationById } from "@/lib/hr-agent/repository";
import { recordHrStageEnqueued, runHrPipelineInline } from "@/lib/hr-agent/runtime";
import { shouldPreferInlineHrPipeline } from "@/lib/hr-agent/runtime-config";
import { getHrSubmissionRoot, writeSubmissionManifest } from "@/lib/hr-agent/storage";
import { enqueueHrPipelineStage } from "@/lib/hr-agent/worker-queue";
import { prisma } from "@/lib/prisma";
import { SubmissionStatus } from "@/lib/prisma-client";
import { DOCS_ROOT_RELATIVE_PATH, SOURCE_ROOT_RELATIVE_PATH } from "@/lib/submissions/constants";
import { ensureSubmissionSchema } from "@/lib/submissions/schema";
import { selectLatestSubmissionsBySource } from "@/lib/submissions/service";
import { getStorageAdapter } from "@/lib/submissions/storage/local";

type SignedSubmissionRecord = Awaited<
  ReturnType<typeof getSignedSubmissionRecord>
>;

type PromotedArtifact = {
  contentType: string | null;
  name: string;
  path: string;
  sizeBytes: number | null;
  type: "agent-package" | "documentation";
};

function sanitizeFileName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "artifact";
}

function buildSubmissionTitle(input: {
  agentName: string | null;
  githubRepoFullName: string | null;
  submissionId: string;
}) {
  const explicitName = input.agentName?.trim();

  if (explicitName) {
    return explicitName;
  }

  if (input.githubRepoFullName) {
    const segments = input.githubRepoFullName.split("/").filter(Boolean);
    return segments.at(-1) ?? input.githubRepoFullName;
  }

  return `Submission ${input.submissionId.slice(0, 8)}`;
}

function inferHrApplicationType(value: string | null | undefined): AgentSubmissionInput["type"] {
  const normalized = value?.trim().toLowerCase() ?? "";

  if (normalized.includes("macro")) {
    return "macro";
  }

  if (
    normalized.includes("event") ||
    normalized.includes("earnings") ||
    normalized.includes("merger") ||
    normalized.includes("catalyst")
  ) {
    return "event";
  }

  if (
    normalized.includes("sentiment") ||
    normalized.includes("news") ||
    normalized.includes("social")
  ) {
    return "sentiment";
  }

  if (
    normalized.includes("research") ||
    normalized.includes("analyst") ||
    normalized.includes("fundamental")
  ) {
    return "research";
  }

  return "custom";
}

function inferContentType(filePath: string) {
  const extension = path.extname(filePath).toLowerCase();

  if (extension === ".md" || extension === ".markdown") {
    return "text/markdown";
  }

  if (extension === ".txt") {
    return "text/plain";
  }

  if (extension === ".json") {
    return "application/json";
  }

  if (extension === ".pdf") {
    return "application/pdf";
  }

  if (extension === ".html") {
    return "text/html";
  }

  if (extension === ".zip") {
    return "application/zip";
  }

  return null;
}

async function fileExists(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function hashBuffer(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function getHrApplicationIdForSubmission(submissionId: string) {
  return `HR-SUB-${submissionId}`;
}

async function getSignedSubmissionRecord(submissionId: string) {
  await ensureSubmissionSchema();

  const submission = await prisma.submission.findUnique({
    where: {
      id: submissionId,
    },
    include: {
      attestation: true,
      card: {
        include: {
          dependencies: true,
        },
      },
      user: true,
    },
  });

  return submission?.status === SubmissionStatus.SIGNED ? submission : null;
}

async function listSignedSubmissionIds(input?: {
  submissionId?: string;
  userId?: string;
}) {
  await ensureSubmissionSchema();

  const submissions = await prisma.submission.findMany({
    where: {
      id: input?.submissionId,
      status: SubmissionStatus.SIGNED,
      userId: input?.userId,
    },
    orderBy: {
      updatedAt: "desc",
    },
    select: {
      createdAt: true,
      githubRepoFullName: true,
      id: true,
      source: true,
      updatedAt: true,
      uploadContentHash: true,
    },
  });

  return selectLatestSubmissionsBySource(submissions).map((submission) => submission.id);
}

async function buildSubmissionArchive(input: {
  applicationId: string;
  sourceRoot: string;
  submission: NonNullable<SignedSubmissionRecord>;
}) {
  const archiveNameBase =
    input.submission.githubRepoFullName?.split("/").at(-1) ??
    input.submission.agentName ??
    input.submission.id;
  const archiveName = `${sanitizeFileName(archiveNameBase)}-${input.submission.id.slice(0, 8)}.zip`;
  const archivePath = path.join(
    getHrSubmissionRoot(input.applicationId),
    "agent-package",
    archiveName
  );
  const zip = new AdmZip();

  zip.addLocalFolder(input.sourceRoot, "", (fileName) => {
    const normalized = fileName.split(path.sep).join("/");
    return (
      !normalized.includes("/.git/") &&
      !normalized.endsWith("/.git") &&
      path.basename(normalized) !== ".git"
    );
  });

  await mkdir(path.dirname(archivePath), { recursive: true });
  zip.writeZip(archivePath);

  const archiveBytes = await readFile(archivePath);
  const archiveStat = await stat(archivePath);

  return {
    artifact: {
      contentType: "application/zip",
      name: archiveName,
      path: archivePath,
      sizeBytes: archiveStat.size,
      type: "agent-package" as const,
    },
    manifestArtifact: {
      contentType: "application/zip",
      field: "agentPackage",
      name: archiveName,
      relativePath: path.relative(getHrSubmissionRoot(input.applicationId), archivePath),
      sha256: hashBuffer(archiveBytes),
      sizeBytes: archiveStat.size,
      type: "agent-package" as const,
    },
  };
}

async function resolveDocumentationSourcePath(
  submission: NonNullable<SignedSubmissionRecord>
) {
  const storage = getStorageAdapter();

  if (submission.documentationPath) {
    const explicitPath = storage.resolveSubmissionAbsolutePath(
      submission.id,
      submission.documentationPath
    );

    if (await fileExists(explicitPath)) {
      return explicitPath;
    }
  }

  const candidates = [
    path.join(submission.storagePath, DOCS_ROOT_RELATIVE_PATH, "README.md"),
    path.join(submission.storagePath, SOURCE_ROOT_RELATIVE_PATH, "README.md"),
    path.join(submission.storagePath, SOURCE_ROOT_RELATIVE_PATH, "readme.md"),
    path.join(submission.storagePath, SOURCE_ROOT_RELATIVE_PATH, "README.txt"),
  ];

  for (const candidate of candidates) {
    if (await fileExists(candidate)) {
      return candidate;
    }
  }

  return null;
}

async function persistDocumentationArtifact(input: {
  applicationId: string;
  submission: NonNullable<SignedSubmissionRecord>;
}) {
  const documentationSourcePath = await resolveDocumentationSourcePath(input.submission);

  if (!documentationSourcePath) {
    return null;
  }

  const documentationName = sanitizeFileName(path.basename(documentationSourcePath));
  const targetPath = path.join(
    getHrSubmissionRoot(input.applicationId),
    "documentation",
    documentationName
  );

  await mkdir(path.dirname(targetPath), { recursive: true });
  await copyFile(documentationSourcePath, targetPath);

  const [documentationBytes, documentationStat] = await Promise.all([
    readFile(targetPath),
    stat(targetPath),
  ]);

  return {
    artifact: {
      contentType: inferContentType(documentationName),
      name: documentationName,
      path: targetPath,
      sizeBytes: documentationStat.size,
      type: "documentation" as const,
    },
    manifestArtifact: {
      contentType: inferContentType(documentationName),
      field: "documentation",
      name: documentationName,
      relativePath: path.relative(getHrSubmissionRoot(input.applicationId), targetPath),
      sha256: hashBuffer(documentationBytes),
      sizeBytes: documentationStat.size,
      type: "documentation" as const,
    },
  };
}

function buildRiskParameters(submission: NonNullable<SignedSubmissionRecord>) {
  const parts: string[] = [];

  if (submission.card?.capitalRangeMin != null || submission.card?.capitalRangeMax != null) {
    const min = submission.card.capitalRangeMin != null ? `$${submission.card.capitalRangeMin}` : "?";
    const max = submission.card.capitalRangeMax != null ? `$${submission.card.capitalRangeMax}` : "?";
    parts.push(`capital range ${min} to ${max}`);
  }

  if (submission.card?.decisionCadence?.trim()) {
    parts.push(`decision cadence ${submission.card.decisionCadence.trim()}`);
  }

  if (submission.card?.killSwitchBehavior?.trim()) {
    parts.push(`kill switch ${submission.card.killSwitchBehavior.trim()}`);
  }

  return parts.join("; ");
}

function buildDataSourcesRequired(submission: NonNullable<SignedSubmissionRecord>) {
  const dependencies = submission.card?.dependencies ?? [];

  if (dependencies.length > 0) {
    return dependencies.map((dependency) => dependency.name).join(", ");
  }

  return "";
}

function buildPromotedSubmissionInput(input: {
  documentationArtifact: PromotedArtifact | null;
  packageArtifact: PromotedArtifact;
  submission: NonNullable<SignedSubmissionRecord>;
}): AgentSubmissionInput {
  const agentName = buildSubmissionTitle({
    agentName: input.submission.agentName,
    githubRepoFullName: input.submission.githubRepoFullName,
    submissionId: input.submission.id,
  });
  const submitter =
    input.submission.user.name?.trim() ||
    input.submission.user.githubLogin?.trim() ||
    input.submission.user.email?.trim() ||
    "Developer";
  const submitterKey =
    input.submission.user.githubLogin?.trim() ||
    input.submission.user.email?.trim() ||
    input.submission.user.id;
  const repoReference = input.submission.githubRepoFullName?.trim();
  const commitReference = input.submission.githubCommitSha?.trim();

  return {
    submitter,
    submitterKey,
    agentName,
    type: inferHrApplicationType(input.submission.card?.strategyClassification),
    packageType: "code-archive",
    packageReference:
      repoReference && commitReference
        ? `${repoReference}@${commitReference}`
        : repoReference || input.packageArtifact.name,
    documentationReference:
      input.documentationArtifact?.name ||
      input.submission.documentationPath ||
      "Repository documentation",
    description: input.submission.description,
    claimedEdge: input.submission.card?.claimedEdge ?? "",
    dataSourcesRequired: buildDataSourcesRequired(input.submission),
    documentationProfile: {
      assetClasses: input.submission.card?.assetUniverse ?? "",
      riskParameters: buildRiskParameters(input.submission),
      holdingPeriod: input.submission.card?.timeframe ?? "",
    },
    submittedArtifacts: [
      {
        contentType: input.packageArtifact.contentType,
        name: input.packageArtifact.name,
        sizeBytes: input.packageArtifact.sizeBytes,
        type: input.packageArtifact.type,
      },
      ...(input.documentationArtifact
        ? [
            {
              contentType: input.documentationArtifact.contentType,
              name: input.documentationArtifact.name,
              sizeBytes: input.documentationArtifact.sizeBytes,
              type: input.documentationArtifact.type,
            },
          ]
        : []),
    ],
  };
}

async function materializePromotedArtifacts(
  submission: NonNullable<SignedSubmissionRecord>,
  applicationId: string
) {
  const storage = getStorageAdapter();
  const { sourcePath } = await storage.ensureSubmissionPaths(submission.id);

  if (!(await fileExists(sourcePath))) {
    throw new Error(`Submission source is missing for signed submission ${submission.id}.`);
  }

  const packageArtifact = await buildSubmissionArchive({
    applicationId,
    sourceRoot: sourcePath,
    submission,
  });
  const documentationArtifact = await persistDocumentationArtifact({
    applicationId,
    submission,
  });

  await writeSubmissionManifest(applicationId, {
    artifacts: [
      packageArtifact.manifestArtifact,
      ...(documentationArtifact ? [documentationArtifact.manifestArtifact] : []),
    ],
    capturedAt:
      submission.attestation?.agreedAt.toISOString() ?? submission.updatedAt.toISOString(),
    documentationReference:
      documentationArtifact?.artifact.name ||
      submission.documentationPath ||
      "Repository documentation",
    packageReference:
      submission.githubRepoFullName && submission.githubCommitSha
        ? `${submission.githubRepoFullName}@${submission.githubCommitSha}`
        : packageArtifact.artifact.name,
    packageType: "code-archive",
    sourceSubmissionId: submission.id,
  });

  return {
    documentationArtifact: documentationArtifact?.artifact ?? null,
    packageArtifact: packageArtifact.artifact,
  };
}

function shouldKickOffPipeline(application: AgentApplication) {
  if (application.recentEvents.length === 0) {
    return true;
  }

  return application.recentEvents.every((event) => event.eventType === "SUBMITTED");
}

async function kickOffHrPipeline(applicationId: string, request?: Request) {
  if (shouldPreferInlineHrPipeline()) {
    return runHrPipelineInline(applicationId, "stage1-quarantine");
  }

  const followUp = await enqueueHrPipelineStage(
    request,
    applicationId,
    "stage1-quarantine",
    0
  );

  if (followUp.status === "enqueued" || followUp.status === "duplicate") {
    await recordHrStageEnqueued(applicationId, "stage1-quarantine", {
      delaySeconds: followUp.delaySeconds,
      enqueueStatus: followUp.status,
      scheduleTime: followUp.scheduleTime,
      taskName: followUp.taskName,
    });

    return getHrApplicationById(applicationId);
  }

  return runHrPipelineInline(applicationId, "stage1-quarantine");
}

export async function syncSignedSubmissionToHrApplication(input: {
  request?: Request;
  runPipeline?: boolean;
  submissionId: string;
}) {
  const submission = await getSignedSubmissionRecord(input.submissionId);

  if (!submission) {
    return null;
  }

  const applicationId = getHrApplicationIdForSubmission(submission.id);
  const existing = await getHrApplicationById(applicationId);

  if (existing) {
    if ((input.runPipeline ?? true) && shouldKickOffPipeline(existing)) {
      return (await kickOffHrPipeline(existing.id, input.request)) ?? existing;
    }

    return existing;
  }

  const artifacts = await materializePromotedArtifacts(submission, applicationId);
  const application = await createAgentApplication(
    buildPromotedSubmissionInput({
      documentationArtifact: artifacts.documentationArtifact,
      packageArtifact: artifacts.packageArtifact,
      submission,
    }),
    {
      applicationId,
      skipCooldown: true,
      submittedAt:
        submission.attestation?.agreedAt.toISOString() ?? submission.updatedAt.toISOString(),
    }
  );

  if (input.runPipeline ?? true) {
    return (await kickOffHrPipeline(application.id, input.request)) ?? application;
  }

  return application;
}

export async function syncSignedSubmissionsToHrApplications(input?: {
  request?: Request;
  runPipeline?: boolean;
  submissionId?: string;
  userId?: string;
}) {
  const submissionIds = await listSignedSubmissionIds({
    submissionId: input?.submissionId,
    userId: input?.userId,
  });
  const promotedApplications: AgentApplication[] = [];

  for (const submissionId of submissionIds) {
    try {
      const application = await syncSignedSubmissionToHrApplication({
        request: input?.request,
        runPipeline: input?.runPipeline,
        submissionId,
      });

      if (application) {
        promotedApplications.push(application);
      }
    } catch (error) {
      console.error("Unable to promote signed submission into Recruiting.", {
        error: error instanceof Error ? error.message : error,
        submissionId,
      });
    }
  }

  return promotedApplications;
}
