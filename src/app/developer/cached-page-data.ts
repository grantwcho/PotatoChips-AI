import { cacheLife } from "next/cache";
import { getDeveloperPortalData } from "@/lib/developer/portal";

export async function getCachedDeveloperPortalData(userId: string) {
  "use cache: private";
  cacheLife({ stale: 30 });

  return getDeveloperPortalData(userId);
}
