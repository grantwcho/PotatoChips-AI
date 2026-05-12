import "server-only";

import { readdir, stat } from "node:fs/promises";
import { inspectCodeArchiveWorkspace } from "@/lib/hr-agent/execution";
import { runHrCommand, type HrCommandError } from "@/lib/hr-agent/storage";
import { prisma } from "@/lib/prisma";
import { SubmissionSource } from "@/lib/prisma-client";
import { SOURCE_ROOT_RELATIVE_PATH } from "@/lib/submissions/constants";
import { decryptSecretValue } from "@/lib/submissions/crypto";
import {
  buildSubmittedAgentEnvironment,
  getRequestedEnvVarsForWorkspace,
} from "@/lib/submissions/env-reconciliation";
import {
  GithubRepositoryArchiveError,
  cloneGithubRepository,
} from "@/lib/submissions/github/client";
import { parseSubmissionSource } from "@/lib/submissions/parser";
import { ensureSubmissionSchema } from "@/lib/submissions/schema";
import { persistParsedSubmissionArtifact } from "@/lib/submissions/service";
import { restoreSubmissionSourceArchive } from "@/lib/submissions/source-archive";
import { getStorageAdapter } from "@/lib/submissions/storage/local";

const DIRECT_RUN_TIMEOUT_MS = 90_000;
const DIRECT_RUN_GATEWAY_TOKEN_TTL_MS = DIRECT_RUN_TIMEOUT_MS + 15_000;
const MAX_DIRECT_RUN_OUTPUT_CHARS = 12_000;
const SANDBOX_NO_NETWORK_PROFILE =
  "(version 1) (deny default) (allow process*) (allow sysctl-read) (allow file-read*)";
const SANDBOX_NETWORK_PROFILE =
  "(version 1) (deny default) (allow process*) (allow sysctl-read) (allow file-read*) (allow network-outbound)";
const SANDBOX_PROBE_PROFILE = "(version 1) (allow default)";

type DirectRunContext = Record<string, unknown>;
type DirectRunConversationMessage = {
  content: string;
  role: "assistant" | "user";
};

function truncateOutput(value: string) {
  const trimmed = value.trim();

  if (trimmed.length <= MAX_DIRECT_RUN_OUTPUT_CHARS) {
    return trimmed;
  }

  return `${trimmed.slice(0, MAX_DIRECT_RUN_OUTPUT_CHARS)}\n...[truncated]`;
}

function createTruncatedChunkEmitter(onChunk?: (chunk: string) => void) {
  if (!onChunk) {
    return undefined;
  }

  let emittedChars = 0;
  let emittedTruncationMarker = false;

  return (chunk: string) => {
    if (!chunk) {
      return;
    }

    if (emittedChars >= MAX_DIRECT_RUN_OUTPUT_CHARS) {
      if (!emittedTruncationMarker) {
        emittedTruncationMarker = true;
        onChunk("\n...[truncated]");
      }

      return;
    }

    const remainingChars = MAX_DIRECT_RUN_OUTPUT_CHARS - emittedChars;
    const visibleChunk = chunk.slice(0, remainingChars);
    emittedChars += visibleChunk.length;

    if (visibleChunk) {
      onChunk(visibleChunk);
    }

    if (chunk.length > visibleChunk.length && !emittedTruncationMarker) {
      emittedTruncationMarker = true;
      onChunk("\n...[truncated]");
    }
  };
}

function normalizePrompt(value: unknown) {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : "Return a short response that proves the agent is working.";
}

function normalizeContext(value: unknown): DirectRunContext {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as DirectRunContext)
    : {};
}

function buildQueryContext(input: {
  context?: unknown;
  messages?: DirectRunConversationMessage[];
}) {
  const context = normalizeContext(input.context);

  if (!input.messages || input.messages.length === 0) {
    return context;
  }

  return {
    ...context,
    messages: input.messages,
  };
}

function normalizeMetrics(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
}

function tryParseJson(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
}

function getSandboxCommandCandidates() {
  return [
    process.env.SANDBOX_EXEC_PATH?.trim(),
    "/usr/bin/sandbox-exec",
    "sandbox-exec",
  ].filter((value): value is string => Boolean(value));
}

async function resolveSandboxCommand() {
  let lastError: unknown = null;

  for (const command of getSandboxCommandCandidates()) {
    try {
      await runHrCommand({
        args: ["-p", SANDBOX_PROBE_PROFILE, "/usr/bin/true"],
        command,
        timeoutMs: 2_000,
      });

      return command;
    } catch (error) {
      lastError = error;
    }
  }

  console.warn("Direct submitted-agent run is falling back without sandbox-exec.", {
    error: lastError instanceof Error ? lastError.message : lastError,
  });

  return null;
}

async function hasReadableSourceWorkspace(sourcePath: string) {
  try {
    const sourceStat = await stat(sourcePath);

    if (!sourceStat.isDirectory()) {
      return false;
    }

    return (await readdir(sourcePath)).length > 0;
  } catch {
    return false;
  }
}

async function ensureDirectRunSource(submissionId: string) {
  const storage = getStorageAdapter();
  const sourcePath = storage.resolveSubmissionAbsolutePath(
    submissionId,
    SOURCE_ROOT_RELATIVE_PATH
  );

  if (await hasReadableSourceWorkspace(sourcePath)) {
    return sourcePath;
  }

  const restoredSourcePath = await restoreSubmissionSourceArchive(submissionId);

  if (restoredSourcePath && (await hasReadableSourceWorkspace(restoredSourcePath))) {
    return restoredSourcePath;
  }

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

  if (submission.source !== SubmissionSource.GITHUB) {
    throw new Error(
      "Submitted source files are no longer available in local storage. Upload submissions need durable object storage before they can be re-run after the runner restarts."
    );
  }

  const accessToken = decryptSecretValue(submission.user.accessToken);

  if (!accessToken) {
    throw new Error(
      "GitHub source is no longer cached and the submitter's GitHub access token is missing."
    );
  }

  if (!submission.githubRepoFullName || !submission.githubBranch || !submission.githubCommitSha) {
    throw new Error("GitHub submission metadata is incomplete.");
  }

  let result: Awaited<ReturnType<typeof cloneGithubRepository>>;

  try {
    result = await cloneGithubRepository({
      accessToken,
      branch: submission.githubBranch,
      commitSha: submission.githubCommitSha,
      repoFullName: submission.githubRepoFullName,
      submissionId,
    });
  } catch (error) {
    if (error instanceof GithubRepositoryArchiveError) {
      throw new Error(
        "Submitted source is not available in saved storage, and the stored GitHub authorization for the original submission no longer works. Update the agent once to refresh and save a durable source copy."
      );
    }

    throw error;
  }

  const parsedSubmission = await parseSubmissionSource(result.sourcePath);

  await persistParsedSubmissionArtifact({
    parsedSubmission,
    submissionId,
  });

  return result.sourcePath;
}

export type DirectAgentRunResult = {
  execution: {
    command: string;
    credentialsInjected: boolean;
    descriptor: string;
    durationMs: number;
    exitCode: number;
    injectedEnvVarNames: string[];
    llmGatewayProviders: string[];
    networkEnabled: boolean;
    networkPolicy: string;
    proxiedEnvVarNames: string[];
    sandboxed: boolean;
    timeoutMs: number;
    withheldEnvVarNames: string[];
  };
  parsedResponse: unknown;
  stderr: string;
  stdout: string;
};

type StructuredTable = {
  columns: string[];
  rows: string[][];
  title?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringifyTableCell(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return value.trim();
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return JSON.stringify(value);
}

function normalizeTableColumns(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map(stringifyTableCell).filter(Boolean);
}

function inferTableColumns(rows: unknown[]) {
  const keys = new Set<string>();
  let arrayColumnCount = 0;

  for (const row of rows) {
    if (Array.isArray(row)) {
      arrayColumnCount = Math.max(arrayColumnCount, row.length);
      continue;
    }

    if (!isRecord(row)) {
      continue;
    }

    for (const key of Object.keys(row)) {
      keys.add(key);
    }
  }

  if (keys.size > 0) {
    return Array.from(keys);
  }

  return Array.from({ length: arrayColumnCount }, (_, index) => `Column ${index + 1}`);
}

function normalizeStructuredTable(value: unknown): StructuredTable | null {
  if (!isRecord(value) && !Array.isArray(value)) {
    return null;
  }

  const rawRows = Array.isArray(value)
    ? value
    : Array.isArray(value.rows)
      ? value.rows
      : Array.isArray(value.data)
        ? value.data
        : [];
  const columns =
    !Array.isArray(value) && normalizeTableColumns(value.columns).length > 0
      ? normalizeTableColumns(value.columns)
      : !Array.isArray(value) && normalizeTableColumns(value.headers).length > 0
        ? normalizeTableColumns(value.headers)
        : inferTableColumns(rawRows);

  if (columns.length === 0 || rawRows.length === 0) {
    return null;
  }

  const rows = rawRows
    .map((row) => {
      if (Array.isArray(row)) {
        return columns.map((_, index) => stringifyTableCell(row[index]));
      }

      if (isRecord(row)) {
        return columns.map((column) => stringifyTableCell(row[column]));
      }

      return null;
    })
    .filter((row): row is string[] => row !== null);

  if (rows.length === 0) {
    return null;
  }

  return {
    columns,
    rows,
    title: Array.isArray(value)
      ? undefined
      : typeof value.title === "string"
        ? value.title.trim()
        : typeof value.name === "string"
          ? value.name.trim()
          : undefined,
  };
}

function extractStructuredTables(value: unknown): StructuredTable[] {
  if (Array.isArray(value)) {
    const table = normalizeStructuredTable(value);

    return table ? [table] : [];
  }

  if (!isRecord(value)) {
    return [];
  }

  const candidates: unknown[] = [];

  if (Array.isArray(value.tables)) {
    candidates.push(...value.tables);
  }

  if (isRecord(value.table)) {
    candidates.push(value.table);
  }

  if (isRecord(value.answer)) {
    candidates.push(value.answer);

    if (Array.isArray(value.answer.tables)) {
      candidates.push(...value.answer.tables);
    }

    if (isRecord(value.answer.table)) {
      candidates.push(value.answer.table);
    }
  }

  candidates.push(value);

  const tables = candidates
    .map(normalizeStructuredTable)
    .filter((table): table is StructuredTable => table !== null);

  return tables.filter(
    (table, index) =>
      index ===
      tables.findIndex(
        (candidate) =>
          candidate.title === table.title &&
          candidate.columns.join("\u0000") === table.columns.join("\u0000") &&
          candidate.rows.length === table.rows.length
      )
  );
}

function escapeMarkdownTableCell(value: string) {
  return value.replace(/\s*\n+\s*/g, " ").replaceAll("|", "\\|").trim();
}

function isNumericTableValue(value: string) {
  return /^[$(+-]?\d[\d,]*(?:\.\d+)?%?\)?$/u.test(value.trim());
}

function renderStructuredTable(table: StructuredTable) {
  const alignments = table.columns.map((_, columnIndex) => {
    if (columnIndex === 0) {
      return "---";
    }

    return table.rows.some((row) => isNumericTableValue(row[columnIndex] ?? ""))
      ? "---:"
      : "---";
  });
  const lines = [
    table.title ? `### ${table.title}` : null,
    `| ${table.columns.map(escapeMarkdownTableCell).join(" |")} |`,
    `| ${alignments.join(" | ")} |`,
    ...table.rows.map(
      (row) => `| ${row.map(escapeMarkdownTableCell).join(" | ")} |`
    ),
  ];

  return lines.filter(Boolean).join("\n");
}

function extractAnswerText(value: unknown): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const directText = record.text;

  if (typeof directText === "string" && directText.trim()) {
    return directText.trim();
  }

  const answer = record.answer;

  if (typeof answer === "string" && answer.trim()) {
    return answer.trim();
  }

  if (answer && typeof answer === "object") {
    const answerRecord = answer as Record<string, unknown>;

    for (const key of ["text", "summary", "response", "message"]) {
      const candidate = answerRecord[key];

      if (typeof candidate === "string" && candidate.trim()) {
        return candidate.trim();
      }
    }
  }

  for (const key of ["summary", "response", "message", "output"]) {
    const candidate = record[key];

    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  return null;
}

function extractAnswerContent(value: unknown): string | null {
  const answerText = extractAnswerText(value);
  const tables = extractStructuredTables(value).map(renderStructuredTable);
  const content = [answerText, ...tables].filter(Boolean).join("\n\n").trim();

  return content || null;
}

function formatEnvVarList(envVarNames: string[]) {
  return envVarNames.map((envVarName) => `\`${envVarName}\``).join(", ");
}

function readCommandError(error: unknown) {
  const commandError = error as HrCommandError;

  return {
    exitCode: commandError.exitCode ?? 1,
    message:
      error instanceof Error
        ? error.message
        : "Submitted agent command failed unexpectedly.",
    stderr:
      typeof commandError.stderr === "string" ? commandError.stderr : "",
    stdout:
      typeof commandError.stdout === "string" ? commandError.stdout : "",
    timedOut: commandError.timedOut === true,
  };
}

function buildWithheldOperatorKeysNote(result: DirectAgentRunResult) {
  const withheldEnvVarNames = result.execution.withheldEnvVarNames ?? [];

  if (withheldEnvVarNames.length === 0) {
    return null;
  }

  return [
    "**Platform note:** This direct run withheld operator-only LLM key(s):",
    formatEnvVarList(withheldEnvVarNames),
    "Submitted code cannot receive platform LLM credentials directly. If the output above is only a setup message or prompt echo, the submitted agent did not return a generated prompt result. Use **Ask harness** for platform-side reasoning, or update the submission so its direct-run path returns a real result without requiring operator LLM keys.",
  ].join(" ");
}

export function buildDirectRunChatContent(result: DirectAgentRunResult) {
  const answerText = extractAnswerContent(result.parsedResponse);
  const withheldOperatorKeysNote = buildWithheldOperatorKeysNote(result);
  const platformNote = [withheldOperatorKeysNote]
    .filter(Boolean)
    .join("\n\n");

  if (result.execution.exitCode === 0 && answerText) {
    return platformNote
      ? `${answerText}\n\n${platformNote}`
      : answerText;
  }

  if (result.execution.exitCode === 0 && result.stdout.trim()) {
    return platformNote
      ? `${result.stdout.trim()}\n\n${platformNote}`
      : result.stdout.trim();
  }

  const stdout = result.stdout ? `\n\nstdout:\n${result.stdout}` : "";
  const stderr = result.stderr ? `\n\nstderr:\n${result.stderr}` : "";

  return [
    `Agent run failed with exit code ${result.execution.exitCode}.`,
    stdout,
    stderr,
    platformNote ? `\n\n${platformNote}` : "",
  ].join("").trim();
}

export async function runSubmittedAgentDirectly(input: {
  context?: unknown;
  conversationMessages?: DirectRunConversationMessage[];
  injectManagedCredentials?: boolean;
  llmGatewayBaseUrl?: string;
  metrics?: unknown;
  onStdoutChunk?: (chunk: string) => void;
  prompt?: unknown;
  submissionId: string;
}) {
  const sourcePath = await ensureDirectRunSource(input.submissionId);
  const plan = await inspectCodeArchiveWorkspace(sourcePath);
  const injectManagedCredentials = Boolean(input.injectManagedCredentials);
  const runId = `direct-${Date.now()}`;
  const requestedEnvVars = injectManagedCredentials
    ? await getRequestedEnvVarsForWorkspace(plan.cwd).catch(() => [])
    : [];
  const runtimeEnv = await buildSubmittedAgentEnvironment({
    extraEnv: {
      PYTHONDONTWRITEBYTECODE: "1",
      PYTHONUNBUFFERED: "1",
    },
    llmGateway:
      injectManagedCredentials && input.llmGatewayBaseUrl
        ? {
            baseUrl: input.llmGatewayBaseUrl,
            runId,
            submissionId: input.submissionId,
            ttlMs: DIRECT_RUN_GATEWAY_TOKEN_TTL_MS,
          }
        : undefined,
    requestedEnvVars,
  });
  const networkEnabled = injectManagedCredentials;
  const profile = networkEnabled ? SANDBOX_NETWORK_PROFILE : SANDBOX_NO_NETWORK_PROFILE;
  const queryEnvelope = {
    context: buildQueryContext({
      context: input.context,
      messages: input.conversationMessages,
    }),
    metrics: normalizeMetrics(input.metrics),
    prompt: normalizePrompt(input.prompt),
    query_id: runId,
    response_format: "freeform",
  };

  const sandboxCommand = await resolveSandboxCommand();
  const sandboxed = Boolean(sandboxCommand);
  const command = sandboxCommand ?? plan.command[0]!;
  const args = sandboxCommand
    ? ["-p", profile, ...plan.command]
    : plan.command.slice(1);
  const effectiveNetworkEnabled = sandboxed ? networkEnabled : true;

  const startedAt = Date.now();
  const emitStdoutChunk = createTruncatedChunkEmitter(input.onStdoutChunk);
  let result: Awaited<ReturnType<typeof runHrCommand>>;

  try {
    result = await runHrCommand({
      args,
      command,
      cwd: plan.cwd,
      env: runtimeEnv.env,
      onStdoutChunk: emitStdoutChunk,
      stdin: `${JSON.stringify(queryEnvelope)}\n`,
      timeoutMs: DIRECT_RUN_TIMEOUT_MS,
    });
  } catch (error) {
    const commandError = readCommandError(error);
    const stdout = truncateOutput(commandError.stdout);
    const stderr = truncateOutput(
      [
        commandError.message,
        commandError.stderr ? `Partial stderr:\n${commandError.stderr}` : "",
        commandError.stdout ? `Partial stdout:\n${commandError.stdout}` : "",
      ]
        .filter(Boolean)
        .join("\n\n")
    );

    return {
      execution: {
        command: plan.command.join(" "),
        credentialsInjected: injectManagedCredentials,
        descriptor: plan.descriptor,
        durationMs: Date.now() - startedAt,
        exitCode: commandError.timedOut ? 124 : commandError.exitCode,
        injectedEnvVarNames: runtimeEnv.injectedEnvVarNames,
        llmGatewayProviders: runtimeEnv.llmGatewayProviders,
        networkEnabled: effectiveNetworkEnabled,
        networkPolicy: sandboxed
          ? networkEnabled
            ? "Outbound networking enabled for this direct run."
            : "Outbound networking disabled for this direct run."
          : "No OS sandbox is available; submitted code ran with host/container isolation and the direct-run timeout.",
        proxiedEnvVarNames: runtimeEnv.proxiedEnvVarNames,
        sandboxed,
        timeoutMs: DIRECT_RUN_TIMEOUT_MS,
        withheldEnvVarNames: runtimeEnv.withheldEnvVarNames,
      },
      parsedResponse: null,
      stderr,
      stdout,
    } satisfies DirectAgentRunResult;
  }

  const stdout = truncateOutput(result.stdout);
  const stderr = truncateOutput(result.stderr);

  return {
    execution: {
      command: plan.command.join(" "),
      credentialsInjected: injectManagedCredentials,
      descriptor: plan.descriptor,
      durationMs: Date.now() - startedAt,
      exitCode: result.exitCode,
      injectedEnvVarNames: runtimeEnv.injectedEnvVarNames,
      llmGatewayProviders: runtimeEnv.llmGatewayProviders,
      networkEnabled: effectiveNetworkEnabled,
      networkPolicy: sandboxed
        ? networkEnabled
          ? "Outbound networking enabled for this direct run."
          : "Outbound networking disabled for this direct run."
        : "No OS sandbox is available; submitted code ran with host/container isolation and the direct-run timeout.",
      proxiedEnvVarNames: runtimeEnv.proxiedEnvVarNames,
      sandboxed,
      timeoutMs: DIRECT_RUN_TIMEOUT_MS,
      withheldEnvVarNames: runtimeEnv.withheldEnvVarNames,
    },
    parsedResponse: tryParseJson(stdout),
    stderr,
    stdout,
  } satisfies DirectAgentRunResult;
}
