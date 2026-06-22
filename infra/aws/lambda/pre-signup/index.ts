import * as Sentry from "@sentry/aws-serverless";

/** Cognito PreSignUp trigger: auto-confirms user and verifies email. */
type PreSignUpEvent = {
  request: {
    userAttributes: Record<string, string | undefined>;
  };
  response: {
    autoConfirmUser?: boolean;
    autoVerifyEmail?: boolean;
  };
};

type SentryInitOptions = NonNullable<Parameters<typeof Sentry.init>[0]>;
type SentryEvent = Parameters<NonNullable<SentryInitOptions["beforeSend"]>>[0];

const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;

function isAwsLambdaRuntime(): boolean {
  return (process.env.AWS_EXECUTION_ENV ?? "").startsWith("AWS_Lambda_")
    || (process.env.AWS_LAMBDA_FUNCTION_NAME ?? "") !== "";
}

function maskEmails(value: string): string {
  return value.replace(emailPattern, "<masked-email>");
}

function beforeSend(event: SentryEvent): SentryEvent | null {
  if (event.request !== undefined) {
    delete event.request.data;
  }
  if (event.message !== undefined) {
    event.message = maskEmails(event.message);
  }
  for (const exceptionValue of event.exception?.values ?? []) {
    if (exceptionValue.value !== undefined) {
      exceptionValue.value = maskEmails(exceptionValue.value);
    }
  }
  return event;
}

const dsn = process.env.SENTRY_DSN;
if (dsn === undefined || dsn.trim() === "") {
  if (isAwsLambdaRuntime()) {
    throw new Error("SENTRY_DSN is required in AWS Lambda pre-signup runtime");
  }
} else {
  const tracesSampleRateRaw = process.env.SENTRY_TRACES_SAMPLE_RATE;
  Sentry.init({
    dsn: dsn.trim(),
    environment: process.env.SENTRY_ENVIRONMENT,
    release: process.env.SENTRY_RELEASE,
    tracesSampleRate: tracesSampleRateRaw === undefined
      ? undefined
      : Number.parseFloat(tracesSampleRateRaw),
    sendDefaultPii: false,
    beforeSend,
  });
  Sentry.setTag("service", "pre-signup");
}

export const handler = Sentry.wrapHandler(async (event: PreSignUpEvent) => {
  event.response.autoConfirmUser = true;
  if (event.request.userAttributes.email) {
    event.response.autoVerifyEmail = true;
  }
  return event;
});
