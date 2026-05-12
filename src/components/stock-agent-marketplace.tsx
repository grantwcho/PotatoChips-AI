"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, type KeyboardEvent } from "react";
import { AnimatedAsciiArt } from "@/components/animated-ascii-art";
import { CharacterTextReveal } from "@/components/character-text-reveal";
import { GPU_BINARY_ART } from "@/lib/gpu-ascii-art";
import { getBaseModelMetadata } from "@/lib/stocks/model-metadata";
import type {
  StockCoverageEntry,
  StockResearchAgent,
} from "@/lib/stocks/types";

const INDUSTRY_TITLE = "AI Semiconductors";

function formatBounty(amount: number | undefined): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount ?? 500);
}

function formatAgentDate(value: string | undefined): string {
  if (!value) {
    return "TBD";
  }

  const date = new Date(value.includes("T") ? value : `${value}T00:00:00Z`);

  if (Number.isNaN(date.getTime())) {
    return "TBD";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function formatOrthogonality(value: number | undefined): string {
  if (typeof value !== "number") {
    return "TBD";
  }

  return value.toFixed(2);
}

function formatMarginalShapley(value: number | undefined): string {
  if (typeof value !== "number") {
    return "TBD";
  }

  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 1,
    minimumFractionDigits: 1,
    signDisplay: "always",
    style: "percent",
  }).format(value);
}

type AgentSortKey =
  | "apiRequestCount"
  | "orthogonalityScore"
  | "marginalShapley"
  | "bountyUsd";
type SortDir = "asc" | "desc";

function sortValue(agent: StockResearchAgent, key: AgentSortKey): number {
  const value = agent[key];

  return typeof value === "number" ? value : Number.NEGATIVE_INFINITY;
}

function SortableTableHeader({
  description,
  label,
  sortKey,
  activeKey,
  dir,
  onSort,
}: {
  description?: string;
  label: string;
  sortKey: AgentSortKey;
  activeKey: AgentSortKey | null;
  dir: SortDir;
  onSort: (key: AgentSortKey) => void;
}) {
  const active = activeKey === sortKey;

  return (
    <th
      className="px-4 py-4 text-center"
      aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        aria-label={description ? `${label}. ${description}` : label}
        className="relative mx-auto inline-flex cursor-pointer select-none items-center justify-center text-center uppercase tracking-[0.22em] transition-colors hover:text-black/70"
        title={description}
      >
        <span>{label}</span>
        <span
          className={`absolute left-full ml-2 text-[9px] transition-opacity ${
            active ? "opacity-100" : "opacity-0"
          }`}
        >
          {dir === "asc" ? "▲" : "▼"}
        </span>
      </button>
    </th>
  );
}

function getDeveloperName(agent: StockResearchAgent): string {
  const submitter = agent.submitter;

  if (!submitter || submitter.anonymous) {
    return "Anonymous";
  }

  return submitter.name;
}

function getAgentSlug(agent: StockResearchAgent): string {
  if (agent.slug) {
    return agent.slug;
  }

  return (
    agent.handle
      .replace(/^PC-/i, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") ||
    agent.code
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") ||
    agent.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
  );
}

function BaseModelCell({ model }: { model: string | undefined }) {
  const metadata = getBaseModelMetadata(model);

  if (!metadata) {
    return <span>TBD</span>;
  }

  return (
    <div className="min-w-[8rem]">
      <p>{metadata.label}</p>
      {metadata.provider ? (
        <p className="mt-1 text-xs text-black/42 transition-colors duration-300 ease-in-out group-hover:text-white/70 group-focus-visible:text-white/70">
          {metadata.provider}
          {metadata.license ? ` · ${metadata.license}` : ""}
        </p>
      ) : null}
    </div>
  );
}

export function StockAgentMarketplace({
  emptyStateLabel = "No agents released yet.",
  profile,
}: {
  emptyStateLabel?: string;
  profile: StockCoverageEntry;
}) {
  const router = useRouter();
  const agents = profile.researchProgram?.agents;
  const [sortKey, setSortKey] = useState<AgentSortKey | null>("apiRequestCount");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  function handleSort(nextKey: AgentSortKey) {
    if (sortKey === nextKey) {
      setSortDir((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }

    setSortKey(nextKey);
    setSortDir("desc");
  }

  const sortedAgents = useMemo(() => {
    const sourceAgents = agents ?? [];

    if (!sortKey) {
      return sourceAgents;
    }

    return [...sourceAgents].sort((a, b) => {
      const diff = sortValue(a, sortKey) - sortValue(b, sortKey);

      return sortDir === "asc" ? diff : -diff;
    });
  }, [agents, sortDir, sortKey]);

  function openAgent(agentHref: string) {
    router.push(agentHref);
  }

  function handleAgentKeyDown(
    event: KeyboardEvent<HTMLTableRowElement>,
    agentHref: string
  ) {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    event.preventDefault();
    openAgent(agentHref);
  }

  return (
    <div
      className="marketing-page-light overflow-x-hidden"
      style={{ backgroundColor: "#ffffff" }}
    >
      <section className="pt-32 pb-16 lg:pt-36 lg:pb-20">
        <div className="marketing-container">
          <div className="marketing-rail">
            <div className="mx-auto grid max-w-[88rem] items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.62fr)] lg:gap-16">
              <header className="min-w-0 text-left">
                <p className="marketing-kicker marketing-fade-up">Industry</p>
                <h1 className="mt-8 whitespace-normal font-display text-[clamp(3rem,5vw,5.75rem)] leading-[0.95] tracking-[-0.045em] text-black lg:whitespace-nowrap">
                  <CharacterTextReveal text={INDUSTRY_TITLE} />
                </h1>

                <div className="marketing-fade-up marketing-fade-up-delay-2 mt-10 flex justify-start">
                  <Link
                    href="/contact"
                    className="marketing-primary-button marketing-hero-button relative z-30 !min-w-0 !rounded-none !px-6 sm:!px-7"
                    style={{ width: "fit-content" }}
                  >
                    <span>Contact us</span>
                  </Link>
                </div>
              </header>

              <div
                className="hidden min-w-0 justify-end overflow-hidden lg:flex"
                role="img"
                aria-label="ASCII rendering of an AI semiconductor accelerator card."
              >
                <AnimatedAsciiArt
                  art={GPU_BINARY_ART}
                  className="ml-auto whitespace-pre bg-transparent p-0 text-left font-mono text-[5px] leading-[0.92] text-black/78 xl:text-[6px] 2xl:text-[7px]"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="pb-24 lg:pb-32">
        <div className="marketing-container">
          <div className="marketing-rail">
            <div className="mx-auto max-w-[88rem] overflow-x-auto">
              <table className="w-full min-w-[78rem] border-t border-black/10 text-left">
                <thead>
                  <tr className="border-b border-black/10 text-[11px] font-semibold uppercase tracking-[0.22em] text-black/48">
                    <th className="px-4 py-4">Agent</th>
                    <th className="px-4 py-4">Research</th>
                    <th className="px-4 py-4 text-left">Submitted / Updated</th>
                    <SortableTableHeader
                      label="Orthogonality"
                      description="Average correlation of this agent's prediction errors with the rest of the roster, inverted so higher means more independent."
                      sortKey="orthogonalityScore"
                      activeKey={sortKey}
                      dir={sortDir}
                      onSort={handleSort}
                    />
                    <SortableTableHeader
                      label="Marginal Shapley"
                      description="Average lift this agent contributes when it is in the ensemble versus when it is not."
                      sortKey="marginalShapley"
                      activeKey={sortKey}
                      dir={sortDir}
                      onSort={handleSort}
                    />
                    <SortableTableHeader
                      label="Bounty"
                      sortKey="bountyUsd"
                      activeKey={sortKey}
                      dir={sortDir}
                      onSort={handleSort}
                    />
                    <th className="px-4 py-4">Base Model</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedAgents.length === 0 ? (
                    <tr>
                      <td
                        colSpan={7}
                        className="h-48 px-4 text-center align-middle text-sm text-black/50"
                      >
                        {emptyStateLabel}
                      </td>
                    </tr>
                  ) : (
                    sortedAgents.map((agent) => {
                      const agentHref = `/our-agents/${getAgentSlug(agent)}`;

                      return (
                        <tr
                          key={agent.code}
                          data-href={agentHref}
                          tabIndex={0}
                          role="link"
                          aria-label={`View ${agent.name} details`}
                          onClick={() => openAgent(agentHref)}
                          onKeyDown={(event) => handleAgentKeyDown(event, agentHref)}
                          className="group cursor-pointer border-b border-black/8 transition-colors duration-300 ease-in-out hover:bg-black focus-visible:bg-black focus-visible:outline-none"
                        >
                          <td className="px-4 py-5 align-middle">
                            <div className="max-w-[15rem]">
                              <p className="text-sm font-semibold text-black transition-colors duration-300 ease-in-out group-hover:text-white group-focus-visible:text-white">
                                {agent.name}
                              </p>
                              <p className="mt-1 text-xs font-medium text-black/42 transition-colors duration-300 ease-in-out group-hover:text-white group-focus-visible:text-white">
                                {getDeveloperName(agent)}
                              </p>
                            </div>
                          </td>
                          <td className="px-4 py-5 align-middle text-sm leading-6 text-black/66 transition-colors duration-300 ease-in-out group-hover:text-white group-focus-visible:text-white">
                            {agent.researchType ?? agent.role}
                          </td>
                          <td className="px-4 py-5 align-middle">
                            <div className="min-w-[9rem]">
                              <p className="text-sm font-medium text-black/72 transition-colors duration-300 ease-in-out group-hover:text-white group-focus-visible:text-white">
                                Updated {formatAgentDate(agent.updatedAt ?? agent.submittedAt)}
                              </p>
                              <p className="mt-1 text-xs font-medium text-black/42 transition-colors duration-300 ease-in-out group-hover:text-white group-focus-visible:text-white">
                                Submitted {formatAgentDate(agent.submittedAt)}
                              </p>
                            </div>
                          </td>
                          <td className="px-4 py-5 align-middle text-center font-mono text-sm text-black/72 transition-colors duration-300 ease-in-out group-hover:text-white group-focus-visible:text-white">
                            {formatOrthogonality(agent.orthogonalityScore)}
                          </td>
                          <td className="px-4 py-5 align-middle text-center font-mono text-sm text-black/72 transition-colors duration-300 ease-in-out group-hover:text-white group-focus-visible:text-white">
                            {formatMarginalShapley(agent.marginalShapley)}
                          </td>
                          <td className="px-4 py-5 align-middle text-center font-mono text-sm text-black/72 transition-colors duration-300 ease-in-out group-hover:text-white group-focus-visible:text-white">
                            {formatBounty(agent.bountyUsd)}
                          </td>
                          <td className="px-4 py-5 align-middle text-sm text-black/66 transition-colors duration-300 ease-in-out group-hover:text-white group-focus-visible:text-white">
                            <BaseModelCell model={agent.llmModel} />
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
