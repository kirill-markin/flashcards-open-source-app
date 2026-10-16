import { query } from "../../db.js";
import { verifyCurrentAccountSession } from "../browserSession.js";
import { initiateCurrentEmailOtp, loadExistingEmailPrincipal, verifyCurrentEmailOtpPrincipal } from "../cognito/cognitoAuth.js";
import { decideOtpRateLimit, recordOtpSendDecision } from "../otp/otpRateLimit.js";
import { normalizeEnrollmentEmail } from "./mailboxProof.js";
import { requireAuthHandle, type AuthAttemptRequest, type AuthAttemptResponse, type AuthProviderSubmission } from "./attemptContract.js";
import {
  authHandleHash, claimConnectionProviderAttempt, prepareAuthAttempt, sealAuthAttemptState, openAuthAttemptState,
  verifyClaimedAuthAttempt,
} from "./attemptStore.js";
import { connectionParameters, connectionReceipt } from "./accountConnectionStore.js";
import {
  AccountConnectionError, type ConnectionBinding, type ConnectionReceipt, type ConnectionRow, type ConnectionEmailRow,
} from "./accountConnectionContract.js";
import { appleRequestNonce } from "./providers.js";
import { createHash } from "node:crypto";

export async function beginConnectionProviderProof(
  sessionToken: string, operation: string, binding: ConnectionBinding, request: AuthAttemptRequest,
  browser: Readonly<{ origin: string; secret: string }> | null, authOrigin: string,
): Promise<AuthAttemptResponse> {
  if (request.purpose !== "login" || request.client !== binding.client
    || (browser !== null && (binding.client !== "web" || browser.origin !== binding.origin || browser.secret !== binding.browserSecret))) {
    throw new AccountConnectionError("ACCOUNT_CONNECTION_INVALID");
  }
  const current = await verifyCurrentAccountSession(sessionToken);
  const prepared = prepareAuthAttempt(request, browser, authOrigin);
  const result = await query<Readonly<{ expires_at: Date }>>(
    "SELECT auth.create_connection_provider_attempt($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) AS expires_at",
    [...connectionParameters(operation, current, binding), authHandleHash(prepared.handle), request.provider,
      prepared.binding, prepared.redirectUri, sealAuthAttemptState(prepared.handle, JSON.stringify(prepared.secrets))]);
  const expiry = result.rows[0]?.expires_at;
  if (expiry === undefined) throw new AccountConnectionError("ACCOUNT_CONNECTION_RESTART_REQUIRED");
  return { attempt: prepared.handle, nonce: request.provider === "apple" ? appleRequestNonce(prepared.secrets.nonce) : prepared.secrets.nonce,
    expiresAt: expiry.toISOString(), redirectUri: prepared.redirectUri,
    providerCodeChallenge: createHash("sha256").update(prepared.secrets.providerCodeVerifier).digest("base64url") };
}

/** The claim commits before the real provider exchange; failure never reopens the attempt. */
export async function completeConnectionProviderProof(
  sessionToken: string, operation: string, binding: ConnectionBinding, attemptHandle: string, submission: AuthProviderSubmission,
): Promise<ConnectionReceipt> {
  const current = await verifyCurrentAccountSession(sessionToken);
  const attempt = await claimConnectionProviderAttempt(attemptHandle, connectionParameters(operation, current, binding));
  const verified = await verifyClaimedAuthAttempt(attempt, submission);
  const proof = verified.secrets.proof;
  if (proof === null) throw new AccountConnectionError("ACCOUNT_CONNECTION_RESTART_REQUIRED");
  const email = proof.identity.email;
  const mailbox = email?.authority === "provider" && !email.privateRelay
    && !/@(privaterelay\.appleid\.com|private\.icloud\.com)$/.test(email.address)
    ? await loadExistingEmailPrincipal(email.address) : null;
  const result = await query<ConnectionRow>(
    "SELECT * FROM auth.record_connection_provider_proof($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
    [...connectionParameters(operation, current, binding), authHandleHash(attemptHandle), attempt.claimId,
      mailbox?.cognitoSubject ?? null, mailbox?.cognitoUsername ?? null, mailbox?.email ?? null]);
  return connectionReceipt(operation, result.rows[0]);
}

export async function beginConnectionEmailProof(
  sessionToken: string, operation: string, binding: ConnectionBinding, email: string, source: string,
): Promise<Readonly<{ email: string; expiresAt: string }>> {
  const current = await verifyCurrentAccountSession(sessionToken);
  // Authenticate the operation before a provider lookup, rate-limit record or message delivery.
  const loaded = await query<ConnectionRow>("SELECT * FROM auth.load_account_connection($1,$2,$3,$4,$5,$6,$7)", connectionParameters(operation, current, binding));
  connectionReceipt(operation, loaded.rows[0]);
  const normalized = normalizeEnrollmentEmail(email);
  const principal = await loadExistingEmailPrincipal(normalized);
  if (principal === null) throw new AccountConnectionError("ACCOUNT_CONNECTION_INVALID");
  const result = await query<ConnectionEmailRow>(
    "SELECT * FROM auth.begin_connection_email_proof($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
    [...connectionParameters(operation, current, binding), principal.cognitoSubject, principal.cognitoUsername, principal.email]);
  const row = result.rows[0];
  if (row === undefined) throw new AccountConnectionError("ACCOUNT_CONNECTION_RESTART_REQUIRED");
  const decision = await decideOtpRateLimit(row.target_email, source);
  if (decision.kind !== "send") {
    await recordOtpSendDecision(row.target_email, source,
      decision.kind === "block_ip_limit" ? "blocked_ip_limit" : "suppressed_email_limit", null);
    throw new AccountConnectionError("ACCOUNT_CONNECTION_RATE_LIMITED");
  }
  const challenge = await initiateCurrentEmailOtp(row.target_email, row.target_username);
  await query("SELECT auth.ready_connection_email_proof($1,$2,$3)",
    [authHandleHash(operation), row.email_claim, sealAuthAttemptState(operation, challenge.session)]);
  await recordOtpSendDecision(row.target_email, source, "sent", null);
  return { email: row.target_email, expiresAt: row.expires_at.toISOString() };
}

/** Cognito tokens stay within verifyCurrentEmailOtpPrincipal and are discarded server-side. */
export async function completeConnectionEmailProof(
  sessionToken: string, operation: string, binding: ConnectionBinding, code: string,
): Promise<ConnectionReceipt> {
  requireAuthHandle(operation);
  if (!/^[0-9]{6,8}$/.test(code)) throw new AccountConnectionError("ACCOUNT_CONNECTION_INVALID");
  const current = await verifyCurrentAccountSession(sessionToken);
  const result = await query<ConnectionEmailRow>("SELECT * FROM auth.claim_connection_email_proof($1,$2,$3,$4,$5,$6,$7)",
    connectionParameters(operation, current, binding));
  const row = result.rows[0];
  if (row === undefined) throw new AccountConnectionError("ACCOUNT_CONNECTION_RESTART_REQUIRED");
  const session = openAuthAttemptState(operation, row.challenge_ciphertext);
  if (session.length < 20 || session.length > 16_384) throw new AccountConnectionError("ACCOUNT_CONNECTION_RESTART_REQUIRED");
  const principal = await verifyCurrentEmailOtpPrincipal(row.target_email, row.target_username, code, session);
  const completed = await query<ConnectionRow>(
    "SELECT * FROM auth.record_connection_email_proof($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
    [...connectionParameters(operation, current, binding), row.email_claim,
      principal.cognitoSubject, principal.cognitoUsername, principal.email, principal.authTime]);
  return connectionReceipt(operation, completed.rows[0]);
}
