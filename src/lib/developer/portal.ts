import "server-only";

import { prisma } from "@/lib/prisma";
import { getGithubRepositoryViewUrl } from "@/lib/submissions/github/client";
import { ensureSubmissionSchema } from "@/lib/submissions/schema";
import { selectLatestSubmissionsBySource } from "@/lib/submissions/service";
import { SUBMISSION_STAGE_LABELS, SUBMISSION_STATUS_LABELS } from "@/lib/submissions/constants";

export type DeveloperSubmissionSummary = {
  actionHref: string;
  actionLabel: string;
  agentName: string;
  createdAt: string;
  description: string;
  githubBranch: string | null;
  githubCommitSha: string | null;
  githubRepoFullName: string | null;
  id: string;
  processingError: string | null;
  processingStageLabel: string | null;
  processingStageMessage: string | null;
  sourceViewUrl: string | null;
  status: "SIGNED";
  statusLabel: string;
  updateHref: string;
  updatedAt: string;
};

export type DeveloperRequestAnalyticsPoint = {
  date: string;
  label: string;
  requests: number;
};

export type DeveloperContributionDay = {
  count: number;
  date: string;
};

export type DeveloperPortalData = {
  analytics: {
    contributions: {
      activeDays: number;
      days: DeveloperContributionDay[];
      maxDayCount: number;
      totalEvents: number;
    };
    requests: {
      activeAgentCount: number;
      latestRequestAt: string | null;
      series: DeveloperRequestAnalyticsPoint[];
      totalRequests: number;
    };
  };
  developer: {
    createdAt: string;
    email: string | null;
    githubConnected: boolean;
    githubLogin: string | null;
    id: string;
    name: string;
  };
  latestActivityAt: string | null;
  metrics: {
    activeReviews: number;
    connectedRepos: number;
    readyForReview: number;
    signed: number;
    totalSubmissions: number;
  };
  submissions: DeveloperSubmissionSummary[];
};

function buildSubmissionAction(id: string) {
  return {
    actionHref: `/developer/applications/${id}`,
    actionLabel: "Open submission",
  };
}

function buildSubmissionUpdateHref(input: {
  githubBranch: string | null;
  githubCommitSha: string | null;
  githubRepoFullName: string | null;
  id: string;
}) {
  void input;

  return "/contact";
}

function buildSubmissionTitle(input: {
  agentName: string | null;
  githubRepoFullName: string | null;
  id: string;
}) {
  const explicitName = input.agentName?.trim();

  if (explicitName) {
    return explicitName;
  }

  if (input.githubRepoFullName) {
    const segments = input.githubRepoFullName.split("/").filter(Boolean);
    return segments.at(-1) ?? input.githubRepoFullName;
  }

  return `Submission ${input.id.slice(0, 8)}`;
}

function startOfUtcDay(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function addUtcDays(value: Date, days: number) {
  const next = new Date(value);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function startOfUtcWeek(value: Date) {
  return addUtcDays(startOfUtcDay(value), -startOfUtcDay(value).getUTCDay());
}

function endOfUtcWeek(value: Date) {
  return addUtcDays(startOfUtcWeek(value), 6);
}

function formatIsoDay(value: Date) {
  return value.toISOString().slice(0, 10);
}

function formatShortDateLabel(value: Date) {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
  }).format(value);
}

function buildZeroRequestSeries(dayCount: number): DeveloperRequestAnalyticsPoint[] {
  const end = startOfUtcDay(new Date());
  const start = addUtcDays(end, -(dayCount - 1));

  return Array.from({ length: dayCount }, (_, index) => {
    const day = addUtcDays(start, index);
    return {
      date: formatIsoDay(day),
      label: formatShortDateLabel(day),
      requests: 0,
    };
  });
}

function buildContributionDays(
  submissions: Array<{
    createdAt: Date;
    updatedAt: Date;
  }>
) {
  const activityByDay = new Map<string, number>();

  for (const submission of submissions) {
    const touchedDays = new Set([
      formatIsoDay(startOfUtcDay(submission.createdAt)),
      formatIsoDay(startOfUtcDay(submission.updatedAt)),
    ]);

    for (const day of touchedDays) {
      activityByDay.set(day, (activityByDay.get(day) ?? 0) + 1);
    }
  }

  const today = startOfUtcDay(new Date());
  const end = endOfUtcWeek(today);
  const start = startOfUtcWeek(addUtcDays(today, -364));
  const days: DeveloperContributionDay[] = [];
  let activeDays = 0;
  let maxDayCount = 0;
  let totalEvents = 0;

  for (let cursor = start; cursor <= end; cursor = addUtcDays(cursor, 1)) {
    const count = activityByDay.get(formatIsoDay(cursor)) ?? 0;

    if (count > 0) {
      activeDays += 1;
    }

    maxDayCount = Math.max(maxDayCount, count);
    totalEvents += count;
    days.push({
      count,
      date: formatIsoDay(cursor),
    });
  }

  return {
    activeDays,
    days,
    maxDayCount,
    totalEvents,
  };
}

export async function getDeveloperPortalData(userId: string): Promise<DeveloperPortalData | null> {
  if (!process.env.DATABASE_URL?.trim()) {
    return null;
  }

  await ensureSubmissionSchema();

  const [user, submissions] = await Promise.all([
    prisma.user.findUnique({
      where: {
        id: userId,
      },
    }),
    prisma.submission.findMany({
      where: {
        userId,
      },
      orderBy: {
        updatedAt: "desc",
      },
    }),
  ]);

  if (!user) {
    return null;
  }

  const latestSubmissions = selectLatestSubmissionsBySource(submissions);
  const signedSubmissions = selectLatestSubmissionsBySource(
    submissions.filter((submission) => submission.status === "SIGNED")
  );

  const submissionSummaries = signedSubmissions.map((submission) => {
    const action = buildSubmissionAction(submission.id);

    return {
      ...action,
      agentName: buildSubmissionTitle({
        agentName: submission.agentName,
        githubRepoFullName: submission.githubRepoFullName,
        id: submission.id,
      }),
      createdAt: submission.createdAt.toISOString(),
      description: submission.description,
      githubBranch: submission.githubBranch,
      githubCommitSha: submission.githubCommitSha,
      githubRepoFullName: submission.githubRepoFullName,
      id: submission.id,
      processingError: submission.processingError,
      processingStageLabel: submission.processingStage
        ? SUBMISSION_STAGE_LABELS[submission.processingStage]
        : null,
      processingStageMessage: submission.processingStageMessage,
      sourceViewUrl: submission.githubRepoFullName
        ? getGithubRepositoryViewUrl(
            submission.githubRepoFullName,
            submission.githubCommitSha
          )
        : null,
      status: "SIGNED",
      statusLabel: SUBMISSION_STATUS_LABELS[submission.status],
      updateHref: buildSubmissionUpdateHref({
        githubBranch: submission.githubBranch,
        githubCommitSha: submission.githubCommitSha,
        githubRepoFullName: submission.githubRepoFullName,
        id: submission.id,
      }),
      updatedAt: submission.updatedAt.toISOString(),
    } satisfies DeveloperSubmissionSummary;
  });

  return {
    developer: {
      createdAt: user.createdAt.toISOString(),
      email: user.email,
      githubConnected: Boolean(user.githubLogin),
      githubLogin: user.githubLogin,
      id: user.id,
      name: user.name?.trim() || user.githubLogin || "Developer",
    },
    latestActivityAt: latestSubmissions[0]?.updatedAt.toISOString() ?? null,
    metrics: {
      activeReviews: latestSubmissions.filter(
        (submission) =>
          submission.status === "CREATED" || submission.status === "PROCESSING"
      ).length,
      connectedRepos: new Set(
        submissions
          .map((submission) => submission.githubRepoFullName)
          .filter((value): value is string => Boolean(value))
      ).size,
      readyForReview: latestSubmissions.filter(
        (submission) => submission.status === "READY_FOR_REVIEW"
      ).length,
      signed: signedSubmissions.length,
      totalSubmissions: latestSubmissions.length,
    },
    analytics: {
      contributions: buildContributionDays(latestSubmissions),
      requests: {
        activeAgentCount: signedSubmissions.length,
        latestRequestAt: null,
        series: buildZeroRequestSeries(90),
        totalRequests: 0,
      },
    },
    submissions: submissionSummaries,
  };
}
