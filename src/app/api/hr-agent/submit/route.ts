import { getCurrentAppUser } from "@/lib/auth/session";
import { submitAgentApplicationFromRequest } from "@/lib/hr-agent/api/submit";
import { getRecruitingDashboardData } from "@/lib/hr-agent/repository";

export async function POST(request: Request) {
  const user = await getCurrentAppUser();

  if (!user) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const application = await submitAgentApplicationFromRequest(request);
    const followUp = {
      status: "paused" as const,
      reason: "Automated evaluation is currently paused.",
    };
    const data = await getRecruitingDashboardData();

    return Response.json(
      {
        application,
        applications: data.applications,
        pipelineCount: data.pipelineCount,
        backendStatus: data.backendStatus,
        followUp,
      },
      { status: 201 }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to submit agent application.";

    return Response.json({ error: message }, { status: 400 });
  }
}
