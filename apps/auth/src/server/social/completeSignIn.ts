import { transaction } from "../../db.js";
import {
  beginAuthAttemptMailboxOtp, claimAuthAttempt, loadAuthAttemptForMailbox, verifyClaimedAuthAttempt,
} from "./attemptStore.js";
import { completeAuthoritativeAuthAttempt, completeMailboxAuthAttempt, redeemSocialSignInInExecutor } from "./completionStore.js";
import type { AuthCompletionResponse } from "./attemptContract.js";
import { AuthAttemptError } from "./attemptContract.js";
import { normalizeEnrollmentEmail } from "./mailboxProof.js";
import { exchangeVerifiedPrincipalForTokens } from "./nativeProofBridge.js";
import { requireNativeProvider, requireSignInProvider } from "./publicMethods.js";
import type { NativeSignInRequest, SignInContinuationRequest } from "./publicContract.js";
import type { TokenResult } from "../cognito/cognitoAuth.js";
import type { ProviderSignInHint } from "./signInHint.js";
import type { IdentityProvider } from "./identityStore.js";
import { decideOtpRateLimit, recordOtpSendDecision } from "../otp/otpRateLimit.js";

export type NativeSignInResponse =
  | Readonly<{ status: "completed" } & AuthCompletionResponse>
  | Readonly<{ status: "verification_required"; reason: "mailbox_required" | "existing_email" | "historical_binding"; providerEmail: string | null }>
  | Readonly<{ status: "mailbox_code_sent" }>
  | Readonly<{ ok: true; signInHint: ProviderSignInHint } & TokenResult>;

type NativeSignInResult = Readonly<{ response: NativeSignInResponse; method: IdentityProvider }>;

/** Tokens create no org rows: native guest prepare/complete must precede the first generic account request. */
export async function completeNativeSignIn(request: NativeSignInRequest, trustedIp: string): Promise<NativeSignInResult> {
  return completeSignIn(request, trustedIp);
}

export async function continueBrowserSignIn(request: SignInContinuationRequest, trustedIp: string): Promise<NativeSignInResult> {
  if (request.binding.client !== "web") throw new AuthAttemptError("AUTH_ATTEMPT_INVALID");
  return completeSignIn(request, trustedIp);
}

async function completeSignIn(request: NativeSignInRequest | SignInContinuationRequest, trustedIp: string): Promise<NativeSignInResult> {
  if (request.action === "redeem") {
    const principal = await transaction((executor) => redeemSocialSignInInExecutor(executor, request.completion, request.binding));
    requireSignInProvider(principal.signInHint.method, request.binding.client);
    const tokens = await exchangeVerifiedPrincipalForTokens(principal);
    return { response: { ok: true, ...tokens, signInHint: principal.signInHint }, method: principal.signInHint.method };
  }
  if (request.action === "provider") {
    requireNativeProvider(request.submission.provider, request.binding.client);
    const claimed = await claimAuthAttempt(request.attempt, request.binding, "provider_ready");
    const verified = await verifyClaimedAuthAttempt(claimed, request.submission);
    const result = await completeAuthoritativeAuthAttempt(verified);
    return {
      response: result.status === "completed" ? { status: "completed", ...result.response }
        : { status: "verification_required", reason: result.enrollment.reason, providerEmail: result.enrollment.providerEmail },
      method: claimed.provider,
    };
  }
  if (request.action === "mailbox_verify") {
    const claimed = await claimAuthAttempt(request.attempt, request.binding, "mailbox_ready");
    requireSignInProvider(claimed.provider, claimed.client);
    return { response: { status: "completed", ...await completeMailboxAuthAttempt(claimed, request.code) }, method: claimed.provider };
  }
  const email = normalizeEnrollmentEmail(request.email);
  const attempt = await loadAuthAttemptForMailbox(request.attempt, request.binding);
  requireSignInProvider(attempt.provider, attempt.client);
  const decision = await decideOtpRateLimit(email, trustedIp);
  if (decision.kind !== "send") {
    await recordOtpSendDecision(email, trustedIp, decision.kind === "block_ip_limit" ? "blocked_ip_limit" : "suppressed_email_limit", null);
    throw new AuthAttemptError("AUTH_RATE_LIMITED");
  }
  await beginAuthAttemptMailboxOtp(attempt, email);
  await recordOtpSendDecision(email, trustedIp, "sent", null);
  return { response: { status: "mailbox_code_sent" }, method: attempt.provider };
}
