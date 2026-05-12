import { getDashboardQuantLabSnippetDownloadData } from "@/lib/dashboard/quant-lab";

function errorResponse(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const commitId = searchParams.get("commitId")?.trim() ?? "";
  const filePath = searchParams.get("path")?.trim() ?? "";

  if (!commitId || !filePath) {
    return errorResponse("Both commitId and path are required.");
  }

  const download = await getDashboardQuantLabSnippetDownloadData(commitId, filePath);

  if (!download) {
    return errorResponse("Unable to find that Quant Lab file.", 404);
  }

  return new Response(download.content, {
    headers: {
      "Content-Disposition": `attachment; filename="${download.fileName}"`,
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}
