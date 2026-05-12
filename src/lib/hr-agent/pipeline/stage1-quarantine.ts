import path from "node:path";
import {
  extractArchive,
  listArchiveEntries,
} from "@/lib/hr-agent/archive-utils";
import type {
  AgentApplication,
  HrIntakeReport,
  HrPipelineStageResult,
  HrSecurityReport,
} from "@/lib/hr-agent/models/agent-application";
import {
  inspectSubmissionExecutionPlan,
  probeSubmissionTarget,
} from "@/lib/hr-agent/execution";
import {
  collectWorkspaceFiles,
  getPersistedSubmissionArtifact,
  hashFile,
  prepareHrWorkspace,
  readTextPreview,
  resolveWorkspaceRoot,
  runHrCommand,
  writeHrJsonArtifact,
  writeHrTextArtifact,
} from "@/lib/hr-agent/storage";
import { SUBMISSION_EXECUTION_LIMITS } from "@/lib/submissions/guidelines";

const SOURCE_EXTENSIONS = new Set([
  ".cjs",
  ".js",
  ".json",
  ".jsx",
  ".mjs",
  ".py",
  ".rb",
  ".sh",
  ".ts",
  ".tsx",
]);

const NETWORK_PATTERNS: Array<[string, RegExp]> = [
  ["fetch", /\bfetch\s*\(/],
  ["axios", /\baxios\b/],
  ["http-request", /\bhttps?\.request\s*\(/],
  ["websocket", /\bWebSocket\b/],
];

const SYSCALL_PATTERNS: Array<[string, RegExp]> = [
  ["child-process", /\bchild_process\b/],
  ["spawn", /\bspawn\s*\(/],
  ["exec", /\bexec(File|Sync)?\s*\(/],
  ["fork", /\bfork\s*\(/],
];

const CREDENTIAL_PATTERNS: Array<[string, RegExp]> = [
  ["api-key", /\b(api[_-]?key|secret[_-]?key|auth[_-]?token)\b/i],
  ["private-key", /-----BEGIN (RSA|EC|DSA|OPENSSH) PRIVATE KEY-----/],
];

const OBFUSCATION_PATTERNS: Array<[string, RegExp]> = [
  ["from-char-code", /\bfromCharCode\s*\(/],
  ["large-base64", /[A-Za-z0-9+/]{120,}={0,2}/],
];

const STATE_ISOLATION_PATTERNS: Array<[string, RegExp]> = [
  ["parent-traversal", /\.\.\//],
  ["agent-state-path", /\b(hr-agent|agents\/|submissions\/|workspaces\/)\b/i],
];

const PERMISSION_PATTERNS: Array<[string, RegExp]> = [
  ["docker", /\bdocker\b/],
  ["sudo", /\bsudo\b/],
  ["chmod", /\bchmod\b/],
  ["sandbox-escape", /\bsandbox-exec\b/],
];

function shouldScanFile(relativePath: string) {
  return SOURCE_EXTENSIONS.has(path.extname(relativePath).toLowerCase());
}

function addMatches(
  target: string[],
  kind: string,
  relativePath: string,
  content: string,
  patterns: Array<[string, RegExp]>
) {
  for (const [label, pattern] of patterns) {
    if (pattern.test(content)) {
      target.push(`${kind}:${label}:${relativePath}`);
    }
  }
}

async function detectDependencyDeclaration(workspaceRoot: string) {
  for (const candidate of [
    "package-lock.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "requirements.txt",
    "poetry.lock",
    "pyproject.toml",
  ]) {
    const preview = await readTextPreview(path.join(workspaceRoot, candidate), 2_000);

    if (preview) {
      return candidate;
    }
  }

  return null;
}

async function runNpmAudit(workspaceRoot: string) {
  const packageLockPath = path.join(workspaceRoot, "package-lock.json");
  const packageJsonPath = path.join(workspaceRoot, "package.json");
  const packageJsonPreview = await readTextPreview(packageJsonPath);

  if (!packageJsonPreview) {
    return {
      findings: [] as string[],
      artifact: null as Record<string, unknown> | null,
    };
  }

  const args = ["audit", "--json"];

  if (await readTextPreview(packageLockPath)) {
    args.push("--package-lock-only");
  }

  const result = await runHrCommand({
    command: "npm",
    args,
    cwd: workspaceRoot,
    timeoutMs: 20_000,
    env: {
      ...process.env,
      npm_config_audit_level: "high",
    },
  }).catch((error) => ({
    stdout: "",
    stderr: error instanceof Error ? error.message : "npm audit failed.",
    exitCode: 1,
  }));

  const payloadText = result.stdout || result.stderr;

  if (!payloadText.trim()) {
    return {
      findings: [] as string[],
      artifact: null as Record<string, unknown> | null,
    };
  }

  try {
    const parsed = JSON.parse(payloadText) as {
      vulnerabilities?: Record<string, { severity?: string }>;
    };

    return {
      findings: Object.entries(parsed.vulnerabilities ?? {})
        .filter(([, value]) => value.severity === "high" || value.severity === "critical")
        .map(([dependency, value]) => `${dependency}:${value.severity ?? "unknown"}`),
      artifact: parsed as Record<string, unknown>,
    };
  } catch {
    return {
      findings: result.exitCode === 0 ? [] : [`npm-audit:${payloadText.trim()}`],
      artifact: {
        parseError: true,
        output: payloadText.trim(),
      },
    };
  }
}

async function runStaticSecurityScreen(workspaceRoot: string) {
  const files = (await collectWorkspaceFiles(workspaceRoot)).filter(shouldScanFile);
  const networkCallAttempts: string[] = [];
  const syscallFindings: string[] = [];
  const hardcodedCredentialFindings: string[] = [];
  const obfuscationFindings: string[] = [];
  const stateIsolationFindings: string[] = [];
  const excessivePermissionRequests: string[] = [];
  const suspiciousPatterns: string[] = [];

  for (const relativePath of files.slice(0, 500)) {
    const absolutePath = path.join(workspaceRoot, relativePath);
    const content = await readTextPreview(absolutePath, 32_000);

    if (!content) {
      continue;
    }

    addMatches(suspiciousPatterns, "pattern", relativePath, content, OBFUSCATION_PATTERNS);
    addMatches(networkCallAttempts, "network", relativePath, content, NETWORK_PATTERNS);
    addMatches(syscallFindings, "syscall", relativePath, content, SYSCALL_PATTERNS);
    addMatches(
      hardcodedCredentialFindings,
      "credential",
      relativePath,
      content,
      CREDENTIAL_PATTERNS
    );
    addMatches(obfuscationFindings, "obfuscation", relativePath, content, OBFUSCATION_PATTERNS);
    addMatches(
      stateIsolationFindings,
      "state",
      relativePath,
      content,
      STATE_ISOLATION_PATTERNS
    );
    addMatches(
      excessivePermissionRequests,
      "permission",
      relativePath,
      content,
      PERMISSION_PATTERNS
    );
  }

  const audit = await runNpmAudit(workspaceRoot);
  const report: HrSecurityReport = {
    flaggedDependencies: audit.findings,
    suspiciousPatterns,
    networkCallAttempts,
    syscallFindings,
    hardcodedCredentialFindings,
    obfuscationFindings,
    stateIsolationFindings,
    excessivePermissionRequests,
    reviewSummary: [
      `Scanned ${files.length} source files under intake quarantine.`,
      suspiciousPatterns.length
        ? `Suspicious or obfuscated patterns: ${suspiciousPatterns.length}.`
        : "No suspicious or obfuscated patterns were detected.",
      networkCallAttempts.length
        ? `Network-capable code paths: ${networkCallAttempts.length}.`
        : "No outbound network code paths were detected.",
      syscallFindings.length
        ? `Process or syscall findings: ${syscallFindings.length}.`
        : "No process-spawning or syscall-heavy code paths were detected.",
      hardcodedCredentialFindings.length
        ? `Potential hardcoded credentials: ${hardcodedCredentialFindings.length}.`
        : "No obvious hardcoded credentials were detected.",
      excessivePermissionRequests.length
        ? `Permission-escalation requests: ${excessivePermissionRequests.length}.`
        : "No obvious excessive permission requests were detected.",
      audit.findings.length
        ? `Dependency findings: ${audit.findings.join(", ")}`
        : "No high-severity npm audit findings were detected.",
    ].join(" "),
  };

  return {
    report,
    files,
    auditArtifact: audit.artifact,
  };
}

function buildDocumentationCheck(application: AgentApplication) {
  const missing: string[] = [];
  const optionalDetails: string[] = [];

  if (!application.description.trim()) {
    missing.push("strategy description");
  }

  if (application.documentationProfile.assetClasses.trim()) {
    optionalDetails.push("asset classes");
  }

  if (application.documentationProfile.riskParameters.trim()) {
    optionalDetails.push("risk parameters");
  }

  if (application.documentationProfile.holdingPeriod.trim()) {
    optionalDetails.push("holding period");
  }

  const notes =
    missing.length > 0
      ? [`Missing required documentation fields: ${missing.join(", ")}.`]
      : [
          "Developer supplied the required strategy description for intake review.",
          optionalDetails.length > 0
            ? `Optional ensemble metadata supplied: ${optionalDetails.join(", ")}.`
            : "Optional ensemble metadata was not provided at submission time.",
        ];

  return {
    missing,
    notes,
    complete: missing.length === 0,
  };
}

export async function runQuarantineStage(
  application: AgentApplication
): Promise<{
  result: HrPipelineStageResult;
  intakeReport: HrIntakeReport;
}> {
  const now = new Date().toISOString();
  const artifactPaths: string[] = [];
  const documentationCheck = buildDocumentationCheck(application);

  if (!documentationCheck.complete) {
    throw new Error(`Documentation incomplete: ${documentationCheck.missing.join(", ")}.`);
  }

  if (application.packageType === "api-endpoint" || application.packageType === "docker-image") {
    const probe = await probeSubmissionTarget(application);
    const executionPlan = await inspectSubmissionExecutionPlan(application);
    const probeArtifactPath = await writeHrJsonArtifact(
      `quarantine/${application.id}/endpoint-probe.json`,
      {
        packageType: application.packageType,
        packageReference: application.packageReference,
        ...probe,
        executionPlan,
      }
    );
    const policyArtifactPath = await writeHrJsonArtifact(
      `quarantine/${application.id}/container-policy.json`,
      {
        network: application.packageType === "docker-image" ? "none" : "controlled-outbound",
        cpuLimit: SUBMISSION_EXECUTION_LIMITS.cpuLimit,
        memoryLimit: SUBMISSION_EXECUTION_LIMITS.memoryLimit,
        timeoutMs: SUBMISSION_EXECUTION_LIMITS.timeoutMs,
        packageType: application.packageType,
      }
    );

    artifactPaths.push(probeArtifactPath, policyArtifactPath);

    return {
      result: {
        stageKey: "stage1-quarantine",
        state: "pending",
        startedAt: now,
        completedAt: null,
        summary:
          "Validated the submission target, reviewed the required documentation packet, and recorded intake metadata.",
        failureReason: null,
        artifacts: artifactPaths,
      },
      intakeReport: {
        summary:
          "Intake validated the remote submission target and verified the required strategy documentation packet.",
        packageFormat: application.packageType,
        workspaceRoot: null,
        executionTarget: executionPlan.command,
        manifestPath: null,
        dependencyDeclaration: null,
        extractedFileCount: 0,
        documentationComplete: true,
        missingDocumentation: [],
        notes: documentationCheck.notes,
        security: {
          ...emptyRemoteSecurityReport(),
          reviewSummary:
            "Remote submissions do not expose source code during intake, so static security review is limited to the submitted target metadata.",
        },
      },
    };
  }

  const uploadedArchive = await getPersistedSubmissionArtifact(application.id, "agent-package");

  if (!uploadedArchive) {
    throw new Error("Uploaded agent archive is missing from HR storage.");
  }

  const { entries, format } = await listArchiveEntries(uploadedArchive);
  const workspaceRoot = await prepareHrWorkspace(application.id, "quarantine");
  const extractedRoot = path.join(workspaceRoot, "extracted");

  await runHrCommand({
    command: "mkdir",
    args: ["-p", extractedRoot],
  });
  await extractArchive(uploadedArchive, extractedRoot);

  const resolvedRoot = await resolveWorkspaceRoot(extractedRoot);
  const workspaceFiles = await collectWorkspaceFiles(resolvedRoot);

  if (workspaceFiles.length === 0) {
    throw new Error("Uploaded archive extracted successfully but did not contain any files.");
  }

  const executionPlan = await inspectSubmissionExecutionPlan(application);
  const security = await runStaticSecurityScreen(resolvedRoot);
  const dependencyDeclaration = await detectDependencyDeclaration(resolvedRoot);
  const packageJsonPreview = await readTextPreview(path.join(resolvedRoot, "package.json"));
  const manifestCandidate = workspaceFiles.find((file) =>
    [
      "potato-chips-ai-agent.json",
      "potato-chips-ai.json",
      "gpt-capital-agent.json",
      "gpt-capital.json",
      "agent.json",
    ].includes(path.basename(file))
  );
  const intakeArtifactPath = await writeHrJsonArtifact(
    `quarantine/${application.id}/intake.json`,
    {
      applicationId: application.id,
      archiveFile: path.basename(uploadedArchive),
      format,
      sha256: await hashFile(uploadedArchive),
      entryCount: entries.length,
      extractedFileCount: workspaceFiles.length,
      workspaceRoot: resolvedRoot,
      topLevelEntries: entries.slice(0, 50),
      executionPlan,
      dependencyDeclaration,
      documentationCheck,
    }
  );
  const policyArtifactPath = await writeHrJsonArtifact(
    `quarantine/${application.id}/container-policy.json`,
    {
      network: "sandbox-exec denied outbound networking",
      cpuLimit: SUBMISSION_EXECUTION_LIMITS.cpuLimit,
      memoryLimit: SUBMISSION_EXECUTION_LIMITS.memoryLimit,
      timeoutMs: SUBMISSION_EXECUTION_LIMITS.timeoutMs,
      executionHost: "local",
    }
  );
  const manifestArtifactPath = await writeHrJsonArtifact(
    `quarantine/${application.id}/workspace-manifest.json`,
    {
      workspaceRoot: resolvedRoot,
      files: workspaceFiles.slice(0, 500),
      packageJsonPreview,
      manifestCandidate,
    }
  );
  const securityArtifactPath = await writeHrJsonArtifact(
    `quarantine/${application.id}/security-screen.json`,
    {
      workspaceRoot: resolvedRoot,
      scannedFiles: security.files,
      report: security.report,
      dependencyAudit: security.auditArtifact,
    }
  );
  const intakeSummaryArtifact = await writeHrTextArtifact(
    `quarantine/${application.id}/intake-summary.md`,
    [
      `- Execution target: ${executionPlan.command}`,
      `- Workspace root: ${resolvedRoot}`,
      `- Dependency declaration: ${dependencyDeclaration ?? "missing"}`,
      `- Documentation complete: yes`,
      `- Static security summary: ${security.report.reviewSummary}`,
    ].join("\n")
  );

  artifactPaths.push(
    intakeArtifactPath,
    policyArtifactPath,
    manifestArtifactPath,
    securityArtifactPath,
    intakeSummaryArtifact
  );

  return {
    result: {
      stageKey: "stage1-quarantine",
      state: "pending",
      startedAt: now,
      completedAt: null,
      summary:
        "Intake accepted the archive, verified structural compliance, reviewed documentation, and completed static security screening.",
      failureReason: null,
      artifacts: artifactPaths,
    },
    intakeReport: {
      summary:
        "Verified structural compliance, documentation completeness, quarantine extraction, and static security posture before sandbox replay.",
      packageFormat: format,
      workspaceRoot: resolvedRoot,
      executionTarget: executionPlan.command,
      manifestPath: manifestCandidate ?? null,
      dependencyDeclaration,
      extractedFileCount: workspaceFiles.length,
      documentationComplete: documentationCheck.complete,
      missingDocumentation: documentationCheck.missing,
      notes: [
        ...documentationCheck.notes,
        `Detected ${workspaceFiles.length} extracted files in quarantine.`,
      ],
      security: security.report,
    },
  };
}

function emptyRemoteSecurityReport(): HrSecurityReport {
  return {
    flaggedDependencies: [],
    suspiciousPatterns: [],
    networkCallAttempts: [],
    syscallFindings: [],
    hardcodedCredentialFindings: [],
    obfuscationFindings: [],
    stateIsolationFindings: [],
    excessivePermissionRequests: [],
    reviewSummary: "",
  };
}

export async function buildQuarantinePlan(application: AgentApplication) {
  return {
    applicationId: application.id,
    packageType: application.packageType,
    network: application.packageType === "api-endpoint" ? "controlled-outbound" : "none",
    cpuLimit: SUBMISSION_EXECUTION_LIMITS.cpuLimit,
    memoryLimit: SUBMISSION_EXECUTION_LIMITS.memoryLimit,
    timeoutMs: SUBMISSION_EXECUTION_LIMITS.timeoutMs,
  };
}
