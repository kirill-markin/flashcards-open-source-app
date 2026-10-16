import { createHash } from "node:crypto";
import type { JwtPayload } from "aws-jwt-verify/jwt-model";
import { query, transaction } from "../../db.js";
import { getAppleSignInConfig } from "./config.js";
import { wakeAppleRevocations } from "./appleRevocationWake.js";
import {
  createProviderVerifier, parseProviderObject, readProviderBoolean, readProviderEmail,
  rejectProviderProof, SocialProofError,
} from "./providers.js";

export class AppleRelayDeliveryDisabledError extends Error {
  readonly code = "APPLE_RELAY_DELIVERY_DISABLED";
  constructor() {
    super("Enable email forwarding for Nibomo in your Apple Account settings before requesting a code.");
    this.name = "AppleRelayDeliveryDisabledError";
  }
}

const verifiers = new Map<string, ReturnType<typeof createProviderVerifier>>();
type AppleNotificationType = "email-enabled" | "email-disabled" | "consent-revoked" | "account-deleted";
export type AppleNotificationOutcome = "applied" | "ignored_unbound" | "ignored_stale";
type AppleNotification = Readonly<{
  notificationHash: string;
  payloadHash: string;
  providerSubject: string;
  type: AppleNotificationType;
  eventAt: Date;
  email: string | null;
}>;

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isRelayAddress(email: string): boolean {
  return email.endsWith("@privaterelay.appleid.com") || email.endsWith("@private.icloud.com");
}

function parseVerifiedNotification(payload: JwtPayload, token: string): AppleNotification {
  const now = Math.floor(Date.now() / 1_000);
  // Apple documents iat/jti/events without exp; if exp is present, the shared verifier enforces it.
  // There is no published retry age guarantee. Durable jti receipts and event ordering fence old deliveries.
  if (!Number.isSafeInteger(payload.iat) || (payload.iat as number) <= 0 || (payload.iat as number) > now + 30
    || (payload.exp !== undefined && (!Number.isSafeInteger(payload.exp) || (payload.exp as number) <= (payload.iat as number)))
    || typeof payload.aud !== "string" || typeof payload.jti !== "string" || payload.jti.length < 1 || payload.jti.length > 255) {
    throw new SocialProofError("PROVIDER_PROOF_INVALID");
  }
  const events = typeof payload.events === "string"
    ? parseProviderObject(payload.events, "PROVIDER_PROOF_INVALID") : payload.events;
  if (events === null || typeof events !== "object" || Array.isArray(events)) throw new SocialProofError("PROVIDER_PROOF_INVALID");
  const event = events as Record<string, unknown>;
  if (event.type !== "email-enabled" && event.type !== "email-disabled" && event.type !== "consent-revoked" && event.type !== "account-deleted") {
    throw new SocialProofError("PROVIDER_PROOF_INVALID");
  }
  if (typeof event.sub !== "string" || !/^[A-Za-z0-9._-]{1,255}$/.test(event.sub)
    || typeof event.event_time !== "number" || !Number.isSafeInteger(event.event_time) || event.event_time <= 0) {
    throw new SocialProofError("PROVIDER_PROOF_INVALID");
  }
  // Current documentation illustrates seconds; actual Apple deliveries also use Unix milliseconds.
  const eventTimeMs = event.event_time >= 1_000_000_000_000 ? event.event_time : event.event_time * 1_000;
  if (eventTimeMs > ((payload.iat as number) + 30) * 1_000 || !Number.isSafeInteger(eventTimeMs)) {
    throw new SocialProofError("PROVIDER_PROOF_INVALID");
  }
  const email = readProviderEmail(event.email);
  if ((event.type === "email-enabled" || event.type === "email-disabled")
    && (email === null || !isRelayAddress(email) || !readProviderBoolean(event.is_private_email))) {
    throw new SocialProofError("PROVIDER_PROOF_INVALID");
  }
  return {
    notificationHash: hash(JSON.stringify([payload.iss, payload.aud, payload.jti])), payloadHash: hash(token),
    providerSubject: event.sub, type: event.type, eventAt: new Date(eventTimeMs), email,
  };
}

export async function processSignedAppleNotification(token: string): Promise<AppleNotificationOutcome> {
  const config = getAppleSignInConfig();
  if (config === null) throw new SocialProofError("PROVIDER_UNAVAILABLE");
  if (typeof token !== "string" || token.length < 1 || token.length > 16_384 || token.split(".").length !== 3) {
    throw new SocialProofError("PROVIDER_PROOF_INVALID");
  }
  const audiences = [config.iosClientId, config.iosDevelopmentClientId, config.serviceId];
  const verifierKey = JSON.stringify(audiences);
  let verifier = verifiers.get(verifierKey);
  if (verifier === undefined) {
    // Audience is selected from configuration, never from an unverified token.
    verifier = createProviderVerifier("https://appleid.apple.com", audiences, "https://appleid.apple.com/auth/keys");
    verifiers.set(verifierKey, verifier);
  }
  let notification: AppleNotification;
  try {
    const payload = await verifier.verify(token);
    if (!audiences.includes(typeof payload.aud === "string" ? payload.aud : "")) throw new SocialProofError("PROVIDER_PROOF_INVALID");
    notification = parseVerifiedNotification(payload, token);
  } catch (error) {
    rejectProviderProof(error);
  }
  const outcome = await transaction(async (executor) => {
    await executor.query("SET LOCAL lock_timeout = '1s'", []);
    await executor.query("SET LOCAL statement_timeout = '2s'", []);
    const result = await executor.query<Readonly<{ outcome: AppleNotificationOutcome }>>(
      "SELECT auth.apply_apple_notification($1, $2, $3, $4, $5, $6) AS outcome",
      [notification.notificationHash, notification.payloadHash, notification.providerSubject,
        notification.type, notification.eventAt, notification.email],
    );
    if (result.rows[0] === undefined) throw new Error("Apple notification processing returned no outcome");
    return result.rows[0].outcome;
  });
  if (outcome === "applied" && (notification.type === "consent-revoked" || notification.type === "account-deleted")) {
    await wakeAppleRevocations();
  }
  return outcome;
}

/** Delivery availability does not remove the verified alias or disable the email OTP method. */
export async function assertAppleRelayDeliveryAllowed(email: string): Promise<void> {
  if (!isRelayAddress(email.toLowerCase())) return;
  const result = await query<Readonly<{ allowed: boolean }>>(
    "SELECT auth.apple_relay_delivery_allowed($1) AS allowed", [email],
  );
  if (result.rows[0] === undefined) throw new Error("Apple relay delivery lookup returned no result");
  if (!result.rows[0].allowed) {
    throw new AppleRelayDeliveryDisabledError();
  }
}
