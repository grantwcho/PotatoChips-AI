import "server-only";

import {
  parseSubmissionManifest,
  parseSubmissionManifestPermissive,
} from "@/lib/submissions/manifest";
import {
  persistParsedSubmissionArtifact,
  SubmissionHttpError,
} from "@/lib/submissions/service";
import type { ParsedSubmission } from "@/lib/submissions/types";

function inferLanguage(relativePath: string) {
  const lowerPath = relativePath.toLowerCase();

  if (lowerPath.endsWith(".json")) {
    return "json";
  }

  if (lowerPath.endsWith(".yaml") || lowerPath.endsWith(".yml")) {
    return "yaml";
  }

  return "text";
}

export function assertSupportedManifestSnapshot(input: {
  content: string;
  relativePath: string;
}) {
  const manifest = parseSubmissionManifest(input);

  if (!manifest.validation.valid) {
    throw new SubmissionHttpError(manifest.validation.errors.join("; "), 400);
  }

  return manifest;
}

export async function writeManifestOnlyParsedSubmission(input: {
  content: string;
  relativePath: string;
  submissionId: string;
}) {
  const manifest = parseSubmissionManifestPermissive(input);
  const parsedSubmission = {
    detectedEnvVars: [],
    detectedImports: [],
    detectedUrls: [],
    fileTree: [input.relativePath],
    keyFiles: [
      {
        content: input.content,
        language: inferLanguage(input.relativePath),
        path: input.relativePath,
      },
    ],
    manifest,
    parsedAt: new Date().toISOString(),
    templateVersion: null,
  } satisfies ParsedSubmission;

  await persistParsedSubmissionArtifact({
    parsedSubmission,
    submissionId: input.submissionId,
  });
  return parsedSubmission;
}
