import { parseContractResponse } from "../transport/response";
import { parseBrowserGuestProbe, parseBrowserGuestPrepare, parseBrowserGuestUpgradeResult, type BrowserGuestProbe, type BrowserGuestUpgradePreparation, type BrowserGuestUpgradeResult, type GuestUpgradeSelection } from "../../apiContracts/guestAuth";
import { requestBrowserCookieJson, requestJson, skipAuthRecoveryWithTransientNetworkRetry } from "../transport/transport";

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

export async function probeBrowserGuestSession(): Promise<BrowserGuestProbe> {
  return parseContractResponse(await requestBrowserCookieJson("/guest-auth/browser/session", { method: "GET", cache: "no-store" }, skipAuthRecoveryWithTransientNetworkRetry), "GET /guest-auth/browser/session", parseBrowserGuestProbe);
}

export async function createBrowserGuestSession(idempotencyKey: string): Promise<BrowserGuestProbe> {
  return parseContractResponse(await requestBrowserCookieJson("/guest-auth/browser/session", {
    method: "POST", body: JSON.stringify({ idempotencyKey, hasLocalOwnership: false }),
  }, skipAuthRecoveryWithTransientNetworkRetry), "POST /guest-auth/browser/session", parseBrowserGuestProbe);
}

export async function prepareBrowserGuestUpgrade(csrfToken: string, guestWorkspaceSyncedAndOutboxDrained: boolean): Promise<BrowserGuestUpgradePreparation> {
  return parseContractResponse(await requestBrowserCookieJson("/guest-auth/browser/upgrade/prepare", {
    method: "POST", headers: { "X-CSRF-Token": csrfToken }, body: JSON.stringify({ guestWorkspaceSyncedAndOutboxDrained }),
  }, skipAuthRecoveryWithTransientNetworkRetry), "POST /guest-auth/browser/upgrade/prepare", parseBrowserGuestPrepare);
}

export async function completeBrowserGuestUpgrade(csrfToken: string, selection: GuestUpgradeSelection, guestWorkspaceSyncedAndOutboxDrained: boolean): Promise<BrowserGuestUpgradeResult> {
  return parseContractResponse(await requestBrowserCookieJson("/guest-auth/browser/upgrade/complete", {
    method: "POST", headers: { "X-CSRF-Token": csrfToken }, body: JSON.stringify({ selection, guestWorkspaceSyncedAndOutboxDrained, supportsDroppedEntities: true }),
  }, skipAuthRecoveryWithTransientNetworkRetry), "POST /guest-auth/browser/upgrade/complete", parseBrowserGuestUpgradeResult);
}

export async function forgetBrowserGuestSession(csrfToken: string | null): Promise<void> {
  await requestBrowserCookieJson("/guest-auth/browser/session/forget", {
    method: "POST", ...(csrfToken === null ? {} : { headers: { "X-CSRF-Token": csrfToken } }),
  }, skipAuthRecoveryWithTransientNetworkRetry);
}
