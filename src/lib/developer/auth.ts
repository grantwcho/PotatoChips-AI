import "server-only";

import { getSubmissionSessionSafely } from "@/auth";
import { prisma } from "@/lib/prisma";
import { ensureSubmissionSchema } from "@/lib/submissions/schema";

function hasDatabaseUrl() {
  return Boolean(process.env.DATABASE_URL?.trim());
}

export async function getDeveloperSessionSafely() {
  return getSubmissionSessionSafely();
}

export async function getCurrentDeveloperAccount() {
  if (!hasDatabaseUrl()) {
    return null;
  }

  await ensureSubmissionSchema();

  const session = await getDeveloperSessionSafely();
  const userId = session?.user?.id;

  if (!userId) {
    return null;
  }

  return prisma.user.findUnique({
    where: {
      id: userId,
    },
  });
}
