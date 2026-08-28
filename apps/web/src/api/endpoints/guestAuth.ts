import {
  parseWebGuestSessionResponse,
  type WebGuestSessionEnvelope,
} from "../../apiContracts/guestAuth";
import { parseContractResponse } from "../transport/response";
import {
  requestGuestJson,
  requestJson,
  skipAuthRecoveryWithTransientNetworkRetry,
  skipAuthRecoveryWithoutNetworkRetry,
} from "../transport/transport";

/**
 * Budget for the single attempt this call makes. Without it a hung fetch never settles and the
 * caller's one attempt for this page load is parked in flight for the rest of it, measuring nothing.
 * Long enough that an ordinary slow network still succeeds, because a request that times out may
 * have created the server-side rows anyway and only the caller's persisted `idempotencyKey` makes a
 * later attempt return that same guest rather than a second one.
 */
const createWebGuestSessionTimeoutMs = 10 * 1000;

/** Bounds the background task; the caller retries on its own schedule after a failure. */
const linkWebGuestIdentityTimeoutMs = 10 * 1000;

/**
 * Creates a guest session bound to the web platform.
 *
 * The request carries no credential of its own, so it goes out through the guest transport rather
 * than the session one: the session pipeline loads `/me` first to obtain a CSRF token, which a
 * signed-out browser has no way to get. Auth recovery is skipped for the same reason — a signed-out
 * visitor must never be redirected to sign in because analytics wanted an identity.
 *
 * The transport still sends it exactly once. A connection dropped after the server committed is
 * indistinguishable from one dropped before it, and what makes the repeat safe is not the transport
 * but `idempotencyKey`: a key that still names a live session rotates that session's secret and
 * returns the same guest user and workspace instead of writing a second permanent set of rows. Only
 * the caller knows whether it is replaying the same creation attempt, so it owns both the key and
 * the retry — `webGuestSession.ts` persists the key, re-arms after its own retry delay, and replays
 * it from the next interaction, while the events wait in the local queue under their 14-day TTL.
 */
export async function createWebGuestSession(idempotencyKey: string): Promise<WebGuestSessionEnvelope> {
  return parseContractResponse(
    await requestGuestJson("/guest-auth/session", {
      method: "POST",
      body: JSON.stringify({ platform: "web", idempotencyKey }),
      signal: AbortSignal.timeout(createWebGuestSessionTimeoutMs),
    }, null, skipAuthRecoveryWithoutNetworkRetry),
    "POST /guest-auth/session",
    parseWebGuestSessionResponse,
  );
}

/**
 * Binds one guest identity to the account that is now signed in, for analytics only, and revokes the
 * guest session. Nothing is merged, created, selected or deleted.
 *
 * It is authenticated as the account rather than as the guest, so it goes out on the shared browser
 * session and carries the guest token in its body. Auth recovery is skipped because no analytics
 * work may redirect a person to sign in; the caller runs it right after `GET /me`, which is both the
 * CSRF load this session request needs and the request-context call the route requires to have
 * happened first. Transport retries are safe here, unlike on creation: a repeat conflicts on the
 * same guest and account pair, stores nothing new, and completes a revoke that an earlier attempt
 * may have left behind.
 */
export async function linkWebGuestIdentity(guestToken: string): Promise<void> {
  await requestJson("/guest-auth/identity/link", {
    method: "POST",
    body: JSON.stringify({ guestToken }),
    signal: AbortSignal.timeout(linkWebGuestIdentityTimeoutMs),
  }, skipAuthRecoveryWithTransientNetworkRetry);
}
