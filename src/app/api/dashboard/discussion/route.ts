import { getDashboardDiscussionData } from "@/lib/dashboard/live-data";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") ?? "120");

  try {
    const data = await getDashboardDiscussionData(limit);
    return Response.json(data);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to load agent discussion.";

    return Response.json({ error: message }, { status: 500 });
  }
}
