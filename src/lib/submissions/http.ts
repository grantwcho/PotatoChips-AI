import "server-only";

import { SubmissionHttpError } from "@/lib/submissions/service";

export function getRequestIpAddress(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for")?.trim();

  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || null;
  }

  return request.headers.get("x-real-ip")?.trim() ?? null;
}

export function submissionErrorResponse(
  error: unknown,
  fallbackMessage = "Something went wrong."
) {
  if (error instanceof SubmissionHttpError) {
    return Response.json({ error: error.message }, { status: error.status });
  }

  console.error(error);
  return Response.json({ error: fallbackMessage }, { status: 500 });
}
