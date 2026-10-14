import { initiateEmailOtp, verifyEmailOtpPrincipal, type CognitoEmailPrincipal } from "../cognito/cognitoAuth.js";
import type { IdentityProvider } from "./identityStore.js";

export type EnrollmentErrorCode = "ENROLLMENT_EMAIL_INVALID" | "ENROLLMENT_DEMO_PRINCIPAL"
  | "MAILBOX_PROOF_INVALID" | "PROVIDER_METHOD_DISABLED" | "PROVIDER_ENROLLMENT_CONFLICT";

export class PrincipalEnrollmentError extends Error {
  constructor(readonly code: EnrollmentErrorCode) {
    super(code);
    this.name = "PrincipalEnrollmentError";
  }
}

export function normalizeEnrollmentEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (normalized.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new PrincipalEnrollmentError("ENROLLMENT_EMAIL_INVALID");
  }
  if (normalized.endsWith("@example.com")) throw new PrincipalEnrollmentError("ENROLLMENT_DEMO_PRINCIPAL");
  return normalized;
}

export type MailboxProofBinding = Readonly<{
  purpose: "provider_enrollment";
  operationId: string;
  provider: IdentityProvider;
  providerSubject: string;
  providerClientId: string;
  email: string;
}>;

const mailboxProofBrand: unique symbol = Symbol("Cognito EMAIL_OTP mailbox proof");
export type MailboxProof = Readonly<{ [mailboxProofBrand]: true }>;
type ProofAuthority = Readonly<{
  binding: MailboxProofBinding;
  principal: CognitoEmailPrincipal;
  verifiedAt: Date;
  expiresAt: number;
}>;
const proofAuthorities = new WeakMap<MailboxProof, ProofAuthority>();

function copyBinding(binding: MailboxProofBinding): MailboxProofBinding {
  if (binding.purpose !== "provider_enrollment" || !/^[A-Za-z0-9_-]{32,200}$/.test(binding.operationId)
    || !["apple", "google"].includes(binding.provider)
    || binding.providerSubject.length < 1 || binding.providerSubject.length > 255
    || binding.providerClientId.length < 1 || binding.providerClientId.length > 255
    || normalizeEnrollmentEmail(binding.email) !== binding.email) {
    throw new PrincipalEnrollmentError("MAILBOX_PROOF_INVALID");
  }
  return Object.freeze({ ...binding });
}

/** The server attempt owns this binding and persists the returned Cognito session before use. */
export async function beginEnrollmentMailboxOtp(binding: MailboxProofBinding): Promise<Readonly<{ session: string }>> {
  const checked = copyBinding(binding);
  return initiateEmailOtp(checked.email);
}

/** The caller loads the session/binding from its locked attempt, never from independent request fields. */
export async function verifyEnrollmentMailboxOtp(
  binding: MailboxProofBinding, code: string, cognitoSession: string,
): Promise<MailboxProof> {
  const checked = copyBinding(binding);
  if (!/^[0-9]{6,8}$/.test(code) || cognitoSession.length < 20 || cognitoSession.length > 16_384) {
    throw new PrincipalEnrollmentError("MAILBOX_PROOF_INVALID");
  }
  const principal = await verifyEmailOtpPrincipal(checked.email, code, cognitoSession);
  const verifiedAt = new Date();
  const proof: MailboxProof = Object.freeze({ [mailboxProofBrand]: true });
  proofAuthorities.set(proof, { binding: checked, principal, verifiedAt, expiresAt: verifiedAt.getTime() + 120_000 });
  return proof;
}

/** In-request capability only: durable attempt/completion replay belongs to the operation store. Consume before awaiting. */
export function consumeEnrollmentMailboxProof(
  proof: MailboxProof, expectedBinding: MailboxProofBinding,
): Readonly<{ principal: CognitoEmailPrincipal; verifiedAt: Date }> {
  const expected = copyBinding(expectedBinding);
  const authority = proofAuthorities.get(proof);
  proofAuthorities.delete(proof);
  if (authority === undefined || authority.expiresAt <= Date.now()
    || authority.binding.purpose !== expected.purpose || authority.binding.operationId !== expected.operationId
    || authority.binding.provider !== expected.provider || authority.binding.providerSubject !== expected.providerSubject
    || authority.binding.providerClientId !== expected.providerClientId || authority.binding.email !== expected.email) {
    throw new PrincipalEnrollmentError("MAILBOX_PROOF_INVALID");
  }
  return { principal: authority.principal, verifiedAt: authority.verifiedAt };
}
