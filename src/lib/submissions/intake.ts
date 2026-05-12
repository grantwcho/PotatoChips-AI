import "server-only";

import AdmZip from "adm-zip";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import {
  MAX_UPLOAD_TOTAL_BYTES,
  SOURCE_ROOT_RELATIVE_PATH,
} from "@/lib/submissions/constants";
import {
  createSubmissionRecord,
  getUploadContentHash,
  persistParsedSubmissionArtifact,
  SubmissionHttpError,
} from "@/lib/submissions/service";
import {
  GithubRepositoryArchiveError,
  cloneGithubRepository,
} from "@/lib/submissions/github/client";
import { scanUploadBufferForMalware } from "@/lib/submissions/security/virus-scan";
import { SubmissionProcessingStage, SubmissionSource } from "@/lib/prisma-client";
import { parseSubmissionSource } from "@/lib/submissions/parser";
import { persistSubmissionSourceArchive } from "@/lib/submissions/source-archive";
import { getStorageAdapter } from "@/lib/submissions/storage/local";

function stringField(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function optionalStringField(formData: FormData, key: string) {
  const value = stringField(formData, key);
  return value || null;
}

function optionalLinkedinProfileUrlField(formData: FormData, key: string) {
  const value = optionalStringField(formData, key);

  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);

    if (!/^https?:$/.test(url.protocol)) {
      throw new Error("invalid protocol");
    }

    return url.toString();
  } catch {
    throw new SubmissionHttpError("Please enter a valid LinkedIn profile URL.", 400);
  }
}

function safeFileName(fileName: string) {
  return fileName.replace(/[^a-zA-Z0-9._-]+/g, "-") || "file";
}

function normalizeRelativePath(value: string) {
  const normalized = value.replace(/\\/g, "/").replace(/^\/+/, "");

  if (!normalized || normalized.includes("../")) {
    throw new SubmissionHttpError(`Unsafe file path: ${value}`, 400);
  }

  return normalized;
}

async function persistDocumentationFile(
  submissionId: string,
  file: File | null | undefined
) {
  if (!(typeof File !== "undefined" && file instanceof File && file.name)) {
    return null;
  }

  const storage = getStorageAdapter();
  const bytes = Buffer.from(await file.arrayBuffer());
  await scanUploadBufferForMalware({
    bytes,
    fileName: file.name,
  });
  const relativePath = path.posix.join("documentation", safeFileName(file.name));
  await storage.writeBuffer(submissionId, relativePath, bytes);
  return relativePath;
}

async function extractZipArchiveToSource(input: {
  bytes: Buffer;
  submissionId: string;
}) {
  const zip = new AdmZip(input.bytes);
  const storage = getStorageAdapter();

  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) {
      continue;
    }

    const relativePath = path.posix.join(
      SOURCE_ROOT_RELATIVE_PATH,
      normalizeRelativePath(entry.entryName)
    );
    await storage.writeBuffer(input.submissionId, relativePath, entry.getData());
  }
}

export async function createGithubSubmissionFromFormData(input: {
  formData: FormData;
  userId: string;
}) {
  const repoFullName = stringField(input.formData, "repoFullName");
  const branch = stringField(input.formData, "branch");
  const commitSha = stringField(input.formData, "commitSha");
  const description = stringField(input.formData, "description");
  const agentName = optionalStringField(input.formData, "agentName");
  const linkedinProfileUrl = optionalLinkedinProfileUrlField(
    input.formData,
    "linkedinProfileUrl"
  );

  if (!repoFullName) {
    throw new SubmissionHttpError("GitHub repository is required.", 400);
  }

  if (!branch) {
    throw new SubmissionHttpError("GitHub branch is required.", 400);
  }

  if (!commitSha) {
    throw new SubmissionHttpError("GitHub commit is required.", 400);
  }

  if (!description) {
    throw new SubmissionHttpError("Description is required.", 400);
  }

  const submissionId = randomUUID();
  const storage = getStorageAdapter();
  const paths = await storage.ensureSubmissionPaths(submissionId);
  const documentationPath = await persistDocumentationFile(
    submissionId,
    input.formData.get("documentation") as File | null
  );

  return createSubmissionRecord({
    agentName,
    description,
    documentationPath,
    githubBranch: branch,
    githubCommitSha: commitSha,
    githubRepoFullName: repoFullName,
    id: submissionId,
    linkedinProfileUrl,
    processingStage: SubmissionProcessingStage.SOURCE_ACQUISITION,
    source: SubmissionSource.GITHUB,
    storagePath: paths.rootPath,
    userId: input.userId,
  });
}

export async function hydrateGithubSubmissionSource(input: {
  accessToken: string;
  branch: string;
  commitSha: string;
  repoFullName: string;
  submissionId: string;
}) {
  let sourcePath: string;

  try {
    const result = await cloneGithubRepository(input);
    sourcePath = result.sourcePath;
  } catch (error) {
    if (error instanceof GithubRepositoryArchiveError) {
      throw new SubmissionHttpError(error.message, error.status);
    }

    const message =
      error instanceof Error
        ? sanitizeSourceHydrationError(error.message)
        : "Unknown repository download failure.";
    throw new SubmissionHttpError(
      `We found manifest.yaml, but could not download the full repository source from GitHub: ${message}`,
      502
    );
  }

  let parsedSubmission: Awaited<ReturnType<typeof parseSubmissionSource>>;

  try {
    parsedSubmission = await parseSubmissionSource(sourcePath);
  } catch (error) {
    const message =
      error instanceof Error
        ? sanitizeSourceHydrationError(error.message)
        : "Unknown parsing failure.";
    throw new SubmissionHttpError(
      `We downloaded the repository, but could not parse the submitted source files: ${message}`,
      400
    );
  }

  await persistParsedSubmissionArtifact({
    parsedSubmission,
    submissionId: input.submissionId,
  });

  return parsedSubmission;
}

function sanitizeSourceHydrationError(message: string) {
  return message
    .replace(/x-access-token:[^@\s]+@github\.com/gi, "x-access-token:[redacted]@github.com")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer [redacted]")
    .slice(0, 500);
}

export async function createUploadSubmissionFromFormData(input: {
  formData: FormData;
  userId: string;
}) {
  const description = stringField(input.formData, "description");
  const agentName = optionalStringField(input.formData, "agentName");
  const linkedinProfileUrl = optionalLinkedinProfileUrlField(
    input.formData,
    "linkedinProfileUrl"
  );

  if (!description) {
    throw new SubmissionHttpError("Description is required.", 400);
  }

  const sourceArchive = input.formData.get("sourceArchive");
  const sourceFiles = input.formData
    .getAll("sourceFiles")
    .filter((value): value is File => typeof File !== "undefined" && value instanceof File);
  const sourceFilePaths = input.formData
    .getAll("sourceFilePaths")
    .map((value) => (typeof value === "string" ? value : ""))
    .filter(Boolean);

  if (
    !(
      (typeof File !== "undefined" && sourceArchive instanceof File && sourceArchive.name) ||
      sourceFiles.length > 0
    )
  ) {
    throw new SubmissionHttpError("Please upload a zip or one or more source files.", 400);
  }

  const submissionId = randomUUID();
  const storage = getStorageAdapter();
  const paths = await storage.ensureSubmissionPaths(submissionId);
  const documentationPath = await persistDocumentationFile(
    submissionId,
    input.formData.get("documentation") as File | null
  );

  let uploadContentHash: string;
  let totalBytes = 0;

  if (typeof File !== "undefined" && sourceArchive instanceof File && sourceArchive.name) {
    if (!sourceArchive.name.toLowerCase().endsWith(".zip")) {
      throw new SubmissionHttpError("Only .zip archives are supported for uploads.", 400);
    }

    const bytes = Buffer.from(await sourceArchive.arrayBuffer());
    totalBytes += bytes.byteLength;

    if (totalBytes > MAX_UPLOAD_TOTAL_BYTES) {
      throw new SubmissionHttpError("Upload exceeds the 50MB MVP limit.", 400);
    }

    await scanUploadBufferForMalware({
      bytes,
      fileName: sourceArchive.name,
    });
    await storage.writeBuffer(
      submissionId,
      path.posix.join("incoming", safeFileName(sourceArchive.name)),
      bytes
    );
    await extractZipArchiveToSource({
      bytes,
      submissionId,
    });
    uploadContentHash = createHash("sha256").update(bytes).digest("hex");
  } else {
    const fileInputs: Array<{ bytes: Buffer; relativePath: string }> = [];

    for (const [index, file] of sourceFiles.entries()) {
      const bytes = Buffer.from(await file.arrayBuffer());
      totalBytes += bytes.byteLength;

      if (totalBytes > MAX_UPLOAD_TOTAL_BYTES) {
        throw new SubmissionHttpError("Upload exceeds the 50MB MVP limit.", 400);
      }

      await scanUploadBufferForMalware({
        bytes,
        fileName: file.webkitRelativePath || file.name || `file-${index + 1}`,
      });
      const relativePath = normalizeRelativePath(
        sourceFilePaths[index] || file.name || `file-${index + 1}`
      );
      fileInputs.push({
        bytes,
        relativePath,
      });
      await storage.writeBuffer(
        submissionId,
        path.posix.join(SOURCE_ROOT_RELATIVE_PATH, relativePath),
        bytes
      );
    }

    uploadContentHash = getUploadContentHash(fileInputs);
  }

  await persistSubmissionSourceArchive({
    sourcePath: paths.sourcePath,
    submissionId,
  });

  const parsedSubmission = await parseSubmissionSource(paths.sourcePath);
  const submission = await createSubmissionRecord({
    agentName,
    description,
    documentationPath,
    id: submissionId,
    linkedinProfileUrl,
    processingStage: SubmissionProcessingStage.SOURCE_ACQUISITION,
    source: SubmissionSource.UPLOAD,
    storagePath: paths.rootPath,
    uploadContentHash,
    userId: input.userId,
  });

  await persistParsedSubmissionArtifact({
    parsedSubmission,
    submissionId,
  });

  return submission;
}
