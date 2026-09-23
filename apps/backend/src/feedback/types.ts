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
  // support.feedback_submissions.workspace_id as the row holds it. Only the request that inserted
  // the row had its workspace id checked against the person's memberships, so a resend of an
  // already-stored submission id carries an unvalidated one in its body and this is the only
  // workspace id a caller may attribute the submission to.
  workspaceId: string | null;
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
