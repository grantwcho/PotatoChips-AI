import type {
  StockResearchAgent,
  StockResearchProgram,
} from "@/lib/stocks/types";

function ProgramMetric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-[1.5rem] border border-black/10 bg-black/[0.02] p-5">
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-black/42">
        {label}
      </p>
      <p className="mt-3 text-3xl font-semibold tracking-[-0.05em] text-black">{value}</p>
      <p className="mt-2 text-sm leading-relaxed text-black/60">{detail}</p>
    </div>
  );
}

function AgentList({
  title,
  items,
}: {
  title: string;
  items: string[];
}) {
  return (
    <div className="rounded-[1.5rem] border border-black/10 p-5">
      <h4 className="text-[10px] font-semibold uppercase tracking-[0.18em] text-black/42">
        {title}
      </h4>
      <ul className="mt-4 space-y-2 text-sm leading-relaxed text-black/72">
        {items.map((item) => (
          <li key={item} className="border-t border-black/6 pt-2 first:border-t-0 first:pt-0">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ResearchLoop({ agent }: { agent: StockResearchAgent }) {
  return (
    <div className="rounded-[1.5rem] border border-black/10 p-5">
      <h4 className="text-[10px] font-semibold uppercase tracking-[0.18em] text-black/42">
        Research loop
      </h4>
      <div className="mt-4 space-y-3">
        {agent.researchLoop.map((step) => (
          <div key={`${agent.code}-${step.cadence}`} className="border-t border-black/6 pt-3 first:border-t-0 first:pt-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-black/48">
              {step.cadence}
            </p>
            <p className="mt-2 text-sm leading-relaxed text-black/72">{step.description}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function AgentCard({ agent }: { agent: StockResearchAgent }) {
  const statusLabel = agent.status === "live" ? "Prompt installed" : "Queued";

  return (
    <article className="rounded-[2rem] border border-black/10 p-6 lg:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-3xl">
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-black/42">
              {agent.code} / {agent.handle}
            </p>
            <span className="rounded-full border border-emerald-600/18 bg-emerald-600/8 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-700">
              {statusLabel}
            </span>
          </div>
          <h3 className="mt-4 text-[clamp(1.8rem,2.5vw,2.35rem)] font-semibold tracking-[-0.04em] text-black">
            {agent.name}
          </h3>
          <p className="mt-3 text-sm font-semibold uppercase tracking-[0.16em] text-black/46">
            {agent.role}
          </p>
          <p className="mt-5 text-base leading-relaxed text-black/76">{agent.summary}</p>
        </div>

        <div className="max-w-sm rounded-[1.5rem] border border-black/10 bg-black/[0.02] p-5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-black/42">
            Coverage focus
          </p>
          <p className="mt-3 text-lg font-semibold tracking-[-0.03em] text-black">
            {agent.focus}
          </p>
          <p className="mt-3 text-sm leading-relaxed text-black/64">
            {agent.roleDescription}
          </p>
        </div>
      </div>

      <div className="mt-8 grid gap-4 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <div className="rounded-[1.5rem] border border-black/10 p-5">
          <h4 className="text-[10px] font-semibold uppercase tracking-[0.18em] text-black/42">
            Communication style
          </h4>
          <p className="mt-4 text-sm leading-relaxed text-black/72">
            {agent.communicationStyle}
          </p>
        </div>

        <div className="rounded-[1.5rem] border border-black/10 p-5">
          <h4 className="text-[10px] font-semibold uppercase tracking-[0.18em] text-black/42">
            Natural-language output
          </h4>
          <p className="mt-4 text-sm leading-relaxed text-black/72">
            {agent.naturalLanguageFormat}
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <AgentList title="Data sources" items={agent.dataSources} />
        <AgentList title="Collaboration" items={agent.collaboration} />
        <AgentList title="What you do not do" items={agent.guardrails} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <ResearchLoop agent={agent} />

        <div className="rounded-[1.5rem] border border-black/10 p-5">
          <h4 className="text-[10px] font-semibold uppercase tracking-[0.18em] text-black/42">
            Structured output
          </h4>
          <p className="mt-4 text-sm leading-relaxed text-black/64">
            JSON packet for SYNTH consumption. Keep fields stable so downstream
            workflows can diff revisions and compare packets across specialists.
          </p>
          <pre className="mt-4 overflow-x-auto rounded-[1.25rem] bg-[#0f172a] p-4 text-xs leading-relaxed text-slate-100">
            {agent.structuredOutputExample}
          </pre>
        </div>
      </div>

      <details className="mt-4 rounded-[1.5rem] border border-black/10 p-5">
        <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-[0.18em] text-black/56">
          Verbatim system prompt
        </summary>
        <pre className="mt-4 overflow-x-auto whitespace-pre-wrap text-sm leading-relaxed text-black/74">
          {agent.fullPrompt}
        </pre>
      </details>
    </article>
  );
}

export function StockResearchRoster({
  program,
}: {
  program: StockResearchProgram;
}) {
  return (
    <section className="border-t border-black/10 pt-8">
      <div className="grid gap-8 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="max-w-3xl">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-black/42">
            Research program
          </p>
          <h2 className="mt-4 text-[clamp(2rem,3.2vw,3.2rem)] font-semibold tracking-[-0.05em] text-black">
            {program.title}
          </h2>
          <p className="mt-5 text-base leading-relaxed text-black/72">{program.summary}</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <ProgramMetric
            label="Prompts live"
            value={`${program.activeAgents}/${program.totalAgents}`}
            detail="Production-ready specialist prompts currently installed on the page."
          />
          <ProgramMetric
            label="Specialists"
            value={String(program.specialists)}
            detail="Independent lanes designed to disagree when the evidence disagrees."
          />
          <ProgramMetric
            label="Synthesis"
            value={String(program.synthesisAgents)}
            detail="Only the synthesis layer should speak directly to the public research page."
          />
          <ProgramMetric
            label="Output contract"
            value="JSON + brief"
            detail="Every specialist emits machine-readable packets plus a concise human brief."
          />
        </div>
      </div>

      <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {program.principles.map((principle) => (
          <div
            key={principle.title}
            className="rounded-[1.5rem] border border-black/10 bg-black/[0.02] p-5"
          >
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-black/42">
              Principle
            </p>
            <h3 className="mt-3 text-lg font-semibold tracking-[-0.03em] text-black">
              {principle.title}
            </h3>
            <p className="mt-3 text-sm leading-relaxed text-black/64">
              {principle.description}
            </p>
          </div>
        ))}
      </div>

      <div className="mt-10 space-y-8">
        {program.agents.map((agent) => (
          <AgentCard key={agent.code} agent={agent} />
        ))}
      </div>
    </section>
  );
}
