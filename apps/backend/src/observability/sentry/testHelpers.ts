import * as Sentry from "@sentry/aws-serverless";

export type ConsoleMethod = "log" | "warn" | "error";
export type MutableSentryModule = typeof Sentry & {
  captureMessage: (
    message: Parameters<typeof Sentry.captureMessage>[0],
    captureContext: Parameters<typeof Sentry.captureMessage>[1],
  ) => ReturnType<typeof Sentry.captureMessage>;
  captureException: (
    exception: Parameters<typeof Sentry.captureException>[0],
  ) => ReturnType<typeof Sentry.captureException>;
  openAIIntegration: typeof Sentry.openAIIntegration;
};
export type CapturedSentryInitOptions = NonNullable<Parameters<typeof Sentry.init>[0]>;

export const sentryModule = require("@sentry/aws-serverless") as MutableSentryModule;

export function requireCapturedSentryInitOptions(
  options: CapturedSentryInitOptions | null,
): CapturedSentryInitOptions {
  if (options === null) {
    throw new Error("Expected backend Sentry init options to be captured.");
  }

  return options;
}

export function requireBeforeSend(
  beforeSend: CapturedSentryInitOptions["beforeSend"],
): NonNullable<CapturedSentryInitOptions["beforeSend"]> {
  if (beforeSend === undefined) {
    throw new Error("Expected backend Sentry beforeSend to be configured.");
  }

  return beforeSend;
}

export function requireBeforeSendSpan(
  beforeSendSpan: CapturedSentryInitOptions["beforeSendSpan"],
): NonNullable<CapturedSentryInitOptions["beforeSendSpan"]> {
  if (beforeSendSpan === undefined) {
    throw new Error("Expected backend Sentry beforeSendSpan to be configured.");
  }

  return beforeSendSpan;
}

export function requireBeforeSendTransaction(
  beforeSendTransaction: CapturedSentryInitOptions["beforeSendTransaction"],
): NonNullable<CapturedSentryInitOptions["beforeSendTransaction"]> {
  if (beforeSendTransaction === undefined) {
    throw new Error("Expected backend Sentry beforeSendTransaction to be configured.");
  }

  return beforeSendTransaction;
}

export function requireSynchronousSentryHookResult<Result>(
  result: Result | PromiseLike<Result>,
): Result {
  if (
    typeof result === "object"
    && result !== null
    && "then" in result
    && typeof (result as Readonly<{ then?: unknown }>).then === "function"
  ) {
    throw new Error("Expected backend Sentry hook result to be synchronous in tests.");
  }

  return result as Result;
}

export function withCapturedConsole(
  method: ConsoleMethod,
  fn: () => void,
): ReadonlyArray<string> {
  const originalMethod = console[method];
  const messages: Array<string> = [];
  console[method] = (message?: unknown): void => {
    messages.push(typeof message === "string" ? message : String(message));
  };

  try {
    fn();
    return messages;
  } finally {
    console[method] = originalMethod;
  }
}
