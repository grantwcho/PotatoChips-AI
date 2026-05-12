import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { ClientPortalLoader } from "@/components/portal-loader";
import { getCurrentAppUser } from "@/lib/auth/session";
import { getCurrentDeveloperAccount } from "@/lib/developer/auth";
import { DeveloperShell } from "./shell";

async function DeveloperLayoutContent({
  children,
}: {
  children: React.ReactNode;
}) {
  await connection();

  const [developer, appUser] = await Promise.all([
    getCurrentDeveloperAccount(),
    getCurrentAppUser(),
  ]);

  if (!developer) {
    redirect("/");
  }

  return (
    <DeveloperShell canSwitchToAdmin={Boolean(appUser)}>
      {children}
    </DeveloperShell>
  );
}

export default function DeveloperLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="workspace-portal developer-portal">
      <Suspense fallback={<ClientPortalLoader />}>
        <DeveloperLayoutContent>{children}</DeveloperLayoutContent>
      </Suspense>
    </div>
  );
}
