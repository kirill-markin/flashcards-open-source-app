import type * as Sentry from "@sentry/aws-serverless";
import {
  isOperationalTokenMetricKey,
  isSecretRawQueryString,
  sanitizeBackendTelemetryValue,
  secretTextMaskPatterns,
  type SanitizedTelemetryValue,
} from "../sanitizer";
import {
  USER_OPENAI_API_KEY_HEADER,
  USER_OPENAI_API_KEY_WORKER_PAYLOAD_FIELD,
} from "../../shared/userOpenAIApiKeyNames";
import { hasCapturedBackendException } from "./errorNormalization";

type BackendSentryInitOptions = NonNullable<Parameters<typeof Sentry.init>[0]>;
type BackendSentryEvent = Parameters<NonNullable<BackendSentryInitOptions["beforeSend"]>>[0];
type BackendSentryEventHint = Parameters<NonNullable<BackendSentryInitOptions["beforeSend"]>>[1];
type BackendSentrySpan = Parameters<NonNullable<BackendSentryInitOptions["beforeSendSpan"]>>[0];
type DatabaseExceptionDiagnostics = Readonly<{
  errorCode: string | null;
  sqlState: string | null;
  constraint: string | null;
  table: string | null;
}>;

export const manualBackendCaptureTagName = "backend.manual_capture";
export const manualBackendWarningCaptureTagName = "backend.manual_warning_capture";
export const backendActionTagName = "backend.action";
export const manualBackendCaptureTagValue = "true";

const redactedSentrySecretValue = "<redacted-secret>";
const sentrySecretKeyFragments: ReadonlyArray<string> = [
  "authorization",
  "cookie",
  "csrf",
  "otp",
  "password",
  "secret",
  "token",
  "apikey",
];
const sentryAbsoluteUrlWithQueryOrFragmentPattern = /\b([A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s"'<>?#)]+)(?:\?[^\s"'<>#)]*)?(?:#[^\s"'<>)]*)?/g;
const sentryRelativeUrlWithQueryOrFragmentPattern = /(^|[\s("'])(\/[^\s"'<>?#)]+)(?:\?[^\s"'<>#)]*)?(?:#[^\s"'<>)]*)?/g;
// Dropped rather than masked wherever they appear - request headers, extra, contexts, span data - so the
// person's own OpenAI key never reaches Sentry in any form.
const droppedSentryKeyNames: ReadonlySet<string> = new Set([
  USER_OPENAI_API_KEY_HEADER,
  USER_OPENAI_API_KEY_WORKER_PAYLOAD_FIELD,
].map((key) => normalizeTelemetryKey(key)));
const nonSqlStateDatabaseErrorCodes: ReadonlySet<string> = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EPIPE",
  "EAI_AGAIN",
  "ENOTFOUND",
]);

function isManuallyCapturedSentryEvent(event: BackendSentryEvent): boolean {
  return event.tags?.[manualBackendCaptureTagName] === manualBackendCaptureTagValue;
}

function shouldDropPreviouslyCapturedBackendException(
  event: BackendSentryEvent,
  hint: BackendSentryEventHint,
): boolean {
  if (isManuallyCapturedSentryEvent(event)) {
    return false;
  }

  const originalException = hint.originalException;
  return originalException instanceof Error && hasCapturedBackendException(originalException);
}

export function sanitizeSentryEvent(event: BackendSentryEvent, hint: BackendSentryEventHint): BackendSentryEvent | null {
  if (shouldDropPreviouslyCapturedBackendException(event, hint)) {
    return null;
  }

  const request = event.request === undefined ? undefined : { ...event.request };
  if (request !== undefined) {
    delete request.cookies;
  }
  const sanitizedEvent = sanitizeBackendSentryTelemetryValue({
    ...event,
    ...(request === undefined ? {} : { request }),
  }) as unknown as typeof event;
  return addSentryDatabaseExceptionDiagnosticTags(sanitizedEvent, hint);
}

export function sanitizeSentrySpan(span: BackendSentrySpan): BackendSentrySpan {
  return sanitizeBackendSentryTelemetryValue(span) as unknown as typeof span;
}

function normalizeTelemetryKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function shouldRedactSentrySecretKey(key: string): boolean {
  const normalizedKey = normalizeTelemetryKey(key);
  return sentrySecretKeyFragments.some((fragment) => normalizedKey.includes(fragment));
}

function shouldRedactSentrySecretEntry(key: string, value: unknown): boolean {
  if (typeof value === "boolean") {
    return false;
  }

  if (typeof value === "number" && isOperationalTokenMetricKey(key)) {
    return false;
  }

  return shouldRedactSentrySecretKey(key);
}

function sanitizeBackendSentryTelemetryObject(
  value: Readonly<Record<string, unknown>>,
): SanitizedTelemetryValue {
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => droppedSentryKeyNames.has(normalizeTelemetryKey(key)) === false)
      .map(([key, childValue]) => sanitizeBackendSentryTelemetryEntry(key, childValue)),
  );
}

function sanitizeBackendSentryTelemetryEntry(
  key: string,
  value: unknown,
): readonly [string, SanitizedTelemetryValue] {
  if (shouldRedactSentrySecretEntry(key, value)) {
    return [key, redactedSentrySecretValue];
  }

  return [
    key,
    sanitizeBackendSentryTelemetryValue(value),
  ];
}

function stripSentryUrlQueryAndFragment(value: string): string {
  return value
    .replace(sentryAbsoluteUrlWithQueryOrFragmentPattern, "$1")
    .replace(
      sentryRelativeUrlWithQueryOrFragmentPattern,
      (_match: string, prefix: string, path: string): string => `${prefix}${path}`,
    );
}

function isSentrySerializedJsonContainerString(value: string): boolean {
  const trimmedValue = value.trim();
  return (trimmedValue.startsWith("{") && trimmedValue.endsWith("}"))
    || (trimmedValue.startsWith("[") && trimmedValue.endsWith("]"));
}

function sanitizeSentrySerializedJsonContainerString(value: string): string | null {
  if (isSentrySerializedJsonContainerString(value) === false) {
    return null;
  }

  try {
    const parsedValue: unknown = JSON.parse(value);
    if (typeof parsedValue !== "object" || parsedValue === null) {
      return null;
    }

    return JSON.stringify(sanitizeBackendSentryTelemetryValue(parsedValue));
  } catch (error) {
    if (error instanceof SyntaxError) {
      return null;
    }

    throw error;
  }
}

function sanitizeSentryTextValue(value: string): string {
  const serializedJsonValue = sanitizeSentrySerializedJsonContainerString(value);
  if (serializedJsonValue !== null) {
    return serializedJsonValue;
  }

  const valueWithoutUrlQueries = stripSentryUrlQueryAndFragment(value);
  if (isSecretRawQueryString(valueWithoutUrlQueries)) {
    return redactedSentrySecretValue;
  }

  return secretTextMaskPatterns.reduce(
    (sanitizedValue, maskPattern) => sanitizedValue.replace(maskPattern.pattern, maskPattern.replacement),
    valueWithoutUrlQueries,
  );
}

export function sanitizeBackendSentryTelemetryValue(value: unknown): SanitizedTelemetryValue {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeBackendSentryTelemetryValue(item));
  }

  if (typeof value === "object" && value !== null) {
    return sanitizeBackendSentryTelemetryObject(value as Readonly<Record<string, unknown>>);
  }

  if (typeof value === "string") {
    return sanitizeSentryTextValue(value);
  }

  if (
    typeof value === "number"
    || typeof value === "boolean"
    || value === null
    || value === undefined
  ) {
    return value;
  }

  return undefined;
}

function readRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === "object" && value !== null
    ? value as Readonly<Record<string, unknown>>
    : null;
}

function readStringField(record: Readonly<Record<string, unknown>>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function isSqlState(value: string): boolean {
  return /^[A-Z0-9]{5}$/i.test(value) && nonSqlStateDatabaseErrorCodes.has(value) === false;
}

function readDatabaseExceptionDiagnostics(error: unknown): DatabaseExceptionDiagnostics | null {
  const errorRecord = readRecord(error);
  if (errorRecord === null) {
    return null;
  }

  const code = readStringField(errorRecord, "code");
  const sqlState = readStringField(errorRecord, "sqlState")
    ?? readStringField(errorRecord, "sqlstate")
    ?? (code !== null && isSqlState(code) ? code : null);
  const diagnostics: DatabaseExceptionDiagnostics = {
    errorCode: readStringField(errorRecord, "errorCode") ?? code,
    sqlState,
    constraint: readStringField(errorRecord, "constraint"),
    table: readStringField(errorRecord, "table"),
  };

  if (
    diagnostics.sqlState === null
    && diagnostics.constraint === null
    && diagnostics.table === null
  ) {
    return null;
  }

  return diagnostics;
}

function createDatabaseDiagnosticTags(
  diagnostics: DatabaseExceptionDiagnostics,
): Readonly<Record<string, string>> {
  const tags: Record<string, string> = {};
  if (diagnostics.sqlState !== null) tags["db.sql_state"] = diagnostics.sqlState;
  if (diagnostics.errorCode !== null) tags["db.error_code"] = diagnostics.errorCode;
  if (diagnostics.constraint !== null) tags["db.constraint"] = diagnostics.constraint;
  if (diagnostics.table !== null) tags["db.table"] = diagnostics.table;
  return tags;
}

function addSentryDatabaseExceptionDiagnosticTags(
  event: BackendSentryEvent,
  hint: BackendSentryEventHint,
): BackendSentryEvent {
  const diagnostics = readDatabaseExceptionDiagnostics(hint.originalException);
  if (diagnostics === null) {
    return event;
  }

  return {
    ...event,
    tags: {
      ...event.tags,
      ...createDatabaseDiagnosticTags(diagnostics),
    },
  };
}

export function sanitizeInternalErrorText(value: string): string {
  const sanitizedValue = sanitizeBackendTelemetryValue(value);
  if (typeof sanitizedValue !== "string") {
    throw new Error("Expected sanitized internal error text to remain a string");
  }

  return sanitizedValue;
}
