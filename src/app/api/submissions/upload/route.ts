import {
  acceptSubmissionDirectly,
  createAnonymousSubmissionUser,
} from "@/lib/submissions/service";
import { syncSignedSubmissionToHrApplication } from "@/lib/submissions/hr-bridge";
import { getCurrentSubmissionUser } from "@/lib/submissions/auth";
import { submissionErrorResponse } from "@/lib/submissions/http";
import { createUploadSubmissionFromFormData } from "@/lib/submissions/intake";

export async function POST(request: Request) {
  try {
    const currentUser = await getCurrentSubmissionUser();
    const user = currentUser ?? (await createAnonymousSubmissionUser());
    const formData = await request.formData();
    const submitterNameValue = formData.get("submitterName");
    const submitterName =
      typeof submitterNameValue === "string" ? submitterNameValue.trim() : "";
    const submission = await createUploadSubmissionFromFormData({
      formData,
      userId: user.id,
    });
    const signerName =
      submitterName || user.name?.trim() || user.githubLogin?.trim() || "Submission contributor";
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
      console.error("Upload submission did not promote into Recruiting immediately.", {
        error: error instanceof Error ? error.message : error,
        submissionId: submission.id,
      });
    }

    return Response.json({ submissionId: submission.id }, { status: 201 });
  } catch (error) {
    return submissionErrorResponse(error, "Unable to create upload submission.");
  }
}
