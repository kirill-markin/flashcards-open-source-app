import { HttpError } from "../../shared/errors";
import type { BrowserGuestAiTrialFeature, BrowserGuestAiTrialScope } from "./policy";

export const browserGuestAiTrialQuotaCode = "BROWSER_GUEST_AI_TRIAL_QUOTA_REACHED";

export function createBrowserGuestAiTrialIneligibleError(): HttpError {
  return new HttpError(403, "This allowance requires an authenticated browser-product guest cookie and session.",
    "BROWSER_GUEST_AI_TRIAL_INELIGIBLE");
}

export type BrowserGuestAiTrialQuotaDetails = Readonly<{
  feature: BrowserGuestAiTrialFeature;
  scope: BrowserGuestAiTrialScope;
  resetsAt: string | null;
}>;

export type BrowserGuestAiTrialFeatureStatus = Readonly<{
  lifetimeLimit: number;
  lifetimeRemaining: number;
  sharedDailyLimit: number;
  sharedAvailable: boolean;
}>;

export type BrowserGuestAiTrialStatus = Readonly<{
  version: 1;
  enabled: boolean;
  sharedResetsAt: string;
  maxRecordingSeconds: number;
  chat: BrowserGuestAiTrialFeatureStatus;
  dictation: BrowserGuestAiTrialFeatureStatus;
  images: BrowserGuestAiTrialFeatureStatus;
}>;

export function createBrowserGuestAiTrialQuotaError(details: BrowserGuestAiTrialQuotaDetails): HttpError {
  return new HttpError(
    429,
    details.scope === "guest"
      ? "Your guest allowance for this AI feature is exhausted. Sign in to continue."
      : "Today’s shared guest allowance for this AI feature is exhausted. Sign in to continue.",
    browserGuestAiTrialQuotaCode,
    { browserGuestAiTrial: details },
  );
}
