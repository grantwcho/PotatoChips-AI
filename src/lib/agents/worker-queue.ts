import "server-only";

import { GoogleAuth } from "google-auth-library";
import type { RuntimeSessionSnapshot } from "@/lib/agents/types";
import { isAgentSwarmDecommissioned } from "@/lib/agents/decommission";
import { getEffectiveRuntimeSession } from "@/lib/agents/runtime";
import { getWorkerSecret } from "@/lib/agents/worker-auth";
import { recordApiActivityEventSafe } from "@/lib/data/alloydb/api-activity";

type QueueFollowUpResult =
  | {
      status: "disabled";
    }
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

function isAutonomousLoopEnabled() {
  return process.env.AGENT_AUTONOMOUS_LOOP_ENABLED?.trim().toLowerCase() === "true";
}

function getAgentQueueName() {
  return process.env.CLOUD_TASKS_AGENT_QUEUE?.trim() ?? "";
}

function getDelaySeconds(session: RuntimeSessionSnapshot) {
  if (session.phase === "NON_TRADING_DAY") {
    return 900;
  }

  if (session.pendingResponseRequests.length > 0) {
    switch (session.phase) {
      case "MARKET":
        return 15;
      case "PRE_MARKET":
      case "POST_MARKET":
      case "OVERNIGHT":
        return 20;
    }
  }

  switch (session.phase) {
    case "MARKET":
      return 15;
    case "PRE_MARKET":
    case "POST_MARKET":
    case "OVERNIGHT":
      return 30;
  }
}

function buildTaskId(scheduleTime: Date, delaySeconds: number) {
  return `agent-loop-${delaySeconds}s-${Math.floor(scheduleTime.getTime() / 1000)}`;
}

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

function getPublicWorkerUrl(request: Request) {
  const configuredServiceUrl = process.env.GOOGLE_CLOUD_SERVICE_URL?.trim();
  const requestUrl = new URL(request.url);

  if (configuredServiceUrl) {
    return new URL("/api/agents/worker", configuredServiceUrl);
  }

  const forwardedProto =
    getForwardedHeaderValue(request, "x-forwarded-proto") ??
    requestUrl.protocol.replace(/:$/, "");
  const forwardedHost =
    getForwardedHeaderValue(request, "x-forwarded-host") ??
    getForwardedHeaderValue(request, "host") ??
    requestUrl.host;

  return new URL("/api/agents/worker", `${forwardedProto}://${forwardedHost}`);
}

export async function enqueueNextWorkerRun(
  request: Request,
  payload: Record<string, unknown>
): Promise<QueueFollowUpResult> {
  if (isAgentSwarmDecommissioned()) {
    return { status: "disabled" };
  }

  if (!isAutonomousLoopEnabled()) {
    return { status: "disabled" };
  }

  const queueName = getAgentQueueName();

  if (!queueName) {
    return {
      status: "misconfigured",
      reason: "Missing CLOUD_TASKS_AGENT_QUEUE while AGENT_AUTONOMOUS_LOOP_ENABLED is true.",
    };
  }

  const workerSecret = getWorkerSecret();

  if (!workerSecret) {
    return {
      status: "misconfigured",
      reason: "Missing AGENT_WORKER_SECRET while AGENT_AUTONOMOUS_LOOP_ENABLED is true.",
    };
  }

  const session = await getEffectiveRuntimeSession(new Date());
  const delaySeconds = getDelaySeconds(session);
  const scheduleTime = new Date(Date.now() + delaySeconds * 1000);
  const taskName = `${queueName}/tasks/${buildTaskId(scheduleTime, delaySeconds)}`;
  const workerUrl = getPublicWorkerUrl(request);

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
          "x-agent-worker-secret": workerSecret,
        },
        body: Buffer.from(JSON.stringify(payload)).toString("base64"),
      },
    },
  };
  const loggedRequestPayload = {
    ...cloudTaskRequestPayload,
    task: {
      ...cloudTaskRequestPayload.task,
      httpRequest: {
        ...cloudTaskRequestPayload.task.httpRequest,
        decodedBody: payload,
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
      category: "INFRASTRUCTURE",
      operation: "enqueue-agent-worker",
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
      },
    });
    throw error;
  }

  if (response.status === 409) {
    await recordApiActivityEventSafe({
      service: "CLOUD_TASKS",
      category: "INFRASTRUCTURE",
      operation: "enqueue-agent-worker",
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
    category: "INFRASTRUCTURE",
    operation: "enqueue-agent-worker",
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
