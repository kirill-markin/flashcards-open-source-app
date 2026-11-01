import { CognitoJwtVerifier } from "aws-jwt-verify";
import {
  JwtInvalidClaimError,
  JwtInvalidSignatureAlgorithmError,
  JwtInvalidSignatureError,
  JwtParseError,
  JwtWithoutValidKidError,
  KidNotFoundInJwksError,
} from "aws-jwt-verify/error";
import type { Context } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";
import { isTransientDatabaseError } from "./databaseErrors.js";
import { parseCookieDomainCandidates, resolveCookieDomain } from "./cookieDomain.js";
import { log } from "./logger.js";
import { assertVerifiedPrincipalSession, PrincipalSessionError } from "./social/principalSessions.js";

// 400 days, the browser cap on cookie lifetime.
const SESSION_COOKIE_MAX_AGE_SECONDS = 34_560_000;

export const verifiedBrowserSession = Symbol("verified browser session presentation");
export type BrowserSessionPresentation = Readonly<{ subject: string; authTime: number }>;

function sessionPresentation(payload: Readonly<{ sub: string; auth_time?: unknown }>): BrowserSessionPresentation | undefined {
  return typeof payload.auth_time === "number" && Number.isSafeInteger(payload.auth_time)
    && payload.auth_time >= 0 && payload.auth_time <= Math.floor(Date.now() / 1_000) + 30
    ? { subject: payload.sub, authTime: payload.auth_time } : undefined;
}

type SessionTokenValidationResult =
  | Readonly<{ status: "valid"; presentation: BrowserSessionPresentation | undefined }>
  | Readonly<{ status: "invalid"; reason: string }>
  | Readonly<{ status: "error"; reason: string }>;

type VerifiedSessionTokenPayload = Readonly<{
  sub: string;
  email?: unknown;
  email_verified?: unknown;
}>;

export type SessionUserIdentity = Readonly<{
  userId: string;
  email: string;
  emailVerified: boolean;
}>;

let verifier: ReturnType<typeof CognitoJwtVerifier.create> | undefined;

function getUserPoolId(): string {
  const userPoolId = process.env.COGNITO_USER_POOL_ID ?? "";
  if (userPoolId === "") {
    throw new Error("COGNITO_USER_POOL_ID is not configured");
  }

  return userPoolId;
}

function getClientId(): string {
  const clientId = process.env.COGNITO_CLIENT_ID ?? "";
  if (clientId === "") {
    throw new Error("COGNITO_CLIENT_ID is not configured");
  }

  return clientId;
}

function getVerifier(): ReturnType<typeof CognitoJwtVerifier.create> {
  if (verifier !== undefined) {
    return verifier;
  }

  verifier = CognitoJwtVerifier.create({
    userPoolId: getUserPoolId(),
    tokenUse: "id",
    clientId: getClientId(),
  });

  return verifier;
}

/**
 * Unset means host-only, as it always has: local development runs one origin and needs no shared
 * scope. Configured, the domain is the one the request's host sits under (./cookieDomain.ts), so
 * every host that serves browsers keeps a session whichever registrable domain it is on.
 */
function getCookieDomain(context: Context): string | undefined {
  const candidates = parseCookieDomainCandidates(process.env.COOKIE_DOMAIN);
  if (candidates.length === 0) {
    return undefined;
  }

  return resolveCookieDomain(context.req.header("host"), candidates);
}

function getCookieOptions(context: Context): Readonly<{
  path: string;
  secure: boolean;
  sameSite: "Lax";
  domain: string | undefined;
}> {
  return {
    path: "/",
    secure: true,
    sameSite: "Lax",
    domain: getCookieDomain(context),
  };
}

export async function validateSessionToken(sessionToken: string): Promise<SessionTokenValidationResult> {
  try {
    return { status: "valid", presentation: await assertIssuedSessionToken(sessionToken) };
  } catch (error) {
    if (isTransientDatabaseError(error) || (error instanceof PrincipalSessionError && error.statusCode === 503)) throw error;
    const reason = error instanceof Error ? error.message : String(error);
    if (
      (error instanceof PrincipalSessionError && error.statusCode !== 503) ||
      error instanceof JwtParseError ||
      error instanceof JwtInvalidSignatureError ||
      error instanceof JwtInvalidSignatureAlgorithmError ||
      error instanceof JwtInvalidClaimError ||
      error instanceof JwtWithoutValidKidError ||
      error instanceof KidNotFoundInJwksError
    ) {
      return { status: "invalid", reason };
    }

    return { status: "error", reason };
  }
}

export async function assertIssuedSessionToken(sessionToken: string): Promise<BrowserSessionPresentation | undefined> {
  const payload = await getVerifier().verify(sessionToken);
  await assertVerifiedPrincipalSession(payload);
  return sessionPresentation(payload);
}

/** Internal management retains signed original authentication time, including unfenced legacy sessions. */
export async function verifyCurrentAccountSession(sessionToken: string): Promise<Readonly<{
  subject: string; username: string; email: string; emailVerified: boolean; authTime: number | null;
}>> {
  const payload = await getVerifier().verify(sessionToken);
  await assertVerifiedPrincipalSession(payload);
  const identity = extractVerifiedSessionIdentity(payload);
  const username = payload["cognito:username"];
  if (typeof username !== "string" || username.trim() === "") throw new Error("Cognito ID token is missing immutable username");
  return { subject: payload.sub, username, email: identity.email, emailVerified: identity.emailVerified, authTime: typeof payload.auth_time === "number" && Number.isSafeInteger(payload.auth_time)
    && payload.auth_time >= 0 && payload.auth_time <= Math.floor(Date.now() / 1_000) + 30 ? payload.auth_time : null };
}

export class IssuedSessionValidationError extends Error {
  constructor(cause: unknown) {
    super("Cognito returned tokens, but session validation could not complete.", { cause });
    this.name = "IssuedSessionValidationError";
  }
}

/** A failed check here follows successful Cognito authentication and may follow a consumed proof. */
export async function assertNewlyIssuedSessionToken(sessionToken: string): Promise<BrowserSessionPresentation | undefined> {
  try {
    return await assertIssuedSessionToken(sessionToken);
  } catch (error) {
    if (error instanceof PrincipalSessionError) throw error;
    log({ domain: "auth", action: "issued_session_validation_error",
      error: error instanceof Error ? error.message : String(error) });
    throw new IssuedSessionValidationError(error);
  }
}

export function extractVerifiedSessionIdentity(payload: VerifiedSessionTokenPayload): SessionUserIdentity {
  const email = typeof payload.email === "string" ? payload.email.trim() : "";
  if (email === "") {
    throw new Error("Cognito ID token is missing email claim");
  }

  return {
    userId: payload.sub,
    email,
    // Synthetic review accounts bypass mailbox verification.
    emailVerified: payload.email_verified === true && !email.toLowerCase().endsWith("@example.com"),
  };
}

export async function verifySessionTokenIdentity(sessionToken: string): Promise<SessionUserIdentity> {
  const payload = await getVerifier().verify(sessionToken);
  await assertVerifiedPrincipalSession(payload);
  return extractVerifiedSessionIdentity(payload as VerifiedSessionTokenPayload);
}

// Domain cookies on the resolved cookie domain, not `__Host-` host-only ones: `app.<domain>` is a
// static CloudFront/S3 SPA, and neither `auth.` nor `api.` can set a host-only cookie for it without
// a proxy or edge layer in front of the app.
export function setBrowserSessionCookies(
  context: Context,
  sessionToken: string,
  refreshToken: string,
): void {
  const cookieOptions = getCookieOptions(context);

  setCookie(context, "session", sessionToken, {
    ...cookieOptions,
    maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
    httpOnly: true,
  });

  setCookie(context, "refresh", refreshToken, {
    ...cookieOptions,
    maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
    httpOnly: true,
  });

  setCookie(context, "logged_in", "1", {
    ...cookieOptions,
    maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
    httpOnly: false,
  });
}

export function clearBrowserSessionCookies(context: Context): void {
  const cookieOptions = getCookieOptions(context);

  deleteCookie(context, "session", cookieOptions);
  deleteCookie(context, "refresh", cookieOptions);
  deleteCookie(context, "logged_in", cookieOptions);
}
