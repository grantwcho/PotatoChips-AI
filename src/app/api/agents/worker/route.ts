import { isAgentSwarmDecommissioned } from "@/lib/agents/decommission";
import { runPaperCycle } from "@/lib/agents/runtime";
import {
  getWorkerSecretConfigError,
  isAuthorizedWorkerRequest,
} from "@/lib/agents/worker-auth";
import { enqueueNextWorkerRun } from "@/lib/agents/worker-queue";

type PubsubPushEnvelope = {
  message?: {
    data?: string;
    messageId?: string;
    publishTime?: string;
  };
  subscription?: string;
};

function decodePubsubPayload(value: string | undefined) {
  if (!value) {
    return null;
  }

  try {
    const decoded = Buffer.from(value, "base64").toString("utf8").trim();

    if (!decoded) {
      return null;
    }

    try {
      return JSON.parse(decoded) as Record<string, unknown>;
    } catch {
      return { raw: decoded };
    }
  } catch {
    return null;
  }
}

async function parseRequestMetadata(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";

  if (!contentType.includes("application/json")) {
    return {
      trigger: "direct" as const,
      pubsubEnvelope: null as PubsubPushEnvelope | null,
      payload: null as Record<string, unknown> | null,
    };
  }

  try {
    const body = (await request.json()) as Record<string, unknown> | PubsubPushEnvelope;

    if (body && typeof body === "object" && "message" in body) {
      const envelope = body as PubsubPushEnvelope;

      return {
        trigger: "pubsub" as const,
        pubsubEnvelope: envelope,
        payload: decodePubsubPayload(envelope.message?.data),
      };
    }

    return {
      trigger: "direct" as const,
      pubsubEnvelope: null,
      payload: body as Record<string, unknown>,
    };
  } catch {
    return {
      trigger: "direct" as const,
      pubsubEnvelope: null,
      payload: null,
    };
  }
}

type WorkerRequestMetadata = Awaited<ReturnType<typeof parseRequestMetadata>>;
type WorkerFollowUp = Awaited<ReturnType<typeof enqueueNextWorkerRun>>;

function followUpKeepsLoopAlive(followUp: WorkerFollowUp | null) {
  return followUp?.status === "enqueued" || followUp?.status === "duplicate";
}

async function scheduleRecoveryWorkerRun(
  request: Request,
  metadata: WorkerRequestMetadata,
  errorMessage: string
) {
  try {
    return await enqueueNextWorkerRun(request, {
      source: "agent-worker-recovery",
      trigger: metadata.trigger,
      recoveryReason: errorMessage,
      recoveryRequestedAt: new Date().toISOString(),
      pubsubMessageId: metadata.pubsubEnvelope?.message?.messageId ?? null,
    });
  } catch (enqueueError) {
    console.error("Agent worker recovery enqueue failed", enqueueError);
    return null;
  }
}

export async function POST(request: Request) {
  if (isAgentSwarmDecommissioned()) {
    return Response.json(
      {
        ok: true,
        disabled: true,
        message: "Legacy agent swarm is decommissioned.",
      },
      { status: 200 }
    );
  }

  const configError = getWorkerSecretConfigError();

  if (configError) {
    return Response.json({ error: configError }, { status: 503 });
  }

  if (!isAuthorizedWorkerRequest(request)) {
    return Response.json(
      { error: "Unauthorized worker request." },
      { status: 401 }
    );
  }

  const metadata = await parseRequestMetadata(request);

  try {
    const result = await runPaperCycle();
    const followUp = await enqueueNextWorkerRun(request, {
      source: "agent-worker",
      previousCycleId: result.cycle.id,
      previousCycleCompletedAt: result.cycle.completedAt,
      trigger: metadata.trigger,
    });

    return Response.json({
      ok: true,
      trigger: metadata.trigger,
      pubsubMessageId: metadata.pubsubEnvelope?.message?.messageId ?? null,
      payload: metadata.payload,
      followUp,
      result,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to run research cycle.";
    console.error("Agent worker run failed", error);
    const followUp = await scheduleRecoveryWorkerRun(request, metadata, message);
    const status = followUpKeepsLoopAlive(followUp) ? 200 : 500;

    return Response.json(
      {
        ok: false,
        error: message,
        trigger: metadata.trigger,
        pubsubMessageId: metadata.pubsubEnvelope?.message?.messageId ?? null,
        payload: metadata.payload,
        followUp,
      },
      { status }
    );
  }
}
