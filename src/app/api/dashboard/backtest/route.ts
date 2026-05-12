import { getCurrentAppUser } from "@/lib/auth/session";
import { runDashboardBacktest } from "@/lib/dashboard/backtesting";
import type { DashboardBacktestRange } from "@/lib/dashboard/types";

type BacktestRequestBody = {
  range?: DashboardBacktestRange;
  agentIds?: string[];
};

export async function POST(request: Request) {
  const user = await getCurrentAppUser();

  if (!user) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  let body: BacktestRequestBody = {};

  try {
    body = (await request.json()) as BacktestRequestBody;
  } catch {
    body = {};
  }

  try {
    const data = await runDashboardBacktest({
      range: body.range,
      agentIds: Array.isArray(body.agentIds) ? body.agentIds : [],
    });
    return Response.json(data);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to run dashboard historical replay.";

    return Response.json({ error: message }, { status: 500 });
  }
}
