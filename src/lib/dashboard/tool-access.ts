import "server-only";

import { GoogleAuth } from "google-auth-library";
import { revalidatePath } from "next/cache";
import type { AgentApplication } from "@/lib/hr-agent/models/agent-application";
import { getHrApplicationById } from "@/lib/hr-agent/repository";
import { prisma } from "@/lib/prisma";
import { getGithubRepositoryViewUrl } from "@/lib/submissions/github/client";
import { encryptSecretValue } from "@/lib/submissions/crypto";
import { ensureSubmissionSchema } from "@/lib/submissions/schema";
import {
  getSubmissionDetail,
  selectLatestSubmissionsBySource,
} from "@/lib/submissions/service";
import {
  extractManifestDeclaredEnvVars,
  getCanonicalManagedEnvVarName,
  getManagedEnvVarMetadata,
  isCredentialLikeEnvVarName,
  isOptionalRuntimeConfigEnvVar,
} from "@/lib/submissions/env-reconciliation";
import type {
  AiHrDependency,
  ParsedSubmission,
  SubmissionDetail,
} from "@/lib/submissions/types";

const GOOGLE_CLOUD_SCOPE = "https://www.googleapis.com/auth/cloud-platform";
const googleCloudAuth = new GoogleAuth({
  scopes: [GOOGLE_CLOUD_SCOPE],
});

const ENV_VAR_PATTERN = /\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/g;

const KNOWN_TOOL_CATALOG = [
  {
    envVars: ["ALPACA_API_KEY", "ALPACA_SECRET_KEY"],
    label: "Alpaca Markets API",
    match: /alpaca/i,
    summary: "Approved market-data access for research workflows.",
  },
  {
    envVars: ["OPENAI_API_KEY"],
    label: "OpenAI API",
    match: /openai/i,
    summary: "LLM inference access for OpenAI-hosted models.",
  },
  {
    envVars: ["ANTHROPIC_API_KEY"],
    label: "Anthropic API",
    match: /anthropic|claude/i,
    summary: "LLM inference access for Anthropic-hosted models.",
  },
  {
    envVars: ["ALPHA_VANTAGE_API_KEY"],
    label: "Alpha Vantage API",
    match: /alpha[\s-]?vantage/i,
    summary: "Equity market data and news feed access.",
  },
  {
    envVars: ["MASSIVE_API_KEY"],
    label: "Massive API",
    match: /massive|polygon/i,
    summary: "Market data access for the Massive (Polygon) API.",
  },
  {
    envVars: ["SEC_USER_AGENT"],
    label: "SEC EDGAR",
    match: /sec|edgar/i,
    summary: "Fair-access contact header required for SEC EDGAR requests.",
  },
  {
    envVars: ["NEWSAPI_API_KEY"],
    label: "News API",
    match: /newsapi/i,
    summary: "News feed access for external news-provider requests.",
  },
] as const;

const PLATFORM_RUNTIME_CONFIG_CATALOG = [
  {
    envVars: [
      "ANTHROPIC_CODE_EXECUTION_TOOL",
      "ANTHROPIC_WEB_FETCH_TOOL",
      "ANTHROPIC_WEB_SEARCH_TOOL",
      "ANTHROPIC_WEBFETCH_MODEL",
      "ANTHROPIC_WEB_FETCH_MODEL",
      "ANTHROPIC_WEB_SEARCH_MODEL",
    ],
    key: "anthropic-server-tools",
    label: "Anthropic server tools",
    summary:
      "Claude web search, web fetch, and code execution are enabled by request tool definitions using the configured Anthropic API key; these env vars are feature flags or model selectors, not credentials.",
    typeLabel: "Platform Capability",
  },
  {
    envVars: ["MCP_SERVER_NAME", "MCP_SERVER_URL", "MCP_SERVERS_JSON"],
    key: "external-mcp-runtime-config",
    label: "External MCP runtime config",
    summary:
      "MCP server routing/configuration for submitted agents. These values are not secrets by themselves; MCP auth tokens are tracked separately when declared.",
    typeLabel: "Runtime Config",
  },
] as const;

const KNOWN_ENV_VAR_CATALOG = [
  {
    envVars: ["MCP_AUTH_TOKEN"],
    label: "External MCP authentication",
    summary:
      "Authentication token for a submitted agent's external MCP server. This is separate from Anthropic-hosted Claude server tools.",
  },
] as const;

type DashboardToolSyncState =
  | "CONFIGURED_IN_RUNTIME"
  | "ERROR"
  | "LOCAL_ONLY"
  | "MISSING"
  | "SECRET_MANAGER_SYNCED";

type DashboardToolAccessStatus =
  | "configured"
  | "missing"
  | "not_required"
  | "partial";

type EnvironmentSecretRecord = Awaited<ReturnType<typeof listEnvironmentSecrets>>[number];

export type DashboardToolEnvVar = {
  canonicalEnvVarName: string;
  configured: boolean;
  envVarName: string;
  lastUpdatedAt: string | null;
  source: "missing" | "portal" | "runtime";
  satisfiedByEnvVarName: string | null;
  syncMessage: string | null;
  syncState: DashboardToolSyncState;
};

export type DashboardToolUsageReference = {
  agentName: string;
  applicationId: string;
  repoFullName: string | null;
  submissionId: string | null;
};

export type DashboardToolRequirement = {
  accessLabel: string;
  accessStatus: DashboardToolAccessStatus;
  envVars: DashboardToolEnvVar[];
  key: string;
  label: string;
  summary: string;
  typeLabel: string;
  usedBy: DashboardToolUsageReference[];
};

export type DashboardToolsData = {
  cloudSyncAvailable: boolean;
  cloudSyncNote: string;
  environmentVariables: DashboardToolEnvVar[];
  stats: {
    configured: number;
    missing: number;
    noCredentialRequired: number;
    partial: number;
    total: number;
  };
  tools: DashboardToolRequirement[];
};

export type DashboardSubmissionRequirementsData = {
  application: AgentApplication;
  requirements: DashboardToolRequirement[];
  submission: SubmissionDetail | null;
};

export async function getSubmissionRuntimeRequirements(input: {
  applicationId?: string;
  fallbackDataSources?: string;
  submission: Pick<
    SubmissionDetail,
    "card" | "githubRepoFullName" | "id" | "parsedSubmission"
  >;
  submissionLabel: string;
}) {
  const recordsByEnvVar = await getEnvironmentSecretMap();

  return buildRequirementsForSubmission({
    applicationId: input.applicationId ?? `HR-SUB-${input.submission.id}`,
    detail: {
      card: input.submission.card,
      githubRepoFullName: input.submission.githubRepoFullName,
      id: input.submission.id,
      parsedSubmission: input.submission.parsedSubmission,
    },
    fallbackDataSources: input.fallbackDataSources,
    recordsByEnvVar,
    submissionLabel: input.submissionLabel,
  });
}

type RequirementSourceDetail = {
  card: null | {
    dependencies: AiHrDependency[];
  };
  githubRepoFullName: string | null;
  id: string;
  parsedSubmission: ParsedSubmission | null;
};

function normalizeAccessToken(
  token: string | null | undefined | { token?: string | null }
) {
  if (typeof token === "string") {
    return token;
  }

  return token?.token ?? null;
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeEnvVarName(value: string) {
  const normalized = value.trim().toUpperCase();

  if (!/^[A-Z][A-Z0-9_]*$/.test(normalized)) {
    throw new Error("Environment variable names must use A-Z, 0-9, and underscores only.");
  }

  return normalized;
}

function safeNormalizeEnvVarNames(values: Iterable<string>) {
  const normalized = new Set<string>();

  for (const value of values) {
    try {
      normalized.add(normalizeEnvVarName(value));
    } catch {
      continue;
    }
  }

  return [...normalized].sort();
}

function formatDependencyTypeLabel(type: string) {
  switch (type) {
    case "DATA_API":
      return "Data API";
    case "LLM_API":
      return "LLM API";
    case "MODEL_WEIGHTS":
      return "Model Weights";
    case "PLATFORM_TOOL":
      return "Platform Tool";
    default:
      return "Custom Tool";
  }
}

function getCloudSyncConfig() {
  const projectId = process.env.GOOGLE_CLOUD_PROJECT?.trim() || null;
  const prefix = process.env.SECRET_MANAGER_PREFIX?.trim() || null;

  return {
    prefix,
    projectId,
  };
}

function buildCloudSyncNote() {
  const { projectId } = getCloudSyncConfig();

  if (!projectId) {
    return "Secrets are encrypted in the admin portal and loaded into the current server environment. Set GOOGLE_CLOUD_PROJECT to mirror them into Google Secret Manager as well.";
  }

  return "Secrets are encrypted in the admin portal, loaded into the current server environment, and mirrored into Google Secret Manager.";
}

function isCloudSyncAvailable() {
  return Boolean(getCloudSyncConfig().projectId);
}

function getSubmissionIdFromApplicationId(applicationId: string) {
  return applicationId.startsWith("HR-SUB-")
    ? applicationId.slice("HR-SUB-".length)
    : null;
}

function canonicalizeToolLabel(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return "Unnamed tool";
  }

  const known = KNOWN_TOOL_CATALOG.find((entry) => entry.match.test(trimmed));
  return known?.label ?? trimmed;
}

function buildSecretManagerSecretId(envVarName: string) {
  const { prefix } = getCloudSyncConfig();
  const base = prefix ? `${prefix}-${envVarName}` : envVarName;
  return base.replace(/[^A-Za-z0-9_-]+/g, "-");
}

async function getGoogleAccessToken() {
  const client = await googleCloudAuth.getClient();
  return normalizeAccessToken(await client.getAccessToken());
}

async function secretManagerRequest(
  input: {
    body?: unknown;
    method?: "GET" | "POST";
    path: string;
  }
) {
  const accessToken = await getGoogleAccessToken();

  if (!accessToken) {
    throw new Error("Unable to acquire a Google access token.");
  }

  const response = await fetch(`https://secretmanager.googleapis.com/v1/${input.path}`, {
    body: input.body ? JSON.stringify(input.body) : undefined,
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    method: input.method ?? "GET",
  });

  if (response.ok) {
    return response;
  }

  const payload = (await response.json().catch(() => ({}))) as {
    error?: {
      message?: string;
      status?: string;
    };
  };

  const error = new Error(
    payload.error?.message || `Secret Manager request failed with HTTP ${response.status}.`
  ) as Error & { status?: number };
  error.status = response.status;
  throw error;
}

async function syncSecretToGoogleSecretManager(input: {
  envVarName: string;
  value: string;
}) {
  const { projectId } = getCloudSyncConfig();

  if (!projectId) {
    return {
      googleSecretName: null,
      syncMessage:
        "Stored in the admin portal and current server environment. GOOGLE_CLOUD_PROJECT is not configured, so Google Secret Manager sync was skipped.",
      syncState: "LOCAL_ONLY" as const,
    };
  }

  const secretId = buildSecretManagerSecretId(input.envVarName);
  const secretPath = `projects/${projectId}/secrets/${secretId}`;

  try {
    await secretManagerRequest({
      path: secretPath,
    });
  } catch (error) {
    const status = typeof error === "object" && error && "status" in error ? error.status : null;

    if (status !== 404) {
      throw error;
    }

    await secretManagerRequest({
      body: {
        replication: {
          automatic: {},
        },
      },
      method: "POST",
      path: `projects/${projectId}/secrets?secretId=${encodeURIComponent(secretId)}`,
    });
  }

  await secretManagerRequest({
    body: {
      payload: {
        data: Buffer.from(input.value, "utf8").toString("base64"),
      },
    },
    method: "POST",
    path: `${secretPath}:addVersion`,
  });

  return {
    googleSecretName: secretId,
    syncMessage:
      "Stored in the admin portal, current server environment, and Google Secret Manager.",
    syncState: "SECRET_MANAGER_SYNCED" as const,
  };
}

async function listEnvironmentSecrets() {
  await ensureSubmissionSchema();

  return prisma.environmentSecret.findMany({
    orderBy: {
      envVarName: "asc",
    },
  });
}

async function getEnvironmentSecretMap() {
  const records = await listEnvironmentSecrets();
  return new Map(records.map((record) => [record.envVarName, record] as const));
}

function collectEnvVarsFromUnknown(
  value: unknown,
  collector: Set<string>
) {
  if (typeof value === "string") {
    for (const match of value.matchAll(ENV_VAR_PATTERN)) {
      const envVarName = match[0];

      if (
        isCredentialLikeEnvVarName(envVarName) ||
        getPlatformRuntimeConfigForEnvVar(envVarName)
      ) {
        collector.add(envVarName);
      }
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      collectEnvVarsFromUnknown(entry, collector);
    }
    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    collectEnvVarsFromUnknown(key, collector);
    collectEnvVarsFromUnknown(child, collector);
  }
}

function inferEnvVarsFromDependency(dependency: AiHrDependency) {
  const collector = new Set<string>();
  collectEnvVarsFromUnknown(dependency.details, collector);

  const known = KNOWN_TOOL_CATALOG.find((entry) => entry.match.test(dependency.name));

  for (const envVarName of known?.envVars ?? []) {
    collector.add(envVarName);
  }

  return {
    envVarNames: safeNormalizeEnvVarNames(collector).filter(
      (envVarName) => !isOptionalRuntimeConfigEnvVar(envVarName)
    ),
    known,
  };
}

function getKnownToolForEnvVar(envVarName: string) {
  const canonical = getCanonicalManagedEnvVarName(envVarName) ?? envVarName;
  const managed = getManagedEnvVarMetadata(envVarName);

  if (managed) {
    return {
      envVars: [managed.canonical],
      label: managed.label,
      summary: managed.summary,
    };
  }

  return KNOWN_TOOL_CATALOG.find((entry) =>
    entry.envVars.some((candidate) => candidate === canonical)
  ) ?? KNOWN_ENV_VAR_CATALOG.find((entry) =>
    entry.envVars.some((candidate) => candidate === canonical)
  );
}

function getPlatformRuntimeConfigForEnvVar(envVarName: string) {
  const normalized = normalizeEnvVarName(envVarName);

  return PLATFORM_RUNTIME_CONFIG_CATALOG.find((entry) =>
    entry.envVars.some((candidate) => candidate === normalized)
  );
}

function buildToolSummary(dependency: AiHrDependency, knownSummary: string | undefined) {
  const detailCandidates = [
    dependency.details?.purpose,
    dependency.details?.baseUrl,
    dependency.details?.url,
    dependency.details?.note,
    dependency.details?.authMethod,
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);

  if (detailCandidates.length > 0) {
    return detailCandidates[0]!;
  }

  return knownSummary ?? "Required by at least one submitted agent.";
}

function buildEnvVarStatus(
  envVarName: string,
  recordsByEnvVar: Map<string, EnvironmentSecretRecord>
): DashboardToolEnvVar {
  const normalized = normalizeEnvVarName(envVarName);
  const canonical = getCanonicalManagedEnvVarName(normalized) ?? normalized;
  const record = recordsByEnvVar.get(normalized) ?? recordsByEnvVar.get(canonical);
  const satisfiedByEnvVarName =
    record && record.envVarName !== normalized ? record.envVarName : null;

  if (record) {
    return {
      canonicalEnvVarName: canonical,
      configured: true,
      envVarName: normalized,
      lastUpdatedAt: record.lastSyncedAt?.toISOString() ?? record.updatedAt.toISOString(),
      source: "portal",
      satisfiedByEnvVarName,
      syncMessage:
        satisfiedByEnvVarName
          ? `Satisfied by house-managed ${satisfiedByEnvVarName}; the runner will expose it as ${normalized}.`
          : record.syncMessage,
      syncState: (record.syncState as DashboardToolSyncState) ?? "LOCAL_ONLY",
    };
  }

  const runtimeEnvVarName =
    process.env[normalized]?.trim()
      ? normalized
      : process.env[canonical]?.trim()
        ? canonical
        : null;

  if (runtimeEnvVarName) {
    return {
      canonicalEnvVarName: canonical,
      configured: true,
      envVarName: normalized,
      lastUpdatedAt: null,
      source: "runtime",
      satisfiedByEnvVarName:
        runtimeEnvVarName !== normalized ? runtimeEnvVarName : null,
      syncMessage:
        runtimeEnvVarName !== normalized
          ? `Satisfied by ${runtimeEnvVarName} in the current server environment; the runner will expose it as ${normalized}.`
          : "Already present in the current server environment.",
      syncState: "CONFIGURED_IN_RUNTIME",
    };
  }

  return {
    canonicalEnvVarName: canonical,
    configured: false,
    envVarName: normalized,
    lastUpdatedAt: null,
    source: "missing",
    satisfiedByEnvVarName: null,
    syncMessage: "No value has been provided yet.",
    syncState: "MISSING",
  };
}

function buildAccessStatus(envVars: DashboardToolEnvVar[]): {
  label: string;
  status: DashboardToolAccessStatus;
} {
  if (envVars.length === 0) {
    return {
      label: "No credential required",
      status: "not_required",
    };
  }

  const configuredCount = envVars.filter((item) => item.configured).length;

  if (configuredCount === envVars.length) {
    return {
      label: "Configured",
      status: "configured",
    };
  }

  if (configuredCount > 0) {
    return {
      label: "Partially configured",
      status: "partial",
    };
  }

  return {
    label: "Missing credentials",
    status: "missing",
  };
}

function mergeUsageReference(
  existing: DashboardToolUsageReference[],
  next: DashboardToolUsageReference
) {
  if (
    existing.some(
      (item) =>
        item.applicationId === next.applicationId &&
        item.submissionId === next.submissionId
    )
  ) {
    return existing;
  }

  return [...existing, next];
}

function compareToolRequirements(
  left: DashboardToolRequirement,
  right: DashboardToolRequirement
) {
  const order: Record<DashboardToolAccessStatus, number> = {
    missing: 0,
    partial: 1,
    configured: 2,
    not_required: 3,
  };

  return (
    order[left.accessStatus] - order[right.accessStatus] ||
    left.label.localeCompare(right.label, "en", { sensitivity: "base" })
  );
}

async function readParsedSubmission(submissionId: string) {
  const submission = await getSubmissionDetail(submissionId);
  return submission?.parsedSubmission ?? null;
}

function parseDependencyDetails(value: unknown): Record<string, unknown> {
  if (typeof value !== "string" || !value.trim()) {
    return {};
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

async function listSignedSubmissionSnapshots() {
  await ensureSubmissionSchema();

  const submissions = await prisma.submission.findMany({
    where: {
      status: "SIGNED",
    },
    include: {
      card: {
        include: {
          dependencies: {
            orderBy: {
              sortOrder: "asc",
            },
          },
        },
      },
    },
    orderBy: {
      updatedAt: "desc",
    },
  });

  const latestSubmissions = selectLatestSubmissionsBySource(submissions);

  return Promise.all(
    latestSubmissions.map(async (submission) => ({
      agentName:
        submission.agentName?.trim() ||
        submission.githubRepoFullName?.split("/").filter(Boolean).at(-1) ||
        `Submission ${submission.id.slice(0, 8)}`,
      dependencies: (submission.card?.dependencies ?? []).map((dependency) => ({
        details: parseDependencyDetails(dependency.details),
        name: dependency.name,
        type: dependency.type,
      })),
      githubBranch: submission.githubBranch,
      githubCommitSha: submission.githubCommitSha,
      githubRepoFullName: submission.githubRepoFullName,
      id: submission.id,
      parsedSubmission: await readParsedSubmission(submission.id),
      sourceViewUrl: submission.githubRepoFullName
        ? getGithubRepositoryViewUrl(
            submission.githubRepoFullName,
            submission.githubCommitSha
          )
        : null,
    }))
  );
}

function buildRequirementsForSubmission(input: {
  applicationId: string;
  detail: RequirementSourceDetail | null;
  fallbackDataSources?: string;
  recordsByEnvVar: Map<string, EnvironmentSecretRecord>;
  submissionLabel: string;
}) {
  const requirements = new Map<
    string,
    Omit<DashboardToolRequirement, "accessLabel" | "accessStatus" | "envVars"> & {
      envVarNames: string[];
    }
  >();

  const usageReference: DashboardToolUsageReference = {
    agentName: input.submissionLabel,
    applicationId: input.applicationId,
    repoFullName: input.detail?.githubRepoFullName ?? null,
    submissionId: input.detail?.id ?? null,
  };

  const dependencies = input.detail?.card?.dependencies ?? [];

  function mergeEnvVarNames(existing: string[] | undefined, next: string[]) {
    return Array.from(new Set([...(existing ?? []), ...next])).sort();
  }

  function addRuntimeEnvRequirement(inputEnv: {
    envVarName: string;
    summary: string;
    typeLabel?: string;
  }) {
    let normalized: string;

    try {
      normalized = normalizeEnvVarName(inputEnv.envVarName);
    } catch {
      return;
    }

    const canonical = getCanonicalManagedEnvVarName(normalized) ?? normalized;
    const known = getKnownToolForEnvVar(normalized);
    const key = `env:${canonical}`;
    const existing = requirements.get(key);

    requirements.set(key, {
      envVarNames: mergeEnvVarNames(existing?.envVarNames, [normalized]),
      key,
      label: known?.label ?? normalized,
      summary: existing?.summary ?? known?.summary ?? inputEnv.summary,
      typeLabel: existing?.typeLabel ?? inputEnv.typeLabel ?? "Runtime Config",
      usedBy: mergeUsageReference(existing?.usedBy ?? [], usageReference),
    });
  }

  function addPlatformRuntimeConfigRequirement(inputEnv: { envVarName: string }) {
    let normalized: string;

    try {
      normalized = normalizeEnvVarName(inputEnv.envVarName);
    } catch {
      return;
    }

    const platformConfig = getPlatformRuntimeConfigForEnvVar(normalized);

    if (!platformConfig) {
      return;
    }

    const key = `platform:${platformConfig.key}`;
    const existing = requirements.get(key);

    requirements.set(key, {
      envVarNames: [],
      key,
      label: platformConfig.label,
      summary: existing?.summary ?? platformConfig.summary,
      typeLabel: existing?.typeLabel ?? platformConfig.typeLabel,
      usedBy: mergeUsageReference(existing?.usedBy ?? [], usageReference),
    });
  }

  for (const dependency of dependencies) {
    const { envVarNames, known } = inferEnvVarsFromDependency(dependency);

    const label = known?.label ?? canonicalizeToolLabel(dependency.name);
    const canonicalEnvVarNames = Array.from(
      new Set(
        envVarNames.map((envVarName) => getCanonicalManagedEnvVarName(envVarName) ?? envVarName)
      )
    ).sort();
    const key =
      canonicalEnvVarNames.length > 0
        ? `env:${canonicalEnvVarNames.join("|")}`
        : `dependency:${slugify(label)}:${dependency.type}`;
    const existing = requirements.get(key);

    requirements.set(key, {
      envVarNames: mergeEnvVarNames(existing?.envVarNames, envVarNames),
      key,
      label,
      summary: existing?.summary ?? buildToolSummary(dependency, known?.summary),
      typeLabel: existing?.typeLabel ?? formatDependencyTypeLabel(dependency.type),
      usedBy: mergeUsageReference(existing?.usedBy ?? [], usageReference),
    });
  }

  for (const declaredEnvVar of extractManifestDeclaredEnvVars(
    input.detail?.parsedSubmission
  )) {
    if (getPlatformRuntimeConfigForEnvVar(declaredEnvVar)) {
      addPlatformRuntimeConfigRequirement({ envVarName: declaredEnvVar });
      continue;
    }

    if (!isCredentialLikeEnvVarName(declaredEnvVar)) {
      continue;
    }

    addRuntimeEnvRequirement({
      envVarName: declaredEnvVar,
      summary: "Declared in the submitted manifest as platform-managed runtime configuration.",
      typeLabel: "Declared Runtime Config",
    });
  }

  const parsedEnvVars = input.detail?.parsedSubmission?.detectedEnvVars ?? [];

  for (const detectedEnvVar of parsedEnvVars) {
    if (getPlatformRuntimeConfigForEnvVar(detectedEnvVar)) {
      addPlatformRuntimeConfigRequirement({ envVarName: detectedEnvVar });
      continue;
    }

    if (
      isOptionalRuntimeConfigEnvVar(detectedEnvVar) ||
      !isCredentialLikeEnvVarName(detectedEnvVar)
    ) {
      continue;
    }

    addRuntimeEnvRequirement({
      envVarName: detectedEnvVar,
      summary: "Detected as a runtime environment variable in the submitted repository.",
    });
  }

  if (requirements.size === 0 && input.fallbackDataSources?.trim()) {
    for (const sourceName of input.fallbackDataSources.split(",").map((part) => part.trim())) {
      if (!sourceName) {
        continue;
      }

      const key = `dependency:${slugify(sourceName)}:fallback`;
      const existing = requirements.get(key);

      requirements.set(key, {
        envVarNames: [],
        key,
        label: sourceName,
        summary: "Imported from the submission intake record.",
        typeLabel: "Declared Source",
        usedBy: mergeUsageReference(existing?.usedBy ?? [], usageReference),
      });
    }
  }

  return [...requirements.values()]
    .map((requirement) => {
      const envVars = requirement.envVarNames.map((envVarName) =>
        buildEnvVarStatus(envVarName, input.recordsByEnvVar)
      );
      const access = buildAccessStatus(envVars);

      return {
        accessLabel: access.label,
        accessStatus: access.status,
        envVars,
        key: requirement.key,
        label: requirement.label,
        summary: requirement.summary,
        typeLabel: requirement.typeLabel,
        usedBy: requirement.usedBy,
      } satisfies DashboardToolRequirement;
    })
    .sort(compareToolRequirements);
}

export async function getDashboardToolsData(): Promise<DashboardToolsData> {
  const [recordsByEnvVar, submissions] = await Promise.all([
    getEnvironmentSecretMap(),
    listSignedSubmissionSnapshots(),
  ]);
  const aggregated = new Map<string, DashboardToolRequirement>();

  for (const submission of submissions) {
    const requirements = buildRequirementsForSubmission({
      applicationId: `HR-SUB-${submission.id}`,
      detail: {
        card: submission.dependencies.length > 0
          ? {
              dependencies: submission.dependencies,
            }
          : null,
        githubRepoFullName: submission.githubRepoFullName,
        id: submission.id,
        parsedSubmission: submission.parsedSubmission,
      },
      recordsByEnvVar,
      submissionLabel: submission.agentName,
    });

    for (const requirement of requirements) {
      const existing = aggregated.get(requirement.key);

      if (!existing) {
        aggregated.set(requirement.key, requirement);
        continue;
      }

      aggregated.set(requirement.key, {
        ...requirement,
        usedBy: [
          ...existing.usedBy,
          ...requirement.usedBy.filter(
            (candidate) =>
              !existing.usedBy.some(
                (current) =>
                  current.applicationId === candidate.applicationId &&
                  current.submissionId === candidate.submissionId
              )
          ),
        ],
      });
    }
  }

  const tools = [...aggregated.values()].sort(compareToolRequirements);
  const environmentVariableNames = Array.from(
    new Set([
      ...tools.flatMap((tool) => tool.envVars.map((envVar) => envVar.envVarName)),
      ...recordsByEnvVar.keys(),
    ])
  ).sort();

  return {
    cloudSyncAvailable: isCloudSyncAvailable(),
    cloudSyncNote: buildCloudSyncNote(),
    environmentVariables: environmentVariableNames.map((envVarName) =>
      buildEnvVarStatus(envVarName, recordsByEnvVar)
    ),
    stats: {
      configured: tools.filter((tool) => tool.accessStatus === "configured").length,
      missing: tools.filter((tool) => tool.accessStatus === "missing").length,
      noCredentialRequired: tools.filter((tool) => tool.accessStatus === "not_required").length,
      partial: tools.filter((tool) => tool.accessStatus === "partial").length,
      total: tools.length,
    },
    tools,
  };
}

export async function getDashboardSubmissionRequirementsData(
  applicationId: string
): Promise<DashboardSubmissionRequirementsData | null> {
  const application = await getHrApplicationById(applicationId);

  if (!application) {
    return null;
  }

  const submissionId = getSubmissionIdFromApplicationId(applicationId);
  const [recordsByEnvVar, submission] = await Promise.all([
    getEnvironmentSecretMap(),
    submissionId ? getSubmissionDetail(submissionId) : Promise.resolve(null),
  ]);

  const requirements = buildRequirementsForSubmission({
    applicationId,
    detail: submission
      ? {
          card: submission.card,
          githubRepoFullName: submission.githubRepoFullName,
          id: submission.id,
          parsedSubmission: submission.parsedSubmission,
        }
      : null,
    fallbackDataSources: application.dataSourcesRequired,
    recordsByEnvVar,
    submissionLabel: application.agentName,
  });

  return {
    application,
    requirements,
    submission,
  };
}

export async function saveDashboardEnvironmentSecret(input: {
  envVarName: string;
  value: string;
}) {
  const envVarName = normalizeEnvVarName(input.envVarName);
  const value = input.value.trim();

  if (!value) {
    throw new Error("Enter a value before saving.");
  }

  const encryptedValue = encryptSecretValue(value);
  let syncState: DashboardToolSyncState = "LOCAL_ONLY";
  let syncMessage =
    "Stored in the admin portal and current server environment. Google Secret Manager sync is not configured.";
  let googleSecretName: string | null = null;
  let lastSyncedAt: Date | null = null;

  try {
    const syncResult = await syncSecretToGoogleSecretManager({
      envVarName,
      value,
    });

    syncState = syncResult.syncState;
    syncMessage = syncResult.syncMessage;
    googleSecretName = syncResult.googleSecretName;
    lastSyncedAt = new Date();
  } catch (error) {
    syncState = "ERROR";
    syncMessage =
      error instanceof Error
        ? `Saved locally, but Google Secret Manager sync failed: ${error.message}`
        : "Saved locally, but Google Secret Manager sync failed.";
  }

  await ensureSubmissionSchema();
  await prisma.environmentSecret.upsert({
    where: {
      envVarName,
    },
    create: {
      encryptedValue,
      envVarName,
      googleSecretName,
      lastSyncedAt,
      syncMessage,
      syncState,
    },
    update: {
      encryptedValue,
      googleSecretName,
      lastSyncedAt,
      syncMessage,
      syncState,
    },
  });

  process.env[envVarName] = value;

  revalidatePath("/dashboard", "layout");
  revalidatePath("/dashboard/submissions");
  revalidatePath("/dashboard/tools");
}
