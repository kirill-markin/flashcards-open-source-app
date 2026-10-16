import { randomBytes } from "node:crypto";
import type { CognitoEmailPrincipal } from "../cognito/cognitoAuth.js";
import { log } from "../logger.js";
import { createProviderSignInHint, encryptSignInHint, decryptSignInHint, type ProviderSignInHint } from "./signInHint.js";
import { transaction, type DatabaseExecutor } from "../../db.js";
import { verifyEnrollmentMailboxOtp } from "./mailboxProof.js";
import {
  enrollAuthoritativeProviderPrincipal, enrollProviderPrincipalWithMailboxProofInExecutor,
  prepareAuthoritativeLoginPrincipal, enrollAuthoritativeLoginPrincipalInExecutor,
  type EnrolledProviderPrincipal, type PrincipalEnrollmentResult, type ProviderEnrollmentProof,
} from "./principalEnrollment.js";
import {
  beginAuthAttemptEnrollment, beginAuthAttemptMailboxVerification, recordAuthAttemptMailboxRequired, authAttemptBindingHash, authHandleHash, type ClaimedAuthAttempt,
} from "./attemptStore.js";
import {
  AuthAttemptError, requireAuthHandle, type AuthAttemptBinding, type AuthCompletionResponse, type AuthCompletionResult,
} from "./attemptContract.js";

async function persistCompletion(
  executor: DatabaseExecutor, attempt: Pick<ClaimedAuthAttempt, "handle" | "claimId" | "purpose" | "provider">,
  enrolled: EnrolledProviderPrincipal,
): Promise<AuthCompletionResponse> {
  const completion = randomBytes(32).toString("base64url");
  const parameters = [authHandleHash(attempt.handle), attempt.claimId, enrolled.principal.cognitoSubject,
    enrolled.principal.cognitoUsername, authHandleHash(completion)];
  const result = attempt.purpose === "login"
    ? await executor.query<Readonly<{ expires_at: Date }>>(
      "SELECT auth.complete_social_sign_in($1,$2,$3,$4,$5,$6) AS expires_at",
      [...parameters, encryptSignInHint(completion, createProviderSignInHint(attempt.provider, enrolled))],
    )
    : await executor.query<Readonly<{ expires_at: Date }>>(
      "SELECT auth.complete_social_attempt($1,$2,$3,$4,$5) AS expires_at", parameters,
    );
  const expiry = result.rows[0]?.expires_at;
  if (expiry === undefined) throw new Error("Auth completion returned no expiry");
  return { completion, expiresAt: expiry.toISOString() };
}

export type AuthoritativeAttemptResult =
  | Readonly<{ status: "completed"; response: AuthCompletionResponse }>
  | Readonly<{ status: "verification_required"; enrollment: Exclude<PrincipalEnrollmentResult, EnrolledProviderPrincipal>; attempt: ClaimedAuthAttempt }>;

type AuthoritativeLoginResult =
  | Readonly<{ status: "completed"; response: AuthCompletionResponse; reconnected: boolean }>
  | Readonly<{ status: "verification_required"; enrollment: Exclude<PrincipalEnrollmentResult, EnrolledProviderPrincipal> }>;

/** Caller owns the transaction so a refused/expired completion rolls back new provider metadata. */
export async function completeAuthoritativeLoginInExecutor(
  executor: DatabaseExecutor, attempt: Pick<ClaimedAuthAttempt, "handle" | "claimId" | "provider">,
  proof: ProviderEnrollmentProof, principal: CognitoEmailPrincipal | null,
): Promise<AuthoritativeLoginResult> {
  if (attempt.provider !== proof.provider) throw new AuthAttemptError("AUTH_ATTEMPT_INVALID");
  const reconnect = proof.provider === "apple"
    ? await executor.query<Readonly<{ reconnected: boolean }>>("SELECT auth.reconnect_apple_login_attempt($1,$2,$3) AS reconnected",
      [authHandleHash(attempt.handle), attempt.claimId, proof.identity.subject]) : null;
  const reconnected = reconnect?.rows[0]?.reconnected ?? false;
  const enrolled = await enrollAuthoritativeLoginPrincipalInExecutor(executor, proof, principal);
  if (enrolled.status === "verification_required") return { status: "verification_required", enrollment: enrolled };
  return { status: "completed", response: await persistCompletion(executor, { ...attempt, purpose: "login" }, enrolled), reconnected };
}

function logMailboxVerificationRequired(
  attempt: Pick<ClaimedAuthAttempt, "client" | "purpose">, proof: ProviderEnrollmentProof,
  enrollment: Exclude<PrincipalEnrollmentResult, EnrolledProviderPrincipal>,
): void {
  log({ domain: "auth", action: "provider_mailbox_verification_required", mailboxReason: enrollment.reason,
    provider: proof.provider, client: attempt.client, purpose: attempt.purpose,
    emailAuthority: proof.identity.email?.authority ?? null, privateRelay: proof.identity.email?.privateRelay ?? null });
}

export async function completeAuthoritativeAuthAttempt(attempt: ClaimedAuthAttempt): Promise<AuthoritativeAttemptResult> {
  const proof = attempt.secrets.proof;
  if (proof === null) throw new AuthAttemptError("AUTH_ATTEMPT_INVALID");
  await beginAuthAttemptEnrollment(attempt);
  if (attempt.purpose === "login") {
    const principal = await prepareAuthoritativeLoginPrincipal(proof);
    const result = await transaction((executor) => completeAuthoritativeLoginInExecutor(executor, attempt, proof, principal));
    if (result.status === "completed") {
      if (result.reconnected) log({ domain: "auth", action: "provider_reconnected", provider: proof.provider,
        client: attempt.client, purpose: attempt.purpose });
      return result;
    }
    const mailboxAttempt = await recordAuthAttemptMailboxRequired(attempt);
    logMailboxVerificationRequired(attempt, proof, result.enrollment);
    return { ...result, attempt: mailboxAttempt };
  }
  const enrolled = await enrollAuthoritativeProviderPrincipal(proof);
  if (enrolled.status === "verification_required") {
    const mailboxAttempt = await recordAuthAttemptMailboxRequired(attempt);
    logMailboxVerificationRequired(attempt, proof, enrolled);
    return { status: "verification_required", enrollment: enrolled, attempt: mailboxAttempt };
  }
  const response = await transaction((executor) => persistCompletion(executor, attempt, enrolled));
  return { status: "completed", response };
}

/** The attempt owns the Cognito challenge and the existing in-process mailbox proof authority consumes it once. */
export async function completeMailboxAuthAttempt(attempt: ClaimedAuthAttempt, code: string): Promise<AuthCompletionResponse> {
  const { proof, mailbox } = attempt.secrets;
  if (proof === null || mailbox === null) throw new AuthAttemptError("AUTH_ATTEMPT_INVALID");
  await beginAuthAttemptMailboxVerification(attempt);
  const mailboxProof = await verifyEnrollmentMailboxOtp(mailbox.binding, code, mailbox.session);
  const enrolled = await transaction((executor) =>
    enrollProviderPrincipalWithMailboxProofInExecutor(executor, proof, mailboxProof, mailbox.binding));
  return transaction((executor) => persistCompletion(executor, attempt, enrolled));
}

type CompletionRow = Readonly<{
  cognito_subject: string;
  cognito_username: string;
  current_subject: string | null;
  current_account: string | null;
  purpose: AuthCompletionResult["purpose"];
}>;

/** Metadata enrollment commits before this transaction; link receipts use the bounded composition below. */
export async function redeemAuthCompletionInExecutor(
  executor: DatabaseExecutor, completion: string, binding: AuthAttemptBinding,
): Promise<AuthCompletionResult> {
  requireAuthHandle(completion);
  if (binding.purpose === "link") throw new AuthAttemptError("AUTH_COMPLETION_INVALID");
  const result = await executor.query<CompletionRow>("SELECT * FROM auth.redeem_social_completion($1,$2,$3,$4,$5)", [
    authHandleHash(completion), authAttemptBindingHash(binding), binding.purpose, binding.client,
    binding.client === "web" ? binding.origin : null,
  ]);
  const row = result.rows[0];
  if (row === undefined) throw new AuthAttemptError("AUTH_COMPLETION_INVALID");
  return { cognitoSubject: row.cognito_subject, cognitoUsername: row.cognito_username,
    currentSubject: row.current_subject, currentAccount: row.current_account, purpose: row.purpose };
}

/** First identity operation after metadata registration: prelock every proof alias, link, then consume atomically. */
export async function linkAndRedeemAuthCompletionInExecutor(
  executor: DatabaseExecutor, completion: string, binding: AuthAttemptBinding,
): Promise<AuthCompletionResult> {
  requireAuthHandle(completion);
  if (binding.purpose !== "link") throw new AuthAttemptError("AUTH_COMPLETION_INVALID");
  const result = await executor.query<CompletionRow>("SELECT * FROM auth.link_and_redeem_social_completion($1,$2,$3,$4)", [
    authHandleHash(completion), authAttemptBindingHash(binding), binding.client,
    binding.client === "web" ? binding.origin : null,
  ]);
  const row = result.rows[0];
  if (row === undefined) throw new AuthAttemptError("AUTH_COMPLETION_INVALID");
  return { cognitoSubject: row.cognito_subject, cognitoUsername: row.cognito_username,
    currentSubject: row.current_subject, currentAccount: row.current_account, purpose: row.purpose };
}

export type RedeemedSocialSignIn = Readonly<{
  cognitoSubject: string;
  cognitoUsername: string;
  signInHint: ProviderSignInHint;
}>;

export async function redeemSocialSignInInExecutor(
  executor: DatabaseExecutor, completion: string, binding: AuthAttemptBinding,
): Promise<RedeemedSocialSignIn> {
  requireAuthHandle(completion);
  if (binding.purpose !== "login") throw new AuthAttemptError("AUTH_COMPLETION_INVALID");
  const result = await executor.query<Readonly<{
    cognito_subject: string; cognito_username: string; result_ciphertext: string;
  }>>("SELECT * FROM auth.redeem_social_sign_in($1,$2,$3,$4)", [
    authHandleHash(completion), authAttemptBindingHash(binding), binding.client,
    binding.client === "web" ? binding.origin : null,
  ]);
  const row = result.rows[0];
  if (row === undefined) throw new AuthAttemptError("AUTH_COMPLETION_INVALID");
  return { cognitoSubject: row.cognito_subject, cognitoUsername: row.cognito_username,
    signInHint: decryptSignInHint(completion, row.result_ciphertext) };
}
