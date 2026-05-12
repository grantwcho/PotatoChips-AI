import { connection } from "next/server";
import { requireGithubAccessTokenForCurrentUser } from "@/lib/submissions/auth";
import { findGithubManifest } from "@/lib/submissions/github/client";
import { submissionErrorResponse } from "@/lib/submissions/http";

export async function GET(request: Request) {
  await connection();

  try {
    const { accessToken } = await requireGithubAccessTokenForCurrentUser();
    const url = new URL(request.url);
    const repoFullName = url.searchParams.get("repo");
    const ref = url.searchParams.get("ref");

    if (!repoFullName || !ref) {
      return Response.json(
        { error: "Repository and ref are required." },
        { status: 400 }
      );
    }

    const manifest = await findGithubManifest({
      accessToken,
      ref,
      repoFullName,
    });

    return Response.json({
      hasManifest: Boolean(manifest),
      manifestPath: manifest?.path ?? null,
    });
  } catch (error) {
    return submissionErrorResponse(error, "Unable to verify the submission manifest.");
  }
}
