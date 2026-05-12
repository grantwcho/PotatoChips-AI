import "server-only";

import type { PoolClient } from "pg";
import { synthesizeHiringDecisionWithClaude } from "@/lib/hr-agent/evaluation/hiring-decision";
import {
  HR_PIPELINE_STAGES,
  isFinalApplicationStatus,
  type AgentApplication,
  type AgentApplicationStatus,
  type HrApplicationEvent,
  type HrPipelineStageKey,
  type HrPipelineStageResult,
} from "@/lib/hr-agent/models/agent-application";
import { runPipelineStage } from "@/lib/hr-agent/pipeline/pipeline-runner";
import {
  appendHrApplicationEvent,
  getHrApplicationById,
  isHrSchemaAvailable,
  saveHrApplication,
  withHrApplicationTransaction,
} from "@/lib/hr-agent/repository";

const NEXT_STATUS_BY_STAGE: Record<HrPipelineStageKey, AgentApplicationStatus> = {
  "stage1-quarantine": "Live Simulation",
  "stage2-security": "Onboarding",
  "stage3-conformance": "Onboarding",
};

function getStageLabel(stageKey: HrPipelineStageKey) {
  return (
    HR_PIPELINE_STAGES.find((stage) => stage.key === stageKey)?.label ?? stageKey
  );
}

function getNextStage(stageKey: HrPipelineStageKey): HrPipelineStageKey | null {
  const index = HR_PIPELINE_STAGES.findIndex((stage) => stage.key === stageKey);

  if (index === -1 || index === HR_PIPELINE_STAGES.length - 1) {
    return null;
  }

  return HR_PIPELINE_STAGES[index + 1]?.key ?? null;
}

function statusForRecommendation(
  recommendation: AgentApplication["hiringDecision"]["recommendation"]
): AgentApplicationStatus {
  if (recommendation === "Hire") {
    return "Onboarding";
  }

  if (recommendation === "Backburner") {
    return "Backburner";
  }

  return "Rejected";
}

function buildRunningStageResult(
  application: AgentApplication,
  stageKey: HrPipelineStageKey,
  startedAt: string
): HrPipelineStageResult {
  const existing = application.stageResults[stageKey];

  return {
    stageKey,
    state: "running",
    startedAt,
    completedAt: null,
    summary:
      existing?.summary ||
      `${getStageLabel(stageKey)} is now running in the backend worker.`,
    failureReason: null,
    artifacts: existing?.artifacts ?? [],
  };
}

function buildCompletedStageResult(
  result: HrPipelineStageResult,
  startedAt: string,
  completedAt: string
): HrPipelineStageResult {
  return {
    ...result,
    state: "passed",
    startedAt,
    completedAt,
    failureReason: null,
  };
}

function buildFailedStageResult(
  application: AgentApplication,
  stageKey: HrPipelineStageKey,
  startedAt: string,
  completedAt: string,
  failureReason: string
): HrPipelineStageResult {
  const existing = application.stageResults[stageKey];

  return {
    stageKey,
    state: "failed",
    startedAt,
    completedAt,
    summary: `${getStageLabel(stageKey)} failed in the backend worker.`,
    failureReason,
    artifacts: existing?.artifacts ?? [],
  };
}

async function appendEventAndRefresh(
  applicationId: string,
  event: Omit<HrApplicationEvent, "id" | "createdAt"> & {
    createdAt?: string;
  }
) {
  await appendHrApplicationEvent(event);
  return getHrApplicationById(applicationId);
}

async function runHrPipelineStageTaskInternal(
  applicationId: string,
  stageKey: HrPipelineStageKey,
  client?: PoolClient
) {
  const application = await getHrApplicationById(applicationId, client, {
    forUpdate: Boolean(client),
  });

  if (!application) {
    throw new Error("Application not found.");
  }

  if (application.protected) {
    throw new Error("Protected default agents cannot be modified by AI HR.");
  }

  if (isFinalApplicationStatus(application.status)) {
    return {
      application,
      nextStage: null,
      outcome: "noop" as const,
    };
  }

  if (application.currentStage !== stageKey) {
    return {
      application,
      nextStage: null,
      outcome: "noop" as const,
    };
  }

  const startedAt =
    application.stageResults[stageKey]?.startedAt ?? new Date().toISOString();
  const runningApplication: AgentApplication = {
    ...application,
    updatedAt: startedAt,
    stageResults: {
      ...application.stageResults,
      [stageKey]: buildRunningStageResult(application, stageKey, startedAt),
    },
  };

  await saveHrApplication(runningApplication, client);
  await appendHrApplicationEvent(
    {
      applicationId,
      eventType: "STAGE_STARTED",
      stageKey,
      summary: `${getStageLabel(stageKey)} started in the backend worker.`,
      payload: {},
      createdAt: startedAt,
    },
    client
  );

  try {
    const stageRun = await runPipelineStage(runningApplication, stageKey);
    const completedAt = new Date().toISOString();
    const stageFailed = stageRun.stageResult.state === "failed";

    if (stageFailed) {
      const failureReason =
        stageRun.stageResult.failureReason ??
        `${getStageLabel(stageKey)} could not complete.`;
      const rejectedApplication: AgentApplication = {
        ...stageRun.application,
        status: "Rejected",
        updatedAt: completedAt,
        stageResults: {
          ...stageRun.application.stageResults,
          [stageKey]: buildFailedStageResult(
            stageRun.application,
            stageKey,
            startedAt,
            completedAt,
            failureReason
          ),
        },
        hiringDecision: {
          recommendation: "Reject",
          reasoning: `AI HR rejected the candidate because ${failureReason}`,
          generatedAt: completedAt,
          humanDecision: null,
          humanDecisionAt: null,
          humanNote: null,
        },
      };

      await saveHrApplication(rejectedApplication, client);
      await appendHrApplicationEvent(
        {
          applicationId,
          eventType: "STAGE_FAILED",
          stageKey,
          summary: `${getStageLabel(stageKey)} failed.`,
          payload: {
            failureReason,
          },
          createdAt: completedAt,
        },
        client
      );
      await appendHrApplicationEvent(
        {
          applicationId,
          eventType: "DECISION_READY",
          stageKey,
          summary: "AI HR produced a reject recommendation.",
          payload: {
            recommendation: "Reject",
          },
          createdAt: completedAt,
        },
        client
      );

      const refreshed = await getHrApplicationById(applicationId, client);

      return {
        application: refreshed ?? rejectedApplication,
        nextStage: null,
        outcome: "failed" as const,
      };
    }

    const completedStageResult = buildCompletedStageResult(
      stageRun.stageResult,
      startedAt,
      completedAt
    );
    const nextStage = getNextStage(stageKey);
    let nextApplication: AgentApplication = {
      ...stageRun.application,
      updatedAt: completedAt,
      stageResults: {
        ...stageRun.application.stageResults,
        [stageKey]: completedStageResult,
      },
    };

    if (!nextStage) {
      const hiringDecision =
        nextApplication.hiringDecision.recommendation !== "Pending"
          ? nextApplication.hiringDecision
          : await synthesizeHiringDecisionWithClaude(nextApplication);
      nextApplication = {
        ...nextApplication,
        status: statusForRecommendation(hiringDecision.recommendation),
        currentStage: stageKey,
        hiringDecision,
      };
    } else {
      nextApplication = {
        ...nextApplication,
        status: NEXT_STATUS_BY_STAGE[stageKey],
        currentStage: nextStage,
        stageResults: {
          ...nextApplication.stageResults,
          [nextStage]: nextApplication.stageResults[nextStage] ?? {
            stageKey: nextStage,
            state: "pending",
            startedAt: null,
            completedAt: null,
            summary: `${getStageLabel(nextStage)} is queued behind the current stage.`,
            failureReason: null,
            artifacts: [],
          },
        },
      };
    }

    await saveHrApplication(nextApplication, client);
    await appendHrApplicationEvent(
      {
        applicationId,
        eventType: "STAGE_COMPLETED",
        stageKey,
        summary: `${getStageLabel(stageKey)} completed successfully.`,
        payload: {
          nextStage,
        },
        createdAt: completedAt,
      },
      client
    );

    if (!nextStage) {
      await appendHrApplicationEvent(
        {
          applicationId,
          eventType: "DECISION_READY",
          stageKey,
          summary: `AI HR produced a ${nextApplication.hiringDecision.recommendation.toLowerCase()} recommendation.`,
          payload: {
            recommendation: nextApplication.hiringDecision.recommendation,
          },
          createdAt: completedAt,
        },
        client
      );
    }

    const refreshed = await getHrApplicationById(applicationId, client);

    return {
      application: refreshed ?? nextApplication,
      nextStage,
      outcome: "completed" as const,
    };
  } catch (error) {
    const completedAt = new Date().toISOString();
    const failureReason =
      error instanceof Error ? error.message : "Stage execution failed.";
    const failedApplication: AgentApplication = {
      ...runningApplication,
      status: "Rejected",
      updatedAt: completedAt,
      stageResults: {
        ...runningApplication.stageResults,
        [stageKey]: buildFailedStageResult(
          runningApplication,
          stageKey,
          startedAt,
          completedAt,
          failureReason
        ),
      },
      hiringDecision: {
        recommendation: "Reject",
        reasoning: `AI HR rejected the candidate because ${failureReason}`,
        generatedAt: completedAt,
        humanDecision: null,
        humanDecisionAt: null,
        humanNote: null,
      },
    };

    await saveHrApplication(failedApplication, client);
    await appendHrApplicationEvent(
      {
        applicationId,
        eventType: "STAGE_FAILED",
        stageKey,
        summary: `${getStageLabel(stageKey)} failed.`,
        payload: {
          failureReason,
        },
        createdAt: completedAt,
      },
      client
    );
    await appendHrApplicationEvent(
      {
        applicationId,
        eventType: "DECISION_READY",
        stageKey,
        summary: "AI HR produced a reject recommendation.",
        payload: {
          recommendation: "Reject",
        },
        createdAt: completedAt,
      },
      client
    );

    const refreshed = await getHrApplicationById(applicationId, client);

    return {
      application: refreshed ?? failedApplication,
      nextStage: null,
      outcome: "failed" as const,
    };
  }
}

export async function runHrPipelineStageTask(
  applicationId: string,
  stageKey: HrPipelineStageKey
) {
  if (!(await isHrSchemaAvailable())) {
    return runHrPipelineStageTaskInternal(applicationId, stageKey);
  }

  return withHrApplicationTransaction((client) =>
    runHrPipelineStageTaskInternal(applicationId, stageKey, client)
  );
}

export async function runHrPipelineInline(
  applicationId: string,
  initialStageKey: HrPipelineStageKey
) {
  let nextStage: HrPipelineStageKey | null = initialStageKey;
  let latestApplication: AgentApplication | null = null;

  while (nextStage) {
    const result = await runHrPipelineStageTask(applicationId, nextStage);
    latestApplication = result.application;
    nextStage = result.nextStage;
  }

  if (!latestApplication) {
    throw new Error("HR pipeline did not produce an application snapshot.");
  }

  return latestApplication;
}

export async function recordHrStageEnqueued(
  applicationId: string,
  stageKey: HrPipelineStageKey,
  payload: Record<string, unknown>
) {
  const event = await appendEventAndRefresh(applicationId, {
    applicationId,
    eventType: "STAGE_ENQUEUED",
    stageKey,
    summary: `${getStageLabel(stageKey)} was enqueued in Cloud Tasks.`,
    payload,
  });

  return event;
}
