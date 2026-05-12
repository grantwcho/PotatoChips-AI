import "server-only";

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

type SubmissionArtifactKind = "agent-package" | "documentation";

export type PersistedSubmissionArtifact = {
  type: SubmissionArtifactKind;
  name: string;
  contentType: string | null;
  sizeBytes: number | null;
  sha256: string;
  relativePath: string;
  absolutePath: string;
};

export type HrCommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

export type HrCommandError = Error & {
  exitCode?: number;
  stderr?: string;
  stdout?: string;
  timedOut?: boolean;
};

const MAX_COMMAND_OUTPUT_BYTES = 512 * 1024;

function safeSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "item";
}

function toRelativePath(absolutePath: string) {
  return path.relative(getHrStorageRoot(), absolutePath).split(path.sep).join("/");
}

export function getHrStorageRoot() {
  const configured = process.env.HR_AGENT_STORAGE_ROOT?.trim();
  return (
    configured || path.join(/* turbopackIgnore: true */ process.cwd(), ".data", "hr-agent")
  );
}

export function getHrSubmissionRoot(applicationId: string) {
  return path.join(getHrStorageRoot(), "submissions", safeSegment(applicationId));
}

export function getHrWorkspaceRoot(applicationId: string, stage: string) {
  return path.join(getHrStorageRoot(), "workspaces", safeSegment(applicationId), safeSegment(stage));
}

export function getHrEvidencePath(relativePath: string) {
  return path.join(getHrStorageRoot(), relativePath);
}

export async function ensureHrDirectory(dirPath: string) {
  await mkdir(dirPath, { recursive: true });
  return dirPath;
}

export async function fileExists(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function removeHrSubmissionArtifacts(applicationId: string) {
  await rm(getHrSubmissionRoot(applicationId), { recursive: true, force: true });
  await rm(path.join(getHrStorageRoot(), "workspaces", safeSegment(applicationId)), {
    recursive: true,
    force: true,
  });
}

export async function persistSubmittedFile(input: {
  applicationId: string;
  type: SubmissionArtifactKind;
  file: File;
}) {
  const fileName = safeSegment(input.file.name || `${input.type}.bin`);
  const targetPath = path.join(
    getHrSubmissionRoot(input.applicationId),
    input.type,
    fileName
  );
  const bytes = Buffer.from(await input.file.arrayBuffer());
  const sha256 = createHash("sha256").update(bytes).digest("hex");

  await ensureHrDirectory(path.dirname(targetPath));
  await writeFile(targetPath, bytes);

  return {
    type: input.type,
    name: input.file.name || fileName,
    contentType: input.file.type || null,
    sizeBytes: input.file.size,
    sha256,
    absolutePath: targetPath,
    relativePath: toRelativePath(targetPath),
  } satisfies PersistedSubmissionArtifact;
}

export async function writeSubmissionManifest(
  applicationId: string,
  manifest: Record<string, unknown>
) {
  const targetPath = path.join(getHrSubmissionRoot(applicationId), "manifest.json");
  await ensureHrDirectory(path.dirname(targetPath));
  await writeFile(targetPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return toRelativePath(targetPath);
}

export async function writeHrJsonArtifact(relativePath: string, value: unknown) {
  const targetPath = getHrEvidencePath(relativePath);
  await ensureHrDirectory(path.dirname(targetPath));
  await writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return relativePath.split(path.sep).join("/");
}

export async function writeHrTextArtifact(relativePath: string, value: string) {
  const targetPath = getHrEvidencePath(relativePath);
  await ensureHrDirectory(path.dirname(targetPath));
  await writeFile(targetPath, value.endsWith("\n") ? value : `${value}\n`, "utf8");
  return relativePath.split(path.sep).join("/");
}

export async function readHrJsonArtifact<T>(relativePath: string): Promise<T | null> {
  const targetPath = getHrEvidencePath(relativePath);

  try {
    const content = await readFile(targetPath, "utf8");
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

export async function listSubmissionArtifactFiles(
  applicationId: string,
  type: SubmissionArtifactKind
) {
  const dirPath = path.join(getHrSubmissionRoot(applicationId), type);

  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => path.join(dirPath, entry.name))
      .sort();
  } catch {
    return [];
  }
}

export async function getPersistedSubmissionArtifact(
  applicationId: string,
  type: SubmissionArtifactKind
) {
  const files = await listSubmissionArtifactFiles(applicationId, type);
  return files[0] ?? null;
}

export async function prepareHrWorkspace(applicationId: string, stage: string) {
  const workspaceRoot = getHrWorkspaceRoot(applicationId, stage);
  await rm(workspaceRoot, { recursive: true, force: true });
  await ensureHrDirectory(workspaceRoot);
  return workspaceRoot;
}

export async function resolveWorkspaceRoot(extractedRoot: string) {
  const entries = await readdir(extractedRoot, { withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile());
  const dirs = entries.filter((entry) => entry.isDirectory());

  if (files.length === 0 && dirs.length === 1) {
    return path.join(extractedRoot, dirs[0]!.name);
  }

  return extractedRoot;
}

export async function collectWorkspaceFiles(rootPath: string, limit = 4000) {
  const results: string[] = [];

  async function walk(currentPath: string) {
    if (results.length >= limit) {
      return;
    }

    const entries = await readdir(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      if (results.length >= limit) {
        return;
      }

      const absolutePath = path.join(currentPath, entry.name);
      const relativePath = path
        .relative(rootPath, absolutePath)
        .split(path.sep)
        .join("/");

      if (entry.isDirectory()) {
        await walk(absolutePath);
      } else if (entry.isFile()) {
        results.push(relativePath);
      }
    }
  }

  if (await fileExists(rootPath)) {
    await walk(rootPath);
  }

  return results;
}

export async function readTextPreview(filePath: string, maxBytes = 24_000) {
  const fileStat = await stat(filePath).catch(() => null);

  if (!fileStat || !fileStat.isFile()) {
    return null;
  }

  const textLikeExtensions = new Set([
    ".cjs",
    ".csv",
    ".env",
    ".js",
    ".json",
    ".jsx",
    ".md",
    ".mjs",
    ".py",
    ".rb",
    ".sh",
    ".sql",
    ".text",
    ".toml",
    ".ts",
    ".tsx",
    ".txt",
    ".yaml",
    ".yml",
  ]);
  const extension = path.extname(filePath).toLowerCase();

  if (!textLikeExtensions.has(extension) && fileStat.size > maxBytes) {
    return null;
  }

  const contents = await readFile(filePath);
  const preview = contents.subarray(0, maxBytes).toString("utf8");

  return preview.replace(/\u0000/g, "");
}

export async function hashFile(filePath: string) {
  const buffer = await readFile(filePath);
  return createHash("sha256").update(buffer).digest("hex");
}

export async function runHrCommand(input: {
  command: string;
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  onStderrChunk?: (chunk: string) => void;
  onStdoutChunk?: (chunk: string) => void;
  timeoutMs?: number;
  stdin?: string;
}) {
  const {
    command,
    args = [],
    cwd,
    env,
    onStderrChunk,
    onStdoutChunk,
    timeoutMs = 15_000,
    stdin,
  } = input;

  return await new Promise<HrCommandResult>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      child.kill("SIGKILL");
      const error = new Error(
        `Command timed out after ${timeoutMs}ms: ${command}`
      ) as HrCommandError;

      error.exitCode = 124;
      error.stderr = stderr;
      error.stdout = stdout;
      error.timedOut = true;
      reject(error);
    }, timeoutMs);

    const append = (target: "stdout" | "stderr", chunk: Buffer | string) => {
      const value = chunk.toString();

      if (target === "stdout") {
        try {
          onStdoutChunk?.(value);
        } catch (error) {
          console.warn("Ignoring stdout streaming callback error.", error);
        }

        stdout = `${stdout}${value}`.slice(-MAX_COMMAND_OUTPUT_BYTES);
      } else {
        try {
          onStderrChunk?.(value);
        } catch (error) {
          console.warn("Ignoring stderr streaming callback error.", error);
        }

        stderr = `${stderr}${value}`.slice(-MAX_COMMAND_OUTPUT_BYTES);
      }
    };

    child.stdout.on("data", (chunk) => append("stdout", chunk));
    child.stderr.on("data", (chunk) => append("stderr", chunk));
    child.on("error", (error) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (exitCode) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      resolve({
        stdout,
        stderr,
        exitCode: exitCode ?? 0,
      });
    });

    if (stdin) {
      child.stdin.write(stdin);
    }

    child.stdin.end();
  });
}
