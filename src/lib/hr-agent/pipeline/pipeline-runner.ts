import type {
  AgentApplication,
  HrPipelineStageKey,
} from "@/lib/hr-agent/models/agent-application";
import { runConformanceStage } from "@/lib/hr-agent/pipeline/stage3-conformance";
import { runSandboxEvaluation } from "@/lib/hr-agent/execution";
import { runQuarantineStage } from "@/lib/hr-agent/pipeline/stage1-quarantine";
import { runSecurityStage } from "@/lib/hr-agent/pipeline/stage2-security";

export async function runPipelineStage(
  application: AgentApplication,
  stageKey: HrPipelineStageKey
) {
  if (application.protected) {
    throw new Error("Protected default agents cannot be modified by AI HR.");
  }

  if (stageKey === "stage1-quarantine") {
    const { result, intakeReport } = await runQuarantineStage(application);
    const sandboxEvaluation = await runSandboxEvaluation({
      ...application,
      intakeReport,
    });
    const blocked =
      intakeReport.security.flaggedDependencies.length > 0 ||
      intakeReport.security.suspiciousPatterns.length > 0 ||
      intakeReport.security.networkCallAttempts.length > 0 ||
      intakeReport.security.syscallFindings.length > 0 ||
      intakeReport.security.hardcodedCredentialFindings.length > 0 ||
      intakeReport.security.stateIsolationFindings.length > 0 ||
      intakeReport.security.excessivePermissionRequests.length > 0 ||
      sandboxEvaluation.report.regimeResults.filter((result) => result.status === "fail").length >
        2;

    return {
      application: {
        ...application,
        intakeReport,
        sandboxReport: sandboxEvaluation.report,
      },
      stageResult: {
        ...result,
        state: blocked ? "failed" : "pending",
        summary:
          "Validated the submission package and completed the historical-replay gate across ten random windows.",
        failureReason: blocked
          ? "Historical gate failed because the intake findings or random-window replays were too weak."
          : null,
        artifacts: [...result.artifacts, ...sandboxEvaluation.artifactPaths],
      } satisfies typeof result,
    };
  }

  if (stageKey === "stage2-security") {
    const { result, portfolioFitReport, probationReport } = await runSecurityStage(application);
    return {
      application: {
        ...application,
        portfolioFitReport,
        probationReport,
      },
      stageResult: result,
    };
  }

  if (stageKey === "stage3-conformance") {
    const { result, hiringDecision, probationReport } = await runConformanceStage(application);
    return {
      application: {
        ...application,
        hiringDecision,
        probationReport,
      },
      stageResult: result,
    };
  }

  throw new Error(`Unsupported HR pipeline stage: ${stageKey}`);
}

export async function runFullPipeline(application: AgentApplication) {
  let nextApplication = application;

  for (const stage of [
    "stage1-quarantine",
    "stage2-security",
    "stage3-conformance",
  ] as const) {
    const result = await runPipelineStage(nextApplication, stage);
    nextApplication = {
      ...result.application,
      stageResults: {
        ...result.application.stageResults,
        [stage]: result.stageResult,
      },
    };
  }

  return nextApplication;
}
