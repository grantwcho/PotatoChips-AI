import "server-only";

import { cookies } from "next/headers";
import {
  DEV_DASHBOARD_BYPASS_COOKIE_NAME,
  SESSION_COOKIE_NAME,
} from "@/lib/auth/constants";
import { verifyClientSessionCookie } from "@/lib/auth/provider/server";
import {
  DEFAULT_USER_ROLE,
  type AppUser,
  type AuthIdentityClaims,
} from "@/lib/auth/types";
import { getUserRepository } from "@/lib/data/users/repository";

const DEV_DASHBOARD_BYPASS_DEFAULT_EMAIL = "local-customer@potatochipsai.dev";
const DEV_DASHBOARD_BYPASS_DEFAULT_ID = "dev-local-customer";
const DEV_DASHBOARD_BYPASS_DEFAULT_NAME = "Local Customer";

export function isDevDashboardBypassEnabled() {
  return (
    process.env.NODE_ENV === "development" &&
    process.env.DEV_DASHBOARD_BYPASS === "true"
  );
}

function getDevDashboardBypassUser(): AppUser {
  const email =
    process.env.DEV_DASHBOARD_BYPASS_EMAIL?.trim().toLowerCase() ||
    DEV_DASHBOARD_BYPASS_DEFAULT_EMAIL;
  const name =
    process.env.DEV_DASHBOARD_BYPASS_NAME?.trim() ||
    DEV_DASHBOARD_BYPASS_DEFAULT_NAME;
  const id =
    process.env.DEV_DASHBOARD_BYPASS_ID?.trim() ||
    DEV_DASHBOARD_BYPASS_DEFAULT_ID;

  return {
    id,
    email,
    name,
    image: null,
    role: DEFAULT_USER_ROLE,
  };
}

export async function verifyCurrentSession() {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!sessionCookie) {
    return null;
  }

  return verifyClientSessionCookie(sessionCookie);
}

export async function hasDevDashboardBypassSession() {
  if (!isDevDashboardBypassEnabled()) {
    return false;
  }

  const cookieStore = await cookies();

  return cookieStore.get(DEV_DASHBOARD_BYPASS_COOKIE_NAME)?.value === "true";
}

export async function upsertIdentityUser(
  claims: AuthIdentityClaims
): Promise<AppUser> {
  return getUserRepository().syncIdentityUser(claims);
}

export async function getCurrentAppUser(): Promise<AppUser | null> {
  const decodedSession = await verifyCurrentSession();

  if (!decodedSession?.email) {
    return (await hasDevDashboardBypassSession()) ? getDevDashboardBypassUser() : null;
  }

  return upsertIdentityUser(decodedSession);
}
