import { submissionErrorResponse } from "@/lib/submissions/http";
import {
  requireSubmission,
  SubmissionHttpError,
} from "@/lib/submissions/service";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    await requireSubmission(id);

    throw new SubmissionHttpError(
      "Automated submission review is currently paused.",
      409
    );
  } catch (error) {
    return submissionErrorResponse(error, "Unable to re-run interpretation.");
  }
}
