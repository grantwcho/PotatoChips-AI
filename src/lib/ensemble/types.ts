export type EnsembleAgentSummary = {
  agentName: string;
  id: string;
  packageReference: string;
  publicAgentSlug: string | null;
  submittedAt: string;
  submitter: string;
};

export type EnsembleDashboardData = {
  acceptedAgents: EnsembleAgentSummary[];
  orchestratorModel: string;
};

export type EnsembleAgentRunStatus = "error" | "ok";

export type EnsembleAgentRunView = EnsembleAgentSummary & {
  durationMs: number;
  error: string | null;
  outputPreview: string;
  status: EnsembleAgentRunStatus;
};

export type EnsembleRunResponse = {
  agentRuns: EnsembleAgentRunView[];
  message: string;
  orchestratorModel: string;
};
