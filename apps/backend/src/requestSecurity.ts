import { createHmac, timingSafeEqual } from "node:crypto";
import type { AuthRequest } from "./auth";
import { HttpError } from "./errors";
import { getBackendCsrfSecret } from "./secrets";

/**
 * Request fields used to authenticate the caller and validate browser-only
 * CSRF protection for shared-domain session cookies.
 */
export type RequestAuthInputs = Readonly<{
  authorizationHeader: string | undefined;
  sessionToken: string | undefined;
  csrfTokenHeader: string | undefined;
  originHeader: string | undefined;
  refererHeader: string | undefined;
  secFetchSiteHeader: string | undefined;
}>;

function getHeaderValue(request: Request, headerName: string): string | undefined {
  const value = request.headers.get(headerName);
  if (value === null) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function getCookieValue(request: Request, cookieName: string): string | undefined {
  const cookieHeader = request.headers.get("cookie");
  if (cookieHeader === null || cookieHeader === "") {
    return undefined;
  }

  const cookies = cookieHeader.split(";");

  for (const cookie of cookies) {
    const [name, ...valueParts] = cookie.trim().split("=");
    if (name !== cookieName) {
      continue;
    }

    return decodeURIComponent(valueParts.join("="));
  }

  return undefined;
}

function isUnsafeMethod(method: string): boolean {
  return method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
}

function getRequestOrigin(originHeader: string | undefined, refererHeader: string | undefined): string {
  if (originHeader !== undefined) {
    return originHeader;
  }

  if (refererHeader === undefined) {
    throw new HttpError(403, "Missing Origin or Referer header");
  }

  try {
    return new URL(refererHeader).origin;
  } catch {
    throw new HttpError(403, "Invalid Referer header");
  }
}

function createSessionCsrfToken(sessionToken: string, csrfSecret: string): string {
  return createHmac("sha256", csrfSecret)
    .update(sessionToken)
    .digest("base64url");
}

function isMatchingToken(expectedToken: string, actualToken: string): boolean {
  if (expectedToken.length !== actualToken.length) {
    return false;
  }

  return timingSafeEqual(Buffer.from(expectedToken), Buffer.from(actualToken));
}

function getBackendCsrfSecretArn(): string {
  const secretArn = process.env.BACKEND_CSRF_SECRET_ARN;
  if (secretArn === undefined || secretArn.trim() === "") {
    throw new Error("BACKEND_CSRF_SECRET_ARN is required for session-based CSRF protection");
  }

  return secretArn;
}

/**
 * Reads all auth- and CSRF-related inputs once so routes can share a single
 * source of truth for bearer auth, session auth, and browser protection.
 */
export function extractRequestAuthInputs(request: Request): RequestAuthInputs {
  return {
    authorizationHeader: getHeaderValue(request, "authorization"),
    sessionToken: getCookieValue(request, "session"),
    csrfTokenHeader: getHeaderValue(request, "x-csrf-token"),
    originHeader: getHeaderValue(request, "origin"),
    refererHeader: getHeaderValue(request, "referer"),
    secFetchSiteHeader: getHeaderValue(request, "sec-fetch-site"),
  };
}

export function toAuthRequest(requestAuthInputs: RequestAuthInputs): AuthRequest {
  return {
    authorizationHeader: requestAuthInputs.authorizationHeader,
    sessionToken: requestAuthInputs.sessionToken,
  };
}

/**
 * Derives a stateless CSRF token from the current session JWT. This keeps the
 * browser flow compatible with domain-wide SSO and avoids storing CSRF state.
 */
export async function getSessionCsrfToken(sessionToken: string): Promise<string> {
  const csrfSecret = await getBackendCsrfSecret(getBackendCsrfSecretArn());
  return createSessionCsrfToken(sessionToken, csrfSecret);
}

/**
 * Applies browser CSRF checks only to unsafe requests authenticated by the
 * shared session cookie. Bearer-token requests are intentionally excluded.
 */
export async function enforceSessionCsrfProtection(
  method: string,
  requestAuthInputs: RequestAuthInputs,
  allowedOrigins: ReadonlyArray<string>,
): Promise<void> {
  if (!isUnsafeMethod(method)) {
    return;
  }

  if (requestAuthInputs.secFetchSiteHeader?.toLowerCase() === "cross-site") {
    throw new HttpError(403, "Cross-site browser requests are not allowed");
  }

  const requestOrigin = getRequestOrigin(
    requestAuthInputs.originHeader,
    requestAuthInputs.refererHeader,
  );
  if (!allowedOrigins.includes(requestOrigin)) {
    throw new HttpError(403, "Origin is not allowed for session request");
  }

  const csrfToken = requestAuthInputs.csrfTokenHeader;
  if (csrfToken === undefined) {
    throw new HttpError(403, "Missing X-CSRF-Token header");
  }

  const sessionToken = requestAuthInputs.sessionToken;
  if (sessionToken === undefined) {
    throw new Error("Session token is required for session-based CSRF protection");
  }

  const expectedToken = await getSessionCsrfToken(sessionToken);
  if (!isMatchingToken(expectedToken, csrfToken)) {
    throw new HttpError(403, "Invalid X-CSRF-Token header");
  }
}
