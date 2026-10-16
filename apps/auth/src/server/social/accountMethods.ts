import { createHash } from "node:crypto";
import { query, transaction, type DatabaseExecutor } from "../../db.js";
import { verifyCurrentAccountSession } from "../browserSession.js";
import {
  authAttemptBindingHash, authHandleHash, claimAuthAttempt, createAuthAttempt, prepareAuthAttempt,
  loadProvedAccountProviderReenable, sealAuthAttemptState, verifyClaimedAuthAttempt, type ClaimedAuthAttempt,
} from "./attemptStore.js";
import {
  AuthAttemptError, requireAuthHandle, type AuthAttemptBinding, type AuthAttemptRequest,
  type AuthAttemptResponse, type AuthProviderSubmission, type AuthReauthenticationBinding,
} from "./attemptContract.js";
import { appleRequestNonce } from "./providers.js";
import { wakeAppleRevocations } from "./appleRevocationWake.js";
import type { IdentityProvider } from "./identityStore.js";

export type AccountProviderMethod = Readonly<{
  provider: IdentityProvider;
  providerSubject: string;
  status: "active" | "disabled";
  generation: string;
  revocationPending: boolean;
}>;
export type AccountMethodProof = Readonly<{ completion: string; binding: AuthReauthenticationBinding }>;
type ProviderMethodRow = Readonly<{
  provider_type: IdentityProvider; provider_subject: string; status: AccountProviderMethod["status"];
  generation: string; revocation_pending: boolean;
}>;
export type AccountProviderMethodTarget = Readonly<{ provider: IdentityProvider; providerSubject: string; generation: string }>;
type AttemptBrowser = Readonly<{ origin: string; secret: string }> | null;

function proofParameters(proof: AccountMethodProof): readonly [string, string, string, string | null] {
  requireAuthHandle(proof.completion);
  if (proof.binding.purpose !== "reauth") throw new AuthAttemptError("AUTH_ATTEMPT_INVALID");
  return [authHandleHash(proof.completion), authAttemptBindingHash(proof.binding), proof.binding.client,
    proof.binding.client === "web" ? proof.binding.origin : null];
}

type AccountLoginMethods = Readonly<{
  methods: ReadonlyArray<AccountProviderMethod>;
  verifiedRecoveryEmails: ReadonlyArray<string>;
}>;

export async function listAccountLoginMethods(sessionToken: string): Promise<AccountLoginMethods> {
  const current = await verifyCurrentAccountSession(sessionToken);
  return transaction((executor) => listAccountLoginMethodsInExecutor(executor,
    current.subject, current.username, current.authTime));
}

export async function listAccountLoginMethodsInExecutor(
  executor: DatabaseExecutor, subject: string, username: string, originalAuthTime: number | null,
): Promise<AccountLoginMethods> {
  const parameters: readonly [string, string, number | null] = [subject, username, originalAuthTime];
  const result = await executor.query<ProviderMethodRow>("SELECT * FROM auth.list_account_provider_methods($1,$2,$3)", parameters);
  const account = await executor.query<Readonly<{ account_id: string }>>(
    "SELECT auth.account_provider_context($1,$2,$3) AS account_id", parameters);
  const accountId = account.rows[0]?.account_id;
  if (accountId === undefined) throw new Error("Current account lookup returned no result");
  const emails = await executor.query<Readonly<{ email: string }>>(`
    SELECT DISTINCT emails.email
    FROM auth.user_identities AS identities JOIN auth.verified_login_emails AS emails
      ON emails.cognito_subject = identities.provider_subject
    WHERE identities.provider_type = 'cognito' AND identities.user_id = $1
      AND emails.email !~ '@(privaterelay\\.appleid\\.com|private\\.icloud\\.com)$'
      AND emails.email NOT LIKE '%@example.com'
      AND NOT EXISTS (SELECT 1 FROM auth.deleted_subjects WHERE subject_sha256 =
        encode(sha256(convert_to(emails.cognito_subject, 'UTF8')), 'hex'))
    ORDER BY emails.email`, [accountId]);
  return {
    methods: result.rows.map((row) => ({ provider: row.provider_type, providerSubject: row.provider_subject,
      status: row.status, generation: row.generation, revocationPending: row.revocation_pending })),
    verifiedRecoveryEmails: emails.rows.map((row) => row.email),
  };
}

export async function unlinkAccountProviderMethod(
  sessionToken: string, target: AccountProviderMethodTarget, proof: AccountMethodProof,
): Promise<void> {
  const current = await verifyCurrentAccountSession(sessionToken);
  await query("SELECT auth.unlink_account_provider_method($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
    [current.subject, current.username, current.authTime, target.provider, target.providerSubject,
      target.generation, ...proofParameters(proof)]);
  await wakeAppleRevocations();
}

export async function beginAccountProviderReauthentication(
  sessionToken: string, request: AuthAttemptRequest, browser: AttemptBrowser, authOrigin: string,
): Promise<AuthAttemptResponse> {
  if (request.purpose !== "reauth") throw new AuthAttemptError("AUTH_ATTEMPT_INVALID");
  const current = await verifyCurrentAccountSession(sessionToken);
  const account = await query<Readonly<{ account_id: string }>>("SELECT auth.account_provider_context($1,$2,$3) AS account_id",
    [current.subject, current.username, current.authTime]);
  const accountId = account.rows[0]?.account_id;
  if (accountId === undefined) throw new Error("Current account lookup returned no result");
  return createAuthAttempt(request, { purpose: "reauth", subject: current.subject, account: accountId,
    reauthCompletion: null }, browser, authOrigin);
}

export async function beginAccountProviderLink(
  sessionToken: string, request: AuthAttemptRequest, proof: AccountMethodProof, browser: AttemptBrowser, authOrigin: string,
): Promise<AuthAttemptResponse> {
  if (request.purpose !== "link") throw new AuthAttemptError("AUTH_ATTEMPT_INVALID");
  proofParameters(proof);
  const current = await verifyCurrentAccountSession(sessionToken);
  const account = await query<Readonly<{ account_id: string }>>("SELECT auth.account_provider_context($1,$2,$3) AS account_id",
    [current.subject, current.username, current.authTime]);
  const accountId = account.rows[0]?.account_id;
  if (accountId === undefined) throw new Error("Current account lookup returned no result");
  return createAuthAttempt(request, { purpose: "link", subject: current.subject, account: accountId,
    reauthCompletion: proof.completion, reauthBinding: proof.binding }, browser, authOrigin);
}

export async function completeAccountProviderLink(
  sessionToken: string, completion: string, binding: AuthAttemptBinding,
): Promise<void> {
  requireAuthHandle(completion);
  if (binding.purpose !== "link") throw new AuthAttemptError("AUTH_ATTEMPT_INVALID");
  const current = await verifyCurrentAccountSession(sessionToken);
  await query("SELECT auth.redeem_account_provider_link($1,$2,$3,$4,$5,$6,$7)",
    [current.subject, current.username, current.authTime, authHandleHash(completion), authAttemptBindingHash(binding),
      binding.client, binding.client === "web" ? binding.origin : null]);
}

export async function beginAccountProviderReenable(
  sessionToken: string, target: AccountProviderMethodTarget, request: AuthAttemptRequest,
  proof: AccountMethodProof, browser: AttemptBrowser, authOrigin: string,
): Promise<AuthAttemptResponse> {
  if (request.purpose !== "link" || request.provider !== target.provider) throw new AuthAttemptError("AUTH_ATTEMPT_INVALID");
  const current = await verifyCurrentAccountSession(sessionToken);
  const prepared = prepareAuthAttempt(request, browser, authOrigin);
  const result = await query<Readonly<{ expires_at: Date }>>(
    "SELECT auth.create_account_provider_reenable($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) AS expires_at",
    [authHandleHash(prepared.handle), target.provider, target.providerSubject, target.generation, request.client,
      prepared.binding, browser?.origin ?? null, prepared.redirectUri, current.subject, current.username, current.authTime,
      sealAuthAttemptState(prepared.handle, JSON.stringify(prepared.secrets)), ...proofParameters(proof)],
  );
  const expiry = result.rows[0]?.expires_at;
  if (expiry === undefined) throw new Error("Provider re-enable creation returned no expiry");
  return { attempt: prepared.handle,
    nonce: target.provider === "apple" ? appleRequestNonce(prepared.secrets.nonce) : prepared.secrets.nonce,
    providerCodeChallenge: createHash("sha256").update(prepared.secrets.providerCodeVerifier).digest("base64url"),
    redirectUri: prepared.redirectUri, expiresAt: expiry.toISOString() };
}

export async function completeAccountProviderReenable(
  sessionToken: string, handle: string, binding: AuthAttemptBinding, submission: AuthProviderSubmission,
): Promise<void> {
  if (binding.purpose !== "link") throw new AuthAttemptError("AUTH_ATTEMPT_INVALID");
  const claimed = await claimAuthAttempt(handle, binding, "provider_ready");
  const proved = await verifyClaimedAuthAttempt(claimed, submission);
  await completeProvedAccountProviderReenable(sessionToken, proved, binding);
}

export async function resumeAccountProviderReenable(
  sessionToken: string, handle: string, binding: AuthAttemptBinding,
): Promise<void> {
  const current = await verifyCurrentAccountSession(sessionToken);
  const proved = await loadProvedAccountProviderReenable(handle, binding, current);
  await completeProvedAccountProviderReenable(sessionToken, proved, binding);
}

export async function completeProvedAccountProviderReenable(
  sessionToken: string, attempt: ClaimedAuthAttempt, binding: AuthAttemptBinding,
): Promise<void> {
  const proof = attempt.secrets.proof;
  if (proof === null || attempt.phase !== "provider_proved" || binding.purpose !== "link" || attempt.purpose !== "link") {
    throw new AuthAttemptError("AUTH_ATTEMPT_INVALID");
  }
  const current = await verifyCurrentAccountSession(sessionToken);
  await query("SELECT auth.complete_account_provider_reenable($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
    [current.subject, current.username, current.authTime, authHandleHash(attempt.handle), attempt.claimId,
      authAttemptBindingHash(binding), binding.client, binding.client === "web" ? binding.origin : null,
      proof.identity.subject, proof.identity.clientId, proof.provider === "apple" ? proof.credential.ciphertext : null]);
}
