import { getRequestIpAddress, submissionErrorResponse } from "@/lib/submissions/http";
import { syncSignedSubmissionToHrApplication } from "@/lib/submissions/hr-bridge";
import { signSubmission } from "@/lib/submissions/service";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const body = (await request.json()) as {
      signerEmail?: string;
      signerName?: string;
    };

    const bundle = await signSubmission({
      ipAddress: getRequestIpAddress(request),
      signerEmail: body.signerEmail ?? "",
      signerName: body.signerName ?? "",
      submissionId: id,
      userAgent: request.headers.get("user-agent"),
    });

    try {
      await syncSignedSubmissionToHrApplication({
        request,
        runPipeline: false,
        submissionId: id,
      });
    } catch (error) {
      console.error("Signed submission did not promote into Recruiting immediately.", {
        error: error instanceof Error ? error.message : error,
        submissionId: id,
      });
    }

    return Response.json({ bundle, ok: true });
  } catch (error) {
    return submissionErrorResponse(error, "Unable to sign submission.");
  }
}
