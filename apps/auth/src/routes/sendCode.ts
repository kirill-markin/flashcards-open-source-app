/**
 * Email OTP initiation endpoint. Accepts an email address, calls Cognito
 * InitiateAuth with EMAIL_OTP challenge, and stores the Cognito session
 * in an HMAC-signed cookie. No database needed.
 *
 * Auto-creates the Cognito account if the user doesn't exist yet.
 *
 * A random delay (200-800 ms) is added before responding to equalise timing
 * between new and existing users, preventing email-existence enumeration.
 *
 * Security: HMAC-signed cookie + CSRF token + 3-min TTL.
 */
import { randomBytes, randomInt } from "node:crypto";
import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import { initiateEmailOtp } from "../server/cognitoAuth.js";
import { sign } from "../server/crypto.js";
import { log, maskEmail } from "../server/logger.js";

const app = new Hono();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const JITTER_MIN_MS = 200;
const JITTER_MAX_MS = 800;
const jitterDelay = (): Promise<void> =>
  new Promise((resolve) => {
    const ms = randomInt(JITTER_MIN_MS, JITTER_MAX_MS);
    setTimeout(resolve, ms);
  });

app.post("/api/send-code", async (c) => {
  let body: { email?: string };
  try {
    body = await c.req.json<{ email?: string }>();
  } catch {
    return c.json({ error: "Invalid request body" }, 400);
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";

  if (!EMAIL_RE.test(email) || email.length > 256) {
    return c.json({ error: "Invalid email" }, 400);
  }

  let session: string;
  try {
    const [result] = await Promise.all([initiateEmailOtp(email), jitterDelay()]);
    session = result.session;
  } catch (err) {
    log({ domain: "auth", action: "send_code_error", error: err instanceof Error ? err.message : String(err) });
    return c.json({ error: "Failed to send code — please try again" }, 500);
  }

  log({ domain: "auth", action: "send_code", maskedEmail: maskEmail(email) });

  const csrfToken = randomBytes(32).toString("hex");

  const payload = JSON.stringify({
    s: session,
    e: email,
    csrf: csrfToken,
    t: Date.now(),
  });

  const signed = sign(payload);

  setCookie(c, "otp_session", signed, {
    path: "/",
    maxAge: 180,
    httpOnly: true,
    secure: true,
    sameSite: "Strict",
  });

  // Browser login keeps using the httpOnly cookie, but native clients need the
  // same signed OTP session in the response body because they should not depend
  // on browser-cookie behavior to complete verify-code.
  return c.json({ ok: true, csrfToken, otpSessionToken: signed });
});

export default app;
