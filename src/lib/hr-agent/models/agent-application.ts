export const HR_PIPELINE_STAGES = [
  {
    key: "stage1-quarantine",
    label: "Historical Replay",
    description:
      "Validate the submission package, then run ten deterministic-random historical windows across the past 20 years.",
  },
  {
    key: "stage2-security",
    label: "Live Simulation",
    description:
      "Wrap model submissions as agents when needed and simulate one month of live data beside the current sleeves.",
  },
  {
    key: "stage3-conformance",
    label: "Onboarding Review",
    description:
      "AI HR decides hire, backburner, or reject, and the research lead recommends a starting ensemble weight for approved agents.",
  },
] as const;

export const AGENT_APPLICATION_STATUSES = [
  "Historical Replay",
  "Live Simulation",
  "Onboarding",
  "Backburner",
  "Hired",
  "Rejected",
] as const;

export const AGENT_APPLICATION_TYPES = [
  "macro",
  "event",
  "sentiment",
  "research",
  "custom",
] as const;

export type HrPipelineStageKey = (typeof HR_PIPELINE_STAGES)[number]["key"];
export type AgentApplicationStatus = (typeof AGENT_APPLICATION_STATUSES)[number];
export type AgentApplicationType = (typeof AGENT_APPLICATION_TYPES)[number];
export type HrStageState = "pending" | "running" | "passed" | "failed";
export type HrPackageType = "docker-image" | "api-endpoint" | "code-archive";
export type HrTestStatus = "pass" | "warn" | "fail";
export type HrAcceptedRuntimeMode =
  | "containerized-code-agent"
  | "containerized-api-adapter"
  | "provided-docker-image";
export type HrAcceptedRuntimeStrategy =
  | "nixpacks"
  | "cloud-native-buildpacks"
  | "provided-docker-image";
export type HrAcceptedRuntimeStatus = "planned" | "ready";
export type SubmissionReviewStatus = "APPROVED" | "PENDING" | "REJECTED" | "REMOVED";

export type HrAcceptedRuntimePlan = {
  mode: HrAcceptedRuntimeMode;
  strategy: HrAcceptedRuntimeStrategy;
  fallbackStrategy: Exclude<HrAcceptedRuntimeStrategy, "provided-docker-image"> | null;
  sourcePackageType: HrPackageType;
  sourceReference: string;
  producedPackageType: "docker-image";
  producedArtifactReference: string | null;
  networkPolicy: "none" | "controlled-outbound";
  status: HrAcceptedRuntimeStatus;
  summary: string;
  generatedAt: string;
  notes: string[];
};

export type SignalOutput = {
  agent_id: string;
  agent_type: AgentApplicationType;
  timestamp: string;
  ticker: string;
  direction: "long" | "short" | "close";
  conviction: number;
  time_horizon: "intraday" | "swing" | "position";
  stop_loss_pct: number;
  take_profit_pct: number;
  max_position_pct: number;
  reasoning: string;
  data_sources: string[];
  correlation_id: string;
};

export type HrPipelineStageResult = {
  stageKey: HrPipelineStageKey;
  state: HrStageState;
  startedAt: string | null;
  completedAt: string | null;
  summary: string;
  failureReason: string | null;
  artifacts: string[];
};

export type HrSecurityReport = {
  flaggedDependencies: string[];
  suspiciousPatterns: string[];
  networkCallAttempts: string[];
  syscallFindings: string[];
  hardcodedCredentialFindings: string[];
  obfuscationFindings: string[];
  stateIsolationFindings: string[];
  excessivePermissionRequests: string[];
  reviewSummary: string;
};

export type HrDocumentationProfile = {
  assetClasses: string;
  riskParameters: string;
  holdingPeriod: string;
};

export type HrIntakeReport = {
  summary: string;
  packageFormat: string;
  workspaceRoot: string | null;
  executionTarget: string | null;
  manifestPath: string | null;
  dependencyDeclaration: string | null;
  extractedFileCount: number;
  documentationComplete: boolean;
  missingDocumentation: string[];
  notes: string[];
  security: HrSecurityReport;
};

export type HrFunctionalTestResult = {
  key: string;
  label: string;
  status: HrTestStatus;
  detail: string;
};

export type HrRegimeBacktestResult = {
  key: string;
  label: string;
  windowLabel: string;
  evaluatedSignals: number;
  totalReturnPct: number | null;
  sharpeRatio: number | null;
  maxDrawdownPct: number | null;
  worstDayPct: number | null;
  notes: string[];
  status: HrTestStatus;
};

export type HrPnlPoint = {
  timestamp: string;
  value: number;
};

export type HrPerformanceMetrics = {
  sharpeRatio: number | null;
  sortinoRatio: number | null;
  maxDrawdownPct: number | null;
  averageDrawdownPct: number | null;
  drawdownDurationBars: number | null;
  winRatePct: number | null;
  totalSignalsGenerated: number;
  correlationWithExistingAgents: number | null;
  correlationWithSp500: number | null;
  correlationWithRates: number | null;
  correlationWithVol: number | null;
  dailyVolatilityPct: number | null;
  weeklyVolatilityPct: number | null;
  cvar95Pct: number | null;
  worstDayPct: number | null;
  worstWeekPct: number | null;
  averageGrossExposurePct: number | null;
  peakGrossExposurePct: number | null;
  concentrationRiskPct: number | null;
  turnoverPct: number | null;
  transactionCostDragPct: number | null;
  netReturnPct: number | null;
  pnlSeries: HrPnlPoint[];
};

export type HrSandboxReport = {
  summary: string;
  replayNotes: string[];
  rawAgentOutput: string;
  sampleSignal: SignalOutput | null;
  functionalTests: HrFunctionalTestResult[];
  regimeResults: HrRegimeBacktestResult[];
  metrics: HrPerformanceMetrics;
};

export type HrStressTestResult = {
  key: string;
  label: string;
  status: HrTestStatus;
  detail: string;
  conviction: number | null;
  maxPositionPct: number | null;
};

export type HrAdversarialReport = {
  summary: string;
  resilienceScore: number | null;
  blockingIssues: string[];
  tests: HrStressTestResult[];
};

export type HrPortfolioFitReport = {
  summary: string;
  marginalSharpeDelta: number | null;
  overlapScore: number | null;
  overlapAssessment: string;
  capacityAssessment: string;
  interpretabilityAssessment: string;
  portfolioRole: string;
};

export type HrShadowComparisonRow = {
  ticker: string;
  event: string;
  submittedAgentSignal: string;
  defaultAgentSignal: string;
  divergence: string;
};

export type HrProbationReport = {
  summary: string;
  startingAllocationPct: number;
  tightenedRiskLimits: string[];
  probationDays: number;
  liveDivergenceThresholdPct: number;
  promotionCriteria: string[];
  metrics: HrPerformanceMetrics;
  comparisonRows: HrShadowComparisonRow[];
  divergenceNotes: string[];
};

export type HrApplicationEvent = {
  id: string;
  applicationId: string;
  eventType:
    | "SUBMITTED"
    | "STAGE_ENQUEUED"
    | "STAGE_STARTED"
    | "STAGE_COMPLETED"
    | "STAGE_FAILED"
    | "DECISION_READY"
    | "DECISION_APPROVED"
    | "DECISION_OVERRIDDEN";
  stageKey: HrPipelineStageKey | null;
  summary: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type HrHiringDecision = {
  recommendation: "Hire" | "Backburner" | "Reject" | "Pending";
  reasoning: string;
  generatedAt: string | null;
  humanDecision: "Approved" | "Overridden" | null;
  humanDecisionAt: string | null;
  humanNote: string | null;
};

export type HrSubmittedArtifact = {
  type: "agent-package" | "documentation";
  name: string;
  contentType: string | null;
  sizeBytes: number | null;
};

export type AgentApplication = {
  id: string;
  agentName: string;
  submitter: string;
  submitterKey: string;
  type: AgentApplicationType;
  packageType: HrPackageType;
  packageReference: string;
  documentationReference: string;
  submittedArtifacts: HrSubmittedArtifact[];
  submittedAt: string;
  submissionReviewStatus?: SubmissionReviewStatus | null;
  updatedAt: string;
  status: AgentApplicationStatus;
  currentStage: HrPipelineStageKey;
  protected: boolean;
  description: string;
  claimedEdge: string;
  dataSourcesRequired: string;
  documentationProfile: HrDocumentationProfile;
  acceptedRuntimePlan: HrAcceptedRuntimePlan | null;
  stageResults: Partial<Record<HrPipelineStageKey, HrPipelineStageResult>>;
  intakeReport: HrIntakeReport;
  sandboxReport: HrSandboxReport;
  adversarialReport: HrAdversarialReport;
  portfolioFitReport: HrPortfolioFitReport;
  probationReport: HrProbationReport;
  hiringDecision: HrHiringDecision;
  cooldownTracking: {
    lastSubmissionTimestamp: string;
    cooldownSeconds: number;
  };
  recentEvents: HrApplicationEvent[];
};

export type AgentApplicationSummary = Pick<
  AgentApplication,
  | "id"
  | "agentName"
  | "submitter"
  | "type"
  | "submittedAt"
  | "status"
  | "currentStage"
  | "protected"
>;

export type RecruitingDashboardData = {
  applications: AgentApplication[];
  pipelineCount: number;
  protectedAgents: ProtectedAgentRecord[];
  cooldownSeconds: number;
  backendStatus: {
    persistence: "alloydb" | "filesystem";
    pipelineDriver: "cloud-tasks" | "inline";
    pollingIntervalSeconds: number;
    ready: boolean;
    message: string;
  };
};

export type ProtectedAgentRecord = {
  id: string;
  role: string;
  protected: true;
  reason: string;
};

export type AgentSubmissionInput = {
  submitter: string;
  submitterKey?: string;
  agentName: string;
  type: AgentApplicationType;
  packageType: HrPackageType;
  packageReference: string;
  documentationReference: string;
  description: string;
  claimedEdge: string;
  dataSourcesRequired: string;
  documentationProfile: HrDocumentationProfile;
  submittedArtifacts?: HrSubmittedArtifact[];
};

export const PROTECTED_DEFAULT_AGENTS: ProtectedAgentRecord[] = [];

export function isFinalApplicationStatus(status: AgentApplicationStatus) {
  return status === "Hired" || status === "Rejected";
}

export function getPipelineStageIndex(stageKey: HrPipelineStageKey) {
  return HR_PIPELINE_STAGES.findIndex((stage) => stage.key === stageKey);
}

export function getStageProgressLabel(application: AgentApplicationSummary) {
  if (isFinalApplicationStatus(application.status)) {
    return "Complete";
  }

  const index = getPipelineStageIndex(application.currentStage);
  return `Stage ${index + 1}/${HR_PIPELINE_STAGES.length}`;
}
