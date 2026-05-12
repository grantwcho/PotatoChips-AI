import { synthesizeHiringDecisionWithClaude } from "@/lib/hr-agent/evaluation/hiring-decision";
import type {
  AgentApplication,
  HrHiringDecision,
  HrPipelineStageResult,
  HrProbationReport,
} from "@/lib/hr-agent/models/agent-application";
import { writeHrJsonArtifact, writeHrTextArtifact } from "@/lib/hr-agent/storage";

function recommendStartingAllocationPct(
  application: AgentApplication,
  recommendation: HrHiringDecision["recommendation"]
) {
  if (recommendation !== "Hire") {
    return 0;
  }

  const metrics =
    application.probationReport.metrics.totalSignalsGenerated > 0
      ? application.probationReport.metrics
      : application.sandboxReport.metrics;
  const sharpe = metrics.sharpeRatio ?? 0;
  const overlapScore = application.portfolioFitReport.overlapScore ?? 100;
  const netReturn = metrics.netReturnPct ?? 0;
  const score = sharpe * 0.8 + Math.max(netReturn, 0) / 8 - overlapScore / 100;

  if (score >= 2) {
    return 4;
  }

  if (score >= 1.4) {
    return 3;
  }

  if (score >= 0.8) {
    return 2;
  }

  return 1;
}

function updateProbationPlan(
  application: AgentApplication,
  recommendation: HrHiringDecision["recommendation"]
): HrProbationReport {
  const startingAllocationPct = recommendStartingAllocationPct(application, recommendation);
  const baseLimits =
    application.probationReport.tightenedRiskLimits.length > 0
      ? application.probationReport.tightenedRiskLimits
      : [
          "Cap requested exposure size at 25% of the agent's stated max during onboarding.",
          "Escalate any drawdown breach to research-lead review before expanding ensemble weight.",
          "Pause scaling if live behavior drifts away from the simulated one-month baseline.",
        ];

  return {
    ...application.probationReport,
    startingAllocationPct,
    tightenedRiskLimits: [
      ...baseLimits,
      recommendation === "Backburner"
        ? "Keep the agent on the backburner until HR reruns the simulation with fresher evidence."
        : recommendation === "Hire"
          ? `Research lead recommends starting the sleeve at ${startingAllocationPct}% of ensemble weight.`
          : "Do not assign ensemble weight to rejected submissions.",
    ],
  };
}

export async function runConformanceStage(
  application: AgentApplication
): Promise<{
  result: HrPipelineStageResult;
  hiringDecision: HrHiringDecision;
  probationReport: HrProbationReport;
}> {
  const now = new Date().toISOString();
  const hiringDecision = await synthesizeHiringDecisionWithClaude(application);
  const probationReport = updateProbationPlan(application, hiringDecision.recommendation);
  const reviewArtifactPath = await writeHrJsonArtifact(
    `onboarding/${application.id}/decision.json`,
    hiringDecision
  );
  const cioMemoArtifactPath = await writeHrTextArtifact(
    `onboarding/${application.id}/research-lead-sizing.md`,
    [
      `Recommendation: ${hiringDecision.recommendation}`,
      `Starting allocation pct: ${probationReport.startingAllocationPct}`,
      `Reasoning: ${hiringDecision.reasoning}`,
    ].join("\n")
  );

  return {
    result: {
      stageKey: "stage3-conformance",
      state: "pending",
      startedAt: now,
      completedAt: null,
      summary:
        "AI HR reviewed the live-simulation evidence and the research lead prepared a starting-weight recommendation.",
      failureReason: null,
      artifacts: [reviewArtifactPath, cioMemoArtifactPath],
    },
    hiringDecision,
    probationReport,
  };
}

export async function buildConformanceAdapter(application: AgentApplication) {
  const { hiringDecision, probationReport } = await runConformanceStage(application);
  return {
    applicationId: application.id,
    targetSchema: "OnboardingReview",
    adapterStatus:
      hiringDecision.recommendation === "Reject"
        ? "blocked"
        : hiringDecision.recommendation === "Backburner"
          ? "deferred"
          : "validated",
    translatedSignal: application.sandboxReport.sampleSignal,
    startingAllocationPct: probationReport.startingAllocationPct,
  };
}
