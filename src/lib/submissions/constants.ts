import path from "node:path";
import {
  SubmissionProcessingStage,
  SubmissionSource,
  SubmissionStatus,
} from "@/lib/prisma-client";

export const MAX_UPLOAD_TOTAL_BYTES = 50 * 1024 * 1024;
export const SUBMISSION_POLL_INTERVAL_MS = 2_000;

export const SUBMISSION_STATUS_LABELS: Record<SubmissionStatus, string> = {
  CREATED: "Created",
  PROCESSING: "Processing",
  READY_FOR_REVIEW: "Ready for review",
  SIGNED: "Signed",
  FAILED: "Failed",
};

export const SUBMISSION_STAGE_LABELS: Record<SubmissionProcessingStage, string> = {
  SOURCE_ACQUISITION: "Cloning repo",
  PARSING_FILES: "Parsing files",
  GENERATING_INTERPRETATION: "Generating interpretation",
  GENERATING_ADAPTER: "Generating adapter",
};

export const SUBMISSION_SOURCE_LABELS: Record<SubmissionSource, string> = {
  GITHUB: "GitHub",
  UPLOAD: "Upload",
};

export const DEFAULT_STORAGE_BASE_PATH = path.resolve(
  process.cwd(),
  "storage",
  "submissions"
);

export const PARSED_SUBMISSION_ARTIFACT = "artifacts/parsed-submission.json";
export const AI_RESPONSE_ARTIFACT = "artifacts/ai-response.json";
export const SUBMISSION_GATE_ARTIFACT = "artifacts/submission-gate-report.json";
export const SIGNED_BUNDLE_ARTIFACT = "artifacts/signed-bundle.json";
export const SOURCE_ARCHIVE_ARTIFACT = "artifacts/source.zip";
export const SOURCE_ROOT_RELATIVE_PATH = "source";
export const DOCS_ROOT_RELATIVE_PATH = "documentation";
export const INCOMING_ROOT_RELATIVE_PATH = "incoming";
