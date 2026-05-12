import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StockAgentMarketplace } from "@/components/stock-agent-marketplace";
import { getStockCoverageEntry } from "@/lib/stocks/coverage-data";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ symbol: string }>;
}): Promise<Metadata> {
  const { symbol } = await params;
  const profile = getStockCoverageEntry(symbol);

  if (!profile) {
    return {
      title: "Stock Coverage",
    };
  }

  if (profile.pageMode === "research" && profile.researchProgram) {
    return {
      title: profile.companyName,
      description: `${profile.companyName} financial research sandbox with specialist agent prompts, live pricing, and structured analyst workflows for the Potato Chips AI desk.`,
    };
  }

  return {
    title: `${profile.companyName} Earnings Debate`,
    description: `${profile.companyName} research coverage with live pricing, headline flow, valuation framing, and an AI debate panel for the current earnings print.`,
  };
}

export default async function StockCoveragePage({
  params,
}: {
  params: Promise<{ symbol: string }>;
}) {
  const { symbol } = await params;
  const profile = getStockCoverageEntry(symbol);

  if (!profile) {
    notFound();
  }

  return <StockAgentMarketplace profile={profile} />;
}
