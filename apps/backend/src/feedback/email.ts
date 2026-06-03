import { captureBackendWarning, type BackendObservationScope } from "../observability/sentry";
import { feedbackNotificationRecipientEmail, type FeedbackNotificationEmailInput } from "./types";

type FetchFunction = typeof fetch;

type ResendEmailConfig = Readonly<{
  apiKey: string;
  fromEmail: string;
  fromName: string;
}>;

type ResendEmailRequest = Readonly<{
  config: ResendEmailConfig;
  input: FeedbackNotificationEmailInput;
}>;

type EmailSendDependencies = Readonly<{
  fetchFn: FetchFunction;
  sleepFn: (delayMs: number) => Promise<void>;
}>;

type EmailErrorDetails = Readonly<{
  errorClass: string;
  errorMessage: string;
  statusCode: number | null;
  responseBody: string | null;
}>;

const resendEmailMaxAttempts = 3;
const resendEmailRetryBaseDelayMs = 300;

export class FeedbackEmailConfigurationError extends Error {
  constructor(message: string) {
    super(message);
  }
}

export class FeedbackEmailSendError extends Error {
  readonly statusCode: number;
  readonly responseBody: string;

  constructor(statusCode: number, responseBody: string) {
    super(`Resend feedback notification failed with status ${statusCode}: ${responseBody}`);
    this.statusCode = statusCode;
    this.responseBody = responseBody;
  }
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

function getRequiredEnvironmentValue(name: string): string {
  const value = process.env[name]?.trim() ?? "";
  if (value === "") {
    throw new FeedbackEmailConfigurationError(`${name} is required to send feedback notification email.`);
  }

  return value;
}

function getResendEmailConfig(): ResendEmailConfig {
  return {
    apiKey: getRequiredEnvironmentValue("RESEND_API_KEY"),
    fromEmail: getRequiredEnvironmentValue("RESEND_FROM_EMAIL"),
    fromName: "Flashcards Open Source App",
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function formatNullableValue(value: string | null): string {
  return value === null ? "" : value;
}

function createEmailField(label: string, value: string | null): string {
  return `<tr><th align="left">${escapeHtml(label)}</th><td>${escapeHtml(formatNullableValue(value))}</td></tr>`;
}

function buildFeedbackNotificationHtml(input: FeedbackNotificationEmailInput): string {
  const fields = [
    createEmailField("Submission ID", input.feedbackSubmissionId),
    createEmailField("Trigger", input.trigger),
    createEmailField("Platform", input.platform),
    createEmailField("App version", input.appVersion),
    createEmailField("Locale", input.locale),
    createEmailField("Timezone", input.timezone),
    createEmailField("User ID", input.userId),
    createEmailField("User email", input.userEmail),
    createEmailField("Workspace ID", input.workspaceId),
    createEmailField("Installation ID", input.installationId),
    createEmailField("Created at client", input.createdAtClient),
    createEmailField("Created at server", input.createdAtServer),
    createEmailField("Request ID", input.requestId),
  ].join("");

  return [
    "<h1>Flashcards feedback</h1>",
    "<h2>Message</h2>",
    `<p>${escapeHtml(input.message).replaceAll("\n", "<br>")}</p>`,
    "<h2>Context</h2>",
    `<table>${fields}</table>`,
  ].join("");
}

function buildFeedbackNotificationSubject(input: FeedbackNotificationEmailInput): string {
  return `Flashcards feedback (${input.trigger}, ${input.platform})`;
}

async function sendResendFeedbackEmail(request: ResendEmailRequest, fetchFn: FetchFunction): Promise<void> {
  const response = await fetchFn("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${request.config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `${request.config.fromName} <${request.config.fromEmail}>`,
      to: [feedbackNotificationRecipientEmail],
      subject: buildFeedbackNotificationSubject(request.input),
      html: buildFeedbackNotificationHtml(request.input),
    }),
  });

  if (response.ok) {
    return;
  }

  const responseBody = await response.text();
  throw new FeedbackEmailSendError(response.status, responseBody);
}

function calculateRetryDelayMs(attempt: number): number {
  return resendEmailRetryBaseDelayMs * attempt;
}

function getEmailErrorDetails(error: unknown): EmailErrorDetails {
  if (error instanceof FeedbackEmailSendError) {
    return {
      errorClass: error.name,
      errorMessage: error.message,
      statusCode: error.statusCode,
      responseBody: error.responseBody,
    };
  }

  if (error instanceof Error) {
    return {
      errorClass: error.name,
      errorMessage: error.message,
      statusCode: null,
      responseBody: null,
    };
  }

  return {
    errorClass: "UnknownError",
    errorMessage: String(error),
    statusCode: null,
    responseBody: null,
  };
}

function captureFeedbackEmailRetryWarning(
  scope: BackendObservationScope,
  input: FeedbackNotificationEmailInput,
  attempt: number,
  delayMs: number,
  error: unknown,
): void {
  captureBackendWarning({
    action: "feedback_notification_email_retry",
    scope,
    details: {
      feedbackSubmissionId: input.feedbackSubmissionId,
      attempt,
      maxAttempts: resendEmailMaxAttempts,
      delayMs,
      ...getEmailErrorDetails(error),
    },
  });
}

async function sendFeedbackNotificationEmailWithDependencies(
  input: FeedbackNotificationEmailInput,
  scope: BackendObservationScope,
  dependencies: EmailSendDependencies,
): Promise<void> {
  const config = getResendEmailConfig();
  let attempt = 1;
  let lastError: unknown = null;

  while (attempt <= resendEmailMaxAttempts) {
    try {
      await sendResendFeedbackEmail({ config, input }, dependencies.fetchFn);
      return;
    } catch (error) {
      lastError = error;
      if (attempt === resendEmailMaxAttempts) {
        throw error;
      }

      const delayMs = calculateRetryDelayMs(attempt);
      captureFeedbackEmailRetryWarning(scope, input, attempt, delayMs, error);
      await dependencies.sleepFn(delayMs);
      attempt += 1;
    }
  }

  throw lastError;
}

export async function sendFeedbackNotificationEmail(
  input: FeedbackNotificationEmailInput,
  scope: BackendObservationScope,
): Promise<void> {
  await sendFeedbackNotificationEmailWithDependencies(input, scope, {
    fetchFn: fetch,
    sleepFn: sleep,
  });
}

export function createFeedbackEmailErrorMessage(error: unknown): string {
  return getEmailErrorDetails(error).errorMessage;
}
