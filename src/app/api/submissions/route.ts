import { SubmissionSource } from "@/lib/prisma-client";
import {
  getCurrentSubmissionUser,
  requireGithubAccessTokenForCurrentUser,
} from "@/lib/submissions/auth";
import { findGithubManifest } from "@/lib/submissions/github/client";
import { syncSignedSubmissionToHrApplication } from "@/lib/submissions/hr-bridge";
import {
  createGithubSubmissionFromFormData,
  hydrateGithubSubmissionSource,
} from "@/lib/submissions/intake";
import { submissionErrorResponse } from "@/lib/submissions/http";
import {
  acceptSubmissionDirectly,
  createAnonymousSubmissionUser,
} from "@/lib/submissions/service";

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") ?? "";

    if (!contentType.includes("application/json")) {
      return Response.json(
        { error: "Use the source-specific endpoints for multipart uploads." },
        { status: 400 }
      );
    }

    const body = (await request.json()) as {
      agentName?: string;
      branch?: string;
      commitSha?: string;
      description?: string;
      linkedinProfileUrl?: string;
      repoFullName?: string;
      submitterName?: string;
      source?: SubmissionSource;
    };

    if (body.source === SubmissionSource.GITHUB) {
      const { accessToken, user } = await requireGithubAccessTokenForCurrentUser();
      const repoFullName = body.repoFullName?.trim() ?? "";
      const branch = body.branch?.trim() ?? "";
      const commitSha = body.commitSha?.trim() ?? "";

      const formData = new FormData();
      formData.set("agentName", body.agentName ?? "");
      formData.set("branch", branch);
      formData.set("commitSha", commitSha);
      formData.set("description", body.description ?? "");
      formData.set("linkedinProfileUrl", body.linkedinProfileUrl ?? "");
      formData.set("repoFullName", repoFullName);
      formData.set("submitterName", body.submitterName ?? "");

      if (!repoFullName || !commitSha) {
        return Response.json(
          { error: "Repository and commit are required." },
          { status: 400 }
        );
      }

      const manifest = await findGithubManifest({
        accessToken,
        ref: commitSha,
        repoFullName,
      });

      if (!manifest) {
        return Response.json(
          {
            error:
              "manifest.yaml is missing from the repository root. Add the Potato Chips AI template manifest before submitting.",
          },
          { status: 400 }
        );
      }

      if (!manifest.content) {
        return Response.json(
          { error: `Unable to read ${manifest.path} from the selected commit.` },
          { status: 400 }
        );
      }

      const submission = await createGithubSubmissionFromFormData({
        formData,
        userId: user.id,
      });

      await hydrateGithubSubmissionSource({
        accessToken,
        branch,
        commitSha,
        repoFullName,
        submissionId: submission.id,
      });

      const signerName =
        body.submitterName?.trim() ||
        user.name?.trim() ||
        user.githubLogin?.trim() ||
        "GitHub submitter";
      const signerEmail =
        user.email?.trim() ||
        (user.githubLogin?.trim()
          ? `${user.githubLogin.trim()}@users.noreply.github.com`
          : `${user.id}@users.noreply.potatochipsai.dev`);

      await acceptSubmissionDirectly({
        signerEmail,
        signerName,
        submissionId: submission.id,
      });

      try {
        await syncSignedSubmissionToHrApplication({
          request,
          runPipeline: false,
          submissionId: submission.id,
        });
      } catch (error) {
        console.error("GitHub submission did not promote into Recruiting immediately.", {
          error: error instanceof Error ? error.message : error,
          submissionId: submission.id,
        });
      }

      return Response.json({ submissionId: submission.id }, { status: 201 });
    }

    const user = (await getCurrentSubmissionUser()) ?? (await createAnonymousSubmissionUser());
    return Response.json(
      {
        error:
          "Upload submissions must use /api/submissions/upload so files can be transferred safely.",
        userId: user.id,
      },
      { status: 400 }
    );
  } catch (error) {
    return submissionErrorResponse(error, "Unable to create submission.");
  }
}
