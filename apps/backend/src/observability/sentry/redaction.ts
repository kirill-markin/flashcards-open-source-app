import * as Sentry from "@sentry/aws-serverless";
import {
  sanitizeBackendTelemetryValue,
  type SanitizedTelemetryValue,
} from "../sanitizer";
import { hasCapturedBackendException } from "./errorNormalization";

type BackendSentryInitOptions = NonNullable<Parameters<typeof Sentry.init>[0]>;
type BackendSentryEvent = Parameters<NonNullable<BackendSentryInitOptions["beforeSend"]>>[0];
type BackendSentryEventHint = Parameters<NonNullable<BackendSentryInitOptions["beforeSend"]>>[1];
type BackendSentrySpan = Parameters<NonNullable<BackendSentryInitOptions["beforeSendSpan"]>>[0];
type BackendSentryTransactionEvent = Parameters<NonNullable<BackendSentryInitOptions["beforeSendTransaction"]>>[0];
type SentryExceptionValue = Readonly<Record<string, unknown>> & Readonly<{
  type?: unknown;
  value?: unknown;
}>;
type DatabaseExceptionDiagnostics = Readonly<{
  errorClass: string | null;
  errorCode: string | null;
  sqlState: string | null;
  constraint: string | null;
  table: string | null;
  errorMessage: string | null;
}>;

export const manualBackendCaptureTagName = "backend.manual_capture";
export const manualBackendWarningCaptureTagName = "backend.manual_warning_capture";
export const backendActionTagName = "backend.action";
export const manualBackendCaptureTagValue = "true";

const redactedExceptionTextValue = "<redacted-content>";
const redactedSentrySecretValue = "<redacted-secret>";
const exceptionTextFieldNames: ReadonlySet<string> = new Set([
  "errormessage",
  "errorstack",
  "errorvalue",
  "exceptionmessage",
  "exceptionvalue",
  "contextline",
  "message",
  "providererrormessage",
  "rawstack",
  "stack",
  "value",
]);
const exceptionPayloadFieldNames: ReadonlySet<string> = new Set([
  "vars",
]);
const cloudWatchActionableExceptionTextFieldNames: ReadonlySet<string> = new Set([
  "errormessage",
  "errorstack",
]);
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
const sentryOperationalTokenMetricKeyNames: ReadonlySet<string> = new Set([
  "completiontokens",
  "inputtokens",
  "outputtokens",
  "prompttokens",
  "tokencount",
  "totaltokens",
]);
const sentryQueryLikeKeyNames: ReadonlySet<string> = new Set([
  "fragment",
  "httpquery",
  "query",
  "querystring",
  "requestquerystring",
  "search",
  "searchparams",
  "urlquery",
  "urlsearchparams",
]);
const sentryAbsoluteUrlWithQueryOrFragmentPattern = /\b([A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s"'<>?#)]+)(?:\?[^\s"'<>#)]*)?(?:#[^\s"'<>)]*)?/g;
const sentryRelativeUrlWithQueryOrFragmentPattern = /(^|[\s("'])(\/[^\s"'<>?#)]+)(?:\?[^\s"'<>#)]*)?(?:#[^\s"'<>)]*)?/g;
const sentryTextMaskPatterns: ReadonlyArray<Readonly<{
  pattern: RegExp;
  replacement: string;
}>> = [
  {
    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    replacement: "<masked-email>",
  },
  {
    pattern: /\b(?:sk|pk|rk)[_-][A-Za-z0-9_-]{16,}\b/g,
    replacement: "<masked-api-key>",
  },
  {
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    replacement: "<masked-jwt>",
  },
];
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

function getManualBackendWarningMessage(event: BackendSentryEvent): string | null {
  if (event.tags?.[manualBackendWarningCaptureTagName] !== manualBackendCaptureTagValue) {
    return null;
  }

  if (typeof event.message !== "string") {
    return null;
  }

  return event.tags?.[backendActionTagName] === event.message ? event.message : null;
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

  const manualBackendWarningMessage = getManualBackendWarningMessage(event);
  const sanitizedEvent = sanitizeBackendSentryTelemetryValue(redactExceptionTextFields(event)) as unknown as typeof event;
  const sanitizedEventWithDatabaseDiagnostics = restoreSentryDatabaseExceptionDiagnostics(
    event,
    sanitizedEvent,
    hint,
  );
  if (manualBackendWarningMessage === null) {
    return sanitizedEventWithDatabaseDiagnostics;
  }

  return {
    ...sanitizedEventWithDatabaseDiagnostics,
    message: manualBackendWarningMessage,
  };
}

export function sanitizeSentrySpan(span: BackendSentrySpan): BackendSentrySpan {
  return sanitizeBackendSentryTelemetryValue(redactExceptionTextFields(span)) as unknown as typeof span;
}

export function sanitizeSentryTransactionEvent(
  event: BackendSentryTransactionEvent,
): BackendSentryTransactionEvent {
  return sanitizeBackendSentryTelemetryValue(redactExceptionTextFields(event)) as unknown as typeof event;
}

function normalizeTelemetryKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function shouldRedactSentrySecretKey(key: string): boolean {
  const normalizedKey = normalizeTelemetryKey(key);
  return sentrySecretKeyFragments.some((fragment) => normalizedKey.includes(fragment));
}

function isSentryOperationalTokenMetricKey(key: string): boolean {
  return sentryOperationalTokenMetricKeyNames.has(normalizeTelemetryKey(key));
}

function shouldRedactSentrySecretEntry(key: string, value: unknown): boolean {
  if (typeof value === "boolean") {
    return false;
  }

  if (typeof value === "number" && isSentryOperationalTokenMetricKey(key)) {
    return false;
  }

  return shouldRedactSentrySecretKey(key);
}

function shouldRedactSentryQueryLikeKey(key: string): boolean {
  return sentryQueryLikeKeyNames.has(normalizeTelemetryKey(key));
}

function shouldRedactSentryStructuredEmailKey(key: string): boolean {
  return normalizeTelemetryKey(key).endsWith("email");
}

function sanitizeBackendSentryTelemetryObject(
  value: Readonly<Record<string, unknown>>,
): SanitizedTelemetryValue {
  return Object.fromEntries(
    Object.entries(value).map(([key, childValue]) => sanitizeBackendSentryTelemetryEntry(key, childValue)),
  );
}

function sanitizeBackendSentryTelemetryEntry(
  key: string,
  value: unknown,
): readonly [string, SanitizedTelemetryValue] {
  if (shouldRedactSentrySecretEntry(key, value)) {
    return [key, redactedSentrySecretValue];
  }

  if (shouldRedactSentryQueryLikeKey(key) || shouldRedactSentryStructuredEmailKey(key)) {
    return [key, redactedExceptionTextValue];
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

  return sentryTextMaskPatterns.reduce(
    (sanitizedValue, maskPattern) => sanitizedValue.replace(maskPattern.pattern, maskPattern.replacement),
    stripSentryUrlQueryAndFragment(value),
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
    errorClass: error instanceof Error && error.name.trim() !== "" ? error.name : null,
    errorCode: readStringField(errorRecord, "errorCode") ?? code,
    sqlState,
    constraint: readStringField(errorRecord, "constraint"),
    table: readStringField(errorRecord, "table"),
    errorMessage: error instanceof Error ? error.message : readStringField(errorRecord, "message"),
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

function isSafeDatabaseExceptionMessage(
  message: string,
  diagnostics: DatabaseExceptionDiagnostics,
): boolean {
  return diagnostics.constraint !== null && message.includes(diagnostics.constraint);
}

function createDatabaseExceptionDiagnosticValue(
  diagnostics: DatabaseExceptionDiagnostics,
): string | null {
  const diagnosticParts: Array<string> = [];
  if (diagnostics.sqlState !== null) {
    diagnosticParts.push(`SQLSTATE ${diagnostics.sqlState}`);
  }
  if (diagnostics.errorCode !== null && diagnostics.errorCode !== diagnostics.sqlState) {
    diagnosticParts.push(`code ${diagnostics.errorCode}`);
  }
  if (diagnostics.constraint !== null) {
    diagnosticParts.push(`constraint ${diagnostics.constraint}`);
  }
  if (diagnostics.table !== null) {
    diagnosticParts.push(`table ${diagnostics.table}`);
  }
  if (diagnosticParts.length === 0) {
    return null;
  }

  const label = diagnostics.errorClass ?? "DatabaseError";
  if (
    diagnostics.errorMessage !== null
    && isSafeDatabaseExceptionMessage(diagnostics.errorMessage, diagnostics)
  ) {
    return `${label}: ${sanitizeInternalErrorText(diagnostics.errorMessage)} (${diagnosticParts.join(", ")})`;
  }

  return `${label}: ${diagnosticParts.join(", ")}`;
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

function restoreSentryExceptionValue(
  value: SentryExceptionValue,
  diagnosticValue: string,
): SentryExceptionValue {
  if (typeof value.value !== "string") {
    return value;
  }

  return {
    ...value,
    value: diagnosticValue,
  };
}

function restoreSentryDatabaseExceptionValues(
  event: BackendSentryEvent,
  diagnosticValue: string,
): BackendSentryEvent {
  const exceptionRecord = readRecord(event.exception);
  const exceptionValues = exceptionRecord?.values;
  if (Array.isArray(exceptionValues) === false) {
    return event;
  }

  return {
    ...event,
    exception: {
      ...event.exception,
      values: exceptionValues.map((value) => {
        const exceptionValue = readRecord(value);
        return exceptionValue === null
          ? value
          : restoreSentryExceptionValue(exceptionValue as SentryExceptionValue, diagnosticValue);
      }),
    },
  };
}

function restoreSentryDatabaseExceptionDiagnostics(
  originalEvent: BackendSentryEvent,
  sanitizedEvent: BackendSentryEvent,
  hint: BackendSentryEventHint,
): BackendSentryEvent {
  const diagnostics = readDatabaseExceptionDiagnostics(hint.originalException);
  if (diagnostics === null) {
    return sanitizedEvent;
  }

  const diagnosticValue = createDatabaseExceptionDiagnosticValue(diagnostics);
  if (diagnosticValue === null) {
    return sanitizedEvent;
  }

  const eventWithExceptionValue = restoreSentryDatabaseExceptionValues(sanitizedEvent, diagnosticValue);
  return {
    ...eventWithExceptionValue,
    message: typeof originalEvent.message === "string" ? diagnosticValue : eventWithExceptionValue.message,
    tags: {
      ...eventWithExceptionValue.tags,
      ...createDatabaseDiagnosticTags(diagnostics),
    },
  };
}

function shouldRedactExceptionTextField(key: string, value: unknown): boolean {
  const normalizedKey = normalizeTelemetryKey(key);
  return exceptionPayloadFieldNames.has(normalizedKey)
    || (typeof value === "string" && exceptionTextFieldNames.has(normalizedKey));
}

export function redactExceptionTextFields(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactExceptionTextFields(item));
  }

  if (typeof value !== "object" || value === null) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Readonly<Record<string, unknown>>).map(([key, childValue]) => [
      key,
      shouldRedactExceptionTextField(key, childValue)
        ? redactedExceptionTextValue
        : redactExceptionTextFields(childValue),
    ]),
  );
}

function shouldRedactCloudWatchExceptionDetailTextField(key: string, value: unknown): boolean {
  const normalizedKey = normalizeTelemetryKey(key);
  return typeof value === "string"
    && exceptionTextFieldNames.has(normalizedKey)
    && cloudWatchActionableExceptionTextFieldNames.has(normalizedKey) === false;
}

export function redactCloudWatchExceptionDetailTextFields(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactCloudWatchExceptionDetailTextFields(item));
  }

  if (typeof value !== "object" || value === null) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Readonly<Record<string, unknown>>).map(([key, childValue]) => [
      key,
      shouldRedactCloudWatchExceptionDetailTextField(key, childValue)
        ? redactedExceptionTextValue
        : redactCloudWatchExceptionDetailTextFields(childValue),
    ]),
  );
}

export function sanitizeInternalErrorText(value: string): string {
  const sanitizedValue = sanitizeBackendTelemetryValue(value);
  if (typeof sanitizedValue !== "string") {
    throw new Error("Expected sanitized internal error text to remain a string");
  }

  return sanitizedValue;
}

function shouldPreserveCloudWatchActionableErrorText(key: string, value: unknown): value is string {
  return typeof value === "string" && cloudWatchActionableExceptionTextFieldNames.has(normalizeTelemetryKey(key));
}

function readSanitizedTelemetryEntry(key: string, value: unknown): SanitizedTelemetryValue {
  const sanitizedObject = sanitizeBackendTelemetryValue({ [key]: value });
  if (typeof sanitizedObject !== "object" || sanitizedObject === null || Array.isArray(sanitizedObject)) {
    throw new Error("Expected sanitized telemetry entry to remain an object");
  }

  return (sanitizedObject as Readonly<Record<string, SanitizedTelemetryValue>>)[key];
}

function sanitizeCloudWatchLogEntry(key: string, value: unknown): SanitizedTelemetryValue {
  if (shouldPreserveCloudWatchActionableErrorText(key, value)) {
    return sanitizeInternalErrorText(value);
  }

  const sanitizedValue = readSanitizedTelemetryEntry(key, value);
  if (typeof sanitizedValue !== "object" || sanitizedValue === null) {
    return sanitizedValue;
  }

  return sanitizeCloudWatchLogValue(value);
}

export function sanitizeCloudWatchLogValue(value: unknown): SanitizedTelemetryValue {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeCloudWatchLogValue(item));
  }

  if (typeof value !== "object" || value === null) {
    return sanitizeBackendTelemetryValue(value);
  }

  return Object.fromEntries(
    Object.entries(value as Readonly<Record<string, unknown>>).map(([key, childValue]) => [
      key,
      sanitizeCloudWatchLogEntry(key, childValue),
    ]),
  );
}
