import { recordHumanHiringDecision } from "@/lib/hr-agent/repository";

export async function submitHumanHiringDecision(request: Request) {
  const body = (await request.json()) as {
    applicationId?: string;
    decision?: "APPROVE" | "OVERRIDE";
    overrideRecommendation?: "Hire" | "Backburner" | "Reject";
    note?: string;
  };

  if (!body.applicationId) {
    throw new Error("Application ID is required.");
  }

  if (body.decision !== "APPROVE" && body.decision !== "OVERRIDE") {
    throw new Error("Decision must be APPROVE or OVERRIDE.");
  }

  return recordHumanHiringDecision({
    applicationId: body.applicationId,
    decision: body.decision,
    overrideRecommendation: body.overrideRecommendation,
    note: body.note,
  });
}
