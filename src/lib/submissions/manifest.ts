import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";
import { load as loadYaml } from "js-yaml";
import type {
  ParsedSubmissionManifest,
  ParsedSubmissionTemplateVersion,
} from "@/lib/submissions/types";

export const SUBMISSION_MANIFEST_CANDIDATES = [
  "manifest.yaml",
  "manifest.yml",
  "manifest.json",
  "potato-chips-ai-agent.json",
  "potato-chips-ai.json",
  "gpt-capital-agent.json",
  "gpt-capital.json",
  "agent.json",
] as const;

const TEMPLATE_REQUIRED_FIELDS = [
  "schema_version",
  "agent_id",
  "name",
  "response_formats",
  "metrics",
] as const;
const TEMPLATE_RESPONSE_FORMATS = new Set([
  "daily_forecast",
  "scenario",
  "brief",
  "freeform",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stringArrayValue(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
}

function commandValue(value: unknown) {
  if (Array.isArray(value) && value.every((item) => typeof item === "string" && item.trim())) {
    return value.map((item) => item.trim());
  }

  if (typeof value === "string" && value.trim()) {
    return ["/bin/sh", "-lc", value.trim()];
  }

  return null;
}

function parseManifestContent(relativePath: string, content: string) {
  const extension = path.posix.extname(relativePath).toLowerCase();

  if (extension === ".yaml" || extension === ".yml") {
    return loadYaml(content);
  }

  return JSON.parse(content) as unknown;
}

function detectManifestKind(input: {
  raw: Record<string, unknown>;
  relativePath: string;
}): ParsedSubmissionManifest["kind"] {
  const basename = path.posix.basename(input.relativePath).toLowerCase();
  const declaredKind = stringValue(input.raw.kind)?.toLowerCase();
  const hasTemplateShape = TEMPLATE_REQUIRED_FIELDS.every((field) => field in input.raw);
  const hasRuntimeShape = Boolean(input.raw.command || input.raw.entrypoint || input.raw.runtime);

  if (declaredKind === "agent-template") {
    return "agent-template";
  }

  if (declaredKind === "runtime") {
    return "runtime";
  }

  if (hasTemplateShape) {
    return "agent-template";
  }

  if (hasRuntimeShape) {
    return "runtime";
  }

  if (basename === "manifest.yaml" || basename === "manifest.yml") {
    return "agent-template";
  }

  return "generic";
}

function validateTemplateManifest(raw: Record<string, unknown>) {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const fieldName of TEMPLATE_REQUIRED_FIELDS) {
    if (!(fieldName in raw)) {
      errors.push(`manifest.yaml is missing required field: ${fieldName}`);
    }
  }

  for (const fieldName of ["schema_version", "agent_id", "name"] as const) {
    if (fieldName in raw && !stringValue(raw[fieldName])) {
      errors.push(`manifest.yaml field '${fieldName}' must be a non-empty string`);
    }
  }

  if ("description" in raw && raw.description !== undefined && raw.description !== null) {
    if (typeof raw.description !== "string") {
      errors.push("manifest.yaml field 'description' must be a string");
    }
  }

  const responseFormatsValue = raw.response_formats;

  if (!Array.isArray(responseFormatsValue) || responseFormatsValue.length === 0) {
    errors.push("manifest.yaml field 'response_formats' must be a non-empty list");
  } else {
    const formats = stringArrayValue(responseFormatsValue);

    if (formats.length !== responseFormatsValue.length) {
      errors.push("manifest.yaml field 'response_formats' must contain only strings");
    }

    const unknownFormats = formats.filter((format) => !TEMPLATE_RESPONSE_FORMATS.has(format));

    if (unknownFormats.length > 0) {
      warnings.push(`Unknown response format(s): ${unknownFormats.join(", ")}`);
    }
  }

  const metricsValue = raw.metrics;

  if (!Array.isArray(metricsValue) || metricsValue.length === 0) {
    errors.push("manifest.yaml field 'metrics' must be a non-empty list");
  } else if (stringArrayValue(metricsValue).length !== metricsValue.length) {
    errors.push("manifest.yaml field 'metrics' must contain only strings");
  }

  const tagsValue = raw.tags;

  if ("tags" in raw && tagsValue !== undefined && tagsValue !== null) {
    if (!Array.isArray(tagsValue) || stringArrayValue(tagsValue).length !== tagsValue.length) {
      errors.push("manifest.yaml field 'tags' must be a list of strings when present");
    }
  }

  return {
    errors,
    valid: errors.length === 0,
    warnings,
  };
}

function validateRuntimeManifest(raw: Record<string, unknown>) {
  const errors: string[] = [];
  const command = commandValue(raw.command);
  const entrypoint = stringValue(raw.entrypoint);
  const runtime = stringValue(raw.runtime);

  if (!command && !(entrypoint && runtime)) {
    errors.push("Runtime manifest must declare either command or entrypoint plus runtime");
  }

  if (runtime && runtime !== "python" && runtime !== "node") {
    errors.push("Runtime manifest field 'runtime' must be either 'python' or 'node'");
  }

  if ("cwd" in raw && raw.cwd !== undefined && raw.cwd !== null && !stringValue(raw.cwd)) {
    errors.push("Runtime manifest field 'cwd' must be a non-empty string when present");
  }

  return {
    errors,
    valid: errors.length === 0,
    warnings: [] as string[],
  };
}

export function parseSubmissionManifest(input: {
  content: string;
  relativePath: string;
}): ParsedSubmissionManifest {
  const parsed = parseManifestContent(input.relativePath, input.content);

  if (!isRecord(parsed)) {
    return {
      agentId: null,
      command: null,
      cwd: null,
      description: null,
      entrypoint: null,
      kind: "generic",
      metrics: [],
      name: null,
      path: input.relativePath,
      raw: {},
      responseFormats: [],
      runtime: null,
      schemaVersion: null,
      tags: [],
      validation: {
        errors: [`${input.relativePath} must parse to an object`],
        valid: false,
        warnings: [],
      },
    };
  }

  const kind = detectManifestKind({
    raw: parsed,
    relativePath: input.relativePath,
  });
  const validation =
    kind === "agent-template"
      ? validateTemplateManifest(parsed)
      : kind === "runtime"
        ? validateRuntimeManifest(parsed)
        : { errors: [] as string[], valid: true, warnings: [] as string[] };

  return {
    agentId: stringValue(parsed.agent_id),
    command: commandValue(parsed.command),
    cwd: stringValue(parsed.cwd),
    description: stringValue(parsed.description),
    entrypoint: stringValue(parsed.entrypoint),
    kind,
    metrics: stringArrayValue(parsed.metrics),
    name: stringValue(parsed.name),
    path: input.relativePath,
    raw: parsed,
    responseFormats: stringArrayValue(parsed.response_formats),
    runtime: stringValue(parsed.runtime),
    schemaVersion: stringValue(parsed.schema_version),
    tags: stringArrayValue(parsed.tags),
    validation,
  };
}

export function parseSubmissionManifestPermissive(input: {
  content: string;
  relativePath: string;
}): ParsedSubmissionManifest {
  try {
    return parseSubmissionManifest(input);
  } catch (error) {
    const basename = path.posix.basename(input.relativePath).toLowerCase();

    return {
      agentId: null,
      command: null,
      cwd: null,
      description: null,
      entrypoint: null,
      kind:
        basename === "manifest.yaml" || basename === "manifest.yml"
          ? "agent-template"
          : "generic",
      metrics: [],
      name: null,
      path: input.relativePath,
      raw: {},
      responseFormats: [],
      runtime: null,
      schemaVersion: null,
      tags: [],
      validation: {
        errors: [
          error instanceof Error
            ? `${input.relativePath} could not be parsed: ${error.message}`
            : `${input.relativePath} could not be parsed`,
        ],
        valid: false,
        warnings: [],
      },
    };
  }
}

export async function findSubmissionManifestInWorkspace(rootPath: string) {
  for (const relativePath of SUBMISSION_MANIFEST_CANDIDATES) {
    const absolutePath = path.join(rootPath, relativePath);
    let content: string;

    try {
      content = await readFile(absolutePath, "utf8");
    } catch {
      continue;
    }

    return parseSubmissionManifestPermissive({
      content,
      relativePath,
    });
  }

  return null;
}

export async function readTemplateVersionInWorkspace(
  rootPath: string
): Promise<ParsedSubmissionTemplateVersion | null> {
  const relativePath = ".potato-chips-ai/version.json";

  try {
    const content = await readFile(path.join(rootPath, relativePath), "utf8");
    const parsed = JSON.parse(content) as unknown;

    if (!isRecord(parsed)) {
      return null;
    }

    return {
      path: relativePath,
      raw: parsed,
      schemaVersion: stringValue(parsed.schema_version),
      sdkVersion: stringValue(parsed.sdk_version),
      templateVersion: stringValue(parsed.template_version),
    };
  } catch {
    return null;
  }
}
