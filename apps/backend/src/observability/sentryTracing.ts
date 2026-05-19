import type { Handler, StreamifyHandler } from "aws-lambda";
import * as Sentry from "@sentry/aws-serverless";
import type { BackendTraceCarrier } from "./sentryEvents";

export function getBackendTraceCarrier(): BackendTraceCarrier {
  const traceData = Sentry.getTraceData({ propagateTraceparent: true });
  return {
    sentryTrace: traceData["sentry-trace"] ?? null,
    baggage: traceData.baggage ?? null,
  };
}

export function continueBackendTrace<Result>(
  traceCarrier: BackendTraceCarrier | null,
  callback: () => Result,
): Result {
  if (traceCarrier === null) {
    return callback();
  }

  return Sentry.continueTrace({
    sentryTrace: traceCarrier.sentryTrace ?? undefined,
    baggage: traceCarrier.baggage ?? undefined,
  }, callback);
}

export function startBackendSpan<Result>(
  name: string,
  operation: string,
  callback: () => Result,
): Result {
  return Sentry.startSpan({ name, op: operation }, callback);
}

export function wrapBackendHandler<TEvent, TResult>(
  handler: Handler<TEvent, TResult>,
): Handler<TEvent, TResult> {
  return Sentry.wrapHandler(handler);
}

export function wrapBackendStreamHandler<TEvent, TResult>(
  handler: StreamifyHandler<TEvent, TResult>,
): StreamifyHandler<TEvent, TResult> {
  return Sentry.wrapHandler(handler);
}

export async function flushBackendSentry(timeoutMs: number): Promise<boolean> {
  return Sentry.flush(timeoutMs);
}
