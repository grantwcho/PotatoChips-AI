import { getCurrentAppUser } from "@/lib/auth/session";
import { getHrApplicationStatus } from "@/lib/hr-agent/api/status";

export async function GET(request: Request) {
  const user = await getCurrentAppUser();

  if (!user) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  const url = new URL(request.url);
  const applicationId = url.searchParams.get("applicationId") ?? undefined;

  try {
    return Response.json(await getHrApplicationStatus(applicationId));
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to load HR application status.";

    return Response.json({ error: message }, { status: 500 });
  }
}
