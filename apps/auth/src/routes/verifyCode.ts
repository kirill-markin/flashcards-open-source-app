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
import { verifyEmailOtp } from "../server/cognitoAuth.js";
import { setBrowserSessionCookies } from "../server/browserSession.js";
import { verify } from "../server/crypto.js";
import { log } from "../server/logger.js";

const app = new Hono();

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
    return c.json({ error: "Invalid request body" }, 400);
  }

  // Prefer the explicit body token for native clients. Browser flow still falls
  // back to the existing httpOnly cookie without changing its behavior.
  const signedSession = typeof body.otpSessionToken === "string" && body.otpSessionToken.length > 0
    ? body.otpSessionToken
    : (getCookie(c, "otp_session") ?? "");

  if (signedSession === "") {
    return c.json({ error: "Session expired — request a new code" }, 400);
  }

  let payload: OtpPayload;
  try {
    const verified = verify(signedSession);
    payload = JSON.parse(verified) as OtpPayload;
  } catch {
    return c.json({ error: "Session expired — request a new code" }, 400);
  }

  if (Date.now() - payload.t > OTP_TTL_MS) {
    return c.json({ error: "Session expired — request a new code" }, 400);
  }

  // Constant-time CSRF token comparison
  const csrfToken = typeof body.csrfToken === "string" ? body.csrfToken : "";
  const csrfMatch =
    csrfToken.length === payload.csrf.length &&
    timingSafeEqual(Buffer.from(csrfToken), Buffer.from(payload.csrf));
  if (!csrfMatch) {
    return c.json({ error: "Session expired — request a new code" }, 400);
  }

  const code = typeof body.code === "string" ? body.code.trim() : "";

  if (!CODE_RE.test(code)) {
    return c.json({ error: "Enter an 8-digit code" }, 400);
  }

  let tokens: Awaited<ReturnType<typeof verifyEmailOtp>>;
  try {
    tokens = await verifyEmailOtp(payload.e, code, payload.s);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log({ domain: "auth", action: "verify_code_error", error: message });
    return c.json({ error: "Verification failed — please try again" }, 400);
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
