import { getLiveFeedSnapshot } from "@/lib/agents/runtime";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") ?? "40");
  const safeLimit = Number.isFinite(limit)
    ? Math.max(1, Math.min(limit, 100))
    : 40;

  try {
    const snapshot = await getLiveFeedSnapshot(safeLimit);
    return Response.json(snapshot);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to load agent feed.";

    return Response.json({ error: message }, { status: 500 });
  }
}
