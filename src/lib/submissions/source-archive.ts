import "server-only";

import AdmZip from "adm-zip";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  SOURCE_ARCHIVE_ARTIFACT,
  SOURCE_ROOT_RELATIVE_PATH,
} from "@/lib/submissions/constants";
import { getStorageAdapter } from "@/lib/submissions/storage/local";

function isGitDirectoryPath(relativePath: string) {
  return relativePath.split("/").includes(".git");
}

function normalizeArchiveEntryPath(entryName: string) {
  const normalized = entryName.replace(/\\/g, "/").replace(/^\/+/, "");

  if (
    !normalized ||
    normalized.includes("../") ||
    normalized.startsWith("../") ||
    path.posix.isAbsolute(normalized)
  ) {
    throw new Error(`Source archive contains an unsafe path: ${entryName}`);
  }

  return normalized;
}

async function addDirectoryToArchive(input: {
  archive: AdmZip;
  basePath: string;
  directoryPath: string;
}) {
  const entries = await readdir(input.directoryPath, { withFileTypes: true });
  let fileCount = 0;

  for (const entry of entries) {
    const absolutePath = path.join(input.directoryPath, entry.name);
    const relativePath = path
      .relative(input.basePath, absolutePath)
      .split(path.sep)
      .join("/");

    if (isGitDirectoryPath(relativePath)) {
      continue;
    }

    if (entry.isDirectory()) {
      fileCount += await addDirectoryToArchive({
        archive: input.archive,
        basePath: input.basePath,
        directoryPath: absolutePath,
      });
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    input.archive.addFile(relativePath, await readFile(absolutePath));
    fileCount += 1;
  }

  return fileCount;
}

export async function persistSubmissionSourceArchive(input: {
  sourcePath: string;
  submissionId: string;
}) {
  const sourceStat = await stat(input.sourcePath).catch(() => null);

  if (!sourceStat?.isDirectory()) {
    throw new Error(`Submission source directory is missing: ${input.sourcePath}`);
  }

  const archive = new AdmZip();
  const fileCount = await addDirectoryToArchive({
    archive,
    basePath: input.sourcePath,
    directoryPath: input.sourcePath,
  });

  if (fileCount === 0) {
    throw new Error(`Submission source directory is empty: ${input.sourcePath}`);
  }

  const storage = getStorageAdapter();
  return storage.writeBuffer(
    input.submissionId,
    SOURCE_ARCHIVE_ARTIFACT,
    archive.toBuffer()
  );
}

export async function restoreSubmissionSourceArchive(submissionId: string) {
  const storage = getStorageAdapter();
  const archivePath = storage.resolveSubmissionAbsolutePath(
    submissionId,
    SOURCE_ARCHIVE_ARTIFACT
  );
  const archiveBytes = await readFile(archivePath).catch(() => null);

  if (!archiveBytes) {
    return null;
  }

  const sourcePath = storage.resolveSubmissionAbsolutePath(
    submissionId,
    SOURCE_ROOT_RELATIVE_PATH
  );
  const archive = new AdmZip(archiveBytes);
  let fileCount = 0;

  await rm(sourcePath, { force: true, recursive: true });
  await mkdir(sourcePath, { recursive: true });

  for (const entry of archive.getEntries()) {
    if (entry.isDirectory) {
      continue;
    }

    const relativePath = normalizeArchiveEntryPath(entry.entryName);

    if (isGitDirectoryPath(relativePath)) {
      continue;
    }

    const targetPath = path.join(sourcePath, relativePath);
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, entry.getData());
    fileCount += 1;
  }

  return fileCount > 0 ? sourcePath : null;
}
