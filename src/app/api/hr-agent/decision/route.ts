import { getCurrentAppUser } from "@/lib/auth/session";
import { submitHumanHiringDecision } from "@/lib/hr-agent/api/decision";
import { getRecruitingDashboardData } from "@/lib/hr-agent/repository";

export async function POST(request: Request) {
  const user = await getCurrentAppUser();

  if (!user) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const application = await submitHumanHiringDecision(request);
    const data = await getRecruitingDashboardData();

    return Response.json({
      application,
      applications: data.applications,
      pipelineCount: data.pipelineCount,
      backendStatus: data.backendStatus,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to record hiring decision.";

    return Response.json({ error: message }, { status: 400 });
  }
}
