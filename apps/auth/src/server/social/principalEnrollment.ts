import { transaction, type DatabaseExecutor } from "../../db.js";
import { getDatabaseErrorSqlState } from "../databaseErrors.js";
import { createProvedEmailPrincipal, loadExistingEmailPrincipal, type CognitoEmailPrincipal } from "../cognito/cognitoAuth.js";
import { storeAppleCredentialInExecutor, type EncryptedAppleCredential } from "./appleCredential.js";
import { loadProviderCognitoSubjectInExecutor, lockProviderEmailEnrollmentInExecutor } from "./identityStore.js";
import {
  activateProvedProviderMethodInExecutor, loadProviderLoginMethodInExecutor,
  registerProvedEmailPrincipalInExecutor, type ProviderLoginMethod,
} from "./loginMethodStore.js";
import {
  consumeEnrollmentMailboxProof, normalizeEnrollmentEmail, PrincipalEnrollmentError,
  type MailboxProof, type MailboxProofBinding,
} from "./mailboxProof.js";
import type { VerifiedProviderIdentity } from "./providers.js";

export type ProviderEnrollmentProof =
  | Readonly<{ provider: "google"; identity: VerifiedProviderIdentity }>
  | Readonly<{ provider: "apple"; identity: VerifiedProviderIdentity; issuedAt: number; credential: EncryptedAppleCredential }>;

export type EnrolledProviderPrincipal = Readonly<{
  status: "enrolled";
  principal: CognitoEmailPrincipal;
  method: ProviderLoginMethod;
  providerEmail: string | null;
  emailRelationship: "matches_recovery" | "different_from_recovery" | "missing";
}>;

export type PrincipalEnrollmentResult = EnrolledProviderPrincipal | Readonly<{
  status: "verification_required";
  reason: "mailbox_required" | "existing_email" | "historical_binding";
  providerEmail: string | null;
}>;

function checkProof(proof: ProviderEnrollmentProof): VerifiedProviderIdentity {
  const identity = proof.identity;
  if (identity.provider !== proof.provider || identity.subject.length < 1 || identity.subject.length > 255
    || identity.clientId.length < 1 || identity.clientId.length > 255) {
    throw new PrincipalEnrollmentError("PROVIDER_ENROLLMENT_CONFLICT");
  }
  if (proof.provider === "apple"
    && (proof.credential.providerSubject !== identity.subject || proof.credential.clientId !== identity.clientId)) {
    throw new PrincipalEnrollmentError("PROVIDER_ENROLLMENT_CONFLICT");
  }
  if (identity.email !== null && normalizeEnrollmentEmail(identity.email.address) !== identity.email.address) {
    throw new PrincipalEnrollmentError("ENROLLMENT_EMAIL_INVALID");
  }
  return identity;
}

function enrolledResult(method: ProviderLoginMethod, identity: VerifiedProviderIdentity): EnrolledProviderPrincipal {
  if (method.status === "disabled") throw new PrincipalEnrollmentError("PROVIDER_METHOD_DISABLED");
  const providerEmail = identity.email?.address ?? null;
  return {
    status: "enrolled",
    principal: { cognitoSubject: method.cognitoSubject, cognitoUsername: method.cognitoUsername, email: method.recoveryEmail },
    method, providerEmail,
    emailRelationship: providerEmail === null ? "missing"
      : providerEmail === method.recoveryEmail ? "matches_recovery" : "different_from_recovery",
  };
}

async function persistAppleCredential(
  executor: DatabaseExecutor, proof: ProviderEnrollmentProof, cognitoSubject: string,
): Promise<void> {
  if (proof.provider === "apple") await storeAppleCredentialInExecutor(executor, cognitoSubject, proof.credential);
}

async function loadExistingEnrollment(
  executor: DatabaseExecutor, proof: ProviderEnrollmentProof,
): Promise<PrincipalEnrollmentResult | null> {
  const method = await loadProviderLoginMethodInExecutor(executor, proof.provider, proof.identity.subject);
  if (method !== null) {
    return enrolledResult(method, proof.identity);
  }
  const subject = await loadProviderCognitoSubjectInExecutor(executor, proof.provider, proof.identity.subject);
  return subject === null ? null : {
    status: "verification_required", reason: "historical_binding", providerEmail: proof.identity.email?.address ?? null,
  };
}

async function bindEnrollment(
  executor: DatabaseExecutor, proof: ProviderEnrollmentProof, principal: CognitoEmailPrincipal, verifiedAt: Date,
): Promise<EnrolledProviderPrincipal> {
  try {
    await registerProvedEmailPrincipalInExecutor(executor, principal, verifiedAt);
    const method = await activateProvedProviderMethodInExecutor(executor, proof.provider, proof.identity.subject, principal);
    const result = enrolledResult(method, proof.identity);
    await persistAppleCredential(executor, proof, principal.cognitoSubject);
    return result;
  } catch (error) {
    if (getDatabaseErrorSqlState(error) === "23505") throw new PrincipalEnrollmentError("PROVIDER_ENROLLMENT_CONFLICT");
    throw error;
  }
}

export async function enrollAuthoritativeProviderPrincipal(proof: ProviderEnrollmentProof): Promise<PrincipalEnrollmentResult> {
  const identity = checkProof(proof);
  const existing = await transaction(async (executor) => {
    const enrolled = await loadExistingEnrollment(executor, proof);
    if (enrolled?.status === "enrolled") await persistAppleCredential(executor, proof, enrolled.principal.cognitoSubject);
    return enrolled;
  });
  if (existing !== null) return existing;
  if (identity.email === null || identity.email.authority !== "provider") {
    return { status: "verification_required", reason: "mailbox_required", providerEmail: identity.email?.address ?? null };
  }
  const principal = await createProvedEmailPrincipal(identity.email.address);
  if (principal === null) {
    return { status: "verification_required", reason: "existing_email", providerEmail: identity.email.address };
  }
  return transaction((executor) => bindEnrollment(executor, proof, principal, new Date()));
}

export async function prepareAuthoritativeLoginPrincipal(proof: ProviderEnrollmentProof): Promise<CognitoEmailPrincipal | null> {
  const identity = checkProof(proof);
  const boundSubject = await transaction((executor) =>
    loadProviderCognitoSubjectInExecutor(executor, proof.provider, identity.subject));
  if (identity.email === null || identity.email.authority !== "provider") return null;
  if (boundSubject !== null && (proof.provider !== "apple" || identity.email.privateRelay
    || /@(privaterelay\.appleid\.com|private\.icloud\.com)$/.test(identity.email.address))) return null;
  const principal = await createProvedEmailPrincipal(identity.email.address) ?? await loadExistingEmailPrincipal(identity.email.address);
  if (boundSubject !== null && principal === null) throw new PrincipalEnrollmentError("PROVIDER_ENROLLMENT_CONFLICT");
  return principal;
}

export async function lockAuthoritativeLoginPrincipalsInExecutor(
  executor: DatabaseExecutor, proof: ProviderEnrollmentProof, principal: CognitoEmailPrincipal | null,
): Promise<string | null> {
  const identity = checkProof(proof);
  if (principal !== null && (identity.email?.authority !== "provider" || identity.email.address !== principal.email
    || principal.cognitoSubject.trim() === "" || principal.cognitoUsername.trim() === "")) {
    throw new PrincipalEnrollmentError("PROVIDER_ENROLLMENT_CONFLICT");
  }
  return lockProviderEmailEnrollmentInExecutor(executor, proof.provider, identity.subject, principal?.cognitoSubject ?? null);
}

export async function enrollAuthoritativeLoginPrincipalInExecutor(
  executor: DatabaseExecutor, proof: ProviderEnrollmentProof, principal: CognitoEmailPrincipal | null,
): Promise<PrincipalEnrollmentResult> {
  const boundSubject = await lockAuthoritativeLoginPrincipalsInExecutor(executor, proof, principal);
  return enrollLockedAuthoritativeLoginPrincipalInExecutor(executor, proof, principal, boundSubject);
}

/** The caller prelocks P/Q before reconnect can acquire method/attempt/credential locks. */
export async function enrollLockedAuthoritativeLoginPrincipalInExecutor(
  executor: DatabaseExecutor, proof: ProviderEnrollmentProof, principal: CognitoEmailPrincipal | null, boundSubject: string | null,
): Promise<PrincipalEnrollmentResult> {
  const identity = checkProof(proof);
  const currentSubject = await loadProviderCognitoSubjectInExecutor(executor, proof.provider, identity.subject);
  if (currentSubject !== boundSubject) throw new PrincipalEnrollmentError("PROVIDER_ENROLLMENT_CONFLICT");
  if (boundSubject !== null) {
    const existing = await loadExistingEnrollment(executor, proof);
    if (existing === null) throw new PrincipalEnrollmentError("PROVIDER_ENROLLMENT_CONFLICT");
    if (existing.status !== "enrolled") {
      if (principal !== null && principal.cognitoSubject !== boundSubject) {
        throw new PrincipalEnrollmentError("PROVIDER_ENROLLMENT_CONFLICT");
      }
      return existing;
    }
    if (principal !== null && (existing.principal.cognitoSubject !== principal.cognitoSubject
      || existing.principal.cognitoUsername !== principal.cognitoUsername || existing.principal.email !== principal.email)) {
      throw new PrincipalEnrollmentError("PROVIDER_ENROLLMENT_CONFLICT");
    }
    await persistAppleCredential(executor, proof, existing.principal.cognitoSubject);
    return existing;
  }
  if (principal === null) return { status: "verification_required",
    reason: identity.email?.authority === "provider" ? "existing_email" : "mailbox_required",
    providerEmail: identity.email?.address ?? null };
  return bindEnrollment(executor, proof, principal, new Date());
}

/** The locked operation owns fresh provider proof and durable completion replay in this transaction. */
export async function enrollProviderPrincipalWithMailboxProofInExecutor(
  executor: DatabaseExecutor, proof: ProviderEnrollmentProof, mailboxProof: MailboxProof, binding: MailboxProofBinding,
): Promise<EnrolledProviderPrincipal> {
  const identity = checkProof(proof);
  if (binding.provider !== identity.provider || binding.providerSubject !== identity.subject
    || binding.providerClientId !== identity.clientId) throw new PrincipalEnrollmentError("MAILBOX_PROOF_INVALID");
  const authority = consumeEnrollmentMailboxProof(mailboxProof, binding);
  return bindEnrollment(executor, proof, authority.principal, authority.verifiedAt);
}

export async function enrollProviderPrincipalWithMailboxProof(
  proof: ProviderEnrollmentProof, mailboxProof: MailboxProof, binding: MailboxProofBinding,
): Promise<EnrolledProviderPrincipal> {
  return transaction((executor) => enrollProviderPrincipalWithMailboxProofInExecutor(executor, proof, mailboxProof, binding));
}
