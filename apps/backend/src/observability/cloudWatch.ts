import type { SanitizedTelemetryValue } from "./sanitizer";
import type {
  BackendErrorLogDetails,
  BackendLogEvent,
} from "./sentry/events";
import {
  redactCloudWatchExceptionDetailTextFields,
  sanitizeCloudWatchLogValue,
  sanitizeInternalErrorText,
} from "./sentry/redaction";

function getLogRecordDetails(event: BackendLogEvent): unknown {
  return "error" in event ? redactCloudWatchExceptionDetailTextFields(event.details) : event.details;
}

export function createCloudWatchRecord(
  event: BackendLogEvent,
): SanitizedTelemetryValue {
  const errorContext = "error" in event ? getBackendErrorLogDetails(event.error) : {};
  const message = "message" in event ? { message: event.message } : {};
  return sanitizeCloudWatchLogValue({
    domain: "backend",
    action: event.action,
    ...event.scope,
    ...(getLogRecordDetails(event) as Readonly<Record<string, unknown>>),
    ...message,
    ...errorContext,
  });
}

// The record is handed to `console` as an object and never pre-serialized. Every Lambda that can
// reach this emitter is created with `backendStructuredLoggingProps` in
// `infra/aws/lib/backend-lambda-logging.ts`, so the runtime nests this object under `message` and
// the whole log event is a JSON document. That is what makes `$.message.<field>` resolvable for a
// CloudWatch metric filter, which is what the log-derived alarms in `infra/aws/lib/monitoring.ts`
// and `infra/aws/lib/product-analytics-monitoring.ts` select on. A pre-serialized string leaves
// `message` a string and no field inside it addressable.
//
// One shape for every surface, with no branch on the runtime's log format: a branch would leave the
// tests and the local server exercising an emission path that production never takes, and would
// leave two record shapes in the log groups that `docs/agent-sql-telemetry.md` tells operators to
// query together. Outside Lambda - the local `@hono/node-server` entrypoint and the test suite -
// the same object is printed by Node's own formatter, which is a developer-ergonomics difference
// rather than a production one, because production runs no container backend.
//
// Sentry's default `consoleIntegration` stays enabled (`./sentry/config.ts` disables only Postgres
// and OpenAI), so every call below also becomes an incidental `category: "console"` breadcrumb, and
// handing `console` an object rather than a string changes what that breadcrumb's `message` says. In
// a Lambda the pinned @sentry/core builds it with `safeJoin`, which renders any object as the
// constant `[object Object]`; `util.format` is reachable only when `globalThis.util` exists, which
// is true under `node -e`, `node -p` and the REPL and false in a loaded handler file, which is what
// a Lambda runs. Left alone, that would put `[object Object]` on every backend console breadcrumb
// where the pre-serialized string used to put the whole record.
//
// The paired explicit breadcrumbs do not cover that on their own: a warning or an exception carries
// its structured copy as a `backend.details` context on its own Sentry event rather than as a
// breadcrumb, so it is missing from the *trail* of any later event, and the error-level branch of
// `logRequestError` (../server/logging.ts) pairs with nothing at all. So `./sentry/config.ts`
// restores that message with a `beforeBreadcrumb` hook that re-serializes the same
// already-sanitized record this function passed to `console`. Turning `consoleIntegration` off
// instead would trade one rendering for the loss of every console breadcrumb, including the
// dependency output no explicit breadcrumb replaces, and is not the trade to make here.
export function writeCloudWatchRecord(
  event: BackendLogEvent,
  severity: "breadcrumb" | "warning" | "exception",
): void {
  const record = createCloudWatchRecord(event);
  if (severity === "exception") {
    console.error(record);
    return;
  }

  if (severity === "warning") {
    console.warn(record);
    return;
  }

  console.log(record);
}

export function getBackendErrorLogDetails(error: unknown): BackendErrorLogDetails {
  if (error instanceof Error) {
    const stack = error.stack ?? null;
    return {
      errorClass: error.name,
      errorMessage: sanitizeInternalErrorText(error.message),
      errorStack: stack === null ? null : sanitizeInternalErrorText(stack),
      ...parseErrorSourceLocation(stack),
    };
  }

  return {
    errorClass: "UnknownError",
    errorMessage: sanitizeInternalErrorText(String(error)),
    errorStack: null,
    sourceFile: null,
    sourceLine: null,
    sourceColumn: null,
  };
}

function parseErrorSourceLocation(stack: string | null): Pick<
  BackendErrorLogDetails,
  "sourceFile" | "sourceLine" | "sourceColumn"
> {
  if (stack === null) {
    return {
      sourceFile: null,
      sourceLine: null,
      sourceColumn: null,
    };
  }

  const stackLines = stack.split("\n");
  for (const stackLine of stackLines.slice(1)) {
    const trimmedLine = stackLine.trim();
    const match = /^\s*at .+ \((.+):(\d+):(\d+)\)$/.exec(trimmedLine)
      ?? /^\s*at (.+):(\d+):(\d+)$/.exec(trimmedLine)
      ?? /^(.+):(\d+):(\d+)$/.exec(trimmedLine);
    if (match === null) {
      continue;
    }

    return {
      sourceFile: match[1] ?? null,
      sourceLine: Number.parseInt(match[2] ?? "", 10),
      sourceColumn: Number.parseInt(match[3] ?? "", 10),
    };
  }

  return {
    sourceFile: null,
    sourceLine: null,
    sourceColumn: null,
  };
}
