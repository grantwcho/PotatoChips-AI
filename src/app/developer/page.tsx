import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getCachedDeveloperPortalData } from "@/app/developer/cached-page-data";
import { DeveloperOverviewAnalytics } from "@/components/developer/overview-analytics";
import { PortalCard, PortalPage, PortalPill } from "@/components/portal-page";
import { getCurrentDeveloperAccount } from "@/lib/developer/auth";

function formatDate(value: string | null) {
  if (!value) {
    return "—";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

export default async function DeveloperOverviewPage() {
  await connection();

  const developer = await getCurrentDeveloperAccount();

  if (!developer) {
    notFound();
  }

  const data = await getCachedDeveloperPortalData(developer.id);

  if (!data) {
    notFound();
  }

  return (
    <PortalPage
      eyebrow="Developer Portal"
      title="Measure how your agents are performing."
      description="This view tracks marketplace usage and contribution history for the agents you've submitted through Potato Chips AI. As those agents graduate into callable runtime, request analytics appear here automatically alongside the contribution footprint of your connected repositories."
    >
      <div className="flex flex-wrap items-center gap-2">
        <PortalPill>
          GitHub {data.developer.githubLogin ? `@${data.developer.githubLogin}` : "connected"}
        </PortalPill>
        <PortalPill>Developer since {formatDate(data.developer.createdAt)}</PortalPill>
        <PortalPill>Latest activity {formatDate(data.latestActivityAt)}</PortalPill>
      </div>

      <DeveloperOverviewAnalytics
        analytics={data.analytics}
        latestActivityAt={data.latestActivityAt}
      />

      <PortalCard>
        <div className="flex flex-wrap items-center gap-4 px-5 py-4 text-[10px] font-medium uppercase tracking-[0.16em] text-muted">
          <Link
            href="/developer/applications"
            className="transition-colors hover:text-foreground"
          >
            Open applications table
          </Link>
          <Link href="/developer/settings" className="transition-colors hover:text-foreground">
            Open settings
          </Link>
        </div>
      </PortalCard>
    </PortalPage>
  );
}
