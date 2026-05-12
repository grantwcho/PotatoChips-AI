import { getCurrentAppUser, isDevDashboardBypassEnabled } from "@/lib/auth/session";
import { isAgentSwarmDecommissioned } from "@/lib/agents/decommission";
import { scheduleInlinePaperRuntimeHeartbeat } from "@/lib/agents/runtime-driver";
import {
  getDashboardDiscussionData,
  getDashboardOverviewData,
  getDashboardPortfolioData,
  getDashboardQuantLabData,
  getDashboardResearchData,
  getDashboardSummaryData,
} from "@/lib/dashboard/live-data";
import { getHrApplicationStatus } from "@/lib/hr-agent/api/status";
import type { RecruitingDashboardData } from "@/lib/hr-agent/models/agent-application";

const STREAM_INTERVAL_MS = {
  summary: 5_000,
  overview: 5_000,
  portfolio: 5_000,
  discussion: 3_000,
  research: 10_000,
  "quant-lab": 5_000,
  recruiting: 5_000,
} as const;

type DashboardLiveStream = keyof typeof STREAM_INTERVAL_MS;

type StreamErrorPayload = {
  at: string;
  message: string;
  stream: DashboardLiveStream;
};

function isDashboardLiveStream(value: string | null): value is DashboardLiveStream {
  return Boolean(value && value in STREAM_INTERVAL_MS);
}

function encodeSseEvent(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

async function loadStreamPayload(stream: DashboardLiveStream, request: Request) {
  const url = new URL(request.url);

  if (stream === "summary") {
    return getDashboardSummaryData({ fresh: true });
  }

  if (stream === "overview") {
    return getDashboardOverviewData({ fresh: true });
  }

  if (stream === "portfolio") {
    return getDashboardPortfolioData({ fresh: true });
  }

  if (stream === "discussion") {
    const limit = Number(url.searchParams.get("limit") ?? "120");
    return getDashboardDiscussionData(limit);
  }

  if (stream === "research") {
    return getDashboardResearchData({ fresh: true });
  }

  if (stream === "quant-lab") {
    return getDashboardQuantLabData({ fresh: true });
  }

  const applicationId = url.searchParams.get("applicationId") ?? undefined;
  const status = await getHrApplicationStatus(applicationId);

  return {
    applications: status.applications,
    backendStatus: status.backendStatus,
  } satisfies {
    applications: typeof status.applications;
    backendStatus: RecruitingDashboardData["backendStatus"];
  };
}

export async function GET(request: Request) {
  const user = await getCurrentAppUser();

  if (!user) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  const url = new URL(request.url);
  const stream = url.searchParams.get("stream");

  if (!isDashboardLiveStream(stream)) {
    return Response.json({ error: "Unknown live stream requested." }, { status: 400 });
  }

  const encoder = new TextEncoder();

  const responseStream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let intervalHandle: ReturnType<typeof setInterval> | null = null;
      let tickInFlight: Promise<void> | null = null;

      const close = () => {
        if (closed) {
          return;
        }

        closed = true;

        if (intervalHandle) {
          clearInterval(intervalHandle);
          intervalHandle = null;
        }

        request.signal.removeEventListener("abort", close);

        try {
          controller.close();
        } catch {
          // The stream may already be closed while the browser is tearing down the connection.
        }
      };

      const sendEvent = (event: string, data: unknown) => {
        if (closed) {
          return;
        }

        controller.enqueue(encoder.encode(encodeSseEvent(event, data)));
      };

      const publish = async () => {
        if (closed || tickInFlight) {
          return;
        }

        if (!isDevDashboardBypassEnabled() && !isAgentSwarmDecommissioned()) {
          scheduleInlinePaperRuntimeHeartbeat();
        }

        tickInFlight = (async () => {
          try {
            const payload = await loadStreamPayload(stream, request);
            sendEvent(stream, payload);
          } catch (error) {
            const payload: StreamErrorPayload = {
              at: new Date().toISOString(),
              message:
                error instanceof Error ? error.message : "Unable to publish live dashboard data.",
              stream,
            };
            sendEvent("stream-error", payload);
          } finally {
            tickInFlight = null;
          }
        })();

        await tickInFlight;
      };

      controller.enqueue(encoder.encode(`retry: ${STREAM_INTERVAL_MS[stream]}\n\n`));

      void publish();

      intervalHandle = setInterval(() => {
        void publish();
      }, STREAM_INTERVAL_MS[stream]);

      request.signal.addEventListener("abort", close, { once: true });
    },
  });

  return new Response(responseStream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
      "X-Accel-Buffering": "no",
    },
  });
}
