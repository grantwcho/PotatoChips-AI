import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ThemeToggle } from "@/components/theme-toggle";
import { DeveloperLogoutButton } from "@/components/developer/logout-button";
import {
  PortalActionRow,
  PortalCard,
  PortalInfoRow,
  PortalPage,
} from "@/components/portal-page";
import { getCachedDeveloperPortalData } from "@/app/developer/cached-page-data";
import { getCurrentDeveloperAccount } from "@/lib/developer/auth";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

export default async function DeveloperSettingsPage() {
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
      title="Settings"
      description="Manage your developer identity, portal preferences, and submission defaults."
      width="settings"
    >
      <PortalCard
        title="Developer Account"
        description="The identity used for developer submissions and portal access."
      >
        <PortalInfoRow label="Display name" value={data.developer.name} />
        <PortalInfoRow
          label="GitHub handle"
          value={data.developer.githubLogin ? `@${data.developer.githubLogin}` : "—"}
        />
        <PortalInfoRow label="Email" value={data.developer.email ?? "—"} />
        <PortalInfoRow
          label="Member since"
          value={formatDate(data.developer.createdAt)}
        />
        <PortalInfoRow
          label="GitHub status"
          value={data.developer.githubConnected ? "Connected" : "Reconnect required"}
        />
      </PortalCard>

      <PortalCard title="Portal Preferences">
        <PortalActionRow
          label="App appearance"
          detail="Choose how the developer portal looks on this device."
          action={<ThemeToggle />}
        />
        <PortalActionRow
          label="Session"
          detail="Sign out of your GitHub-backed developer account from here."
          action={
            <DeveloperLogoutButton className="rounded-md border border-black/10 px-3 py-1.5 text-[10px] tracking-[0.16em] hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5" />
          }
        />
      </PortalCard>

      <PortalCard title="Submission Defaults">
        <PortalActionRow
          label="Submission identity"
          detail="Your GitHub login is the account identity for developer records. Contact Potato Chips AI to attach or update repositories in your Applications tab."
          action={
            <Link
              href="/contact"
              className="inline-flex rounded-md border border-black/10 px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.16em] text-muted transition-colors hover:bg-black/5 hover:text-foreground dark:border-white/10 dark:hover:bg-white/5"
            >
              Contact us
            </Link>
          }
        />
      </PortalCard>

      <PortalCard title="Portal Snapshot">
        <PortalInfoRow
          label="Tracked submissions"
          value={String(data.metrics.totalSubmissions)}
        />
        <PortalInfoRow
          label="Active reviews"
          value={String(data.metrics.activeReviews)}
        />
        <PortalInfoRow label="Signed records" value={String(data.metrics.signed)} />
        <PortalInfoRow
          label="Connected repositories"
          value={String(data.metrics.connectedRepos)}
        />
      </PortalCard>
    </PortalPage>
  );
}
