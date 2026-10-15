/**
 * Sentry initialization for the auth service Lambda.
 *
 * Self-contained module (the auth package does not import from apps/backend):
 * hard-requires SENTRY_DSN on Lambda, stays disabled off-Lambda so local
 * `tsx`/tests run without Sentry, and scrubs PII (emails, OTPs, tokens,
 * cookies, authorization headers) before events leave the process.
 */
import * as Sentry from "@sentry/aws-serverless";

declare const authTraceIdBrand: unique symbol;

export type AuthTraceId = string & Readonly<{
  [authTraceIdBrand]: true;
}>;

type AuthSentryInitOptions = NonNullable<Parameters<typeof Sentry.init>[0]>;
type AuthSentryEvent = Parameters<NonNullable<AuthSentryInitOptions["beforeSend"]>>[0];
type AuthSentrySpan = Parameters<NonNullable<AuthSentryInitOptions["beforeSendSpan"]>>[0];

type AuthSentryConfig = Readonly<{
  dsn: string;
  environment: string;
  release: string;
  tracesSampleRate: number;
}>;

const emailPattern = /\b[A-Z0-9._%+-]{1,64}@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const secretKeyPattern = /otp|token|secret|password|code|authorization|cookie/i;
const redactedSecretValue = "<redacted>";
const maskedEmailValue = "<masked-email>";

let authSentryInitialized = false;

const sentryTracePattern = /^([0-9a-f]{32})-([0-9a-f]{16})(?:-[01])?$/;
const zeroTraceId = "0".repeat(32);
const zeroSpanId = "0".repeat(16);

function parseAuthTraceId(sentryTrace: string | null): AuthTraceId | null {
  if (sentryTrace === null) {
    return null;
  }

  const match = sentryTracePattern.exec(sentryTrace);
  if (match === null || match[1] === zeroTraceId || match[2] === zeroSpanId) {
    return null;
  }

  return match[1] as AuthTraceId;
}

export function continueAuthTrace<Result>(
  sentryTrace: string | null,
  baggage: string | null,
  callback: (traceId: AuthTraceId | null) => Result,
): Result {
  const traceId = parseAuthTraceId(sentryTrace);
  if (traceId === null) {
    return callback(null);
  }

  return Sentry.continueTrace({
    sentryTrace: sentryTrace ?? undefined,
    baggage: baggage ?? undefined,
  }, () => callback(traceId));
}

function isAwsLambdaRuntime(env: NodeJS.ProcessEnv): boolean {
  return (env.AWS_EXECUTION_ENV ?? "").startsWith("AWS_Lambda_")
    || (env.AWS_LAMBDA_FUNCTION_NAME ?? "") !== "";
}

function readRequiredSentryValue(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(`${name} is required when auth Sentry is enabled`);
  }

  return value.trim();
}

function parseTraceSampleRate(rawValue: string): number {
  const tracesSampleRate = Number.parseFloat(rawValue);
  if (!Number.isFinite(tracesSampleRate) || tracesSampleRate < 0 || tracesSampleRate > 1) {
    throw new Error("SENTRY_TRACES_SAMPLE_RATE must be a number between 0 and 1");
  }

  return tracesSampleRate;
}

export function getAuthSentryConfig(env: NodeJS.ProcessEnv): AuthSentryConfig | null {
  const dsn = env.SENTRY_DSN;
  if (dsn === undefined || dsn.trim() === "") {
    if (isAwsLambdaRuntime(env)) {
      throw new Error("SENTRY_DSN is required in AWS Lambda auth runtimes");
    }

    return null;
  }

  return {
    dsn: dsn.trim(),
    environment: readRequiredSentryValue(env, "SENTRY_ENVIRONMENT"),
    release: readRequiredSentryValue(env, "SENTRY_RELEASE"),
    tracesSampleRate: parseTraceSampleRate(readRequiredSentryValue(env, "SENTRY_TRACES_SAMPLE_RATE")),
  };
}

function maskSensitiveText(value: string): string {
  return value.replace(/\b([A-Za-z][A-Za-z0-9+.-]*:\/{1,2}[^\s"'<>?#)]+)(?:\?[^\s"'<>#)]*)?(?:#[^\s"'<>)]*)?/g, "$1")
    .replace(/(\/api\/social\/[^\s"'<>?#)]+)(?:\?[^\s"'<>#)]*)?(?:#[^\s"'<>)]*)?/g, "$1")
    .replace(emailPattern, maskedEmailValue);
}

function scrubHttpTelemetryFields(fields: Record<string, unknown>): void {
  for (const key of Object.keys(fields)) {
    const normalized = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
    const value = fields[key];
    if (["code", "state", "nonce", "query", "querystring", "httpquery", "urlquery", "urlfragment"].includes(normalized)
      || /(?:authorization|cookie|csrf|password|secret|idtoken|accesstoken|refreshtoken|codeverifier)$/.test(normalized)) {
      fields[key] = redactedSecretValue;
    } else if (typeof value === "string") fields[key] = maskSensitiveText(value);
  }
}

function scrubAuthSentrySpan(span: AuthSentrySpan): AuthSentrySpan {
  if (typeof span.description === "string") span.description = maskSensitiveText(span.description);
  if (span.data !== undefined) scrubHttpTelemetryFields(span.data);
  return span;
}

function redactHeaderValues(headers: Record<string, unknown>): void {
  for (const headerName of Object.keys(headers)) {
    const value = headers[headerName];
    if (secretKeyPattern.test(headerName)) {
      headers[headerName] = redactedSecretValue;
    } else if (typeof value === "string") headers[headerName] = maskSensitiveText(value);
  }
}

function scrubAuthSentryRequest(request: AuthSentryEvent["request"]): void {
  if (request !== undefined) {
    delete request.data;
    delete request.cookies;
    delete request.query_string;
    // Provider callbacks put credentials in queries; remove them from errors and performance events.
    if (typeof request.url === "string") request.url = request.url.split(/[?#]/, 1)[0];
    const headers = request.headers;
    if (headers !== undefined && headers !== null) {
      redactHeaderValues(headers as Record<string, unknown>);
    }
  }
}

function scrubAuthSentryBreadcrumbs(breadcrumbs: AuthSentryEvent["breadcrumbs"]): void {
  for (const breadcrumb of breadcrumbs ?? []) {
    if (breadcrumb.data !== undefined) scrubHttpTelemetryFields(breadcrumb.data);
    if (typeof breadcrumb.message === "string") breadcrumb.message = maskSensitiveText(breadcrumb.message);
  }
}

function scrubAuthSentryEvent(event: AuthSentryEvent): AuthSentryEvent {
  scrubAuthSentryRequest(event.request);
  scrubAuthSentryBreadcrumbs(event.breadcrumbs);
  if (event.contexts?.trace?.data !== undefined) scrubHttpTelemetryFields(event.contexts.trace.data);

  if (typeof event.message === "string") {
    event.message = maskSensitiveText(event.message);
  }

  const exceptionValues = event.exception?.values;
  if (exceptionValues !== undefined) {
    for (const exceptionValue of exceptionValues) {
      if (typeof exceptionValue.value === "string") {
        exceptionValue.value = maskSensitiveText(exceptionValue.value);
      }
    }
  }

  return event;
}

export function initializeAuthSentry(): void {
  if (authSentryInitialized) {
    return;
  }
  authSentryInitialized = true;

  const config = getAuthSentryConfig(process.env);
  if (config === null) {
    return;
  }

  Sentry.init({
    dsn: config.dsn,
    environment: config.environment,
    release: config.release,
    tracesSampleRate: config.tracesSampleRate,
    sendDefaultPii: false,
    beforeSend: (event) => scrubAuthSentryEvent(event),
    beforeSendSpan: (span) => scrubAuthSentrySpan(span),
    beforeSendTransaction: (event) => {
      scrubAuthSentryRequest(event.request);
      scrubAuthSentryBreadcrumbs(event.breadcrumbs);
      for (const span of event.spans ?? []) scrubAuthSentrySpan(span);
      if (event.contexts?.trace?.data !== undefined) scrubHttpTelemetryFields(event.contexts.trace.data);
      return event;
    },
  });
  Sentry.setTag("service", "auth");
}
