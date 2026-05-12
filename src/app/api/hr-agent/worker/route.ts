import type { HrPipelineStageKey } from "@/lib/hr-agent/models/agent-application";
import { recordHrStageEnqueued, runHrPipelineStageTask } from "@/lib/hr-agent/runtime";
import {
  getHrWorkerSecretConfigError,
  isAuthorizedHrWorkerRequest,
} from "@/lib/hr-agent/worker-auth";
import { enqueueHrPipelineStage } from "@/lib/hr-agent/worker-queue";

function isStageKey(value: unknown): value is HrPipelineStageKey {
  return (
    value === "stage1-quarantine" ||
    value === "stage2-security" ||
    value === "stage3-conformance"
  );
}

async function parseWorkerRequest(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";

  if (!contentType.includes("application/json")) {
    return {
      applicationId: null,
      stageKey: null,
    };
  }

  try {
    const body = (await request.json()) as {
      applicationId?: string;
      stageKey?: string;
    };

    return {
      applicationId: typeof body.applicationId === "string" ? body.applicationId : null,
      stageKey: isStageKey(body.stageKey) ? body.stageKey : null,
    };
  } catch {
    return {
      applicationId: null,
      stageKey: null,
    };
  }
}

export async function POST(request: Request) {
  const configError = getHrWorkerSecretConfigError();

  if (configError) {
    return Response.json({ error: configError }, { status: 503 });
  }

  if (!isAuthorizedHrWorkerRequest(request)) {
    return Response.json({ error: "Unauthorized worker request." }, { status: 401 });
  }

  const { applicationId, stageKey } = await parseWorkerRequest(request);

  if (!applicationId || !stageKey) {
    return Response.json(
      { error: "applicationId and stageKey are required." },
      { status: 400 }
    );
  }

  try {
    const result = await runHrPipelineStageTask(applicationId, stageKey);
    let followUp: Awaited<ReturnType<typeof enqueueHrPipelineStage>> | null = null;

    if (result.nextStage) {
      followUp = await enqueueHrPipelineStage(request, applicationId, result.nextStage);

      if (followUp.status === "enqueued" || followUp.status === "duplicate") {
        await recordHrStageEnqueued(applicationId, result.nextStage, {
          taskName: followUp.taskName,
          scheduleTime: followUp.scheduleTime,
          delaySeconds: followUp.delaySeconds,
          enqueueStatus: followUp.status,
        });
      }
    }

    return Response.json({
      ok: true,
      applicationId,
      stageKey,
      outcome: result.outcome,
      nextStage: result.nextStage,
      followUp,
      application: result.application,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to run HR pipeline stage.";

    return Response.json(
      {
        error: message,
        applicationId,
        stageKey,
      },
      { status: 500 }
    );
  }
}
