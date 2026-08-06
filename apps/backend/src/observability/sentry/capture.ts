import * as Sentry from "@sentry/aws-serverless";
import { writeCloudWatchRecord } from "../cloudWatch";
import type {
  BackendBreadcrumbEvent,
  BackendExceptionEvent,
  BackendLogEvent,
  BackendWarningEvent,
} from "./events";
import { markCapturedBackendException } from "./errorNormalization";
import {
  backendActionTagName,
  manualBackendCaptureTagName,
  manualBackendCaptureTagValue,
  manualBackendWarningCaptureTagName,
  redactExceptionTextFields,
  sanitizeBackendSentryTelemetryValue,
} from "./redaction";
import { setSentryScope } from "./scope";

type BackendSentryContextData = Parameters<Sentry.Scope["setContext"]>[1];
type BackendSentryBreadcrumbData = NonNullable<Parameters<typeof Sentry.addBreadcrumb>[0]["data"]>;

const mediaBlobWriterFenceErrorName = "MediaBlobWriterFenceError";
const mediaBlobWriterFenceActionTagName = "backend.media_blob_fence_action";

// Read structurally instead of importing MediaBlobWriterFenceError so observability
// keeps no dependency on media asset domain code. The action is a fixed vocabulary of
// internal fence identifiers and is the only fence detail exposed to Sentry.
function readMediaBlobWriterFenceAction(error: Error): string | null {
  if (error.name !== mediaBlobWriterFenceErrorName) {
    return null;
  }

  const action: unknown = (error as unknown as Readonly<Record<string, unknown>>).action;
  return typeof action === "string" && action.trim() !== "" ? action : null;
}

function getSentryData(event: BackendLogEvent): BackendSentryBreadcrumbData {
  return sanitizeBackendSentryTelemetryValue(redactExceptionTextFields({
    scope: event.scope,
    details: event.details,
  })) as BackendSentryBreadcrumbData;
}

export function addBackendBreadcrumb(event: BackendBreadcrumbEvent): void {
  writeCloudWatchRecord(event, "breadcrumb");
  addBackendSentryBreadcrumb(event);
}

export function addBackendSentryBreadcrumb(event: BackendBreadcrumbEvent): void {
  Sentry.addBreadcrumb({
    category: "backend",
    level: "info",
    message: event.action,
    data: getSentryData(event),
  });
}

type BackendWarningFingerprint = readonly [string, ...ReadonlyArray<string>];

function captureBackendWarningImpl(
  event: BackendWarningEvent,
  fingerprint: BackendWarningFingerprint,
): void {
  writeCloudWatchRecord(event, "warning");
  Sentry.withScope((scope) => {
    setSentryScope(scope, event.scope);
    scope.setContext(
      "backend.details",
      sanitizeBackendSentryTelemetryValue(redactExceptionTextFields(event.details)) as BackendSentryContextData,
    );
    scope.setTag(manualBackendWarningCaptureTagName, manualBackendCaptureTagValue);
    scope.setTag(backendActionTagName, event.action);
    scope.setFingerprint([...fingerprint]);
    Sentry.captureMessage(event.action, "warning");
  });
}

export function captureBackendWarning(event: BackendWarningEvent): void {
  captureBackendWarningImpl(event, [event.action]);
}

export function captureBackendWarningWithFingerprint(
  event: BackendWarningEvent,
  fingerprint: BackendWarningFingerprint,
): void {
  captureBackendWarningImpl(event, fingerprint);
}

export function captureBackendException(event: BackendExceptionEvent): void {
  markCapturedBackendException(event.error);
  writeCloudWatchRecord(event, "exception");
  Sentry.withScope((scope) => {
    setSentryScope(scope, event.scope);
    scope.setContext(
      "backend.details",
      sanitizeBackendSentryTelemetryValue(redactExceptionTextFields(event.details)) as BackendSentryContextData,
    );
    scope.setTag(manualBackendCaptureTagName, manualBackendCaptureTagValue);
    scope.setTag(backendActionTagName, event.action);
    const mediaBlobWriterFenceAction = readMediaBlobWriterFenceAction(event.error);
    if (mediaBlobWriterFenceAction !== null) {
      scope.setTag(mediaBlobWriterFenceActionTagName, mediaBlobWriterFenceAction);
    }
    Sentry.captureException(event.error);
  });
}
