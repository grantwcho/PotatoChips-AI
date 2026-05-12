import { getCurrentAppUser } from "@/lib/auth/session";
import { saveDashboardEnvironmentSecret } from "@/lib/dashboard/tool-access";

export async function POST(request: Request) {
  const user = await getCurrentAppUser();

  if (!user) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const body = (await request.json()) as {
      envVarName?: string;
      value?: string;
    };

    await saveDashboardEnvironmentSecret({
      envVarName: body.envVarName ?? "",
      value: body.value ?? "",
    });

    return Response.json({ ok: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to save this tool credential.";

    return Response.json({ error: message }, { status: 400 });
  }
}
