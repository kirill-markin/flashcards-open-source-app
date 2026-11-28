import { isStandaloneDeployment } from "../../deployment/standalone";
import type { RequestContext } from "../../server/requestContext";

/** A standalone self-host never funds a browser guest's AI with the operator's key. */
export function isBrowserGuestAiTrialEnabled(): boolean {
  return !isStandaloneDeployment();
}
export const browserGuestAiTrialFeatures = ["chat", "dictation", "images"] as const;
export type BrowserGuestAiTrialFeature = typeof browserGuestAiTrialFeatures[number];
export type BrowserGuestAiTrialScope = "guest" | "shared";
export type BrowserGuestTrialContext = Pick<RequestContext,
  "userId" | "transport" | "guestSessionId" | "guestPlatform" | "guestSessionPurpose" | "guestCredentialSource">;
