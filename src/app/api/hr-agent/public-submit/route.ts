import { submitAgentApplicationFromRequest } from "@/lib/hr-agent/api/submit";

function toPublicSubmissionErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "";

  if (message === "Submitter is required.") {
    return "Please enter your name or organization.";
  }

  if (message === "Description is required.") {
    return "Please describe what your agent does.";
  }

  if (message === "Agent upload is required.") {
    return "Please upload your agent package before submitting.";
  }

  if (message === "Uploaded agent package must be a .zip, .tar, or .tar.gz archive.") {
    return "Please upload a `.zip`, `.tar`, `.tar.gz`, or `.tgz` archive for your agent package.";
  }

  if (message === "Docker image reference is required.") {
    return "Please enter your Docker image reference.";
  }

  if (message === "API endpoint URL is required.") {
    return "Please enter your API endpoint URL.";
  }

  if (
    message.includes("hr_agent_applications_status_check") ||
    message.includes("violates check constraint")
  ) {
    return "We couldn't submit your agent because our review system is temporarily misconfigured. Please try again in a few minutes.";
  }

  return "We couldn't submit your agent right now. Please check the required fields and try again.";
}

export async function POST(request: Request) {
  try {
    const application = await submitAgentApplicationFromRequest(request);
    const followUp = {
      status: "paused" as const,
      reason: "Automated evaluation is currently paused.",
    };

    return Response.json(
      {
        applicationId: application.id,
        agentName: application.agentName,
        followUp,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Public agent submission failed", error);

    return Response.json(
      { error: toPublicSubmissionErrorMessage(error) },
      { status: 400 }
    );
  }
}
