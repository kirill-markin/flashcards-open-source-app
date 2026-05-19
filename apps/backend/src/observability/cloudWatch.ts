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

function createCloudWatchRecord(event: BackendLogEvent): SanitizedTelemetryValue {
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

export function writeCloudWatchRecord(
  event: BackendLogEvent,
  severity: "breadcrumb" | "warning" | "exception",
): void {
  const serializedRecord = JSON.stringify(createCloudWatchRecord(event));
  if (severity === "exception") {
    console.error(serializedRecord);
    return;
  }

  if (severity === "warning") {
    console.warn(serializedRecord);
    return;
  }

  console.log(serializedRecord);
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
