import "server-only";

import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { decryptSecretValue } from "@/lib/submissions/crypto";
import {
  buildSubmittedAgentLlmGatewayEnvironment,
  getSubmittedAgentLlmProviderForEnvVar,
} from "@/lib/submissions/llm-gateway";
import { parseSubmissionSource } from "@/lib/submissions/parser";
import { ensureSubmissionSchema } from "@/lib/submissions/schema";
import type { ParsedSubmission } from "@/lib/submissions/types";

type ManagedEnvGroup = {
  aliases: string[];
  canonical: string;
  label: string;
  exposeToSubmittedAgents: boolean;
  summary: string;
};

const MANAGED_ENV_GROUPS: ManagedEnvGroup[] = [
  {
    aliases: ["ANTHROPIC_KEY", "ANTHROPIC_TOKEN", "CLAUDE_API_KEY", "CLAUDE_API_TOKEN"],
    canonical: "ANTHROPIC_API_KEY",
    exposeToSubmittedAgents: false,
    label: "Anthropic API",
    summary: "LLM inference access for Anthropic-hosted Claude models.",
  },
  {
    aliases: ["OPENAI_KEY", "OPENAI_TOKEN"],
    canonical: "OPENAI_API_KEY",
    exposeToSubmittedAgents: false,
    label: "OpenAI API",
    summary: "LLM inference access for OpenAI-hosted models.",
  },
  {
    aliases: ["APCA_API_KEY_ID", "ALPACA_KEY", "ALPACA_KEY_ID"],
    canonical: "ALPACA_API_KEY",
    exposeToSubmittedAgents: true,
    label: "Alpaca Markets API",
    summary: "Approved market-data access for research workflows.",
  },
  {
    aliases: ["APCA_API_SECRET_KEY", "ALPACA_SECRET", "ALPACA_API_SECRET"],
    canonical: "ALPACA_SECRET_KEY",
    exposeToSubmittedAgents: true,
    label: "Alpaca Markets API",
    summary: "Approved market-data access for research workflows.",
  },
  {
    aliases: ["POLYGON_API_KEY", "POLYGON_KEY"],
    canonical: "MASSIVE_API_KEY",
    exposeToSubmittedAgents: true,
    label: "Massive API",
    summary: "Market data access for the Massive (Polygon) API.",
  },
  {
    aliases: ["NEWS_API_KEY", "NEWSAPI_KEY"],
    canonical: "NEWSAPI_API_KEY",
    exposeToSubmittedAgents: true,
    label: "News API",
    summary: "News feed access for external news-provider requests.",
  },
  {
    aliases: ["EDGAR_USER_AGENT", "SEC_API_USER_AGENT"],
    canonical: "SEC_USER_AGENT",
    exposeToSubmittedAgents: true,
    label: "SEC EDGAR",
    summary: "Fair-access contact header required for SEC EDGAR requests.",
  },
];

const SAFE_BASE_ENV_KEYS = [
  "HOME",
  "LANG",
  "LC_ALL",
  "PATH",
  "TEMP",
  "TMP",
  "TMPDIR",
] as const;
const SUBMITTED_AGENT_CA_BUNDLE_CANDIDATES = [
  process.env.SUBMISSION_RUNNER_CA_BUNDLE,
  "/etc/ssl/cert.pem",
  "/private/etc/ssl/cert.pem",
  "/etc/ssl/certs/ca-certificates.crt",
  "/etc/pki/tls/certs/ca-bundle.crt",
  "/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem",
  "/opt/homebrew/etc/openssl@3/cert.pem",
  process.env.REQUESTS_CA_BUNDLE,
  process.env.SSL_CERT_FILE,
  process.env.CURL_CA_BUNDLE,
  process.env.NODE_EXTRA_CA_CERTS,
] as const;
const SUBMITTED_AGENT_PYTHON_LLM_GATEWAY_SHIM = `# Auto-loaded by Python when this directory is on PYTHONPATH.
# It keeps vanilla submitted agents compatible with Potato Chips AI managed LLM
# credentials by redirecting public vendor API URLs to the per-run gateway.
import os
import urllib.parse
import urllib.request


def _cz_gateway_url(raw_url):
    try:
        parsed = urllib.parse.urlsplit(str(raw_url))
    except Exception:
        return raw_url

    host = parsed.netloc.lower()
    path = parsed.path or "/"

    if host == "api.anthropic.com":
        base_url = (
            os.environ.get("ANTHROPIC_BASE_URL")
            or os.environ.get("ANTHROPIC_API_BASE_URL")
            or os.environ.get("ANTHROPIC_API_BASE")
            or os.environ.get("ANTHROPIC_API_URL")
        )
    elif host == "api.openai.com":
        base_url = (
            os.environ.get("OPENAI_BASE_URL")
            or os.environ.get("OPENAI_API_BASE_URL")
            or os.environ.get("OPENAI_API_BASE")
        )
    else:
        return raw_url

    if not base_url:
        return raw_url

    base = urllib.parse.urlsplit(base_url.rstrip("/"))
    base_path = base.path.rstrip("/")

    if host == "api.openai.com" and base_path.endswith("/v1") and path.startswith("/v1/"):
        path = path[len("/v1"):]

    next_path = f"{base_path}{path if path.startswith('/') else '/' + path}"
    return urllib.parse.urlunsplit((base.scheme, base.netloc, next_path, parsed.query, parsed.fragment))


def _cz_rewrite_urllib_target(target):
    if isinstance(target, urllib.request.Request):
        next_url = _cz_gateway_url(target.full_url)

        if next_url == target.full_url:
            return target

        headers = {
            key: value
            for key, value in target.header_items()
            if key.lower() != "host"
        }
        return urllib.request.Request(
            next_url,
            data=target.data,
            headers=headers,
            origin_req_host=target.origin_req_host,
            unverifiable=target.unverifiable,
            method=target.get_method(),
        )

    return _cz_gateway_url(target)


_cz_original_urlopen = urllib.request.urlopen


def _cz_urlopen(url, *args, **kwargs):
    return _cz_original_urlopen(_cz_rewrite_urllib_target(url), *args, **kwargs)


urllib.request.urlopen = _cz_urlopen


def _cz_patch_requests():
    try:
        import requests.sessions
    except Exception:
        return

    original_request = requests.sessions.Session.request

    if getattr(original_request, "_cz_llm_gateway_patched", False):
        return

    def request(self, method, url, *args, **kwargs):
        return original_request(self, method, _cz_gateway_url(url), *args, **kwargs)

    request._cz_llm_gateway_patched = True
    requests.sessions.Session.request = request


def _cz_patch_httpx():
    try:
        import httpx
    except Exception:
        return

    for client_class in (httpx.Client, httpx.AsyncClient):
        original_request = client_class.request

        if getattr(original_request, "_cz_llm_gateway_patched", False):
            continue

        def request(self, method, url, *args, _cz_original=original_request, **kwargs):
            return _cz_original(self, method, _cz_gateway_url(url), *args, **kwargs)

        request._cz_llm_gateway_patched = True
        client_class.request = request


_cz_patch_requests()
_cz_patch_httpx()
`;

const ENV_VAR_PATTERN = /\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/g;
const CREDENTIAL_ENV_PATTERN =
  /(?:API[_-]?KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL|USER_AGENT)$/i;
const OPTIONAL_MODEL_CONFIG_ENV_NAMES = new Set([
  "ANTHROPIC_MODEL",
  "ANTHROPIC_MODEL_ID",
  "CLAUDE_MODEL",
  "CLAUDE_MODEL_ID",
  "GEMINI_MODEL",
  "GEMINI_MODEL_ID",
  "GOOGLE_MODEL",
  "GOOGLE_MODEL_ID",
  "LLM_MODEL",
  "OPENAI_MODEL",
  "OPENAI_MODEL_ID",
]);
const SUBMITTED_AGENT_OPERATOR_ONLY_ENV_NAMES = new Set([
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_KEY",
  "ANTHROPIC_TOKEN",
  "CLAUDE_API_KEY",
  "CLAUDE_API_TOKEN",
  "COHERE_API_KEY",
  "DEEPSEEK_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_AI_API_KEY",
  "GOOGLE_API_KEY",
  "GROQ_API_KEY",
  "MISTRAL_API_KEY",
  "OPENAI_API_KEY",
  "OPENAI_KEY",
  "OPENAI_TOKEN",
  "PERPLEXITY_API_KEY",
  "TOGETHER_API_KEY",
  "XAI_API_KEY",
]);

function normalizeEnvVarName(value: string) {
  const normalized = value.trim().toUpperCase();

  if (!/^[A-Z][A-Z0-9_]*$/.test(normalized)) {
    return null;
  }

  return normalized;
}

function getManagedEnvGroup(envVarName: string) {
  const normalized = normalizeEnvVarName(envVarName);

  if (!normalized) {
    return null;
  }

  return (
    MANAGED_ENV_GROUPS.find(
      (group) =>
        group.canonical === normalized || group.aliases.includes(normalized)
    ) ?? null
  );
}

function canExposeEnvVarToSubmittedAgent(envVarName: string) {
  const normalized = normalizeEnvVarName(envVarName);

  if (!normalized) {
    return false;
  }

  const group = getManagedEnvGroup(normalized);

  if (group) {
    return group.exposeToSubmittedAgents;
  }

  return !SUBMITTED_AGENT_OPERATOR_ONLY_ENV_NAMES.has(normalized);
}

function collectEnvVarsFromUnknown(value: unknown, collector: Set<string>) {
  if (typeof value === "string") {
    for (const match of value.matchAll(ENV_VAR_PATTERN)) {
      const normalized = normalizeEnvVarName(match[0]);

      if (normalized && CREDENTIAL_ENV_PATTERN.test(normalized)) {
        collector.add(normalized);
      }
    }

    return;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      collectEnvVarsFromUnknown(entry, collector);
    }

    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    collectEnvVarsFromUnknown(key, collector);
    collectEnvVarsFromUnknown(child, collector);
  }
}

function getPotentialSecretNames(envVarName: string) {
  const normalized = normalizeEnvVarName(envVarName);

  if (!normalized) {
    return [];
  }

  const group = getManagedEnvGroup(normalized);
  return Array.from(
    new Set(
      [normalized, group?.canonical].filter(
        (candidate): candidate is string => Boolean(candidate)
      )
    )
  );
}

async function readConfiguredSecretValues(envVarNames: string[]) {
  const secretNames = Array.from(
    new Set(envVarNames.flatMap((envVarName) => getPotentialSecretNames(envVarName)))
  );

  if (secretNames.length === 0) {
    return new Map<string, string>();
  }

  await ensureSubmissionSchema();
  const records = await prisma.environmentSecret.findMany({
    where: {
      envVarName: {
        in: secretNames,
      },
    },
  });
  const values = new Map<string, string>();

  for (const record of records) {
    const decrypted = decryptSecretValue(record.encryptedValue);

    if (decrypted) {
      values.set(record.envVarName, decrypted);
    }
  }

  return values;
}

function readEnvValue(
  envVarName: string,
  configuredSecrets: Map<string, string>
) {
  for (const candidate of getPotentialSecretNames(envVarName)) {
    const configured = configuredSecrets.get(candidate)?.trim();

    if (configured) {
      return {
        sourceEnvVarName: candidate,
        value: configured,
      };
    }

    const runtime = process.env[candidate]?.trim();

    if (runtime) {
      return {
        sourceEnvVarName: candidate,
        value: runtime,
      };
    }
  }

  return null;
}

function readSubmittedAgentCaBundlePath() {
  const candidates = Array.from(
    new Set(
      SUBMITTED_AGENT_CA_BUNDLE_CANDIDATES.map((candidate) => candidate?.trim()).filter(
        (candidate): candidate is string => Boolean(candidate)
      )
    )
  );

  for (const candidate of candidates) {
    try {
      if (
        existsSync(candidate) &&
        readFileSync(candidate, "utf8").includes("-----BEGIN CERTIFICATE-----")
      ) {
        return candidate;
      }
    } catch {
      continue;
    }
  }

  return null;
}

async function writeSubmittedAgentPythonLlmGatewayShim() {
  const directory = await mkdtemp(
    path.join(tmpdir(), "potato-chips-ai-llm-gateway-")
  );
  await writeFile(
    path.join(directory, "sitecustomize.py"),
    SUBMITTED_AGENT_PYTHON_LLM_GATEWAY_SHIM,
    "utf8"
  );
  return directory;
}

function prependRuntimePath(value: string, existingValue: string | undefined) {
  return existingValue ? `${value}${path.delimiter}${existingValue}` : value;
}

export function getCanonicalManagedEnvVarName(envVarName: string) {
  const normalized = normalizeEnvVarName(envVarName);

  if (!normalized) {
    return null;
  }

  return getManagedEnvGroup(normalized)?.canonical ?? normalized;
}

export function getManagedEnvVarMetadata(envVarName: string) {
  const group = getManagedEnvGroup(envVarName);

  if (!group) {
    return null;
  }

  return {
    canonical: group.canonical,
    label: group.label,
    summary: group.summary,
  };
}

export function isCredentialLikeEnvVarName(envVarName: string) {
  const normalized = normalizeEnvVarName(envVarName);
  return Boolean(normalized && CREDENTIAL_ENV_PATTERN.test(normalized));
}

export function isOptionalRuntimeConfigEnvVar(envVarName: string) {
  const normalized = normalizeEnvVarName(envVarName);

  if (!normalized || isCredentialLikeEnvVarName(normalized)) {
    return false;
  }

  return OPTIONAL_MODEL_CONFIG_ENV_NAMES.has(normalized);
}

export function extractManifestDeclaredEnvVars(
  parsedSubmission: Pick<ParsedSubmission, "manifest"> | null | undefined
) {
  const collector = new Set<string>();

  if (parsedSubmission?.manifest?.raw) {
    collectEnvVarsFromUnknown(parsedSubmission.manifest.raw, collector);
  }

  return Array.from(collector).sort();
}

export async function getRequestedEnvVarsForWorkspace(rootPath: string) {
  const parsedSubmission = await parseSubmissionSource(rootPath);
  return Array.from(
    new Set([
      ...parsedSubmission.detectedEnvVars,
      ...extractManifestDeclaredEnvVars(parsedSubmission),
    ])
  ).sort();
}

export async function buildSubmittedAgentEnvironment(input: {
  extraEnv?: Record<string, string | undefined>;
  llmGateway?: {
    baseUrl: string;
    runId: string;
    submissionId: string;
    ttlMs?: number;
  };
  requestedEnvVars: Iterable<string>;
}) {
  const requestedEnvVars = Array.from(
    new Set(
      Array.from(input.requestedEnvVars)
        .map((envVarName) => normalizeEnvVarName(envVarName))
        .filter((envVarName): envVarName is string => Boolean(envVarName))
    )
  ).sort();
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: process.env.NODE_ENV ?? "production",
  };
  const injectedEnvVarNames = new Set<string>();
  const proxiedEnvVarNames = new Set<string>();
  const llmGatewayProviders = new Set<string>();
  const withheldEnvVarNames = new Set<string>();
  const exposableEnvVarNames: string[] = [];
  const proxyableLlmEnvVarNames: string[] = [];

  for (const requestedEnvVarName of requestedEnvVars) {
    if (canExposeEnvVarToSubmittedAgent(requestedEnvVarName)) {
      exposableEnvVarNames.push(requestedEnvVarName);
      continue;
    }

    const llmProvider = getSubmittedAgentLlmProviderForEnvVar(requestedEnvVarName);

    if (input.llmGateway && llmProvider) {
      proxyableLlmEnvVarNames.push(requestedEnvVarName);
      continue;
    }

    withheldEnvVarNames.add(requestedEnvVarName);

    const canonical = getCanonicalManagedEnvVarName(requestedEnvVarName);

    if (canonical) {
      withheldEnvVarNames.add(canonical);
    }
  }

  const configuredSecrets = await readConfiguredSecretValues(exposableEnvVarNames);
  const llmGateway = input.llmGateway
    ? await buildSubmittedAgentLlmGatewayEnvironment({
        baseUrl: input.llmGateway.baseUrl,
        requestedEnvVars: proxyableLlmEnvVarNames,
        runId: input.llmGateway.runId,
        submissionId: input.llmGateway.submissionId,
        ttlMs: input.llmGateway.ttlMs,
      })
    : null;

  for (const requestedEnvVarName of proxyableLlmEnvVarNames) {
    const llmProvider = getSubmittedAgentLlmProviderForEnvVar(requestedEnvVarName);

    if (llmProvider && llmGateway?.providers.includes(llmProvider)) {
      proxiedEnvVarNames.add(requestedEnvVarName);

      const canonical = getCanonicalManagedEnvVarName(requestedEnvVarName);

      if (canonical) {
        proxiedEnvVarNames.add(canonical);
      }

      continue;
    }

    withheldEnvVarNames.add(requestedEnvVarName);

    const canonical = getCanonicalManagedEnvVarName(requestedEnvVarName);

    if (canonical) {
      withheldEnvVarNames.add(canonical);
    }
  }

  for (const key of SAFE_BASE_ENV_KEYS) {
    const value = process.env[key];

    if (value) {
      env[key] = value;
    }
  }

  const caBundlePath = readSubmittedAgentCaBundlePath();

  if (caBundlePath) {
    env.CURL_CA_BUNDLE = caBundlePath;
    env.NODE_EXTRA_CA_CERTS = caBundlePath;
    env.REQUESTS_CA_BUNDLE = caBundlePath;
    env.SSL_CERT_FILE = caBundlePath;
  }

  for (const requestedEnvVarName of exposableEnvVarNames) {
    const resolved = readEnvValue(requestedEnvVarName, configuredSecrets);

    if (!resolved) {
      continue;
    }

    env[requestedEnvVarName] = resolved.value;
    injectedEnvVarNames.add(requestedEnvVarName);

    const canonical = getCanonicalManagedEnvVarName(requestedEnvVarName);

    if (canonical) {
      env[canonical] = resolved.value;
      injectedEnvVarNames.add(canonical);
    }
  }

  for (const [key, value] of Object.entries(input.extraEnv ?? {})) {
    if (value !== undefined) {
      env[key] = value;
    }
  }

  const llmGatewayEnv: Record<string, string> = llmGateway?.env ?? {};

  for (const [key, value] of Object.entries(llmGatewayEnv)) {
    env[key] = value;
  }

  if ((llmGateway?.providers.length ?? 0) > 0) {
    const pythonShimPath = await writeSubmittedAgentPythonLlmGatewayShim();
    env.PYTHONPATH = prependRuntimePath(pythonShimPath, env.PYTHONPATH);
    env.CORRELATION_ZERO_LLM_GATEWAY_SHIM = "python-sitecustomize";
  }

  for (const envVarName of llmGateway?.providerEnvVarNames ?? []) {
    proxiedEnvVarNames.add(envVarName);
  }

  for (const provider of llmGateway?.providers ?? []) {
    llmGatewayProviders.add(provider);
  }

  return {
    env,
    injectedEnvVarNames: Array.from(injectedEnvVarNames).sort(),
    llmGatewayProviders: Array.from(llmGatewayProviders).sort(),
    proxiedEnvVarNames: Array.from(proxiedEnvVarNames).sort(),
    requestedEnvVars,
    withheldEnvVarNames: Array.from(withheldEnvVarNames).sort(),
  };
}
