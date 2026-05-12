import { requireGithubAccessTokenForCurrentUser } from "@/lib/submissions/auth";
import { findGithubManifest } from "@/lib/submissions/github/client";
import { syncSignedSubmissionToHrApplication } from "@/lib/submissions/hr-bridge";
import { submissionErrorResponse } from "@/lib/submissions/http";
import {
  createGithubSubmissionFromFormData,
  hydrateGithubSubmissionSource,
} from "@/lib/submissions/intake";
import { acceptSubmissionDirectly } from "@/lib/submissions/service";

export async function POST(request: Request) {
  try {
    const { accessToken, user } = await requireGithubAccessTokenForCurrentUser();
    const formData = await request.formData();
    const repoValue = formData.get("repoFullName");
    const branchValue = formData.get("branch");
    const commitValue = formData.get("commitSha");
    const submitterNameValue = formData.get("submitterName");
    const repoFullName = typeof repoValue === "string" ? repoValue.trim() : "";
    const branch = typeof branchValue === "string" ? branchValue.trim() : "";
    const commitSha = typeof commitValue === "string" ? commitValue.trim() : "";
    const submitterName =
      typeof submitterNameValue === "string" ? submitterNameValue.trim() : "";

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
      submitterName || user.name?.trim() || user.githubLogin?.trim() || "GitHub submitter";
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
  } catch (error) {
    return submissionErrorResponse(error, "Unable to create GitHub submission.");
  }
}
