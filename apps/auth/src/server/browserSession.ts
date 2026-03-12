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

const SESSION_COOKIE_MAX_AGE_SECONDS = 3_024_000;

type SessionTokenValidationResult =
  | Readonly<{ status: "valid" }>
  | Readonly<{ status: "invalid"; reason: string }>
  | Readonly<{ status: "error"; reason: string }>;

type VerifiedSessionTokenPayload = Readonly<{
  sub: string;
  email?: unknown;
}>;

export type SessionUserIdentity = Readonly<{
  userId: string;
  email: string;
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

function getCookieDomain(): string | undefined {
  const domain = process.env.COOKIE_DOMAIN ?? "";
  return domain === "" ? undefined : domain;
}

function getCookieOptions(): Readonly<{
  path: string;
  secure: boolean;
  sameSite: "Lax";
  domain: string | undefined;
}> {
  return {
    path: "/",
    secure: true,
    sameSite: "Lax",
    domain: getCookieDomain(),
  };
}

export async function validateSessionToken(sessionToken: string): Promise<SessionTokenValidationResult> {
  try {
    await getVerifier().verify(sessionToken);
    return { status: "valid" };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (
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

/**
 * Verifies a Cognito ID token issued for this app and returns the stable user
 * identity so the auth service can create first-party agent API keys.
 */
export function extractVerifiedSessionIdentity(payload: VerifiedSessionTokenPayload): SessionUserIdentity {
  const email = typeof payload.email === "string" ? payload.email.trim() : "";
  if (email === "") {
    throw new Error("Cognito ID token is missing email claim");
  }

  return {
    userId: payload.sub,
    email,
  };
}

export async function verifySessionTokenIdentity(sessionToken: string): Promise<SessionUserIdentity> {
  const payload = await getVerifier().verify(sessionToken);
  return extractVerifiedSessionIdentity(payload as VerifiedSessionTokenPayload);
}

export function setBrowserSessionCookies(
  context: Context,
  sessionToken: string,
  refreshToken: string,
): void {
  const cookieOptions = getCookieOptions();

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
  const cookieOptions = getCookieOptions();

  deleteCookie(context, "session", cookieOptions);
  deleteCookie(context, "refresh", cookieOptions);
  deleteCookie(context, "logged_in", cookieOptions);
}
