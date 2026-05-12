import "server-only";

import path from "node:path";
import { inspectCodeArchiveWorkspace } from "@/lib/hr-agent/execution";
import {
  collectWorkspaceFiles,
  readTextPreview,
  runHrCommand,
} from "@/lib/hr-agent/storage";
import {
  SUBMISSION_EXECUTION_LIMITS,
  SUBMISSION_RESPONSE_EXAMPLE,
  SUBMISSION_RESPONSE_SCHEMA_NAME,
} from "@/lib/submissions/guidelines";
import {
  buildSubmittedAgentEnvironment,
  getRequestedEnvVarsForWorkspace,
} from "@/lib/submissions/env-reconciliation";

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

const SANDBOX_PROFILE =
  "(version 1) (deny default) (allow process*) (allow sysctl-read) (allow file-read*)";
const MEMORY_LIMIT_BYTES = 512 * 1024 * 1024;

export type SubmissionGateReport = {
  executionPlan: {
    command: string[];
    cwd: string;
    descriptor: string;
    networkPolicy: string;
  } | null;
  message: string;
  passed: boolean;
  resources: {
    durationMs: number | null;
    exitCode: number | null;
    stderrPreview: string | null;
    stdoutPreview: string | null;
    timeoutMs: number;
  } | null;
  schema: {
    errors: string[];
    outputPreview: Record<string, unknown> | null;
    requiredSchema: string;
    smokePrompt: Record<string, unknown>;
  } | null;
  security: {
    dependencyDeclaration: string | null;
    filesScanned: number;
    flaggedDependencies: string[];
    hardcodedCredentialFindings: string[];
    networkCallAttempts: string[];
    obfuscationFindings: string[];
    reviewSummary: string;
    stateIsolationFindings: string[];
    suspiciousPatterns: string[];
    syscallFindings: string[];
    excessivePermissionRequests: string[];
  };
};

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
    };
  } catch {
    return {
      findings: result.exitCode === 0 ? [] : [`npm-audit:${payloadText.trim()}`],
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

  const dependencyDeclaration = await detectDependencyDeclaration(workspaceRoot);
  const audit = await runNpmAudit(workspaceRoot);

  return {
    dependencyDeclaration,
    filesScanned: files.length,
    flaggedDependencies: audit.findings,
    hardcodedCredentialFindings,
    networkCallAttempts,
    obfuscationFindings,
    excessivePermissionRequests,
    reviewSummary: [
      `Scanned ${files.length} source files.`,
      networkCallAttempts.length
        ? `Network-capable paths detected: ${networkCallAttempts.length}.`
        : "No outbound network code paths were detected.",
      syscallFindings.length
        ? `Process-spawning findings: ${syscallFindings.length}.`
        : "No process-spawning code paths were detected.",
      hardcodedCredentialFindings.length
        ? `Potential credentials: ${hardcodedCredentialFindings.length}.`
        : "No obvious hardcoded credentials were detected.",
      obfuscationFindings.length
        ? `Obfuscation patterns: ${obfuscationFindings.length}.`
        : "No obvious obfuscation patterns were detected.",
      excessivePermissionRequests.length
        ? `Permission-escalation requests: ${excessivePermissionRequests.length}.`
        : "No excessive permission requests were detected.",
      audit.findings.length
        ? `Dependency findings: ${audit.findings.join(", ")}`
        : "No high-severity npm audit findings were detected.",
    ].join(" "),
    stateIsolationFindings,
    suspiciousPatterns,
    syscallFindings,
  };
}

function extractJsonPayload(raw: string) {
  const trimmed = raw.trim();

  if (!trimmed) {
    throw new Error("Submitted agent did not emit any JSON output.");
  }

  const attempts = [trimmed];
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");

  if (firstBrace !== -1 && lastBrace > firstBrace) {
    attempts.push(trimmed.slice(firstBrace, lastBrace + 1));
  }

  for (const attempt of attempts) {
    try {
      const parsed = JSON.parse(attempt) as unknown;

      if (Array.isArray(parsed)) {
        const firstItem = parsed[0];

        if (firstItem && typeof firstItem === "object" && !Array.isArray(firstItem)) {
          return firstItem as Record<string, unknown>;
        }
      }

      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      continue;
    }
  }

  throw new Error("Submitted agent output was not valid JSON.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unexpectedKeys(value: Record<string, unknown>, allowed: string[]) {
  return Object.keys(value).filter((key) => !allowed.includes(key));
}

function validateSubmissionResponseSchema(payload: Record<string, unknown>) {
  const errors: string[] = [];

  const status = payload.status;
  const responseType = payload.response_type;

  if (status !== "ok" && status !== "out_of_scope") {
    errors.push('`status` must be "ok" or "out_of_scope".');
  }

  if (typeof payload.lens !== "string" || !payload.lens.trim()) {
    errors.push("`lens` must be a non-empty string.");
  }

  if (
    typeof payload.as_of !== "string" ||
    !payload.as_of.trim() ||
    Number.isNaN(Date.parse(payload.as_of))
  ) {
    errors.push("`as_of` must be an ISO-8601 timestamp string.");
  }

  if (typeof payload.question !== "string" || !payload.question.trim()) {
    errors.push("`question` must be a non-empty string.");
  }

  function validateSources(sources: unknown, required: boolean) {
    if (sources === undefined) {
      if (required) {
        errors.push("`sources` must be a non-empty array.");
      }
      return;
    }

    if (!required) {
      errors.push("`sources` must be omitted for out-of-scope responses.");
      return;
    }

    if (!Array.isArray(sources) || sources.length === 0) {
      errors.push("`sources` must be a non-empty array.");
      return;
    }

    sources.forEach((source, index) => {
      if (!isRecord(source)) {
        errors.push(`Source row ${index + 1} must be an object.`);
        return;
      }

      const sourceAllowed = ["title", "url", "published_at"];
      const sourceUnexpected = unexpectedKeys(source, sourceAllowed);

      if (sourceUnexpected.length > 0) {
        errors.push(`Unexpected source row ${index + 1} fields: ${sourceUnexpected.join(", ")}`);
      }

      if (typeof source.title !== "string" || !source.title.trim()) {
        errors.push(`Source row ${index + 1} must include a non-empty \`title\`.`);
      }

      if (typeof source.url !== "string" || !/^https?:\/\//.test(source.url)) {
        errors.push(`Source row ${index + 1} must include an http(s) \`url\`.`);
      }

      if (
        source.published_at !== undefined &&
        source.published_at !== null &&
        (typeof source.published_at !== "string" || Number.isNaN(Date.parse(source.published_at)))
      ) {
        errors.push(`Source row ${index + 1} has an invalid \`published_at\` timestamp.`);
      }
    });
  }

  if (!isRecord(payload.answer)) {
    errors.push("`answer` must be an object.");
    if (status === "ok") {
      validateSources(payload.sources, true);
    } else if (status === "out_of_scope") {
      validateSources(payload.sources, false);
    }
    return errors;
  }

  if (status === "ok" && responseType === "point_estimate") {
    const topLevelAllowed = [
      "status",
      "lens",
      "as_of",
      "question",
      "response_type",
      "answer",
      "sources",
    ];
    const topLevelUnexpected = unexpectedKeys(payload, topLevelAllowed);

    if (topLevelUnexpected.length > 0) {
      errors.push(`Unexpected top-level fields: ${topLevelUnexpected.join(", ")}`);
    }

    const answerAllowed = ["summary", "metric", "value", "unit", "confidence_interval"];
    const answerUnexpected = unexpectedKeys(payload.answer, answerAllowed);

    if (answerUnexpected.length > 0) {
      errors.push(`Unexpected \`answer\` fields: ${answerUnexpected.join(", ")}`);
    }

    if (typeof payload.answer.summary !== "string" || !payload.answer.summary.trim()) {
      errors.push("`answer.summary` must be a non-empty string.");
    }

    if (typeof payload.answer.metric !== "string" || !payload.answer.metric.trim()) {
      errors.push("`answer.metric` must be a non-empty string.");
    }

    if (typeof payload.answer.value !== "number") {
      errors.push("`answer.value` must be a number.");
    }

    if (typeof payload.answer.unit !== "string" || !payload.answer.unit.trim()) {
      errors.push("`answer.unit` must be a non-empty string.");
    }

    if (!isRecord(payload.answer.confidence_interval)) {
      errors.push("`answer.confidence_interval` must be an object.");
    } else {
      const ciAllowed = ["low", "high", "confidence_level"];
      const ciUnexpected = unexpectedKeys(payload.answer.confidence_interval, ciAllowed);

      if (ciUnexpected.length > 0) {
        errors.push(`Unexpected confidence interval fields: ${ciUnexpected.join(", ")}`);
      }

      if (typeof payload.answer.confidence_interval.low !== "number") {
        errors.push("`answer.confidence_interval.low` must be a number.");
      }

      if (typeof payload.answer.confidence_interval.high !== "number") {
        errors.push("`answer.confidence_interval.high` must be a number.");
      }

      if (typeof payload.answer.confidence_interval.confidence_level !== "number") {
        errors.push("`answer.confidence_interval.confidence_level` must be a number.");
      }
    }

    validateSources(payload.sources, true);
    return errors;
  }

  if (status === "ok" && responseType === "scenario_table") {
    const topLevelAllowed = [
      "status",
      "lens",
      "as_of",
      "question",
      "response_type",
      "answer",
      "sources",
    ];
    const topLevelUnexpected = unexpectedKeys(payload, topLevelAllowed);

    if (topLevelUnexpected.length > 0) {
      errors.push(`Unexpected top-level fields: ${topLevelUnexpected.join(", ")}`);
    }

    const answerAllowed = ["summary", "scenarios"];
    const answerUnexpected = unexpectedKeys(payload.answer, answerAllowed);

    if (answerUnexpected.length > 0) {
      errors.push(`Unexpected \`answer\` fields: ${answerUnexpected.join(", ")}`);
    }

    if (typeof payload.answer.summary !== "string" || !payload.answer.summary.trim()) {
      errors.push("`answer.summary` must be a non-empty string.");
    }

    if (!Array.isArray(payload.answer.scenarios) || payload.answer.scenarios.length === 0) {
      errors.push("`answer.scenarios` must be a non-empty array.");
    } else {
      let probabilitySum = 0;

      payload.answer.scenarios.forEach((entry, index) => {
        if (!isRecord(entry)) {
          errors.push(`Scenario row ${index + 1} must be an object.`);
          return;
        }

        const scenarioAllowed = ["scenario_name", "value", "probability", "drivers"];
        const scenarioUnexpected = unexpectedKeys(entry, scenarioAllowed);

        if (scenarioUnexpected.length > 0) {
          errors.push(
            `Unexpected scenario row ${index + 1} fields: ${scenarioUnexpected.join(", ")}`
          );
        }

        if (
          typeof entry.scenario_name !== "string" ||
          !entry.scenario_name.trim()
        ) {
          errors.push(
            `Scenario row ${index + 1} is missing a non-empty \`scenario_name\` string.`
          );
        }

        if (typeof entry.value !== "number") {
          errors.push(`Scenario row ${index + 1} must include numeric \`value\`.`);
        }

        if (typeof entry.probability !== "number") {
          errors.push(`Scenario row ${index + 1} must include numeric \`probability\`.`);
        } else {
          probabilitySum += entry.probability;
        }

        if (
          !Array.isArray(entry.drivers) ||
          entry.drivers.some((driver) => typeof driver !== "string" || !driver.trim())
        ) {
          errors.push(`Scenario row ${index + 1} must include string \`drivers\`.`);
        }
      });

      if (Math.abs(probabilitySum - 1) > 0.001) {
        errors.push("`answer.scenarios` probabilities must sum to 1.0.");
      }
    }

    validateSources(payload.sources, true);
    return errors;
  }

  if (status === "ok" && responseType === "freeform") {
    const topLevelAllowed = [
      "status",
      "lens",
      "as_of",
      "question",
      "response_type",
      "answer",
      "sources",
    ];
    const topLevelUnexpected = unexpectedKeys(payload, topLevelAllowed);

    if (topLevelUnexpected.length > 0) {
      errors.push(`Unexpected top-level fields: ${topLevelUnexpected.join(", ")}`);
    }

    const answerAllowed = ["text"];
    const answerUnexpected = unexpectedKeys(payload.answer, answerAllowed);

    if (answerUnexpected.length > 0) {
      errors.push(`Unexpected \`answer\` fields: ${answerUnexpected.join(", ")}`);
    }

    if (typeof payload.answer.text !== "string" || !payload.answer.text.trim()) {
      errors.push("`answer.text` must be a non-empty string.");
    }

    validateSources(payload.sources, true);
    return errors;
  }

  if (status === "out_of_scope" && responseType === "rejection") {
    const topLevelAllowed = [
      "status",
      "lens",
      "as_of",
      "question",
      "response_type",
      "answer",
    ];
    const topLevelUnexpected = unexpectedKeys(payload, topLevelAllowed);

    if (topLevelUnexpected.length > 0) {
      errors.push(`Unexpected top-level fields: ${topLevelUnexpected.join(", ")}`);
    }

    const answerAllowed = ["out_of_scope_reason"];
    const answerUnexpected = unexpectedKeys(payload.answer, answerAllowed);

    if (answerUnexpected.length > 0) {
      errors.push(`Unexpected \`answer\` fields: ${answerUnexpected.join(", ")}`);
    }

    if (
      typeof payload.answer.out_of_scope_reason !== "string" ||
      !payload.answer.out_of_scope_reason.trim()
    ) {
      errors.push("Out-of-scope responses must include `answer.out_of_scope_reason`.");
    }

    validateSources(payload.sources, false);
    return errors;
  }

  if (status === "ok") {
    errors.push(
      '`response_type` must be "point_estimate", "scenario_table", or "freeform" when `status` is "ok".'
    );
    validateSources(payload.sources, true);
  } else if (status === "out_of_scope") {
    errors.push('`response_type` must be "rejection" when `status` is "out_of_scope".');
    validateSources(payload.sources, false);
  }

  return errors;
}

function buildSubmissionSmokePrompt() {
  return {
    as_of: "2026-08-25T19:50:00Z",
    mode: "agent_submission_check",
    question:
      "Within your lens, provide a scenario table for Nvidia Q2 data center revenue. If this request is outside your lens, return status out_of_scope with response_type rejection and a specific reason.",
    required_schema: SUBMISSION_RESPONSE_SCHEMA_NAME,
    response_example: SUBMISSION_RESPONSE_EXAMPLE,
  };
}

function buildResourceWrapper(command: string[]) {
  const cpuLimitSeconds = Math.ceil(SUBMISSION_EXECUTION_LIMITS.timeoutMs / 1000);
  const wrapperSource = `
import os
import resource
import sys

cpu_limit = ${cpuLimitSeconds}
memory_limit = ${MEMORY_LIMIT_BYTES}
resource.setrlimit(resource.RLIMIT_CPU, (cpu_limit, cpu_limit))
for limit_name in ("RLIMIT_AS", "RLIMIT_DATA"):
    try:
        limit = getattr(resource, limit_name)
        resource.setrlimit(limit, (memory_limit, memory_limit))
    except Exception:
        pass
os.execvpe(sys.argv[1], sys.argv[1:], os.environ)
  `.trim();

  return {
    args: ["-c", wrapperSource, ...command],
    command: "python3",
  };
}

function buildFailureReport(input: {
  executionPlan: SubmissionGateReport["executionPlan"];
  message: string;
  resources?: SubmissionGateReport["resources"];
  schema?: SubmissionGateReport["schema"];
  security: SubmissionGateReport["security"];
}) {
  return {
    executionPlan: input.executionPlan,
    message: input.message,
    passed: false,
    resources: input.resources ?? null,
    schema: input.schema ?? null,
    security: input.security,
  } satisfies SubmissionGateReport;
}

export async function runSubmissionGate(sourcePath: string): Promise<SubmissionGateReport> {
  const security = await runStaticSecurityScreen(sourcePath);
  const blockingSecurityFindings = [
    ...security.flaggedDependencies,
    ...security.hardcodedCredentialFindings,
    ...security.obfuscationFindings,
    ...security.stateIsolationFindings,
    ...security.excessivePermissionRequests,
  ];

  if (blockingSecurityFindings.length > 0) {
    return buildFailureReport({
      executionPlan: null,
      message:
        "Submission rejected by the sandbox gate because static screening found credential, obfuscation, dependency, or permission-escalation risks.",
      security,
    });
  }

  let plan: Awaited<ReturnType<typeof inspectCodeArchiveWorkspace>>;

  try {
    plan = await inspectCodeArchiveWorkspace(sourcePath);
  } catch (error) {
    return buildFailureReport({
      executionPlan: null,
      message: error instanceof Error ? error.message : "Unable to determine how to execute this submission.",
      security,
    });
  }

  const executionPlan = {
    command: plan.command,
    cwd: plan.cwd,
    descriptor: plan.descriptor,
    networkPolicy: SUBMISSION_EXECUTION_LIMITS.archiveNetworkPolicy,
  } satisfies NonNullable<SubmissionGateReport["executionPlan"]>;

  const smokePrompt = buildSubmissionSmokePrompt();
  const sandboxAvailable = await runHrCommand({
    command: "sandbox-exec",
    args: ["-p", "(version 1) (allow default)", "/usr/bin/true"],
    timeoutMs: 2_000,
  })
    .then(() => true)
    .catch(() => false);

  if (!sandboxAvailable) {
    return buildFailureReport({
      executionPlan,
      message:
        "Submission rejected because the evaluation host is not configured with the required sandbox runtime.",
      security,
      resources: {
        durationMs: null,
        exitCode: null,
        stderrPreview: "sandbox-exec unavailable",
        stdoutPreview: null,
        timeoutMs: SUBMISSION_EXECUTION_LIMITS.timeoutMs,
      },
      schema: {
        errors: ["Sandbox execution could not start."],
        outputPreview: null,
        requiredSchema: SUBMISSION_RESPONSE_SCHEMA_NAME,
        smokePrompt,
      },
    });
  }

  const wrappedCommand = buildResourceWrapper(plan.command);
  const startedAt = Date.now();
  const requestedEnvVars = await getRequestedEnvVarsForWorkspace(plan.cwd).catch(
    () => []
  );
  const runtimeEnv = await buildSubmittedAgentEnvironment({
    extraEnv: {
      PYTHONUNBUFFERED: "1",
    },
    requestedEnvVars,
  });

  let result: Awaited<ReturnType<typeof runHrCommand>>;

  try {
    result = await runHrCommand({
      command: "sandbox-exec",
      args: ["-p", SANDBOX_PROFILE, wrappedCommand.command, ...wrappedCommand.args],
      cwd: plan.cwd,
      stdin: `${JSON.stringify(smokePrompt)}\n`,
      timeoutMs: SUBMISSION_EXECUTION_LIMITS.timeoutMs,
      env: runtimeEnv.env,
    });
  } catch (error) {
    return buildFailureReport({
      executionPlan,
      message:
        error instanceof Error
          ? error.message.includes("timed out")
            ? `Submission rejected by the timeout/resource gate after ${SUBMISSION_EXECUTION_LIMITS.timeoutLabel}.`
            : `Sandbox smoke test failed: ${error.message}`
          : "Sandbox smoke test failed unexpectedly.",
      security,
      resources: {
        durationMs: Date.now() - startedAt,
        exitCode: null,
        stderrPreview: error instanceof Error ? error.message : "Unknown execution error.",
        stdoutPreview: null,
        timeoutMs: SUBMISSION_EXECUTION_LIMITS.timeoutMs,
      },
      schema: {
        errors: ["The smoke test did not return a schema-valid response."],
        outputPreview: null,
        requiredSchema: SUBMISSION_RESPONSE_SCHEMA_NAME,
        smokePrompt,
      },
    });
  }

  const resources = {
    durationMs: Date.now() - startedAt,
    exitCode: result.exitCode,
    stderrPreview: result.stderr.trim() || null,
    stdoutPreview: result.stdout.trim().slice(0, 2_000) || null,
    timeoutMs: SUBMISSION_EXECUTION_LIMITS.timeoutMs,
  };

  if (result.exitCode !== 0) {
    return buildFailureReport({
      executionPlan,
      message:
        "Submission rejected because the smoke-test prompt failed inside the sandbox.",
      security,
      resources,
      schema: {
        errors: ["Agent exited without returning a valid JSON response."],
        outputPreview: null,
        requiredSchema: SUBMISSION_RESPONSE_SCHEMA_NAME,
        smokePrompt,
      },
    });
  }

  let outputPreview: Record<string, unknown>;

  try {
    outputPreview = extractJsonPayload(result.stdout);
  } catch (error) {
    return buildFailureReport({
      executionPlan,
      message:
        error instanceof Error ? error.message : "Submitted agent output was not valid JSON.",
      security,
      resources,
      schema: {
        errors: ["Agent output was not valid JSON."],
        outputPreview: null,
        requiredSchema: SUBMISSION_RESPONSE_SCHEMA_NAME,
        smokePrompt,
      },
    });
  }

  const schemaErrors = validateSubmissionResponseSchema(outputPreview);

  if (schemaErrors.length > 0) {
    return buildFailureReport({
      executionPlan,
      message:
        "Submission rejected by the strict schema gate because the smoke-test response did not match the required output contract.",
      security,
      resources,
      schema: {
        errors: schemaErrors,
        outputPreview,
        requiredSchema: SUBMISSION_RESPONSE_SCHEMA_NAME,
        smokePrompt,
      },
    });
  }

  return {
    executionPlan,
    message: "Submission passed sandbox, timeout/resource, and schema gates.",
    passed: true,
    resources,
    schema: {
      errors: [],
      outputPreview,
      requiredSchema: SUBMISSION_RESPONSE_SCHEMA_NAME,
      smokePrompt,
    },
    security,
  } satisfies SubmissionGateReport;
}
