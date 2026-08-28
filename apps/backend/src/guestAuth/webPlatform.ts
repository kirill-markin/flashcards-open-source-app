import { HttpError } from "../shared/errors";
import type { GuestSessionPlatform } from "./types";

/**
 * The one place that decides what a `web` guest platform may reach.
 *
 * A web guest session is an analytics credential and nothing more. It is minted by a signed-out
 * browser on its first interaction and kept in `localStorage`, where the visitor and any script on
 * the page can read it, so it must not authenticate anything that spends money, writes product data
 * or exposes an account surface. `ios` and `android` guest sessions are the opposite: they own an
 * offline workspace, sync it and can be upgraded into an account.
 *
 * Only the literal `"web"` is refused. Inverting this into an `ios`/`android` allowlist would also
 * refuse `null`, which is what pre-1.7.0 iOS and Android guest sessions still carry, and would take
 * every guest surface away from those shipped clients.
 *
 * `guestPlatform` is non-null only for the guest transport — every other transport reports `null` in
 * `auth/index.ts` — so a platform check alone is a complete test and no transport argument is needed.
 */
export type WebGuestRefusal = Readonly<{
  message: string;
  code: string;
}>;

/**
 * The refusal for the default-deny gate in `server/requestContext.ts`, which every authenticated
 * HTTP surface passes through.
 */
export const webGuestSurfaceRefusal: WebGuestRefusal = {
  message: "Web guest sessions can only send product analytics. Sign in to use this endpoint.",
  code: "GUEST_WEB_PLATFORM_UNSUPPORTED",
};

/**
 * The refusal for guest upgrade, which is reached with a token from the request body rather than
 * from the request context and so cannot go through the gate above.
 */
export const webGuestUpgradeRefusal: WebGuestRefusal = {
  message: "Web guest sessions cannot be upgraded. Sign in on the web app instead.",
  code: "GUEST_UPGRADE_WEB_PLATFORM_UNSUPPORTED",
};

export function isWebGuestSessionPlatform(platform: GuestSessionPlatform | null): boolean {
  return platform === "web";
}

export function assertGuestPlatformSupportsSurface(
  platform: GuestSessionPlatform | null,
  refusal: WebGuestRefusal = webGuestSurfaceRefusal,
): void {
  if (isWebGuestSessionPlatform(platform) === false) {
    return;
  }

  throw new HttpError(403, refusal.message, refusal.code);
}
