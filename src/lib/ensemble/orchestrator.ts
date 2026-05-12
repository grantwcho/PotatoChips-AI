import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { SubmissionSource, SubmissionStatus } from "@/lib/prisma-client";
import {
  buildDirectRunChatContent,
  runSubmittedAgentDirectly,
} from "@/lib/submissions/direct-run";
import { getSubmittedAgentLlmGatewayBaseUrl } from "@/lib/submissions/llm-gateway";
import { ensureSubmissionSchema } from "@/lib/submissions/schema";
import type {
  EnsembleAgentRunView,
  EnsembleAgentSummary,
  EnsembleDashboardData,
  EnsembleRunResponse,
} from "@/lib/ensemble/types";

type AcceptedSubmissionRecord = Awaited<
  ReturnType<typeof listAcceptedSubmissionRecords>
>[number];

type NonStreamingMessage = Awaited<ReturnType<Anthropic["messages"]["create"]>> & {
  content: Array<{ text?: string; type: string }>;
};

const DEFAULT_ORCHESTRATOR_MODEL = "claude-opus-4-7";
const MAX_AGENT_OUTPUT_CHARS = 6_000;
const MAX_PROMPT_CHARS = 4_000;

function truncate(value: string, maxLength: number) {
  const trimmed = value.trim();

  if (trimmed.length <= maxLength) {
    return trimmed;
  }

  return `${trimmed.slice(0, maxLength - 1).trimEnd()}...`;
}

export function getEnsembleOrchestratorModel() {
  return process.env.ENSEMBLE_ORCHESTRATOR_MODEL?.trim() || DEFAULT_ORCHESTRATOR_MODEL;
}

function getAnthropicClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();

  if (!apiKey) {
    throw new Error("Missing ANTHROPIC_API_KEY.");
  }

  return new Anthropic({ apiKey });
}

async function listAcceptedSubmissionRecords() {
  await ensureSubmissionSchema();

  return prisma.submission.findMany({
    where: {
      publicationStatus: "APPROVED",
      status: SubmissionStatus.SIGNED,
    },
    include: {
      attestation: true,
      card: true,
      user: true,
    },
    orderBy: [
      {
        reviewedAt: "desc",
      },
      {
        updatedAt: "desc",
      },
    ],
  });
}

function buildPackageReference(submission: AcceptedSubmissionRecord) {
  const repoReference = submission.githubRepoFullName?.trim();
  const commitReference = submission.githubCommitSha?.trim();

  if (submission.source === SubmissionSource.GITHUB && repoReference) {
    return commitReference ? `${repoReference}@${commitReference.slice(0, 7)}` : repoReference;
  }

  const uploadHash = submission.uploadContentHash?.trim();

  if (submission.source === SubmissionSource.UPLOAD && uploadHash) {
    return `upload:${uploadHash.slice(0, 12)}`;
  }

  return `submission:${submission.id.slice(0, 8)}`;
}

function mapAcceptedAgentSummary(
  submission: AcceptedSubmissionRecord
): EnsembleAgentSummary {
  return {
    agentName:
      submission.agentName?.trim() ||
      submission.card?.strategyClassification.trim() ||
      submission.githubRepoFullName?.split("/").filter(Boolean).at(-1) ||
      `Submission ${submission.id.slice(0, 8)}`,
    id: submission.id,
    packageReference: buildPackageReference(submission),
    publicAgentSlug: submission.publicAgentSlug,
    submittedAt:
      submission.attestation?.agreedAt.toISOString() ??
      submission.createdAt.toISOString(),
    submitter:
      submission.user.name?.trim() ||
      submission.user.githubLogin?.trim() ||
      submission.user.email?.trim() ||
      "Submission contributor",
  };
}

export async function getEnsembleDashboardData(): Promise<EnsembleDashboardData> {
  const submissions = await listAcceptedSubmissionRecords();

  return {
    acceptedAgents: submissions.map(mapAcceptedAgentSummary),
    orchestratorModel: getEnsembleOrchestratorModel(),
  };
}

function extractTextContent(response: NonStreamingMessage) {
  return response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("\n")
    .trim();
}

async function runAcceptedAgent(input: {
  llmGatewayBaseUrl: string;
  prompt: string;
  submission: AcceptedSubmissionRecord;
}): Promise<EnsembleAgentRunView> {
  const startedAt = Date.now();
  const summary = mapAcceptedAgentSummary(input.submission);

  try {
    const result = await runSubmittedAgentDirectly({
      context: {
        ensemble: true,
        orchestrator: getEnsembleOrchestratorModel(),
        publicAgentSlug: summary.publicAgentSlug,
      },
      injectManagedCredentials: true,
      llmGatewayBaseUrl: input.llmGatewayBaseUrl,
      prompt: input.prompt,
      submissionId: input.submission.id,
    });
    const output = buildDirectRunChatContent(result);

    return {
      ...summary,
      durationMs: Date.now() - startedAt,
      error: result.execution.exitCode === 0 ? null : output,
      outputPreview: truncate(output, MAX_AGENT_OUTPUT_CHARS),
      status: result.execution.exitCode === 0 ? "ok" : "error",
    };
  } catch (error) {
    return {
      ...summary,
      durationMs: Date.now() - startedAt,
      error:
        error instanceof Error
          ? error.message
          : "This accepted agent failed before returning an answer.",
      outputPreview: "",
      status: "error",
    };
  }
}

function buildSynthesisSystemPrompt(agentCount: number) {
  return `You are the Potato Chips AI ensemble orchestrator, powered by Claude Opus 4.7. You synthesize responses from accepted contributor agents into one coherent operator-facing answer.

The user expects one clear answer, not a transcript. Use the accepted agents as parallel expert signals:
- preserve concrete useful insights and disagreements
- call out uncertainty when agents fail, conflict, or omit important evidence
- do not invent agent outputs
- do not mention implementation details unless they affect the answer
- keep the final response polished, useful, and directly responsive to the user's prompt

You received ${agentCount} accepted agent response packet${agentCount === 1 ? "" : "s"}.`;
}

function buildSynthesisUserPrompt(input: {
  agentRuns: EnsembleAgentRunView[];
  prompt: string;
}) {
  const agentPackets = input.agentRuns
    .map((run, index) => {
      const body =
        run.status === "ok"
          ? run.outputPreview || "(agent returned an empty response)"
          : `ERROR: ${run.error || "agent failed without details"}`;

      return [
        `## Agent ${index + 1}: ${run.agentName}`,
        `Submitter: ${run.submitter}`,
        `Package: ${run.packageReference}`,
        `Status: ${run.status}`,
        `Duration: ${run.durationMs}ms`,
        "",
        body,
      ].join("\n");
    })
    .join("\n\n---\n\n");

  return `# User prompt
${truncate(input.prompt, MAX_PROMPT_CHARS)}

# Accepted agent responses
${agentPackets}`;
}

async function synthesizeAgentRuns(input: {
  agentRuns: EnsembleAgentRunView[];
  prompt: string;
}) {
  const anthropic = getAnthropicClient();
  const response = (await anthropic.messages.create({
    max_tokens: 2200,
    messages: [
      {
        content: buildSynthesisUserPrompt(input),
        role: "user",
      },
    ],
    model: getEnsembleOrchestratorModel(),
    stream: false,
    system: buildSynthesisSystemPrompt(input.agentRuns.length),
  })) as NonStreamingMessage;
  const message = extractTextContent(response);

  if (!message) {
    throw new Error("The ensemble orchestrator returned an empty response.");
  }

  return message;
}

export async function runAcceptedAgentEnsemble(input: {
  prompt: string;
  request: Request;
}): Promise<EnsembleRunResponse> {
  const prompt = input.prompt.trim();

  if (!prompt) {
    throw new Error("Enter a prompt first.");
  }

  getAnthropicClient();

  const submissions = await listAcceptedSubmissionRecords();

  if (submissions.length === 0) {
    throw new Error("No accepted agents are available for ensemble runs yet.");
  }

  const llmGatewayBaseUrl = getSubmittedAgentLlmGatewayBaseUrl(input.request);
  const agentRuns = await Promise.all(
    submissions.map((submission) =>
      runAcceptedAgent({
        llmGatewayBaseUrl,
        prompt,
        submission,
      })
    )
  );
  const message = await synthesizeAgentRuns({
    agentRuns,
    prompt,
  });

  return {
    agentRuns,
    message,
    orchestratorModel: getEnsembleOrchestratorModel(),
  };
}
