import { getSignedBundle, getSubmissionBundleFileName } from "@/lib/submissions/service";
import { submissionErrorResponse } from "@/lib/submissions/http";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const [bundle, fileName] = await Promise.all([
      getSignedBundle(id),
      getSubmissionBundleFileName(id),
    ]);

    return new Response(`${JSON.stringify(bundle, null, 2)}\n`, {
      headers: {
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Content-Type": "application/json; charset=utf-8",
      },
    });
  } catch (error) {
    return submissionErrorResponse(error, "Unable to download submission bundle.");
  }
}
