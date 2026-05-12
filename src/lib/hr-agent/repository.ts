import "server-only";

import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { Pool, PoolClient } from "pg";
import type { Prisma } from "@/lib/prisma-client";
import {
  SubmissionSource,
  SubmissionStatus,
} from "@/lib/prisma-client";
import { getAlloyDbPool } from "@/lib/data/alloydb/client";
import {
  buildAcceptedRuntimePlan,
  prepareAcceptedRuntimePlan,
} from "@/lib/hr-agent/accepted-runtime";
import type { HrApplicationEvent } from "@/lib/hr-agent/models/agent-application";
import {
  AGENT_APPLICATION_TYPES,
  AGENT_APPLICATION_STATUSES,
  HR_PIPELINE_STAGES,
  PROTECTED_DEFAULT_AGENTS,
  getPipelineStageIndex,
  type AgentApplication,
  type AgentApplicationStatus,
  type AgentApplicationType,
  type AgentSubmissionInput,
  type HrAcceptedRuntimePlan,
  type HrAdversarialReport,
  type HrDocumentationProfile,
  type HrHiringDecision,
  type HrIntakeReport,
  type HrPackageType,
  type HrPerformanceMetrics,
  type HrPipelineStageKey,
  type HrPipelineStageResult,
  type HrPortfolioFitReport,
  type HrProbationReport,
  type HrSandboxReport,
  type HrSecurityReport,
  type RecruitingDashboardData,
  type SubmissionReviewStatus,
} from "@/lib/hr-agent/models/agent-application";
import { buildHrBackendStatus } from "@/lib/hr-agent/runtime-config";
import {
  ensureHrDirectory,
  fileExists,
  getHrEvidencePath,
  readHrJsonArtifact,
  writeHrJsonArtifact,
} from "@/lib/hr-agent/storage";
import { prisma } from "@/lib/prisma";
import { ensureSubmissionSchema } from "@/lib/submissions/schema";

type HumanDecisionInput = {
  applicationId: string;
  decision: "APPROVE" | "OVERRIDE";
  overrideRecommendation?: "Hire" | "Backburner" | "Reject";
  note?: string;
};

type QueryRunner = Pool | PoolClient;

type HrApplicationRow = {
  id: string;
  submitter_key: string;
  agent_name: string;
  status: string;
  current_stage: HrPipelineStageKey;
  protected: boolean;
  submitted_at: Date;
  updated_at: Date;
  application_payload: unknown;
  recent_events: unknown;
};

type HrFallbackApplicationRecord = {
  id: string;
  submitter_key: string;
  agent_name: string;
  status: string;
  current_stage: string;
  protected: boolean;
  submitted_at: string;
  updated_at: string;
  application_payload: unknown;
  recent_events: unknown;
};

type SignedSubmissionBackedApplicationRecord = Prisma.SubmissionGetPayload<{
  include: {
    attestation: true;
    card: {
      include: {
        dependencies: true;
      };
    };
    user: true;
  };
}>;

const SCHEMA_CACHE_TTL_MS = 60_000;
const HR_ALLOYDB_SCHEMA_FILES = [
  "006_hr_agent_runtime.sql",
  "007_hr_agent_pipeline_refresh.sql",
] as const;
const HR_ALLOYDB_SCHEMA_LOCK_KEY = 7_052_026_041_600;

let hrSchemaCache:
  | {
      checkedAt: number;
      available: boolean;
    }
  | null = null;
let hrSchemaEnsurePromise: Promise<void> | null = null;
let hrSchemaEnsured = false;
let hrSchemaSqlCache: string[] | null = null;

const FALLBACK_APPLICATIONS_DIR = "fallback/applications";
const FALLBACK_SUBMISSIONS_DIR = "submissions";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function asNullableString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function asNullableNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asNumber(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function getHrApplicationId() {
  return `HR-APP-${randomUUID().slice(0, 8).toUpperCase()}`;
}

export function createHrApplicationId() {
  return getHrApplicationId();
}

async function loadHrAlloyDbSchemaSql() {
  if (hrSchemaSqlCache) {
    return hrSchemaSqlCache;
  }

  hrSchemaSqlCache = await Promise.all(
    HR_ALLOYDB_SCHEMA_FILES.map((fileName) =>
      readFile(path.join(process.cwd(), "db", "alloydb", fileName), "utf8")
    )
  );

  return hrSchemaSqlCache;
}

async function applyHrAlloyDbSchema(runner: QueryRunner) {
  const statements = await loadHrAlloyDbSchemaSql();

  for (const sql of statements) {
    await runner.query(sql);
  }
}

async function ensureHrAlloyDbSchema(client?: PoolClient) {
  if (hrSchemaEnsured) {
    return;
  }

  if (client) {
    await applyHrAlloyDbSchema(client);
    hrSchemaEnsured = true;
    hrSchemaCache = {
      checkedAt: Date.now(),
      available: true,
    };
    return;
  }

  if (!hrSchemaEnsurePromise) {
    hrSchemaEnsurePromise = (async () => {
      const schemaClient = await getAlloyDbPool().connect();

      try {
        await schemaClient.query("begin");
        await schemaClient.query(
          `select pg_advisory_xact_lock(${HR_ALLOYDB_SCHEMA_LOCK_KEY}::bigint)`
        );
        await applyHrAlloyDbSchema(schemaClient);
        await schemaClient.query("commit");
        hrSchemaEnsured = true;
        hrSchemaCache = {
          checkedAt: Date.now(),
          available: true,
        };
      } catch (error) {
        await schemaClient.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        schemaClient.release();
      }
    })().catch((error) => {
      hrSchemaEnsurePromise = null;
      throw error;
    });
  }

  await hrSchemaEnsurePromise;
}

async function getRunner(client?: PoolClient): Promise<QueryRunner> {
  await ensureHrAlloyDbSchema(client);
  return client ?? getAlloyDbPool();
}

export function getHrSubmissionCooldownSeconds() {
  const configured = Number(process.env.HR_SUBMISSION_COOLDOWN_SECONDS ?? 60);
  return Number.isFinite(configured) && configured >= 0 ? configured : 60;
}

export async function isHrSchemaAvailable(client?: PoolClient) {
  const now = Date.now();

  if (hrSchemaCache && now - hrSchemaCache.checkedAt < SCHEMA_CACHE_TTL_MS) {
    return hrSchemaCache.available;
  }

  try {
    try {
      await ensureHrAlloyDbSchema(client);
    } catch {
      // Fall through to an availability probe so callers can degrade gracefully.
    }

    const runner = await getRunner(client);
    const result = await runner.query<{
      has_applications: boolean;
      has_events: boolean;
    }>(`
      select
        to_regclass('public.hr_agent_applications') is not null as has_applications,
        to_regclass('public.hr_agent_events') is not null as has_events
    `);
    const row = result.rows[0];
    const available = Boolean(row?.has_applications && row?.has_events);

    hrSchemaCache = {
      checkedAt: now,
      available,
    };

    return available;
  } catch {
    hrSchemaCache = {
      checkedAt: now,
      available: false,
    };
    return false;
  }
}

function normalizeSubmitterKey(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, "-");
}

function parseApplicationType(value: string): AgentApplicationType {
  return AGENT_APPLICATION_TYPES.includes(value as AgentApplicationType)
    ? (value as AgentApplicationType)
    : "custom";
}

function parsePackageType(value: string): HrPackageType {
  if (value === "docker-image" || value === "api-endpoint" || value === "code-archive") {
    return value;
  }

  return "code-archive";
}

function normalizeStatus(value: string): AgentApplicationStatus {
  const normalized = value.trim();
  const legacyMap: Record<string, AgentApplicationStatus> = {
    Quarantine: "Historical Replay",
    Intake: "Historical Replay",
    "Security scan": "Live Simulation",
    Sandbox: "Live Simulation",
    Conformance: "Onboarding",
    Adversarial: "Onboarding",
    "Research replay": "Onboarding",
    "Ensemble fit": "Onboarding",
    Shadow: "Onboarding",
    Probation: "Onboarding",
  };

  if (AGENT_APPLICATION_STATUSES.includes(normalized as AgentApplicationStatus)) {
    return normalized as AgentApplicationStatus;
  }

  return legacyMap[normalized] ?? "Historical Replay";
}

function normalizeStageKey(value: string | null | undefined): HrPipelineStageKey {
  if (value === "stage2-security") {
    return "stage2-security";
  }

  if (
    value === "stage3-conformance" ||
    value === "stage4-paper-sim" ||
    value === "stage5-shadow"
  ) {
    return "stage3-conformance";
  }

  return "stage1-quarantine";
}

function emptySecurityReport(summary: string): HrSecurityReport {
  return {
    flaggedDependencies: [],
    suspiciousPatterns: [],
    networkCallAttempts: [],
    syscallFindings: [],
    hardcodedCredentialFindings: [],
    obfuscationFindings: [],
    stateIsolationFindings: [],
    excessivePermissionRequests: [],
    reviewSummary: summary,
  };
}

function emptyMetrics(): HrPerformanceMetrics {
  return {
    sharpeRatio: null,
    sortinoRatio: null,
    maxDrawdownPct: null,
    averageDrawdownPct: null,
    drawdownDurationBars: null,
    winRatePct: null,
    totalSignalsGenerated: 0,
    correlationWithExistingAgents: null,
    correlationWithSp500: null,
    correlationWithRates: null,
    correlationWithVol: null,
    dailyVolatilityPct: null,
    weeklyVolatilityPct: null,
    cvar95Pct: null,
    worstDayPct: null,
    worstWeekPct: null,
    averageGrossExposurePct: null,
    peakGrossExposurePct: null,
    concentrationRiskPct: null,
    turnoverPct: null,
    transactionCostDragPct: null,
    netReturnPct: null,
    pnlSeries: [],
  };
}

function pendingDecision(): HrHiringDecision {
  return {
    recommendation: "Pending",
    reasoning:
      "AI HR is still collecting enough stage evidence to decide whether to hire, backburner, or reject this submission.",
    generatedAt: null,
    humanDecision: null,
    humanDecisionAt: null,
    humanNote: null,
  };
}

function sortApplicationsBySubmittedAt(applications: AgentApplication[]) {
  return [...applications].sort(
    (left, right) =>
      new Date(right.submittedAt).getTime() - new Date(left.submittedAt).getTime()
  );
}

function getSourceSubmissionId(application: { id: string }) {
  return application.id.startsWith("HR-SUB-")
    ? application.id.slice("HR-SUB-".length)
    : null;
}

function normalizeSubmissionReviewStatus(
  value: string | null | undefined
): SubmissionReviewStatus {
  if (
    value === "APPROVED" ||
    value === "PENDING" ||
    value === "REJECTED" ||
    value === "REMOVED"
  ) {
    return value;
  }

  return "PENDING";
}

function inferApplicationTypeFromSubmission(
  submission: SignedSubmissionBackedApplicationRecord
): AgentApplicationType {
  const normalized = submission.card?.strategyClassification.trim().toLowerCase() ?? "";

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

function buildSubmissionBackedPackageReference(
  submission: SignedSubmissionBackedApplicationRecord
) {
  const repoReference = submission.githubRepoFullName?.trim();
  const commitReference = submission.githubCommitSha?.trim();

  if (submission.source === SubmissionSource.GITHUB && repoReference) {
    return commitReference ? `${repoReference}@${commitReference}` : repoReference;
  }

  const uploadHash = submission.uploadContentHash?.trim();

  if (submission.source === SubmissionSource.UPLOAD && uploadHash) {
    return `upload:${uploadHash.slice(0, 16)}`;
  }

  return `submission:${submission.id}`;
}

function buildSubmissionBackedApplication(
  submission: SignedSubmissionBackedApplicationRecord
): AgentApplication {
  const applicationId = `HR-SUB-${submission.id}`;
  const submittedAt =
    submission.attestation?.agreedAt.toISOString() ??
    submission.updatedAt.toISOString();
  const submitter =
    submission.user.name?.trim() ||
    submission.user.githubLogin?.trim() ||
    submission.user.email?.trim() ||
    "Submission contributor";
  const submitterKey =
    submission.user.githubLogin?.trim() ||
    submission.user.email?.trim() ||
    submission.user.id;
  const agentName =
    submission.agentName?.trim() ||
    submission.card?.strategyClassification.trim() ||
    submission.githubRepoFullName?.split("/").filter(Boolean).at(-1) ||
    `Submission ${submission.id.slice(0, 8)}`;
  const dataSourcesRequired =
    submission.card?.dependencies
      .map((dependency) => dependency.name.trim())
      .filter(Boolean)
      .join(", ") ?? "";
  const stageResult: HrPipelineStageResult = {
    stageKey: "stage1-quarantine",
    state: "pending",
    startedAt: null,
    completedAt: null,
    summary:
      "Submission is signed and visible to admins. Automated evaluation is currently paused.",
    failureReason: null,
    artifacts: [],
  };

  return {
    id: applicationId,
    agentName,
    submitter,
    submitterKey: normalizeSubmitterKey(submitterKey),
    type: inferApplicationTypeFromSubmission(submission),
    packageType: "code-archive",
    packageReference: buildSubmissionBackedPackageReference(submission),
    documentationReference:
      submission.documentationPath?.trim() || "Repository documentation",
    submittedArtifacts: [],
    submittedAt,
    submissionReviewStatus: normalizeSubmissionReviewStatus(
      submission.publicationStatus
    ),
    updatedAt: submission.updatedAt.toISOString(),
    status: "Historical Replay",
    currentStage: "stage1-quarantine",
    protected: false,
    description: submission.description.trim(),
    claimedEdge: submission.card?.claimedEdge.trim() ?? "",
    dataSourcesRequired,
    documentationProfile: {
      assetClasses: submission.card?.assetUniverse.trim() ?? "",
      riskParameters: "",
      holdingPeriod: submission.card?.timeframe.trim() ?? "",
    },
    stageResults: {
      "stage1-quarantine": stageResult,
    },
    intakeReport: {
      ...pendingIntakeReport(),
      summary: stageResult.summary,
    },
    sandboxReport: pendingSandboxReport(),
    adversarialReport: pendingAdversarialReport(),
    portfolioFitReport: pendingPortfolioFitReport(),
    probationReport: pendingProbationReport(),
    hiringDecision: pendingDecision(),
    acceptedRuntimePlan: null,
    cooldownTracking: {
      lastSubmissionTimestamp: submittedAt,
      cooldownSeconds: getHrSubmissionCooldownSeconds(),
    },
    recentEvents: [
      {
        id: `submission-backed-${submission.id}`,
        applicationId,
        eventType: "SUBMITTED",
        stageKey: "stage1-quarantine",
        summary:
          "Submission signed and recorded in the admin queue from the submissions database.",
        payload: {
          source: submission.source,
          submissionId: submission.id,
        },
        createdAt: submittedAt,
      },
    ],
  };
}

async function findSignedSubmissionBackedApplication(applicationId: string) {
  const submissionId = getSourceSubmissionId({ id: applicationId });

  if (!submissionId) {
    return null;
  }

  try {
    await ensureSubmissionSchema();
    const submission = await prisma.submission.findFirst({
      where: {
        id: submissionId,
        status: SubmissionStatus.SIGNED,
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

    return submission ? buildSubmissionBackedApplication(submission) : null;
  } catch (error) {
    console.warn("Unable to load submission-backed HR application.", {
      applicationId,
      error: error instanceof Error ? error.message : error,
    });
    return null;
  }
}

async function listSignedSubmissionBackedApplications(
  existingApplicationIds: Set<string>
) {
  await ensureSubmissionSchema();

  const submissions = await prisma.submission.findMany({
    where: {
      status: SubmissionStatus.SIGNED,
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
    orderBy: [
      {
        updatedAt: "desc",
      },
      {
        createdAt: "desc",
      },
    ],
  });

  return submissions
    .map(buildSubmissionBackedApplication)
    .filter((application) => !existingApplicationIds.has(application.id));
}

async function listAdminVisibleApplications(applications: AgentApplication[]) {
  const applicationsWithReviewStatuses = await attachSubmissionReviewStatuses(applications);
  const existingApplicationIds = new Set(
    applicationsWithReviewStatuses.map((application) => application.id)
  );

  try {
    const submissionBackedApplications = await listSignedSubmissionBackedApplications(
      existingApplicationIds
    );

    return sortApplicationsBySubmittedAt([
      ...applicationsWithReviewStatuses,
      ...submissionBackedApplications,
    ]);
  } catch (error) {
    console.warn("Unable to merge signed submissions into the admin queue.", {
      error: error instanceof Error ? error.message : error,
    });
    return sortApplicationsBySubmittedAt(applicationsWithReviewStatuses);
  }
}

async function attachSubmissionReviewStatuses(applications: AgentApplication[]) {
  const submissionIds = Array.from(
    new Set(
      applications
        .map((application) => getSourceSubmissionId(application))
        .filter((submissionId): submissionId is string => Boolean(submissionId))
    )
  );

  if (submissionIds.length === 0) {
    return applications;
  }

  try {
    await ensureSubmissionSchema();
    const submissions = await prisma.submission.findMany({
      select: {
        id: true,
        publicationStatus: true,
      },
      where: {
        id: {
          in: submissionIds,
        },
      },
    });
    const reviewStatusBySubmissionId = new Map(
      submissions.map((submission) => [
        submission.id,
        submission.publicationStatus as SubmissionReviewStatus,
      ])
    );

    return applications.map((application) => {
      const submissionId = getSourceSubmissionId(application);

      return {
        ...application,
        submissionReviewStatus: submissionId
          ? reviewStatusBySubmissionId.get(submissionId) ?? null
          : null,
      };
    });
  } catch (error) {
    console.warn("Unable to attach submission review statuses.", {
      error: error instanceof Error ? error.message : error,
    });
    return applications;
  }
}

function mergeRecentEvents(
  primary: HrApplicationEvent[],
  secondary: HrApplicationEvent[]
) {
  return [...primary, ...secondary]
    .filter((event, index, all) => all.findIndex((candidate) => candidate.id === event.id) === index)
    .sort(
      (left, right) =>
        new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
    )
    .slice(0, 8);
}

function pendingIntakeReport(): HrIntakeReport {
  return {
    summary:
      "Historical review has not started yet. Intake checks, execution-plan validation, and random-window replays are still pending.",
    packageFormat: "",
    workspaceRoot: null,
    executionTarget: null,
    manifestPath: null,
    dependencyDeclaration: null,
    extractedFileCount: 0,
    documentationComplete: false,
    missingDocumentation: [],
    notes: [],
    security: emptySecurityReport("Static security screening has not started yet."),
  };
}

function pendingSandboxReport(): HrSandboxReport {
  return {
    summary:
      "Historical replay review has not started yet. Ten random windows, replay scoring, and sample output checks are pending.",
    replayNotes: [],
    rawAgentOutput: "Pending sandbox execution.",
    sampleSignal: null,
    functionalTests: [],
    regimeResults: [],
    metrics: emptyMetrics(),
  };
}

function pendingAdversarialReport(): HrAdversarialReport {
  return {
    summary:
      "Onboarding review notes have not been generated yet.",
    resilienceScore: null,
    blockingIssues: [],
    tests: [],
  };
}

function pendingPortfolioFitReport(): HrPortfolioFitReport {
  return {
    summary:
      "Live simulation has not started yet. Ensemble-fit analysis, overlap, and interpretability review are pending.",
    marginalSharpeDelta: null,
    overlapScore: null,
    overlapAssessment: "Pending ensemble overlap analysis.",
    capacityAssessment: "Pending capacity analysis.",
    interpretabilityAssessment: "Pending interpretability review.",
    portfolioRole: "Pending research-lead framing.",
  };
}

function pendingProbationReport(): HrProbationReport {
  return {
    summary:
      "Live simulation has not started yet. One-month replay, divergence monitoring, and research-lead sizing are pending.",
    startingAllocationPct: 1,
    tightenedRiskLimits: [],
    probationDays: 30,
    liveDivergenceThresholdPct: 15,
    promotionCriteria: [],
    metrics: emptyMetrics(),
    comparisonRows: [],
    divergenceNotes: [],
  };
}

function normalizeSecurityReport(value: unknown): HrSecurityReport {
  const report = isRecord(value) ? value : {};

  return {
    flaggedDependencies: asStringArray(report.flaggedDependencies),
    suspiciousPatterns: asStringArray(report.suspiciousPatterns),
    networkCallAttempts: asStringArray(report.networkCallAttempts),
    syscallFindings: asStringArray(report.syscallFindings),
    hardcodedCredentialFindings: asStringArray(report.hardcodedCredentialFindings),
    obfuscationFindings: asStringArray(report.obfuscationFindings),
    stateIsolationFindings: asStringArray(report.stateIsolationFindings),
    excessivePermissionRequests: asStringArray(report.excessivePermissionRequests),
    reviewSummary: asString(
      report.reviewSummary,
      asString(report.claudeReviewSummary, "Static security screening has not started yet.")
    ),
  };
}

function normalizeDocumentationProfile(value: unknown): HrDocumentationProfile {
  const profile = isRecord(value) ? value : {};

  return {
    assetClasses: asString(profile.assetClasses),
    riskParameters: asString(profile.riskParameters),
    holdingPeriod: asString(profile.holdingPeriod),
  };
}

function normalizePerformanceMetrics(value: unknown): HrPerformanceMetrics {
  const metricsRecord = isRecord(value) ? value : {};
  const pnlSeries = Array.isArray(metricsRecord.pnlSeries)
    ? (metricsRecord.pnlSeries as HrPerformanceMetrics["pnlSeries"])
    : [];

  return {
    sharpeRatio: asNullableNumber(metricsRecord.sharpeRatio),
    sortinoRatio: asNullableNumber(metricsRecord.sortinoRatio),
    maxDrawdownPct: asNullableNumber(metricsRecord.maxDrawdownPct),
    averageDrawdownPct: asNullableNumber(metricsRecord.averageDrawdownPct),
    drawdownDurationBars: asNullableNumber(metricsRecord.drawdownDurationBars),
    winRatePct: asNullableNumber(metricsRecord.winRatePct),
    totalSignalsGenerated: asNumber(metricsRecord.totalSignalsGenerated, 0),
    correlationWithExistingAgents: asNullableNumber(
      metricsRecord.correlationWithExistingAgents
    ),
    correlationWithSp500: asNullableNumber(metricsRecord.correlationWithSp500),
    correlationWithRates: asNullableNumber(metricsRecord.correlationWithRates),
    correlationWithVol: asNullableNumber(metricsRecord.correlationWithVol),
    dailyVolatilityPct: asNullableNumber(metricsRecord.dailyVolatilityPct),
    weeklyVolatilityPct: asNullableNumber(metricsRecord.weeklyVolatilityPct),
    cvar95Pct: asNullableNumber(metricsRecord.cvar95Pct),
    worstDayPct: asNullableNumber(metricsRecord.worstDayPct),
    worstWeekPct: asNullableNumber(metricsRecord.worstWeekPct),
    averageGrossExposurePct: asNullableNumber(metricsRecord.averageGrossExposurePct),
    peakGrossExposurePct: asNullableNumber(metricsRecord.peakGrossExposurePct),
    concentrationRiskPct: asNullableNumber(metricsRecord.concentrationRiskPct),
    turnoverPct: asNullableNumber(metricsRecord.turnoverPct),
    transactionCostDragPct: asNullableNumber(metricsRecord.transactionCostDragPct),
    netReturnPct: asNullableNumber(metricsRecord.netReturnPct),
    pnlSeries,
  };
}

function normalizeIntakeReport(value: unknown, legacySecurity: unknown): HrIntakeReport {
  const report = isRecord(value) ? value : {};
  const fallback = pendingIntakeReport();
  const securityInput = isRecord(report.security) ? report.security : legacySecurity;

  return {
    summary: asString(report.summary, fallback.summary),
    packageFormat: asString(report.packageFormat),
    workspaceRoot: asNullableString(report.workspaceRoot),
    executionTarget: asNullableString(report.executionTarget),
    manifestPath: asNullableString(report.manifestPath),
    dependencyDeclaration: asNullableString(report.dependencyDeclaration),
    extractedFileCount: asNumber(report.extractedFileCount, 0),
    documentationComplete: Boolean(report.documentationComplete),
    missingDocumentation: asStringArray(report.missingDocumentation),
    notes: asStringArray(report.notes),
    security: normalizeSecurityReport(securityInput),
  };
}

function normalizeSandboxReport(value: unknown, legacyPreview: unknown, legacyMetrics: unknown): HrSandboxReport {
  const report = isRecord(value) ? value : {};
  const fallback = pendingSandboxReport();
  const sampleSignal = isRecord(report.sampleSignal)
    ? (report.sampleSignal as HrSandboxReport["sampleSignal"])
    : isRecord(legacyPreview) && isRecord(legacyPreview.translatedSignal)
      ? (legacyPreview.translatedSignal as HrSandboxReport["sampleSignal"])
      : null;

  return {
    summary: asString(report.summary, fallback.summary),
    replayNotes: asStringArray(report.replayNotes),
    rawAgentOutput: asString(
      report.rawAgentOutput,
      isRecord(legacyPreview) ? asString(legacyPreview.rawAgentOutput, fallback.rawAgentOutput) : fallback.rawAgentOutput
    ),
    sampleSignal,
    functionalTests: Array.isArray(report.functionalTests)
      ? (report.functionalTests as HrSandboxReport["functionalTests"])
      : [],
    regimeResults: Array.isArray(report.regimeResults)
      ? (report.regimeResults as HrSandboxReport["regimeResults"])
      : [],
    metrics: normalizePerformanceMetrics(isRecord(report.metrics) ? report.metrics : legacyMetrics),
  };
}

function normalizeAdversarialReport(value: unknown): HrAdversarialReport {
  const report = isRecord(value) ? value : {};
  const fallback = pendingAdversarialReport();

  return {
    summary: asString(report.summary, fallback.summary),
    resilienceScore: asNullableNumber(report.resilienceScore),
    blockingIssues: asStringArray(report.blockingIssues),
    tests: Array.isArray(report.tests)
      ? (report.tests as HrAdversarialReport["tests"])
      : [],
  };
}

function normalizePortfolioFitReport(value: unknown): HrPortfolioFitReport {
  const report = isRecord(value) ? value : {};
  const fallback = pendingPortfolioFitReport();

  return {
    summary: asString(report.summary, fallback.summary),
    marginalSharpeDelta: asNullableNumber(report.marginalSharpeDelta),
    overlapScore: asNullableNumber(report.overlapScore),
    overlapAssessment: asString(report.overlapAssessment, fallback.overlapAssessment),
    capacityAssessment: asString(report.capacityAssessment, fallback.capacityAssessment),
    interpretabilityAssessment: asString(
      report.interpretabilityAssessment,
      fallback.interpretabilityAssessment
    ),
    portfolioRole: asString(report.portfolioRole, fallback.portfolioRole),
  };
}

function normalizeProbationReport(value: unknown, legacyResults: unknown): HrProbationReport {
  const report = isRecord(value) ? value : {};
  const fallback = pendingProbationReport();
  const legacyRecord = isRecord(legacyResults) ? legacyResults : {};

  return {
    summary: asString(report.summary, fallback.summary),
    startingAllocationPct: asNumber(report.startingAllocationPct, fallback.startingAllocationPct),
    tightenedRiskLimits: asStringArray(report.tightenedRiskLimits),
    probationDays: asNumber(report.probationDays, fallback.probationDays),
    liveDivergenceThresholdPct: asNumber(
      report.liveDivergenceThresholdPct,
      fallback.liveDivergenceThresholdPct
    ),
    promotionCriteria: asStringArray(report.promotionCriteria),
    metrics: normalizePerformanceMetrics(isRecord(report.metrics) ? report.metrics : legacyRecord),
    comparisonRows: Array.isArray(report.comparisonRows)
      ? (report.comparisonRows as HrProbationReport["comparisonRows"])
      : Array.isArray(legacyRecord.comparisonRows)
        ? (legacyRecord.comparisonRows as HrProbationReport["comparisonRows"])
        : [],
    divergenceNotes: asStringArray(report.divergenceNotes),
  };
}

function normalizeHiringDecision(value: unknown): HrHiringDecision {
  const decision = isRecord(value) ? value : {};
  const recommendation = asString(decision.recommendation, "Pending");

  return {
    recommendation:
      recommendation === "Hire" ||
      recommendation === "Backburner" ||
      recommendation === "Reject"
        ? recommendation
        : "Pending",
    reasoning: asString(
      decision.reasoning,
      "AI HR is still collecting enough stage evidence to decide whether to hire, backburner, or reject this submission."
    ),
    generatedAt: asNullableString(decision.generatedAt),
    humanDecision:
      decision.humanDecision === "Approved" || decision.humanDecision === "Overridden"
        ? decision.humanDecision
        : null,
    humanDecisionAt: asNullableString(decision.humanDecisionAt),
    humanNote: asNullableString(decision.humanNote),
  };
}

function normalizeStageResults(value: unknown) {
  if (!isRecord(value)) {
    return {};
  }

  const normalized: Partial<Record<HrPipelineStageKey, HrPipelineStageResult>> = {};

  for (const [rawKey, rawResult] of Object.entries(value)) {
    if (!isRecord(rawResult)) {
      continue;
    }

    const stageKey = normalizeStageKey(rawKey);
    const nextResult = {
      stageKey,
      state:
        rawResult.state === "running" ||
        rawResult.state === "passed" ||
        rawResult.state === "failed"
          ? rawResult.state
          : "pending",
      startedAt: asNullableString(rawResult.startedAt),
      completedAt: asNullableString(rawResult.completedAt),
      summary: asString(rawResult.summary),
      failureReason: asNullableString(rawResult.failureReason),
      artifacts: asStringArray(rawResult.artifacts),
    } satisfies HrPipelineStageResult;
    const existing = normalized[stageKey];

    if (!existing) {
      normalized[stageKey] = nextResult;
      continue;
    }

    const rank = { failed: 3, passed: 2, running: 1, pending: 0 } as const;

    if (rank[nextResult.state] >= rank[existing.state]) {
      normalized[stageKey] = nextResult;
    }
  }

  return normalized;
}

function normalizeArtifacts(value: unknown) {
  return Array.isArray(value)
    ? (value as AgentApplication["submittedArtifacts"])
    : [];
}

function normalizeCooldownTracking(
  value: unknown,
  fallbackTimestamp: string
): AgentApplication["cooldownTracking"] {
  const tracking = isRecord(value) ? value : {};

  return {
    lastSubmissionTimestamp: asString(tracking.lastSubmissionTimestamp, fallbackTimestamp),
    cooldownSeconds: asNumber(
      tracking.cooldownSeconds,
      getHrSubmissionCooldownSeconds()
    ),
  };
}

function normalizeAcceptedRuntimePlan(value: unknown): HrAcceptedRuntimePlan | null {
  if (!isRecord(value)) {
    return null;
  }

  const mode =
    value.mode === "containerized-code-agent" ||
    value.mode === "containerized-api-adapter" ||
    value.mode === "provided-docker-image"
      ? value.mode
      : null;
  const strategy =
    value.strategy === "nixpacks" ||
    value.strategy === "cloud-native-buildpacks" ||
    value.strategy === "provided-docker-image"
      ? value.strategy
      : null;
  const sourcePackageType =
    value.sourcePackageType === "docker-image" ||
    value.sourcePackageType === "api-endpoint" ||
    value.sourcePackageType === "code-archive"
      ? value.sourcePackageType
      : null;
  const producedPackageType = value.producedPackageType === "docker-image" ? "docker-image" : null;
  const networkPolicy =
    value.networkPolicy === "none" || value.networkPolicy === "controlled-outbound"
      ? value.networkPolicy
      : null;
  const status = value.status === "planned" || value.status === "ready" ? value.status : null;

  if (
    !mode ||
    !strategy ||
    !sourcePackageType ||
    !producedPackageType ||
    !networkPolicy ||
    !status
  ) {
    return null;
  }

  const fallbackStrategy =
    value.fallbackStrategy === "nixpacks" || value.fallbackStrategy === "cloud-native-buildpacks"
      ? value.fallbackStrategy
      : null;

  return {
    mode,
    strategy,
    fallbackStrategy,
    sourcePackageType,
    sourceReference: asString(value.sourceReference),
    producedPackageType,
    producedArtifactReference: asNullableString(value.producedArtifactReference),
    networkPolicy,
    status,
    summary: asString(value.summary),
    generatedAt: asString(value.generatedAt),
    notes: asStringArray(value.notes),
  };
}

function normalizeEvents(value: unknown): HrApplicationEvent[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(isRecord)
    .map((event) => ({
      id: asString(event.id),
      applicationId: asString(event.applicationId),
      eventType: asString(event.eventType) as HrApplicationEvent["eventType"],
      stageKey: event.stageKey ? normalizeStageKey(asString(event.stageKey)) : null,
      summary: asString(event.summary),
      payload: isRecord(event.payload) ? event.payload : {},
      createdAt: asString(event.createdAt),
    }))
    .filter((event) => Boolean(event.id && event.applicationId && event.summary && event.createdAt));
}

function serializeApplicationPayload(application: AgentApplication) {
  return Object.fromEntries(
    Object.entries(application).filter(([key]) => key !== "recentEvents")
  ) as Omit<AgentApplication, "recentEvents">;
}

function serializeFallbackApplication(
  application: AgentApplication
): HrFallbackApplicationRecord {
  return {
    id: application.id,
    submitter_key: application.submitterKey,
    agent_name: application.agentName,
    status: application.status,
    current_stage: application.currentStage,
    protected: application.protected,
    submitted_at: application.submittedAt,
    updated_at: application.updatedAt,
    application_payload: serializeApplicationPayload(application),
    recent_events: application.recentEvents,
  };
}

function hydrateApplication(row: HrApplicationRow): AgentApplication {
  const payload = isRecord(row.application_payload) ? row.application_payload : {};
  const type = parseApplicationType(asString(payload.type, "custom"));

  return {
    id: row.id,
    agentName: row.agent_name,
    submitter: asString(payload.submitter),
    submitterKey: row.submitter_key,
    type,
    packageType: parsePackageType(asString(payload.packageType, "code-archive")),
    packageReference: asString(payload.packageReference),
    documentationReference: asString(payload.documentationReference),
    submittedArtifacts: normalizeArtifacts(payload.submittedArtifacts),
    submittedAt: row.submitted_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    status: normalizeStatus(row.status),
    currentStage: normalizeStageKey(row.current_stage),
    protected: row.protected,
    description: asString(payload.description),
    claimedEdge: asString(payload.claimedEdge),
    dataSourcesRequired: asString(payload.dataSourcesRequired),
    documentationProfile: normalizeDocumentationProfile(payload.documentationProfile),
    stageResults: normalizeStageResults(payload.stageResults),
    intakeReport: normalizeIntakeReport(payload.intakeReport, payload.securityReport),
    sandboxReport: normalizeSandboxReport(
      payload.sandboxReport,
      payload.adapterPreview,
      payload.simulationResults
    ),
    adversarialReport: normalizeAdversarialReport(payload.adversarialReport),
    portfolioFitReport: normalizePortfolioFitReport(payload.portfolioFitReport),
    probationReport: normalizeProbationReport(payload.probationReport, payload.shadowResults),
    hiringDecision: normalizeHiringDecision(payload.hiringDecision),
    acceptedRuntimePlan: normalizeAcceptedRuntimePlan(payload.acceptedRuntimePlan),
    cooldownTracking: normalizeCooldownTracking(
      payload.cooldownTracking,
      row.submitted_at.toISOString()
    ),
    recentEvents: normalizeEvents(row.recent_events),
  };
}

function hydrateFallbackApplication(record: unknown) {
  if (!isRecord(record)) {
    return null;
  }

  const submittedAt = asString(record.submitted_at);
  const updatedAt = asString(record.updated_at, submittedAt);
  const submittedDate = new Date(submittedAt);
  const updatedDate = new Date(updatedAt);

  if (
    !asString(record.id) ||
    !asString(record.agent_name) ||
    Number.isNaN(submittedDate.getTime()) ||
    Number.isNaN(updatedDate.getTime())
  ) {
    return null;
  }

  return hydrateApplication({
    id: asString(record.id),
    submitter_key: asString(record.submitter_key),
    agent_name: asString(record.agent_name),
    status: asString(record.status, "Historical Replay"),
    current_stage: normalizeStageKey(
      asString(record.current_stage, "stage1-quarantine")
    ),
    protected: Boolean(record.protected),
    submitted_at: submittedDate,
    updated_at: updatedDate,
    application_payload: record.application_payload,
    recent_events: record.recent_events,
  });
}

function getFallbackApplicationRelativePath(applicationId: string) {
  return `${FALLBACK_APPLICATIONS_DIR}/${applicationId}.json`;
}

async function readFallbackSnapshotApplication(applicationId: string) {
  const record = await readHrJsonArtifact<HrFallbackApplicationRecord>(
    getFallbackApplicationRelativePath(applicationId)
  );
  return hydrateFallbackApplication(record);
}

async function persistFallbackApplication(application: AgentApplication) {
  const existing = await readFallbackSnapshotApplication(application.id);
  const nextApplication: AgentApplication = {
    ...application,
    recentEvents: mergeRecentEvents(
      application.recentEvents,
      existing?.recentEvents ?? []
    ),
  };

  await writeHrJsonArtifact(
    getFallbackApplicationRelativePath(application.id),
    serializeFallbackApplication(nextApplication)
  );

  return nextApplication;
}

async function detectRecoveredFallbackStage(applicationId: string) {
  if (
    (await fileExists(getHrEvidencePath(`probation/${applicationId}/probation-report.json`))) ||
    (await fileExists(getHrEvidencePath(`shadow/${applicationId}/comparison.json`)))
  ) {
    return {
      status: "Onboarding" as const,
      currentStage: "stage3-conformance" as const,
    };
  }

  if (
    (await fileExists(getHrEvidencePath(`portfolio-fit/${applicationId}/portfolio-fit.json`))) ||
    (await fileExists(getHrEvidencePath(`simulation/${applicationId}/historical-replay.json`)))
  ) {
    return {
      status: "Live Simulation" as const,
      currentStage: "stage2-security" as const,
    };
  }

  if (
    (await fileExists(getHrEvidencePath(`sandbox/${applicationId}/sandbox-report.json`))) ||
    (await fileExists(getHrEvidencePath(`security/${applicationId}/static-analysis.json`)))
  ) {
    return {
      status: "Historical Replay" as const,
      currentStage: "stage1-quarantine" as const,
    };
  }

  return {
    status: "Historical Replay" as const,
    currentStage: "stage1-quarantine" as const,
  };
}

function buildRecoveredStageResults(currentStage: HrPipelineStageKey) {
  const currentIndex = getPipelineStageIndex(currentStage);

  return Object.fromEntries(
    HR_PIPELINE_STAGES.map((stage, index) => [
      stage.key,
      {
        stageKey: stage.key,
        state:
          index < currentIndex
            ? "passed"
            : index === currentIndex
              ? "pending"
              : "pending",
        startedAt: null,
        completedAt: null,
        summary:
          index < currentIndex
            ? "Recovered prior stage completion from local HR storage artifacts."
            : "Recovered application state from local HR storage artifacts.",
        failureReason: null,
        artifacts: [],
      } satisfies HrPipelineStageResult,
    ])
      .slice(0, Math.max(currentIndex + 1, 1))
  ) as Partial<Record<HrPipelineStageKey, HrPipelineStageResult>>;
}

async function recoverFallbackApplicationFromManifest(applicationId: string) {
  const manifest = await readHrJsonArtifact<Record<string, unknown>>(
    `${FALLBACK_SUBMISSIONS_DIR}/${applicationId}/manifest.json`
  );

  if (!manifest) {
    return null;
  }

  const submittedAt = asString(manifest.capturedAt, new Date().toISOString());
  const recoveredStage = await detectRecoveredFallbackStage(applicationId);
  const submittedArtifacts = Array.isArray(manifest.artifacts)
    ? manifest.artifacts
        .filter(isRecord)
        .map((artifact) => ({
          type:
            artifact.type === "documentation"
              ? ("documentation" as const)
              : ("agent-package" as const),
          name: asString(artifact.name),
          contentType: asNullableString(artifact.contentType),
          sizeBytes: asNullableNumber(artifact.sizeBytes),
        }))
        .filter((artifact) => artifact.name.length > 0)
    : [];
  const packageArtifact =
    submittedArtifacts.find((artifact) => artifact.type === "agent-package") ?? null;

  const recovered: AgentApplication = {
    id: applicationId,
    agentName:
      packageArtifact?.name && packageArtifact.name !== "agent.zip"
        ? packageArtifact.name
        : `Recovered submission ${applicationId}`,
    submitter: "Recovered local submission",
    submitterKey: `recovered-${applicationId.toLowerCase()}`,
    type: "custom",
    packageType: parsePackageType(asString(manifest.packageType, "code-archive")),
    packageReference:
      asString(manifest.packageReference) || packageArtifact?.name || applicationId,
    documentationReference: asString(manifest.documentationReference),
    submittedArtifacts,
    submittedAt,
    updatedAt: submittedAt,
    status: recoveredStage.status,
    currentStage: recoveredStage.currentStage,
    protected: false,
    description:
      "Recovered from local HR storage artifacts after the non-database recruiting fallback reset its in-memory state.",
    claimedEdge: "",
    dataSourcesRequired: "",
    documentationProfile: {
      assetClasses: "",
      riskParameters: "",
      holdingPeriod: "",
    },
    stageResults: buildRecoveredStageResults(recoveredStage.currentStage),
    intakeReport: pendingIntakeReport(),
    sandboxReport: pendingSandboxReport(),
    adversarialReport: pendingAdversarialReport(),
    portfolioFitReport: pendingPortfolioFitReport(),
    probationReport: pendingProbationReport(),
    hiringDecision: pendingDecision(),
    acceptedRuntimePlan: null,
    cooldownTracking: {
      lastSubmissionTimestamp: submittedAt,
      cooldownSeconds: getHrSubmissionCooldownSeconds(),
    },
    recentEvents: [
      {
        id: `recovered-${applicationId}`,
        applicationId,
        eventType: "SUBMITTED",
        stageKey: "stage1-quarantine",
        summary: "Recovered application from local HR storage artifacts for the historical-replay pipeline.",
        payload: {
          recovered: true,
        },
        createdAt: submittedAt,
      },
    ],
  };

  return persistFallbackApplication(recovered);
}

async function listFallbackApplications() {
  await ensureHrDirectory(getHrEvidencePath(FALLBACK_APPLICATIONS_DIR));
  const snapshotEntries = await readdir(getHrEvidencePath(FALLBACK_APPLICATIONS_DIR), {
    withFileTypes: true,
  }).catch(() => []);
  const applications = new Map<string, AgentApplication>();

  for (const entry of snapshotEntries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      continue;
    }

    const application = await readFallbackSnapshotApplication(
      entry.name.replace(/\.json$/u, "")
    );

    if (application) {
      applications.set(application.id, application);
    }
  }

  const submissionEntries = await readdir(getHrEvidencePath(FALLBACK_SUBMISSIONS_DIR), {
    withFileTypes: true,
  }).catch(() => []);

  for (const entry of submissionEntries) {
    if (!entry.isDirectory() || applications.has(entry.name)) {
      continue;
    }

    const recovered = await recoverFallbackApplicationFromManifest(entry.name);

    if (recovered) {
      applications.set(recovered.id, recovered);
    }
  }

  return sortApplicationsBySubmittedAt([...applications.values()]);
}

async function getLastFallbackSubmission(submitterKey: string) {
  const applications = await listFallbackApplications();
  return (
    applications.find((application) => application.submitterKey === submitterKey)?.submittedAt ??
    null
  );
}

async function getFallbackApplicationById(applicationId: string) {
  const snapshot = await readFallbackSnapshotApplication(applicationId);

  if (snapshot) {
    return snapshot;
  }

  return recoverFallbackApplicationFromManifest(applicationId);
}

function prependRecentEvent(application: AgentApplication, event: HrApplicationEvent) {
  return {
    ...application,
    recentEvents: mergeRecentEvents([event], application.recentEvents),
  };
}

function fallbackDashboardData(
  applications: AgentApplication[]
): RecruitingDashboardData {
  const visibleApplications = sortApplicationsBySubmittedAt(applications);

  return {
    applications: visibleApplications,
    pipelineCount: visibleApplications.length,
    protectedAgents: PROTECTED_DEFAULT_AGENTS,
    cooldownSeconds: getHrSubmissionCooldownSeconds(),
    backendStatus: buildHrBackendStatus("filesystem"),
  };
}

function durableDashboardData(
  applications: AgentApplication[]
): RecruitingDashboardData {
  const visibleApplications = sortApplicationsBySubmittedAt(applications);

  return {
    applications: visibleApplications,
    pipelineCount: visibleApplications.length,
    protectedAgents: PROTECTED_DEFAULT_AGENTS,
    cooldownSeconds: getHrSubmissionCooldownSeconds(),
    backendStatus: buildHrBackendStatus("alloydb"),
  };
}

async function listDurableApplications(client?: PoolClient) {
  const runner = await getRunner(client);
  const result = await runner.query<HrApplicationRow>(`
    select
      a.id,
      a.submitter_key,
      a.agent_name,
      a.status,
      a.current_stage,
      a.protected,
      a.submitted_at,
      a.updated_at,
      a.application_payload,
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'id', recent.id,
              'applicationId', recent.application_id,
              'eventType', recent.event_type,
              'stageKey', recent.stage_key,
              'summary', recent.summary,
              'payload', recent.payload,
              'createdAt', recent.created_at
            )
            order by recent.created_at desc
          )
          from (
            select
              e.id,
              e.application_id,
              e.event_type,
              e.stage_key,
              e.summary,
              e.payload,
              e.created_at
            from hr_agent_events e
            where e.application_id = a.id
            order by e.created_at desc
            limit 8
          ) recent
        ),
        '[]'::jsonb
      ) as recent_events
    from hr_agent_applications a
    order by a.submitted_at desc, a.id desc
  `);

  return result.rows.map(hydrateApplication);
}

async function getDurableApplicationById(
  applicationId: string,
  client?: PoolClient,
  forUpdate = false
) {
  const runner = await getRunner(client);
  const result = await runner.query<HrApplicationRow>(
    `
      select
        a.id,
        a.submitter_key,
        a.agent_name,
        a.status,
        a.current_stage,
        a.protected,
        a.submitted_at,
        a.updated_at,
        a.application_payload,
        coalesce(
          (
            select jsonb_agg(
              jsonb_build_object(
                'id', recent.id,
                'applicationId', recent.application_id,
                'eventType', recent.event_type,
                'stageKey', recent.stage_key,
                'summary', recent.summary,
                'payload', recent.payload,
                'createdAt', recent.created_at
              )
              order by recent.created_at desc
            )
            from (
              select
                e.id,
                e.application_id,
                e.event_type,
                e.stage_key,
                e.summary,
                e.payload,
                e.created_at
              from hr_agent_events e
              where e.application_id = a.id
              order by e.created_at desc
              limit 8
            ) recent
          ),
          '[]'::jsonb
        ) as recent_events
      from hr_agent_applications a
      where a.id = $1
      limit 1
      ${forUpdate ? "for update" : ""}
    `,
    [applicationId]
  );

  const row = result.rows[0];
  return row ? hydrateApplication(row) : null;
}

async function persistDurableApplication(
  application: AgentApplication,
  client?: PoolClient
) {
  const runner = await getRunner(client);
  const payload = serializeApplicationPayload(application);

  await runner.query(
    `
      insert into hr_agent_applications (
        id,
        submitter_key,
        agent_name,
        status,
        current_stage,
        protected,
        submitted_at,
        updated_at,
        application_payload
      )
      values (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7::timestamptz,
        $8::timestamptz,
        $9::jsonb
      )
      on conflict (id) do update set
        submitter_key = excluded.submitter_key,
        agent_name = excluded.agent_name,
        status = excluded.status,
        current_stage = excluded.current_stage,
        protected = excluded.protected,
        submitted_at = excluded.submitted_at,
        updated_at = excluded.updated_at,
        application_payload = excluded.application_payload
    `,
    [
      application.id,
      application.submitterKey,
      application.agentName,
      application.status,
      application.currentStage,
      application.protected,
      application.submittedAt,
      application.updatedAt,
      JSON.stringify(payload),
    ]
  );
}

export async function appendHrApplicationEvent(
  input: Omit<HrApplicationEvent, "id" | "createdAt"> & {
    createdAt?: string;
  },
  client?: PoolClient
): Promise<HrApplicationEvent> {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const event: HrApplicationEvent = {
    id: randomUUID(),
    applicationId: input.applicationId,
    eventType: input.eventType,
    stageKey: input.stageKey,
    summary: input.summary,
    payload: input.payload,
    createdAt,
  };

  if (!(await isHrSchemaAvailable(client))) {
    const application = await getFallbackApplicationById(input.applicationId);

    if (application) {
      await persistFallbackApplication(prependRecentEvent(application, event));
    }

    return event;
  }

  const runner = await getRunner(client);

  await runner.query(
    `
      insert into hr_agent_events (
        id,
        application_id,
        event_type,
        stage_key,
        summary,
        payload,
        created_at
      )
      values (
        $1::uuid,
        $2,
        $3,
        $4,
        $5,
        $6::jsonb,
        $7::timestamptz
      )
    `,
    [
      event.id,
      event.applicationId,
      event.eventType,
      event.stageKey,
      event.summary,
      JSON.stringify(event.payload),
      createdAt,
    ]
  );

  return event;
}

export async function withHrApplicationTransaction<T>(
  operation: (client: PoolClient) => Promise<T>
) {
  const client = await getAlloyDbPool().connect();

  try {
    await client.query("begin");
    const result = await operation(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

function buildNewApplication(
  input: AgentSubmissionInput,
  id: string,
  submittedAt = new Date().toISOString()
): AgentApplication {
  const type = parseApplicationType(input.type);
  const baseMetrics = emptyMetrics();

  return {
    id,
    agentName: input.agentName.trim(),
    submitter: input.submitter.trim(),
    submitterKey: normalizeSubmitterKey(input.submitterKey ?? input.submitter),
    type,
    packageType: parsePackageType(input.packageType),
    packageReference: input.packageReference.trim(),
    documentationReference: input.documentationReference.trim(),
    submittedArtifacts: input.submittedArtifacts ?? [],
    submittedAt,
    updatedAt: submittedAt,
    status: "Historical Replay",
    currentStage: "stage1-quarantine",
    protected: false,
    description: input.description.trim(),
    claimedEdge: input.claimedEdge.trim(),
    dataSourcesRequired: input.dataSourcesRequired.trim(),
    documentationProfile: {
      assetClasses: input.documentationProfile.assetClasses.trim(),
      riskParameters: input.documentationProfile.riskParameters.trim(),
      holdingPeriod: input.documentationProfile.holdingPeriod.trim(),
    },
    stageResults: {
      "stage1-quarantine": {
        stageKey: "stage1-quarantine",
        state: "pending",
        startedAt: null,
        completedAt: null,
        summary:
          "Submission accepted and recorded. Automated evaluation is currently paused.",
        failureReason: null,
        artifacts: [],
      },
    },
    intakeReport: pendingIntakeReport(),
    sandboxReport: pendingSandboxReport(),
    adversarialReport: pendingAdversarialReport(),
    portfolioFitReport: pendingPortfolioFitReport(),
    probationReport: {
      ...pendingProbationReport(),
      metrics: baseMetrics,
    },
    hiringDecision: pendingDecision(),
    acceptedRuntimePlan: null,
    cooldownTracking: {
      lastSubmissionTimestamp: submittedAt,
      cooldownSeconds: getHrSubmissionCooldownSeconds(),
    },
    recentEvents: [],
  };
}

async function getLastDurableSubmission(
  submitterKey: string,
  client?: PoolClient
): Promise<string | null> {
  const runner = await getRunner(client);
  const result = await runner.query<{ submitted_at: Date }>(
    `
      select submitted_at
      from hr_agent_applications
      where submitter_key = $1
      order by submitted_at desc
      limit 1
    `,
    [submitterKey]
  );

  return result.rows[0]?.submitted_at?.toISOString() ?? null;
}

export async function getRecruitingDashboardData(): Promise<RecruitingDashboardData> {
  if (!(await isHrSchemaAvailable())) {
    return fallbackDashboardData(
      await listAdminVisibleApplications(await listFallbackApplications())
    );
  }

  return durableDashboardData(
    await listAdminVisibleApplications(await listDurableApplications())
  );
}

export async function getRecruitingPipelineCount() {
  const data = await getRecruitingDashboardData();
  return data.pipelineCount;
}

export async function getAgentApplicationStatus(applicationId?: string) {
  const data = await getRecruitingDashboardData();
  const application = applicationId
    ? data.applications.find((item) => item.id === applicationId) ?? null
    : null;

  return {
    ...data,
    application,
  };
}

export async function createAgentApplication(
  input: AgentSubmissionInput,
  options?: {
    applicationId?: string;
    skipCooldown?: boolean;
    submittedAt?: string;
  }
) {
  const submitterKey = normalizeSubmitterKey(input.submitterKey ?? input.submitter);
  const cooldownSeconds = getHrSubmissionCooldownSeconds();
  const applicationId = options?.applicationId ?? getHrApplicationId();

  if (!(await isHrSchemaAvailable())) {
    const lastSubmission = await getLastFallbackSubmission(submitterKey);

    if (!options?.skipCooldown && lastSubmission) {
      const elapsedSeconds = (Date.now() - new Date(lastSubmission).getTime()) / 1000;

      if (elapsedSeconds < cooldownSeconds) {
        const remainingSeconds = Math.ceil(cooldownSeconds - elapsedSeconds);
        throw new Error(
          `Submission cooldown active for this submitter. Try again in ${remainingSeconds} second${remainingSeconds === 1 ? "" : "s"}.`
        );
      }
    }

    const application = buildNewApplication(
      input,
      applicationId,
      options?.submittedAt
    );
    const submittedEvent: HrApplicationEvent = {
      id: randomUUID(),
      applicationId: application.id,
      eventType: "SUBMITTED",
      stageKey: "stage1-quarantine",
      summary:
        "Application submitted and recorded in the operator queue. Automated evaluation is currently paused.",
      payload: {
        submitter: application.submitter,
        type: application.type,
      },
      createdAt: application.submittedAt,
    };
    return persistFallbackApplication(prependRecentEvent(application, submittedEvent));
  }

  return withHrApplicationTransaction(async (client) => {
    const lastSubmission = await getLastDurableSubmission(submitterKey, client);

    if (!options?.skipCooldown && lastSubmission) {
      const elapsedSeconds = (Date.now() - new Date(lastSubmission).getTime()) / 1000;

      if (elapsedSeconds < cooldownSeconds) {
        const remainingSeconds = Math.ceil(cooldownSeconds - elapsedSeconds);
        throw new Error(
          `Submission cooldown active for this submitter. Try again in ${remainingSeconds} second${remainingSeconds === 1 ? "" : "s"}.`
        );
      }
    }

    const application = buildNewApplication(
      input,
      applicationId,
      options?.submittedAt
    );
    await persistDurableApplication(application, client);

    const submittedEvent = await appendHrApplicationEvent(
      {
        applicationId: application.id,
        eventType: "SUBMITTED",
        stageKey: "stage1-quarantine",
        summary:
          "Application submitted and recorded in the operator queue. Automated evaluation is currently paused.",
        payload: {
          submitter: application.submitter,
          type: application.type,
        },
        createdAt: application.submittedAt,
      },
      client
    );

    return prependRecentEvent(application, submittedEvent);
  });
}

export async function recordHumanHiringDecision(input: HumanDecisionInput) {
  if (!(await isHrSchemaAvailable())) {
    const application = await getFallbackApplicationById(input.applicationId);

    if (!application) {
      throw new Error("Application not found.");
    }

    if (application.protected) {
      throw new Error("Protected default agents cannot be modified by AI HR.");
    }

    const recommendation =
      input.decision === "OVERRIDE"
        ? input.overrideRecommendation ?? "Reject"
        : application.hiringDecision.recommendation;

    if (recommendation === "Pending") {
      throw new Error(
        "AI HR has not produced a final hire, backburner, or reject recommendation yet."
      );
    }

    const now = new Date().toISOString();
    const nextStatus: AgentApplicationStatus =
      recommendation === "Hire"
        ? "Hired"
        : recommendation === "Backburner"
          ? "Backburner"
          : "Rejected";
    const acceptedRuntimePlan =
      recommendation === "Hire"
        ? await prepareAcceptedRuntimePlan({
            ...application,
            status: nextStatus,
            updatedAt: now,
            acceptedRuntimePlan: null,
          })
        : null;
    const nextApplication: AgentApplication = {
      ...application,
      status: nextStatus,
      updatedAt: now,
      hiringDecision: {
        ...application.hiringDecision,
        recommendation,
        humanDecision: input.decision === "OVERRIDE" ? "Overridden" : "Approved",
        humanDecisionAt: now,
        humanNote: input.note ?? null,
      },
      acceptedRuntimePlan,
    };
    const event: HrApplicationEvent = {
      id: randomUUID(),
      applicationId: nextApplication.id,
      eventType:
        input.decision === "OVERRIDE" ? "DECISION_OVERRIDDEN" : "DECISION_APPROVED",
      stageKey: nextApplication.currentStage,
      summary:
        input.decision === "OVERRIDE"
          ? `Human overrode AI HR to ${recommendation.toLowerCase()}.`
          : recommendation === "Hire"
            ? "Human approved the AI HR hire recommendation and queued the accepted runtime for Nixpacks/Buildpacks packaging."
            : `Human approved the AI HR ${recommendation.toLowerCase()} recommendation.`,
      payload: {
        recommendation,
        note: input.note ?? null,
        acceptedRuntimePlan:
          acceptedRuntimePlan === null
            ? null
            : {
                mode: acceptedRuntimePlan.mode,
                strategy: acceptedRuntimePlan.strategy,
                producedArtifactReference: acceptedRuntimePlan.producedArtifactReference,
              },
      },
      createdAt: now,
    };

    return persistFallbackApplication(prependRecentEvent(nextApplication, event));
  }

  const refreshed = await withHrApplicationTransaction(async (client) => {
    const application = await getDurableApplicationById(input.applicationId, client, true);

    if (!application) {
      throw new Error("Application not found.");
    }

    if (application.protected) {
      throw new Error("Protected default agents cannot be modified by AI HR.");
    }

    const recommendation =
      input.decision === "OVERRIDE"
        ? input.overrideRecommendation ?? "Reject"
        : application.hiringDecision.recommendation;

    if (recommendation === "Pending") {
      throw new Error(
        "AI HR has not produced a final hire, backburner, or reject recommendation yet."
      );
    }

    const now = new Date().toISOString();
    const nextStatus: AgentApplicationStatus =
      recommendation === "Hire"
        ? "Hired"
        : recommendation === "Backburner"
          ? "Backburner"
          : "Rejected";
    const acceptedRuntimePlan =
      recommendation === "Hire"
        ? buildAcceptedRuntimePlan({
            ...application,
            status: nextStatus,
            updatedAt: now,
            acceptedRuntimePlan: null,
          })
        : null;
    const nextApplication: AgentApplication = {
      ...application,
      status: nextStatus,
      updatedAt: now,
      hiringDecision: {
        ...application.hiringDecision,
        recommendation,
        humanDecision: input.decision === "OVERRIDE" ? "Overridden" : "Approved",
        humanDecisionAt: now,
        humanNote: input.note ?? null,
      },
      acceptedRuntimePlan,
    };

    await persistDurableApplication(nextApplication, client);
    await appendHrApplicationEvent(
      {
        applicationId: nextApplication.id,
        eventType:
          input.decision === "OVERRIDE"
            ? "DECISION_OVERRIDDEN"
            : "DECISION_APPROVED",
        stageKey: nextApplication.currentStage,
        summary:
          input.decision === "OVERRIDE"
            ? `Human overrode AI HR to ${recommendation.toLowerCase()}.`
            : recommendation === "Hire"
              ? "Human approved the AI HR hire recommendation and queued the accepted runtime for Nixpacks/Buildpacks packaging."
              : `Human approved the AI HR ${recommendation.toLowerCase()} recommendation.`,
        payload: {
          recommendation,
          note: input.note ?? null,
          acceptedRuntimePlan:
            acceptedRuntimePlan === null
              ? null
              : {
                  mode: acceptedRuntimePlan.mode,
                  strategy: acceptedRuntimePlan.strategy,
                  producedArtifactReference: acceptedRuntimePlan.producedArtifactReference,
                },
        },
        createdAt: now,
      },
      client
    );

    const refreshed = await getDurableApplicationById(nextApplication.id, client);

    if (!refreshed) {
      throw new Error("Application not found after updating human decision.");
    }

    return refreshed;
  });

  if (refreshed.acceptedRuntimePlan) {
    await writeHrJsonArtifact(
      `deployment/${refreshed.id}/accepted-runtime-plan.json`,
      refreshed.acceptedRuntimePlan
    );
  }

  return refreshed;
}

export async function getHrApplicationById(
  applicationId: string,
  client?: PoolClient,
  options?: {
    forUpdate?: boolean;
  }
) {
  if (!(await isHrSchemaAvailable(client))) {
    return (
      (await getFallbackApplicationById(applicationId)) ??
      findSignedSubmissionBackedApplication(applicationId)
    );
  }

  return (
    (await getDurableApplicationById(applicationId, client, options?.forUpdate ?? false)) ??
    findSignedSubmissionBackedApplication(applicationId)
  );
}

export async function saveHrApplication(
  application: AgentApplication,
  client?: PoolClient
) {
  if (!(await isHrSchemaAvailable(client))) {
    return persistFallbackApplication(application);
  }

  await persistDurableApplication(application, client);
  return application;
}
