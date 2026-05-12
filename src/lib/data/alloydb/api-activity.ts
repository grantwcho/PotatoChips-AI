import "server-only";

import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { getAlloyDbPool } from "@/lib/data/alloydb/client";

const SCHEMA_CACHE_TTL_MS = 60_000;
const SENSITIVE_KEY_PATTERN =
  /(?:authorization|api[-_]?key|secret|password|token|cookie|session|credential|private[-_]?key|x-agent-worker-secret|x-hr-agent-worker-secret|apca-api-key-id|apca-api-secret-key)/i;
const SENSITIVE_QUERY_PARAM_PATTERN =
  /^(?:key|api[-_]?key|apikey|token|access_token|refresh_token|secret|password|signature)$/i;

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

type QueryRunner = PoolClient | ReturnType<typeof getAlloyDbPool>;

type SchemaCacheEntry = {
  available: boolean;
  checkedAt: number;
};

let apiActivitySchemaCache: SchemaCacheEntry | null = null;

export type ApiActivityCategory =
  | "AUTH"
  | "HR"
  | "INFRASTRUCTURE"
  | "MODEL"
  | "RESEARCH"
  | "TRADING";

export type ApiActivityEventInput = {
  service: string;
  category: ApiActivityCategory;
  operation: string;
  method: string;
  url: string;
  statusCode?: number | null;
  durationMs?: number | null;
  requestHeaders?: Headers | HeadersInit | null;
  requestPayload?: unknown;
  responseHeaders?: Headers | HeadersInit | null;
  responsePayload?: unknown;
  errorMessage?: string | null;
  metadata?: Record<string, unknown>;
  createdAt?: Date;
};

function getRunner(client?: PoolClient): QueryRunner {
  return client ?? getAlloyDbPool();
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sanitizeScalar(value: unknown): JsonValue {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  return String(value);
}

function sanitizeValue(value: unknown, keyPath?: string): JsonValue {
  if (keyPath && SENSITIVE_KEY_PATTERN.test(keyPath)) {
    return "[REDACTED]";
  }

  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return sanitizeScalar(value);
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof URL) {
    return redactUrl(value.toString());
  }

  if (value instanceof URLSearchParams) {
    return sanitizeValue(Object.fromEntries(value.entries()), keyPath);
  }

  if (value instanceof Headers) {
    return sanitizeHeaders(value);
  }

  if (
    value instanceof ArrayBuffer ||
    ArrayBuffer.isView(value)
  ) {
    const byteLength =
      value instanceof ArrayBuffer ? value.byteLength : value.byteLength;
    return {
      kind: "binary",
      byteLength,
    };
  }

  if (Array.isArray(value)) {
    return value.map((item, index) =>
      sanitizeValue(item, keyPath ? `${keyPath}[${index}]` : `[${index}]`)
    );
  }

  if (isPlainObject(value)) {
    const entries = Object.entries(value).map(([key, item]) => [
      key,
      sanitizeValue(item, keyPath ? `${keyPath}.${key}` : key),
    ]);
    return Object.fromEntries(entries);
  }

  return sanitizeScalar(value);
}

function normalizePayload(value: unknown): JsonValue {
  if (typeof value === "undefined") {
    return null;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();

    if (trimmed.length === 0) {
      return "";
    }

    try {
      return sanitizeValue(JSON.parse(trimmed));
    } catch {
      return {
        text: value,
      };
    }
  }

  return sanitizeValue(value);
}

function headersToRecord(input: Headers | HeadersInit | null | undefined) {
  if (!input) {
    return {} as Record<string, string>;
  }

  try {
    return Object.fromEntries(new Headers(input).entries());
  } catch {
    return {};
  }
}

function sanitizeHeaders(input: Headers | HeadersInit | null | undefined) {
  const rawHeaders = headersToRecord(input);
  const sanitizedEntries = Object.entries(rawHeaders).map(([key, value]) => [
    key,
    SENSITIVE_KEY_PATTERN.test(key) ? "[REDACTED]" : value,
  ]);

  return Object.fromEntries(sanitizedEntries);
}

function redactUrl(input: string) {
  try {
    const url = new URL(input);

    url.searchParams.forEach((_, key) => {
      if (SENSITIVE_QUERY_PARAM_PATTERN.test(key)) {
        url.searchParams.set(key, "[REDACTED]");
      }
    });

    return url.toString();
  } catch {
    return input.replace(
      /([?&](?:key|api[-_]?key|apikey|token|access_token|refresh_token|secret|password|signature)=)[^&]*/gi,
      "$1[REDACTED]"
    );
  }
}

export async function isApiActivitySchemaAvailable(client?: PoolClient) {
  const now = Date.now();

  if (
    apiActivitySchemaCache &&
    now - apiActivitySchemaCache.checkedAt < SCHEMA_CACHE_TTL_MS
  ) {
    return apiActivitySchemaCache.available;
  }

  try {
    const runner = getRunner(client);
    const result = await runner.query<{ has_api_activity_events: boolean }>(`
      select
        to_regclass('public.api_activity_events') is not null as has_api_activity_events
    `);
    const available = Boolean(result.rows[0]?.has_api_activity_events);

    apiActivitySchemaCache = {
      available,
      checkedAt: now,
    };

    return available;
  } catch {
    apiActivitySchemaCache = {
      available: false,
      checkedAt: now,
    };
    return false;
  }
}

export async function recordApiActivityEvent(
  input: ApiActivityEventInput,
  client?: PoolClient
) {
  if (!(await isApiActivitySchemaAvailable(client))) {
    return false;
  }

  const runner = getRunner(client);

  await runner.query(
    `
      insert into api_activity_events (
        id,
        service,
        category,
        operation,
        http_method,
        url,
        status_code,
        duration_ms,
        request_headers,
        request_payload,
        response_headers,
        response_payload,
        error_message,
        metadata,
        created_at
      )
      values (
        $1::uuid,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9::jsonb,
        $10::jsonb,
        $11::jsonb,
        $12::jsonb,
        $13,
        $14::jsonb,
        $15
      )
    `,
    [
      randomUUID(),
      input.service,
      input.category,
      input.operation,
      input.method.toUpperCase(),
      redactUrl(input.url),
      input.statusCode ?? null,
      input.durationMs ?? null,
      JSON.stringify(sanitizeHeaders(input.requestHeaders)),
      JSON.stringify(normalizePayload(input.requestPayload)),
      JSON.stringify(sanitizeHeaders(input.responseHeaders)),
      JSON.stringify(normalizePayload(input.responsePayload)),
      input.errorMessage ?? null,
      JSON.stringify(sanitizeValue(input.metadata ?? {})),
      input.createdAt ?? new Date(),
    ]
  );

  return true;
}

export async function recordApiActivityEventSafe(
  input: ApiActivityEventInput,
  client?: PoolClient
) {
  try {
    await recordApiActivityEvent(input, client);
  } catch (error) {
    console.error("Failed to persist outbound API activity", error);
  }
}
