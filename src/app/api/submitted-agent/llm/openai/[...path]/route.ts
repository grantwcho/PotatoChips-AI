import { proxySubmittedAgentLlmRequest } from "@/lib/submissions/llm-gateway";

type RouteContext = {
  params: Promise<{
    path?: string[];
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { path = [] } = await context.params;

  return proxySubmittedAgentLlmRequest({
    path,
    provider: "openai",
    request,
  });
}

export const GET = POST;
