import { getSubmissionDetail } from "@/lib/submissions/service";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const detail = await getSubmissionDetail(id);

  if (!detail) {
    return Response.json({ error: "Submission not found." }, { status: 404 });
  }

  return Response.json(detail);
}
