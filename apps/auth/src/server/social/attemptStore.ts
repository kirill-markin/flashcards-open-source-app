import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";
import { query, transaction, type DatabaseExecutor } from "../../db.js";
import type { verifyCurrentAccountSession } from "../browserSession.js";
import { exchangeAppleAuthorizationCode } from "./apple.js";
import { exchangeGoogleAuthorizationCode, verifyGoogleIdentityToken } from "./google.js";
import { beginEnrollmentMailboxOtp, normalizeEnrollmentEmail, type MailboxProofBinding } from "./mailboxProof.js";
import type { ProviderEnrollmentProof } from "./principalEnrollment.js";
import { browserAttemptBinding, type BrowserCallbackState } from "./browserState.js";
import { appleRequestNonce, assertProviderCallback, socialAuthOrigins, SocialProofError } from "./providers.js";
import {
  AuthAttemptError, requireAuthHandle, type AuthAttemptBinding, type AuthAttemptRequest,
  type AuthAttemptResponse, type AuthCurrentAccount, type AuthProviderSubmission,
} from "./attemptContract.js";

export type AttemptPhase = "provider_ready" | "provider_claimed" | "provider_verifying" | "provider_proved" | "provider_enrolling"
  | "mailbox_required" | "mailbox_sending" | "mailbox_ready" | "mailbox_claimed" | "mailbox_verifying" | "completed" | "redeemed";
export type AttemptSecrets = Readonly<{
  nonce: string;
  providerCodeVerifier: string;
  proof: ProviderEnrollmentProof | null;
  mailbox: Readonly<{ binding: MailboxProofBinding; session: string }> | null;
}>;
const claimedAttemptBrand: unique symbol = Symbol("server-owned persisted auth attempt");
export type ClaimedAuthAttempt = Readonly<{
  [claimedAttemptBrand]: true;
  handle: string;
  claimId: string;
  provider: AuthAttemptRequest["provider"];
  client: AuthAttemptRequest["client"];
  purpose: AuthAttemptRequest["purpose"];
  redirectUri: string | null;
  secrets: AttemptSecrets;
  phase: AttemptPhase;
}>;
type AttemptRow = Readonly<{
  claim_id: string;
  provider_type: AuthAttemptRequest["provider"];
  client_type: AuthAttemptRequest["client"];
  purpose: AuthAttemptRequest["purpose"];
  redirect_uri: string | null;
  secret_ciphertext: string;
  phase: AttemptPhase;
}>;
export type AccountProviderBrowserLaunch = Readonly<{
  attempt: string;
  provider: "apple";
  client: "android";
  intent: "reauth" | "link" | "reenable";
  nonce: string;
  codeChallenge: string;
  redirectUri: string;
  expiresAt: string;
}>;
type AccountBrowserLaunchRow = Readonly<{
  binding_sha256: string; purpose: "link" | "reauth"; redirect_uri: string;
  secret_ciphertext: string; expires_at: Date; explicit_reenable: boolean;
}>;

export function authHandleHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function attemptKey(): Buffer {
  const hex = process.env.SESSION_ENCRYPTION_KEY;
  if (hex === undefined || !/^[0-9a-f]{64}$/i.test(hex)) throw new SocialProofError("PROVIDER_CONFIGURATION_INVALID");
  return Buffer.from(hkdfSync("sha256", Buffer.from(hex, "hex"), "nibomo-auth", "social-attempt-v1", 32));
}

function sealSecrets(handle: string, secrets: AttemptSecrets): string {
  return sealAuthAttemptState(handle, JSON.stringify(secrets));
}

export function sealAuthAttemptState(handle: string, state: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", attemptKey(), iv);
  cipher.setAAD(Buffer.from(authHandleHash(handle)));
  const body = Buffer.concat([cipher.update(state, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), body.toString("base64url")].join(".");
}

function openSecrets(handle: string, ciphertext: string): AttemptSecrets {
  try {
    return JSON.parse(openAuthAttemptState(handle, ciphertext)) as AttemptSecrets;
  } catch {
    throw new AuthAttemptError("AUTH_ATTEMPT_RESTART_REQUIRED");
  }
}

export function openAuthAttemptState(handle: string, ciphertext: string): string {
  const key = attemptKey();
  try {
    const [version, iv, tag, body, extra] = ciphertext.split(".");
    if (version !== "v1" || extra !== undefined || iv?.length !== 16 || tag?.length !== 22 || body === undefined) {
      throw new AuthAttemptError("AUTH_ATTEMPT_RESTART_REQUIRED");
    }
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
    decipher.setAAD(Buffer.from(authHandleHash(handle)));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    throw new AuthAttemptError("AUTH_ATTEMPT_RESTART_REQUIRED");
  }
}

export function authAttemptBindingHash(binding: AuthAttemptBinding): string {
  if (binding.client === "web") {
    requireAuthHandle(binding.browserSecret);
    const allowedOrigins = [...socialAuthOrigins, ...(process.env.ALLOWED_REDIRECT_URIS ?? "").split(",").map((value) => value.trim())];
    if (!allowedOrigins.includes(binding.origin)) throw new AuthAttemptError("AUTH_ATTEMPT_INVALID");
    return authHandleHash(JSON.stringify(["browser", binding.origin, binding.browserSecret]));
  }
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(binding.codeVerifier)) throw new AuthAttemptError("AUTH_ATTEMPT_INVALID");
  return authHandleHash(binding.codeVerifier);
}

export function prepareAuthAttempt(
  request: AuthAttemptRequest, browser: Readonly<{ origin: string; secret: string }> | null, authOrigin: string,
): Readonly<{ handle: string; secrets: AttemptSecrets; binding: string; redirectUri: string | null }> {
  if (!["apple", "google"].includes(request.provider)
    || !["web", "android", "ios", "ios-development", "macos", "macos-development"].includes(request.client)
    || !["login", "link", "reauth"].includes(request.purpose)) throw new AuthAttemptError("AUTH_ATTEMPT_INVALID");
  const browserBinding = request.client === "web";
  if (browserBinding !== (browser !== null) || browserBinding !== (request.codeChallenge === null)) {
    throw new AuthAttemptError("AUTH_ATTEMPT_INVALID");
  }
  let binding: string;
  if (browser !== null) {
    binding = authAttemptBindingHash({ client: "web", purpose: request.purpose, origin: browser.origin, browserSecret: browser.secret });
  } else {
    if (request.codeChallenge === null || !/^[A-Za-z0-9_-]{43}$/.test(request.codeChallenge)) {
      throw new AuthAttemptError("AUTH_ATTEMPT_INVALID");
    }
    // The app keeps its verifier. The server stores only its SHA-256 challenge.
    binding = Buffer.from(request.codeChallenge, "base64url").toString("hex");
  }
  const redirectUri = browserBinding || (request.provider === "apple" && request.client === "android")
    ? `${authOrigin}/api/social/${request.provider}/callback` : null;
  if (redirectUri !== null) assertProviderCallback(request.provider, redirectUri);
  const handle = randomBytes(32).toString("base64url");
  const secrets: AttemptSecrets = {
    nonce: randomBytes(32).toString("base64url"), providerCodeVerifier: randomBytes(32).toString("base64url"), proof: null, mailbox: null,
  };
  return { handle, secrets, binding, redirectUri };
}

/** Route code derives client/origin/current account from trusted context; none can be replaced at completion. */
export async function createAuthAttempt(
  request: AuthAttemptRequest, current: AuthCurrentAccount,
  browser: Readonly<{ origin: string; secret: string }> | null, authOrigin: string,
): Promise<AuthAttemptResponse> {
  if (request.purpose !== current.purpose) throw new AuthAttemptError("AUTH_ATTEMPT_INVALID");
  const { handle, secrets, binding, redirectUri } = prepareAuthAttempt(request, browser, authOrigin);
  if (current.reauthCompletion !== null) requireAuthHandle(current.reauthCompletion);
  if (current.purpose === "link" && current.reauthBinding.purpose !== "reauth") throw new AuthAttemptError("AUTH_ATTEMPT_INVALID");
  const result = await query<Readonly<{ expires_at: Date }>>(
    "SELECT auth.create_social_attempt($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) AS expires_at",
    [authHandleHash(handle), request.provider, request.client, request.purpose, binding,
      browser?.origin ?? null, redirectUri, current.subject, current.account, sealSecrets(handle, secrets),
      current.reauthCompletion === null ? null : authHandleHash(current.reauthCompletion),
      current.purpose === "link" ? authAttemptBindingHash(current.reauthBinding) : null,
      current.purpose === "link" ? current.reauthBinding.client : null,
      current.purpose === "link" && current.reauthBinding.client === "web" ? current.reauthBinding.origin : null],
  );
  const expiry = result.rows[0]?.expires_at;
  if (expiry === undefined) throw new Error("Auth attempt creation returned no expiry");
  return { attempt: handle, nonce: request.provider === "apple" ? appleRequestNonce(secrets.nonce) : secrets.nonce,
    expiresAt: expiry.toISOString(), redirectUri,
    providerCodeChallenge: createHash("sha256").update(secrets.providerCodeVerifier).digest("base64url") };
}

export async function claimAuthAttempt(
  handle: string, binding: AuthAttemptBinding, phase: "provider_ready" | "mailbox_ready",
): Promise<ClaimedAuthAttempt> {
  requireAuthHandle(handle);
  const result = await query<AttemptRow>("SELECT * FROM auth.claim_social_attempt($1,$2,$3,$4,$5,$6)", [
    authHandleHash(handle), authAttemptBindingHash(binding), binding.purpose, binding.client,
    binding.client === "web" ? binding.origin : null, phase,
  ]);
  const row = result.rows[0];
  if (row === undefined) throw new AuthAttemptError("AUTH_ATTEMPT_RESTART_REQUIRED");
  return { [claimedAttemptBrand]: true, handle, claimId: row.claim_id, provider: row.provider_type, client: row.client_type, purpose: row.purpose,
    redirectUri: row.redirect_uri, secrets: openSecrets(handle, row.secret_ciphertext), phase: row.phase };
}

/** The opaque handle selects an existing app-authorized attempt, never a new browser authority. */
export async function loadAccountProviderBrowserLaunch(handle: string, authOrigin: string): Promise<AccountProviderBrowserLaunch> {
  requireAuthHandle(handle);
  if (!socialAuthOrigins.includes(authOrigin)) throw new AuthAttemptError("AUTH_ATTEMPT_INVALID");
  const result = await query<AccountBrowserLaunchRow>("SELECT * FROM auth.load_account_provider_browser_launch($1,$2)",
    [authHandleHash(handle), authOrigin]);
  const row = result.rows[0];
  if (row === undefined || row.redirect_uri !== `${authOrigin}/api/social/apple/callback`
    || !["link", "reauth"].includes(row.purpose) || !/^[0-9a-f]{64}$/.test(row.binding_sha256)
    || (row.explicit_reenable && row.purpose !== "link")) throw new AuthAttemptError("AUTH_ATTEMPT_RESTART_REQUIRED");
  const secrets = openSecrets(handle, row.secret_ciphertext);
  if (secrets.proof !== null || secrets.mailbox !== null) throw new AuthAttemptError("AUTH_ATTEMPT_RESTART_REQUIRED");
  return { attempt: handle, provider: "apple", client: "android",
    intent: row.explicit_reenable ? "reenable" : row.purpose, nonce: appleRequestNonce(secrets.nonce),
    codeChallenge: Buffer.from(row.binding_sha256, "hex").toString("base64url"),
    redirectUri: row.redirect_uri, expiresAt: row.expires_at.toISOString() };
}

/** Current-session fields must come from verifyCurrentAccountSession, never request JSON. */
export async function loadProvedAccountProviderReenable(
  handle: string, binding: AuthAttemptBinding,
  current: Pick<Awaited<ReturnType<typeof verifyCurrentAccountSession>>, "subject" | "username" | "authTime">,
): Promise<ClaimedAuthAttempt> {
  requireAuthHandle(handle);
  if (binding.client !== "android" || binding.purpose !== "link") throw new AuthAttemptError("AUTH_ATTEMPT_INVALID");
  const result = await query<AttemptRow & Readonly<{ provider_subject: string }>>(
    "SELECT * FROM auth.load_proved_account_provider_reenable($1,$2,$3,$4,$5,$6,$7)",
    [authHandleHash(handle), authAttemptBindingHash(binding), binding.client, null,
      current.subject, current.username, current.authTime]);
  const row = result.rows[0];
  if (row === undefined || row.claim_id === null || row.provider_type !== "apple" || row.client_type !== "android"
    || row.purpose !== "link" || row.phase !== "provider_proved" || row.redirect_uri === null) {
    throw new AuthAttemptError("AUTH_ATTEMPT_RESTART_REQUIRED");
  }
  assertProviderCallback("apple", row.redirect_uri);
  const secrets = openSecrets(handle, row.secret_ciphertext);
  const proof = secrets.proof;
  if (proof === null || proof.provider !== "apple" || proof.identity.provider !== "apple"
    || proof.identity.subject !== row.provider_subject || proof.credential.providerSubject !== row.provider_subject
    || proof.credential.clientId !== proof.identity.clientId || secrets.mailbox !== null) {
    throw new AuthAttemptError("AUTH_ATTEMPT_RESTART_REQUIRED");
  }
  return { [claimedAttemptBrand]: true, handle, claimId: row.claim_id, provider: row.provider_type,
    client: row.client_type, purpose: row.purpose, redirectUri: row.redirect_uri, secrets, phase: row.phase };
}

/** The callback cookie authenticates browser state; Android redemption still requires the app's verifier. */
export async function claimBrowserAuthAttempt(state: BrowserCallbackState): Promise<ClaimedAuthAttempt> {
  if (state.phase !== "provider") throw new AuthAttemptError("AUTH_ATTEMPT_RESTART_REQUIRED");
  const binding = state.client === "web" ? authAttemptBindingHash(browserAttemptBinding(state))
    : Buffer.from(state.codeChallenge, "base64url").toString("hex");
  const result = await query<AttemptRow>("SELECT * FROM auth.claim_social_attempt($1,$2,$3,$4,$5,$6)", [
    authHandleHash(state.attempt), binding, "login", state.client, state.client === "web" ? state.authOrigin : null, "provider_ready",
  ]);
  const row = result.rows[0];
  if (row === undefined || row.provider_type !== state.provider || row.client_type !== state.client
    || row.purpose !== "login" || row.redirect_uri !== `${state.authOrigin}/api/social/${state.provider}/callback`) {
    throw new AuthAttemptError("AUTH_ATTEMPT_RESTART_REQUIRED");
  }
  return { [claimedAttemptBrand]: true, handle: state.attempt, claimId: row.claim_id, provider: row.provider_type,
    client: row.client_type, purpose: row.purpose, redirectUri: row.redirect_uri,
    secrets: openSecrets(state.attempt, row.secret_ciphertext), phase: row.phase };
}

export async function loadAuthAttemptForMailbox(handle: string, binding: AuthAttemptBinding): Promise<ClaimedAuthAttempt> {
  requireAuthHandle(handle);
  const result = await query<AttemptRow>("SELECT * FROM auth.load_social_mailbox_attempt($1,$2,$3,$4,$5)", [
    authHandleHash(handle), authAttemptBindingHash(binding), binding.purpose, binding.client,
    binding.client === "web" ? binding.origin : null,
  ]);
  const row = result.rows[0];
  if (row === undefined) throw new AuthAttemptError("AUTH_ATTEMPT_RESTART_REQUIRED");
  return { [claimedAttemptBrand]: true, handle, claimId: row.claim_id, provider: row.provider_type, client: row.client_type, purpose: row.purpose,
    redirectUri: row.redirect_uri, secrets: openSecrets(handle, row.secret_ciphertext), phase: row.phase };
}

async function advanceAuthAttemptInExecutor(
  executor: DatabaseExecutor, attempt: ClaimedAuthAttempt, from: AttemptPhase, to: AttemptPhase, secrets: AttemptSecrets,
): Promise<void> {
  if (attempt[claimedAttemptBrand] !== true) throw new AuthAttemptError("AUTH_ATTEMPT_INVALID");
  await executor.query("SELECT auth.advance_social_attempt($1,$2,$3,$4,$5,$6)", [
    authHandleHash(attempt.handle), attempt.claimId, from, to, sealSecrets(attempt.handle, secrets), secrets.proof?.identity.subject ?? null,
  ]);
}

export async function beginAuthAttemptEnrollment(attempt: ClaimedAuthAttempt): Promise<void> {
  await transaction((executor) => advanceAuthAttemptInExecutor(executor, attempt, "provider_proved", "provider_enrolling", attempt.secrets));
}

export async function recordAuthAttemptMailboxRequired(attempt: ClaimedAuthAttempt): Promise<ClaimedAuthAttempt> {
  await transaction((executor) => advanceAuthAttemptInExecutor(executor, attempt, "provider_enrolling", "mailbox_required", attempt.secrets));
  return { ...attempt, phase: "mailbox_required" };
}

export async function beginAuthAttemptMailboxVerification(attempt: ClaimedAuthAttempt): Promise<void> {
  await transaction((executor) => advanceAuthAttemptInExecutor(executor, attempt, "mailbox_claimed", "mailbox_verifying", attempt.secrets));
}

/** The only provider_proved transition invokes the real verifier with the persisted nonce/client/redirect. */
export async function verifyClaimedAuthAttempt(
  attempt: ClaimedAuthAttempt, submission: AuthProviderSubmission,
): Promise<ClaimedAuthAttempt> {
  if (submission.provider !== attempt.provider || attempt.secrets.proof !== null) throw new AuthAttemptError("AUTH_ATTEMPT_INVALID");
  await transaction((executor) => advanceAuthAttemptInExecutor(executor, attempt, "provider_claimed", "provider_verifying", attempt.secrets));
  let proof: ProviderEnrollmentProof;
  if (submission.provider === "apple") {
    const result = await exchangeAppleAuthorizationCode({ client: attempt.client, identityToken: submission.identityToken,
      authorizationCode: submission.authorizationCode, rawNonce: attempt.secrets.nonce, redirectUri: attempt.redirectUri });
    proof = { provider: "apple", identity: result.identity, credential: result.credential };
  } else if (submission.authorizationCode !== null) {
    if (attempt.client !== "web" || attempt.redirectUri === null) throw new AuthAttemptError("AUTH_ATTEMPT_INVALID");
    proof = { provider: "google", identity: await exchangeGoogleAuthorizationCode(submission.authorizationCode,
      attempt.secrets.nonce, attempt.redirectUri, attempt.secrets.providerCodeVerifier) };
  } else {
    if (attempt.client === "web") throw new AuthAttemptError("AUTH_ATTEMPT_INVALID");
    proof = { provider: "google", identity: await verifyGoogleIdentityToken(submission.identityToken, attempt.secrets.nonce, attempt.client) };
  }
  const secrets = { ...attempt.secrets, proof };
  await transaction((executor) => advanceAuthAttemptInExecutor(executor, attempt, "provider_verifying", "provider_proved", secrets));
  return { ...attempt, secrets, phase: "provider_proved" };
}

/** Persist the sending boundary before Cognito may create a provisional principal or consume a challenge. */
export async function beginAuthAttemptMailboxOtp(attempt: ClaimedAuthAttempt, email: string): Promise<void> {
  const proof = attempt.secrets.proof;
  if (proof === null || attempt.secrets.mailbox !== null || attempt.phase !== "mailbox_required") throw new AuthAttemptError("AUTH_ATTEMPT_INVALID");
  const binding: MailboxProofBinding = { purpose: "provider_enrollment", operationId: attempt.handle,
    provider: attempt.provider, providerSubject: proof.identity.subject, providerClientId: proof.identity.clientId,
    email: normalizeEnrollmentEmail(email) };
  await transaction((executor) => advanceAuthAttemptInExecutor(executor, attempt, attempt.phase, "mailbox_sending", attempt.secrets));
  const { session } = await beginEnrollmentMailboxOtp(binding);
  const secrets = { ...attempt.secrets, mailbox: { binding, session } };
  await transaction((executor) => advanceAuthAttemptInExecutor(executor, attempt, "mailbox_sending", "mailbox_ready", secrets));
}
