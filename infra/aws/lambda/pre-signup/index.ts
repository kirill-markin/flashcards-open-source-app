import type { Handler } from "aws-lambda";
import * as Sentry from "@sentry/aws-serverless";
import { completeLambdaInvocation, runLambdaInvocation } from "../sentry-invocation";

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

function isAwsLambdaRuntime(): boolean {
  return (process.env.AWS_EXECUTION_ENV ?? "").startsWith("AWS_Lambda_")
    || (process.env.AWS_LAMBDA_FUNCTION_NAME ?? "") !== "";
}

function beforeSend(event: SentryEvent): SentryEvent | null {
  if (event.request !== undefined) {
    delete event.request.data;
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
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
      mcp: { inputs: false, outputs: false },
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
      frameContextLines: 0,
    },
    traceLifecycle: "stream",
    attachStacktrace: false,
    beforeSend,
  });
  Sentry.setTag("service", "pre-signup");
  Sentry.setAttribute("service", "pre-signup");
}

const preSignUpHandler = async (event: PreSignUpEvent) => {
  event.response.autoConfirmUser = false;
  event.response.autoVerifyEmail = false;
  return event;
};

export const handler: Handler<PreSignUpEvent, PreSignUpEvent> =
  (event, context) => runLambdaInvocation(event, context, (span) => Sentry.wrapHandler(
    (invocationEvent: PreSignUpEvent) => completeLambdaInvocation(span, () => preSignUpHandler(invocationEvent)),
  )(event, context, () => {}));
