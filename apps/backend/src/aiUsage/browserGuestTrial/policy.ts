import type { RequestContext } from "../../server/requestContext";

export const browserGuestAiTrialEnabled = false;
export const browserGuestAiTrialFeatures = ["chat", "dictation", "images"] as const;
export type BrowserGuestAiTrialFeature = typeof browserGuestAiTrialFeatures[number];
export type BrowserGuestAiTrialScope = "guest" | "shared";
export type BrowserGuestTrialContext = Pick<RequestContext,
  "userId" | "transport" | "guestSessionId" | "guestPlatform" | "guestSessionPurpose" | "guestCredentialSource">;
