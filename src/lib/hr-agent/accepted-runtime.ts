import "server-only";

import type {
  AgentApplication,
  HrAcceptedRuntimePlan,
} from "@/lib/hr-agent/models/agent-application";
import { writeHrJsonArtifact } from "@/lib/hr-agent/storage";

function buildExpectedImageTag(application: AgentApplication) {
  return `gpt-capital/accepted-agents/${application.id.toLowerCase()}:latest`;
}

export function buildAcceptedRuntimePlan(
  application: AgentApplication
): HrAcceptedRuntimePlan {
  const generatedAt = new Date().toISOString();

  if (application.packageType === "docker-image") {
    return {
      mode: "provided-docker-image",
      strategy: "provided-docker-image",
      fallbackStrategy: null,
      sourcePackageType: application.packageType,
      sourceReference: application.packageReference,
      producedPackageType: "docker-image",
      producedArtifactReference: application.packageReference,
      networkPolicy: "none",
      status: "ready",
      summary:
        "Accepted runtime will use the submitted Docker image directly under Potato Chips AI runtime guardrails.",
      generatedAt,
      notes: [
        "No source rebuild is required because the contributor already supplied a container image.",
        "The image should still run with Potato Chips AI time, memory, and outbound-network controls before any client-facing deployment.",
      ],
    };
  }

  if (application.packageType === "api-endpoint") {
    return {
      mode: "containerized-api-adapter",
      strategy: "nixpacks",
      fallbackStrategy: "cloud-native-buildpacks",
      sourcePackageType: application.packageType,
      sourceReference: application.packageReference,
      producedPackageType: "docker-image",
      producedArtifactReference: buildExpectedImageTag(application),
      networkPolicy: "controlled-outbound",
      status: "planned",
      summary:
        "Accepted API submissions should be wrapped in a Potato Chips AI-managed adapter service built with Nixpacks first and Cloud Native Buildpacks as fallback.",
      generatedAt,
      notes: [
        "The adapter container should standardize auth, timeouts, observability, and schema enforcement for downstream orchestration.",
        "Outbound access from the adapter should be restricted to the contributor's submitted public endpoint and approved public data providers.",
      ],
    };
  }

  return {
    mode: "containerized-code-agent",
    strategy: "nixpacks",
    fallbackStrategy: "cloud-native-buildpacks",
    sourcePackageType: application.packageType,
    sourceReference: application.packageReference,
    producedPackageType: "docker-image",
    producedArtifactReference: buildExpectedImageTag(application),
    networkPolicy: "controlled-outbound",
    status: "planned",
    summary:
      "Accepted source submissions should be containerized with Nixpacks first and Cloud Native Buildpacks as fallback before any client-facing execution.",
    generatedAt,
    notes: [
      "Production should never execute the raw accepted source tree directly.",
      "The built image should preserve the same schema, timeout, memory, and outbound-network guardrails enforced at submission time.",
    ],
  };
}

export async function prepareAcceptedRuntimePlan(application: AgentApplication) {
  const plan = buildAcceptedRuntimePlan(application);
  await writeHrJsonArtifact(
    `deployment/${application.id}/accepted-runtime-plan.json`,
    plan
  );
  return plan;
}
