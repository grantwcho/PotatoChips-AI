import "server-only";

import { runHrCommand } from "@/lib/hr-agent/storage";

export type HrArchiveFormat = "zip" | "tar" | "tar.gz";

const SOURCE_UPLOAD_EXTENSIONS = [
  ".cjs",
  ".js",
  ".json",
  ".jsx",
  ".mjs",
  ".py",
  ".rb",
  ".sh",
  ".ts",
  ".tsx",
] as const;

export function detectArchiveFormat(fileName: string): HrArchiveFormat | null {
  const normalized = fileName.toLowerCase();

  if (normalized.endsWith(".zip")) {
    return "zip";
  }

  if (normalized.endsWith(".tar.gz") || normalized.endsWith(".tgz")) {
    return "tar.gz";
  }

  if (normalized.endsWith(".tar")) {
    return "tar";
  }

  return null;
}

export function isLikelySourceUpload(fileName: string) {
  const normalized = fileName.toLowerCase();
  return SOURCE_UPLOAD_EXTENSIONS.some((extension) => normalized.endsWith(extension));
}

export async function listArchiveEntries(archivePath: string) {
  const format = detectArchiveFormat(archivePath);

  if (!format) {
    throw new Error("Uploaded agent package must be a .zip, .tar, or .tar.gz archive.");
  }

  const result =
    format === "zip"
      ? await runHrCommand({
          command: "unzip",
          args: ["-Z1", archivePath],
          timeoutMs: 10_000,
        })
      : await runHrCommand({
          command: "tar",
          args: ["-tf", archivePath],
          timeoutMs: 10_000,
        });

  if (result.exitCode !== 0) {
    throw new Error(`Unable to inspect uploaded archive: ${result.stderr || result.stdout}`);
  }

  const entries = result.stdout
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean);

  for (const entry of entries) {
    if (entry.startsWith("/") || entry.split("/").includes("..")) {
      throw new Error("Archive contains an unsafe path and cannot be quarantined.");
    }
  }

  return {
    format,
    entries,
  };
}

export async function extractArchive(archivePath: string, destination: string) {
  const format = detectArchiveFormat(archivePath);

  if (!format) {
    throw new Error("Unsupported archive format.");
  }

  const result =
    format === "zip"
      ? await runHrCommand({
          command: "unzip",
          args: ["-qq", "-o", archivePath, "-d", destination],
          timeoutMs: 20_000,
        })
      : await runHrCommand({
          command: "tar",
          args:
            format === "tar.gz"
              ? ["-xzf", archivePath, "-C", destination]
              : ["-xf", archivePath, "-C", destination],
          timeoutMs: 20_000,
        });

  if (result.exitCode !== 0) {
    throw new Error(`Unable to extract uploaded archive: ${result.stderr || result.stdout}`);
  }
}
