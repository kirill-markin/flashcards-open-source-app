import { withTransientDatabaseRetry } from "../database/transient";
import { captureBackendWarning, type BackendObservationScope } from "../observability/sentry";
import { createFeedbackEmailErrorMessage, sendFeedbackNotificationEmail } from "./email";
import {
  loadFeedbackStateForUser,
  recordFeedbackPromptEventForUser,
  storeFeedbackSubmissionForUser,
  updateFeedbackSubmissionEmailStatus,
} from "./store";
import type {
  FeedbackNotificationEmailInput,
  FeedbackPromptEventInput,
  FeedbackState,
  FeedbackSubmissionInput,
  FeedbackSubmissionResponse,
  StoredFeedbackSubmission,
} from "./types";

export type FeedbackRequestUser = Readonly<{
  userId: string;
  email: string | null;
}>;

export type FeedbackServiceDependencies = Readonly<{
  loadFeedbackStateForUserFn: typeof loadFeedbackStateForUser;
  recordFeedbackPromptEventForUserFn: typeof recordFeedbackPromptEventForUser;
  storeFeedbackSubmissionForUserFn: typeof storeFeedbackSubmissionForUser;
  updateFeedbackSubmissionEmailStatusFn: typeof updateFeedbackSubmissionEmailStatus;
  sendFeedbackNotificationEmailFn: typeof sendFeedbackNotificationEmail;
}>;

export type WithTransientDatabaseRetry = typeof withTransientDatabaseRetry;

export const feedbackServiceDependencies: FeedbackServiceDependencies = {
  loadFeedbackStateForUserFn: loadFeedbackStateForUser,
  recordFeedbackPromptEventForUserFn: recordFeedbackPromptEventForUser,
  storeFeedbackSubmissionForUserFn: storeFeedbackSubmissionForUser,
  updateFeedbackSubmissionEmailStatusFn: updateFeedbackSubmissionEmailStatus,
  sendFeedbackNotificationEmailFn: sendFeedbackNotificationEmail,
};

function getCaughtErrorClass(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}

function getCaughtErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function captureEmailFailureWarning(
  scope: BackendObservationScope,
  storedSubmission: StoredFeedbackSubmission,
  error: unknown,
): void {
  captureBackendWarning({
    action: "feedback_notification_email_failed",
    scope,
    details: {
      feedbackSubmissionId: storedSubmission.feedbackSubmissionId,
      errorClass: getCaughtErrorClass(error),
      errorMessage: getCaughtErrorMessage(error),
    },
  });
}

function createNotificationEmailInput(
  user: FeedbackRequestUser,
  input: FeedbackSubmissionInput,
  storedSubmission: StoredFeedbackSubmission,
  requestId: string,
): FeedbackNotificationEmailInput {
  return {
    feedbackSubmissionId: storedSubmission.feedbackSubmissionId,
    userId: user.userId,
    userEmail: user.email,
    workspaceId: input.workspaceId,
    installationId: input.installationId,
    platform: input.platform,
    appVersion: input.appVersion,
    locale: input.locale,
    timezone: input.timezone,
    trigger: input.trigger,
    message: input.message,
    createdAtClient: input.createdAtClient,
    createdAtServer: storedSubmission.createdAtServer,
    requestId,
  };
}

async function markSubmissionEmailStatus(
  user: FeedbackRequestUser,
  storedSubmission: StoredFeedbackSubmission,
  status: "sent" | "failed",
  errorMessage: string | null,
  scope: BackendObservationScope,
  withTransientDatabaseRetryFn: WithTransientDatabaseRetry,
  dependencies: FeedbackServiceDependencies,
): Promise<void> {
  await withTransientDatabaseRetryFn(
    async () => dependencies.updateFeedbackSubmissionEmailStatusFn(
      user.userId,
      storedSubmission.feedbackSubmissionId,
      status,
      errorMessage,
    ),
    () => scope,
  );
}

async function sendNotificationForNewSubmission(
  user: FeedbackRequestUser,
  input: FeedbackSubmissionInput,
  storedSubmission: StoredFeedbackSubmission,
  requestId: string,
  scope: BackendObservationScope,
  withTransientDatabaseRetryFn: WithTransientDatabaseRetry,
  dependencies: FeedbackServiceDependencies,
): Promise<void> {
  const notificationInput = createNotificationEmailInput(user, input, storedSubmission, requestId);
  try {
    await dependencies.sendFeedbackNotificationEmailFn(notificationInput, scope);
  } catch (error) {
    captureEmailFailureWarning(scope, storedSubmission, error);
    await markSubmissionEmailStatus(
      user,
      storedSubmission,
      "failed",
      createFeedbackEmailErrorMessage(error),
      scope,
      withTransientDatabaseRetryFn,
      dependencies,
    );
    return;
  }

  await markSubmissionEmailStatus(user, storedSubmission, "sent", null, scope, withTransientDatabaseRetryFn, dependencies);
}

export async function loadFeedbackStateForRequest(
  user: FeedbackRequestUser,
  scope: BackendObservationScope,
  withTransientDatabaseRetryFn: WithTransientDatabaseRetry,
  dependencies: FeedbackServiceDependencies,
): Promise<FeedbackState> {
  return withTransientDatabaseRetryFn(
    async () => dependencies.loadFeedbackStateForUserFn(user.userId),
    () => scope,
  );
}

export async function recordFeedbackPromptEventForRequest(
  user: FeedbackRequestUser,
  input: FeedbackPromptEventInput,
  scope: BackendObservationScope,
  withTransientDatabaseRetryFn: WithTransientDatabaseRetry,
  dependencies: FeedbackServiceDependencies,
): Promise<FeedbackState> {
  return withTransientDatabaseRetryFn(
    async () => dependencies.recordFeedbackPromptEventForUserFn(user.userId, input),
    () => scope,
  );
}

export async function submitFeedbackForRequest(
  user: FeedbackRequestUser,
  input: FeedbackSubmissionInput,
  requestId: string,
  scope: BackendObservationScope,
  withTransientDatabaseRetryFn: WithTransientDatabaseRetry,
  dependencies: FeedbackServiceDependencies,
): Promise<FeedbackSubmissionResponse> {
  const storedSubmission = await withTransientDatabaseRetryFn(
    async () => dependencies.storeFeedbackSubmissionForUserFn(user.userId, user.email, input),
    () => scope,
  );

  if (storedSubmission.emailNotificationRequired) {
    await sendNotificationForNewSubmission(
      user,
      input,
      storedSubmission,
      requestId,
      scope,
      withTransientDatabaseRetryFn,
      dependencies,
    );
  }

  const feedbackState = await loadFeedbackStateForRequest(user, scope, withTransientDatabaseRetryFn, dependencies);
  return {
    feedbackSubmissionId: storedSubmission.feedbackSubmissionId,
    createdAtServer: storedSubmission.createdAtServer,
    feedbackState,
  };
}

export type {
  FeedbackPromptEventInput,
  FeedbackState,
  FeedbackSubmissionInput,
  FeedbackSubmissionResponse,
};
