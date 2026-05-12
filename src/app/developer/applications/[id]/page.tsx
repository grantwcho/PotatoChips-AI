import { notFound } from "next/navigation";
import { connection } from "next/server";
import { DeveloperSubmissionWorkbench } from "@/app/developer/applications/[id]/developer-submission-workbench";
import { getCurrentDeveloperAccount } from "@/lib/developer/auth";
import { getDeveloperSubmissionDeepDiveData } from "@/lib/developer/deep-dive";

export default async function DeveloperSubmissionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await connection();

  const developer = await getCurrentDeveloperAccount();

  if (!developer) {
    notFound();
  }

  const { id } = await params;
  const data = await getDeveloperSubmissionDeepDiveData({
    submissionId: id,
    userId: developer.id,
  });

  if (!data) {
    notFound();
  }

  return <DeveloperSubmissionWorkbench data={data} />;
}
