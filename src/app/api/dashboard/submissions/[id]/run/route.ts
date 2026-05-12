import { getCurrentAppUser } from "@/lib/auth/session";
import { getDashboardSubmissionRequirementsData } from "@/lib/dashboard/tool-access";
import { createSubmittedAgentDirectRunResponse } from "@/lib/submissions/direct-run-response";

export const maxDuration = 120;

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentAppUser();

  if (!user) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const { id } = await context.params;
    const body = (await request.json().catch(() => ({}))) as {
      chatSessionId?: unknown;
      context?: unknown;
      injectManagedCredentials?: unknown;
      messages?: unknown;
      metrics?: unknown;
      prompt?: unknown;
    };
    const data = await getDashboardSubmissionRequirementsData(id);

    if (!data?.submission) {
      return Response.json({ error: "Submission not found." }, { status: 404 });
    }

    return createSubmittedAgentDirectRunResponse({
      body,
      request,
      submissionId: data.submission.id,
      surface: "DASHBOARD",
    });
  } catch (error) {
    console.error("[dashboard-submission-direct-run]", error);

    const message =
      error instanceof Error
        ? error.message
        : "Unable to run this submitted agent right now.";

    return Response.json({ error: message }, { status: 500 });
  }
}
