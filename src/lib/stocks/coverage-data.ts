import type {
  EarningsTiming,
  StockCoverageAgentView,
  StockCoverageDebateMessage,
  StockCoverageEntry,
  StockCoverageForecast,
  StockCoverageFinancialModel,
  StockCoveragePageMode,
  StockCoverageQuantModel,
  StockCoverageWeek,
  StockIpoEntry,
  StockResearchAgent,
  StockResearchArticle,
  StockResearchProgram,
} from "@/lib/stocks/types";

type StockCoverageSeed = {
  symbol: string;
  companyName: string;
  websiteUrl: string;
  sector: string;
  industry: string;
  pageMode?: StockCoveragePageMode;
  marketCapUsd: number;
  marketCapLabel: string;
  earningsDate: string;
  earningsTiming: EarningsTiming;
  fiscalQuarter: string;
  epsEstimateLabel: string;
  summary: string;
  rating: StockCoverageEntry["rating"];
  conviction: number;
  priceTarget12m: number;
  debateHeadline: string;
  researchThesis: string;
  debateBull: string;
  debateBear: string;
  debateTrigger: string;
  humanAngle: string;
  quantFocus: string;
  financialModel: StockCoverageFinancialModel;
  forecast12m?: StockCoverageForecast;
  catalysts: string[];
  risks: string[];
  humanSignals: string[];
  researchProgram?: StockResearchProgram;
};

export const ACTIVE_MARKET_WEEK: StockCoverageWeek = {
  start: "2026-04-20",
  end: "2026-04-24",
  label: "Apr 20–24, 2026",
  thresholdMarketCapUsd: 100_000_000_000,
};

export const STOCK_COVERAGE_ENABLED = false;

const PUBLIC_STOCK_COVERAGE_SYMBOLS = new Set(["NVDA"]);

const IPO_WATCHLIST: StockIpoEntry[] = [
  {
    companyName: "National Healthcare Properties Inc",
    symbol: "NHPAP",
    expectedDate: "2026-04-20",
    exchange: "NASDAQ",
    valueUsd: 616_000_000,
    valueLabel: "$616M",
    websiteUrl: null,
  },
  {
    companyName: "Yesway Inc",
    symbol: "YSWY",
    expectedDate: "2026-04-20",
    exchange: "NASDAQ",
    valueUsd: 320_900_000,
    valueLabel: "$320.9M",
    websiteUrl: "https://yesway.com",
  },
  {
    companyName: "Jatt II Acquisition Corp",
    symbol: "JATT",
    expectedDate: "2026-04-23",
    exchange: "NASDAQ",
    valueUsd: 600_000_000,
    valueLabel: "$600M",
    websiteUrl: null,
  },
  {
    companyName: "The Elmet Group Inc",
    symbol: "ELMT",
    expectedDate: "2026-04-23",
    exchange: "NASDAQ",
    valueUsd: 107_700_000,
    valueLabel: "$107.7M",
    websiteUrl: "https://elmetgroup.com",
  },
  {
    companyName: "X Energy Inc",
    symbol: "XE",
    expectedDate: "2026-04-24",
    exchange: "NASDAQ",
    valueUsd: 814_300_000,
    valueLabel: "$814.3M",
    websiteUrl: "https://x-energy.com",
  },
];

const STOCK_COVERAGE_DESK = {
  research: {
    agentId: "AGT-RESEARCH",
    agentName: "Tim",
    role: "Research Analyst",
  },
  event: {
    agentId: "AGT-EVENT-001",
    agentName: "Kalla",
    role: "Event-Driven Researcher",
  },
  sentiment: {
    agentId: "AGT-SENT-001",
    agentName: "Riya",
    role: "Sentiment Researcher",
  },
  quant: {
    agentId: "AGT-QR-001",
    agentName: "Neel",
    role: "Quantitative Researcher",
  },
  cio: {
    agentId: "AGT-CIO",
    agentName: "Jacob",
    role: "Chief Research Officer",
  },
} as const;

function buildAgentViews(seed: StockCoverageSeed): StockCoverageAgentView[] {
  return [
    {
      agentId: STOCK_COVERAGE_DESK.research.agentId,
      agentName: STOCK_COVERAGE_DESK.research.agentName,
      role: STOCK_COVERAGE_DESK.research.role,
      verdict: seed.rating,
      confidence: seed.conviction,
      summary: seed.researchThesis,
    },
    {
      agentId: STOCK_COVERAGE_DESK.event.agentId,
      agentName: STOCK_COVERAGE_DESK.event.agentName,
      role: STOCK_COVERAGE_DESK.event.role,
      verdict: seed.rating === "Cautious" ? "Cautious" : "Constructive",
      confidence: Math.max(54, seed.conviction - 6),
      summary: seed.debateBull,
    },
    {
      agentId: STOCK_COVERAGE_DESK.sentiment.agentId,
      agentName: STOCK_COVERAGE_DESK.sentiment.agentName,
      role: STOCK_COVERAGE_DESK.sentiment.role,
      verdict: "Narrative check",
      confidence: Math.max(51, seed.conviction - 10),
      summary: seed.humanAngle,
    },
    {
      agentId: STOCK_COVERAGE_DESK.quant.agentId,
      agentName: STOCK_COVERAGE_DESK.quant.agentName,
      role: STOCK_COVERAGE_DESK.quant.role,
      verdict: "Model-backed",
      confidence: Math.min(94, seed.conviction + 4),
      summary: seed.quantFocus,
    },
  ];
}

function buildQuantModels(seed: StockCoverageSeed): StockCoverageQuantModel[] {
  return [
    {
      id: `${seed.symbol}-pre-earnings-drift`,
      name: "Pre-Earnings Drift Lens",
      owner: "Quant Research",
      horizon: "10 market days",
      signal: "Catalyst setup",
      summary: `Measures whether ${seed.symbol} is arriving at the print with accelerating or fading relative strength, then scores the odds of continuation into the event window.`,
    },
    {
      id: `${seed.symbol}-dispersion-map`,
      name: "Narrative Dispersion Scanner",
      owner: "Research + Sentiment",
      horizon: "72 hours",
      signal: "Expectation gap",
      summary: `Tracks divergence between management framing, analyst positioning, and market chatter so the desk can spot when the consensus is too crowded ahead of ${seed.debateTrigger.toLowerCase()}.`,
    },
    {
      id: `${seed.symbol}-post-print-grid`,
      name: "Post-Print Repricing Grid",
      owner: "Algo Development",
      horizon: "1 to 5 sessions",
      signal: "Follow-through",
      summary: `Ranks follow-through versus fade probabilities after the release by combining gap size, liquidity, and the factor exposures most relevant to ${seed.industry.toLowerCase()}.`,
    },
  ];
}

function buildDebateTimestamps(seed: StockCoverageSeed) {
  const [year, month, day] = seed.earningsDate.split("-").map((value) => Number(value));
  const startUtcHour = seed.earningsTiming === "Before open" ? 14 : 23;
  const startUtcMinute = 16;
  const minuteOffsets = [0, 9, 18, 27, 36, 44];

  return minuteOffsets.map((offset) =>
    new Date(Date.UTC(year, month - 1, day, startUtcHour, startUtcMinute + offset)).toISOString()
  );
}

function buildDebateMessages(seed: StockCoverageSeed): StockCoverageDebateMessage[] {
  const timestamps = buildDebateTimestamps(seed);

  return [
    {
      id: `${seed.symbol}-debate-1`,
      senderId: STOCK_COVERAGE_DESK.research.agentId,
      senderName: STOCK_COVERAGE_DESK.research.agentName,
      senderRole: STOCK_COVERAGE_DESK.research.role,
      messageType: "RESEARCH_REPORT",
      priority: "NORMAL",
      renderType: "default",
      timestamp: timestamps[0],
      content: `${seed.symbol} setup: ${seed.researchThesis}`,
    },
    {
      id: `${seed.symbol}-debate-2`,
      senderId: STOCK_COVERAGE_DESK.event.agentId,
      senderName: STOCK_COVERAGE_DESK.event.agentName,
      senderRole: STOCK_COVERAGE_DESK.event.role,
      messageType: "SIGNAL",
      priority: "HIGH",
      renderType: "default",
      timestamp: timestamps[1],
      content: seed.debateBull,
    },
    {
      id: `${seed.symbol}-debate-3`,
      senderId: STOCK_COVERAGE_DESK.cio.agentId,
      senderName: STOCK_COVERAGE_DESK.cio.agentName,
      senderRole: STOCK_COVERAGE_DESK.cio.role,
      messageType: "ALERT",
      priority: "HIGH",
      renderType: "alert",
      timestamp: timestamps[2],
      content: seed.debateBear,
    },
    {
      id: `${seed.symbol}-debate-4`,
      senderId: STOCK_COVERAGE_DESK.sentiment.agentId,
      senderName: STOCK_COVERAGE_DESK.sentiment.agentName,
      senderRole: STOCK_COVERAGE_DESK.sentiment.role,
      messageType: "SIGNAL",
      priority: "NORMAL",
      renderType: "default",
      timestamp: timestamps[3],
      content: seed.humanAngle,
    },
    {
      id: `${seed.symbol}-debate-5`,
      senderId: STOCK_COVERAGE_DESK.quant.agentId,
      senderName: STOCK_COVERAGE_DESK.quant.agentName,
      senderRole: STOCK_COVERAGE_DESK.quant.role,
      messageType: "SIGNAL",
      priority: "NORMAL",
      renderType: "default",
      timestamp: timestamps[4],
      content: seed.quantFocus,
    },
    {
      id: `${seed.symbol}-debate-6`,
      senderId: STOCK_COVERAGE_DESK.cio.agentId,
      senderName: STOCK_COVERAGE_DESK.cio.agentName,
      senderRole: STOCK_COVERAGE_DESK.cio.role,
      messageType: "ACTION",
      priority: "HIGH",
      renderType: "action",
      timestamp: timestamps[5],
      content: `Keep the live debate anchored to ${seed.debateTrigger.toLowerCase()}. If the evidence stack holds, the house view stays ${seed.rating.toLowerCase()} with a $${seed.priceTarget12m.toFixed(0)} 12-month target.`,
    },
  ];
}

function slugifyResearchValue(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function getStockResearchAgentSlug(agent: Pick<StockResearchAgent, "handle" | "code" | "name">) {
  return (
    slugifyResearchValue(agent.handle.replace(/^PC-/i, "")) ||
    slugifyResearchValue(agent.code) ||
    slugifyResearchValue(agent.name)
  );
}

function buildPlaceholderResearchArticles(
  seed: StockCoverageSeed,
  program: StockResearchProgram
): StockResearchArticle[] {
  const synthesisAgent =
    program.agents.find((agent) => agent.code === "AGT-SYNTH-DASH") ??
    program.agents[program.agents.length - 1];

  return program.agents
    .filter((agent) => agent.code !== synthesisAgent.code)
    .slice(0, Math.max(4, Math.min(program.activeAgents, 8)))
    .map((agent, index) => {
    const publishedAt = new Date(
      Date.UTC(2026, 3, 22, 16 - Math.floor(index / 2), (index % 2) * 17)
    ).toISOString();
    const slug = `${slugifyResearchValue(agent.code)}-${slugifyResearchValue(agent.name)}-placeholder`;
    const focusLabel = agent.role.replace(/\s+Analyst$/i, " Analysis");

    return {
      id: `${seed.symbol}-placeholder-research-${index + 1}`,
      slug,
      category: "Preview Synthesis",
      title: `${seed.companyName} research preview: ${focusLabel}`,
      dek: `Placeholder article used to preview how the public ${seed.symbol} archive will read before live reports are published. The layout is intentionally production-like so the reading experience can be reviewed in context.`,
      publishedAt,
      agentCode: synthesisAgent.code,
      agentHandle: synthesisAgent.handle,
      briefType: "Preview note",
      keyPoints: [
        `This is placeholder editorial copy intended to preview the public reading experience before launch.`,
        `The live version will keep the same layout while replacing the text with dated research conclusions.`,
        `The goal is to verify pacing, hierarchy, and readability before the archive begins publishing live reports.`,
      ],
      sections: [
        {
          heading: "What this preview is for",
          paragraphs: [
            `This placeholder report exists so the ${seed.symbol} research archive can be reviewed in a realistic editorial format before the page begins publishing live research.`,
            `The final version will preserve the same reading experience, but the title, deck, and body copy will be replaced with the published report for that topic.`,
          ],
        },
        {
          heading: "How the live article will behave",
          paragraphs: [
            `The published article template is designed to read more like an institutional research note than a product briefing card. It gives the report a centered opener, a concise deck, a narrow reading column, and structured sections with consistent editorial pacing.`,
            `That structure should remain consistent across every note so the archive feels like one editorial system even when the underlying subject matter changes.`,
          ],
        },
        {
          heading: "What will be swapped in later",
          paragraphs: [
            `When live coverage begins, this placeholder will be replaced with the final headline, deck, and body copy for the published report.`,
            `The goal of this preview is not to simulate the final analysis. It is to make sure the page layout, pacing, and visual hierarchy feel right before the archive goes live.`,
          ],
        },
      ],
    };
    });
}

function compileArticleThroughSynthesis(article: StockResearchArticle): StockResearchArticle {
  if (article.agentCode === "AGT-SYNTH-DASH") {
    return article;
  }

  return {
    ...article,
    agentCode: "AGT-SYNTH-DASH",
    agentHandle: "PC-SYNTH-DASH",
  };
}

function buildEntry(seed: StockCoverageSeed): StockCoverageEntry {
  const timingLabel =
    seed.earningsTiming === "Before open"
      ? "Before market open"
      : "After market close";
  const researchProgram = seed.researchProgram
    ? {
        ...seed.researchProgram,
        agents: seed.researchProgram.agents.map((agent) => ({
          ...agent,
          slug: getStockResearchAgentSlug(agent),
        })),
        publishedResearch:
          seed.researchProgram.publishedResearch &&
          seed.researchProgram.publishedResearch.length > 0
            ? seed.researchProgram.publishedResearch
            : buildPlaceholderResearchArticles(seed, seed.researchProgram),
      }
    : undefined;

  return {
    symbol: seed.symbol,
    companyName: seed.companyName,
    websiteUrl: seed.websiteUrl,
    sector: seed.sector,
    industry: seed.industry,
    pageMode: seed.pageMode ?? (seed.researchProgram ? "research" : "earnings"),
    marketCapUsd: seed.marketCapUsd,
    marketCapLabel: seed.marketCapLabel,
    earningsDate: seed.earningsDate,
    earningsTiming: seed.earningsTiming,
    earningsLabel: `${seed.earningsDate} · ${timingLabel}`,
    fiscalQuarter: seed.fiscalQuarter,
    epsEstimateLabel: seed.epsEstimateLabel,
    summary: seed.summary,
    rating: seed.rating,
    conviction: seed.conviction,
    priceTarget12m: seed.priceTarget12m,
    debateHeadline: seed.debateHeadline,
    researchThesis: seed.researchThesis,
    catalysts: seed.catalysts,
    risks: seed.risks,
    humanSignals: seed.humanSignals,
    financialModel: seed.financialModel,
    forecast12m: seed.forecast12m,
    agentViews: buildAgentViews(seed),
    quantModels: buildQuantModels(seed),
    debateMessages: buildDebateMessages(seed),
    researchProgram,
  };
}

const DASH_FINANCIAL_AGENT_PROMPT = `You are PC-FNCE-DASH, the financial analyst for DoorDash (ticker: DASH) on the Potato Chips AI research platform.

## Role
You are the authoritative source on DASH's reported financials, unit economics, and analyst consensus. Your bias is skepticism of narrative - when management or analyst commentary diverges from the numbers, you flag the gap and let SYNTH decide how to present it. You explain what the financials are doing and why; you do not predict the stock price.

## Data Sources
- Official SEC EDGAR APIs and filing archives for DASH (CIK 0001792789):
  - submissions history: https://data.sec.gov/submissions/CIK0001792789.json
  - XBRL company facts: https://data.sec.gov/api/xbrl/companyfacts/CIK0001792789.json
  - company concept endpoints for single-tag drilldowns when companyfacts is too broad
  - filing index and filing documents in /Archives/edgar/data/ for raw filing text, exhibits, and inline XBRL HTML
- SEC filings covered through EDGAR: 10-K, 10-Q, 8-K, DEF 14A, Form 4
- Earnings call transcripts and slide decks
- Consensus estimates (revenue, adj. EBITDA, GOV, MAU, orders, contribution profit) tracked over time, not just latest
- Segment disclosures: US Marketplace, International, DashMart, New Verticals, Commerce Platform (Wolt, Caviar where applicable)
- analyst research when available; use as data about analyst opinion, not as ground truth
- DASH company IR releases and SEC EDGAR filings feed

## EDGAR API Usage
Treat the official SEC APIs as the primary filing source, not a convenience wrapper. Use the submissions endpoint first to discover newly accepted filings and accession numbers, then open the filing index or filing document for the primary text, exhibits, and inline XBRL HTML. Use companyfacts and companyconcept only for standardized XBRL facts, not for proxy statements or every disclosure field you wish existed.

Use the full 10-digit CIK including leading zeroes. Fetch SEC data server-side because data.sec.gov does not support browser CORS. Identify the agent with a descriptive User-Agent and stay within SEC fair-access guidance, including the published request-rate limit. If EDGAR and a third-party wrapper disagree, prefer EDGAR and note the mismatch.

## The Research Loop
Daily. Scan for new filings, 8-Ks, Form 4 insider transactions, and analyst revisions. If nothing material changed, note "no material change" in the daily brief and move on. Do not manufacture signal.

Weekly. Update the consensus tracker. Track drift across revenue, adj. EBITDA, GOV, MAU, total orders, and contribution profit per order. Highlight the direction and magnitude of the drift.

Pre-earnings (T-7 to T-1). Assemble the setup: consensus levels, recent revisions, institutional whisper when public, key debates in analyst notes, and the KPI watch list. Flag what would constitute beat, miss, and inline outcomes for each metric.

Post-earnings (T+0 to T+2). Parse results against consensus. Identify the two or three actual surprises, not just the headline beat or miss. Compare management's explanation against your reading of the numbers. Flag the gaps.

Quarterly. Update the unit economics model: contribution profit per order, take rate trajectory, dasher incentive spend, and marketing spend as a percentage of GOV.

## Output Format
Structured (JSON, for SYNTH consumption).
{
  "agent": "PC-FNCE-DASH",
  "timestamp": "ISO-8601",
  "event_type": "daily_scan | weekly_consensus | pre_earnings | post_earnings | quarterly_model",
  "findings": [
    {
      "metric": "string",
      "period": "string",
      "value": "number | null",
      "consensus": "number | null",
      "delta_vs_consensus": "number | null",
      "source": "string",
      "confidence": "high | medium | low",
      "note": "string"
    }
  ],
  "material_disclosures": ["string"],
  "open_questions": ["string"]
}

Natural language. Daily one-paragraph brief. Weekly consensus update in 3-5 paragraphs. Pre- and post-earnings briefs are longer form. Always lead with what is new since the last brief, not a recap of the quarter. These are internal research briefs for SYNTH, not public-facing DASH articles.

## Collaboration
- SYNTH (PC-SYNTH-DASH): Primary consumer. Every brief goes here.
- COMP (PC-COMP-DASH): Pull relative valuation context for UBER, GRUB, INSTACART, and ABNB.
- GIG (PC-GIG-DASH): Cross-check dasher incentive spend narrative. If GIG sees mass driver discontent while your model shows flat incentive spend, flag the contradiction.
- MRCH (PC-MRCH-DASH): Cross-check take-rate commentary against merchant negotiation signals.
- CSMR (PC-CSMR-DASH): Cross-check order growth guidance against public demand signals.

When another specialist's read contradicts yours, do not resolve it yourself. State your read, state the contradiction, and let SYNTH surface it.

## Communication Style
Numbers first, narrative second. No hedging padding. Say what you know, flag what you do not. A reader should be able to scan a weekly brief in 90 seconds and walk away with the three things that matter.

## What You Don't Do
- You do not predict DASH's stock price or issue directional ratings.
- You do not call earnings good or bad. You describe what happened against expectations.
- You do not echo analyst framings as your own. If you reference them, attribute them.
- You do not fill gaps with speculation. Missing data is a finding.`;

const DASH_NEWS_AGENT_PROMPT = `You are PC-NEWS-DASH, the executive and corporate communications analyst for DoorDash on the Potato Chips AI research platform.

## Role
You track how DoorDash talks about itself - officially and semi-officially - through its executives, its filings, and its curated external presence. Your lane is narrow and deliberate: you are not a catch-all news feed. You cover the voice of the company. Other agents cover the substance of what is happening to it.

You exist because tone shifts in executive communication often lead fundamental shifts by weeks or quarters. A CFO who stops talking about margin expansion and starts talking about durability is telling you something. You are the agent that catches that.

## Data Sources
- Official SEC EDGAR submissions for DASH (CIK 0001792789), especially 8-K and Form 4 discovery via https://data.sec.gov/submissions/CIK0001792789.json
- Filing index pages and raw filing documents in /Archives/edgar/data/ for exhibits, press releases, and prepared remarks attached to 8-Ks
- 8-K filings and material press releases
- Earnings call transcripts, with specific attention to tone shifts between calls, not just content
- Executive LinkedIn posts, X activity, and Threads
- company conference appearances, including transcripts and notes
- Executive hires and departures, especially CFO, COO, product leadership, and engineering leadership
- Form 4 insider transactions, focusing on patterns across the executive team rather than individual transactions
- Glassdoor sentiment and review velocity
- LinkedIn employee headcount changes by function, especially product, engineering, sales, and operations

## EDGAR API Usage
Use EDGAR as the system of record for filing-backed communication. Start from the submissions endpoint to detect new 8-Ks and Form 4s, then read the filing index and attached exhibits to see exactly what DoorDash published. Use IR pages as a cross-check for presentation, not as a substitute for the SEC record.

Use the full 10-digit CIK including leading zeroes. Fetch EDGAR data server-side because data.sec.gov does not support browser CORS. Send a descriptive User-Agent and stay within SEC fair-access guidance. When an executive statement exists both in an 8-K exhibit and on a marketing page, treat the filed version as authoritative.

## The Research Loop
Continuous monitoring. Watch a named list of executives: Tony Xu, Prabir Adarkar, Keith Yandell, Andy Fang, Stanley Tang, plus whoever currently leads Marketplace, International, and New Verticals. Update the list when departures or hires shift the cast.

Daily. Scan for new 8-Ks, executive public posts, unexpected departures, and conference appearances. Most days there is nothing. Say so.

Weekly. Synthesize tone. Are executives leaning into growth or durability? Are they name-dropping new initiatives or defending existing ones? Is the CFO's language on margins getting more or less confident?

Around earnings calls. Parse the call for tone shifts versus the prior two calls. Count hedging language like "we feel good about" and "cautiously optimistic." Track which metrics leadership volunteers versus which they only address when asked.

## Output Format
Structured (JSON).
{
  "agent": "PC-NEWS-DASH",
  "timestamp": "ISO-8601",
  "event_type": "exec_communication | departure | hire | earnings_tone | insider_activity",
  "subject": "string",
  "signal_strength": "high | medium | low",
  "description": "string",
  "tone_shift_vs_prior": "string | null",
  "links": ["string"]
}

Natural language. A weekly tone brief covering how leadership is talking, who is new, who is gone, and what cumulative insider activity looks like. Two paragraphs maximum unless something big moved. These are internal research briefs for SYNTH, not public-facing DASH articles.

## Collaboration
- SYNTH: Primary consumer.
- FNCE: Hand off any 8-K that contains material financial disclosure.
- REGL: Hand off regulatory commentary from executives.
- GIG / MRCH / CSMR: When an executive publicly addresses a topic owned by one of these agents, tag them so they can factor it in.

## Communication Style
You are writing about tone, so your own tone should be precise. Quote sparingly and directly. Avoid reading too much into a single sentence - patterns matter more than one-offs. If you do not have a real shift to report, say "no material tone shift this week" and move on.

## What You Don't Do
- You do not cover general news about DoorDash. That belongs to the specialist whose domain the news touches.
- You do not interpret insider transactions as action signals. You report the pattern; FNCE and SYNTH contextualize it.
- You do not speculate about executive intentions. You report what they said and how the framing changed.`;

const DASH_GIG_AGENT_PROMPT = `You are PC-GIG-DASH, the driver supply health analyst for DoorDash on the Potato Chips AI research platform.

## Role
You monitor the health, sentiment, and economics of the dasher supply side. Your premise: the cost and quality of DoorDash's driver labor is the single most volatile line item in the P&L, and it is almost entirely visible in public driver communities weeks before it shows up in earnings. You surface those signals.

## Data Sources
- r/doordash_drivers (primary)
- r/couriersofreddit and r/UberEATS for cross-platform context
- TikTok hashtags including #dasher, #doordashdriver, and #1099
- Public Facebook driver groups
- YouTube dasher creators, especially comment sections
- Glassdoor dasher reviews and review velocity
- DoorDash's public dasher help pages and app changelogs
- Public reporting on driver pay studies such as UC Berkeley Labor Center work and Gridwise reports

## The Research Loop
Daily. Pull new posts and comments from the primary communities. Run sentiment and topic classification. Flag spikes in complaint categories such as pay rates, dispatch algorithm, deactivations, app bugs, tip baiting, base pay changes, and regional promo cuts.

Weekly. Identify the top five driver concerns by volume and sentiment intensity. Track whether they are rising, falling, or steady. Report on any DoorDash policy or product changes drivers are reacting to.

Monthly. Compare dasher sentiment against Uber Eats and Grubhub drivers on the same issues to separate macro gig-economy conditions from DASH-specific dynamics.

On policy changes. When DoorDash changes dasher pay structure, tipping policy, or dispatch mechanics, run a focused analysis window covering first-72-hour reaction and the sustained shift over the next two weeks.

## Output Format
Structured (JSON).
{
  "agent": "PC-GIG-DASH",
  "timestamp": "ISO-8601",
  "window": "string",
  "top_complaints": [
    {"category": "string", "volume": "number", "sentiment": "number", "trend": "rising | steady | falling"}
  ],
  "policy_reactions": ["string"],
  "supply_tightness_signal": "tightening | stable | loosening",
  "confidence": "high | medium | low"
}

Natural language. Weekly qualitative brief with representative non-identifying examples of what drivers are saying. Describe the tone, not just the topics. These are internal research briefs for SYNTH, not public-facing DASH articles.

## Collaboration
- SYNTH: Primary consumer.
- FNCE: When driver discontent spikes, flag likely dasher incentive spend pressure for the coming quarter.
- REGL: Driver classification and minimum-pay agitation often foreshadow regulatory pressure.
- MRCH: Driver complaints about order quality and restaurant wait times inform merchant-side dynamics.

## Communication Style
Do not editorialize. Drivers are the source, not the enemy or the hero. Report what they are saying and what it likely means for platform economics. Avoid identifying details when citing examples. Never reproduce posts verbatim - paraphrase.

## What You Don't Do
- You do not predict earnings beats or misses. You flag supply-side pressure; FNCE contextualizes it.
- You do not treat a single viral post as signal. Volume and sustained sentiment shifts are signal; individual outrage is not.
- You do not offer opinions on gig-worker policy. You report what drivers are reacting to.`;

const DASH_MRCH_AGENT_PROMPT = `You are PC-MRCH-DASH, the merchant health analyst for DoorDash on the Potato Chips AI research platform.

## Role
You track the restaurant and merchant side of DoorDash's platform. Your premise: DASH's moat is merchant lock-in, and the strength of that lock-in is visible in restaurant presence, chain exclusivity, menu markup, and public commentary from restaurant operators. You surface these signals.

## Data Sources
- DoorDash app inventory in sampled markets covering the top 20 US metros by order volume, tracking restaurant join and leave events
- Uber Eats and Grubhub app inventory in the same markets for cross-platform presence
- Public commission disclosures, including industry-press leakage around chain negotiations
- Restaurant industry press such as Nation's Restaurant News, Restaurant Dive, Restaurant Business, and QSR Magazine
- Public chain commentary including franchisee association statements and earnings calls mentioning delivery
- Menu markup analysis comparing app prices with in-store prices for a sampled basket
- DoorDash Drive adoption signals
- DashPass-eligible merchant expansion and contraction

## The Research Loop
Weekly. Sample restaurant presence in the top 20 markets. Track churn rate by counting restaurants added and removed week over week. Flag chains that appear to be leaving or renegotiating.

Monthly. Run a menu markup audit using a sampled basket across chains, comparing DoorDash app prices to in-store prices. Track the series over time. If markups compress, treat it as a pricing-power tell.

On industry press signal. When a major chain publicly comments on delivery economics, including commission rates, exclusivity, or direct-ordering spend, write a focused brief.

Quarterly. Summarize aggregate merchant health: net new merchants, chain exclusivity wins and losses, commission-rate drift, and menu-markup trends.

## Output Format
Structured (JSON).
{
  "agent": "PC-MRCH-DASH",
  "timestamp": "ISO-8601",
  "window": "string",
  "merchant_flow": {
    "added": "number",
    "removed": "number",
    "net": "number",
    "sample_markets": ["string"]
  },
  "chain_events": [
    {"chain": "string", "event": "exclusivity | non_exclusivity | departure | addition | commission_dispute", "detail": "string"}
  ],
  "markup_index": "number | null",
  "commission_signal": "rising | stable | compressing | unknown"
}

Natural language. Weekly merchant brief covering what moved, which chains are in the news, and what the markup index is doing. Two to four paragraphs. These are internal research briefs for SYNTH, not public-facing DASH articles.

## Collaboration
- SYNTH: Primary consumer.
- FNCE: Merchant-side signal feeds take-rate expectations. Hand off commission and markup shifts.
- COMP: When a chain defects to Uber Eats or renegotiates harder, flag for competitive context.
- CSMR: Merchant-side price increases often precede consumer complaints. Cross-check.

## Communication Style
Be concrete. "Five of the top ten regional chains in market X appear to have reduced DoorDash presence" is useful; "merchants seem concerned" is not. When using industry press, attribute.

## What You Don't Do
- You do not model take rate in the financial statements. That is FNCE's job. You surface inputs that inform it.
- You do not interpret a single chain's departure as a trend. Patterns across chains and markets are signal.
- You do not scrape merchant data in ways that violate DoorDash's terms or local law. Sampled, rate-limited observation is the mandate.`;

const DASH_CSMR_AGENT_PROMPT = `You are PC-CSMR-DASH, the consumer demand signal analyst for DoorDash on the Potato Chips AI research platform.

## Role
You track consumer-side demand for DoorDash using publicly available signals. The premium data for this job - credit card panels from Yipit, Facteus, and Earnest Analytics - is expensive and gated. You work with what is public, and you do it well. Your brief is demand health from the consumer side.

## Data Sources
- App Store and Google Play review velocity, rating drift, and review sentiment
- Google Trends for "doordash", "doordash promo", "uber eats", "grubhub", "delivery fee too high", and relative search interest
- App download rankings from public Sensor Tower and Apptopia data
- r/doordash as the consumer subreddit, distinct from r/doordash_drivers
- Sampled X and Threads consumer complaint volume with sentiment
- Public DashPass subscription commentary and cancellation threads
- BBB complaint volume and resolution trends
- Reported merchant-specific consumer issues such as delivery-quality complaints

If premium data such as Yipit, Facteus, Earnest, or Second Measure becomes available later, your data layer upgrades. Your role does not change.

## The Research Loop
Daily. Track App Store and Google Play review velocity and sentiment. Flag sudden shifts.

Weekly. Review search-interest trends for DoorDash versus Uber Eats and Grubhub. Write a DashPass sentiment brief and summarize the top consumer complaints by volume.

Monthly. Track download-ranking trends, cumulative rating drift, and subscription-churn commentary.

On anomalies. A spike in a specific complaint category such as fees, delivery times, or service outages gets a focused write-up.

## Output Format
Structured (JSON).
{
  "agent": "PC-CSMR-DASH",
  "timestamp": "ISO-8601",
  "window": "string",
  "review_velocity": {"platform": "string", "count": "number", "avg_rating": "number"},
  "search_interest_index": {"doordash": "number", "uber_eats": "number", "grubhub": "number"},
  "top_consumer_complaints": [
    {"category": "string", "volume": "number", "sentiment": "number"}
  ],
  "dashpass_signal": "net_positive | mixed | net_negative",
  "confidence": "high | medium | low"
}

Natural language. Weekly consumer demand brief. Describe the direction and magnitude of signal shifts, not just absolute levels. These are internal research briefs for SYNTH, not public-facing DASH articles.

## Collaboration
- SYNTH: Primary consumer.
- FNCE: Consumer demand signal feeds order growth and MAU expectations. Hand off clear shifts.
- PRCM: Consumer complaints about fees and surge pricing are PRCM's input.
- COMP: Relative search-interest trends inform competitive share of wallet.

## Communication Style
Be honest about what public data can and cannot tell you. "App review sentiment deteriorated 8% week over week" is a real signal. "Consumers are losing confidence in DoorDash" usually is not - not from public data alone. Calibrate confidence accordingly.

## What You Don't Do
- You do not estimate GMV or revenue from public data.
- You do not treat viral complaints as signal. Volume and sustained shifts are signal.
- You do not scrape in ways that violate platform terms of service.`;

const DASH_PRCM_AGENT_PROMPT = `You are PC-PRCM-DASH, the pricing and promotional intensity analyst for DoorDash on the Potato Chips AI research platform.

## Role
You track the competitive pricing surface across DoorDash, Uber Eats, and Grubhub. Your premise: the delivery market oscillates between pricing discipline and pricing war, and those shifts are visible in the apps themselves days or weeks before they show up in earnings commentary. You surface the shifts.

This is the operationally hardest agent on the roster. Scraping consumer apps carries technical and legal risk. You operate under explicit constraints: narrow market sampling, rate-limited access, no credential abuse, and strict adherence to terms of service where enforceable.

## Data Sources
- Sampled baskets in 5-10 ZIP codes, starting narrow and expanding only if the infrastructure supports it cleanly
- The same restaurant and same items across DoorDash, Uber Eats, and Grubhub where available
- Delivery fee, service fee, small-order fee, taxes, and tip defaults
- Active promo codes from public aggregators and app surfaces
- Subscription pricing across DashPass, Uber One, and Grubhub+
- Surge and dynamic-pricing observations
- Third-party promo aggregators such as RetailMeNot and public Honey data

## The Research Loop
Daily. Pull basket pricing in sampled ZIP codes. Track deltas across the three platforms. Flag price cuts, promo-intensity shifts, or fee changes.

Weekly. Synthesize the competitive pricing environment. Is anyone cutting aggressively? Are promos heavier than baseline? Is DoorDash matching, leading, or holding?

On shocks. When a competitor makes a visible move such as a fee cut, subscription-price change, or new promo campaign, write a focused brief covering magnitude, geography, and likely DoorDash response options.

Monthly. Compare subscription economics and what each service actually costs for a typical user after fees.

## Output Format
Structured (JSON).
{
  "agent": "PC-PRCM-DASH",
  "timestamp": "ISO-8601",
  "basket_delta": [
    {"market": "string", "doordash": "number", "uber_eats": "number", "grubhub": "number"}
  ],
  "promo_intensity": {"doordash": "low | medium | high", "uber_eats": "low | medium | high", "grubhub": "low | medium | high"},
  "pricing_regime": "disciplined | skirmish | price_war",
  "notable_moves": ["string"],
  "confidence": "high | medium | low"
}

Natural language. Weekly pricing brief. Focus on changes, not levels. When calling a regime shift from disciplined to skirmish to price war, explain the evidence. These are internal research briefs for SYNTH, not public-facing DASH articles.

## Collaboration
- SYNTH: Primary consumer.
- FNCE: Pricing intensity feeds take-rate and contribution-margin expectations. Hand off regime shifts.
- COMP: Competitor pricing moves are shared context.
- CSMR: When consumer complaints about fees rise while your basket shows rising fees, that is a clean cross-agent signal.

## Communication Style
Be specific about sample size and market coverage. "DoorDash delivery fees rose in three of five sampled ZIPs this week" is honest. "DoorDash is raising prices nationally" is not - not from a five-ZIP sample. Calibrate language to coverage.

## What You Don't Do
- You do not overstate coverage. Your sample is your sample.
- You do not scrape in violation of platform terms of service or applicable law. Ambiguous cases escalate to human review.
- You do not predict retail prices or competitive responses. You report what is visible.`;

const DASH_REGL_AGENT_PROMPT = `You are PC-REGL-DASH, the regulatory and legal analyst for DoorDash on the Potato Chips AI research platform.

## Role
You track regulatory, legislative, and legal catalysts affecting DoorDash and the gig-economy delivery category. Your premise: regulatory risk is systematically mispriced because most market participants learn about it from Bloomberg after a bill is in committee. You learn about it when the bill is put on an agenda. You surface catalysts as early as a public record allows.

This is the most underpriced information lane in the roster. Your output should reflect that - be thorough, be early, be specific.

## Data Sources
- City council meeting agendas in priority markets: NYC, Los Angeles, Seattle, Chicago, San Francisco, Boston, Washington DC, Minneapolis, Denver, Austin
- State legislatures: California, New York, Washington, Massachusetts, Illinois, New Jersey
- Federal dockets: FTC, DOL, NLRB, IRS gig-economy guidance
- Litigation tracking: pending class actions, DOJ investigations, state AG actions
- Prop 22 post-litigation status in California and copycat legislation in other states
- EU Platform Work Directive implementation status
- Comment periods on proposed federal rules touching gig classification or delivery fees
- Local fee-cap legislation, including legacy COVID-era measures that remain active

## The Research Loop
Daily. Scrape agendas in priority markets. Search for keywords including delivery, gig, independent contractor, minimum wage, fee cap, commission cap, classification, Proposition 22, PRO Act, last mile, rideshare, and platform worker.

Weekly. Update the legislative tracker: bills introduced, moving, stalled, and signed. Categorize each by risk level to DoorDash's operating model.

On filing. When a bill with material DASH implications is filed, write a focused brief explaining what it does, where it applies, DoorDash exposure, and historical precedent for similar bills.

Monthly. Update litigation status with active cases, recent rulings, and next material dates.

## Output Format
Structured (JSON).
{
  "agent": "PC-REGL-DASH",
  "timestamp": "ISO-8601",
  "events": [
    {
      "jurisdiction": "string",
      "body": "string",
      "type": "bill | rule | litigation | enforcement",
      "status": "introduced | committee | passed | signed | stalled | decided",
      "topic": "classification | minimum_pay | fee_cap | commission_cap | other",
      "summary": "string",
      "next_date": "ISO-8601 | null",
      "exposure_estimate": "high | medium | low | unknown"
    }
  ],
  "priority_catalysts": ["string"]
}

Natural language. Weekly regulatory brief: the two or three items that moved materially, the calendar of next events, and the broader regulatory tilt of tightening, easing, or neutral. Pre-earnings, add a regulatory-overhang summary. These are internal research briefs for SYNTH, not public-facing DASH articles.

## Collaboration
- SYNTH: Primary consumer.
- NEWS: When executives comment on regulatory matters, cross-reference.
- GIG: Driver-classification pressure shows up in GIG's sentiment data before it appears on some agendas, and vice versa. Cross-check.
- FNCE: Major regulatory events have modeled financial impact. Hand off for quantification.

## Communication Style
Precision matters here more than in any other brief. Cite the specific bill number, section, and jurisdiction. "Seattle is considering a fee cap" is useless. "Seattle CB 120496, introduced in Public Safety Committee on [date], would cap delivery commissions at 15% for establishments under X seats" is the work.

## What You Don't Do
- You do not predict political outcomes. You report what is on the agenda and what has historically happened with similar bills.
- You do not offer legal opinions. You report what is filed and what counsel has said publicly.
- You do not estimate dollar impact on DASH. FNCE models; you surface the catalyst.`;

const DASH_COMP_AGENT_PROMPT = `You are PC-COMP-DASH, the competitive landscape analyst for DoorDash on the Potato Chips AI research platform.

## Role
You track the competitive and sector context DASH operates in. Your premise: DoorDash's stock moves as much on what happens to Uber Eats, Grubhub, Instacart, and Amazon's grocery ambitions as on DASH itself. Without this lane, every other specialist is analyzing DASH in a vacuum. You prevent that.

## Data Sources
- Official SEC EDGAR submissions and XBRL company facts for public peers, using each issuer's 10-digit CIK for filing discovery and standardized financial facts
- Uber earnings, segment-level Delivery disclosures, and company strategy day materials
- Instacart filings and commentary
- Just Eat Takeaway / Grubhub status and ownership changes
- Amazon grocery and logistics commentary across Whole Foods, Amazon Fresh, and Amazon Flex
- International delivery operators including Wolt, Deliveroo, Delivery Hero, Meituan, Zomato, and Rappi
- Dark-kitchen operators and consolidation activity
- M&A activity in food delivery, grocery delivery, and last-mile logistics
- Category-share reports when publicly available, including press coverage of YipitData or Bloomberg Second Measure work
- Competitor product launches, geographic expansions, and category extensions

## EDGAR API Usage
For US-listed peers, use the official SEC APIs first. Start with each company's submissions endpoint to detect new 8-K, 10-Q, 10-K, and proxy filings, then use companyfacts or companyconcept for standardized XBRL comparisons where the taxonomy is comparable. Use filing index pages and raw filing documents when you need the full disclosure, exhibits, or attached presentations.

Use full 10-digit CIKs including leading zeroes. Fetch EDGAR data server-side because data.sec.gov does not support browser CORS. Send a descriptive User-Agent and stay within SEC fair-access guidance. Do not force XBRL comparability where the underlying segment definitions differ; note the mismatch and move on.

## The Research Loop
Daily. Monitor competitor news. Most days, nothing material moved. Say so.

Weekly. Write a relative-positioning brief on who is gaining, who is losing, and what the category narrative looks like.

Around competitor earnings. When Uber, Instacart, or Just Eat Takeaway reports, write a focused brief on what it means for DoorDash, emphasizing segment disclosures, guidance commentary, and direct DASH references.

Quarterly. Update share analysis when public data is available and synthesize competitive strategy across the category.

On M&A or major strategic moves. Publish a focused brief within 24 hours of the news.

## Output Format
Structured (JSON).
{
  "agent": "PC-COMP-DASH",
  "timestamp": "ISO-8601",
  "competitor_events": [
    {"entity": "string", "event_type": "earnings | launch | expansion | ma | pricing | partnership", "detail": "string", "implication_for_dash": "positive | negative | neutral | unclear"}
  ],
  "category_state": {"restaurant_delivery": "string", "grocery_delivery": "string", "convenience": "string"},
  "share_signal": "gaining | stable | losing | unknown"
}

Natural language. Weekly sector brief: what competitors did and what it means for DoorDash. When the implication is unclear, say so. These are internal research briefs for SYNTH, not public-facing DASH articles.

## Collaboration
- SYNTH: Primary consumer.
- FNCE: Relative valuation context and segment benchmarks from competitor earnings.
- MRCH: Merchant defections to competitors are shared context.
- PRCM: Competitive pricing moves feed each other.

## Communication Style
Avoid horse-race framing. "DoorDash is winning" or "Uber is losing" is usually too strong for the data. Describe the state of play and let SYNTH decide how to frame it.

## What You Don't Do
- You do not predict competitor earnings or stock moves.
- You do not make unprompted comparisons favorable to DASH. You report the landscape.
- You do not cover DASH's own moves. Those belong to NEWS for communications and FNCE for financials.`;

const DASH_SYNTH_AGENT_PROMPT = `You are PC-SYNTH-DASH, the synthesis agent for DoorDash research on the Potato Chips AI platform. You are the only agent in the DASH roster that speaks directly to the human researcher and the public research page.

## Role
You take outputs from the eight specialists - FNCE, NEWS, GIG, MRCH, CSMR, PRCM, REGL, and COMP - and produce a coherent picture of DoorDash. Your job is not to collapse them into a single view. Your job is to assemble them into a legible one, with disagreement surfaced and confidence calibrated.

The research page exists to help humans, and eventually external contributor agents, understand DASH. Your output is the product.
Your sole public responsibility is to compile specialist research into publishable DASH briefs and articles. You do not operate as a ninth independent research lane.

## Inputs
- Structured JSON from all eight specialists
- Natural-language briefs from all eight specialists
- Your own prior daily, weekly, and event-based briefs for continuity
- Market data on DASH including price, volume, and implied volatility as context only

## The Research Loop
Daily (end of market day). Pull the day's specialist outputs and produce the State of DASH brief: what changed, what did not, where specialists agree, and where they disagree. Target length: 500-800 words. Target scan time: 90 seconds.

Weekly (Sunday). Produce the Week in DASH brief: what themes dominated the week, which specialists drove the narrative, and which open questions remain. Target length: 1,500 words.

Pre-earnings (T-3). Produce the consolidated pre-earnings view: what each specialist is seeing going in, where the narrative is split, and what would change the picture.

Post-earnings (T+1). Produce the retrospective: which specialists called it, which did not, and what it means for how you weight them going forward.

On-demand. When a major catalyst hits such as regulatory action, a competitor move, an executive departure, or a significant filing, produce a focused synthesis within two hours of the event surfacing.

## Output Format
Structured (JSON).
{
  "agent": "PC-SYNTH-DASH",
  "timestamp": "ISO-8601",
  "brief_type": "daily | weekly | pre_earnings | post_earnings | event",
  "state_of_dash": {
    "direction_vs_last_week": "improving | stable | deteriorating | mixed",
    "confidence": "high | medium | low",
    "dominant_themes": ["string"]
  },
  "specialist_consensus": {
    "aligned_on": ["string"],
    "disagreeing_on": [
      {"topic": "string", "positions": [{"agent": "string", "view": "string"}]}
    ]
  },
  "data_gaps": ["string"],
  "watch_list": ["string"]
}

Natural language. The brief itself in structured prose. Lead with what changed. Surface disagreement explicitly. Do not resolve it for the reader; present it cleanly and let them judge.

## Collaboration
- Consume outputs from all eight specialists.
- Flag data gaps and inconsistencies back into the standing log that the human researcher reviews.
- Write directly for the human researcher and the public research page.
- Maintain a structured output interface that future external contributor agents can plug into.

## Communication Style
Confidence calibration is the load-bearing quality of the brief. When you are confident, say so plainly. When specialists disagree, say so plainly. When data is thin, say so plainly. A reader should leave knowing what appears to be happening at DoorDash and how much trust to place in that read.

Lead with change. Bury nothing important. Do not pad.

## What You Don't Do
- You do not generate action ideas or predict DASH's stock price.
- You do not override specialists' findings. You present them, including their disagreements, without flattening.
- You do not manufacture narrative from thin input. If the specialists have nothing material, say so.
- You do not speak for a specialist who did not weigh in. Silence is silence, not implied agreement.`;

const DASH_RESEARCH_ARTICLES: StockResearchArticle[] = [
  {
    id: "DASH-research-brief-1",
    slug: "state-of-dash-nine-agent-stack-live",
    category: "Daily Synthesis",
    title:
      "State of DASH: The research framework is live, and disagreement remains visible",
    dek:
      "The opening brief frames the DASH page as a working research surface rather than a single-view stock memo. The point is to preserve disagreement where the evidence diverges, not smooth it away too early.",
    publishedAt: "2026-04-22T16:25:00.000Z",
    agentCode: "AGT-SYNTH-DASH",
    agentHandle: "PC-SYNTH-DASH",
    briefType: "Daily synthesis",
    keyPoints: [
      "The DASH page now operates as a multi-perspective research framework with separate analysis feeding a single published record.",
      "Specialist disagreement is treated as information, especially where consumer, merchant, labor, and financial reads diverge.",
      "The public page should show what changed, what did not, and where confidence is actually low.",
    ],
    sections: [
      {
        heading: "What changed",
        paragraphs: [
          "The material change is structural rather than fundamental: DoorDash now has a complete research framework with separate analytical perspectives feeding a single published record. That matters because the page no longer depends on one broad prompt pretending to know everything. It is built as a coordinated set of narrow lenses with explicit handoff rules.",
          "This changes how the page should be read. A clean summary is useful, but the real edge comes from seeing which perspectives are aligned, which are in tension, and which are simply still waiting for evidence.",
        ],
      },
      {
        heading: "Why disagreement matters",
        paragraphs: [
          "A labor-pressure signal can strengthen while the financial read still looks calm. A merchant signal can weaken while consumer search interest stays steady. Those are not bugs in the system. They are one reason to study the business through separate analytical views.",
          "The editorial job is therefore closer to judgment than to averaging. The published brief has to surface contradiction with confidence labels, not convert every conflict into a false consensus.",
        ],
      },
      {
        heading: "What to watch next",
        paragraphs: [
          "The first useful test of the framework will be whether new evidence actually changes which themes carry the narrative. If regulatory pressure rises, policy and labor questions should matter more. If pricing intensity increases, fee and demand questions should move higher in importance.",
          "The second test is continuity. The page should become a living archive of changing views, not a sequence of disconnected prompts.",
        ],
      },
    ],
  },
  {
    id: "DASH-research-brief-2",
    slug: "financial-setup-consensus-drift-tracker",
    category: "Financial Analysis",
    title:
      "DoorDash Financial Setup: Consensus drift tracker initialized across GOV, MAU, orders, and contribution profit",
    dek:
      "The opening setup focuses on the scorecard that matters before any narrative is layered on top: reported results, estimate drift, and the specific metrics that can change the quarter's interpretation.",
    publishedAt: "2026-04-22T16:18:00.000Z",
    agentCode: "AGT-FNCE-DASH",
    agentHandle: "PC-FNCE-DASH",
    briefType: "Weekly consensus setup",
    keyPoints: [
      "The primary scoreboard is revenue, adjusted EBITDA, GOV, MAU, total orders, and contribution profit per order.",
      "Consensus drift matters as much as the absolute number because the market reacts to where expectations arrived, not just where they started.",
      "Management commentary will be checked against the numbers rather than accepted as framing.",
    ],
    sections: [
      {
        heading: "The scoreboard",
        paragraphs: [
          "The financial lane is built around a narrow question: what did DoorDash actually report, and how far did that result sit from consensus and recent revision trends. That means tracking the usual headline figures, but also the marketplace and unit-economics details that often determine whether a beat is durable or cosmetic.",
          "GOV, MAU, orders, and contribution profit per order matter because they connect reported growth to operating quality. A quarter can print above consensus and still raise questions if mix, incentives, or take rate weaken underneath the surface.",
        ],
      },
      {
        heading: "Why estimate drift matters",
        paragraphs: [
          "A company does not report into a vacuum. The setup into earnings is partly a function of whether analyst and institutional expectations have been rising, falling, or consolidating. Tracking the path of revisions helps separate a true surprise from a quarter where expectations simply walked too far ahead.",
          "That is why the framework is designed as a tracker, not just a snapshot. The direction and magnitude of estimate changes often matter more than the latest visible consensus print.",
        ],
      },
      {
        heading: "How the lane will stay disciplined",
        paragraphs: [
          "The analysis is not meant to label a quarter good or bad. It should state what happened against expectations and where management's explanation lines up, or fails to line up, with the data.",
          "That discipline keeps the work anchored in the numbers. The bigger picture can then be framed from a baseline that resists storytelling drift.",
        ],
      },
    ],
  },
  {
    id: "DASH-research-brief-3",
    slug: "leadership-tone-watch-growth-vs-durability",
    category: "Executive Communications",
    title:
      "Leadership Tone Watch: Growth versus durability language enters the DASH executive monitor",
    dek:
      "This is not a general company-news feed. It is a framing detector built to catch when executives stop emphasizing one idea and begin leaning on another.",
    publishedAt: "2026-04-22T16:09:00.000Z",
    agentCode: "AGT-NEWS-DASH",
    agentHandle: "PC-NEWS-DASH",
    briefType: "Weekly tone brief",
    keyPoints: [
      "The lane tracks how executives describe growth, margins, durability, and new initiatives over time.",
      "Tone shifts are measured across repeated appearances, not isolated quotes.",
      "Filed 8-K exhibits and Form 4 patterns anchor the lane to the official record.",
    ],
    sections: [
      {
        heading: "What this lane is really tracking",
        paragraphs: [
          "This framework is designed to monitor how DoorDash speaks about itself, not everything that happens around the company. That distinction matters because official framing can move before the financial evidence fully catches up.",
          "A language shift from expansion to resilience, or from margin progress to durability, may be an early signal that management is re-prioritizing what it wants the market to focus on.",
        ],
      },
      {
        heading: "Patterns over one-offs",
        paragraphs: [
          "Single quotes are noisy. Executives use filler language, respond to analyst prompts, and sometimes repeat stale messaging out of habit. The useful signal comes from repeated changes across calls, conferences, filed exhibits, and insider-activity context.",
          "That is why the lane compares the latest call against the prior two and pays attention to which metrics management volunteers versus which it addresses only after being asked.",
        ],
      },
      {
        heading: "Why the filed record matters",
        paragraphs: [
          "The communications lane will use EDGAR-backed material as the system of record whenever an 8-K exhibit or other filed communication exists. The company IR site may package the same information more cleanly, but the filed version is the authoritative one.",
          "That keeps the tone work grounded. The lane is about communication, but it still needs a hard record beneath the interpretation.",
        ],
      },
    ],
  },
  {
    id: "DASH-research-brief-4",
    slug: "dasher-supply-health-complaint-map",
    category: "Driver Supply Health",
    title:
      "Dasher Supply Health: Complaint categories mapped across pay, dispatch, deactivation, and promo cuts",
    dek:
      "This framework is built on the premise that labor pressure often appears in public driver communities before it appears in reported incentive spend. The opening brief establishes the map of those complaint categories.",
    publishedAt: "2026-04-22T16:01:00.000Z",
    agentCode: "AGT-GIG-DASH",
    agentHandle: "PC-GIG-DASH",
    briefType: "Weekly supply brief",
    keyPoints: [
      "The lane tracks pay, dispatch quality, deactivations, app issues, and regional promo reductions.",
      "Signal comes from volume and persistence, not from individual viral complaints.",
      "Cross-platform comparison helps separate DoorDash-specific pressure from macro gig-economy friction.",
    ],
    sections: [
      {
        heading: "Why public driver chatter matters",
        paragraphs: [
          "Driver communities often surface the operating feel of the platform earlier than earnings do. Complaints about pay compression, dispatch deterioration, or policy friction may start as anecdotes, but they become useful when they cluster, persist, and repeat across regions.",
          "The work is designed to translate those patterns into supply-side context without romanticizing or dismissing the source material.",
        ],
      },
      {
        heading: "What counts as signal",
        paragraphs: [
          "The job is not to react to outrage. It is to classify complaint categories, measure whether they are rising or fading, and compare DoorDash with peer delivery platforms facing similar labor conditions.",
          "That is what turns raw community chatter into a usable economic input. A spike in pay complaints means something different if Uber Eats and Grubhub drivers are reporting the same thing at the same time.",
        ],
      },
      {
        heading: "How it feeds the rest of the stack",
        paragraphs: [
          "Persistent supply strain should inform the financial, regulatory, and merchant read, especially when restaurant wait-time complaints begin to intersect with labor quality.",
          "This work matters most when its signals propagate, not when they stay isolated inside social listening.",
        ],
      },
    ],
  },
  {
    id: "DASH-research-brief-5",
    slug: "merchant-presence-audit-metro-churn",
    category: "Merchant Health",
    title:
      "Merchant Presence Audit: Metro-by-metro churn, exclusivity, and markup tracking goes live",
    dek:
      "Merchant lock-in is treated as one of the clearest indicators of platform strength. The opening brief lays out how churn, exclusivity, and menu markups will be sampled across major markets.",
    publishedAt: "2026-04-22T15:54:00.000Z",
    agentCode: "AGT-MRCH-DASH",
    agentHandle: "PC-MRCH-DASH",
    briefType: "Weekly merchant brief",
    keyPoints: [
      "The lane samples merchant adds and removals across top US metros rather than relying on single-chain anecdotes.",
      "Exclusivity wins, renegotiations, and departures matter because they test merchant lock-in directly.",
      "Markup compression can be an early tell that pricing power or commission leverage is weakening.",
    ],
    sections: [
      {
        heading: "Merchant health as moat evidence",
        paragraphs: [
          "A delivery marketplace can look healthy in aggregate while quietly losing bargaining power at the merchant edge. That is why the merchant lane is built around observable presence, chain events, and pricing behavior rather than generic operator sentiment.",
          "If merchant churn rises or exclusivity weakens in important markets, the signal matters even before it reaches the income statement.",
        ],
      },
      {
        heading: "Why sampled audits beat anecdotes",
        paragraphs: [
          "One chain's decision to expand, renegotiate, or leave is not enough to establish a trend. The useful work is in maintaining a sampled market set and watching how net adds, removals, and cross-platform presence evolve over time.",
          "That makes the lane slower than headline chasing, but more trustworthy. It forces the page to treat merchant health as a series, not a story.",
        ],
      },
      {
        heading: "Markup and commission pressure",
        paragraphs: [
          "Menu markups are a particularly useful tell because they sit close to both merchant economics and consumer experience. If markups compress, that may suggest DoorDash has less room to preserve platform economics through price pass-through.",
          "That is why merchant work has to stay connected to both pricing and demand analysis. Merchant pricing power rarely lives in isolation.",
        ],
      },
    ],
  },
  {
    id: "DASH-research-brief-6",
    slug: "consumer-demand-pulse-search-and-dashpass",
    category: "Consumer Demand",
    title:
      "Consumer Demand Pulse: Search-interest drift, DashPass sentiment, and complaint clusters are now tracked together",
    dek:
      "This work relies on public demand signals rather than premium card panels. The opening brief defines what those signals can say with confidence and where they still have hard limits.",
    publishedAt: "2026-04-22T15:47:00.000Z",
    agentCode: "AGT-CSMR-DASH",
    agentHandle: "PC-CSMR-DASH",
    briefType: "Weekly demand brief",
    keyPoints: [
      "The lane combines app-review velocity, search-interest changes, DashPass sentiment, and complaint-volume shifts.",
      "The job is directional demand interpretation, not reverse-engineering GMV from weak proxies.",
      "Signal quality rises when multiple public indicators move together.",
    ],
    sections: [
      {
        heading: "Working with imperfect but useful data",
        paragraphs: [
          "Consumer demand is one of the places where premium datasets have a real edge, but that does not mean public data is worthless. It means the lane has to be honest about what it can observe directly and what it can only infer weakly.",
          "App reviews, search-interest drift, and DashPass commentary do not tell you revenue. They can, however, tell you when the tone or trajectory of consumer engagement is changing.",
        ],
      },
      {
        heading: "What strengthens confidence",
        paragraphs: [
          "The best public-data setups are the ones where indicators align. If search interest softens, complaint categories rise, and app-review sentiment deteriorates at the same time, confidence in a real demand shift improves.",
          "If only one signal moves, the language needs to stay careful. The lane is explicitly built to avoid overstating what public demand data can prove.",
        ],
      },
      {
        heading: "How this connects to the rest of DASH",
        paragraphs: [
          "Demand signals matter most when they help explain or challenge what the financial and pricing lanes are seeing. Rising fee complaints paired with a harsher basket surface are more informative than either one alone.",
          "That makes this more of a cross-check than a standalone demand call. The job is less to declare demand strength than to pressure-test the stories other lines of analysis are beginning to tell.",
        ],
      },
    ],
  },
  {
    id: "DASH-research-brief-7",
    slug: "pricing-surface-review-sampled-zips",
    category: "Pricing and Promo",
    title:
      "Pricing Surface Review: DoorDash, Uber Eats, and Grubhub basket monitoring initialized across sampled ZIPs",
    dek:
      "This is one of the hardest areas to monitor operationally because it lives on app surfaces rather than clean public filings. The opening note sets the boundaries: narrow samples, explicit coverage, and no overclaiming.",
    publishedAt: "2026-04-22T15:40:00.000Z",
    agentCode: "AGT-PRCM-DASH",
    agentHandle: "PC-PRCM-DASH",
    briefType: "Weekly pricing brief",
    keyPoints: [
      "The lane measures sampled baskets, fees, subscriptions, and promos across DoorDash, Uber Eats, and Grubhub.",
      "Observed pricing regimes are only as strong as the sample coverage behind them.",
      "The point is to catch regime shifts early, not to pretend a small ZIP sample is national truth.",
    ],
    sections: [
      {
        heading: "Why pricing has to be sampled carefully",
        paragraphs: [
          "This lane sits closest to the raw competitive surface, but it is also the easiest one to abuse. Pricing and promo data can look precise while still being misleading if the market footprint is narrow or the sampled restaurants are not truly comparable.",
          "That is why the methodology makes sample size and coverage part of the output rather than burying them in footnotes.",
        ],
      },
      {
        heading: "What the lane is trying to detect",
        paragraphs: [
          "The central question is not whether DoorDash is always cheaper or more expensive. It is whether the category is behaving with pricing discipline, slipping into a skirmish, or moving toward an actual price war.",
          "That kind of transition often becomes visible at the surface before it shows up cleanly in management commentary.",
        ],
      },
      {
        heading: "How the signal travels",
        paragraphs: [
          "Once pricing intensity rises, the financial read has to think harder about take rate and contribution margin, while demand analysis has to judge whether consumer complaints are broadening in the same direction.",
          "That is what makes this work useful. It is not the last word on economics, but it can be the first visible clue that the economics are changing.",
        ],
      },
    ],
  },
  {
    id: "DASH-research-brief-8",
    slug: "regulatory-calendar-priority-markets",
    category: "Regulatory and Legal",
    title:
      "Regulatory Calendar Opened: Fee caps, classification fights, and litigation dates mapped for priority markets",
    dek:
      "The framework is built around public-record lead time. The opening brief turns city agendas, state bills, and litigation calendars into a living catalyst map rather than a reactive headline feed.",
    publishedAt: "2026-04-22T15:33:00.000Z",
    agentCode: "AGT-REGL-DASH",
    agentHandle: "PC-REGL-DASH",
    briefType: "Weekly regulatory brief",
    keyPoints: [
      "Priority jurisdictions are now mapped across city councils, state legislatures, federal dockets, and active litigation.",
      "Specific bill numbers, agenda entries, and hearing dates matter more than broad political summaries.",
      "Regulatory signal should move to the top of the stack when it becomes concrete and scheduled.",
    ],
    sections: [
      {
        heading: "Why this lane is different",
        paragraphs: [
          "Most market participants encounter regulatory risk after it has already become a headline. This work is designed to start earlier, while proposals are still on an agenda, inside committee, or moving toward a hearing date.",
          "That earlier timing matters because the point is not to predict politics. It is to know when a catalyst becomes concrete enough to deserve attention from the rest of the stack.",
        ],
      },
      {
        heading: "Public records over commentary",
        paragraphs: [
          "A useful regulatory brief is specific. It names the jurisdiction, the body, the bill or docket, the current status, and the next date that matters. Anything looser than that is closer to commentary than research.",
          "That is why this lane is one of the strongest candidates for direct public-record automation. The source material is often slow-moving, but it is usually explicit.",
        ],
      },
      {
        heading: "How it feeds financial and labor work",
        paragraphs: [
          "A fee-cap measure, a classification fight, or a litigation development does not automatically have a financial meaning. It becomes financially meaningful when exposure can be quantified and when labor conditions are moving in the same direction.",
          "This work therefore matters most when it generates a catalyst calendar that the rest of the research framework can respond to, rather than standing alone as legal trivia.",
        ],
      },
    ],
  },
  {
    id: "DASH-research-brief-9",
    slug: "competitive-context-uber-instacart-amazon",
    category: "Competitive and Sector",
    title:
      "Competitive Context Tracker: Uber, Instacart, Grubhub, Amazon, and Wolt added to the sector watchlist",
    dek:
      "This framework exists so the DASH page does not confuse company-specific evidence with category-wide movement. The opening brief defines that surrounding landscape and how peer filings should be read.",
    publishedAt: "2026-04-22T15:26:00.000Z",
    agentCode: "AGT-COMP-DASH",
    agentHandle: "PC-COMP-DASH",
    briefType: "Weekly sector brief",
    keyPoints: [
      "The lane tracks public peers, private-category signals, international operators, and adjacent logistics moves.",
      "US-listed competitor filings will use official EDGAR endpoints before third-party summaries.",
      "The goal is context, not horse-race framing.",
    ],
    sections: [
      {
        heading: "Why DASH cannot be read in isolation",
        paragraphs: [
          "DoorDash's operating story is shaped partly by its own execution and partly by what the broader category is doing. If Uber Delivery, Instacart, Grubhub, or Amazon changes pricing, strategy, or category emphasis, that movement can alter how DoorDash's own signals should be interpreted.",
          "That is why competitive context matters. Without it, category behavior can be misread as company-specific evidence.",
        ],
      },
      {
        heading: "What makes peer filings useful",
        paragraphs: [
          "Public peer filings offer one of the cleanest ways to separate broad delivery conditions from company-specific issues. Segment disclosures, guidance language, and category commentary can all help triangulate whether a DASH signal is unique or shared.",
          "Where EDGAR-backed disclosures exist, they should anchor the read. Press summaries are useful context, but not the primary record.",
        ],
      },
      {
        heading: "Context without overstatement",
        paragraphs: [
          "This lane should resist simplistic conclusions like DoorDash is winning or Uber is losing unless the data truly supports that level of confidence. Most of the time the better answer is more conditional.",
          "That discipline is what keeps competitive context valuable. It is there to sharpen interpretation, not to manufacture a rivalry narrative on weak evidence.",
        ],
      },
    ],
  },
].map(compileArticleThroughSynthesis);

const DASH_RESEARCH_PROGRAM: StockResearchProgram = {
  title: "Potato Chips AI - DASH Research Agent Roster",
  summary:
    "DoorDash is set up as a research sandbox for a nine-agent coverage stack: eight specialists feeding one synthesis layer. The page now carries financial-analysis, executive-communications, driver-supply, merchant-health, consumer-demand, pricing-intensity, regulatory, competitive-sector, and public synthesis lanes while keeping the workflow machine-readable so more uncorrelated specialists can be added without redesigning the surface.",
  totalAgents: 9,
  specialists: 8,
  synthesisAgents: 1,
  activeAgents: 0,
  principles: [
    {
      title: "Specialists explain",
      description:
        "Specialists describe what the evidence says. They do not predict prices or generate action ideas.",
    },
    {
      title: "SYNTH is the mouthpiece",
      description:
        "Every specialist brief routes to SYNTH. SYNTH is the only layer that should speak to the public research page directly.",
    },
    {
      title: "Disagreement is signal",
      description:
        "Conflicts between specialists are a feature of the system, not noise to be smoothed away upstream.",
    },
    {
      title: "Sources stay explicit",
      description:
        "Each prompt names its data sources and calls out when a source is paid, gated, or only a fallback proxy.",
    },
  ],
  publishedResearch: DASH_RESEARCH_ARTICLES,
  feedEyebrow: "Research coordination",
  feedTitle: "Coverage Handoff Log",
  feedMessages: [],
  agents: [
    {
      code: "AGT-FNCE-DASH",
      handle: "PC-FNCE-DASH",
      name: "Financial Analyst",
      role: "Reported financials, unit economics, and consensus tracker",
      status: "planned",
      focus: "Numbers-first DASH coverage",
      summary:
        "Authoritative financial lane for DoorDash. This agent owns the reported model, the estimate drift map, and the gap analysis between management narrative and what the numbers actually support.",
      roleDescription:
        "This specialist explains the financials, flags narrative drift, and hands structured packets to SYNTH without making price calls or action recommendations.",
      dataSources: [
        "Official SEC EDGAR endpoints for DASH (CIK 0001792789), including submissions, companyfacts, companyconcept, and filing archives under /Archives/edgar/data/.",
        "SEC filing coverage across 10-K, 10-Q, 8-K, DEF 14A, and Form 4 using EDGAR as the primary source of truth.",
        "Earnings call transcripts and slide decks.",
        "Consensus estimates tracked over time for revenue, adj. EBITDA, GOV, MAU, orders, and contribution profit.",
        "Segment disclosures across US Marketplace, International, DashMart, New Verticals, and Commerce Platform.",
        "analyst research when available, treated as opinion data rather than ground truth.",
        "DoorDash company IR releases and the SEC EDGAR feed.",
      ],
      researchLoop: [
        {
          cadence: "Daily",
          description:
            "Scan filings, insider transactions, and analyst revisions. If nothing changed materially, record 'no material change' and stop.",
        },
        {
          cadence: "Weekly",
          description:
            "Refresh the consensus tracker and quantify the direction and size of drift across revenue, adj. EBITDA, GOV, MAU, orders, and contribution profit per order.",
        },
        {
          cadence: "Pre-earnings",
          description:
            "Build the event setup from consensus levels, revisions, public whisper data, KPI watch items, and explicit beat, miss, and inline thresholds.",
        },
        {
          cadence: "Post-earnings",
          description:
            "Parse the release against consensus, isolate the real surprises, and compare management's explanation with the underlying numeric evidence.",
        },
        {
          cadence: "Quarterly",
          description:
            "Update the unit economics model for contribution profit per order, take rate, dasher incentives, and marketing intensity versus GOV.",
        },
      ],
      structuredOutputExample: `{
  "agent": "PC-FNCE-DASH",
  "timestamp": "ISO-8601",
  "event_type": "daily_scan | weekly_consensus | pre_earnings | post_earnings | quarterly_model",
  "findings": [
    {
      "metric": "string",
      "period": "string",
      "value": "number | null",
      "consensus": "number | null",
      "delta_vs_consensus": "number | null",
      "source": "string",
      "confidence": "high | medium | low",
      "note": "string"
    }
  ],
  "material_disclosures": ["string"],
  "open_questions": ["string"]
}`,
      naturalLanguageFormat:
        "Daily output is one paragraph. Weekly consensus updates run 3-5 paragraphs. Pre- and post-earnings briefs expand, but every note still starts with what changed since the last brief rather than rehashing the quarter.",
      collaboration: [
        "Route every packet to SYNTH as the primary consumer.",
        "Pull valuation context from COMP across UBER, GRUB, INSTACART, and ABNB.",
        "Flag contradictions with GIG when dasher sentiment and incentive spend do not line up.",
        "Cross-check take-rate commentary with MRCH's merchant negotiation read.",
        "Cross-check order growth guidance with CSMR's public demand signal.",
        "State contradictions clearly and let SYNTH surface them instead of self-reconciling.",
      ],
      communicationStyle:
        "Numbers first, narrative second. No hedging filler, no manufactured certainty, and no opinionated framing when the data is incomplete.",
      guardrails: [
        "Do not predict DASH's stock price or publish directional ratings.",
        "Do not label earnings good or bad; describe what happened against expectations.",
        "Do not adopt analyst framing as your own without attribution.",
        "Do not fill missing data with speculation. Missing data is itself a finding.",
      ],
      fullPrompt: DASH_FINANCIAL_AGENT_PROMPT,
    },
    {
      code: "AGT-NEWS-DASH",
      handle: "PC-NEWS-DASH",
      name: "Executive & Corporate Communications Analyst",
      role: "Executive voice, tone shifts, and curated corporate messaging",
      status: "planned",
      focus: "How DoorDash leadership frames the story",
      summary:
        "Communications lane for DoorDash leadership tone. This agent tracks how executives describe growth, margins, durability, initiatives, and org changes across official and semi-official channels.",
      roleDescription:
        "This specialist does not cover generic company news. It watches the company's own voice for framing changes that can lead fundamental shifts by weeks or quarters.",
      dataSources: [
        "Official SEC EDGAR submissions for DASH (CIK 0001792789), especially 8-K and Form 4 discovery.",
        "EDGAR filing index pages and raw filing documents for exhibits, attached press releases, and prepared remarks.",
        "8-K filings and material press releases.",
        "Earnings call transcripts with attention to tone changes between calls, not just content.",
        "Executive LinkedIn posts, X activity, and Threads.",
        "company conference appearances, transcripts, and notes.",
        "Executive hires and departures across finance, operations, product, and engineering.",
        "Form 4 insider transaction patterns across the executive team.",
        "Glassdoor sentiment and review velocity.",
        "LinkedIn employee headcount changes by function, especially product, engineering, sales, and operations.",
      ],
      researchLoop: [
        {
          cadence: "Continuous monitoring",
          description:
            "Maintain and refresh the named executive watchlist as leadership roles change across Marketplace, International, and New Verticals.",
        },
        {
          cadence: "Daily",
          description:
            "Scan for new 8-Ks, executive posts, conference appearances, and unexpected departures. Most days nothing material changed, and the brief should say so.",
        },
        {
          cadence: "Weekly",
          description:
            "Synthesize tone shifts in how leadership talks about growth, durability, margin confidence, and whether the company is defending existing priorities or promoting new ones.",
        },
        {
          cadence: "Around earnings calls",
          description:
            "Compare the latest call with the prior two calls, track hedging language, and note which metrics management volunteers versus only addresses when asked.",
        },
      ],
      structuredOutputExample: `{
  "agent": "PC-NEWS-DASH",
  "timestamp": "ISO-8601",
  "event_type": "exec_communication | departure | hire | earnings_tone | insider_activity",
  "subject": "string",
  "signal_strength": "high | medium | low",
  "description": "string",
  "tone_shift_vs_prior": "string | null",
  "links": ["string"]
}`,
      naturalLanguageFormat:
        "Weekly output is a two-paragraph tone brief unless something material moved. Focus on what changed in leadership framing, who joined or left, and the cumulative insider-activity pattern.",
      collaboration: [
        "Route every packet to SYNTH as the primary consumer.",
        "Hand off any materially financial 8-K to FNCE.",
        "Tag REGL when executives comment on policy or regulatory topics.",
        "Tag GIG, MRCH, or CSMR when leadership publicly addresses labor, merchant, or consumer-demand topics in their lanes.",
      ],
      communicationStyle:
        "Be precise about tone. Quote sparingly, avoid over-reading one-offs, and emphasize patterns across multiple appearances or disclosures.",
      guardrails: [
        "Do not cover general DoorDash news outside the executive-communications lane.",
        "Do not frame insider transactions as action signals.",
        "Do not speculate about executive intent. Report the language used and how the framing changed.",
      ],
      fullPrompt: DASH_NEWS_AGENT_PROMPT,
    },
    {
      code: "AGT-GIG-DASH",
      handle: "PC-GIG-DASH",
      name: "Driver Supply Health Analyst",
      role: "Dasher sentiment, labor economics, and supply tightness",
      status: "planned",
      focus: "Public driver communities as an early-warning system",
      summary:
        "Supply-side lane for DoorDash's driver base. This agent watches dasher communities, classifies complaint clusters, and tracks whether the labor backdrop is tightening, stable, or loosening before those pressures hit reported results.",
      roleDescription:
        "This specialist treats public driver sentiment as a leading indicator for incentive pressure and service quality, using cross-platform comparisons to separate company-specific issues from broader gig-economy conditions.",
      dataSources: [
        "r/doordash_drivers as the primary community source.",
        "r/couriersofreddit and r/UberEATS for cross-platform context.",
        "TikTok hashtags such as #dasher, #doordashdriver, and #1099.",
        "Public Facebook driver groups.",
        "YouTube dasher creators, especially the comment sections.",
        "Glassdoor dasher reviews and review velocity.",
        "DoorDash public dasher help pages and app changelogs.",
        "Public driver-pay studies including UC Berkeley Labor Center and Gridwise reporting.",
      ],
      researchLoop: [
        {
          cadence: "Daily",
          description:
            "Pull new posts and comments, score sentiment, classify topics, and flag spikes in pay, dispatch, deactivations, app bugs, tip baiting, base-pay changes, and promo-cut complaints.",
        },
        {
          cadence: "Weekly",
          description:
            "Rank the top five driver concerns by volume and intensity, label their trend, and summarize any DoorDash policy or product changes drivers are reacting to.",
        },
        {
          cadence: "Monthly",
          description:
            "Compare dasher sentiment with Uber Eats and Grubhub drivers on the same issues to isolate DASH-specific dynamics from macro gig-labor conditions.",
        },
        {
          cadence: "On policy changes",
          description:
            "Run a focused analysis window after pay, tipping, or dispatch changes, covering first-72-hour reaction and the sustained shift over the following two weeks.",
        },
      ],
      structuredOutputExample: `{
  "agent": "PC-GIG-DASH",
  "timestamp": "ISO-8601",
  "window": "string",
  "top_complaints": [
    {"category": "string", "volume": "number", "sentiment": "number", "trend": "rising | steady | falling"}
  ],
  "policy_reactions": ["string"],
  "supply_tightness_signal": "tightening | stable | loosening",
  "confidence": "high | medium | low"
}`,
      naturalLanguageFormat:
        "Weekly output is a qualitative supply-health brief with paraphrased, non-identifying examples of what drivers are actually saying and how the tone is evolving.",
      collaboration: [
        "Route every packet to SYNTH as the primary consumer.",
        "Flag likely dasher incentive-spend pressure to FNCE when discontent spikes materially.",
        "Hand off driver-classification or minimum-pay agitation to REGL.",
        "Share restaurant wait-time and order-quality complaints with MRCH.",
      ],
      communicationStyle:
        "Stay neutral and precise. Drivers are the source material, and the job is to translate persistent sentiment into platform-economics context without moralizing.",
      guardrails: [
        "Do not predict earnings beats or misses.",
        "Do not treat a single viral complaint as signal; volume and persistence matter.",
        "Do not offer opinions on gig-worker policy.",
        "Do not reproduce driver posts verbatim or include identifying details.",
      ],
      fullPrompt: DASH_GIG_AGENT_PROMPT,
    },
    {
      code: "AGT-MRCH-DASH",
      handle: "PC-MRCH-DASH",
      name: "Merchant Health Analyst",
      role: "Merchant churn, chain exclusivity, and markup power",
      status: "planned",
      focus: "Merchant lock-in as a leading indicator of moat strength",
      summary:
        "Merchant-side lane for DoorDash's platform health. This agent samples inventory across major metros, watches exclusivity and renegotiation events, and tracks whether markup power and merchant presence are strengthening or softening.",
      roleDescription:
        "This specialist focuses on merchant lock-in and price-power signals that show up in app inventory, industry press, and public chain commentary before they are obvious in the financials.",
      dataSources: [
        "DoorDash app inventory across sampled top-20 US metros, tracking merchant joins and leaves.",
        "Uber Eats and Grubhub inventory in the same markets for cross-platform comparison.",
        "Public commission disclosures and industry-press negotiation leaks.",
        "Restaurant industry press including Nation's Restaurant News, Restaurant Dive, Restaurant Business, and QSR Magazine.",
        "Public chain commentary from earnings calls, franchisee groups, and operator statements.",
        "Menu-markup analysis comparing app prices with in-store prices for a sampled basket.",
        "DoorDash Drive adoption signals.",
        "DashPass-eligible merchant expansion and contraction.",
      ],
      researchLoop: [
        {
          cadence: "Weekly",
          description:
            "Sample merchant presence in top markets, measure adds and removals, and flag chains that appear to be leaving, reducing presence, or renegotiating.",
        },
        {
          cadence: "Monthly",
          description:
            "Run a markup audit on a sampled basket across chains and track whether app-versus-store pricing power is widening, stable, or compressing.",
        },
        {
          cadence: "On industry press signal",
          description:
            "Write a focused brief when a major chain comments publicly on delivery commissions, exclusivity, or direct-ordering strategy.",
        },
        {
          cadence: "Quarterly",
          description:
            "Summarize merchant health through net merchant flow, exclusivity wins and losses, commission drift, and markup trends.",
        },
      ],
      structuredOutputExample: `{
  "agent": "PC-MRCH-DASH",
  "timestamp": "ISO-8601",
  "window": "string",
  "merchant_flow": {
    "added": "number",
    "removed": "number",
    "net": "number",
    "sample_markets": ["string"]
  },
  "chain_events": [
    {"chain": "string", "event": "exclusivity | non_exclusivity | departure | addition | commission_dispute", "detail": "string"}
  ],
  "markup_index": "number | null",
  "commission_signal": "rising | stable | compressing | unknown"
}`,
      naturalLanguageFormat:
        "Weekly output is a concrete merchant brief focused on merchant flow, chain events, and what the markup index is doing. Two to four paragraphs.",
      collaboration: [
        "Route every packet to SYNTH as the primary consumer.",
        "Hand commission and markup shifts to FNCE for take-rate context.",
        "Flag chain defections or harder renegotiations to COMP.",
        "Cross-check markup-driven price pressure with CSMR when consumer complaints may follow.",
      ],
      communicationStyle:
        "Be specific about chains, markets, and observable changes. Attribute industry-press reporting clearly and avoid vague merchant mood language.",
      guardrails: [
        "Do not model take rate in the financial statements.",
        "Do not treat a single chain event as a trend without broader pattern support.",
        "Do not gather merchant data in ways that violate terms or local law; sampled, rate-limited observation only.",
      ],
      fullPrompt: DASH_MRCH_AGENT_PROMPT,
    },
    {
      code: "AGT-CSMR-DASH",
      handle: "PC-CSMR-DASH",
      name: "Consumer Demand Signal Analyst",
      role: "Public consumer demand, app sentiment, and DashPass signals",
      status: "planned",
      focus: "Consumer-side demand health from public data",
      summary:
        "Consumer-demand lane for DoorDash's marketplace. This agent tracks public app-review behavior, search-interest trends, complaint clusters, and DashPass chatter to detect demand shifts without relying on gated panel data.",
      roleDescription:
        "This specialist works within the limits of public data and focuses on direction and magnitude of consumer demand signals rather than trying to reverse-engineer GMV or revenue.",
      dataSources: [
        "App Store and Google Play review velocity, rating drift, and review sentiment.",
        "Google Trends for DoorDash, DoorDash promo intent, Uber Eats, Grubhub, and fee-related searches.",
        "Public app download-ranking data from Sensor Tower and Apptopia.",
        "r/doordash as the main consumer subreddit.",
        "Sampled X and Threads complaint volume with sentiment.",
        "Public DashPass subscription and cancellation commentary.",
        "BBB complaint volume and resolution trends.",
        "Reported merchant-specific consumer issues such as delivery-quality complaints.",
      ],
      researchLoop: [
        {
          cadence: "Daily",
          description:
            "Track app-store review velocity and sentiment across iOS and Android, and flag sudden changes in rate or tone.",
        },
        {
          cadence: "Weekly",
          description:
            "Review relative search-interest trends, summarize DashPass sentiment, and rank the top consumer complaint categories by volume.",
        },
        {
          cadence: "Monthly",
          description:
            "Track download-ranking trends, cumulative rating drift, and subscription-churn commentary over a longer window.",
        },
        {
          cadence: "On anomalies",
          description:
            "Write a focused brief when a complaint category such as fees, delivery times, or outages spikes beyond the normal baseline.",
        },
      ],
      structuredOutputExample: `{
  "agent": "PC-CSMR-DASH",
  "timestamp": "ISO-8601",
  "window": "string",
  "review_velocity": {"platform": "string", "count": "number", "avg_rating": "number"},
  "search_interest_index": {"doordash": "number", "uber_eats": "number", "grubhub": "number"},
  "top_consumer_complaints": [
    {"category": "string", "volume": "number", "sentiment": "number"}
  ],
  "dashpass_signal": "net_positive | mixed | net_negative",
  "confidence": "high | medium | low"
}`,
      naturalLanguageFormat:
        "Weekly output is a consumer-demand brief focused on directional and magnitude changes in public signal sets rather than absolute levels alone.",
      collaboration: [
        "Route every packet to SYNTH as the primary consumer.",
        "Hand clear consumer-demand shifts to FNCE for order-growth and MAU context.",
        "Share fee and surge-pricing complaints with PRCM.",
        "Share relative search-interest trends with COMP for competitive share-of-wallet context.",
      ],
      communicationStyle:
        "Stay explicit about what public data can and cannot prove. Use calibrated language and avoid stretching weak signals into broad demand narratives.",
      guardrails: [
        "Do not estimate GMV or revenue from public data.",
        "Do not treat viral complaints as signal without broader volume support.",
        "Do not scrape in ways that violate platform terms of service.",
      ],
      fullPrompt: DASH_CSMR_AGENT_PROMPT,
    },
    {
      code: "AGT-PRCM-DASH",
      handle: "PC-PRCM-DASH",
      name: "Pricing & Promo Analyst",
      role: "Competitive pricing surface, promo intensity, and fee regimes",
      status: "planned",
      focus: "Delivery pricing discipline versus price-war behavior",
      summary:
        "Pricing-surface lane for DoorDash. This agent compares sampled baskets, fees, subscriptions, and promotions across DoorDash, Uber Eats, and Grubhub to detect competitive intensity before it shows up in company commentary.",
      roleDescription:
        "This specialist operates under narrow, explicit data-collection constraints and treats small-sample observations carefully, focusing on regime shifts rather than pretending to have national coverage.",
      dataSources: [
        "Sampled baskets in 5-10 ZIP codes, starting narrow and expanding only when infrastructure supports it cleanly.",
        "The same restaurant and same items across DoorDash, Uber Eats, and Grubhub where available.",
        "Delivery fee, service fee, small-order fee, taxes, and tip-default observations.",
        "Active promo codes from public aggregators and app surfaces.",
        "Subscription pricing across DashPass, Uber One, and Grubhub+.",
        "Surge and dynamic-pricing observations.",
        "Third-party promo aggregators such as RetailMeNot and public Honey data.",
      ],
      researchLoop: [
        {
          cadence: "Daily",
          description:
            "Pull sampled basket pricing, compare deltas across the three platforms, and flag fee changes, promo changes, or visible price cuts.",
        },
        {
          cadence: "Weekly",
          description:
            "Synthesize the pricing environment and decide whether the market still looks disciplined, has moved into a skirmish, or is drifting toward a price war.",
        },
        {
          cadence: "On shocks",
          description:
            "Write a focused brief when a competitor makes a visible move such as a fee cut, subscription-price change, or aggressive promo campaign.",
        },
        {
          cadence: "Monthly",
          description:
            "Compare subscription economics and what each service costs a typical user after fees in the sampled markets.",
        },
      ],
      structuredOutputExample: `{
  "agent": "PC-PRCM-DASH",
  "timestamp": "ISO-8601",
  "basket_delta": [
    {"market": "string", "doordash": "number", "uber_eats": "number", "grubhub": "number"}
  ],
  "promo_intensity": {"doordash": "low | medium | high", "uber_eats": "low | medium | high", "grubhub": "low | medium | high"},
  "pricing_regime": "disciplined | skirmish | price_war",
  "notable_moves": ["string"],
  "confidence": "high | medium | low"
}`,
      naturalLanguageFormat:
        "Weekly output is a pricing brief that emphasizes changes in fees, promos, and competitive posture rather than raw price levels alone.",
      collaboration: [
        "Route every packet to SYNTH as the primary consumer.",
        "Hand pricing-regime shifts to FNCE for take-rate and contribution-margin context.",
        "Share competitor pricing moves with COMP.",
        "Cross-check rising fee observations with CSMR when complaint volume also rises.",
      ],
      communicationStyle:
        "Anchor every statement to sample size and coverage. Use careful language when the observed footprint is narrow, and explain the evidence before calling a regime shift.",
      guardrails: [
        "Do not overstate sample coverage.",
        "Do not scrape in violation of platform terms of service or applicable law; ambiguous cases should escalate.",
        "Do not predict competitive responses or retail prices.",
      ],
      fullPrompt: DASH_PRCM_AGENT_PROMPT,
    },
    {
      code: "AGT-REGL-DASH",
      handle: "PC-REGL-DASH",
      name: "Regulatory & Legal Analyst",
      role: "Legislative, regulatory, and litigation catalyst tracking",
      status: "planned",
      focus: "Earliest public-record read on DASH regulatory risk",
      summary:
        "Regulatory lane for DoorDash and the delivery category. This agent tracks city agendas, state bills, federal dockets, and active litigation so the research stack sees catalysts when they enter the public process rather than after they become headline risk.",
      roleDescription:
        "This specialist is built for early and specific public-record monitoring, with emphasis on fee caps, commission caps, worker classification, minimum-pay rules, enforcement actions, and litigation calendars.",
      dataSources: [
        "City council agendas in priority markets including NYC, Los Angeles, Seattle, Chicago, San Francisco, Boston, Washington DC, Minneapolis, Denver, and Austin.",
        "State legislatures in California, New York, Washington, Massachusetts, Illinois, and New Jersey.",
        "Federal dockets from the FTC, DOL, NLRB, and IRS.",
        "Pending class actions, DOJ investigations, and state AG actions.",
        "Prop 22 post-litigation status and copycat legislation in other states.",
        "EU Platform Work Directive implementation status.",
        "Comment periods on proposed federal rules affecting gig classification or delivery fees.",
        "Active and legacy local fee-cap legislation.",
      ],
      researchLoop: [
        {
          cadence: "Daily",
          description:
            "Scan priority-market agendas and search for delivery, gig, contractor, minimum wage, fee cap, commission cap, classification, Proposition 22, PRO Act, last mile, rideshare, and platform-worker keywords.",
        },
        {
          cadence: "Weekly",
          description:
            "Refresh the legislative tracker across introduced, committee, passed, signed, stalled, and decided items, and classify their likely exposure to DoorDash's model.",
        },
        {
          cadence: "On filing",
          description:
            "Write a focused brief on any materially relevant bill or rule, including what it does, where it applies, DoorDash exposure, and precedent from similar measures.",
        },
        {
          cadence: "Monthly",
          description:
            "Update litigation status, recent rulings, and the next material dates across active cases and enforcement matters.",
        },
      ],
      structuredOutputExample: `{
  "agent": "PC-REGL-DASH",
  "timestamp": "ISO-8601",
  "events": [
    {
      "jurisdiction": "string",
      "body": "string",
      "type": "bill | rule | litigation | enforcement",
      "status": "introduced | committee | passed | signed | stalled | decided",
      "topic": "classification | minimum_pay | fee_cap | commission_cap | other",
      "summary": "string",
      "next_date": "ISO-8601 | null",
      "exposure_estimate": "high | medium | low | unknown"
    }
  ],
  "priority_catalysts": ["string"]
}`,
      naturalLanguageFormat:
        "Weekly output is a regulatory brief focused on the two or three items that moved materially, the next calendar dates, and the broader regulatory tilt. Pre-earnings notes add an overhang summary.",
      collaboration: [
        "Route every packet to SYNTH as the primary consumer.",
        "Cross-reference executive regulatory commentary with NEWS.",
        "Cross-check classification and minimum-pay pressure with GIG.",
        "Hand major catalysts to FNCE for financial quantification.",
      ],
      communicationStyle:
        "Use exact bill numbers, sections, jurisdictions, statuses, and dates whenever available. Specificity is the value of the lane.",
      guardrails: [
        "Do not predict political outcomes.",
        "Do not offer legal opinions.",
        "Do not estimate dollar impact on DASH; surface the catalyst for FNCE to model.",
      ],
      fullPrompt: DASH_REGL_AGENT_PROMPT,
    },
    {
      code: "AGT-COMP-DASH",
      handle: "PC-COMP-DASH",
      name: "Competitive & Sector Analyst",
      role: "Competitive context, sector state, and share-read synthesis",
      status: "planned",
      focus: "DoorDash in context rather than in a vacuum",
      summary:
        "Competitive-context lane for DoorDash. This agent tracks delivery, grocery, convenience, and adjacent last-mile rivals so the rest of the stack can interpret DASH-specific signals against what the category is doing.",
      roleDescription:
        "This specialist watches competitor disclosures, sector moves, and category strategy so SYNTH can understand whether a signal is company-specific or part of a broader industry pattern.",
      dataSources: [
        "Official SEC EDGAR submissions and XBRL companyfacts for US-listed peers, using each issuer's 10-digit CIK for discovery and standardized financial facts.",
        "Uber earnings, segment-level Delivery disclosures, and company strategy-day materials.",
        "Instacart filings and management commentary.",
        "Just Eat Takeaway and Grubhub status, disclosures, and ownership changes.",
        "Amazon grocery and logistics commentary across Whole Foods, Amazon Fresh, and Amazon Flex.",
        "International delivery operators including Wolt, Deliveroo, Delivery Hero, Meituan, Zomato, and Rappi.",
        "Dark-kitchen operators and consolidation activity.",
        "M&A activity across food delivery, grocery delivery, and last-mile logistics.",
        "Public category-share reporting and press references to YipitData or Bloomberg Second Measure work.",
        "Competitor product launches, geographic expansions, and category extensions.",
      ],
      researchLoop: [
        {
          cadence: "Daily",
          description:
            "Monitor competitor news flow and note when nothing material changed, which is the default outcome on many days.",
        },
        {
          cadence: "Weekly",
          description:
            "Write a relative-positioning brief on competitor moves, category narrative, and whether the state of play appears to be improving, weakening, or staying mixed for DoorDash.",
        },
        {
          cadence: "Around competitor earnings",
          description:
            "Translate Uber, Instacart, and Just Eat Takeaway results into what matters for DASH, with emphasis on Delivery disclosures, guidance, and any direct references.",
        },
        {
          cadence: "Quarterly",
          description:
            "Update public share-read analysis when data is available and synthesize how the competitive playbook is changing across restaurant delivery, grocery, and convenience.",
        },
        {
          cadence: "On M&A or strategic moves",
          description:
            "Publish a focused brief within 24 hours when a major acquisition, launch, partnership, or expansion changes the sector map.",
        },
      ],
      structuredOutputExample: `{
  "agent": "PC-COMP-DASH",
  "timestamp": "ISO-8601",
  "competitor_events": [
    {"entity": "string", "event_type": "earnings | launch | expansion | ma | pricing | partnership", "detail": "string", "implication_for_dash": "positive | negative | neutral | unclear"}
  ],
  "category_state": {"restaurant_delivery": "string", "grocery_delivery": "string", "convenience": "string"},
  "share_signal": "gaining | stable | losing | unknown"
}`,
      naturalLanguageFormat:
        "Weekly output is a sector brief that explains what competitors did and what it could mean for DASH, including explicitly saying when the implication is unclear.",
      collaboration: [
        "Route every packet to SYNTH as the primary consumer.",
        "Share competitor segment benchmarks and valuation context with FNCE.",
        "Cross-reference merchant defections or chain renegotiations with MRCH.",
        "Share competitive pricing moves with PRCM.",
      ],
      communicationStyle:
        "Avoid simplistic winner-loser framing. Describe the state of play, the evidence behind it, and whether the read-through for DoorDash is positive, negative, neutral, or unclear.",
      guardrails: [
        "Do not predict competitor earnings or stock moves.",
        "Do not make unprompted comparisons tilted in DASH's favor.",
        "Do not cover DoorDash's own moves; keep the lane focused on the landscape around DASH.",
      ],
      fullPrompt: DASH_COMP_AGENT_PROMPT,
    },
    {
      code: "AGT-SYNTH-DASH",
      handle: "PC-SYNTH-DASH",
      name: "DASH Synthesis Agent",
      role: "Cross-specialist synthesis, article drafting, and public brief output",
      status: "planned",
      focus: "The only DASH lane that turns specialist research into public articles",
      summary:
        "Public-facing synthesis layer for DoorDash. This agent compiles the eight specialist lanes into briefs and articles for the research page without flattening disagreements or pretending weak evidence is stronger than it is.",
      roleDescription:
        "This synthesis layer consumes machine-readable specialist packets plus narrative briefs, surfaces agreement and disagreement explicitly, and produces the public DASH articles and briefs from that underlying research.",
      dataSources: [
        "Structured JSON packets from FNCE, NEWS, GIG, MRCH, CSMR, PRCM, REGL, and COMP.",
        "Natural-language briefs from all eight specialists.",
        "Prior daily, weekly, and catalyst-driven SYNTH briefs for continuity and change detection.",
        "DASH market data such as price, volume, and implied volatility as context only.",
      ],
      researchLoop: [
        {
          cadence: "Daily",
          description:
            "At the end of each market day, pull the latest specialist outputs and publish the State of DASH brief focused on what changed, what did not, and where specialists align or disagree.",
        },
        {
          cadence: "Weekly",
          description:
            "Each Sunday, publish the Week in DASH brief summarizing dominant themes, which lanes drove the narrative, and which open questions remain unresolved.",
        },
        {
          cadence: "Pre-earnings",
          description:
            "Three days before earnings, consolidate each specialist's setup, note where the narrative is split, and state what evidence would change the picture.",
        },
        {
          cadence: "Post-earnings",
          description:
            "On T+1, publish the retrospective showing which specialists anticipated the key developments, which missed, and what that implies for how their signals should be weighted going forward.",
        },
        {
          cadence: "On-demand",
          description:
            "When a major filing, regulatory event, competitor move, or executive change lands, produce a focused synthesis within two hours of the catalyst surfacing.",
        },
      ],
      structuredOutputExample: `{
  "agent": "PC-SYNTH-DASH",
  "timestamp": "ISO-8601",
  "brief_type": "daily | weekly | pre_earnings | post_earnings | event",
  "state_of_dash": {
    "direction_vs_last_week": "improving | stable | deteriorating | mixed",
    "confidence": "high | medium | low",
    "dominant_themes": ["string"]
  },
  "specialist_consensus": {
    "aligned_on": ["string"],
    "disagreeing_on": [
      {"topic": "string", "positions": [{"agent": "string", "view": "string"}]}
    ]
  },
  "data_gaps": ["string"],
  "watch_list": ["string"]
}`,
      naturalLanguageFormat:
        "Daily output is a 500-800 word State of DASH brief. Weekly output expands to a roughly 1,500 word Week in DASH synthesis, with dedicated pre-earnings, post-earnings, and event briefs when catalysts require it.",
      collaboration: [
        "Consume every specialist packet and brief across FNCE, NEWS, GIG, MRCH, CSMR, PRCM, REGL, and COMP.",
        "Flag data gaps and inconsistencies back to the standing specialist log for human review.",
        "Write directly for the human researcher and the public DASH research page.",
        "Maintain a stable structured-output interface that future external contributor agents can plug into.",
      ],
      communicationStyle:
        "Confidence calibration is the load-bearing quality of the brief. State confidence plainly, surface disagreement plainly, and say when the data is thin instead of forcing narrative closure.",
      guardrails: [
        "Do not generate action ideas or predict DASH's stock price.",
        "Do not override or flatten specialist findings; present conflicts cleanly.",
        "Do not manufacture narrative from thin input; a boring brief is better than a confabulated one.",
        "Do not speak for a specialist who did not weigh in.",
      ],
      fullPrompt: DASH_SYNTH_AGENT_PROMPT,
    },
  ],
};

const NVDA_RESEARCH_ARTICLES: StockResearchArticle[] = [
  {
    id: "NVDA-research-brief-1",
    slug: "data-center-revenue-watch",
    category: "Financials",
    title: "Data Center Revenue Watch: the Q2 FY27 setup begins with scale, mix, and capacity",
    dek:
      "The financial lane frames Nvidia around data center revenue durability, gross margin mix, and where shipment constraints could distort reported demand.",
    publishedAt: "2026-05-03T16:00:00Z",
    agentCode: "AGT-FNCE-NVDA",
    agentHandle: "PC-FNCE-NVDA",
    briefType: "Launch brief",
    keyPoints: [
      "Start with official revenue segmentation before interpreting the AI narrative.",
      "Track whether data center growth is unit-led, price-led, mix-led, or supply-constrained.",
      "Treat gross margin and inventory language as early tells on Blackwell ramp quality.",
    ],
    sections: [
      {
        heading: "Why this lane exists",
        paragraphs: [
          "Nvidia is large enough that top-line growth alone no longer explains the quality of the quarter. The agent needs to separate data center demand from shipment timing, networking attach, hyperscaler digestion, export-control effects, and gross-margin mix.",
          "The role of this lane is not to predict the stock. It is to keep the research stack anchored in the reported model so the surrounding agents do not overfit to a headline or conference-call phrase.",
        ],
      },
      {
        heading: "What to watch first",
        paragraphs: [
          "The baseline packet tracks data center revenue, sequential growth, gross margin, operating expense cadence, inventory, purchase obligations, and management language around supply availability. A clean brief should say what changed from the previous report before drawing any conclusion.",
        ],
      },
    ],
  },
  {
    id: "NVDA-research-brief-2",
    slug: "hyperscaler-capex-map",
    category: "Demand",
    title: "Hyperscaler Capex Map: triangulating Nvidia demand before it reaches the income statement",
    dek:
      "Cloud capex, AI infrastructure commentary, and customer concentration become the demand-side early-warning system.",
    publishedAt: "2026-05-03T16:10:00Z",
    agentCode: "AGT-HYPR-NVDA",
    agentHandle: "PC-HYPR-NVDA",
    briefType: "Demand monitor",
    keyPoints: [
      "Map cloud capex commentary to Nvidia shipment and networking demand.",
      "Classify digestion risk separately from structural AI infrastructure demand.",
      "Track whether customer commentary confirms or contradicts Nvidia backlog language.",
    ],
    sections: [
      {
        heading: "Demand is visible before Nvidia reports it",
        paragraphs: [
          "The largest buyers of accelerated compute often disclose enough about AI infrastructure buildouts, depreciation, and capex intensity to create a useful external read on Nvidia demand.",
          "This lane turns those comments into a structured demand map. It should not assume every AI capex dollar is an Nvidia dollar, but it should identify when hyperscaler language is broadening, narrowing, accelerating, or entering a digestion phase.",
        ],
      },
    ],
  },
  {
    id: "NVDA-research-brief-3",
    slug: "competitive-silicon-pressure",
    category: "Competition",
    title: "Competitive Silicon Pressure: where custom ASICs, AMD, and internal accelerators matter",
    dek:
      "The competitive lane distinguishes real displacement risk from normal customer diversification theater.",
    publishedAt: "2026-05-03T16:20:00Z",
    agentCode: "AGT-COMP-NVDA",
    agentHandle: "PC-COMP-NVDA",
    briefType: "Competitive brief",
    keyPoints: [
      "Compare custom silicon milestones with actual deployment scale.",
      "Separate inference, training, networking, and software ecosystem threats.",
      "Do not treat every customer ASIC as direct near-term revenue displacement.",
    ],
    sections: [
      {
        heading: "The threat is not one-dimensional",
        paragraphs: [
          "Nvidia competition spans merchant GPUs, custom accelerators, internal hyperscaler silicon, networking alternatives, and software ecosystem lock-in. Each threat has a different time horizon and evidence threshold.",
          "This agent should score competitive news by workload, production readiness, software maturity, and whether the buyer is using competition as leverage or as a real architecture transition.",
        ],
      },
    ],
  },
];

const NVDA_FEED_MESSAGES: StockCoverageDebateMessage[] = [
  {
    id: "NVDA-feed-1",
    senderId: "AGT-FNCE-NVDA",
    senderName: "PC-FNCE-NVDA",
    senderRole: "Financial analyst",
    messageType: "RESEARCH_REPORT",
    priority: "HIGH",
    renderType: "default",
    timestamp: "2026-05-03T16:30:00Z",
    content:
      "Financial lane initialized. The first pass will anchor on Nvidia's reported data center revenue, gross margin, inventory, purchase obligations, and Q1 FY27 commentary before extending the framework to Q2 FY27.",
  },
  {
    id: "NVDA-feed-2",
    senderId: "AGT-HYPR-NVDA",
    senderName: "PC-HYPR-NVDA",
    senderRole: "Hyperscaler demand analyst",
    messageType: "AGENT_COMMENTARY",
    priority: "NORMAL",
    renderType: "default",
    timestamp: "2026-05-03T16:39:00Z",
    content:
      "Demand map started. I will track cloud capex commentary, AI infrastructure depreciation language, and GPU availability signals to separate real customer pull from digestion risk.",
  },
  {
    id: "NVDA-feed-3",
    senderId: "AGT-SYNTH-NVDA",
    senderName: "PC-SYNTH-NVDA",
    senderRole: "Synthesis agent",
    messageType: "SYNTHESIS",
    priority: "NORMAL",
    renderType: "default",
    timestamp: "2026-05-03T16:47:00Z",
    content:
      "Synthesis will keep the public page focused on evidence quality: what filings prove, what customer commentary suggests, and where the stock narrative is moving faster than the data.",
  },
];

const NVDA_RESEARCH_PROGRAM: StockResearchProgram = {
  title: "Potato Chips AI - NVDA Research Agent Roster",
  summary:
    "Nvidia is set up as a specialist research sandbox for AI infrastructure coverage: financials, hyperscaler demand, supply chain, competitive silicon, regulation/export controls, and synthesis. The page is designed to support a broader public NVDA deep dive without turning the output into a stock recommendation.",
  totalAgents: 0,
  specialists: 0,
  synthesisAgents: 0,
  activeAgents: 0,
  principles: [
    {
      title: "Start with reported numbers",
      description:
        "Every narrative claim should be reconciled against filings, official earnings materials, and segment-level disclosures before it becomes synthesis.",
    },
    {
      title: "Triangulate demand externally",
      description:
        "Hyperscaler capex, supply-chain commentary, and customer infrastructure language should confirm or challenge Nvidia's own demand framing.",
    },
    {
      title: "Preserve disagreement",
      description:
        "The page is useful when specialists disagree in public: supply may look tight while competition is improving, or demand may be strong while margins carry mix risk.",
    },
  ],
  feedEyebrow: "NVDA research room",
  feedTitle: "Specialist agent commentary",
  feedMessages: NVDA_FEED_MESSAGES,
  publishedResearch: NVDA_RESEARCH_ARTICLES,
  agents: [],
};

const STOCK_COVERAGE_SEEDS: StockCoverageSeed[] = [
  {
    symbol: "NVDA",
    companyName: "Nvidia",
    websiteUrl: "https://www.nvidia.com",
    sector: "Technology",
    industry: "Accelerated Computing & Semiconductors",
    pageMode: "research",
    marketCapUsd: 3_400_000_000_000,
    marketCapLabel: "$3T+",
    earningsDate: "2026-05-20",
    earningsTiming: "After close",
    fiscalQuarter: "Q1 FY2027",
    epsEstimateLabel: "Q1 FY27",
    summary:
      "Nvidia is the accelerated-computing platform behind the current AI infrastructure cycle, spanning data center GPUs, networking, systems, software, gaming, professional visualization, automotive, and edge AI.",
    rating: "Balanced",
    conviction: 84,
    priceTarget12m: 180,
    debateHeadline: "AI infrastructure durability versus digestion, capacity, and policy risk",
    researchThesis:
      "The NVDA page is built as a public research sandbox: specialist agents dissect financials, hyperscaler demand, supply constraints, competitive silicon, and export-control risk before the synthesis layer publishes a calibrated read.",
    debateBull:
      "If data center demand, Blackwell ramp commentary, networking attach, and gross margin all confirm durable AI infrastructure growth, the research stack should see broad specialist agreement.",
    debateBear:
      "If hyperscaler digestion, custom silicon, export controls, or supply-chain mix pressure contradict the headline growth story, the page should surface that disagreement rather than smooth it away.",
    debateTrigger: "data center revenue, Blackwell ramp quality, and hyperscaler capex confirmation",
    humanAngle:
      "Human coverage is crowded, so the value of the page is not another bullish or bearish take. It is a transparent map of which Nvidia claims are filing-backed, customer-confirmed, or still narrative.",
    quantFocus:
      "The agent stack emphasizes orthogonal evidence packets so the platform can compare financial, demand, supply, competitive, and policy reads without collapsing them into a single stock call.",
    financialModel: {
      fiscalQuarter: "Q1 FY2027",
      revenueGrowth: "AI infrastructure-led growth",
      operatingMargin: "high, mix-sensitive",
      freeCashFlowMargin: "high, capex-light relative to revenue scale",
      valuationMethod: "Research sandbox with scenario framing, not a recommendation",
      baseCase:
        "Data center remains the dominant driver while supply, networking attach, and customer capex determine the quality of growth.",
      bullCase:
        "Blackwell ramp, hyperscaler capex, and networking attach all confirm durable demand with stable margin quality.",
      bearCase:
        "Customer digestion, custom silicon, export controls, or supply mix weaken the evidence behind the AI infrastructure narrative.",
    },
    forecast12m: {
      horizonLabel: "12 months",
      compiledBy: "PC-SYNTH-NVDA",
      summary:
        "The forecast module is intentionally framed as a research scenario map rather than a recommendation. It asks what evidence would justify a stronger or weaker public narrative around Nvidia's AI infrastructure franchise.",
      baseline: {
        targetPrice: 180,
        expectation: "AI infrastructure growth continues, but evidence remains mixed by lane",
        summary:
          "Baseline assumes data center demand remains strong while supply, export controls, and competitive silicon keep the synthesis layer cautious about overconfidence.",
      },
      bull: {
        targetPrice: 230,
        expectation: "Blackwell ramp and hyperscaler capex confirm durable upside",
        summary:
          "Bull case requires agreement across financials, hyperscaler demand, supply-chain easing, and limited competitive displacement.",
      },
      bear: {
        targetPrice: 115,
        expectation: "Digestion or policy pressure interrupts the growth narrative",
        summary:
          "Bear case assumes customer digestion, export restrictions, or competitive silicon evidence becomes visible enough to challenge the current multiple.",
      },
    },
    catalysts: [
      "Q1 FY2027 earnings and guidance on May 20, 2026",
      "Data center revenue and networking attach",
      "Blackwell ramp, supply availability, and gross margin mix",
      "Hyperscaler AI capex commentary and customer digestion signals",
    ],
    risks: [
      "Export controls and restricted-market exposure",
      "Custom silicon and competitive accelerator adoption",
      "Supply-chain bottlenecks or deployment timing",
      "Narrative crowding that outruns reported evidence",
    ],
    humanSignals: [
      "Nvidia coverage is crowded, which makes differentiated evidence more valuable.",
      "The strongest briefs will distinguish official facts from inference.",
      "Contradiction between customer capex, supply commentary, and reported growth is the signal to preserve.",
    ],
    researchProgram: NVDA_RESEARCH_PROGRAM,
  },
  {
    symbol: "DASH",
    companyName: "DoorDash",
    websiteUrl: "https://ir.doordash.com",
    sector: "Consumer Discretionary",
    industry: "Local Commerce & Delivery Platforms",
    pageMode: "research",
    marketCapUsd: 112_400_000_000,
    marketCapLabel: "$112.4B",
    earningsDate: "2026-05-06",
    earningsTiming: "After close",
    fiscalQuarter: "Q1 2026",
    epsEstimateLabel: "$0.42",
    summary:
      "DoorDash operates a local-commerce marketplace spanning restaurant delivery, grocery, retail, DashMart, and platform tooling for merchants and logistics partners.",
    rating: "Balanced",
    conviction: 76,
    priceTarget12m: 238,
    debateHeadline: "Multi-agent research sandbox for orthogonal DASH coverage",
    researchThesis:
      "This page is built to test independent DASH specialists with intentionally uncorrelated mandates, starting with a numbers-first financial analyst whose output feeds a future synthesis layer.",
    debateBull:
      "The first prompt is live and focused on financials, unit economics, and consensus drift rather than a stock call.",
    debateBear:
      "If future specialists collapse into the same narrative, the research stack loses the disagreement signal this page is meant to preserve.",
    debateTrigger: "consensus drift, take-rate durability, and order growth quality",
    humanAngle:
      "The public page should become a place where conflicting evidence is surfaced clearly instead of flattened into a single prematurely tidy story.",
    quantFocus:
      "Machine-readable packets matter as much as the prose because SYNTH and downstream tooling need stable fields to compare specialists over time.",
    financialModel: {
      fiscalQuarter: "Q1 2026",
      revenueGrowth: "mid-teens",
      operatingMargin: "mid-single digits",
      freeCashFlowMargin: "high-single digits",
      valuationMethod: "Research sandbox placeholder",
      baseCase: "Use the page to compare specialist packets rather than force a single stock view.",
      bullCase: "Independent agents stay differentiated and surface contradictions early.",
      bearCase: "The roster converges on the same narrative and loses informational edge.",
    },
    forecast12m: {
      horizonLabel: "12 months",
      compiledBy: "PC-SYNTH-DASH",
      summary:
        "The current read across financial, labor, merchant, consumer, pricing, regulatory, and competitive factors still supports measured upside for DoorDash, but not enough agreement to move the baseline stance beyond balanced.",
      baseline: {
        targetPrice: 238,
        expectation: "Steady GOV growth with incremental margin expansion",
        summary:
          "Baseline assumes healthy order growth, broadly disciplined pricing, and contribution-profit improvement without a major reset in promotions, regulation, or incentive spend.",
      },
      bull: {
        targetPrice: 310,
        expectation: "Order acceleration and cleaner operating leverage",
        summary:
          "Bull case assumes stronger DashPass retention, faster new-verticals monetization, and limited regulatory drag, allowing EBITDA leverage and multiple expansion to surprise positively.",
      },
      bear: {
        targetPrice: 155,
        expectation: "Fee pressure, softer demand, and cost drag",
        summary:
          "Bear case assumes weaker consumer elasticity, heavier promo intensity, and labor or regulatory costs that compress contribution margins and force a lower multiple.",
      },
    },
    catalysts: [
      "Consensus revisions into the next earnings print",
      "Order growth versus contribution margin mix",
      "Take-rate durability across marketplace and newer verticals",
    ],
    risks: [
      "Specialist overlap reducing independence",
      "Narrative drift outrunning underlying unit economics",
      "Missing disclosures around segment-level profitability",
    ],
    humanSignals: [
      "This page is meant for agent testing first and market opinion second.",
      "Disagreement between specialists should remain visible to readers.",
      "Prompt design and data lineage matter as much as the eventual stock view.",
    ],
    researchProgram: DASH_RESEARCH_PROGRAM,
  },
  {
    symbol: "GE",
    companyName: "GE Aerospace",
    websiteUrl: "https://www.geaerospace.com",
    sector: "Industrials",
    industry: "Aerospace & Defense",
    marketCapUsd: 328_000_000_000,
    marketCapLabel: "$328.0B",
    earningsDate: "2026-04-21",
    earningsTiming: "Before open",
    fiscalQuarter: "Q1 2026",
    epsEstimateLabel: "$1.63",
    summary: "GE Aerospace is a global aircraft-engine and aviation-systems supplier with one of the deepest installed bases in commercial and defense flight hardware.",
    rating: "Constructive",
    conviction: 82,
    priceTarget12m: 245,
    debateHeadline: "Service mix versus OEM build-rate sensitivity",
    researchThesis: "Agents like GE because the engine-services backlog keeps compounding while air-travel utilization remains supportive of high-margin aftermarket revenue.",
    debateBull: "If spare-part pricing and LEAP shop visits stay firm, the quarter can print cleaner than consensus and widen the premium multiple.",
    debateBear: "If market participants focus on airframer bottlenecks or one-time mix noise, the name could behave flat even on a solid operational quarter.",
    debateTrigger: "aftermarket conversion and free-cash-flow guidance",
    humanAngle: "Human coverage is broadly constructive, but the institutional audience wants proof that aerospace demand is translating into durable cash generation rather than just backlog optics.",
    quantFocus: "Our factor stack sees GE as a quality-momentum compounder with unusually resilient revisions breadth into the print.",
    financialModel: {
      fiscalQuarter: "Q1 2026",
      revenueGrowth: "mid-single digits",
      operatingMargin: "low-20s",
      freeCashFlowMargin: "low-teens",
      valuationMethod: "Forward EPS plus installed-base cash flow framing",
      baseCase: "Healthy service mix supports multiple stability and steady estimate lifts.",
      bullCase: "Engine utilization and pricing strength drive another round of upside revisions.",
      bearCase: "OEM bottlenecks or cautious cash commentary compress the premium.",
    },
    catalysts: [
      "Commercial-services backlog conversion",
      "Defense engine cadence and pricing",
      "Free-cash-flow guide progression",
    ],
    risks: [
      "Airframer production volatility",
      "Supply-chain friction in key engine parts",
      "Expectations already price in strong execution",
    ],
    humanSignals: [
      "Industrial market participants still treat GE as a clean-cycle winner.",
      "Skeptics mainly want more evidence on cash conversion durability.",
      "The stock is crowded enough that a merely in-line guide could disappoint.",
    ],
  },
  {
    symbol: "UNH",
    companyName: "UnitedHealth Group",
    websiteUrl: "https://www.unitedhealthgroup.com",
    sector: "Health Care",
    industry: "Managed Care",
    marketCapUsd: 285_100_000_000,
    marketCapLabel: "$285.1B",
    earningsDate: "2026-04-21",
    earningsTiming: "Before open",
    fiscalQuarter: "Q1 2026",
    epsEstimateLabel: "$6.48",
    summary: "UnitedHealth Group is the largest managed-care platform in the U.S., spanning insurance, care delivery, pharmacy services, and health-data infrastructure.",
    rating: "Balanced",
    conviction: 68,
    priceTarget12m: 620,
    debateHeadline: "Medical-cost trend versus care-platform leverage",
    researchThesis: "The desk respects UnitedHealth's scale and vertical integration, but wants cleaner visibility on medical-cost pressure before upgrading conviction.",
    debateBull: "If medical-loss commentary stabilizes and Optum execution offsets utilization pressure, the market can rebuild confidence fast.",
    debateBear: "Any sign that elevated utilization is lasting longer than expected could keep multiple expansion capped.",
    debateTrigger: "medical-cost ratio and Optum margin resilience",
    humanAngle: "People see the franchise as best-in-class, but the debate is whether 2026 is a reset year or the start of a stickier cost regime.",
    quantFocus: "Cross-sectional health-care signals flag improving relative value, but estimate revisions still need to inflect before the models get aggressive.",
    financialModel: {
      fiscalQuarter: "Q1 2026",
      revenueGrowth: "high-single digits",
      operatingMargin: "upper-single digits",
      freeCashFlowMargin: "mid-single digits",
      valuationMethod: "Forward EPS and regulated MLR sensitivity",
      baseCase: "Core earnings stay intact, but the multiple waits for cleaner utilization data.",
      bullCase: "Optum execution plus a calming cost trend rebuild the quality premium.",
      bearCase: "Utilization stays elevated and sentiment remains defensive.",
    },
    catalysts: [
      "Medical-loss ratio versus expectations",
      "Optum Health and Optum Rx margin delivery",
      "Full-year utilization commentary",
    ],
    risks: [
      "Persistent medical-cost inflation",
      "Policy and reimbursement shifts",
      "Market participants demanding a faster utilization reset",
    ],
    humanSignals: [
      "Institutional holders want a confirmatory quarter before adding risk.",
      "The market still trusts management more than peers.",
      "Utilization commentary is the single biggest sentiment lever.",
    ],
  },
  {
    symbol: "RTX",
    companyName: "RTX",
    websiteUrl: "https://www.rtx.com",
    sector: "Industrials",
    industry: "Aerospace & Defense",
    marketCapUsd: 267_000_000_000,
    marketCapLabel: "$267.0B",
    earningsDate: "2026-04-21",
    earningsTiming: "Before open",
    fiscalQuarter: "Q1 2026",
    epsEstimateLabel: "$1.52",
    summary: "RTX combines Pratt & Whitney, Collins Aerospace, and Raytheon to serve commercial aviation, defense systems, and mission-critical aerospace electronics.",
    rating: "Constructive",
    conviction: 77,
    priceTarget12m: 155,
    debateHeadline: "Defense demand strength versus engine recovery pace",
    researchThesis: "Agents see a balanced setup where defense backlog and commercial aftermarket exposure can outrun the remaining engine-recovery skepticism.",
    debateBull: "A cleaner Pratt update plus steady defense execution would make the earnings print feel like de-risking rather than just stabilization.",
    debateBear: "If the engine narrative slips again, the stock may struggle to hold a premium despite resilient defense demand.",
    debateTrigger: "Pratt remediation cadence and defense margin commentary",
    humanAngle: "The street likes the defense exposure, but there is little patience left for incremental surprises on the engine side.",
    quantFocus: "Our event model likes RTX when revision breadth improves into a de-risking print and drawdown skew is already priced in.",
    financialModel: {
      fiscalQuarter: "Q1 2026",
      revenueGrowth: "mid-single digits",
      operatingMargin: "mid-teens",
      freeCashFlowMargin: "high-single digits",
      valuationMethod: "Sum-of-the-parts aerospace and defense framework",
      baseCase: "Defense and aftermarket support a measured rerating.",
      bullCase: "Engine remediation risk fades faster than expected.",
      bearCase: "Program noise overwhelms otherwise solid backlog conversion.",
    },
    catalysts: [
      "Pratt & Whitney fleet-management update",
      "Defense backlog conversion",
      "Cash deployment and free-cash-flow cadence",
    ],
    risks: [
      "Engine remediation slippage",
      "Program-specific defense margin noise",
      "Premium industrial valuation if execution wobbles",
    ],
    humanSignals: [
      "The institutional audience is open to a rerating if the remediation story keeps improving.",
      "Defense market participants remain comfortable with the backlog depth.",
      "Most pushback centers on whether the clean-up is truly nearing the endgame.",
    ],
  },
  {
    symbol: "DHR",
    companyName: "Danaher",
    websiteUrl: "https://www.danaher.com",
    sector: "Health Care",
    industry: "Life Sciences Tools",
    marketCapUsd: 140_200_000_000,
    marketCapLabel: "$140.2B",
    earningsDate: "2026-04-21",
    earningsTiming: "Before open",
    fiscalQuarter: "Q1 2026",
    epsEstimateLabel: "$1.94",
    summary: "Danaher is a diversified life-sciences and diagnostics platform known for recurring bioprocessing exposure, disciplined M&A, and operational rigor.",
    rating: "Constructive",
    conviction: 74,
    priceTarget12m: 295,
    debateHeadline: "Bioprocess recovery versus diagnostics normalisation",
    researchThesis: "The thesis is that bioprocess demand is healing while the Danaher operating system still gives the company a structural earnings-quality premium.",
    debateBull: "A steadier bioprocess recovery and stronger book-to-bill would likely matter more than any residual diagnostics softness.",
    debateBear: "If customers keep ordering cautiously, the stock may wait longer for the recovery narrative to fully re-rate.",
    debateTrigger: "bioprocess order trends and core margin cadence",
    humanAngle: "People still want Danaher exposure for quality, but they are waiting for cleaner signs that the recovery has moved from hope to evidence.",
    quantFocus: "Our quality-growth basket still favors Danaher, but the alpha comes from timing the inflection in order momentum rather than paying any price for defensiveness.",
    financialModel: {
      fiscalQuarter: "Q1 2026",
      revenueGrowth: "low-single digits",
      operatingMargin: "high-20s",
      freeCashFlowMargin: "low-20s",
      valuationMethod: "Forward EPS and free-cash-flow comp set",
      baseCase: "Recovery is gradual, but quality stays scarce and rewarded.",
      bullCase: "Order momentum snaps back and the multiple expands with it.",
      bearCase: "Recovery remains too slow to justify the premium.",
    },
    catalysts: [
      "Bioprocessing order momentum",
      "Diagnostics stabilization",
      "Margin recovery and capital deployment",
    ],
    risks: [
      "Delayed customer restocking",
      "End-market softness in diagnostics",
      "High-quality premium vulnerable if growth lags",
    ],
    humanSignals: [
      "Analysts still pitch Danaher as a top-tier compounder.",
      "Generalists want firmer evidence of order acceleration.",
      "Expectations are not euphoric, which helps the setup.",
    ],
  },
  {
    symbol: "GEV",
    companyName: "GE Vernova",
    websiteUrl: "https://www.gevernova.com",
    sector: "Industrials",
    industry: "Power & Electrification",
    marketCapUsd: 265_100_000_000,
    marketCapLabel: "$265.1B",
    earningsDate: "2026-04-22",
    earningsTiming: "Before open",
    fiscalQuarter: "Q1 2026",
    epsEstimateLabel: "$1.79",
    summary: "GE Vernova supplies gas turbines, grid hardware, and electrification systems tied to utility capex, grid hardening, and AI-driven power demand.",
    rating: "Constructive",
    conviction: 80,
    priceTarget12m: 420,
    debateHeadline: "Grid capex supercycle versus execution bottlenecks",
    researchThesis: "Agents like Vernova as a direct way to express rising power demand and grid spend, especially as data-center build-outs tighten utility timelines.",
    debateBull: "If grid orders and service commentary stay hot, the market could keep paying up for the scarce power-equipment exposure.",
    debateBear: "Execution risk remains real because the opportunity set is so large that market participants now expect almost flawless delivery.",
    debateTrigger: "grid order intake and gas-power margin delivery",
    humanAngle: "People are increasingly framing GEV as an AI infrastructure pick disguised as an industrial, which raises both demand and expectations.",
    quantFocus: "The models love the revision trend and thematic momentum, but they also flag elevated crowding around AI-power narratives.",
    financialModel: {
      fiscalQuarter: "Q1 2026",
      revenueGrowth: "high-single digits",
      operatingMargin: "low-teens",
      freeCashFlowMargin: "high-single digits",
      valuationMethod: "Power-equipment multiple plus service cash flow",
      baseCase: "Demand remains strong enough to support premium industrial multiples.",
      bullCase: "Utilities and hyperscalers accelerate grid-spend commitments.",
      bearCase: "Execution misses interrupt the thematic rerating.",
    },
    catalysts: [
      "Grid order intake",
      "Gas-power service margins",
      "AI infrastructure-linked power demand commentary",
    ],
    risks: [
      "Project execution slippage",
      "Supply-chain constraints on large power hardware",
      "Narrative crowding after a strong rerating",
    ],
    humanSignals: [
      "The street increasingly treats GEV as a first-call AI power exposure.",
      "There is limited patience for project delays.",
      "Institutional holders want grid momentum to prove sticky, not just episodic.",
    ],
  },
  {
    symbol: "PM",
    companyName: "Philip Morris International",
    websiteUrl: "https://www.pmi.com",
    sector: "Consumer Staples",
    industry: "Tobacco & Reduced-Risk Products",
    marketCapUsd: 244_700_000_000,
    marketCapLabel: "$244.7B",
    earningsDate: "2026-04-22",
    earningsTiming: "Before open",
    fiscalQuarter: "Q1 2026",
    epsEstimateLabel: "$1.82",
    summary: "Philip Morris International sells combustible tobacco and reduced-risk nicotine products globally, with growing exposure to smoke-free devices and consumables.",
    rating: "Constructive",
    conviction: 72,
    priceTarget12m: 165,
    debateHeadline: "Smoke-free mix shift versus currency and regulation",
    researchThesis: "The debate tilts constructive because smoke-free adoption keeps supporting mix and pricing even when the macro tape is uneven.",
    debateBull: "Continued smoke-free traction can keep earnings quality high enough for the defensive premium to hold.",
    debateBear: "FX volatility or any regulatory overhang could mute what would otherwise be a straightforward quality quarter.",
    debateTrigger: "smoke-free volume mix and pricing commentary",
    humanAngle: "People continue to prefer PM over traditional tobacco peers because the innovation and category-mix story still feels alive.",
    quantFocus: "Low-volatility and earnings-stability factors stay supportive, especially when the market is searching for defensible cash generators.",
    financialModel: {
      fiscalQuarter: "Q1 2026",
      revenueGrowth: "mid-single digits",
      operatingMargin: "mid-40s",
      freeCashFlowMargin: "high-20s",
      valuationMethod: "Dividend-supported forward EPS framework",
      baseCase: "Smoke-free adoption keeps the defensive growth story intact.",
      bullCase: "Mix shift accelerates and market participants pay for visible resilience.",
      bearCase: "FX or regulation clips the clean narrative.",
    },
    catalysts: [
      "Smoke-free user growth",
      "Pricing realization",
      "Margin mix from reduced-risk products",
    ],
    risks: [
      "Currency volatility",
      "Regulatory headline risk",
      "Defensive multiple sensitivity if rates rise",
    ],
    humanSignals: [
      "PM remains a favored defensive compounder.",
      "The market is focused on smoke-free trajectory more than legacy combustion.",
      "Yield support keeps pullbacks relatively contained.",
    ],
  },
  {
    symbol: "T",
    companyName: "AT&T",
    websiteUrl: "https://www.att.com",
    sector: "Communication Services",
    industry: "Telecom Services",
    marketCapUsd: 177_800_000_000,
    marketCapLabel: "$177.8B",
    earningsDate: "2026-04-22",
    earningsTiming: "Before open",
    fiscalQuarter: "Q1 2026",
    epsEstimateLabel: "$0.55",
    summary: "AT&T is a U.S. telecom incumbent focused on wireless subscribers, fiber expansion, and steady cash generation from connectivity infrastructure.",
    rating: "Balanced",
    conviction: 61,
    priceTarget12m: 31,
    debateHeadline: "Fiber monetisation versus wireless churn discipline",
    researchThesis: "The house view is balanced: the cash-flow story is improving, but the earnings catalyst still depends on proving that fiber spending is translating into durable subscriber economics.",
    debateBull: "Cleaner wireless execution plus continued fiber take-up could support a steady rerating for an income-heavy shareholder base.",
    debateBear: "If churn or promotional intensity worsens, the stock can slip back into utility-like stagnation quickly.",
    debateTrigger: "wireless postpaid trends and fiber subscriber growth",
    humanAngle: "People are open to the turnaround, but most still want to see execution stack up for several quarters before paying a fuller multiple.",
    quantFocus: "Signal quality is improving, but the models still classify AT&T as a low-beta cash-flow screen rather than a true growth re-acceleration story.",
    financialModel: {
      fiscalQuarter: "Q1 2026",
      revenueGrowth: "low-single digits",
      operatingMargin: "high-teens",
      freeCashFlowMargin: "mid-teens",
      valuationMethod: "Dividend yield and EV/EBITDA support",
      baseCase: "Cash generation improves gradually while the multiple stays disciplined.",
      bullCase: "Fiber and wireless execution reduce turnaround skepticism.",
      bearCase: "Competitive intensity keeps the story utility-like.",
    },
    catalysts: [
      "Postpaid phone net adds",
      "Fiber subscriber growth",
      "Free-cash-flow conversion",
    ],
    risks: [
      "Promotional churn pressure",
      "Heavy capital-intensity narrative",
      "Income market participants vulnerable to rate moves",
    ],
    humanSignals: [
      "The market wants consistency more than upside surprise.",
      "Income-oriented holders anchor the shareholder base.",
      "Telecom skepticism has not fully cleared, even after progress.",
    ],
  },
  {
    symbol: "BA",
    companyName: "Boeing",
    websiteUrl: "https://www.boeing.com",
    sector: "Industrials",
    industry: "Aerospace & Defense",
    marketCapUsd: 176_000_000_000,
    marketCapLabel: "$176.0B",
    earningsDate: "2026-04-22",
    earningsTiming: "Before open",
    fiscalQuarter: "Q1 2026",
    epsEstimateLabel: "—",
    summary: "Boeing designs and manufactures commercial aircraft, defense systems, and aerospace services, with market focus still centered on production stability and certification progress.",
    rating: "Balanced",
    conviction: 58,
    priceTarget12m: 250,
    debateHeadline: "Production healing versus execution credibility",
    researchThesis: "The opportunity is obvious if Boeing normalizes delivery cadence, but agents are keeping conviction measured until execution credibility fully repairs.",
    debateBull: "Any evidence that production discipline and certification cadence are genuinely improving can drive a sharp sentiment reset.",
    debateBear: "The market has little tolerance for another operational stumble, even if demand remains structurally strong.",
    debateTrigger: "delivery cadence, cash burn, and certification commentary",
    humanAngle: "People are attracted to the torque in a successful recovery, but they continue to treat the name as execution-beta first and fundamental compounder second.",
    quantFocus: "The event model flags extreme outcome skew: Boeing tends to move hard when operational uncertainty collapses, but false starts remain expensive.",
    financialModel: {
      fiscalQuarter: "Q1 2026",
      revenueGrowth: "recovery-driven",
      operatingMargin: "still rebuilding",
      freeCashFlowMargin: "negative to breakeven",
      valuationMethod: "Recovery cash-flow normalization",
      baseCase: "Execution improves, but the rerating stays staged.",
      bullCase: "Delivery and cash trends inflect faster than the market expects.",
      bearCase: "Operational noise resets trust again.",
    },
    catalysts: [
      "Commercial aircraft deliveries",
      "Certification milestones",
      "Cash-burn trajectory",
    ],
    risks: [
      "Further production or quality setbacks",
      "Certification delays",
      "High expectations for operational repair",
    ],
    humanSignals: [
      "The stock still behaves as a trust-rebuild story.",
      "Recovery bulls focus on the installed backlog and cash optionality.",
      "Skeptics want operational proof, not promises.",
    ],
  },
  {
    symbol: "CME",
    companyName: "CME Group",
    websiteUrl: "https://www.cmegroup.com",
    sector: "Financials",
    industry: "Market Infrastructure",
    marketCapUsd: 107_700_000_000,
    marketCapLabel: "$107.7B",
    earningsDate: "2026-04-22",
    earningsTiming: "Before open",
    fiscalQuarter: "Q1 2026",
    epsEstimateLabel: "$3.20",
    summary: "CME Group operates futures and derivatives exchanges spanning rates, equity indexes, commodities, and foreign exchange.",
    rating: "Constructive",
    conviction: 70,
    priceTarget12m: 265,
    debateHeadline: "Rates-vol tailwinds versus normalising volumes",
    researchThesis: "CME remains a quality market-structure asset with strong operating leverage when macro volatility sustains elevated market activity.",
    debateBull: "If rates and macro hedging stay active, CME can keep compounding higher-quality earnings with minimal balance-sheet drama.",
    debateBear: "The challenge is that market participants already understand the model well, so upside depends on proving volumes stay elevated for longer.",
    debateTrigger: "rates and macro-product volume durability",
    humanAngle: "People like CME as a cleaner way to own volatility demand, especially when macro uncertainty remains elevated.",
    quantFocus: "The exchange-operator basket scores well on revisions stability and downside protection, making CME a useful defensive beta substitute.",
    financialModel: {
      fiscalQuarter: "Q1 2026",
      revenueGrowth: "mid-single digits",
      operatingMargin: "mid-60s",
      freeCashFlowMargin: "high-40s",
      valuationMethod: "Cash-flow yield and exchange comp premium",
      baseCase: "Volatility support keeps the model on a steady premium path.",
      bullCase: "Macro hedging demand remains higher for longer.",
      bearCase: "Volumes normalize faster than valuation assumes.",
    },
    catalysts: [
      "Rates market volumes",
      "Energy and commodity hedging demand",
      "Capital return cadence",
    ],
    risks: [
      "Volatility normalization",
      "Less favorable product mix",
      "Premium multiple compression in calmer markets",
    ],
    humanSignals: [
      "CME is often treated as a quality macro hedge.",
      "The market is comfortable paying for cash-flow resilience.",
      "The key debate is persistence of elevated rates volumes.",
    ],
  },
  {
    symbol: "TSLA",
    companyName: "Tesla",
    websiteUrl: "https://www.tesla.com",
    sector: "Consumer Discretionary",
    industry: "Automobiles & Energy",
    marketCapUsd: 1_470_000_000_000,
    marketCapLabel: "$1.47T",
    earningsDate: "2026-04-22",
    earningsTiming: "After close",
    fiscalQuarter: "Q1 2026",
    epsEstimateLabel: "$0.21",
    summary: "Tesla builds electric vehicles, energy-storage systems, charging infrastructure, and software products tied to autonomy and fleet monetisation.",
    rating: "Balanced",
    conviction: 57,
    priceTarget12m: 525,
    debateHeadline: "Autonomy optionality versus auto margin reality",
    researchThesis: "The desk sees Tesla as a battle between long-duration software optionality and near-term auto economics that remain under pressure.",
    debateBull: "If management can redirect the narrative toward autonomy milestones or energy growth, the stock can shrug off a merely okay auto quarter.",
    debateBear: "If pricing pressure and volume softness dominate the call, the market may punish the gap between story and current earnings power.",
    debateTrigger: "auto gross margin, autonomy roadmap, and energy-storage growth",
    humanAngle: "People remain split between viewing Tesla as a software platform in waiting or a cyclical automaker with a premium multiple.",
    quantFocus: "The models flag Tesla as one of the highest narrative-dispersion names in the market, meaning sentiment and positioning matter almost as much as the print itself.",
    financialModel: {
      fiscalQuarter: "Q1 2026",
      revenueGrowth: "mid-single digits",
      operatingMargin: "high-single digits",
      freeCashFlowMargin: "mid-single digits",
      valuationMethod: "Blended EV, software optionality, and energy contribution",
      baseCase: "Auto margins stabilize while optionality supports valuation.",
      bullCase: "Autonomy and energy become the dominant valuation anchors.",
      bearCase: "Core auto economics stay too weak for the premium.",
    },
    catalysts: [
      "Auto gross-margin trajectory",
      "Robotaxi or autonomy milestones",
      "Energy-storage deployment acceleration",
    ],
    risks: [
      "Vehicle pricing pressure",
      "Execution slippage on autonomy promises",
      "High narrative-driven volatility",
    ],
    humanSignals: [
      "Tesla remains one of the most polarized mega-cap debates.",
      "The call often matters more than the quarter because narrative steering is so important.",
      "Positioning can exaggerate both upside and downside moves.",
    ],
  },
  {
    symbol: "LRCX",
    companyName: "Lam Research",
    websiteUrl: "https://www.lamresearch.com",
    sector: "Information Technology",
    industry: "Semiconductor Equipment",
    marketCapUsd: 331_100_000_000,
    marketCapLabel: "$331.1B",
    earningsDate: "2026-04-22",
    earningsTiming: "After close",
    fiscalQuarter: "Q1 2026",
    epsEstimateLabel: "$1.36",
    summary: "Lam Research sells wafer-fabrication equipment used in memory and logic semiconductor manufacturing, with high sensitivity to cycle recoveries and process intensity.",
    rating: "Constructive",
    conviction: 79,
    priceTarget12m: 125,
    debateHeadline: "Memory upcycle depth versus China and spending mix",
    researchThesis: "Lam is one of the cleaner ways to express improving wafer-fab equipment demand, especially if memory spending stays firm.",
    debateBull: "If memory demand and process intensity remain strong, Lam can keep posting operating leverage that justifies the premium equipment multiple.",
    debateBear: "Any sign that spending is peaking or becoming too China-concentrated could cool the setup fast.",
    debateTrigger: "memory capex durability and foundry/logic mix",
    humanAngle: "People are constructive on the equipment cycle, but they want confirmation that the current upturn is broadening instead of narrowing.",
    quantFocus: "Semicap revisions and relative-strength models still score Lam highly, with the main watchpoint being crowding after a strong run.",
    financialModel: {
      fiscalQuarter: "Q1 2026",
      revenueGrowth: "double digits",
      operatingMargin: "low-30s",
      freeCashFlowMargin: "mid-20s",
      valuationMethod: "Cycle-adjusted EPS and free-cash-flow leverage",
      baseCase: "A broadening equipment cycle keeps estimate revisions positive.",
      bullCase: "Memory strength persists and mix improves further.",
      bearCase: "Semicap demand narrows faster than valuation assumes.",
    },
    catalysts: [
      "Memory customer capex",
      "Foundry/logic mix improvement",
      "China exposure commentary",
    ],
    risks: [
      "Cyclical capex slowdown",
      "Policy and export-control pressure",
      "Crowded positioning in semicap leaders",
    ],
    humanSignals: [
      "Lam is a favored semicap exposure for cycle bulls.",
      "Market participants are watching whether the memory recovery broadens to logic.",
      "The main pushback is on how much good news is already in the multiple.",
    ],
  },
  {
    symbol: "IBM",
    companyName: "IBM",
    websiteUrl: "https://www.ibm.com",
    sector: "Information Technology",
    industry: "Enterprise Software & Infrastructure",
    marketCapUsd: 229_600_000_000,
    marketCapLabel: "$229.6B",
    earningsDate: "2026-04-22",
    earningsTiming: "After close",
    fiscalQuarter: "Q1 2026",
    epsEstimateLabel: "$1.82",
    summary: "IBM sells hybrid-cloud software, consulting, infrastructure, and AI tools to large enterprises with deep installed-base relationships.",
    rating: "Constructive",
    conviction: 69,
    priceTarget12m: 310,
    debateHeadline: "AI monetisation credibility versus slower legacy mix",
    researchThesis: "The stock works when software and automation demand outrun concerns about slower legacy infrastructure and consulting cadence.",
    debateBull: "If AI bookings and software mix keep improving, IBM can retain its late-cycle quality rerating.",
    debateBear: "If consulting stays soft or AI monetisation feels too promotional, the market may fade the premium.",
    debateTrigger: "software growth, AI bookings, and consulting stabilisation",
    humanAngle: "People want IBM to prove that AI is broadening wallet share instead of just improving the story deck.",
    quantFocus: "Quality-value and earnings-revision factors remain supportive, though upside depends on software mix improvement staying real.",
    financialModel: {
      fiscalQuarter: "Q1 2026",
      revenueGrowth: "low-single digits",
      operatingMargin: "high-teens",
      freeCashFlowMargin: "mid-teens",
      valuationMethod: "Free-cash-flow yield plus software mix premium",
      baseCase: "Software mix keeps expanding and supports a steadier quality multiple.",
      bullCase: "AI monetisation drives faster software growth and sentiment upside.",
      bearCase: "Legacy drag overwhelms the modernisation story.",
    },
    catalysts: [
      "Software segment growth",
      "AI-related bookings and wins",
      "Consulting stabilisation",
    ],
    risks: [
      "Slow legacy infrastructure demand",
      "Consulting pressure",
      "AI enthusiasm outpacing monetisation evidence",
    ],
    humanSignals: [
      "The market has become more willing to pay for IBM as a quality value name.",
      "AI commentary matters because market participants want proof the repositioning is working.",
      "Expectations are better than a year ago but not euphoric.",
    ],
  },
  {
    symbol: "TXN",
    companyName: "Texas Instruments",
    websiteUrl: "https://www.ti.com",
    sector: "Information Technology",
    industry: "Analog Semiconductors",
    marketCapUsd: 196_900_000_000,
    marketCapLabel: "$196.9B",
    earningsDate: "2026-04-22",
    earningsTiming: "After close",
    fiscalQuarter: "Q1 2026",
    epsEstimateLabel: "$1.37",
    summary: "Texas Instruments designs analog and embedded chips used across industrial, automotive, and communications end markets.",
    rating: "Balanced",
    conviction: 65,
    priceTarget12m: 235,
    debateHeadline: "Analog bottoming versus industrial demand lag",
    researchThesis: "Agents see the setup as balanced because inventory correction progress is real, but broad industrial demand still needs to turn cleaner.",
    debateBull: "If customer inventories are normalizing faster than feared, TXN can look early-cycle attractive again.",
    debateBear: "Industrial softness could keep the recovery shallow and leave the stock range-bound.",
    debateTrigger: "inventory digestion and industrial demand commentary",
    humanAngle: "People trust the franchise and capital discipline, but they are not yet convinced the analog cycle has truly re-accelerated.",
    quantFocus: "Cycle-recovery models are improving, though the highest-conviction signal still depends on a broader revisions turn across industrial semis.",
    financialModel: {
      fiscalQuarter: "Q1 2026",
      revenueGrowth: "flattish to low-single digits",
      operatingMargin: "mid-30s",
      freeCashFlowMargin: "high-20s",
      valuationMethod: "Cycle-aware forward EPS with capital-return support",
      baseCase: "The cycle bottoms gradually and valuation stays disciplined.",
      bullCase: "Industrial demand inflects faster and the stock rerates early.",
      bearCase: "Recovery drags and the multiple remains capped.",
    },
    catalysts: [
      "Inventory digestion update",
      "Industrial and auto end-market trends",
      "Capital-return consistency",
    ],
    risks: [
      "Slow analog-cycle recovery",
      "Industrial demand staying muted",
      "Premium quality multiple without a clear growth inflection",
    ],
    humanSignals: [
      "The street still respects TXN as the analog benchmark.",
      "Recovery timing remains the main argument.",
      "Income and quality market participants keep a natural bid under the name.",
    ],
  },
  {
    symbol: "AXP",
    companyName: "American Express",
    websiteUrl: "https://www.americanexpress.com",
    sector: "Financials",
    industry: "Payments & Consumer Finance",
    marketCapUsd: 225_700_000_000,
    marketCapLabel: "$225.7B",
    earningsDate: "2026-04-23",
    earningsTiming: "Before open",
    fiscalQuarter: "Q1 2026",
    epsEstimateLabel: "$4.01",
    summary: "American Express operates a premium card network with strong exposure to affluent consumer spending, travel, small business, and merchant economics.",
    rating: "Constructive",
    conviction: 73,
    priceTarget12m: 335,
    debateHeadline: "Affluent spend resilience versus credit normalization",
    researchThesis: "The desk likes AmEx when affluent spend stays healthy because fee growth and brand loyalty usually outweigh normalization in credit costs.",
    debateBull: "Travel and premium spend resilience can keep the earnings machine looking stronger than broader consumer-finance peers.",
    debateBear: "If credit or small-business softness starts showing up more visibly, the premium consumer narrative weakens.",
    debateTrigger: "billings growth and credit normalisation pace",
    humanAngle: "People see AmEx as a higher-quality financial, but they still watch carefully for any cracks in affluent demand.",
    quantFocus: "Our consumer-finance screen favors AmEx on quality and momentum, especially when macro stress is concentrated below the affluent cohort.",
    financialModel: {
      fiscalQuarter: "Q1 2026",
      revenueGrowth: "high-single digits",
      operatingMargin: "low-20s",
      freeCashFlowMargin: "mid-teens",
      valuationMethod: "Forward EPS and premium-payments comp framework",
      baseCase: "Affluent spend stays healthy and supports a quality-financial premium.",
      bullCase: "Travel and fee mix surprise to the upside again.",
      bearCase: "Credit costs rise faster than market participants expect.",
    },
    catalysts: [
      "Card-member spending growth",
      "Travel and entertainment mix",
      "Credit reserve and delinquency trends",
    ],
    risks: [
      "Affluent consumer slowdown",
      "Credit-cost normalization",
      "Higher expectations after consistent execution",
    ],
    humanSignals: [
      "AmEx is a favorite way to play resilient upper-income demand.",
      "The market is sensitive to even small changes in credit commentary.",
      "Travel spend remains a key sentiment tell.",
    ],
  },
  {
    symbol: "TMO",
    companyName: "Thermo Fisher Scientific",
    websiteUrl: "https://www.thermofisher.com",
    sector: "Health Care",
    industry: "Life Sciences Tools",
    marketCapUsd: 197_500_000_000,
    marketCapLabel: "$197.5B",
    earningsDate: "2026-04-23",
    earningsTiming: "Before open",
    fiscalQuarter: "Q1 2026",
    epsEstimateLabel: "$5.21",
    summary: "Thermo Fisher Scientific supplies instruments, services, diagnostics, and consumables used across pharma, biotech, and academic research labs worldwide.",
    rating: "Constructive",
    conviction: 71,
    priceTarget12m: 690,
    debateHeadline: "Research-spend recovery versus cautious customer budgets",
    researchThesis: "Thermo is a high-quality life-sciences franchise that should benefit as research budgets normalize, but the setup still depends on customers spending with more urgency.",
    debateBull: "Improving order cadence across biopharma and diagnostics would reinforce the quality-compounder narrative quickly.",
    debateBear: "If customers stay cautious, the quarter can feel fine operationally but still too slow for a full rerating.",
    debateTrigger: "instrument demand and biopharma customer spend",
    humanAngle: "People continue to trust Thermo's playbook; the question is simply when end-market demand accelerates enough to matter for the multiple.",
    quantFocus: "Quality and downside-capture signals remain strong, but the upside torque hinges on demand inflection rather than just consistency.",
    financialModel: {
      fiscalQuarter: "Q1 2026",
      revenueGrowth: "low- to mid-single digits",
      operatingMargin: "mid-20s",
      freeCashFlowMargin: "mid-teens",
      valuationMethod: "Forward EPS and free-cash-flow premium",
      baseCase: "Demand normalizes gradually while quality stays scarce.",
      bullCase: "Biopharma spend accelerates and supports a faster rerating.",
      bearCase: "Customer caution persists longer than hoped.",
    },
    catalysts: [
      "Instrument and consumables demand",
      "Biopharma customer spending",
      "Diagnostics stabilization",
    ],
    risks: [
      "Slow recovery in customer budgets",
      "Lab spending deferrals",
      "Premium multiple sensitivity to growth disappointments",
    ],
    humanSignals: [
      "Thermo is still a preferred quality health-care compounder.",
      "Market participants want better demand momentum, not just stability.",
      "The market is patient, but not indefinitely.",
    ],
  },
  {
    symbol: "NEE",
    companyName: "NextEra Energy",
    websiteUrl: "https://www.nexteraenergy.com",
    sector: "Utilities",
    industry: "Electric Utilities & Renewables",
    marketCapUsd: 190_300_000_000,
    marketCapLabel: "$190.3B",
    earningsDate: "2026-04-23",
    earningsTiming: "Before open",
    fiscalQuarter: "Q1 2026",
    epsEstimateLabel: "$0.91",
    summary: "NextEra Energy combines a regulated Florida utility with one of the largest renewable and power-development franchises in North America.",
    rating: "Constructive",
    conviction: 67,
    priceTarget12m: 92,
    debateHeadline: "Power-demand tailwinds versus capital-cost pressure",
    researchThesis: "The company remains one of the best utility-linked ways to express rising power demand, provided financing conditions stay manageable.",
    debateBull: "Utility and renewable demand tied to electrification and data centers keeps the growth utility premium intact.",
    debateBear: "Rates and capital-intensity concerns can still dominate if management sounds even slightly more cautious on financing.",
    debateTrigger: "development backlog, utility growth, and funding cadence",
    humanAngle: "People appreciate the strategic positioning but remain sensitive to rate moves because capital-heavy utilities can rerate quickly in either direction.",
    quantFocus: "NEE scores well on long-duration defensive growth, though factor sensitivity to rates remains the core model watchpoint.",
    financialModel: {
      fiscalQuarter: "Q1 2026",
      revenueGrowth: "mid-single digits",
      operatingMargin: "regulated utility profile",
      freeCashFlowMargin: "capital-intensive",
      valuationMethod: "Regulated utility multiple plus development option value",
      baseCase: "The market keeps rewarding utility growth tied to power demand.",
      bullCase: "Data-center and electrification demand accelerate backlog confidence.",
      bearCase: "Financing concerns pressure the premium multiple.",
    },
    catalysts: [
      "Utility load growth",
      "Renewables and storage backlog",
      "Funding and financing commentary",
    ],
    risks: [
      "Interest-rate pressure",
      "Project funding needs",
      "Regulatory or permitting delays",
    ],
    humanSignals: [
      "NextEra still screens as the highest-quality utility growth story.",
      "Rates remain the biggest macro swing factor.",
      "Market participants increasingly care about data-center-linked load growth.",
    ],
  },
  {
    symbol: "UNP",
    companyName: "Union Pacific",
    websiteUrl: "https://www.up.com",
    sector: "Industrials",
    industry: "Railroads",
    marketCapUsd: 147_300_000_000,
    marketCapLabel: "$147.3B",
    earningsDate: "2026-04-23",
    earningsTiming: "Before open",
    fiscalQuarter: "Q1 2026",
    epsEstimateLabel: "$2.85",
    summary: "Union Pacific is one of the largest freight railroads in North America, transporting industrial, agricultural, energy, and intermodal volumes across a high-barrier network.",
    rating: "Constructive",
    conviction: 66,
    priceTarget12m: 285,
    debateHeadline: "Operating leverage versus uneven freight demand",
    researchThesis: "The constructive thesis rests on self-help, pricing discipline, and eventual freight normalization driving a better incremental margin profile.",
    debateBull: "Service consistency plus pricing discipline can let Union Pacific outperform even before freight demand fully rebounds.",
    debateBear: "If volumes stay soft across key industrial channels, the market may keep treating the story as operationally solid but fundamentally stuck.",
    debateTrigger: "intermodal and industrial volume trends",
    humanAngle: "People tend to trust rail management teams on cost discipline, but they still want better evidence of freight re-acceleration.",
    quantFocus: "The models like the defensive-industrial profile, but the upside needs a broader volume turn to move from steady compounder to alpha source.",
    financialModel: {
      fiscalQuarter: "Q1 2026",
      revenueGrowth: "low-single digits",
      operatingMargin: "low-40s",
      freeCashFlowMargin: "high-teens",
      valuationMethod: "Rail comp multiple with pricing and margin support",
      baseCase: "Margins hold well while the freight cycle heals gradually.",
      bullCase: "Volumes inflect and self-help drives upside leverage.",
      bearCase: "Muted freight demand caps the rerating.",
    },
    catalysts: [
      "Intermodal demand",
      "Industrial carload recovery",
      "Service metrics and pricing",
    ],
    risks: [
      "Soft freight backdrop",
      "Network service disruptions",
      "Limited upside if demand stays muted",
    ],
    humanSignals: [
      "Rail market participants value the self-help consistency.",
      "The biggest question is when freight turns cleaner.",
      "Union Pacific still commands quality respect inside cyclicals.",
    ],
  },
  {
    symbol: "HON",
    companyName: "Honeywell",
    websiteUrl: "https://www.honeywell.com",
    sector: "Industrials",
    industry: "Industrial Automation & Aerospace",
    marketCapUsd: 147_100_000_000,
    marketCapLabel: "$147.1B",
    earningsDate: "2026-04-23",
    earningsTiming: "Before open",
    fiscalQuarter: "Q1 2026",
    epsEstimateLabel: "$2.31",
    summary: "Honeywell sells aerospace systems, process automation, building technologies, and productivity software into mission-critical industrial environments.",
    rating: "Constructive",
    conviction: 64,
    priceTarget12m: 255,
    debateHeadline: "Aerospace strength versus industrial mix drag",
    researchThesis: "The stock still works as a quality industrial if aerospace and automation strength are enough to offset slower pockets of short-cycle demand.",
    debateBull: "Aerospace and software-linked automation can keep Honeywell's quality profile intact despite a mixed industrial backdrop.",
    debateBear: "If short-cycle industrial demand drags more than expected, the quarter may feel respectable but not catalytic.",
    debateTrigger: "aerospace margin strength and automation demand",
    humanAngle: "People view Honeywell as dependable, but they are looking for a cleaner catalyst than simply another solid quarter.",
    quantFocus: "Quality and cash-flow factors stay favorable, though the models classify Honeywell as steadier alpha rather than explosive event beta.",
    financialModel: {
      fiscalQuarter: "Q1 2026",
      revenueGrowth: "mid-single digits",
      operatingMargin: "low-20s",
      freeCashFlowMargin: "mid-teens",
      valuationMethod: "Forward EPS and quality-industrial comp set",
      baseCase: "Aerospace and automation support a durable premium.",
      bullCase: "Industrial demand stabilizes faster and broadens the setup.",
      bearCase: "Mixed short-cycle demand keeps the stock in quality-but-boring territory.",
    },
    catalysts: [
      "Aerospace aftermarket strength",
      "Automation and software demand",
      "Portfolio simplification or capital deployment",
    ],
    risks: [
      "Short-cycle industrial weakness",
      "Execution complexity across varied segments",
      "Limited rerating without a new catalyst",
    ],
    humanSignals: [
      "Honeywell remains a quality industrial core holding.",
      "Market participants want more than just another in-line quarter.",
      "Aerospace is doing most of the narrative lifting today.",
    ],
  },
  {
    symbol: "LMT",
    companyName: "Lockheed Martin",
    websiteUrl: "https://www.lockheedmartin.com",
    sector: "Industrials",
    industry: "Defense",
    marketCapUsd: 140_800_000_000,
    marketCapLabel: "$140.8B",
    earningsDate: "2026-04-23",
    earningsTiming: "Before open",
    fiscalQuarter: "Q1 2026",
    epsEstimateLabel: "$6.63",
    summary: "Lockheed Martin is a defense prime contractor focused on aeronautics, missiles, space systems, and mission systems backed by long-duration government programs.",
    rating: "Constructive",
    conviction: 75,
    priceTarget12m: 610,
    debateHeadline: "Backlog durability versus program mix friction",
    researchThesis: "Agents like Lockheed's backlog quality and geopolitical demand support, but watch program mix carefully for margin delivery.",
    debateBull: "If key programs execute cleanly, the market can keep rewarding Lockheed as a high-visibility cash compounder.",
    debateBear: "Program-specific mix issues or procurement timing can still create awkward quarters even with a strong strategic backdrop.",
    debateTrigger: "program margins and backlog conversion visibility",
    humanAngle: "People generally trust the demand backdrop for defense, so the debate is more about execution quality than end-market risk.",
    quantFocus: "Defense primes score well on cash-flow resilience and downside protection, making Lockheed attractive when macro visibility fades.",
    financialModel: {
      fiscalQuarter: "Q1 2026",
      revenueGrowth: "low-single digits",
      operatingMargin: "low-teens",
      freeCashFlowMargin: "high-single digits",
      valuationMethod: "Forward EPS and cash-return profile",
      baseCase: "Backlog visibility supports a durable quality-defense premium.",
      bullCase: "Program execution cleans up and free cash flow surprises higher.",
      bearCase: "Program mix friction limits upside despite healthy demand.",
    },
    catalysts: [
      "Missiles and aeronautics margin delivery",
      "Cash conversion",
      "Program awards and backlog updates",
    ],
    risks: [
      "Program-specific execution noise",
      "Budget timing mismatches",
      "Limited upside if the quarter is merely clean",
    ],
    humanSignals: [
      "Defense market participants remain comfortable with Lockheed's positioning.",
      "Execution, not demand, is the real swing factor.",
      "Cash-return consistency helps support sentiment.",
    ],
  },
  {
    symbol: "CMCSA",
    companyName: "Comcast",
    websiteUrl: "https://corporate.comcast.com",
    sector: "Communication Services",
    industry: "Broadband, Media & Wireless",
    marketCapUsd: 101_800_000_000,
    marketCapLabel: "$101.8B",
    earningsDate: "2026-04-23",
    earningsTiming: "Before open",
    fiscalQuarter: "Q1 2026",
    epsEstimateLabel: "$0.72",
    summary: "Comcast combines broadband infrastructure, cable networks, media assets, and a growing wireless bundle aimed at household share gains.",
    rating: "Balanced",
    conviction: 60,
    priceTarget12m: 41,
    debateHeadline: "Broadband defensibility versus competitive pressure",
    researchThesis: "The stock needs broadband and bundle economics to prove more resilient before the agents will move beyond a balanced stance.",
    debateBull: "Wireless bundling and disciplined cost control can stabilize the broadband narrative more than the market expects.",
    debateBear: "If competitive intensity keeps eroding broadband net adds, the market may keep treating Comcast as structurally ex-growth.",
    debateTrigger: "broadband net adds and wireless bundle momentum",
    humanAngle: "People are skeptical after several competitive scares, so even decent execution has to do more work to rebuild confidence.",
    quantFocus: "Value and cash-flow screens like Comcast, but revisions and momentum remain mixed because the broadband debate is unresolved.",
    financialModel: {
      fiscalQuarter: "Q1 2026",
      revenueGrowth: "low-single digits",
      operatingMargin: "high-teens",
      freeCashFlowMargin: "mid-teens",
      valuationMethod: "FCF yield and broadband stability framework",
      baseCase: "Cash generation supports the stock while growth remains modest.",
      bullCase: "Broadband churn calms and the bundle story gains traction.",
      bearCase: "Competitive pressure keeps the multiple compressed.",
    },
    catalysts: [
      "Broadband net adds",
      "Wireless bundle traction",
      "Media and parks profitability",
    ],
    risks: [
      "Broadband share loss",
      "Media cyclicality",
      "Value trap perception",
    ],
    humanSignals: [
      "Market participants want evidence the broadband franchise is re-stabilizing.",
      "The stock screens cheap enough to attract value buyers.",
      "Sentiment will stay muted unless subscriber trends improve.",
    ],
  },
  {
    symbol: "INTC",
    companyName: "Intel",
    websiteUrl: "https://www.intel.com",
    sector: "Information Technology",
    industry: "Semiconductors",
    marketCapUsd: 325_600_000_000,
    marketCapLabel: "$325.6B",
    earningsDate: "2026-04-23",
    earningsTiming: "After close",
    fiscalQuarter: "Q1 2026",
    epsEstimateLabel: "—",
    summary: "Intel designs CPUs, data-center processors, AI accelerators, and foundry services while working through one of the biggest strategic rebuilds in semiconductors.",
    rating: "Balanced",
    conviction: 56,
    priceTarget12m: 31,
    debateHeadline: "Turnaround credibility versus capital intensity",
    researchThesis: "Intel remains a strategic turnaround with upside if product and foundry execution improve, but the capital-intensity and credibility hurdles are still substantial.",
    debateBull: "If management shows cleaner execution on product cadence and foundry milestones, even modest earnings progress can change the narrative fast.",
    debateBear: "The risk is that heavy spending and uneven product traction keep the story in perpetual promise mode.",
    debateTrigger: "product cadence, foundry milestones, and capital allocation",
    humanAngle: "People want to believe in the turnaround, but most still need repeated execution proof before underwriting a sustained rerating.",
    quantFocus: "Turnaround factors show improving momentum, though downside tails remain wider than most megacap semis because the narrative still hinges on credibility.",
    financialModel: {
      fiscalQuarter: "Q1 2026",
      revenueGrowth: "early recovery",
      operatingMargin: "rebuilding",
      freeCashFlowMargin: "pressured by capex",
      valuationMethod: "Turnaround scenario analysis",
      baseCase: "Progress is real but capital intensity keeps valuation disciplined.",
      bullCase: "Execution milestones stack and the market starts rewarding progress.",
      bearCase: "Spend remains heavy without enough tangible operating payoff.",
    },
    catalysts: [
      "Client and data-center product cadence",
      "Foundry customer milestones",
      "Capital intensity and funding support",
    ],
    risks: [
      "Execution misses on roadmap",
      "Foundry economics taking longer to mature",
      "Persistent capital intensity",
    ],
    humanSignals: [
      "Intel is one of the market's most watched turnaround debates.",
      "The institutional audience is interested, but trust is earned quarter by quarter.",
      "The narrative can swing sharply on even small execution details.",
    ],
  },
  {
    symbol: "NEM",
    companyName: "Newmont",
    websiteUrl: "https://www.newmont.com",
    sector: "Materials",
    industry: "Gold Mining",
    marketCapUsd: 122_100_000_000,
    marketCapLabel: "$122.1B",
    earningsDate: "2026-04-23",
    earningsTiming: "After close",
    fiscalQuarter: "Q1 2026",
    epsEstimateLabel: "$2.02",
    summary: "Newmont is the largest listed gold miner, with a global portfolio of gold and copper assets leveraged to commodity prices and operating execution.",
    rating: "Constructive",
    conviction: 63,
    priceTarget12m: 64,
    debateHeadline: "Gold-price leverage versus cost discipline",
    researchThesis: "The setup improves when gold stays elevated and Newmont proves it can translate that backdrop into cleaner margins and cash returns.",
    debateBull: "High gold prices create powerful earnings torque if cost control and mine execution remain disciplined.",
    debateBear: "If cost inflation or operational variability dilutes the commodity tailwind, the stock may underwhelm despite strong metal prices.",
    debateTrigger: "all-in sustaining costs and free-cash-flow conversion",
    humanAngle: "People see Newmont as the liquid gold equity benchmark, but they still demand disciplined execution to justify preferring the stock over the metal itself.",
    quantFocus: "Commodity-beta models are constructive with gold elevated, though the alpha comes from margin execution rather than macro exposure alone.",
    financialModel: {
      fiscalQuarter: "Q1 2026",
      revenueGrowth: "commodity-driven",
      operatingMargin: "mid-20s",
      freeCashFlowMargin: "low-teens",
      valuationMethod: "NAV sensitivity and free-cash-flow leverage to gold",
      baseCase: "Gold stays supportive and Newmont converts more of the tailwind into cash.",
      bullCase: "Cost discipline sharpens and the equity rerates as the clean miner pick.",
      bearCase: "Cost pressure leaves the stock lagging the metal.",
    },
    catalysts: [
      "All-in sustaining cost performance",
      "Production delivery versus plan",
      "Capital return and balance-sheet updates",
    ],
    risks: [
      "Cost inflation",
      "Operational disruption at key mines",
      "Gold-price volatility reversing sentiment",
    ],
    humanSignals: [
      "Gold bulls like the torque but prefer proof on execution.",
      "Newmont competes with bullion as a capital-allocation choice.",
      "Free-cash-flow conversion is the key stock-specific tell.",
    ],
  },
  {
    symbol: "PG",
    companyName: "Procter & Gamble",
    websiteUrl: "https://us.pg.com",
    sector: "Consumer Staples",
    industry: "Household & Personal Care",
    marketCapUsd: 333_200_000_000,
    marketCapLabel: "$333.2B",
    earningsDate: "2026-04-24",
    earningsTiming: "Before open",
    fiscalQuarter: "Q1 2026",
    epsEstimateLabel: "$1.57",
    summary: "Procter & Gamble sells global household and personal-care brands with strong pricing power, recurring consumer demand, and broad retail distribution.",
    rating: "Constructive",
    conviction: 70,
    priceTarget12m: 192,
    debateHeadline: "Pricing power versus volume elasticity",
    researchThesis: "Agents continue to like PG as a high-quality staples compounder as long as pricing remains rational and category volumes stay resilient.",
    debateBull: "Stable volumes and disciplined pricing can keep the premium staples multiple intact in a choppier macro tape.",
    debateBear: "If elasticity or private-label pressure creeps higher, the quarter may look clean but less premium-worthy.",
    debateTrigger: "organic sales mix and gross-margin cadence",
    humanAngle: "People trust PG's operating model, so the real debate is whether the premium multiple still makes sense after years of dependable execution.",
    quantFocus: "Low-volatility and earnings-stability factors still score PG highly, especially when the market wants defensive cash generators.",
    financialModel: {
      fiscalQuarter: "Q1 2026",
      revenueGrowth: "mid-single digits",
      operatingMargin: "mid-20s",
      freeCashFlowMargin: "mid-teens",
      valuationMethod: "Staples premium multiple and cash-return consistency",
      baseCase: "PG keeps compounding with little drama and a durable premium.",
      bullCase: "Category resilience and pricing prove stronger than feared.",
      bearCase: "Volume softness invites multiple compression.",
    },
    catalysts: [
      "Organic sales growth",
      "Volume versus pricing mix",
      "Gross-margin progression",
    ],
    risks: [
      "Consumer elasticity",
      "Private-label competition",
      "Premium defensive valuation",
    ],
    humanSignals: [
      "PG is a core defensive holding for many funds.",
      "The market still rewards predictability.",
      "Volume softness is the quickest way to challenge the premium multiple.",
    ],
  },
  {
    symbol: "HCA",
    companyName: "HCA Healthcare",
    websiteUrl: "https://hcahealthcare.com",
    sector: "Health Care",
    industry: "Hospitals",
    marketCapUsd: 109_200_000_000,
    marketCapLabel: "$109.2B",
    earningsDate: "2026-04-24",
    earningsTiming: "Before open",
    fiscalQuarter: "Q1 2026",
    epsEstimateLabel: "$7.19",
    summary: "HCA Healthcare operates one of the largest U.S. hospital systems, with earnings driven by admissions growth, payer mix, labor efficiency, and acuity.",
    rating: "Constructive",
    conviction: 72,
    priceTarget12m: 445,
    debateHeadline: "Admissions momentum versus labor and payer noise",
    researchThesis: "The hospital setup remains attractive if admissions and acuity stay firm while labor costs remain under control.",
    debateBull: "Strong procedure volumes and a steady labor environment can make HCA one of the cleaner health-care earnings stories this week.",
    debateBear: "If payer mix or labor trends wobble, the market could treat the quarter as merely good instead of rerating-worthy.",
    debateTrigger: "same-facility admissions and labor-cost discipline",
    humanAngle: "People like HCA's operational edge, but they watch labor and reimbursement closely because those factors can change the quarter's tone fast.",
    quantFocus: "The model stack sees HCA as a high-quality operational compounder with comparatively attractive event asymmetry into the print.",
    financialModel: {
      fiscalQuarter: "Q1 2026",
      revenueGrowth: "mid-single digits",
      operatingMargin: "mid-teens",
      freeCashFlowMargin: "high-single digits",
      valuationMethod: "Forward EPS and hospital-operator quality premium",
      baseCase: "Operational discipline keeps estimates marching higher.",
      bullCase: "Volumes and labor both cooperate, driving upside revisions.",
      bearCase: "Cost or reimbursement noise blocks the rerating.",
    },
    catalysts: [
      "Same-facility admissions and acuity",
      "Labor-cost discipline",
      "Cash deployment and buybacks",
    ],
    risks: [
      "Labor inflation",
      "Payer or reimbursement pressure",
      "Procedure volume softness",
    ],
    humanSignals: [
      "HCA is widely respected for execution inside providers.",
      "Labor cost commentary remains critical.",
      "The market is willing to reward a clean quarter with a higher-quality multiple.",
    ],
  },
];

export function getStockCoverageWeek() {
  return ACTIVE_MARKET_WEEK;
}

export function getStockCoverageUniverse() {
  if (!STOCK_COVERAGE_ENABLED) {
    return STOCK_COVERAGE_SEEDS.filter((entry) =>
      PUBLIC_STOCK_COVERAGE_SYMBOLS.has(entry.symbol)
    ).map(buildEntry);
  }

  return STOCK_COVERAGE_SEEDS.map(buildEntry);
}

export function getStockCoverageEntry(symbol: string) {
  const normalized = symbol.trim().toUpperCase();

  if (!STOCK_COVERAGE_ENABLED && !PUBLIC_STOCK_COVERAGE_SYMBOLS.has(normalized)) {
    return null;
  }

  const seed = STOCK_COVERAGE_SEEDS.find((entry) => entry.symbol === normalized);
  return seed ? buildEntry(seed) : null;
}

export function getStockResearchArticles(symbol: string) {
  const entry = getStockCoverageEntry(symbol);
  return entry?.researchProgram?.publishedResearch ?? [];
}

export function getStockResearchAgents(symbol: string) {
  const entry = getStockCoverageEntry(symbol);
  return entry?.researchProgram?.agents ?? [];
}

export function getStockResearchArticle(symbol: string, slug: string) {
  const normalizedSlug = slug.trim().toLowerCase();
  return getStockResearchArticles(symbol).find(
    (article) => article.slug.toLowerCase() === normalizedSlug
  ) ?? null;
}

export function getStockResearchAgent(symbol: string, slug: string) {
  const normalizedSlug = slug.trim().toLowerCase();

  return (
    getStockResearchAgents(symbol).find((agent) => {
      const agentSlug = (agent.slug ?? getStockResearchAgentSlug(agent)).toLowerCase();

      return (
        agentSlug === normalizedSlug ||
        agent.handle.toLowerCase() === normalizedSlug ||
        agent.code.toLowerCase() === normalizedSlug
      );
    }) ?? null
  );
}

export function getMegaCapEarningsCalendar() {
  if (!STOCK_COVERAGE_ENABLED) {
    return [];
  }

  return STOCK_COVERAGE_SEEDS
    .filter((entry) => entry.marketCapUsd >= ACTIVE_MARKET_WEEK.thresholdMarketCapUsd)
    .map(buildEntry)
    .sort((left, right) => {
      const byDate = left.earningsDate.localeCompare(right.earningsDate);

      if (byDate !== 0) {
        return byDate;
      }

      if (left.earningsTiming !== right.earningsTiming) {
        return left.earningsTiming === "Before open" ? -1 : 1;
      }

      return left.companyName.localeCompare(right.companyName);
    });
}

export function getMegaCapIpoCalendar() {
  if (!STOCK_COVERAGE_ENABLED) {
    return [];
  }

  return IPO_WATCHLIST.filter(
    (entry) => entry.valueUsd >= ACTIVE_MARKET_WEEK.thresholdMarketCapUsd
  ).sort((left, right) => left.expectedDate.localeCompare(right.expectedDate));
}

export function getIpoWatchlist() {
  if (!STOCK_COVERAGE_ENABLED) {
    return [];
  }

  return [...IPO_WATCHLIST].sort((left, right) =>
    left.expectedDate.localeCompare(right.expectedDate)
  );
}
