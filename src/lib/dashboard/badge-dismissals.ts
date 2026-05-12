import type { DashboardSummaryData } from "@/lib/dashboard/types";

export const DASHBOARD_BADGE_DISMISSALS_STORAGE_KEY =
  "potato-chips-ai-dashboard-badge-dismissals";

export type DashboardBadgeHref = "/dashboard/alerts" | "/dashboard/submissions";

export type DashboardBadgeDismissals = Partial<Record<DashboardBadgeHref, number>>;

export const DASHBOARD_BADGE_HREFS = [
  "/dashboard/alerts",
  "/dashboard/submissions",
] as const satisfies readonly DashboardBadgeHref[];

const dashboardBadgeHrefSet = new Set<string>(DASHBOARD_BADGE_HREFS);

export function isDashboardBadgeHref(href: string): href is DashboardBadgeHref {
  return dashboardBadgeHrefSet.has(href);
}

export function isDashboardBadgePathActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function getDashboardBadgeCountForHref(
  href: DashboardBadgeHref,
  summary: DashboardSummaryData
) {
  switch (href) {
    case "/dashboard/alerts":
      return summary.recentAlerts;
    case "/dashboard/submissions":
      return summary.recruitingPipelineCount;
  }
}

export function getUnreadDashboardBadgeCount(
  dismissals: DashboardBadgeDismissals,
  href: DashboardBadgeHref,
  summary: DashboardSummaryData
) {
  const badgeCount = getDashboardBadgeCountForHref(href, summary);

  return Math.max(0, badgeCount - (dismissals[href] ?? 0));
}

function updateDismissalCount(
  dismissals: DashboardBadgeDismissals,
  href: DashboardBadgeHref,
  count: number
) {
  if ((dismissals[href] ?? 0) === count) {
    return dismissals;
  }

  return {
    ...dismissals,
    [href]: count,
  };
}

export function markViewedDashboardBadgesForPath(
  dismissals: DashboardBadgeDismissals,
  pathname: string,
  summary: DashboardSummaryData
) {
  let nextDismissals = dismissals;

  for (const href of DASHBOARD_BADGE_HREFS) {
    const badgeCount = getDashboardBadgeCountForHref(href, summary);
    const dismissedCount = nextDismissals[href] ?? 0;

    if (isDashboardBadgePathActive(pathname, href) || dismissedCount > badgeCount) {
      nextDismissals = updateDismissalCount(nextDismissals, href, badgeCount);
    }
  }

  return nextDismissals;
}

export function markDashboardNavigationBadgeViewed(
  dismissals: DashboardBadgeDismissals,
  href: string,
  pathname: string,
  summary: DashboardSummaryData
) {
  let nextDismissals = markViewedDashboardBadgesForPath(
    dismissals,
    pathname,
    summary
  );

  if (isDashboardBadgeHref(href)) {
    nextDismissals = updateDismissalCount(
      nextDismissals,
      href,
      getDashboardBadgeCountForHref(href, summary)
    );
  }

  return nextDismissals;
}

export function parseDashboardBadgeDismissals(
  raw: string | null | undefined
): DashboardBadgeDismissals {
  if (!raw) {
    return {} satisfies DashboardBadgeDismissals;
  }

  try {
    const parsed = JSON.parse(decodeURIComponent(raw)) as Record<string, unknown>;

    return {
      "/dashboard/alerts":
        typeof parsed["/dashboard/alerts"] === "number" ? parsed["/dashboard/alerts"] : undefined,
      "/dashboard/submissions":
        typeof parsed["/dashboard/submissions"] === "number"
          ? parsed["/dashboard/submissions"]
          : undefined,
    } satisfies DashboardBadgeDismissals;
  } catch {
    return {} satisfies DashboardBadgeDismissals;
  }
}

export function serializeDashboardBadgeDismissals(
  value: DashboardBadgeDismissals
): string {
  return JSON.stringify(value);
}
