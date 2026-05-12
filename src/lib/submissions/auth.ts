import "server-only";

import { getSubmissionSessionSafely } from "@/auth";
import { prisma } from "@/lib/prisma";
import { decryptSecretValue } from "@/lib/submissions/crypto";
import { ensureSubmissionSchema } from "@/lib/submissions/schema";
import { SubmissionHttpError } from "@/lib/submissions/service";

export async function getCurrentSubmissionUser() {
  await ensureSubmissionSchema();

  const session = await getSubmissionSessionSafely();
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

export async function requireGithubAccessTokenForCurrentUser() {
  const user = await getCurrentSubmissionUser();

  if (!user?.accessToken) {
    throw new SubmissionHttpError("GitHub authentication is required.", 401);
  }

  const accessToken = decryptSecretValue(user.accessToken);

  if (!accessToken) {
    throw new SubmissionHttpError("GitHub authentication is required.", 401);
  }

  return {
    accessToken,
    user,
  };
}
