import { revalidatePath } from "next/cache";
import { getCurrentAppUser } from "@/lib/auth/session";
import { getDashboardSubmissionRequirementsData } from "@/lib/dashboard/tool-access";
import {
  approveSubmissionForPublication,
  rejectSubmissionForPublication,
  SubmissionHttpError,
} from "@/lib/submissions/service";

type PublicationAction = "approve" | "reject";

function parseAction(value: unknown): PublicationAction | null {
  if (value === "accept") {
    return "approve";
  }

  return value === "approve" || value === "reject" ? value : null;
}

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
      action?: unknown;
    };
    const action = parseAction(body.action);

    if (!action) {
      return Response.json(
        { error: "Choose accept or reject." },
        { status: 400 }
      );
    }

    const data = await getDashboardSubmissionRequirementsData(id);

    if (!data?.submission) {
      return Response.json({ error: "Submission not found." }, { status: 404 });
    }

    const detail =
      action === "approve"
        ? await approveSubmissionForPublication(data.submission.id)
        : await rejectSubmissionForPublication(data.submission.id);

    revalidatePath("/our-agents");
    revalidatePath("/our-agents/[slug]", "page");
    revalidatePath("/dashboard/submissions");
    revalidatePath(`/dashboard/submissions/${id}`);

    return Response.json({
      publicAgentSlug: detail?.publicAgentSlug ?? null,
      publicationStatus: detail?.publicationStatus ?? "PENDING",
      reviewedAt: detail?.reviewedAt ?? null,
    });
  } catch (error) {
    console.error("[dashboard-submission-publication]", error);

    if (error instanceof SubmissionHttpError) {
      return Response.json({ error: error.message }, { status: error.status });
    }

    const message =
      error instanceof Error
        ? error.message
        : "Unable to update this submission publication state.";

    return Response.json({ error: message }, { status: 500 });
  }
}
