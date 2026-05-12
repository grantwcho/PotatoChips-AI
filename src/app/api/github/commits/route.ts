import { connection } from "next/server";
import { requireGithubAccessTokenForCurrentUser } from "@/lib/submissions/auth";
import { listGithubCommits } from "@/lib/submissions/github/client";
import { submissionErrorResponse } from "@/lib/submissions/http";

export async function GET(request: Request) {
  await connection();

  try {
    const { accessToken } = await requireGithubAccessTokenForCurrentUser();
    const url = new URL(request.url);
    const repoFullName = url.searchParams.get("repo");
    const branch = url.searchParams.get("branch");

    if (!repoFullName || !branch) {
      return Response.json(
        { error: "Repository and branch are required." },
        { status: 400 }
      );
    }

    const commits = await listGithubCommits({
      accessToken,
      branch,
      repoFullName,
    });

    return Response.json({ commits });
  } catch (error) {
    return submissionErrorResponse(error, "Unable to load GitHub commits.");
  }
}
