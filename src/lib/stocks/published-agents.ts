import "server-only";

import { prisma } from "@/lib/prisma";
import { ensureSubmissionSchema } from "@/lib/submissions/schema";
import { selectLatestSubmissionsBySource } from "@/lib/submissions/service";
import {
  getStockCoverageEntry,
  getStockResearchAgent,
  getStockResearchAgents,
  getStockResearchAgentSlug,
} from "@/lib/stocks/coverage-data";
import type { StockCoverageEntry, StockResearchAgent } from "@/lib/stocks/types";

const AI_SEMICONDUCTOR_SYMBOL = "NVDA";

function parsePublicAgentSnapshot(value: string | null) {
  if (!value?.trim()) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as Partial<StockResearchAgent>;

    if (!parsed || typeof parsed !== "object" || !parsed.name || !parsed.code) {
      return null;
    }

    return parsed as StockResearchAgent;
  } catch (error) {
    console.warn("Stored public agent snapshot is not valid JSON.", {
      error: error instanceof Error ? error.message : error,
    });
    return null;
  }
}

function mergeAgents(
  staticAgents: StockResearchAgent[],
  publishedAgents: StockResearchAgent[]
) {
  const agentsBySlug = new Map<string, StockResearchAgent>();

  for (const agent of [...staticAgents, ...publishedAgents]) {
    const slug = agent.slug ?? getStockResearchAgentSlug(agent);
    agentsBySlug.set(slug.toLowerCase(), {
      ...agent,
      slug,
    });
  }

  return [...agentsBySlug.values()];
}

export async function getPublishedStockResearchAgents(symbol: string) {
  if (symbol.trim().toUpperCase() !== AI_SEMICONDUCTOR_SYMBOL) {
    return [];
  }

  try {
    await ensureSubmissionSchema();

    const submissions = await prisma.submission.findMany({
      orderBy: [
        {
          reviewedAt: "desc",
        },
        {
          updatedAt: "desc",
        },
      ],
      select: {
        createdAt: true,
        githubRepoFullName: true,
        id: true,
        publicAgentSnapshot: true,
        source: true,
        updatedAt: true,
        uploadContentHash: true,
      },
      where: {
        publicationStatus: "APPROVED",
        publicAgentSnapshot: {
          not: null,
        },
      },
    });

    return selectLatestSubmissionsBySource(submissions)
      .map((submission) => parsePublicAgentSnapshot(submission.publicAgentSnapshot))
      .filter((agent): agent is StockResearchAgent => Boolean(agent));
  } catch (error) {
    console.warn("Unable to load approved public agents.", {
      error: error instanceof Error ? error.message : error,
      symbol,
    });
    return [];
  }
}

export async function getStockCoverageEntryWithPublishedAgents(symbol: string) {
  const profile = getStockCoverageEntry(symbol);

  if (!profile) {
    return null;
  }

  const publishedAgents = await getPublishedStockResearchAgents(symbol);

  if (publishedAgents.length === 0) {
    return profile;
  }

  const researchProgram = profile.researchProgram;
  const agents = mergeAgents(researchProgram?.agents ?? [], publishedAgents);

  return {
    ...profile,
    researchProgram: {
      activeAgents: agents.filter((agent) => agent.status === "live").length,
      agents,
      feedEyebrow: researchProgram?.feedEyebrow,
      feedMessages: researchProgram?.feedMessages,
      feedTitle: researchProgram?.feedTitle,
      principles: researchProgram?.principles ?? [],
      publishedResearch: researchProgram?.publishedResearch,
      specialists: agents.length,
      summary:
        researchProgram?.summary ??
        "Approved submitted agents researching the AI semiconductor ecosystem.",
      synthesisAgents: researchProgram?.synthesisAgents ?? 0,
      title: researchProgram?.title ?? "AI Semiconductor Research Program",
      totalAgents: agents.length,
    },
  } satisfies StockCoverageEntry;
}

export async function getStockResearchAgentsWithPublishedAgents(symbol: string) {
  const [staticAgents, publishedAgents] = await Promise.all([
    Promise.resolve(getStockResearchAgents(symbol)),
    getPublishedStockResearchAgents(symbol),
  ]);

  return mergeAgents(staticAgents, publishedAgents);
}

export async function getStockResearchAgentWithPublishedAgents(
  symbol: string,
  slug: string
) {
  const staticAgent = getStockResearchAgent(symbol, slug);

  if (staticAgent) {
    return staticAgent;
  }

  const normalizedSlug = slug.trim().toLowerCase();
  const publishedAgents = await getPublishedStockResearchAgents(symbol);

  return (
    publishedAgents.find((agent) => {
      const agentSlug = (agent.slug ?? getStockResearchAgentSlug(agent)).toLowerCase();

      return (
        agentSlug === normalizedSlug ||
        agent.handle.toLowerCase() === normalizedSlug ||
        agent.code.toLowerCase() === normalizedSlug
      );
    }) ?? null
  );
}
