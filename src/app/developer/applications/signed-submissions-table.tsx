"use client";

import { type KeyboardEvent, type MouseEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type SignedSubmissionRow = {
  actionHref: string;
  agentName: string;
  createdAt: string;
  githubBranch: string | null;
  githubCommitSha: string | null;
  githubRepoFullName: string | null;
  id: string;
  processingError: string | null;
  processingStageMessage: string | null;
  status: string;
  statusLabel: string;
  updateHref: string;
  updatedAt: string;
};

type SignedSubmissionsTableProps = {
  submissions: SignedSubmissionRow[];
};

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function statusClass(status: string) {
  void status;
  return "text-green-700";
}

export function SignedSubmissionsTable({ submissions }: SignedSubmissionsTableProps) {
  const router = useRouter();

  function openSubmission(href: string, event: MouseEvent<HTMLTableRowElement>) {
    if (event.metaKey || event.ctrlKey || event.shiftKey) {
      window.open(href, "_blank", "noopener,noreferrer");
      return;
    }

    router.push(href);
  }

  function openSubmissionFromKeyboard(href: string, event: KeyboardEvent<HTMLTableRowElement>) {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    event.preventDefault();
    router.push(href);
  }

  return (
    <div className="portal-card-surface overflow-hidden rounded-xl border">
      <table className="min-w-full table-fixed border-collapse text-left">
        <thead>
          <tr className="portal-card-divider border-b bg-black/[0.02] dark:bg-white/[0.03]">
            <th className="w-[20%] px-5 py-3 text-[10px] font-medium uppercase tracking-[0.16em] text-muted">
              Agent
            </th>
            <th className="w-[28%] px-5 py-3 text-[10px] font-medium uppercase tracking-[0.16em] text-muted">
              Source
            </th>
            <th className="w-[18%] px-5 py-3 text-[10px] font-medium uppercase tracking-[0.16em] text-muted">
              Submitted
            </th>
            <th className="w-[16%] px-5 py-3 text-[10px] font-medium uppercase tracking-[0.16em] text-muted">
              Status
            </th>
            <th className="w-[18%] px-5 py-3 text-[10px] font-medium uppercase tracking-[0.16em] text-muted">
              Details
            </th>
          </tr>
        </thead>
        <tbody>
          {submissions.map((submission) => (
            <tr
              key={submission.id}
              aria-label={`Open submission ${submission.agentName}`}
              className="portal-card-divider cursor-pointer border-b transition-colors hover:bg-black/[0.035] focus:bg-black/[0.035] focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-black/25 last:border-b-0 dark:hover:bg-white/[0.035] dark:focus:bg-white/[0.035] dark:focus-visible:outline-white/25"
              onClick={(event) => openSubmission(submission.actionHref, event)}
              onKeyDown={(event) => openSubmissionFromKeyboard(submission.actionHref, event)}
              role="link"
              tabIndex={0}
            >
              <td className="px-5 py-4 align-middle">
                <div className="space-y-1">
                  <p className="text-base font-medium text-foreground">{submission.agentName}</p>
                  <p className="text-xs text-muted">Submission ID {submission.id}</p>
                </div>
              </td>
              <td className="px-5 py-4 align-middle text-sm text-foreground">
                <div className="space-y-2">
                  <p className="break-all leading-6">
                    {submission.githubRepoFullName ?? "Manual submission"}
                  </p>
                  <div className="flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.12em] text-muted">
                    <span className="rounded bg-black/[0.04] px-2 py-1 normal-case tracking-normal">
                      {submission.githubBranch ?? "No branch"}
                    </span>
                    <span className="dashboard-numeric rounded bg-black/[0.04] px-2 py-1 tracking-normal">
                      {submission.githubCommitSha ? submission.githubCommitSha.slice(0, 7) : "-"}
                    </span>
                  </div>
                </div>
              </td>
              <td className="px-5 py-4 align-middle text-sm text-foreground">
                <div className="space-y-1">
                  <p className="dashboard-numeric whitespace-nowrap">
                    {formatDateTime(submission.createdAt)}
                  </p>
                  <p className="dashboard-numeric whitespace-nowrap text-xs text-muted">
                    Updated {formatDateTime(submission.updatedAt)}
                  </p>
                </div>
              </td>
              <td className="px-5 py-4 align-middle">
                <div className="space-y-2">
                  <span
                    className={`text-[10px] font-medium uppercase tracking-[0.12em] ${statusClass(
                      submission.status
                    )}`}
                  >
                    {submission.statusLabel}
                  </span>
                  <p className="text-sm leading-6 text-foreground">
                    {submission.processingStageMessage ?? "Signed and recorded"}
                  </p>
                </div>
              </td>
              <td className="px-5 py-4 align-middle">
                <div className="space-y-3">
                  <p className="text-sm leading-6 text-muted">
                    {submission.processingError ??
                      "This is the current signed version for this source."}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Link
                      href={submission.updateHref}
                      onClick={(event) => event.stopPropagation()}
                      className="rounded-full border border-black/10 px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-foreground transition-colors hover:border-black/30 hover:bg-black/[0.03]"
                    >
                      Contact
                    </Link>
                    <Link
                      href={submission.actionHref}
                      onClick={(event) => event.stopPropagation()}
                      className="rounded-full bg-foreground px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-background transition-opacity hover:opacity-85"
                    >
                      Open
                    </Link>
                  </div>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
