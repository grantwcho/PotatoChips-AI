import "server-only";

function getPositiveIntegerEnv(name: string, fallback: number) {
  const parsed = Number(process.env[name] ?? "");

  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }

  return Math.floor(parsed);
}

export function getHrWorkerSecret() {
  return (
    process.env.HR_AGENT_WORKER_SECRET?.trim() ??
    process.env.AGENT_WORKER_SECRET?.trim() ??
    ""
  );
}

export function getHrWorkerSecretConfigError() {
  return getHrWorkerSecret().length === 0
    ? "Missing HR_AGENT_WORKER_SECRET (or AGENT_WORKER_SECRET fallback)."
    : null;
}

export function getHrQueueName() {
  return process.env.CLOUD_TASKS_HR_QUEUE?.trim() ?? "";
}

export function getHrStageDelaySeconds() {
  return getPositiveIntegerEnv("HR_AGENT_STAGE_DELAY_SECONDS", 10);
}

export function getHrPollingIntervalSeconds() {
  return Math.max(5, getPositiveIntegerEnv("HR_AGENT_POLL_INTERVAL_SECONDS", 10));
}

export function isHrQueueConfigured() {
  return getHrQueueName().length > 0 && getHrWorkerSecret().length > 0;
}

export function shouldPreferInlineHrPipeline() {
  return process.env.HR_AGENT_FORCE_INLINE === "true" || process.env.NODE_ENV !== "production";
}

export function buildHrBackendStatus(persistence: "alloydb" | "filesystem") {
  const queueConfigured = isHrQueueConfigured() && !shouldPreferInlineHrPipeline();
  const pipelineDriver = queueConfigured ? ("cloud-tasks" as const) : ("inline" as const);

  return {
    persistence,
    pipelineDriver,
    pollingIntervalSeconds: getHrPollingIntervalSeconds(),
    ready: true,
    message:
      persistence === "alloydb"
        ? "AlloyDB persistence is active. Automated evaluation is currently paused, so submissions are only being recorded."
        : "Filesystem fallback is active. Automated evaluation is currently paused, so submissions are only being recorded.",
  };
}
