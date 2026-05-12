import "server-only";

const WORKER_SECRET_ENV = "AGENT_WORKER_SECRET";

export function getWorkerSecret() {
  return process.env[WORKER_SECRET_ENV]?.trim() ?? "";
}

export function getWorkerSecretConfigError() {
  return getWorkerSecret().length === 0
    ? `Missing ${WORKER_SECRET_ENV}. Set it before enabling the unattended agent worker.`
    : null;
}

export function isAuthorizedWorkerRequest(request: Request) {
  const configuredSecret = getWorkerSecret();

  if (!configuredSecret) {
    return false;
  }

  const url = new URL(request.url);
  const querySecret = url.searchParams.get("key")?.trim();
  const headerSecret = request.headers.get("x-agent-worker-secret")?.trim();
  const authHeader = request.headers.get("authorization")?.trim();
  const bearerSecret =
    authHeader?.toLowerCase().startsWith("bearer ")
      ? authHeader.slice("bearer ".length).trim()
      : null;

  return [querySecret, headerSecret, bearerSecret].some(
    (candidate) => candidate === configuredSecret
  );
}
