import "server-only";

import {
  getHrWorkerSecret,
  getHrWorkerSecretConfigError,
} from "@/lib/hr-agent/runtime-config";

export { getHrWorkerSecretConfigError };

export function isAuthorizedHrWorkerRequest(request: Request) {
  const configuredSecret = getHrWorkerSecret();

  if (!configuredSecret) {
    return false;
  }

  const url = new URL(request.url);
  const querySecret = url.searchParams.get("key")?.trim();
  const headerSecret = request.headers.get("x-hr-agent-worker-secret")?.trim();
  const authHeader = request.headers.get("authorization")?.trim();
  const bearerSecret =
    authHeader?.toLowerCase().startsWith("bearer ")
      ? authHeader.slice("bearer ".length).trim()
      : null;

  return [querySecret, headerSecret, bearerSecret].some(
    (candidate) => candidate === configuredSecret
  );
}
