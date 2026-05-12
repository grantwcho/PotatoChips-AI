import { NextResponse } from "next/server";
import {
  createClientSessionFromEmailPassword,
  sendClientPasswordResetEmail,
} from "@/lib/auth/provider/server";
import {
  DEV_DASHBOARD_BYPASS_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  SESSION_DURATION_MS,
} from "@/lib/auth/constants";
import {
  isDevDashboardBypassEnabled,
  upsertIdentityUser,
} from "@/lib/auth/session";

type AuthIntent = "forgot-password" | "sign-in";

type ParsedAuthRequest = {
  email?: string;
  intent: AuthIntent;
  password?: string;
};

const DEVELOPER_SESSION_COOKIE_NAMES = [
  "next-auth.session-token",
  "__Secure-next-auth.session-token",
  "authjs.session-token",
  "__Secure-authjs.session-token",
  "next-auth.callback-url",
  "__Secure-next-auth.callback-url",
  "authjs.callback-url",
  "__Secure-authjs.callback-url",
  "next-auth.csrf-token",
  "__Host-next-auth.csrf-token",
  "authjs.csrf-token",
  "__Host-authjs.csrf-token",
];

function wantsJsonResponse(request: Request) {
  const accept = request.headers.get("accept") ?? "";
  const contentType = request.headers.get("content-type") ?? "";

  return (
    accept.includes("application/json") ||
    contentType.includes("application/json")
  );
}

function buildRedirect(
  request: Request,
  pathname: string,
  params?: Record<string, string | undefined>
) {
  const url = new URL(pathname, getRequestOrigin(request));

  for (const [key, value] of Object.entries(params ?? {})) {
    if (value) {
      url.searchParams.set(key, value);
    }
  }

  return url;
}

function getForwardedHeaderValue(request: Request, name: string) {
  const value = request.headers.get(name)?.trim();

  if (!value) {
    return null;
  }

  return value.split(",")[0]?.trim() || null;
}

function getRequestOrigin(request: Request) {
  const requestUrl = new URL(request.url);
  const forwardedProto =
    getForwardedHeaderValue(request, "x-forwarded-proto") ?? requestUrl.protocol.replace(/:$/, "");
  const forwardedHost =
    getForwardedHeaderValue(request, "x-forwarded-host") ??
    getForwardedHeaderValue(request, "host") ??
    requestUrl.host;

  return `${forwardedProto}://${forwardedHost}`;
}

function redirectAfterPost(
  request: Request,
  pathname: string,
  params?: Record<string, string | undefined>
) {
  return NextResponse.redirect(buildRedirect(request, pathname, params), 303);
}

function normalizeIntent(value: string | undefined): AuthIntent {
  return value === "forgot-password" ? "forgot-password" : "sign-in";
}

function normalizeEmail(value: string | undefined) {
  const email = value?.trim().toLowerCase();

  return email ? email : undefined;
}

function setDevDashboardBypassCookie(response: NextResponse) {
  response.cookies.set({
    name: DEV_DASHBOARD_BYPASS_COOKIE_NAME,
    value: "true",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DURATION_MS / 1000,
  });
}

function clearDevDashboardBypassCookie(response: NextResponse) {
  response.cookies.set({
    name: DEV_DASHBOARD_BYPASS_COOKIE_NAME,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

function clearDeveloperSessionCookies(response: NextResponse) {
  for (const name of DEVELOPER_SESSION_COOKIE_NAMES) {
    response.cookies.set({
      name,
      value: "",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
  }
}

function getPreferredLocale(request: Request) {
  return request.headers.get("accept-language")?.split(",")[0]?.trim();
}

function getErrorCode(cause: unknown) {
  return cause instanceof Error ? cause.message : undefined;
}

function isDatabaseConnectionError(cause: unknown) {
  const message = getErrorCode(cause)?.toLowerCase();

  return Boolean(
    message &&
      (
        message.includes("password authentication failed") ||
        message.includes("self-signed certificate") ||
        message.includes("certificate") ||
        message.includes("pg_hba.conf") ||
        message.includes("econnrefused") ||
        message.includes("etimedout") ||
        message.includes("timeout expired") ||
        message.includes("connection terminated unexpectedly") ||
        message.includes("no route to host") ||
        message.includes("could not connect to server") ||
        message.includes("relation \"app_users\" does not exist") ||
        message.includes("type \"app_user_role\" does not exist")
      )
  );
}

function isIdentityToolkitApiDisabled(cause: unknown) {
  const message = getErrorCode(cause);

  return Boolean(
    message?.includes("Identity Toolkit API has not been used") ||
      message?.includes("identitytoolkit.googleapis.com")
  );
}

function mapSignInError(cause: unknown) {
  if (isIdentityToolkitApiDisabled(cause)) {
    return "identity_platform_api_disabled";
  }

  if (isDatabaseConnectionError(cause)) {
    return "auth_store_unavailable";
  }

  switch (getErrorCode(cause)) {
    case "EMAIL_NOT_FOUND":
    case "INVALID_PASSWORD":
    case "INVALID_LOGIN_CREDENTIALS":
      return "invalid_credentials";
    case "INVALID_EMAIL":
      return "invalid_email";
    case "USER_DISABLED":
      return "account_disabled";
    case "TOO_MANY_ATTEMPTS_TRY_LATER":
      return "rate_limited";
    case "OPERATION_NOT_ALLOWED":
      return "password_login_disabled";
    default:
      return "identity_platform";
  }
}

function mapForgotPasswordError(cause: unknown) {
  if (isIdentityToolkitApiDisabled(cause)) {
    return "identity_platform_api_disabled";
  }

  switch (getErrorCode(cause)) {
    case "EMAIL_NOT_FOUND":
      return undefined;
    case "INVALID_EMAIL":
      return "invalid_email";
    case "TOO_MANY_ATTEMPTS_TRY_LATER":
      return "rate_limited";
    case "OPERATION_NOT_ALLOWED":
      return "password_reset_disabled";
    default:
      return "password_reset_unavailable";
  }
}

function logAuthError(context: string, cause: unknown) {
  if (cause instanceof Error) {
    console.error(`[auth-session] ${context}`, {
      message: cause.message,
      stack: cause.stack,
    });
    return;
  }

  console.error(`[auth-session] ${context}`, {
    cause,
  });
}

async function parseAuthRequest(request: Request): Promise<ParsedAuthRequest> {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    const payload = (await request.json()) as {
      email?: string;
      intent?: string;
      password?: string;
    };

    return {
      email: normalizeEmail(payload.email),
      intent: normalizeIntent(payload.intent),
      password: payload.password,
    };
  }

  if (
    contentType.includes("application/x-www-form-urlencoded") ||
    contentType.includes("multipart/form-data")
  ) {
    const formData = await request.formData();

    return {
      email: normalizeEmail(formData.get("email")?.toString()),
      intent: normalizeIntent(formData.get("intent")?.toString()),
      password: formData.get("password")?.toString(),
    };
  }

  return {
    email: undefined,
    intent: "sign-in",
    password: undefined,
  };
}

export async function POST(request: Request) {
  const expectsJson = wantsJsonResponse(request);

  try {
    const payload = await parseAuthRequest(request);
    const origin = request.headers.get("origin");
    const requestOrigin = getRequestOrigin(request);

    if (!origin || new URL(origin).origin !== requestOrigin) {
      if (expectsJson) {
        return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
      }

      return redirectAfterPost(request, "/", {
        error: "origin",
        ...(payload.intent === "forgot-password"
          ? { mode: "forgot-password" }
          : {}),
      });
    }

    if (
      payload.intent === "sign-in" &&
      isDevDashboardBypassEnabled() &&
      !payload.email &&
      !payload.password
    ) {
      const response = expectsJson
        ? NextResponse.json({ ok: true, bypass: true })
        : redirectAfterPost(request, "/");

      setDevDashboardBypassCookie(response);

      return response;
    }

    if (!payload.email) {
      if (expectsJson) {
        return NextResponse.json(
          { error: "Email is required." },
          { status: 400 }
        );
      }

      return redirectAfterPost(request, "/", {
        error: "missing_email",
        ...(payload.intent === "forgot-password"
          ? { mode: "forgot-password" }
          : {}),
      });
    }

    if (payload.intent === "forgot-password") {
      try {
        await sendClientPasswordResetEmail(
          payload.email,
          getPreferredLocale(request)
        );
      } catch (cause) {
        const error = mapForgotPasswordError(cause);

        if (error) {
          if (expectsJson) {
            return NextResponse.json({ error }, { status: 400 });
          }

          return redirectAfterPost(request, "/", {
            error,
            mode: "forgot-password",
          });
        }
      }

      if (expectsJson) {
        return NextResponse.json({ ok: true });
      }

      return redirectAfterPost(request, "/", {
        notice: "password_reset_sent",
      });
    }

    if (!payload.password) {
      if (expectsJson) {
        return NextResponse.json(
          { error: "Password is required." },
          { status: 400 }
        );
      }

      return redirectAfterPost(request, "/", {
        error: "missing_password",
      });
    }

    const { claims, sessionCookie } =
      await createClientSessionFromEmailPassword(
        payload.email,
        payload.password,
        SESSION_DURATION_MS / 1000
      );

    await upsertIdentityUser(claims);

    const successResponse = expectsJson
      ? NextResponse.json({ ok: true })
      : redirectAfterPost(request, "/");

    successResponse.cookies.set({
      name: SESSION_COOKIE_NAME,
      value: sessionCookie,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_DURATION_MS / 1000,
    });

    return successResponse;
  } catch (cause) {
    logAuthError("sign-in failed", cause);

    if (expectsJson) {
      return NextResponse.json(
        { error: mapSignInError(cause) },
        { status: 401 }
      );
    }

    return redirectAfterPost(request, "/", {
      error: mapSignInError(cause),
    });
  }
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  clearDevDashboardBypassCookie(response);
  clearDeveloperSessionCookies(response);

  return response;
}
