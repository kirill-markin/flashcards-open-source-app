import { getStableInstallationId, webAppVersion } from "../clientIdentity";
import type {
  FeedbackSubmissionRequest,
  FeedbackTrigger,
} from "../types";
import type { Locale } from "../i18n/types";
import { buildProgressDateContext } from "../progress/progressDates";

export const feedbackMaximumMessageLength: number = 5000;

export type BuildFeedbackSubmissionRequestInput = Readonly<{
  workspaceId: string | null;
  locale: Locale;
  trigger: FeedbackTrigger;
  message: string;
  now: Date;
}>;

export function normalizeFeedbackMessage(message: string): string {
  return message.trim();
}

export function isFeedbackMessageSubmittable(message: string): boolean {
  const normalizedMessage = normalizeFeedbackMessage(message);
  return normalizedMessage !== "" && normalizedMessage.length <= feedbackMaximumMessageLength;
}

export function buildFeedbackSubmissionRequest(
  input: BuildFeedbackSubmissionRequestInput,
): FeedbackSubmissionRequest {
  const normalizedMessage = normalizeFeedbackMessage(input.message);
  if (normalizedMessage === "") {
    throw new Error("Feedback message is required");
  }

  if (normalizedMessage.length > feedbackMaximumMessageLength) {
    throw new Error(`Feedback message must be ${feedbackMaximumMessageLength} characters or fewer`);
  }

  return {
    feedbackSubmissionId: crypto.randomUUID().toLowerCase(),
    workspaceId: input.workspaceId,
    installationId: getStableInstallationId(),
    platform: "web",
    appVersion: webAppVersion,
    locale: input.locale,
    timezone: buildProgressDateContext(input.now).timeZone,
    trigger: input.trigger,
    message: normalizedMessage,
    createdAtClient: input.now.toISOString(),
  };
}
