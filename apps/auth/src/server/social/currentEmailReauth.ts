import { randomBytes } from "node:crypto";
import { query } from "../../db.js";
import { verifyCurrentAccountSession } from "../browserSession.js";
import { initiateCurrentEmailOtp, verifyCurrentEmailOtpPrincipal } from "../cognito/cognitoAuth.js";
import { resolveAccountRecoveryEmail } from "./accountMethods.js";
import { decideOtpRateLimit, recordOtpSendDecision } from "../otp/otpRateLimit.js";
import { authAttemptBindingHash, authHandleHash, openAuthAttemptState, sealAuthAttemptState } from "./attemptStore.js";
import {
  AuthAttemptError, requireAuthHandle, type AuthCompletionResponse, type AuthReauthenticationBinding,
  type EmailAuthAttemptRequest, type EmailAuthAttemptResponse,
} from "./attemptContract.js";

type EmailAttemptRow = Readonly<{
  claim_id: string;
  snapshot_subject: string;
  snapshot_username: string;
  email_address: string;
  secret_ciphertext: string;
  expires_at: Date;
}>;

/** No caller-provided email, principal, account or authentication timestamp can authorize this flow. */
export async function beginCurrentEmailReauthentication(
  sessionToken: string, request: EmailAuthAttemptRequest, browser: Readonly<{ origin: string; secret: string }> | null,
  source: string,
): Promise<EmailAuthAttemptResponse> {
  if (request.method !== "email" || request.purpose !== "reauth"
    || !["web", "android", "ios", "ios-development", "macos", "macos-development"].includes(request.client)
    || (request.client === "web") !== (browser !== null)
    || (request.client === "web") !== (request.codeChallenge === null)) throw new AuthAttemptError("AUTH_ATTEMPT_INVALID");
  const current = await verifyCurrentAccountSession(sessionToken);
  const recovery = await resolveAccountRecoveryEmail(current.subject, current.username, current.authTime,
    current.emailVerified ? current.email : null);
  if (recovery === null) throw new AuthAttemptError("AUTH_ATTEMPT_INVALID");
  let binding: string;
  if (browser !== null) {
    binding = authAttemptBindingHash({ client: "web", purpose: "reauth", origin: browser.origin, browserSecret: browser.secret });
  } else {
    if (request.codeChallenge === null || !/^[A-Za-z0-9_-]{43}$/.test(request.codeChallenge)) {
      throw new AuthAttemptError("AUTH_ATTEMPT_INVALID");
    }
    binding = Buffer.from(request.codeChallenge, "base64url").toString("hex");
  }
  const handle = randomBytes(32).toString("base64url");
  const parameters = [authHandleHash(handle), request.client, binding, browser?.origin ?? null, current.subject, current.username,
    recovery.email, current.authTime, sealAuthAttemptState(handle, JSON.stringify({ session: null }))];
  const result = recovery.enrollment === "registered"
    ? await query<EmailAttemptRow>("SELECT * FROM auth.create_email_auth_attempt($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
      [...parameters, recovery.cognitoSubject, recovery.cognitoUsername])
    : await query<EmailAttemptRow>("SELECT * FROM auth.create_email_auth_attempt($1,$2,$3,$4,$5,$6,$7,$8,$9)", parameters);
  const attempt = result.rows[0];
  if (attempt === undefined) throw new Error("Email reauthentication creation returned no attempt");
  const decision = await decideOtpRateLimit(attempt.email_address, source);
  if (decision.kind !== "send") {
    await recordOtpSendDecision(attempt.email_address, source,
      decision.kind === "block_ip_limit" ? "blocked_ip_limit" : "suppressed_email_limit", null);
    throw new AuthAttemptError("AUTH_RATE_LIMITED");
  }
  const challenge = await initiateCurrentEmailOtp(attempt.email_address, attempt.snapshot_username);
  await query("SELECT auth.ready_email_auth_attempt($1,$2,$3)", [
    authHandleHash(handle), attempt.claim_id, sealAuthAttemptState(handle, JSON.stringify(challenge)),
  ]);
  await recordOtpSendDecision(attempt.email_address, source, "sent", null);
  return { attempt: handle, expiresAt: attempt.expires_at.toISOString(), email: attempt.email_address };
}

/** Claim commits before the one external step; any ambiguous outcome requires a fresh attempt. */
export async function completeCurrentEmailReauthentication(
  sessionToken: string, handle: string, binding: AuthReauthenticationBinding, code: string,
): Promise<AuthCompletionResponse> {
  requireAuthHandle(handle);
  if (binding.purpose !== "reauth" || !/^[0-9]{6,8}$/.test(code)) throw new AuthAttemptError("AUTH_ATTEMPT_INVALID");
  const current = await verifyCurrentAccountSession(sessionToken);
  const result = await query<EmailAttemptRow>("SELECT * FROM auth.claim_email_auth_attempt($1,$2,$3,$4,$5,$6,$7)", [
    authHandleHash(handle), authAttemptBindingHash(binding), binding.client, binding.client === "web" ? binding.origin : null,
    current.subject, current.username, current.authTime,
  ]);
  const attempt = result.rows[0];
  if (attempt === undefined) {
    throw new AuthAttemptError("AUTH_ATTEMPT_RESTART_REQUIRED");
  }
  const state = JSON.parse(openAuthAttemptState(handle, attempt.secret_ciphertext)) as Readonly<{ session: string }>;
  if (typeof state.session !== "string" || state.session.length < 20 || state.session.length > 16_384) {
    throw new AuthAttemptError("AUTH_ATTEMPT_RESTART_REQUIRED");
  }
  const principal = await verifyCurrentEmailOtpPrincipal(attempt.email_address, attempt.snapshot_username, code, state.session);
  const completion = randomBytes(32).toString("base64url");
  const completed = await query<Readonly<{ expires_at: Date }>>(
    "SELECT auth.complete_email_auth_attempt($1,$2,$3,$4,$5,$6,$7) AS expires_at",
    [authHandleHash(handle), attempt.claim_id, principal.cognitoSubject, principal.cognitoUsername,
      principal.email, principal.authTime, authHandleHash(completion)],
  );
  const expiry = completed.rows[0]?.expires_at;
  if (expiry === undefined) throw new Error("Email reauthentication completion returned no expiry");
  return { completion, expiresAt: expiry.toISOString() };
}
