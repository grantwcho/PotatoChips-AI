import type {
  DependencyType,
  ExecutionMode,
  SubmissionProcessingStage,
  SubmissionSource,
  SubmissionStatus,
} from "@/lib/prisma-client";

export type ParsedSubmissionKeyFile = {
  content: string;
  language: string;
  path: string;
};

export type ParsedSubmissionManifest = {
  agentId: string | null;
  command: string[] | null;
  cwd: string | null;
  description: string | null;
  entrypoint: string | null;
  kind: "agent-template" | "runtime" | "generic";
  metrics: string[];
  name: string | null;
  path: string;
  raw: Record<string, unknown>;
  responseFormats: string[];
  runtime: string | null;
  schemaVersion: string | null;
  tags: string[];
  validation: {
    errors: string[];
    valid: boolean;
    warnings: string[];
  };
};

export type ParsedSubmissionTemplateVersion = {
  path: string;
  raw: Record<string, unknown>;
  schemaVersion: string | null;
  sdkVersion: string | null;
  templateVersion: string | null;
};

export type ParsedSubmission = {
  detectedEnvVars: string[];
  detectedImports: string[];
  detectedUrls: string[];
  fileTree: string[];
  keyFiles: ParsedSubmissionKeyFile[];
  manifest?: ParsedSubmissionManifest | null;
  parsedAt: string;
  templateVersion?: ParsedSubmissionTemplateVersion | null;
};

export type AiHrDependency = {
  details: Record<string, unknown>;
  name: string;
  type: DependencyType;
};

export type AiHrCard = {
  aiHrNotes: string;
  assetUniverse: string;
  capitalRangeMax: number | null;
  capitalRangeMin: number | null;
  claimedEdge: string;
  decisionCadence: string;
  dependencies: AiHrDependency[];
  entryPoint: string;
  executionMode: ExecutionMode;
  killSwitchBehavior: string;
  riskEnvelope: Record<string, unknown>;
  strategyClassification: string;
  timeframe: string;
};

export type AiHrAdapter = {
  code: string;
  language: "python";
  rationale: string;
};

export type AiHrResponse = {
  adapter: AiHrAdapter;
  card: AiHrCard;
};

export type SubmissionPublicationStatus =
  | "APPROVED"
  | "PENDING"
  | "REJECTED"
  | "REMOVED";

export type SubmissionDetail = {
  adapter: null | {
    code: string;
    editedByUser: boolean;
    generatedAt: string;
    id: string;
    language: string;
    originalCode: string;
    originalRationale: string;
    rationale: string;
  };
  agentName: string | null;
  attestation: null | {
    agreedAt: string;
    attestationText: string;
    id: string;
    signerEmail: string;
    signerName: string;
  };
  card: null | {
    aiHrNotes: string;
    assetUniverse: string;
    capitalRangeMax: number | null;
    capitalRangeMin: number | null;
    claimedEdge: string;
    decisionCadence: string;
    dependencies: AiHrDependency[];
    editedByUser: boolean;
    entryPoint: string;
    executionMode: ExecutionMode;
    generatedAt: string;
    id: string;
    killSwitchBehavior: string;
    originalSnapshot: Record<string, unknown>;
    riskEnvelope: Record<string, unknown>;
    strategyClassification: string;
    timeframe: string;
  };
  createdAt: string;
  description: string;
  documentationPath: string | null;
  githubBranch: string | null;
  githubCommitSha: string | null;
  githubRepoFullName: string | null;
  id: string;
  linkedinProfileUrl: string | null;
  parsedSubmission: ParsedSubmission | null;
  publicationStatus: SubmissionPublicationStatus;
  processingError: string | null;
  processingStage: SubmissionProcessingStage | null;
  processingStageLabel: string | null;
  processingStageMessage: string | null;
  source: SubmissionSource;
  sourceLabel: string;
  sourceViewUrl: string | null;
  status: SubmissionStatus;
  publicAgentSlug: string | null;
  reviewedAt: string | null;
  storagePath: string;
  updatedAt: string;
  uploadContentHash: string | null;
  user: {
    email: string | null;
    githubLogin: string | null;
    id: string;
    name: string | null;
  };
};
