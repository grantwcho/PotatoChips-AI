import { isAgentSwarmDecommissioned } from "@/lib/agents/decommission";
import { runPaperCycle } from "@/lib/agents/runtime";
import { enqueueNextWorkerRun } from "@/lib/agents/worker-queue";

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

  try {
    const result = await runPaperCycle();
    const followUp = await enqueueNextWorkerRun(request, {
      source: "research-cycle-route",
      previousCycleId: result.cycle.id,
      previousCycleCompletedAt: result.cycle.completedAt,
      trigger: "manual-research-cycle",
    });

    return Response.json(
      {
        ...result,
        followUp,
      },
      { status: 201 }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to run research cycle.";

    return Response.json({ error: message }, { status: 500 });
  }
}
