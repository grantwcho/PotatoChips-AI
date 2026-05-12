import type {
  AgentSubmissionInput,
  HrSubmittedArtifact,
} from "@/lib/hr-agent/models/agent-application";
import {
  createAgentApplication,
  createHrApplicationId,
} from "@/lib/hr-agent/repository";
import {
  type PersistedSubmissionArtifact,
  persistSubmittedFile,
  removeHrSubmissionArtifacts,
  writeSubmissionManifest,
} from "@/lib/hr-agent/storage";

function stringField(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function cleanupDerivedLabel(value: string) {
  return value
    .replace(/(\.tar\.gz|\.tgz|\.tar|\.zip)$/i, "")
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function deriveAgentName(input: {
  agentName?: string;
  packageType?: AgentSubmissionInput["packageType"];
  submitter: string;
  packageReference?: string;
  documentationReference?: string;
}) {
  const explicitName = input.agentName?.trim();

  if (explicitName) {
    return explicitName;
  }

  let derivedArtifactName = "";

  if (input.packageType === "api-endpoint" && input.packageReference?.trim()) {
    try {
      const url = new URL(input.packageReference.trim());
      derivedArtifactName = cleanupDerivedLabel(
        url.pathname.split("/").filter(Boolean).at(-1) || url.hostname
      );
    } catch {
      derivedArtifactName = cleanupDerivedLabel(input.packageReference.trim());
    }
  } else if (
    input.packageType === "docker-image" &&
    input.packageReference?.trim()
  ) {
    derivedArtifactName = cleanupDerivedLabel(
      input.packageReference.trim().split("/").at(-1) || input.packageReference.trim()
    );
  } else {
    derivedArtifactName = cleanupDerivedLabel(
      input.packageReference?.trim() || input.documentationReference?.trim() || ""
    );
  }

  if (derivedArtifactName) {
    return derivedArtifactName;
  }

  return `${input.submitter.trim()} submission`;
}

function deriveDataSourcesRequired(value?: string) {
  const explicitValue = value?.trim();

  if (explicitValue) {
    return explicitValue;
  }

  return "";
}

function validateSubmission(input: AgentSubmissionInput) {
  const requiredFields: Array<[keyof AgentSubmissionInput, string]> = [
    ["submitter", "Submitter"],
    ["description", "Description"],
  ];

  for (const [field, label] of requiredFields) {
    if (typeof input[field] !== "string" || String(input[field]).trim().length === 0) {
      throw new Error(`${label} is required.`);
    }
  }

  const hasAgentArtifact = Boolean(
    input.submittedArtifacts?.some((artifact) => artifact.type === "agent-package")
  );
  const packageReference = input.packageReference.trim();

  if (input.packageType === "code-archive" && !hasAgentArtifact && !packageReference) {
    throw new Error("Agent upload is required.");
  }

  if (input.packageType === "docker-image" && packageReference.length === 0) {
    throw new Error("Docker image reference is required.");
  }

  if (input.packageType === "api-endpoint" && packageReference.length === 0) {
    throw new Error("API endpoint URL is required.");
  }

}

export async function submitAgentApplication(
  input: AgentSubmissionInput,
  options?: {
    applicationId?: string;
  }
) {
  validateSubmission(input);
  return createAgentApplication(input, options);
}

async function persistMultipartArtifacts(
  applicationId: string,
  formData: FormData
) {
  const persistedArtifacts: HrSubmittedArtifact[] = [];
  const manifestArtifacts: Array<PersistedSubmissionArtifact & { field: string }> = [];

  const files: Array<{
    field: "agentPackage" | "documentation";
    type: HrSubmittedArtifact["type"];
  }> = [
    {
      field: "agentPackage",
      type: "agent-package",
    },
    {
      field: "documentation",
      type: "documentation",
    },
  ];

  for (const descriptor of files) {
    const value = formData.get(descriptor.field);

    if (!(typeof File !== "undefined" && value instanceof File && value.name)) {
      continue;
    }

    const persistedArtifact = await persistSubmittedFile({
      applicationId,
      type: descriptor.type,
      file: value,
    });

    persistedArtifacts.push({
      type: descriptor.type,
      name: persistedArtifact.name,
      contentType: persistedArtifact.contentType,
      sizeBytes: persistedArtifact.sizeBytes,
    });
    manifestArtifacts.push({
      ...persistedArtifact,
      field: descriptor.field,
    });
  }

  await writeSubmissionManifest(applicationId, {
    capturedAt: new Date().toISOString(),
    packageType: stringField(formData, "packageType") || "code-archive",
    packageReference: stringField(formData, "packageReference"),
    documentationReference: stringField(formData, "documentationReference"),
    artifacts: manifestArtifacts,
  });

  return {
    submittedArtifacts: persistedArtifacts,
    packageReference:
      manifestArtifacts.find((artifact) => artifact.type === "agent-package")?.name ??
      stringField(formData, "packageReference"),
    documentationReference:
      manifestArtifacts.find((artifact) => artifact.type === "documentation")?.name ??
      stringField(formData, "documentationReference") ??
      "uploaded-documentation",
  };
}

export async function submitAgentApplicationFromRequest(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    const applicationId = createHrApplicationId();

    try {
      const persisted = await persistMultipartArtifacts(applicationId, formData);

      return submitAgentApplication({
        submitter: stringField(formData, "submitter"),
        submitterKey: stringField(formData, "submitterKey"),
        agentName: deriveAgentName({
          agentName: stringField(formData, "agentName"),
          packageType: (stringField(formData, "packageType") ||
            "code-archive") as AgentSubmissionInput["packageType"],
          submitter: stringField(formData, "submitter"),
          packageReference: persisted.packageReference,
          documentationReference: persisted.documentationReference,
        }),
        type: stringField(formData, "type") || "custom",
        packageType: stringField(formData, "packageType"),
        packageReference: persisted.packageReference,
        documentationReference: persisted.documentationReference,
        description: stringField(formData, "description"),
        claimedEdge: stringField(formData, "claimedEdge"),
        dataSourcesRequired: deriveDataSourcesRequired(
          stringField(formData, "dataSourcesRequired")
        ),
        documentationProfile: {
          assetClasses: stringField(formData, "assetClasses"),
          riskParameters: stringField(formData, "riskParameters"),
          holdingPeriod: stringField(formData, "holdingPeriod"),
        },
        submittedArtifacts: persisted.submittedArtifacts,
      } as AgentSubmissionInput, {
        applicationId,
      });
    } catch (error) {
      await removeHrSubmissionArtifacts(applicationId);
      throw error;
    }
  }

  const body = (await request.json()) as Partial<AgentSubmissionInput>;

  return submitAgentApplication({
    submitter: body.submitter ?? "",
    submitterKey: body.submitterKey,
    agentName: deriveAgentName({
      agentName: body.agentName,
      packageType: body.packageType,
      submitter: body.submitter ?? "",
      packageReference: body.packageReference,
      documentationReference: body.documentationReference,
    }),
    type: body.type ?? "custom",
    packageType: body.packageType ?? "code-archive",
    packageReference: body.packageReference ?? "api-submission",
    documentationReference: body.documentationReference ?? "api-docs",
    description: body.description ?? "",
    claimedEdge: body.claimedEdge ?? "",
    dataSourcesRequired: deriveDataSourcesRequired(body.dataSourcesRequired),
    documentationProfile: {
      assetClasses: body.documentationProfile?.assetClasses ?? "",
      riskParameters: body.documentationProfile?.riskParameters ?? "",
      holdingPeriod: body.documentationProfile?.holdingPeriod ?? "",
    },
    submittedArtifacts: body.submittedArtifacts ?? [],
  } as AgentSubmissionInput);
}
