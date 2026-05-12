import "server-only";

import {
  getSubmissionRuntimeRequirements,
  type DashboardToolRequirement,
} from "@/lib/dashboard/tool-access";
import { getSubmissionDetail } from "@/lib/submissions/service";
import type { SubmissionDetail } from "@/lib/submissions/types";

export type DeveloperSubmissionDeepDiveData = {
  requirements: DashboardToolRequirement[];
  submission: SubmissionDetail;
};

export async function getDeveloperSubmissionDeepDiveData(input: {
  submissionId: string;
  userId: string;
}): Promise<DeveloperSubmissionDeepDiveData | null> {
  const submission = await getSubmissionDetail(input.submissionId);

  if (!submission || submission.user.id !== input.userId) {
    return null;
  }

  const submissionLabel =
    submission.agentName?.trim() ||
    submission.githubRepoFullName?.split("/").filter(Boolean).at(-1) ||
    `Submission ${submission.id.slice(0, 8)}`;

  const requirements = await getSubmissionRuntimeRequirements({
    submission,
    submissionLabel,
  });

  return {
    requirements,
    submission,
  };
}
