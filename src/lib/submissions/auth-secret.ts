import "server-only";

const LOCAL_SUBMISSION_AUTH_FALLBACK_SECRET =
  "potato-chips-ai-local-submission-auth-secret";

export function getSubmissionAuthSecret() {
  const explicitSecret =
    process.env.NEXTAUTH_SECRET?.trim() || process.env.AUTH_SECRET?.trim();

  if (explicitSecret) {
    return explicitSecret;
  }

  if (process.env.NODE_ENV === "development") {
    // Keep local JWT/session encryption stable across dev restarts when no
    // explicit secret is configured, so stale cookies do not constantly break.
    return LOCAL_SUBMISSION_AUTH_FALLBACK_SECRET;
  }

  return null;
}

export function hasSubmissionAuthSecret() {
  return getSubmissionAuthSecret() !== null;
}
