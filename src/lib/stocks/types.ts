export type EarningsTiming = "Before open" | "After close";

export type StockCoverageRating = "Constructive" | "Balanced" | "Cautious";
export type StockCoveragePageMode = "earnings" | "research";

export type StockCoverageWeek = {
  start: string;
  end: string;
  label: string;
  thresholdMarketCapUsd: number;
};

export type StockCoverageAgentView = {
  agentId: string;
  agentName: string;
  role: string;
  verdict: string;
  confidence: number;
  summary: string;
};

export type StockCoverageQuantModel = {
  id: string;
  name: string;
  owner: string;
  horizon: string;
  signal: string;
  summary: string;
};

export type StockCoverageDebateMessage = {
  id: string;
  senderId: string;
  senderName: string;
  senderRole: string;
  messageType: string;
  priority: "NORMAL" | "HIGH" | "CRITICAL";
  renderType: "default" | "alert" | "action";
  timestamp: string;
  content: string;
};

export type StockCoverageFinancialModel = {
  fiscalQuarter: string;
  revenueGrowth: string;
  operatingMargin: string;
  freeCashFlowMargin: string;
  valuationMethod: string;
  baseCase: string;
  bullCase: string;
  bearCase: string;
};

export type StockCoverageForecastScenario = {
  targetPrice: number;
  expectation: string;
  summary: string;
};

export type StockCoverageForecast = {
  horizonLabel: string;
  compiledBy: string;
  summary: string;
  baseline: StockCoverageForecastScenario;
  bull: StockCoverageForecastScenario;
  bear: StockCoverageForecastScenario;
};

export type StockResearchPrinciple = {
  title: string;
  description: string;
};

export type StockResearchLoopStep = {
  cadence: string;
  description: string;
};

export type StockResearchArticle = {
  id: string;
  slug: string;
  category: string;
  title: string;
  dek: string;
  publishedAt: string;
  agentCode: string;
  agentHandle: string;
  briefType: string;
  keyPoints: string[];
  sections: Array<{
    heading: string;
    paragraphs: string[];
  }>;
};

export type StockResearchAgent = {
  slug?: string;
  code: string;
  handle: string;
  name: string;
  role: string;
  status: "live" | "planned";
  focus: string;
  researchType?: string;
  apiRequestCount?: number;
  submittedAt?: string;
  updatedAt?: string;
  pricePerMillionTokensUsd?: {
    input: number;
    output: number;
  };
  llmModel?: string;
  bountyUsd?: number;
  orthogonality?: string;
  orthogonalityScore?: number;
  marginalShapley?: number;
  submitter?: {
    name: string;
    profileUrl?: string | null;
    affiliation?: string | null;
    anonymous?: boolean;
  };
  summary: string;
  roleDescription: string;
  dataSources: string[];
  researchLoop: StockResearchLoopStep[];
  structuredOutputExample: string;
  naturalLanguageFormat: string;
  collaboration: string[];
  communicationStyle: string;
  guardrails: string[];
  fullPrompt: string;
};

export type StockResearchProgram = {
  title: string;
  summary: string;
  totalAgents: number;
  specialists: number;
  synthesisAgents: number;
  activeAgents: number;
  principles: StockResearchPrinciple[];
  feedEyebrow?: string;
  feedTitle?: string;
  feedMessages?: StockCoverageDebateMessage[];
  publishedResearch?: StockResearchArticle[];
  agents: StockResearchAgent[];
};

export type StockCoverageEntry = {
  symbol: string;
  companyName: string;
  websiteUrl: string;
  sector: string;
  industry: string;
  pageMode: StockCoveragePageMode;
  marketCapUsd: number;
  marketCapLabel: string;
  earningsDate: string;
  earningsTiming: EarningsTiming;
  earningsLabel: string;
  fiscalQuarter: string;
  epsEstimateLabel: string;
  summary: string;
  rating: StockCoverageRating;
  conviction: number;
  priceTarget12m: number;
  debateHeadline: string;
  researchThesis: string;
  catalysts: string[];
  risks: string[];
  humanSignals: string[];
  financialModel: StockCoverageFinancialModel;
  forecast12m?: StockCoverageForecast;
  agentViews: StockCoverageAgentView[];
  quantModels: StockCoverageQuantModel[];
  debateMessages: StockCoverageDebateMessage[];
  researchProgram?: StockResearchProgram;
};

export type StockCoverageQuote = {
  price: number | null;
  previousClose: number | null;
  change: number | null;
  changePct: number | null;
  askPrice: number | null;
  bidPrice: number | null;
  note: string | null;
  updatedAt: string;
};

export type StockCoverageChartPoint = {
  timestamp: string;
  price: number;
};

export type StockCoverageChartRange = "1D" | "1M" | "1Y";

export type StockCoverageChart = {
  rangeLabel: StockCoverageChartRange;
  trend: "up" | "down" | "flat";
  points: StockCoverageChartPoint[];
  note: string | null;
};

export type StockCoverageNewsItem = {
  title: string;
  description: string | null;
  url: string | null;
  sourceName: string | null;
  publishedAt: string | null;
};

export type StockCoverageLiveData = {
  quote: StockCoverageQuote;
  charts: Record<StockCoverageChartRange, StockCoverageChart>;
  news: StockCoverageNewsItem[];
  priceApiConfigured: boolean;
  newsApiConfigured: boolean;
  newsNote: string | null;
  updatedAt: string;
};

export type StockCoveragePageData = {
  profile: StockCoverageEntry;
  liveData: StockCoverageLiveData;
};

export type StockIpoEntry = {
  companyName: string;
  symbol: string;
  expectedDate: string;
  exchange: string;
  valueUsd: number;
  valueLabel: string;
  websiteUrl: string | null;
};
