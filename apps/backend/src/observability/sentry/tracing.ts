import type { Context, Handler, StreamifyHandler } from "aws-lambda";
import * as Sentry from "@sentry/aws-serverless";
import type { BackendTraceCarrier } from "./events";

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
  return (event, context) => runLambdaInvocation(event, context, (span) =>
    Sentry.wrapHandler<TEvent, TResult>((invocationEvent, invocationContext) =>
      completeLambdaInvocation(span, () => invokeHandler(handler, invocationEvent, invocationContext)))(event, context, () => {}));
}

function invokeHandler<TEvent, TResult>(
  handler: Handler<TEvent, TResult>,
  event: TEvent,
  context: Context,
): Promise<TResult> {
  return new Promise((resolve, reject) => {
    const result = handler(event, context, (error, value) => {
      if (error !== null && error !== undefined) reject(error);
      else resolve(value as TResult);
    });
    if (result instanceof Promise) result.then(resolve, reject);
    else if (handler.length < 3) resolve(result as TResult);
  });
}

export function wrapBackendStreamHandler<TEvent, TResult>(
  handler: StreamifyHandler<TEvent, TResult>,
): StreamifyHandler<TEvent, TResult> {
  const streamingProperties = Object.fromEntries(Object.getOwnPropertySymbols(handler).map((symbol) =>
    [symbol, Object.getOwnPropertyDescriptor(handler, symbol)!]));
  const wrapped: StreamifyHandler<TEvent, TResult> = (event, responseStream, context) =>
    runLambdaInvocation(event, context, (span) => {
      const traced: StreamifyHandler<TEvent, TResult> = (invocationEvent, stream, invocationContext) =>
        completeLambdaInvocation(span, async () => handler(invocationEvent, stream, invocationContext));
      // Lambda and the SDK use the streamifyResponse symbol properties for dispatch.
      return Sentry.wrapHandler(Object.defineProperties(traced, streamingProperties))(event, responseStream, context);
    });
  return Object.defineProperties(wrapped, streamingProperties);
}

export async function flushBackendSentry(timeoutMs: number): Promise<boolean> {
  return Sentry.flush(timeoutMs);
}

let invocationHandled = false;

type InvocationContext = Readonly<{
  functionName: string;
  awsRequestId: string;
  invokedFunctionArn: string;
  clientContext?: Readonly<{ custom?: Readonly<Record<string, unknown>> }>;
}>;
type InvocationSpan = Parameters<Parameters<typeof Sentry.startSpanManual>[1]>[0];

function readTraceHeaders(event: unknown): Readonly<Record<string, string>> {
  if (typeof event !== "object" || event === null || !("headers" in event)
    || typeof event.headers !== "object" || event.headers === null) return {};
  return Object.fromEntries(Object.entries(event.headers).flatMap(([name, value]) =>
    typeof value === "string" ? [[name.toLowerCase(), value]] : []));
}

function runLambdaInvocation<Result>(
  event: unknown,
  context: InvocationContext,
  callback: (span: InvocationSpan) => Result,
): Result {
  const coldStart = !invocationHandled
    && process.env.AWS_LAMBDA_INITIALIZATION_TYPE !== "provisioned-concurrency"
    && process.uptime() < 10;
  invocationHandled = true;
  const headers = readTraceHeaders(event);
  const custom = context.clientContext?.custom;
  const sentryTrace = typeof custom?.["sentry-trace"] === "string"
    ? custom["sentry-trace"] : headers["sentry-trace"];
  const baggage = typeof custom?.["sentry-trace"] === "string"
    ? (typeof custom.baggage === "string" ? custom.baggage : undefined) : headers.baggage;
  return Sentry.withIsolationScope(() => Sentry.continueTrace({ sentryTrace, baggage }, () =>
    Sentry.startSpanManual({
      name: context.functionName,
      op: "function.aws",
      forceTransaction: true,
      attributes: {
        "sentry.origin": "manual.function.aws_serverless",
        "sentry.kind": "server",
        "faas.name": context.functionName,
        "faas.coldstart": coldStart,
        "faas.invocation_id": context.awsRequestId,
        "cloud.resource_id": context.invokedFunctionArn,
        "cloud.provider": "aws",
        "cloud.platform": "aws_lambda",
      },
    }, callback)));
}

async function completeLambdaInvocation<Result>(
  span: InvocationSpan,
  callback: () => Promise<Result>,
): Promise<Result> {
  try {
    return await callback();
  } catch (error) {
    span.setStatus({ code: 2, message: "internal_error" });
    throw error;
  } finally {
    // The SDK wrapper flushes only after this invocation span has ended.
    span.end();
  }
}
