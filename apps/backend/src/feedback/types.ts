export const feedbackAutomaticPromptCooldownDays = 30;
export const feedbackMessageMaxCharacters = 5000;
export const feedbackNotificationRecipientEmail = "kirill+flashcards@kirill-markin.com";

export type FeedbackPlatform = "ios" | "android" | "web";
export type FeedbackPromptEventType = "automatic_prompt_shown" | "automatic_prompt_dismissed";
export type FeedbackSubmissionTrigger = "automatic" | "settings";
export type FeedbackEmailNotificationStatus = "pending" | "sent" | "failed";

export type FeedbackState = Readonly<{
  automaticPromptCooldownDays: number;
  lastAutomaticPromptShownAt: string | null;
  lastFeedbackSubmittedAt: string | null;
  nextAutomaticPromptAt: string | null;
}>;

export type FeedbackStateEnvelope = Readonly<{
  feedbackState: FeedbackState;
}>;

export type FeedbackPromptEventInput = Readonly<{
  feedbackPromptEventId: string;
  workspaceId: string | null;
  installationId: string | null;
  platform: FeedbackPlatform;
  appVersion: string | null;
  locale: string | null;
  timezone: string | null;
  eventType: FeedbackPromptEventType;
  createdAtClient: string;
}>;

export type FeedbackSubmissionInput = Readonly<{
  feedbackSubmissionId: string;
  workspaceId: string | null;
  installationId: string | null;
  platform: FeedbackPlatform;
  appVersion: string | null;
  locale: string | null;
  timezone: string | null;
  trigger: FeedbackSubmissionTrigger;
  message: string;
  createdAtClient: string;
}>;

export type StoredFeedbackSubmission = Readonly<{
  feedbackSubmissionId: string;
  createdAtServer: string;
  emailNotificationRequired: boolean;
}>;

export type FeedbackSubmissionResponse = Readonly<{
  feedbackSubmissionId: string;
  createdAtServer: string;
  feedbackState: FeedbackState;
}>;

export type FeedbackNotificationEmailInput = Readonly<{
  feedbackSubmissionId: string;
  userId: string;
  userEmail: string | null;
  workspaceId: string | null;
  installationId: string | null;
  platform: FeedbackPlatform;
  appVersion: string | null;
  locale: string | null;
  timezone: string | null;
  trigger: FeedbackSubmissionTrigger;
  message: string;
  createdAtClient: string;
  createdAtServer: string;
  requestId: string;
}>;
