import { requestJson, skipAuthRecoveryWithTransientNetworkRetry } from "../transport/transport";

/** Bounds the background task; the caller retries on its own schedule after a failure. */
const linkWebGuestIdentityTimeoutMs = 10 * 1000;

/**
 * Binds one guest identity to the account that is now signed in, for analytics only, and revokes the
 * guest session. Nothing is merged, created, selected or deleted.
 *
 * It is authenticated as the account rather than as the guest, so it goes out on the shared browser
 * session and carries the guest token in its body. Auth recovery is skipped because no analytics
 * work may redirect a person to sign in; the caller runs it right after `GET /me`, which is both the
 * CSRF load this session request needs and the request-context call the route requires to have
 * happened first. Transport retries are safe here, unlike on creation: a repeat either redoes an
 * attempt that committed nothing, or meets a revoked token, which is a successful no-op.
 */
export async function linkWebGuestIdentity(guestToken: string): Promise<void> {
  await requestJson("/guest-auth/identity/link", {
    method: "POST",
    body: JSON.stringify({ guestToken }),
    signal: AbortSignal.timeout(linkWebGuestIdentityTimeoutMs),
  }, skipAuthRecoveryWithTransientNetworkRetry);
}
