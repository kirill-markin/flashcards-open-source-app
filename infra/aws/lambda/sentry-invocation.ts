import * as Sentry from "@sentry/aws-serverless";

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

export function runLambdaInvocation<Result>(
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

export async function completeLambdaInvocation<Result>(
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
