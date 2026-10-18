import { browserGuestAiTrialEnabled } from "../aiUsage/browserGuestTrial/policy";
import { HttpError } from "../shared/errors";
import type { UserOpenAIApiKey } from "../chat/userOpenAIApiKey";
import type { AuthTransport } from "../auth";
import type { GuestSessionPlatform, GuestSessionPurpose } from "./types";

export type WebGuestRefusal = Readonly<{
  message: string;
  code: string;
}>;

export const webGuestSurfaceRefusal: WebGuestRefusal = {
  message: "Web guest sessions can only send product analytics. Sign in to use this endpoint.",
  code: "GUEST_WEB_PLATFORM_UNSUPPORTED",
};

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

type GuestAccessContext = Readonly<{
  transport: AuthTransport;
  guestPlatform: GuestSessionPlatform | null;
  guestSessionPurpose?: GuestSessionPurpose | null;
  guestCredentialSource?: "authorization" | "cookie" | null;
}>;

export type BrowserGuestCapabilities = Readonly<{
  isGuest: true;
  platformFundedAi: boolean;
  ownKeyAi: true;
  requiresAccountLinking: true;
}>;

// Purpose and source are authentication results, never values declared by the client.
export function isBrowserProductGuest(context: GuestAccessContext): boolean {
  return context.transport === "guest"
    && context.guestPlatform === "web"
    && context.guestSessionPurpose === "browser_product"
    && context.guestCredentialSource === "cookie";
}

export function assertGuestRequestSupportsProduct(context: GuestAccessContext): void {
  if (isBrowserProductGuest(context)) {
    return;
  }

  assertGuestPlatformSupportsSurface(context.guestPlatform);
}

export function getBrowserGuestCapabilities(context: GuestAccessContext): BrowserGuestCapabilities | null {
  return isBrowserProductGuest(context)
    ? { isGuest: true, platformFundedAi: browserGuestAiTrialEnabled, ownKeyAi: true, requiresAccountLinking: true }
    : null;
}

export function assertGuestAiFundingAllowed(
  context: GuestAccessContext,
  userOpenAIApiKey: UserOpenAIApiKey | null,
): void {
  assertGuestRequestSupportsProduct(context);
  if (isBrowserProductGuest(context) && userOpenAIApiKey === null) {
    throw new HttpError(
      403,
      "Sign in to use AI funded by Nibomo, or provide your own OpenAI API key.",
      "GUEST_WEB_AI_SIGN_IN_REQUIRED",
    );
  }
}
