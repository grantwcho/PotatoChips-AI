import { getCurrentAppUser } from "@/lib/auth/session";
import { getDashboardSummaryData } from "@/lib/dashboard/live-data";

export async function GET() {
  const user = await getCurrentAppUser();

  if (!user) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const summary = await getDashboardSummaryData({ fresh: true });
    return Response.json(summary);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to load dashboard summary.";

    return Response.json({ error: message }, { status: 500 });
  }
}
