import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getCachedDeveloperPortalData } from "@/app/developer/cached-page-data";
import { PortalCard, PortalPage } from "@/components/portal-page";
import { getCurrentDeveloperAccount } from "@/lib/developer/auth";
import { SignedSubmissionsTable } from "./signed-submissions-table";

export default async function DeveloperApplicationsPage() {
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
      title="Signed submissions"
      description="Latest signed version per source. Contact the team to discuss changes to agent records."
      action={
        <Link
          href="/contact"
          className="rounded-full bg-foreground px-4 py-2 text-[11px] font-medium uppercase tracking-[0.16em] text-background transition-opacity hover:opacity-90"
        >
          Contact us
        </Link>
      }
    >

      {data.submissions.length === 0 ? (
        <PortalCard>
          <div className="px-5 py-8 text-sm text-muted">
            No signed submissions yet. Once a GitHub submission clears intake and is fully signed,
            it will show up here.{" "}
            <Link href="/contact" className="text-foreground underline underline-offset-2">
              Contact us
            </Link>
            .
          </div>
        </PortalCard>
      ) : (
        <SignedSubmissionsTable submissions={data.submissions} />
      )}
    </PortalPage>
  );
}
