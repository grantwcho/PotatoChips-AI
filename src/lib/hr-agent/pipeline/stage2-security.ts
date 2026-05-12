import { runLiveSimulationEvaluation } from "@/lib/hr-agent/execution";
import type {
  AgentApplication,
  HrPipelineStageResult,
  HrPortfolioFitReport,
  HrProbationReport,
} from "@/lib/hr-agent/models/agent-application";
import { writeHrJsonArtifact, writeHrTextArtifact } from "@/lib/hr-agent/storage";

function shouldFailLiveSimulation(report: HrProbationReport) {
  return (
    report.metrics.totalSignalsGenerated === 0 ||
    (report.metrics.sharpeRatio ?? -1) < 0 ||
    (report.metrics.maxDrawdownPct ?? 100) > 18 ||
    (report.metrics.netReturnPct ?? -100) < -3
  );
}

export async function runSecurityStage(
  application: AgentApplication
): Promise<{
  result: HrPipelineStageResult;
  portfolioFitReport: HrPortfolioFitReport;
  probationReport: HrProbationReport;
}> {
  const now = new Date().toISOString();
  const evaluation = await runLiveSimulationEvaluation(application);
  const portfolioFitArtifactPath = await writeHrJsonArtifact(
    `portfolio-fit/${application.id}/portfolio-fit.json`,
    evaluation.portfolioFitReport
  );
  const liveSimulationArtifactPath = await writeHrJsonArtifact(
    `simulation/${application.id}/recent-month-summary.json`,
    {
      wrappedModel: evaluation.wrappedModel,
      simulationWindow: evaluation.simulationWindow,
      metrics: evaluation.probationReport.metrics,
    }
  );
  const divergenceArtifactPath = await writeHrTextArtifact(
    `simulation/${application.id}/divergence-notes.md`,
    evaluation.probationReport.divergenceNotes.map((line) => `- ${line}`).join("\n")
  );
  const failed = shouldFailLiveSimulation(evaluation.probationReport);

  return {
    result: {
      stageKey: "stage2-security",
      state: failed ? "failed" : "pending",
      startedAt: now,
      completedAt: null,
      summary:
        "Completed the one-month live simulation, compared the candidate against the house sleeves, and prepared onboarding evidence.",
      failureReason: failed
        ? "One-month live simulation was too weak to justify continuing toward onboarding."
        : null,
      artifacts: [
        portfolioFitArtifactPath,
        liveSimulationArtifactPath,
        divergenceArtifactPath,
        ...evaluation.artifactPaths,
      ],
    },
    portfolioFitReport: evaluation.portfolioFitReport,
    probationReport: evaluation.probationReport,
  };
}

export async function runStaticSecurityAnalysis(application: AgentApplication) {
  const { probationReport, portfolioFitReport } = await runSecurityStage(application);
  return {
    applicationId: application.id,
    blockingFindings:
      shouldFailLiveSimulation(probationReport)
        ? [
            `live-simulation: sharpe=${probationReport.metrics.sharpeRatio ?? "n/a"}`,
            `live-simulation: maxDrawdown=${probationReport.metrics.maxDrawdownPct ?? "n/a"}`,
          ]
        : [],
    warnings: [
      `overlap=${portfolioFitReport.overlapScore ?? "n/a"}`,
      `marginalSharpeDelta=${portfolioFitReport.marginalSharpeDelta ?? "n/a"}`,
    ],
  };
}
