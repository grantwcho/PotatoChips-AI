import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { StockAgentMarketplace } from "@/components/stock-agent-marketplace";
import { listApprovedPublicAgentSnapshots } from "@/lib/submissions/service";
import { getStockCoverageEntry } from "@/lib/stocks/coverage-data";
import type {
  StockCoverageEntry,
  StockResearchAgent,
} from "@/lib/stocks/types";

const SYMBOL = "NVDA";

function getAgentIdentityKeys(agent: StockResearchAgent) {
  return [agent.slug, agent.code, agent.handle]
    .map((value) => value?.trim().toLowerCase())
    .filter((value): value is string => Boolean(value));
}

function mergeApprovedAgentsIntoProfile(
  profile: StockCoverageEntry,
  approvedAgents: StockResearchAgent[]
) {
  if (approvedAgents.length === 0 || !profile.researchProgram) {
    return profile;
  }

  const seen = new Set<string>();
  const agents = [...approvedAgents, ...profile.researchProgram.agents].filter(
    (agent) => {
      const keys = getAgentIdentityKeys(agent);
      const duplicate = keys.some((key) => seen.has(key));

      for (const key of keys) {
        seen.add(key);
      }

      return !duplicate;
    }
  );

  return {
    ...profile,
    researchProgram: {
      ...profile.researchProgram,
      activeAgents: agents.filter((agent) => agent.status === "live").length,
      agents,
      specialists: Math.max(
        0,
        agents.length - profile.researchProgram.synthesisAgents
      ),
      totalAgents: agents.length,
    },
  };
}

export async function generateMetadata(): Promise<Metadata> {
  const profile = getStockCoverageEntry(SYMBOL);

  if (!profile) {
    return {
      title: "AI Semiconductors",
    };
  }

  return {
    alternates: {
      canonical: "/our-agents",
    },
    description:
      "Select which AI agent you want to research the companies, suppliers, buyers, and bottlenecks behind accelerated compute.",
    title: "AI Semiconductors",
  };
}

async function OurAgentsContent({ profile }: { profile: StockCoverageEntry }) {
  await connection();

  const approvedAgents = await listApprovedPublicAgentSnapshots().catch(
    () => [] satisfies StockResearchAgent[]
  );
  const marketplaceProfile = mergeApprovedAgentsIntoProfile(
    profile,
    approvedAgents
  );

  return <StockAgentMarketplace profile={marketplaceProfile} />;
}

export default function OurAgentsPage() {
  const profile = getStockCoverageEntry(SYMBOL);

  if (!profile) {
    notFound();
  }

  return (
    <Suspense
      fallback={
        <StockAgentMarketplace
          profile={profile}
          emptyStateLabel="Loading released agents..."
        />
      }
    >
      <OurAgentsContent profile={profile} />
    </Suspense>
  );
}
