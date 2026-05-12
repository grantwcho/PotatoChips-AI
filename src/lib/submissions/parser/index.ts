import "server-only";

import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import {
  findSubmissionManifestInWorkspace,
  readTemplateVersionInWorkspace,
} from "@/lib/submissions/manifest";
import type { ParsedSubmission, ParsedSubmissionKeyFile } from "@/lib/submissions/types";

const MAX_FILE_BYTES = 1_000_000;
const MAX_CONTEXT_CHARS = 500_000;
const IGNORED_DIR_NAMES = new Set([
  ".git",
  ".hg",
  ".idea",
  ".mypy_cache",
  ".next",
  ".pytest_cache",
  ".svn",
  ".venv",
  "__pycache__",
  "build",
  "dist",
  "env",
  "node_modules",
  "venv",
]);
const TEXT_FILE_EXTENSIONS = new Set([
  ".cjs",
  ".env",
  ".ipynb",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mjs",
  ".py",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml",
]);
const MANIFEST_ENV_VAR_PATTERN = /\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/g;
const MANIFEST_CREDENTIAL_ENV_PATTERN =
  /(?:API[_-]?KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL|USER_AGENT)$/i;

type CandidateFile = {
  absolutePath: string;
  priority: number;
  relativePath: string;
  size: number;
};

type CandidateFileWithContent = CandidateFile & {
  content: string;
  language: string;
};

function inferLanguageFromPath(filePath: string) {
  const extension = path.extname(filePath).toLowerCase();

  switch (extension) {
    case ".py":
      return "python";
    case ".ts":
    case ".tsx":
      return "typescript";
    case ".js":
    case ".jsx":
    case ".mjs":
    case ".cjs":
      return "javascript";
    case ".md":
      return "markdown";
    case ".json":
      return "json";
    case ".yaml":
    case ".yml":
      return "yaml";
    case ".toml":
      return "toml";
    case ".txt":
      return "text";
    default:
      return "text";
  }
}

function scoreFile(relativePath: string, content?: string) {
  const basename = path.posix.basename(relativePath).toLowerCase();
  const lowerPath = relativePath.toLowerCase();

  if (
    basename === "manifest.yaml" ||
    basename === "manifest.yml" ||
    basename === "manifest.json" ||
    basename === "potato-chips-ai-agent.json" ||
    basename === "agent.json"
  ) {
    return 98;
  }

  if (
    basename === "main.py" ||
    basename === "agent.py" ||
    basename === "strategy.py" ||
    basename === "run.py"
  ) {
    return 100;
  }

  if (content?.includes('__name__ == "__main__"')) {
    return 95;
  }

  if (basename.startsWith("readme")) {
    return 90;
  }

  if (
    basename === "requirements.txt" ||
    basename === "pyproject.toml" ||
    basename === "package.json" ||
    basename === "pipfile"
  ) {
    return 85;
  }

  if (lowerPath.includes("/prompts/") || lowerPath.includes("/templates/")) {
    return 80;
  }

  if (lowerPath.endsWith(".yaml") || lowerPath.endsWith(".yml") || lowerPath.endsWith(".toml")) {
    return 75;
  }

  if (lowerPath.endsWith(".py")) {
    return 70;
  }

  if (lowerPath.endsWith(".ipynb")) {
    return 65;
  }

  if (TEXT_FILE_EXTENSIONS.has(path.extname(lowerPath))) {
    return 50;
  }

  return 10;
}

function extractUrls(content: string) {
  return Array.from(
    new Set(content.match(/https?:\/\/[^\s)"'`<>]+/g) ?? [])
  ).sort();
}

function extractEnvVars(content: string) {
  const matches = new Set<string>();

  for (const match of content.matchAll(
    /\b(?:process\.env|os\.getenv|getenv|ENV|get_env)\s*(?:\[|\()\s*["']([A-Z0-9_]+)["']/g
  )) {
    if (match[1]) {
      matches.add(match[1]);
    }
  }

  for (const match of content.matchAll(/\$\{([A-Z0-9_]+)\}/g)) {
    if (match[1]) {
      matches.add(match[1]);
    }
  }

  return Array.from(matches).sort();
}

function extractEnvVarsFromManifestRaw(value: unknown) {
  const matches = new Set<string>();

  function visit(entry: unknown) {
    if (typeof entry === "string") {
      for (const match of entry.matchAll(MANIFEST_ENV_VAR_PATTERN)) {
        if (match[0] && MANIFEST_CREDENTIAL_ENV_PATTERN.test(match[0])) {
          matches.add(match[0]);
        }
      }

      return;
    }

    if (Array.isArray(entry)) {
      for (const child of entry) {
        visit(child);
      }

      return;
    }

    if (!entry || typeof entry !== "object") {
      return;
    }

    for (const [key, child] of Object.entries(entry)) {
      visit(key);
      visit(child);
    }
  }

  visit(value);
  return Array.from(matches).sort();
}

function extractImports(relativePath: string, content: string) {
  const imports = new Set<string>();
  const extension = path.extname(relativePath).toLowerCase();

  if (extension === ".py" || extension === ".ipynb") {
    for (const match of content.matchAll(
      /^\s*(?:from\s+([a-zA-Z0-9_\.]+)\s+import|import\s+([a-zA-Z0-9_\. ,]+))/gm
    )) {
      const raw = match[1] ?? match[2];

      if (!raw) {
        continue;
      }

      for (const value of raw.split(",")) {
        const normalized = value.trim().split(/\s+/)[0]?.split(".")[0];

        if (normalized) {
          imports.add(normalized);
        }
      }
    }
  }

  if (
    extension === ".js" ||
    extension === ".jsx" ||
    extension === ".ts" ||
    extension === ".tsx" ||
    extension === ".mjs" ||
    extension === ".cjs"
  ) {
    for (const match of content.matchAll(
      /(?:import\s+(?:.+?\s+from\s+)?["']([^"']+)["']|require\(["']([^"']+)["']\))/g
    )) {
      const normalized = (match[1] ?? match[2] ?? "").trim().split("/")[0];

      if (normalized) {
        imports.add(normalized);
      }
    }
  }

  return Array.from(imports).sort();
}

async function readNotebookPreview(filePath: string) {
  const raw = await readFile(filePath, "utf8");
  const notebook = JSON.parse(raw) as {
    cells?: Array<{
      source?: string[] | string;
    }>;
  };
  const cellContents = (notebook.cells ?? [])
    .map((cell) =>
      Array.isArray(cell.source) ? cell.source.join("") : cell.source ?? ""
    )
    .join("\n\n")
    .trim();

  return cellContents.slice(0, MAX_CONTEXT_CHARS);
}

async function readTextCandidate(file: CandidateFile): Promise<CandidateFileWithContent | null> {
  const extension = path.extname(file.relativePath).toLowerCase();

  if (!TEXT_FILE_EXTENSIONS.has(extension)) {
    return null;
  }

  if (file.size > MAX_FILE_BYTES) {
    return null;
  }

  let content =
    extension === ".ipynb"
      ? await readNotebookPreview(file.absolutePath)
      : await readFile(file.absolutePath, "utf8");

  if (!content) {
    return null;
  }

  content = content.slice(0, MAX_CONTEXT_CHARS);

  if (content.includes("\u0000")) {
    return null;
  }

  return {
    ...file,
    content,
    language: extension === ".ipynb" ? "python" : inferLanguageFromPath(file.relativePath),
    priority: scoreFile(file.relativePath, content),
  };
}

async function collectCandidateFiles(rootPath: string) {
  const files: CandidateFile[] = [];

  async function walk(currentPath: string) {
    const entries = await readdir(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const absolutePath = path.join(currentPath, entry.name);
      const relativePath = path
        .relative(rootPath, absolutePath)
        .split(path.sep)
        .join("/");

      if (entry.isDirectory()) {
        if (IGNORED_DIR_NAMES.has(entry.name)) {
          continue;
        }

        await walk(absolutePath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const fileStat = await stat(absolutePath);

      files.push({
        absolutePath,
        priority: scoreFile(relativePath),
        relativePath,
        size: fileStat.size,
      });
    }
  }

  await walk(rootPath);
  return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

function trimKeyFiles(files: CandidateFileWithContent[]) {
  const keyFiles: ParsedSubmissionKeyFile[] = [];
  let remainingBudget = MAX_CONTEXT_CHARS;

  for (const file of files.sort(
    (a, b) => b.priority - a.priority || a.relativePath.localeCompare(b.relativePath)
  )) {
    if (remainingBudget <= 0) {
      break;
    }

    const trimmedContent =
      file.content.length > remainingBudget
        ? file.content.slice(0, remainingBudget)
        : file.content;

    keyFiles.push({
      content: trimmedContent,
      language: file.language,
      path: file.relativePath,
    });

    remainingBudget -= trimmedContent.length;
  }

  return keyFiles;
}

export async function parseSubmissionSource(rootPath: string): Promise<ParsedSubmission> {
  const candidateFiles = await collectCandidateFiles(rootPath);
  const manifest = await findSubmissionManifestInWorkspace(rootPath);
  const templateVersion = await readTemplateVersionInWorkspace(rootPath);
  const textFiles = (
    await Promise.all(candidateFiles.map((file) => readTextCandidate(file)))
  ).filter((file): file is CandidateFileWithContent => Boolean(file));

  const keyFiles = trimKeyFiles(textFiles);
  const imports = new Set<string>();
  const urls = new Set<string>();
  const envVars = new Set<string>();

  for (const file of keyFiles) {
    for (const value of extractImports(file.path, file.content)) {
      imports.add(value);
    }

    for (const value of extractUrls(file.content)) {
      urls.add(value);
    }

    for (const value of extractEnvVars(file.content)) {
      envVars.add(value);
    }
  }

  for (const value of extractEnvVarsFromManifestRaw(manifest?.raw)) {
    envVars.add(value);
  }

  return {
    detectedEnvVars: Array.from(envVars).sort(),
    detectedImports: Array.from(imports).sort(),
    detectedUrls: Array.from(urls).sort(),
    fileTree: candidateFiles.map((file) => file.relativePath),
    keyFiles,
    manifest,
    parsedAt: new Date().toISOString(),
    templateVersion,
  };
}
