import type { ProviderEmailEnrollmentOutcome } from "./social/providerEmailEnrollment.js";
import type { AuthTraceId } from "./sentry.js";
import type { CognitoOperation } from "./cognito/cognitoErrors.js";
import type { AuthPurpose } from "./social/attemptContract.js";
import type { IdentityProvider } from "./social/identityStore.js";
import type { PrincipalEnrollmentResult, EnrolledProviderPrincipal } from "./social/principalEnrollment.js";
import type { ProviderEmail, SocialClient } from "./social/providers.js";

type AuthAction =
  | "send_code"
  | "send_code_error"
  | "send_code_demo_sign_in"
  | "send_code_demo_sign_in_error"
  | "agent_send_code_blocked_ip_limit"
  | "agent_send_code_error"
  | "verify_code"
  | "verify_code_error"
  | "verify_code_locked"
  | "issued_session_validation_error"
  | "sign_in_password"
  | "sign_in_password_error"
  | "agent_verify_code_error"
  | "agent_verify_code_locked"
  | "refresh_token"
  | "refresh_token_error"
  | "refresh_session"
  | "refresh_session_error"
  | "refresh_session_missing_cookie"
  | "revoke_token"
  | "revoke_token_error"
  | "database_pool_error"
  | "analytics_ingest_error"
  | "request_error"
  | "apple_revocation_drain"
  | "apple_revocation_wake"
  | "apple_notification"
  | "apple_identity_verified"
  | "provider_mailbox_verification_required"
  | "provider_reconnected"
  | "provider_email_enrollment"
  | "provider_email_enrollment_error"
  | "error";

type AppleEmailCategory = "missing" | "relay" | "real";
export type AppleIdentityProofFacts = Readonly<{
  identitySource: "native" | "exchange";
  suppliedEmailCategory: AppleEmailCategory | null;
  suppliedEmailVerified: boolean | null;
  suppliedPrivateRelay: boolean | null;
  exchangedEmailCategory: AppleEmailCategory;
  exchangedEmailVerified: boolean | null;
  exchangedPrivateRelay: boolean | null;
  emailMismatch: boolean | null;
}>;

export type AuthLogEvent = Readonly<{
  domain: "auth";
  action: AuthAction;
  requestId?: string;
  traceId?: AuthTraceId | null;
  route?: string;
  statusCode?: number;
  code?: string;
  claimed?: number;
  completed?: number;
  failed?: number;
  poolName?: string;
  sqlState?: string | null;
  errorCode?: string | null;
  errorClass?: string;
  errorMessage?: string;
  operation?: CognitoOperation;
  cognitoType?: string;
  providerStatusCode?: number;
  reasonCategory?: string;
  mailboxReason?: Exclude<PrincipalEnrollmentResult, EnrolledProviderPrincipal>["reason"];
  provider?: IdentityProvider;
  client?: SocialClient;
  purpose?: AuthPurpose;
  attemptHash?: string;
  appleProof?: AppleIdentityProofFacts;
  emailEnrollment?: ProviderEmailEnrollmentOutcome;
  emailAuthority?: ProviderEmail["authority"] | null;
  privateRelay?: boolean | null;
  maskedEmail?: string;
  ipAddress?: string;
  error?: string;
}>;

export type AuthLogger = (event: AuthLogEvent) => void;

export const maskEmail = (email: string): string => {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "***";
  return `${local[0]}***@${domain}`;
};

export const log: AuthLogger = (event) => {
  console.log(JSON.stringify(event));
};

export const logWarning: AuthLogger = (event) => {
  console.warn(JSON.stringify(event));
};
