import "server-only";

import AdmZip from "adm-zip";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { SUBMISSION_MANIFEST_CANDIDATES } from "@/lib/submissions/manifest";
import { persistSubmissionSourceArchive } from "@/lib/submissions/source-archive";
import { getStorageAdapter } from "@/lib/submissions/storage/local";

type GithubBranchResponse = {
  commit?: {
    sha?: string;
  };
  name?: string;
};

type GithubCommitResponse = {
  author?: {
    avatar_url?: string;
    id?: number;
    login?: string;
  };
  commit?: {
    author?: {
      date?: string;
      email?: string;
      name?: string;
    };
    message?: string;
  };
  sha?: string;
};

type GithubRepoResponse = {
  default_branch?: string;
  description?: string | null;
  full_name?: string;
  html_url?: string;
  owner?: {
    avatar_url?: string;
    login?: string;
  };
  private?: boolean;
  pushed_at?: string;
};

type GithubContentResponse = {
  content?: string;
  encoding?: string;
  path?: string;
  type?: string;
};

const GITHUB_REPOS_PER_PAGE = 100;

export class GithubRepositoryArchiveError extends Error {
  constructor(
    message: string,
    public readonly status = 502
  ) {
    super(message);
    this.name = "GithubRepositoryArchiveError";
  }
}

async function githubRequest<T>(input: {
  accessToken: string;
  path: string;
}) {
  const response = await fetch(`https://api.github.com${input.path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${input.accessToken}`,
      "User-Agent": "Potato Chips AI Submission Intake",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as {
      message?: string;
    };

    throw new Error(payload.message || `GitHub request failed with HTTP ${response.status}.`);
  }

  return (await response.json()) as T;
}

async function githubRequestOptional<T>(input: {
  accessToken: string;
  path: string;
}) {
  const response = await fetch(`https://api.github.com${input.path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${input.accessToken}`,
      "User-Agent": "Potato Chips AI Submission Intake",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    cache: "no-store",
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as {
      message?: string;
    };

    throw new Error(payload.message || `GitHub request failed with HTTP ${response.status}.`);
  }

  return (await response.json()) as T;
}

export async function listGithubRepos(input: {
  accessToken: string;
}) {
  const repos: GithubRepoResponse[] = [];
  let page = 1;

  while (true) {
    const repoPage = await githubRequest<GithubRepoResponse[]>({
      accessToken: input.accessToken,
      path: `/user/repos?sort=updated&direction=desc&page=${page}&per_page=${GITHUB_REPOS_PER_PAGE}&affiliation=owner,collaborator,organization_member`,
    });

    repos.push(...repoPage);

    if (repoPage.length < GITHUB_REPOS_PER_PAGE) {
      break;
    }

    page += 1;
  }

  return repos
    .filter((repo) => typeof repo.full_name === "string")
    .map((repo) => ({
      defaultBranch: repo.default_branch ?? "main",
      description: repo.description ?? null,
      fullName: repo.full_name as string,
      htmlUrl: repo.html_url ?? `https://github.com/${repo.full_name}`,
      isPrivate: Boolean(repo.private),
      ownerAvatarUrl: repo.owner?.avatar_url ?? null,
      ownerLogin: repo.owner?.login ?? null,
      pushedAt: repo.pushed_at ?? null,
    }));
}

export async function listGithubBranches(input: {
  accessToken: string;
  repoFullName: string;
}) {
  const branches = await githubRequest<GithubBranchResponse[]>({
    accessToken: input.accessToken,
    path: `/repos/${input.repoFullName}/branches?per_page=100`,
  });

  return branches
    .filter((branch) => typeof branch.name === "string")
    .map((branch) => ({
      commitSha: branch.commit?.sha ?? null,
      name: branch.name as string,
    }));
}

export async function listGithubCommits(input: {
  accessToken: string;
  branch: string;
  repoFullName: string;
}) {
  const commits = await githubRequest<GithubCommitResponse[]>({
    accessToken: input.accessToken,
    path: `/repos/${input.repoFullName}/commits?sha=${encodeURIComponent(
      input.branch
    )}&per_page=25`,
  });

  return commits
    .filter((commit) => typeof commit.sha === "string")
    .map((commit) => ({
      authorAvatarUrl: commit.author?.avatar_url ?? null,
      authorLogin: commit.author?.login ?? null,
      authoredAt: commit.commit?.author?.date ?? null,
      authorName: commit.commit?.author?.name ?? null,
      message: commit.commit?.message ?? "",
      sha: commit.sha as string,
    }));
}

export async function hasGithubManifest(input: {
  accessToken: string;
  ref: string;
  repoFullName: string;
}) {
  return Boolean(await findGithubManifest(input));
}

export async function findGithubManifest(input: {
  accessToken: string;
  ref: string;
  repoFullName: string;
}) {
  for (const manifestPath of SUBMISSION_MANIFEST_CANDIDATES) {
    const content = await githubRequestOptional<GithubContentResponse>({
      accessToken: input.accessToken,
      path: `/repos/${input.repoFullName}/contents/${manifestPath}?ref=${encodeURIComponent(
        input.ref
      )}`,
    });

    if (content?.type === "file" && content.path === manifestPath) {
      return {
        content:
          content.encoding === "base64" && typeof content.content === "string"
            ? Buffer.from(content.content.replace(/\s/g, ""), "base64").toString("utf8")
            : null,
        path: manifestPath,
      };
    }
  }

  return null;
}

export async function cloneGithubRepository(input: {
  accessToken: string;
  branch: string;
  commitSha: string;
  repoFullName: string;
  submissionId: string;
}) {
  const storage = getStorageAdapter();
  const paths = await storage.ensureSubmissionPaths(input.submissionId);
  const sourcePath = paths.sourcePath;
  const archive = await fetchGithubRepositoryArchive({
    accessToken: input.accessToken,
    commitSha: input.commitSha,
    repoFullName: input.repoFullName,
  });

  await rm(sourcePath, { force: true, recursive: true });
  await mkdir(sourcePath, { recursive: true });

  const fileCount = await extractGithubArchiveToDirectory({
    archive,
    targetDirectory: sourcePath,
  });

  if (fileCount === 0) {
    throw new GithubRepositoryArchiveError(
      `GitHub returned an empty archive for ${input.repoFullName}@${input.commitSha.slice(0, 7)}.`
    );
  }

  await persistSubmissionSourceArchive({
    sourcePath,
    submissionId: input.submissionId,
  });

  return {
    sourcePath,
    viewUrl: `https://github.com/${input.repoFullName}/tree/${input.commitSha}`,
  };
}

export function getGithubRepositoryViewUrl(repoFullName: string, commitSha?: string | null) {
  if (!repoFullName) {
    return null;
  }

  return commitSha
    ? `https://github.com/${repoFullName}/tree/${commitSha}`
    : `https://github.com/${repoFullName}`;
}

async function fetchGithubRepositoryArchive(input: {
  accessToken: string;
  commitSha: string;
  repoFullName: string;
}) {
  const response = await fetch(
    `https://api.github.com/repos/${input.repoFullName}/zipball/${encodeURIComponent(
      input.commitSha
    )}`,
    {
      cache: "no-store",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${input.accessToken}`,
        "User-Agent": "Potato Chips AI Submission Intake",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      redirect: "follow",
    }
  );

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as {
      message?: string;
    };
    const detail =
      payload.message || `GitHub archive request failed with HTTP ${response.status}.`;
    const status =
      response.status === 401 || response.status === 403
        ? 401
        : response.status === 404
          ? 404
          : 502;

    throw new GithubRepositoryArchiveError(
      `Unable to download ${input.repoFullName}@${input.commitSha.slice(
        0,
        7
      )} from GitHub: ${detail}`,
      status
    );
  }

  const bytes = Buffer.from(await response.arrayBuffer());

  if (bytes.byteLength === 0) {
    throw new GithubRepositoryArchiveError(
      `GitHub returned an empty archive for ${input.repoFullName}@${input.commitSha.slice(0, 7)}.`
    );
  }

  return bytes;
}

function normalizeArchiveEntryPath(entryName: string) {
  const normalized = entryName.replace(/\\/g, "/").replace(/^\/+/, "");
  const [, ...withoutRoot] = normalized.split("/");
  const relativePath = withoutRoot.join("/");

  if (!relativePath || relativePath.endsWith("/")) {
    return null;
  }

  if (
    relativePath.includes("../") ||
    relativePath.startsWith("../") ||
    path.posix.isAbsolute(relativePath)
  ) {
    throw new GithubRepositoryArchiveError(
      `GitHub archive contains an unsafe path: ${relativePath}.`,
      400
    );
  }

  return relativePath;
}

async function extractGithubArchiveToDirectory(input: {
  archive: Buffer;
  targetDirectory: string;
}) {
  let zip: AdmZip;

  try {
    zip = new AdmZip(input.archive);
  } catch (error) {
    throw new GithubRepositoryArchiveError(
      error instanceof Error
        ? `GitHub archive could not be opened as a zip file: ${error.message}`
        : "GitHub archive could not be opened as a zip file."
    );
  }

  let fileCount = 0;

  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) {
      continue;
    }

    const relativePath = normalizeArchiveEntryPath(entry.entryName);

    if (!relativePath) {
      continue;
    }

    const targetPath = path.join(input.targetDirectory, relativePath);
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, entry.getData());
    fileCount += 1;
  }

  return fileCount;
}
