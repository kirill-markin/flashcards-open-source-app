import { bindGuestSessionPlatform, type GuestSessionPlatform } from "../../guestAuth";
import type { RequestContext } from "../../server/requestContext";
import { HttpError } from "../../shared/errors";

export type SyncClientPlatform = "ios" | "android" | "web";

export function toGuestSessionPlatform(platform: SyncClientPlatform): GuestSessionPlatform | null {
  if (platform === "ios" || platform === "android") {
    return platform;
  }

  return null;
}

export async function requireSupportedSyncPlatformForTransport(
  requestContext: RequestContext,
  platform: SyncClientPlatform,
  bindGuestSessionPlatformFn: typeof bindGuestSessionPlatform,
): Promise<void> {
  if (requestContext.transport !== "guest") {
    return;
  }

  const guestPlatform = toGuestSessionPlatform(platform);
  if (guestPlatform === null) {
    throw new HttpError(
      403,
      "Guest web sync is not supported. Sign in before syncing from the web app.",
      "GUEST_WEB_SYNC_UNSUPPORTED",
    );
  }

  if (requestContext.guestSessionId === null) {
    throw new Error("Guest sync request context is missing guestSessionId");
  }

  if (requestContext.guestPlatform === null) {
    // Pre-1.7.0 iOS/Android guest sessions are unbound at creation time.
    // Bind them on first native sync, then remove this path after those versions are no longer supported.
    await bindGuestSessionPlatformFn(requestContext.guestSessionId, guestPlatform);
    return;
  }

  if (requestContext.guestPlatform !== guestPlatform) {
    throw new HttpError(
      403,
      "Guest session platform does not match this sync request. Create a new guest session for this device.",
      "GUEST_SESSION_PLATFORM_MISMATCH",
    );
  }
}
