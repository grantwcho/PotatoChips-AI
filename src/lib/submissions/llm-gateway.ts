import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { decryptSecretValue } from "@/lib/submissions/crypto";
import { ensureSubmissionSchema } from "@/lib/submissions/schema";

export type SubmittedAgentLlmProvider = "anthropic" | "openai";

type GatewayTokenPayload = {
  exp: number;
  providers: SubmittedAgentLlmProvider[];
  runId: string;
  submissionId: string;
  v: 1;
};

type GatewayEnvironmentInput = {
  baseUrl: string;
  requestedEnvVars: Iterable<string>;
  runId: string;
  submissionId: string;
  ttlMs?: number;
};

const DEFAULT_GATEWAY_TOKEN_TTL_MS = 45_000;

const PROVIDER_ENV_NAMES: Record<SubmittedAgentLlmProvider, string[]> = {
  anthropic: [
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_KEY",
    "ANTHROPIC_TOKEN",
    "CLAUDE_API_KEY",
    "CLAUDE_API_TOKEN",
  ],
  openai: ["OPENAI_API_KEY", "OPENAI_KEY", "OPENAI_TOKEN"],
};

function base64UrlEncode(value: string | Buffer) {
  return Buffer.from(value)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function base64UrlDecode(value: string) {
  const padded = value.padEnd(value.length + ((4 - (value.length % 4)) % 4), "=");
  return Buffer.from(
    padded.replaceAll("-", "+").replaceAll("_", "/"),
    "base64"
  );
}

function normalizeEnvVarName(value: string) {
  const normalized = value.trim().toUpperCase();
  return /^[A-Z][A-Z0-9_]*$/u.test(normalized) ? normalized : null;
}

function normalizeBaseUrl(value: string) {
  const url = new URL(value);
  url.pathname = url.pathname.replace(/\/+$/u, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/u, "");
}

function normalizeConfiguredBaseUrl(value: string | undefined) {
  const trimmed = value?.trim();

  if (!trimmed) {
    return null;
  }

  const withProtocol = /^https?:\/\//iu.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  try {
    return normalizeBaseUrl(withProtocol);
  } catch {
    return null;
  }
}

function getForwardedHeaderValue(request: Request, name: string) {
  const value = request.headers.get(name)?.trim();

  if (!value) {
    return null;
  }

  return value.split(",")[0]?.trim() || null;
}

function isLoopbackHostname(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/gu, "");
  return (
    normalized === "localhost" ||
    normalized === "::1" ||
    normalized === "0.0.0.0" ||
    normalized.startsWith("127.")
  );
}

export function getSubmittedAgentLlmGatewayBaseUrl(request: Request) {
  const configured =
    normalizeConfiguredBaseUrl(process.env.SUBMITTED_AGENT_LLM_GATEWAY_BASE_URL) ??
    normalizeConfiguredBaseUrl(process.env.NEXT_PUBLIC_APP_URL) ??
    normalizeConfiguredBaseUrl(process.env.NEXTAUTH_URL) ??
    normalizeConfiguredBaseUrl(process.env.VERCEL_PROJECT_PRODUCTION_URL) ??
    normalizeConfiguredBaseUrl(process.env.VERCEL_URL);

  if (configured) {
    return configured;
  }

  const requestUrl = new URL(request.url);
  const forwardedProto = getForwardedHeaderValue(request, "x-forwarded-proto");
  const forwardedHost =
    getForwardedHeaderValue(request, "x-forwarded-host") ??
    getForwardedHeaderValue(request, "host");
  const candidate = new URL(requestUrl.origin);

  if (forwardedHost) {
    candidate.host = forwardedHost;
  }

  if (forwardedProto === "http" || forwardedProto === "https") {
    candidate.protocol = `${forwardedProto}:`;
  }

  if (isLoopbackHostname(candidate.hostname)) {
    candidate.protocol = "http:";
  }

  return normalizeBaseUrl(candidate.toString());
}

function getGatewaySecret() {
  const secret =
    process.env.SUBMITTED_AGENT_LLM_GATEWAY_SECRET?.trim() ||
    process.env.NEXTAUTH_SECRET?.trim() ||
    process.env.AUTH_SECRET?.trim() ||
    process.env.ANTHROPIC_API_KEY?.trim() ||
    process.env.OPENAI_API_KEY?.trim();

  if (!secret) {
    throw new Error(
      "Missing SUBMITTED_AGENT_LLM_GATEWAY_SECRET, NEXTAUTH_SECRET, AUTH_SECRET, or an operator LLM key for submitted-agent gateway token signing."
    );
  }

  return secret;
}

function signPayload(encodedPayload: string) {
  return base64UrlEncode(
    createHmac("sha256", getGatewaySecret()).update(encodedPayload).digest()
  );
}

function createGatewayToken(payload: GatewayTokenPayload) {
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  return `${encodedPayload}.${signPayload(encodedPayload)}`;
}

function verifyGatewayToken(token: string) {
  const [encodedPayload, signature] = token.split(".");

  if (!encodedPayload || !signature) {
    return null;
  }

  const expectedSignature = signPayload(encodedPayload);
  const actual = Buffer.from(signature);
  const expected = Buffer.from(expectedSignature);

  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return null;
  }

  try {
    const parsed = JSON.parse(base64UrlDecode(encodedPayload).toString("utf8")) as
      | GatewayTokenPayload
      | Record<string, unknown>;

    if (
      parsed.v !== 1 ||
      typeof parsed.exp !== "number" ||
      typeof parsed.runId !== "string" ||
      typeof parsed.submissionId !== "string" ||
      !Array.isArray(parsed.providers)
    ) {
      return null;
    }

    const providers = parsed.providers.filter(
      (provider): provider is SubmittedAgentLlmProvider =>
        provider === "anthropic" || provider === "openai"
    );

    if (providers.length === 0 || parsed.exp < Date.now()) {
      return null;
    }

    return {
      exp: parsed.exp,
      providers,
      runId: parsed.runId,
      submissionId: parsed.submissionId,
      v: 1 as const,
    };
  } catch {
    return null;
  }
}

export function getSubmittedAgentLlmProviderForEnvVar(envVarName: string) {
  const normalized = normalizeEnvVarName(envVarName);

  if (!normalized) {
    return null;
  }

  for (const [provider, envVarNames] of Object.entries(PROVIDER_ENV_NAMES)) {
    if (envVarNames.includes(normalized)) {
      return provider as SubmittedAgentLlmProvider;
    }
  }

  return null;
}

async function readProviderApiKey(provider: SubmittedAgentLlmProvider) {
  const envVarNames = PROVIDER_ENV_NAMES[provider];

  for (const envVarName of envVarNames) {
    const runtimeValue = process.env[envVarName]?.trim();

    if (runtimeValue) {
      return runtimeValue;
    }
  }

  await ensureSubmissionSchema();

  const records = await prisma.environmentSecret.findMany({
    where: {
      envVarName: {
        in: envVarNames,
      },
    },
  });

  for (const record of records) {
    const value = decryptSecretValue(record.encryptedValue)?.trim();

    if (value) {
      return value;
    }
  }

  return null;
}

export async function isSubmittedAgentLlmProviderConfigured(
  provider: SubmittedAgentLlmProvider
) {
  return Boolean(await readProviderApiKey(provider));
}

export async function buildSubmittedAgentLlmGatewayEnvironment(
  input: GatewayEnvironmentInput
) {
  const requestedEnvVars = Array.from(
    new Set(
      Array.from(input.requestedEnvVars)
        .map((envVarName) => normalizeEnvVarName(envVarName))
        .filter((envVarName): envVarName is string => Boolean(envVarName))
    )
  );
  const requestedProviders = Array.from(
    new Set(
      requestedEnvVars
        .map((envVarName) => getSubmittedAgentLlmProviderForEnvVar(envVarName))
        .filter(
          (provider): provider is SubmittedAgentLlmProvider => Boolean(provider)
        )
    )
  );
  const providers: SubmittedAgentLlmProvider[] = [];

  for (const provider of requestedProviders) {
    if (await isSubmittedAgentLlmProviderConfigured(provider)) {
      providers.push(provider);
    }
  }

  if (providers.length === 0) {
    return {
      env: {} satisfies Record<string, string>,
      expiresAt: null,
      providerEnvVarNames: [] as string[],
      providers,
      token: null,
    };
  }

  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const expiresAt = Date.now() + (input.ttlMs ?? DEFAULT_GATEWAY_TOKEN_TTL_MS);
  const token = createGatewayToken({
    exp: expiresAt,
    providers,
    runId: input.runId,
    submissionId: input.submissionId,
    v: 1,
  });
  const env: Record<string, string> = {};
  const providerEnvVarNames = new Set<string>();

  for (const provider of providers) {
    const requestedProviderEnvVarNames = requestedEnvVars.filter(
      (envVarName) => getSubmittedAgentLlmProviderForEnvVar(envVarName) === provider
    );

    for (const envVarName of [
      ...PROVIDER_ENV_NAMES[provider],
      ...requestedProviderEnvVarNames,
    ]) {
      env[envVarName] = token;
      providerEnvVarNames.add(envVarName);
    }

    if (provider === "anthropic") {
      const providerBaseUrl = `${baseUrl}/api/submitted-agent/llm/anthropic`;
      env.ANTHROPIC_BASE_URL = providerBaseUrl;
      env.ANTHROPIC_API_BASE = providerBaseUrl;
      env.ANTHROPIC_API_BASE_URL = providerBaseUrl;
      env.ANTHROPIC_API_URL = providerBaseUrl;
    } else {
      const providerBaseUrl = `${baseUrl}/api/submitted-agent/llm/openai/v1`;
      env.OPENAI_BASE_URL = providerBaseUrl;
      env.OPENAI_API_BASE = providerBaseUrl;
      env.OPENAI_API_BASE_URL = providerBaseUrl;
    }
  }

  return {
    env,
    expiresAt,
    providerEnvVarNames: Array.from(providerEnvVarNames).sort(),
    providers,
    token,
  };
}

function readBearerToken(request: Request) {
  const authorization = request.headers.get("authorization")?.trim();

  if (!authorization) {
    return null;
  }

  const [scheme, token] = authorization.split(/\s+/u);
  return scheme?.toLowerCase() === "bearer" && token ? token : null;
}

function readGatewayTokenFromRequest(request: Request) {
  return (
    request.headers.get("x-api-key")?.trim() ||
    readBearerToken(request) ||
    null
  );
}

function buildForwardHeaders(input: {
  apiKey: string;
  provider: SubmittedAgentLlmProvider;
  request: Request;
}) {
  const headers = new Headers();
  const contentType = input.request.headers.get("content-type");
  const accept = input.request.headers.get("accept");

  if (contentType) {
    headers.set("content-type", contentType);
  }

  if (accept) {
    headers.set("accept", accept);
  }

  if (input.provider === "anthropic") {
    headers.set("x-api-key", input.apiKey);
    headers.set(
      "anthropic-version",
      input.request.headers.get("anthropic-version") ?? "2023-06-01"
    );

    const beta = input.request.headers.get("anthropic-beta");

    if (beta) {
      headers.set("anthropic-beta", beta);
    }
  } else {
    headers.set("authorization", `Bearer ${input.apiKey}`);

    const organization = input.request.headers.get("openai-organization");
    const project = input.request.headers.get("openai-project");

    if (organization) {
      headers.set("openai-organization", organization);
    }

    if (project) {
      headers.set("openai-project", project);
    }
  }

  return headers;
}

function buildUpstreamUrl(input: {
  path: string[];
  provider: SubmittedAgentLlmProvider;
  requestUrl: string;
}) {
  const requestUrl = new URL(input.requestUrl);
  const safePath = input.path
    .map((part) => encodeURIComponent(decodeURIComponent(part)))
    .join("/");
  const upstreamBase =
    input.provider === "anthropic"
      ? "https://api.anthropic.com"
      : "https://api.openai.com";
  return `${upstreamBase}/${safePath}${requestUrl.search}`;
}

function isAnthropicMessagesPath(path: string[]) {
  return (
    path.length === 2 &&
    path[0]?.toLowerCase() === "v1" &&
    path[1]?.toLowerCase() === "messages"
  );
}

function shouldStripAnthropicTemperature(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const model = (value as Record<string, unknown>).model;

  return (
    typeof model === "string" &&
    model.trim().toLowerCase().startsWith("claude-opus-4-7")
  );
}

async function buildForwardBody(input: {
  path: string[];
  provider: SubmittedAgentLlmProvider;
  request: Request;
}) {
  if (input.request.method === "GET" || input.request.method === "HEAD") {
    return undefined;
  }

  const body = await input.request.arrayBuffer();

  if (
    input.provider !== "anthropic" ||
    !isAnthropicMessagesPath(input.path) ||
    !input.request.headers
      .get("content-type")
      ?.toLowerCase()
      .includes("application/json")
  ) {
    return body;
  }

  try {
    const text = new TextDecoder().decode(body);
    const parsed = JSON.parse(text) as unknown;

    if (!shouldStripAnthropicTemperature(parsed)) {
      return body;
    }

    const nextPayload = { ...(parsed as Record<string, unknown>) };

    delete nextPayload.temperature;

    return JSON.stringify(nextPayload);
  } catch {
    return body;
  }
}

function buildResponseHeaders(upstreamHeaders: Headers) {
  const headers = new Headers();

  for (const headerName of [
    "content-type",
    "cache-control",
    "anthropic-ratelimit-requests-limit",
    "anthropic-ratelimit-requests-remaining",
    "anthropic-ratelimit-tokens-limit",
    "anthropic-ratelimit-tokens-remaining",
    "openai-processing-ms",
    "x-request-id",
  ]) {
    const value = upstreamHeaders.get(headerName);

    if (value) {
      headers.set(headerName, value);
    }
  }

  return headers;
}

export async function proxySubmittedAgentLlmRequest(input: {
  path: string[];
  provider: SubmittedAgentLlmProvider;
  request: Request;
}) {
  const token = readGatewayTokenFromRequest(input.request);
  const payload = token ? verifyGatewayToken(token) : null;

  if (!payload || !payload.providers.includes(input.provider)) {
    return Response.json(
      { error: "Invalid or expired submitted-agent LLM gateway token." },
      { status: 401 }
    );
  }

  const apiKey = await readProviderApiKey(input.provider);

  if (!apiKey) {
    return Response.json(
      { error: `Operator ${input.provider} key is not configured.` },
      { status: 503 }
    );
  }

  const startedAt = Date.now();
  const upstreamUrl = buildUpstreamUrl({
    path: input.path,
    provider: input.provider,
    requestUrl: input.request.url,
  });
  const response = await fetch(upstreamUrl, {
    body: await buildForwardBody({
      path: input.path,
      provider: input.provider,
      request: input.request,
    }),
    headers: buildForwardHeaders({
      apiKey,
      provider: input.provider,
      request: input.request,
    }),
    method: input.request.method,
  });

  console.info("[submitted-agent-llm-gateway]", {
    durationMs: Date.now() - startedAt,
    provider: input.provider,
    runId: payload.runId,
    status: response.status,
    submissionId: payload.submissionId,
  });

  return new Response(response.body, {
    headers: buildResponseHeaders(response.headers),
    status: response.status,
    statusText: response.statusText,
  });
}
