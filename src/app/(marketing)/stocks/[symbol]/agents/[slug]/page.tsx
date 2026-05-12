import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CharacterTextReveal } from "@/components/character-text-reveal";
import {
  getStockCoverageEntry,
  getStockCoverageUniverse,
  getStockResearchAgent,
} from "@/lib/stocks/coverage-data";
import type { StockResearchAgent } from "@/lib/stocks/types";

function formatStatus(status: StockResearchAgent["status"]) {
  return status === "live" ? "Live" : "Planned";
}

function buildAgentSections(agent: StockResearchAgent) {
  return [
    {
      heading: "What this agent covers",
      paragraphs: [
        agent.summary,
        agent.roleDescription,
        `Coverage focus: ${agent.focus}.`,
      ],
    },
    {
      heading: "Primary source map",
      paragraphs: agent.dataSources,
    },
    {
      heading: "Research cadence",
      paragraphs: agent.researchLoop.map(
        (step) => `${step.cadence}. ${step.description}`
      ),
    },
    {
      heading: "Output and collaboration",
      paragraphs: [
        agent.naturalLanguageFormat,
        "Machine-readable output stays stable so revisions can be compared cleanly over time and across coverage lanes.",
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

export async function generateStaticParams() {
  const params = getStockCoverageUniverse().flatMap((entry) =>
    (entry.researchProgram?.agents ?? []).map((agent) => ({
      symbol: entry.symbol.toLowerCase(),
      slug: agent.slug ?? "",
    }))
  );

  return params.length > 0
    ? params
    : [{ symbol: "__placeholder__", slug: "__placeholder__" }];
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ symbol: string; slug: string }>;
}): Promise<Metadata> {
  const { symbol, slug } = await params;
  const profile = getStockCoverageEntry(symbol);
  const agent = getStockResearchAgent(symbol, slug);

  if (!profile || !agent) {
    return { title: "Agent Profile" };
  }

  return {
    title: `${agent.name} | ${profile.companyName} Agent Profile`,
    description: agent.summary,
  };
}

export default async function StockResearchAgentPage({
  params,
}: {
  params: Promise<{ symbol: string; slug: string }>;
}) {
  const { symbol, slug } = await params;
  const profile = getStockCoverageEntry(symbol);
  const agent = getStockResearchAgent(symbol, slug);

  if (!profile || !agent) {
    notFound();
  }

  const sections = buildAgentSections(agent);

  return (
    <div className="marketing-page-light" style={{ backgroundColor: "#ffffff" }}>
      <section className="pt-40 pb-24 lg:pt-44 lg:pb-32">
        <div className="marketing-container">
          <div className="marketing-rail">
            <div className="mx-auto max-w-[78rem]">
              <header className="mx-auto max-w-[58rem] text-center">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-black/42">
                  Dedicated agent profile
                </p>
                <h1 className="mx-auto mt-6 max-w-[14ch] font-display text-[clamp(2.2rem,3.7vw,4rem)] leading-[0.99] tracking-[-0.045em] text-balance text-black">
                  <CharacterTextReveal text={agent.name} />
                </h1>
                <p className="mx-auto mt-8 max-w-[42rem] text-[1.08rem] leading-[1.95] text-black/68">
                  {agent.summary}
                </p>

                <div className="mx-auto mt-10 max-w-[54rem] pt-6">
                  <div className="flex flex-wrap items-start justify-center gap-x-8 gap-y-5 text-sm text-black/72 lg:gap-x-12">
                    <div className="min-w-[8rem]">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-black/42">
                        Handle
                      </p>
                      <p className="mt-2 text-black">{agent.handle}</p>
                    </div>
                    <div className="min-w-[8rem]">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-black/42">
                        Coverage
                      </p>
                      <p className="mt-2 text-black">{agent.focus}</p>
                    </div>
                    <div className="min-w-[8rem]">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-black/42">
                        Company
                      </p>
                      <p className="mt-2 text-black">
                        {profile.companyName} ({profile.symbol})
                      </p>
                    </div>
                    <div className="min-w-[8rem]">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-black/42">
                        Status
                      </p>
                      <p className="mt-2 text-black">{formatStatus(agent.status)}</p>
                    </div>
                  </div>
                </div>
              </header>

              <article className="mx-auto mt-10 min-w-0 max-w-[42rem] pt-4 lg:mt-12 lg:max-w-[44rem] lg:pt-6">
                <div className="space-y-16 lg:space-y-20">
                  {sections.map((section) => (
                    <section key={section.heading}>
                      <h2 className="max-w-[16ch] font-display text-[clamp(1.75rem,2.45vw,2.65rem)] leading-[1.02] tracking-[-0.04em] text-black">
                        {section.heading}
                      </h2>
                      <div className="mt-7 space-y-7 text-[1.06rem] leading-[1.95] text-black/74 lg:text-[1.08rem]">
                        {section.paragraphs.map((paragraph) => (
                          <p key={paragraph}>{paragraph}</p>
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              </article>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
