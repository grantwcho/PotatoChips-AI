import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { CharacterTextReveal } from "@/components/character-text-reveal";
import { getApprovedPublicAgentSnapshotBySlug } from "@/lib/submissions/service";
import { formatBaseModelLabel } from "@/lib/stocks/model-metadata";
import {
  getStockCoverageEntry,
  getStockResearchAgent,
  getStockResearchAgentSlug,
} from "@/lib/stocks/coverage-data";
import type { StockResearchAgent } from "@/lib/stocks/types";

const SYMBOL = "NVDA";

function formatBounty(amount: number | undefined): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount ?? 500);
}

function getAgentSlug(agent: StockResearchAgent): string {
  return agent.slug ?? getStockResearchAgentSlug(agent);
}

function buildAgentSections(agent: StockResearchAgent) {
  return [
    {
      heading: "What this agent does",
      paragraphs: [
        agent.summary,
        agent.roleDescription,
        `Coverage focus: ${agent.focus}.`,
      ],
    },
    {
      heading: "Source map",
      paragraphs: agent.dataSources,
    },
    {
      heading: "Research loop",
      paragraphs: agent.researchLoop.map(
        (step) => `${step.cadence}. ${step.description}`
      ),
    },
    {
      heading: "Output contract",
      paragraphs: [
        agent.naturalLanguageFormat,
        "Machine-readable output stays stable so revisions can be compared cleanly over time and across agent lanes.",
        ...agent.collaboration,
      ],
    },
    {
      heading: "Communication style",
      paragraphs: [agent.communicationStyle],
    },
    {
      heading: "Guardrails",
      paragraphs: agent.guardrails,
    },
  ];
}

function AgentStat({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-[8rem]">
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-black/42">
        {label}
      </p>
      <p className="mt-2 text-black">{value}</p>
    </div>
  );
}

async function getVisibleStockResearchAgent(slug: string) {
  const builtInAgent = getStockResearchAgent(SYMBOL, slug);

  if (builtInAgent) {
    return builtInAgent;
  }

  return getApprovedPublicAgentSnapshotBySlug(slug).catch(() => null);
}

function AgentDetailFallback() {
  return (
    <div
      className="marketing-page-light overflow-x-hidden"
      style={{ backgroundColor: "#ffffff" }}
    >
      <section className="pt-32 pb-24 lg:pt-36 lg:pb-32">
        <div className="marketing-container">
          <div className="marketing-rail">
            <header className="mx-auto max-w-[58rem] text-center">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-black/42">
                AI Semiconductor Agent
              </p>
              <h1 className="mx-auto mt-6 max-w-[15ch] font-display text-[clamp(2.2rem,3.7vw,4rem)] leading-[0.99] tracking-[-0.045em] text-black">
                <CharacterTextReveal text="Loading agent profile" />
              </h1>
            </header>
          </div>
        </div>
      </section>
    </div>
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const agent = getStockResearchAgent(SYMBOL, slug);

  if (!agent) {
    return { title: "Agent Profile" };
  }

  return {
    alternates: {
      canonical: `/our-agents/${getAgentSlug(agent)}`,
    },
    description: agent.summary,
    title: agent.name,
  };
}

async function OurAgentDetailContent({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  await connection();

  const { slug } = await params;
  const agent = await getVisibleStockResearchAgent(slug);

  if (!getStockCoverageEntry(SYMBOL) || !agent) {
    notFound();
  }

  const sections = buildAgentSections(agent);

  return (
    <div
      className="marketing-page-light overflow-x-hidden"
      style={{ backgroundColor: "#ffffff" }}
    >
      <section className="pt-32 pb-24 lg:pt-36 lg:pb-32">
        <div className="marketing-container">
          <div className="marketing-rail">
            <div className="mx-auto max-w-[78rem]">
              <header className="mx-auto max-w-[58rem] text-center">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-black/42">
                  AI Semiconductor Agent
                </p>
                <h1 className="mx-auto mt-6 max-w-[15ch] font-display text-[clamp(2.2rem,3.7vw,4rem)] leading-[0.99] tracking-[-0.045em] text-black">
                  <CharacterTextReveal text={agent.name} />
                </h1>
                <p className="mx-auto mt-8 max-w-[42rem] text-[1.08rem] leading-[1.95] text-black">
                  {agent.summary}
                </p>

                <div className="mx-auto mt-10 max-w-[60rem] pt-6">
                  <div className="flex flex-wrap items-start justify-center gap-x-8 gap-y-5 text-sm text-black/72 lg:gap-x-12">
                    <AgentStat label="Bounty" value={formatBounty(agent.bountyUsd)} />
                    <AgentStat
                      label="Base model"
                      value={formatBaseModelLabel(agent.llmModel)}
                    />
                  </div>

                  <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
                    <Link
                      href="/contact"
                      className="marketing-primary-button marketing-hero-button relative z-30 !min-w-0 !w-auto !rounded-none !px-6 sm:!px-7"
                    >
                      <span>Contact us</span>
                    </Link>
                    <Link
                      href="/our-agents"
                      className="marketing-secondary-button marketing-hero-button relative z-30 !min-w-0 !w-auto !rounded-none !px-6 sm:!px-7"
                    >
                      <span>Back to agents</span>
                    </Link>
                  </div>
                </div>
              </header>

              <article className="mx-auto mt-12 min-w-0 max-w-[42rem] pt-4 lg:mt-14 lg:max-w-[44rem] lg:pt-6">
                <div className="space-y-16 lg:space-y-20">
                  {sections.map((section) => (
                    <section key={section.heading}>
                      <h2 className="max-w-none font-display text-[clamp(1.75rem,2.45vw,2.65rem)] leading-[1.02] tracking-[-0.04em] text-black">
                        {section.heading}
                      </h2>
                      <div className="mt-7 space-y-7 text-[1.06rem] leading-[1.95] text-black lg:text-[1.08rem]">
                        {section.paragraphs.map((paragraph) => (
                          <p key={paragraph}>{paragraph}</p>
                        ))}
                      </div>
                    </section>
                  ))}

                  <section>
                    <h2 className="max-w-none font-display text-[clamp(1.75rem,2.45vw,2.65rem)] leading-[1.02] tracking-[-0.04em] text-black">
                      Structured Output
                    </h2>
                    <p className="mt-7 text-[1.06rem] leading-[1.95] text-black lg:text-[1.08rem]">
                      The agent returns stable structured packets so downstream ensemble
                      systems can compare revisions, cite sources, and preserve disagreement.
                    </p>
                    <pre className="mt-7 overflow-x-auto bg-black p-5 text-xs leading-relaxed text-white">
                      {agent.structuredOutputExample}
                    </pre>
                  </section>
                </div>
              </article>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

export default function OurAgentDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  return (
    <Suspense fallback={<AgentDetailFallback />}>
      <OurAgentDetailContent params={params} />
    </Suspense>
  );
}
