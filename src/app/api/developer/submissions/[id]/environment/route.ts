import { revalidatePath } from "next/cache";
import { getCurrentDeveloperAccount } from "@/lib/developer/auth";
import { getDeveloperSubmissionDeepDiveData } from "@/lib/developer/deep-dive";
import { saveDashboardEnvironmentSecret } from "@/lib/dashboard/tool-access";

function normalizeEnvVarName(value: string) {
  return value.trim().toUpperCase();
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const developer = await getCurrentDeveloperAccount();

  if (!developer) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const { id } = await context.params;
    const body = (await request.json()) as {
      envVarName?: string;
      value?: string;
    };
    const envVarName = normalizeEnvVarName(body.envVarName ?? "");
    const data = await getDeveloperSubmissionDeepDiveData({
      submissionId: id,
      userId: developer.id,
    });

    if (!data) {
      return Response.json({ error: "Submission not found." }, { status: 404 });
    }

    const requestedEnvVarNames = new Set(
      data.requirements.flatMap((requirement) =>
        requirement.envVars.map((envVar) => normalizeEnvVarName(envVar.envVarName))
      )
    );

    if (!requestedEnvVarNames.has(envVarName)) {
      return Response.json(
        { error: "This environment variable was not requested by this submission." },
        { status: 400 }
      );
    }

    await saveDashboardEnvironmentSecret({
      envVarName,
      value: body.value ?? "",
    });

    revalidatePath(`/developer/applications/${id}`);
    revalidatePath("/developer/applications");

    return Response.json({ ok: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to save this environment variable.";

    return Response.json({ error: message }, { status: 400 });
  }
}
