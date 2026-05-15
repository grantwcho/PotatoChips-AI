import "server-only";

import {
  access,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_STORAGE_BASE_PATH,
  DOCS_ROOT_RELATIVE_PATH,
  INCOMING_ROOT_RELATIVE_PATH,
  SOURCE_ROOT_RELATIVE_PATH,
} from "@/lib/submissions/constants";
import type { StorageAdapter, SubmissionPaths } from "@/lib/submissions/storage/adapter";

function resolveStorageRoot() {
  const configured = process.env.STORAGE_BASE_PATH?.trim();

  if (!configured) {
    return DEFAULT_STORAGE_BASE_PATH;
  }

  return path.isAbsolute(configured)
    ? path.join(configured, "submissions")
    : path.resolve(process.cwd(), configured, "submissions");
}

function normalizeRelativePath(relativePath: string) {
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");

  if (!normalized || normalized.includes("../")) {
    throw new Error(`Unsafe submission artifact path: ${relativePath}`);
  }

  return normalized;
}

export class LocalStorageAdapter implements StorageAdapter {
  constructor(private readonly rootPath = resolveStorageRoot()) {}

  async ensureSubmissionPaths(submissionId: string): Promise<SubmissionPaths> {
    const rootPath = path.join(this.rootPath, submissionId);
    const sourcePath = path.join(rootPath, SOURCE_ROOT_RELATIVE_PATH);
    const docsPath = path.join(rootPath, DOCS_ROOT_RELATIVE_PATH);
    const incomingPath = path.join(rootPath, INCOMING_ROOT_RELATIVE_PATH);
    const artifactsPath = path.join(rootPath, "artifacts");

    await Promise.all(
      [rootPath, sourcePath, docsPath, incomingPath, artifactsPath].map((dirPath) =>
        mkdir(dirPath, { recursive: true })
      )
    );

    return {
      artifactsPath,
      docsPath,
      incomingPath,
      rootPath,
      sourcePath,
    };
  }

  async fileExists(submissionId: string, relativePath: string) {
    try {
      await access(this.resolveSubmissionAbsolutePath(submissionId, relativePath));
      return true;
    } catch {
      return false;
    }
  }

  async readJson<T>(submissionId: string, relativePath: string) {
    const content = await this.readText(submissionId, relativePath);

    if (!content) {
      return null;
    }

    return JSON.parse(content) as T;
  }

  async readText(submissionId: string, relativePath: string) {
    try {
      return await readFile(
        this.resolveSubmissionAbsolutePath(submissionId, relativePath),
        "utf8"
      );
    } catch {
      return null;
    }
  }

  async removeSubmission(submissionId: string) {
    await rm(path.join(this.rootPath, submissionId), {
      force: true,
      recursive: true,
    });
  }

  resolveSubmissionAbsolutePath(submissionId: string, relativePath: string) {
    return path.join(this.rootPath, submissionId, normalizeRelativePath(relativePath));
  }

  async writeBuffer(submissionId: string, relativePath: string, bytes: Buffer) {
    const absolutePath = this.resolveSubmissionAbsolutePath(submissionId, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, bytes);
    return absolutePath;
  }

  async writeJson(submissionId: string, relativePath: string, value: unknown) {
    return this.writeText(
      submissionId,
      relativePath,
      `${JSON.stringify(value, null, 2)}\n`
    );
  }

  async writeText(submissionId: string, relativePath: string, value: string) {
    const absolutePath = this.resolveSubmissionAbsolutePath(submissionId, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, value, "utf8");
    return absolutePath;
  }
}

let storageAdapter: StorageAdapter | null = null;

export function getStorageAdapter() {
  if (!storageAdapter) {
    storageAdapter = new LocalStorageAdapter();
  }

  return storageAdapter;
}
