import { getCurrentAppUser } from "@/lib/auth/session";
import { runAcceptedAgentEnsemble } from "@/lib/ensemble/orchestrator";

export const maxDuration = 240;

export async function POST(request: Request) {
  const user = await getCurrentAppUser();

  if (!user) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as {
      prompt?: unknown;
    };
    const prompt = typeof body.prompt === "string" ? body.prompt : "";

    return Response.json(
      await runAcceptedAgentEnsemble({
        prompt,
        request,
      })
    );
  } catch (error) {
    console.error("[dashboard-ensemble]", error);

    const message =
      error instanceof Error
        ? error.message
        : "Unable to run the accepted-agent ensemble right now.";

    return Response.json({ error: message }, { status: 500 });
  }
}
