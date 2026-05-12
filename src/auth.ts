import "server-only";

import type { NextAuthOptions } from "next-auth";
import { getServerSession } from "next-auth";
import GitHubProvider from "next-auth/providers/github";
import { prisma } from "@/lib/prisma";
import { getSubmissionAuthSecret } from "@/lib/submissions/auth-secret";
import { encryptSecretValue } from "@/lib/submissions/crypto";
import { ensureSubmissionSchema } from "@/lib/submissions/schema";

type GithubProfile = {
  email?: string | null;
  id?: number | string;
  login?: string | null;
  name?: string | null;
};

function getGithubId(profile: GithubProfile) {
  if (typeof profile.id === "number") {
    return String(profile.id);
  }

  return typeof profile.id === "string" ? profile.id : null;
}

async function upsertSubmissionUserFromGithub(input: {
  accessToken: string | null;
  email: string | null;
  githubId: string;
  githubLogin: string | null;
  name: string | null;
}) {
  await ensureSubmissionSchema();

  const encryptedAccessToken = input.accessToken
    ? encryptSecretValue(input.accessToken)
    : null;

  const existing =
    (await prisma.user.findUnique({
      where: {
        githubId: input.githubId,
      },
    })) ||
    (input.email
      ? await prisma.user.findUnique({
          where: {
            email: input.email,
          },
        })
      : null);

  if (existing) {
    return prisma.user.update({
      where: {
        id: existing.id,
      },
      data: {
        accessToken: encryptedAccessToken ?? existing.accessToken,
        email: input.email ?? existing.email,
        githubId: input.githubId,
        githubLogin: input.githubLogin ?? existing.githubLogin,
        name: input.name ?? existing.name,
      },
    });
  }

  return prisma.user.create({
    data: {
      accessToken: encryptedAccessToken,
      email: input.email,
      githubId: input.githubId,
      githubLogin: input.githubLogin,
      name: input.name,
    },
  });
}

function isSubmissionSessionDecryptionFailure(metadata: unknown) {
  return (
    typeof metadata === "object" &&
    metadata !== null &&
    "code" in metadata &&
    metadata.code === "ERR_JWE_DECRYPTION_FAILED"
  );
}

export const submissionAuthOptions: NextAuthOptions = {
  secret: getSubmissionAuthSecret() ?? undefined,
  logger: {
    error(code, metadata) {
      if (
        process.env.NODE_ENV !== "production" &&
        !(
          code === "JWT_SESSION_ERROR" &&
          isSubmissionSessionDecryptionFailure(metadata)
        )
      ) {
        console.error("[submission-auth]", code, metadata);
      }
    },
  },
  pages: {
    error: "/",
    signIn: "/",
  },
  session: {
    strategy: "jwt",
  },
  providers: [
    GitHubProvider({
      clientId: process.env.GITHUB_CLIENT_ID ?? "",
      clientSecret: process.env.GITHUB_CLIENT_SECRET ?? "",
      authorization: {
        params: {
          scope: "read:user repo",
        },
      },
    }),
  ],
  callbacks: {
    async jwt({ token, account, profile }) {
      if (account?.provider === "github" && profile) {
        const githubProfile = profile as GithubProfile;
        const githubId = getGithubId(githubProfile);

        if (githubId) {
          try {
            const user = await upsertSubmissionUserFromGithub({
              accessToken:
                typeof account.access_token === "string" ? account.access_token : null,
              email:
                typeof githubProfile.email === "string" && githubProfile.email
                  ? githubProfile.email
                  : token.email ?? null,
              githubId,
              githubLogin:
                typeof githubProfile.login === "string" && githubProfile.login
                  ? githubProfile.login
                  : null,
              name:
                typeof githubProfile.name === "string" && githubProfile.name
                  ? githubProfile.name
                  : token.name ?? null,
            });

            token.githubId = githubId;
            token.githubLogin = user.githubLogin ?? undefined;
            token.submissionUserId = user.id;
          } catch (cause) {
            throw new Error(
              cause instanceof Error
                ? `Failed to persist the GitHub submission user: ${cause.message}`
                : "Failed to persist the GitHub submission user."
            );
          }
        }
      }

      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.githubId =
          typeof token.githubId === "string" ? token.githubId : undefined;
        session.user.githubLogin =
          typeof token.githubLogin === "string" ? token.githubLogin : undefined;
        session.user.id =
          typeof token.submissionUserId === "string"
            ? token.submissionUserId
            : undefined;
      }

      return session;
    },
  },
};

export function getSubmissionSession() {
  return getServerSession(submissionAuthOptions);
}

export async function getSubmissionSessionSafely() {
  if (!getSubmissionAuthSecret()) {
    return null;
  }

  try {
    return await getSubmissionSession();
  } catch {
    return null;
  }
}
