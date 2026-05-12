import { submissionErrorResponse } from "@/lib/submissions/http";
import { updateSubmissionAdapterByUser } from "@/lib/submissions/service";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const body = (await request.json()) as {
      code?: string;
    };

    await updateSubmissionAdapterByUser({
      code: body.code ?? "",
      submissionId: id,
    });

    return Response.json({ ok: true });
  } catch (error) {
    return submissionErrorResponse(error, "Unable to save adapter edits.");
  }
}
