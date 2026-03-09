/**
 * Email OTP verification endpoint. Reads the OTP session from an HMAC-signed
 * cookie, validates the 8-digit code via Cognito RespondToAuthChallenge,
 * and on success sets session + refresh + logged_in cookies AND returns
 * tokens in the response body for mobile clients.
 *
 * CSRF token is compared with crypto.timingSafeEqual to prevent timing attacks.
 */
import { timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { deleteCookie, getCookie } from "hono/cookie";
import { type AuthAppEnv, getRequestId, jsonAuthError } from "../server/apiErrors.js";
import { verifyEmailOtp } from "../server/cognitoAuth.js";
import { setBrowserSessionCookies } from "../server/browserSession.js";
import { verify } from "../server/crypto.js";
import { log } from "../server/logger.js";

const app = new Hono<AuthAppEnv>();

const CODE_RE = /^\d{8}$/;
const OTP_TTL_MS = 180_000; // 3 minutes

type OtpPayload = Readonly<{
  s: string;   // Cognito session
  e: string;   // email
  csrf: string; // CSRF token
  t: number;   // timestamp
}>;

app.post("/api/verify-code", async (c) => {
  let body: { code?: string; csrfToken?: string; otpSessionToken?: string };
  try {
    body = await c.req.json<{ code?: string; csrfToken?: string; otpSessionToken?: string }>();
  } catch {
    return jsonAuthError(c, 400, "INVALID_REQUEST", "Invalid request.");
  }

  // Prefer the explicit body token for native clients. Browser flow still falls
  // back to the existing httpOnly cookie without changing its behavior.
  const signedSession = typeof body.otpSessionToken === "string" && body.otpSessionToken.length > 0
    ? body.otpSessionToken
    : (getCookie(c, "otp_session") ?? "");

  if (signedSession === "") {
    return jsonAuthError(c, 400, "OTP_SESSION_EXPIRED", "Code expired. Request a new one.");
  }

  let payload: OtpPayload;
  try {
    const verified = verify(signedSession);
    payload = JSON.parse(verified) as OtpPayload;
  } catch {
    return jsonAuthError(c, 400, "OTP_SESSION_EXPIRED", "Code expired. Request a new one.");
  }

  if (Date.now() - payload.t > OTP_TTL_MS) {
    return jsonAuthError(c, 400, "OTP_SESSION_EXPIRED", "Code expired. Request a new one.");
  }

  // Constant-time CSRF token comparison
  const csrfToken = typeof body.csrfToken === "string" ? body.csrfToken : "";
  const csrfMatch =
    csrfToken.length === payload.csrf.length &&
    timingSafeEqual(Buffer.from(csrfToken), Buffer.from(payload.csrf));
  if (!csrfMatch) {
    return jsonAuthError(c, 400, "OTP_SESSION_EXPIRED", "Code expired. Request a new one.");
  }

  const code = typeof body.code === "string" ? body.code.trim() : "";

  if (!CODE_RE.test(code)) {
    return jsonAuthError(c, 400, "OTP_CODE_INVALID", "Enter a valid 8-digit code.");
  }

  const requestId = getRequestId(c);
  let tokens: Awaited<ReturnType<typeof verifyEmailOtp>>;
  try {
    tokens = await verifyEmailOtp(payload.e, code, payload.s);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log({
      domain: "auth",
      action: "verify_code_error",
      requestId,
      route: c.req.path,
      statusCode: 400,
      code: "OTP_VERIFY_FAILED",
      error: message,
    });
    return jsonAuthError(c, 400, "OTP_VERIFY_FAILED", "Could not verify the code. Try again.");
  }

  // Shared session cookies are visible on app.* and auth.* subdomains.
  setBrowserSessionCookies(c, tokens.idToken, tokens.refreshToken);

  // Clear OTP cookie
  deleteCookie(c, "otp_session", { path: "/", secure: true });

  // Return tokens in body for mobile clients
  return c.json({
    ok: true,
    idToken: tokens.idToken,
    refreshToken: tokens.refreshToken,
    expiresIn: tokens.expiresIn,
  });
});

export default app;
