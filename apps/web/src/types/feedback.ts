import type { Locale } from "../i18n/types";

export type FeedbackTrigger = "settings" | "automatic";

export type FeedbackPlatform = "web";

export type FeedbackPromptEventType = "automatic_prompt_shown" | "automatic_prompt_dismissed";

export type FeedbackState = Readonly<{
  automaticPromptCooldownDays: number;
  lastAutomaticPromptShownAt: string | null;
  lastFeedbackSubmittedAt: string | null;
  nextAutomaticPromptAt: string | null;
}>;

export type FeedbackStateEnvelope = Readonly<{
  feedbackState: FeedbackState;
}>;

export type FeedbackPromptEventRequest = Readonly<{
  feedbackPromptEventId: string;
  workspaceId: string | null;
  installationId: string | null;
  platform: FeedbackPlatform;
  appVersion: string;
  locale: Locale;
  timezone: string;
  eventType: FeedbackPromptEventType;
  createdAtClient: string;
}>;

export type FeedbackPromptEventResponse = FeedbackStateEnvelope & Readonly<{
  ok?: true;
}>;

export type FeedbackSubmissionRequest = Readonly<{
  feedbackSubmissionId: string;
  workspaceId: string | null;
  installationId: string | null;
  platform: FeedbackPlatform;
  appVersion: string;
  locale: Locale;
  timezone: string;
  trigger: FeedbackTrigger;
  message: string;
  createdAtClient: string;
}>;

export type FeedbackSubmissionResponse = FeedbackStateEnvelope & Readonly<{
  ok?: true;
}>;
