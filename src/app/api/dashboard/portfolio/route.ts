import { getCurrentAppUser } from "@/lib/auth/session";
import { getDashboardPortfolioData } from "@/lib/dashboard/live-data";

export async function GET() {
  const user = await getCurrentAppUser();

  if (!user) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const portfolio = await getDashboardPortfolioData({ fresh: true });
    return Response.json(portfolio);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to load portfolio data.";

    return Response.json({ error: message }, { status: 500 });
  }
}
