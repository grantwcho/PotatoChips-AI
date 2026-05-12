import "server-only";

import { GoogleAuth } from "google-auth-library";
import { recordApiActivityEventSafe } from "@/lib/data/alloydb/api-activity";
import type { HrPipelineStageKey } from "@/lib/hr-agent/models/agent-application";
import {
  getHrQueueName,
  getHrStageDelaySeconds,
  getHrWorkerSecret,
} from "@/lib/hr-agent/runtime-config";

type HrStageQueueResult =
  | {
      status: "misconfigured";
      reason: string;
    }
  | {
      status: "duplicate";
      taskName: string;
      scheduleTime: string;
      delaySeconds: number;
    }
  | {
      status: "enqueued";
      taskName: string;
      scheduleTime: string;
      delaySeconds: number;
    };

const CLOUD_TASKS_SCOPE = "https://www.googleapis.com/auth/cloud-platform";

function normalizeAccessToken(
  token: string | null | undefined | { token?: string | null }
) {
  if (typeof token === "string") {
    return token;
  }

  return token?.token ?? null;
}

function getForwardedHeaderValue(request: Request, name: string) {
  const value = request.headers.get(name)?.trim();

  if (!value) {
    return null;
  }

  return value.split(",")[0]?.trim() || null;
}

function getPublicWorkerUrl(request?: Request) {
  const configuredServiceUrl = process.env.GOOGLE_CLOUD_SERVICE_URL?.trim();

  if (configuredServiceUrl) {
    return new URL("/api/hr-agent/worker", configuredServiceUrl);
  }

  if (!request) {
    return null;
  }

  const requestUrl = new URL(request.url);

  const forwardedProto =
    getForwardedHeaderValue(request, "x-forwarded-proto") ??
    requestUrl.protocol.replace(/:$/, "");
  const forwardedHost =
    getForwardedHeaderValue(request, "x-forwarded-host") ??
    getForwardedHeaderValue(request, "host") ??
    requestUrl.host;

  return new URL("/api/hr-agent/worker", `${forwardedProto}://${forwardedHost}`);
}

function buildTaskId(
  applicationId: string,
  stageKey: HrPipelineStageKey,
  scheduleTime: Date
) {
  const safeApplicationId = applicationId.toLowerCase().replace(/[^a-z0-9-]+/g, "-");
  const safeStageKey = stageKey.toLowerCase().replace(/[^a-z0-9-]+/g, "-");
  return `hr-${safeApplicationId}-${safeStageKey}-${Math.floor(scheduleTime.getTime() / 1000)}`;
}

export async function enqueueHrPipelineStage(
  request: Request | undefined,
  applicationId: string,
  stageKey: HrPipelineStageKey,
  delaySeconds = getHrStageDelaySeconds()
): Promise<HrStageQueueResult> {
  const queueName = getHrQueueName();

  if (!queueName) {
    return {
      status: "misconfigured",
      reason: "Missing CLOUD_TASKS_HR_QUEUE for the HR pipeline worker.",
    };
  }

  const workerSecret = getHrWorkerSecret();

  if (!workerSecret) {
    return {
      status: "misconfigured",
      reason: "Missing HR_AGENT_WORKER_SECRET for the HR pipeline worker.",
    };
  }

  const scheduleTime = new Date(Date.now() + delaySeconds * 1000);
  const taskName = `${queueName}/tasks/${buildTaskId(applicationId, stageKey, scheduleTime)}`;
  const workerUrl = getPublicWorkerUrl(request);

  if (!workerUrl) {
    return {
      status: "misconfigured",
      reason:
        "Missing GOOGLE_CLOUD_SERVICE_URL and no request context was available to derive the HR worker URL.",
    };
  }

  const auth = new GoogleAuth({
    scopes: [CLOUD_TASKS_SCOPE],
  });
  const client = await auth.getClient();
  const accessToken = normalizeAccessToken(await client.getAccessToken());

  if (!accessToken) {
    throw new Error("Unable to acquire a Google access token for Cloud Tasks.");
  }

  const startedAt = Date.now();
  const requestHeaders = {
    authorization: `Bearer ${accessToken}`,
    "content-type": "application/json",
  };
  const workerPayload = {
    applicationId,
    stageKey,
  };
  const cloudTaskRequestPayload = {
    task: {
      name: taskName,
      scheduleTime: {
        seconds: String(Math.floor(scheduleTime.getTime() / 1000)),
      },
      httpRequest: {
        httpMethod: "POST",
        url: workerUrl.toString(),
        headers: {
          "content-type": "application/json",
          "x-hr-agent-worker-secret": workerSecret,
        },
        body: Buffer.from(JSON.stringify(workerPayload)).toString("base64"),
      },
    },
  };
  const loggedRequestPayload = {
    ...cloudTaskRequestPayload,
    task: {
      ...cloudTaskRequestPayload.task,
      httpRequest: {
        ...cloudTaskRequestPayload.task.httpRequest,
        decodedBody: workerPayload,
      },
    },
  };
  let responseHeaders: Headers | null = null;
  let response: Response;

  try {
    response = await fetch(`https://cloudtasks.googleapis.com/v2/${queueName}/tasks`, {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify(cloudTaskRequestPayload),
      cache: "no-store",
    });
    responseHeaders = response.headers;
  } catch (error) {
    await recordApiActivityEventSafe({
      service: "CLOUD_TASKS",
      category: "HR",
      operation: "enqueue-hr-worker",
      method: "POST",
      url: `https://cloudtasks.googleapis.com/v2/${queueName}/tasks`,
      durationMs: Date.now() - startedAt,
      requestHeaders,
      requestPayload: loggedRequestPayload,
      errorMessage:
        error instanceof Error ? error.message : "Cloud Tasks enqueue failed unexpectedly.",
      metadata: {
        taskName,
        queueName,
        applicationId,
        stageKey,
      },
    });
    throw error;
  }

  if (response.status === 409) {
    await recordApiActivityEventSafe({
      service: "CLOUD_TASKS",
      category: "HR",
      operation: "enqueue-hr-worker",
      method: "POST",
      url: `https://cloudtasks.googleapis.com/v2/${queueName}/tasks`,
      statusCode: response.status,
      durationMs: Date.now() - startedAt,
      requestHeaders,
      requestPayload: loggedRequestPayload,
      responseHeaders,
      errorMessage: "Task already exists.",
      metadata: {
        taskName,
        queueName,
        applicationId,
        stageKey,
      },
    });
    return {
      status: "duplicate",
      taskName,
      scheduleTime: scheduleTime.toISOString(),
      delaySeconds,
    };
  }

  const json = (await response.json().catch(() => ({}))) as {
    name?: string;
    error?: {
      message?: string;
    };
  };

  await recordApiActivityEventSafe({
    service: "CLOUD_TASKS",
    category: "HR",
    operation: "enqueue-hr-worker",
    method: "POST",
    url: `https://cloudtasks.googleapis.com/v2/${queueName}/tasks`,
    statusCode: response.status,
    durationMs: Date.now() - startedAt,
    requestHeaders,
    requestPayload: loggedRequestPayload,
    responseHeaders,
    responsePayload: json,
    errorMessage: response.ok ? null : json.error?.message ?? null,
    metadata: {
      taskName,
      queueName,
      applicationId,
      stageKey,
    },
  });

  if (!response.ok) {
    throw new Error(
      json.error?.message ??
        `Cloud Tasks enqueue failed with HTTP ${response.status}.`
    );
  }

  return {
    status: "enqueued",
    taskName: json.name ?? taskName,
    scheduleTime: scheduleTime.toISOString(),
    delaySeconds,
  };
}
