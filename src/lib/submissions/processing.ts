import "server-only";

import PQueue from "p-queue";
import { prisma } from "@/lib/prisma";
import { SubmissionProcessingStage, SubmissionSource } from "@/lib/prisma-client";
import {
  AI_RESPONSE_ARTIFACT,
  SUBMISSION_GATE_ARTIFACT,
} from "@/lib/submissions/constants";
import { decryptSecretValue } from "@/lib/submissions/crypto";
import { runSubmissionGate } from "@/lib/submissions/gate";
import {
  buildFallbackAiHrResponse,
  interpretSubmissionWithAiHr,
} from "@/lib/submissions/ai/hr";
import { cloneGithubRepository } from "@/lib/submissions/github/client";
import { parseSubmissionSource } from "@/lib/submissions/parser";
import {
  failSubmission,
  persistParsedSubmissionArtifact,
  persistSubmissionInterpretation,
  requireSubmission,
  updateSubmissionStage,
} from "@/lib/submissions/service";
import { ensureSubmissionSchema } from "@/lib/submissions/schema";
import {
  persistSubmissionSourceArchive,
  restoreSubmissionSourceArchive,
} from "@/lib/submissions/source-archive";
import { getStorageAdapter } from "@/lib/submissions/storage/local";
import type { ParsedSubmission } from "@/lib/submissions/types";

const processingQueue = new PQueue({
  concurrency: 1,
});
const queuedSubmissionIds = new Set<string>();

async function ensureSubmissionSource(submissionId: string) {
  await ensureSubmissionSchema();

  const submission = await prisma.submission.findUnique({
    where: {
      id: submissionId,
    },
    include: {
      user: true,
    },
  });

  if (!submission) {
    throw new Error("Submission not found.");
  }

  const storage = getStorageAdapter();
  const paths = await storage.ensureSubmissionPaths(submissionId);

  if (submission.source === SubmissionSource.UPLOAD) {
    const restoredSourcePath = await restoreSubmissionSourceArchive(submissionId);

    if (restoredSourcePath) {
      return restoredSourcePath;
    }

    await updateSubmissionStage({
      message: "Uploaded files are ready for review.",
      stage: SubmissionProcessingStage.SOURCE_ACQUISITION,
      submissionId,
    });

    await persistSubmissionSourceArchive({
      sourcePath: paths.sourcePath,
      submissionId,
    });

    return paths.sourcePath;
  }

  const accessToken = decryptSecretValue(submission.user.accessToken);

  if (!accessToken) {
    throw new Error("GitHub access token is missing for this submission.");
  }

  if (!submission.githubRepoFullName || !submission.githubBranch || !submission.githubCommitSha) {
    throw new Error("GitHub submission metadata is incomplete.");
  }

  await updateSubmissionStage({
    message: `Cloning ${submission.githubRepoFullName} at ${submission.githubCommitSha.slice(0, 7)}.`,
    stage: SubmissionProcessingStage.SOURCE_ACQUISITION,
    submissionId,
  });

  const result = await cloneGithubRepository({
    accessToken,
    branch: submission.githubBranch,
    commitSha: submission.githubCommitSha,
    repoFullName: submission.githubRepoFullName,
    submissionId,
  });

  return result.sourcePath;
}

async function processSubmission(submissionId: string) {
  const submission = await requireSubmission(submissionId);
  const storage = getStorageAdapter();
  let parsedSubmission: ParsedSubmission | null = null;

  try {
    const sourcePath = await ensureSubmissionSource(submissionId);

    await updateSubmissionStage({
      message: "Running sandbox, timeout, and schema checks.",
      stage: SubmissionProcessingStage.PARSING_FILES,
      submissionId,
    });
    const gateReport = await runSubmissionGate(sourcePath);
    await storage.writeJson(submissionId, SUBMISSION_GATE_ARTIFACT, gateReport);

    if (!gateReport.passed) {
      await failSubmission({
        message: gateReport.message,
        submissionId,
      });
      return;
    }

    await updateSubmissionStage({
      message: "Scanning code, docs, configs, and prompts.",
      stage: SubmissionProcessingStage.PARSING_FILES,
      submissionId,
    });
    parsedSubmission = await parseSubmissionSource(sourcePath);
    await persistParsedSubmissionArtifact({
      parsedSubmission,
      submissionId,
    });

    await updateSubmissionStage({
      message: "Hang tight while we review your submission.",
      stage: SubmissionProcessingStage.GENERATING_INTERPRETATION,
      submissionId,
    });
    const aiResponse = await interpretSubmissionWithAiHr({
      agentName: submission.agentName,
      description: submission.description,
      parsedSubmission,
    });

    await updateSubmissionStage({
      message: "We’re drafting the sandbox adapter.",
      stage: SubmissionProcessingStage.GENERATING_ADAPTER,
      submissionId,
    });
    await storage.writeJson(submissionId, AI_RESPONSE_ARTIFACT, aiResponse);

    await persistSubmissionInterpretation({
      adapter: aiResponse.adapter,
      card: aiResponse.card,
      submissionId,
    });
  } catch (error) {
    try {
      await updateSubmissionStage({
        message: "We hit a review issue, so we’re generating a fallback decision packet.",
        stage: SubmissionProcessingStage.GENERATING_ADAPTER,
        submissionId,
      });

      const fallbackResponse = buildFallbackAiHrResponse({
        agentName: submission.agentName,
        description: submission.description,
        failure: error,
        parsedSubmission,
      });

      await storage.writeJson(submissionId, AI_RESPONSE_ARTIFACT, fallbackResponse);

      await persistSubmissionInterpretation({
        adapter: fallbackResponse.adapter,
        card: fallbackResponse.card,
        submissionId,
      });
    } catch (fallbackError) {
      await failSubmission({
        message:
          fallbackError instanceof Error
            ? fallbackError.message
            : error instanceof Error
              ? error.message
              : "Submission processing failed unexpectedly.",
        submissionId,
      });
    }
  }
}

export function isSubmissionProcessingActive(submissionId: string) {
  return queuedSubmissionIds.has(submissionId);
}

export function enqueueSubmissionProcessing(submissionId: string) {
  if (queuedSubmissionIds.has(submissionId)) {
    return Promise.resolve();
  }

  queuedSubmissionIds.add(submissionId);

  return processingQueue.add(async () => {
    try {
      await processSubmission(submissionId);
    } finally {
      queuedSubmissionIds.delete(submissionId);
    }
  });
}
