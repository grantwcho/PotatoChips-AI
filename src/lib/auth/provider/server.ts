import "server-only";

import { GoogleAuth } from "google-auth-library";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { recordApiActivityEventSafe } from "@/lib/data/alloydb/api-activity";

const identityPlatformAuth = new GoogleAuth({
  scopes: ["https://www.googleapis.com/auth/identitytoolkit"],
});
const sessionCookieKeySet = createRemoteJWKSet(
  new URL("https://identitytoolkit.googleapis.com/v1/sessionCookiePublicKeys")
);

const SIGN_IN_WITH_PASSWORD_URL =
  "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword";
const SEND_OOB_CODE_URL =
  "https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode";

export type ClientSessionClaims = JWTPayload & {
  email?: string;
  email_verified?: boolean;
  firebase?: {
    identities?: Record<string, string[]>;
    sign_in_provider?: string;
    tenant?: string;
  };
  name?: string;
  picture?: string;
  role?: unknown;
  uid?: string;
  user_id?: string;
};

type IdentityPlatformErrorResponse = {
  error?: {
    message?: string;
  };
};

type IdentityPlatformSignInResponse = {
  email?: string;
  expiresIn?: string;
  idToken: string;
  isNewUser?: boolean;
  localId?: string;
  refreshToken?: string;
};

type CreateSessionCookieResponse = {
  sessionCookie: string;
};

type SendOobCodeResponse = {
  email?: string;
};

function parseLoggedPayload(text: string) {
  if (!text.trim()) {
    return null;
  }

  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {
      text,
    };
  }
}

function getIdentityPlatformProjectId() {
  const projectId =
    process.env.IDENTITY_PLATFORM_PROJECT_ID ??
    process.env.GOOGLE_CLOUD_PROJECT ??
    process.env.FIRESTORE_COMPATIBILITY_PROJECT_ID ??
    process.env.FIREBASE_PROJECT_ID;

  if (!projectId) {
    throw new Error(
      "Missing IDENTITY_PLATFORM_PROJECT_ID or GOOGLE_CLOUD_PROJECT."
    );
  }

  return projectId;
}

function getIdentityPlatformApiKey() {
  const apiKey = process.env.IDENTITY_PLATFORM_API_KEY;

  if (!apiKey) {
    throw new Error("Missing IDENTITY_PLATFORM_API_KEY.");
  }

  return apiKey;
}

function getIdentityPlatformTenantId() {
  return process.env.IDENTITY_PLATFORM_TENANT_ID || undefined;
}

async function parseIdentityPlatformResponse<T>(
  response: Response
): Promise<T> {
  const text = await response.text();
  const payload = text ? (JSON.parse(text) as T | IdentityPlatformErrorResponse) : null;

  if (!response.ok) {
    const message =
      payload &&
      typeof payload === "object" &&
      "error" in payload &&
      payload.error?.message
        ? payload.error.message
        : "Identity Platform request failed.";

    throw new Error(message);
  }

  return payload as T;
}

async function signInWithEmailPassword(email: string, password: string) {
  const tenantId = getIdentityPlatformTenantId();
  const startedAt = Date.now();
  const url = `${SIGN_IN_WITH_PASSWORD_URL}?key=${encodeURIComponent(getIdentityPlatformApiKey())}`;
  const requestHeaders = {
    "Content-Type": "application/json",
  };
  const requestPayload = {
    email,
    password,
    returnSecureToken: true,
    ...(tenantId ? { tenantId } : {}),
  };
  let responseHeaders: Headers | null = null;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify(requestPayload),
      cache: "no-store",
    });
    responseHeaders = response.headers;
    const rawText = await response.clone().text().catch(() => "");

    await recordApiActivityEventSafe({
      service: "IDENTITY_PLATFORM",
      category: "AUTH",
      operation: "accounts:signInWithPassword",
      method: "POST",
      url,
      statusCode: response.status,
      durationMs: Date.now() - startedAt,
      requestHeaders,
      requestPayload,
      responseHeaders,
      responsePayload: parseLoggedPayload(rawText),
    });

    return parseIdentityPlatformResponse<IdentityPlatformSignInResponse>(response);
  } catch (error) {
    if (!responseHeaders) {
      await recordApiActivityEventSafe({
        service: "IDENTITY_PLATFORM",
        category: "AUTH",
        operation: "accounts:signInWithPassword",
        method: "POST",
        url,
        durationMs: Date.now() - startedAt,
        requestHeaders,
        requestPayload,
        errorMessage:
          error instanceof Error
            ? error.message
            : "Identity Platform sign-in request failed unexpectedly.",
      });
    }

    throw error;
  }
}

export async function sendClientPasswordResetEmail(
  email: string,
  locale?: string
) {
  const tenantId = getIdentityPlatformTenantId();
  const startedAt = Date.now();
  const url = `${SEND_OOB_CODE_URL}?key=${encodeURIComponent(getIdentityPlatformApiKey())}`;
  const requestHeaders = {
    "Content-Type": "application/json",
    ...(locale ? { "X-Firebase-Locale": locale } : {}),
  };
  const requestPayload = {
    requestType: "PASSWORD_RESET",
    email,
    ...(tenantId ? { tenantId } : {}),
  };
  let responseHeaders: Headers | null = null;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify(requestPayload),
      cache: "no-store",
    });
    responseHeaders = response.headers;
    const rawText = await response.clone().text().catch(() => "");

    await recordApiActivityEventSafe({
      service: "IDENTITY_PLATFORM",
      category: "AUTH",
      operation: "accounts:sendOobCode",
      method: "POST",
      url,
      statusCode: response.status,
      durationMs: Date.now() - startedAt,
      requestHeaders,
      requestPayload,
      responseHeaders,
      responsePayload: parseLoggedPayload(rawText),
      metadata: {
        locale: locale ?? null,
      },
    });

    return parseIdentityPlatformResponse<SendOobCodeResponse>(response);
  } catch (error) {
    if (!responseHeaders) {
      await recordApiActivityEventSafe({
        service: "IDENTITY_PLATFORM",
        category: "AUTH",
        operation: "accounts:sendOobCode",
        method: "POST",
        url,
        durationMs: Date.now() - startedAt,
        requestHeaders,
        requestPayload,
        errorMessage:
          error instanceof Error
            ? error.message
            : "Identity Platform password-reset request failed unexpectedly.",
        metadata: {
          locale: locale ?? null,
        },
      });
    }

    throw error;
  }
}

async function getIdentityPlatformAccessToken() {
  const accessToken = await identityPlatformAuth.getAccessToken();

  if (!accessToken) {
    throw new Error(
      "Unable to obtain Google Cloud credentials for Identity Platform."
    );
  }

  return accessToken;
}

async function createSessionCookie(
  idToken: string,
  validDurationSeconds: number
) {
  const tenantId = getIdentityPlatformTenantId();
  const projectId = getIdentityPlatformProjectId();
  const accessToken = await getIdentityPlatformAccessToken();
  const startedAt = Date.now();
  const url = `https://identitytoolkit.googleapis.com/v1/projects/${encodeURIComponent(projectId)}:createSessionCookie`;
  const requestHeaders = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    "x-goog-user-project": projectId,
  };
  const requestPayload = {
    idToken,
    validDuration: String(validDurationSeconds),
    ...(tenantId ? { tenantId } : {}),
  };
  let responseHeaders: Headers | null = null;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify(requestPayload),
      cache: "no-store",
    });
    responseHeaders = response.headers;
    const rawText = await response.clone().text().catch(() => "");

    await recordApiActivityEventSafe({
      service: "IDENTITY_PLATFORM",
      category: "AUTH",
      operation: "projects:createSessionCookie",
      method: "POST",
      url,
      statusCode: response.status,
      durationMs: Date.now() - startedAt,
      requestHeaders,
      requestPayload,
      responseHeaders,
      responsePayload: parseLoggedPayload(rawText),
      metadata: {
        projectId,
      },
    });

    const payload =
      await parseIdentityPlatformResponse<CreateSessionCookieResponse>(response);

    return payload.sessionCookie;
  } catch (error) {
    if (!responseHeaders) {
      await recordApiActivityEventSafe({
        service: "IDENTITY_PLATFORM",
        category: "AUTH",
        operation: "projects:createSessionCookie",
        method: "POST",
        url,
        durationMs: Date.now() - startedAt,
        requestHeaders,
        requestPayload,
        errorMessage:
          error instanceof Error
            ? error.message
            : "Identity Platform createSessionCookie request failed unexpectedly.",
        metadata: {
          projectId,
        },
      });
    }

    throw error;
  }
}

async function readVerifiedClientSessionCookie(sessionCookie: string) {
  const projectId = getIdentityPlatformProjectId();
  const { payload } = await jwtVerify(sessionCookie, sessionCookieKeySet, {
    algorithms: ["RS256"],
    audience: projectId,
    issuer: `https://session.firebase.google.com/${projectId}`,
  });

  return payload as ClientSessionClaims;
}

export async function createClientSessionFromEmailPassword(
  email: string,
  password: string,
  validDurationSeconds: number
) {
  const signIn = await signInWithEmailPassword(email, password);
  const sessionCookie = await createSessionCookie(
    signIn.idToken,
    validDurationSeconds
  );
  const claims = await readVerifiedClientSessionCookie(sessionCookie);

  return {
    claims,
    sessionCookie,
  };
}

export async function verifyClientSessionCookie(sessionCookie: string) {
  try {
    return await readVerifiedClientSessionCookie(sessionCookie);
  } catch {
    return null;
  }
}
