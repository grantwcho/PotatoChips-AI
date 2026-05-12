import { connection } from "next/server";
import { requireGithubAccessTokenForCurrentUser } from "@/lib/submissions/auth";
import { listGithubBranches } from "@/lib/submissions/github/client";
import { submissionErrorResponse } from "@/lib/submissions/http";

export async function GET(request: Request) {
  await connection();

  try {
    const { accessToken } = await requireGithubAccessTokenForCurrentUser();
    const url = new URL(request.url);
    const repoFullName = url.searchParams.get("repo");

    if (!repoFullName) {
      return Response.json({ error: "Repository is required." }, { status: 400 });
    }

    const branches = await listGithubBranches({
      accessToken,
      repoFullName,
    });

    return Response.json({ branches });
  } catch (error) {
    return submissionErrorResponse(error, "Unable to load GitHub branches.");
  }
}
