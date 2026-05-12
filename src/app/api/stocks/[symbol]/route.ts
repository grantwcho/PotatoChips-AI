import { getStockCoverageLiveData } from "@/lib/stocks/coverage-service";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ symbol: string }> }
) {
  const { symbol } = await params;
  const data = await getStockCoverageLiveData(symbol);

  if (!data) {
    return Response.json(
      {
        error: "Unknown stock coverage symbol.",
      },
      {
        status: 404,
        headers: {
          "cache-control": "no-store",
        },
      }
    );
  }

  return Response.json(data, {
    headers: {
      "cache-control": "no-store",
    },
  });
}
