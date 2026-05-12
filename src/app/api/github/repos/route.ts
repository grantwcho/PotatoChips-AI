import { connection } from "next/server";
import { listGithubRepos } from "@/lib/submissions/github/client";
import { requireGithubAccessTokenForCurrentUser } from "@/lib/submissions/auth";
import { submissionErrorResponse } from "@/lib/submissions/http";

export async function GET() {
  await connection();

  try {
    const { accessToken } = await requireGithubAccessTokenForCurrentUser();
    const repos = await listGithubRepos({
      accessToken,
    });

    return Response.json({ repos });
  } catch (error) {
    return submissionErrorResponse(error, "Unable to load GitHub repositories.");
  }
}
