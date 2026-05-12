import { getBrokerSnapshot } from "@/lib/agents/runtime";

export async function GET() {
  try {
    const snapshot = await getBrokerSnapshot();
    return Response.json(snapshot);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to load market-data snapshot.";

    return Response.json({ error: message }, { status: 500 });
  }
}
