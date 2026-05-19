import * as Sentry from "@sentry/aws-serverless";
import { sanitizeBackendTelemetryValue } from "./sanitizer";
import { writeCloudWatchRecord } from "./cloudWatch";
import type {
  BackendBreadcrumbEvent,
  BackendExceptionEvent,
  BackendLogEvent,
  BackendWarningEvent,
} from "./sentryEvents";
import { markCapturedBackendException } from "./sentryErrorNormalization";
import {
  backendActionTagName,
  manualBackendCaptureTagName,
  manualBackendCaptureTagValue,
  manualBackendWarningCaptureTagName,
  redactExceptionTextFields,
} from "./sentryRedaction";
import { setSentryScope } from "./sentryScope";

type BackendSentryContextData = Parameters<Sentry.Scope["setContext"]>[1];
type BackendSentryBreadcrumbData = NonNullable<Parameters<typeof Sentry.addBreadcrumb>[0]["data"]>;

function getSentryData(event: BackendLogEvent): BackendSentryBreadcrumbData {
  return sanitizeBackendTelemetryValue(redactExceptionTextFields({
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

export function captureBackendWarning(event: BackendWarningEvent): void {
  writeCloudWatchRecord(event, "warning");
  Sentry.withScope((scope) => {
    setSentryScope(scope, event.scope);
    scope.setContext(
      "backend.details",
      sanitizeBackendTelemetryValue(redactExceptionTextFields(event.details)) as BackendSentryContextData,
    );
    scope.setTag(manualBackendWarningCaptureTagName, manualBackendCaptureTagValue);
    scope.setTag(backendActionTagName, event.action);
    scope.setFingerprint([event.action]);
    Sentry.captureMessage(event.action, "warning");
  });
}

export function captureBackendException(event: BackendExceptionEvent): void {
  markCapturedBackendException(event.error);
  writeCloudWatchRecord(event, "exception");
  Sentry.withScope((scope) => {
    setSentryScope(scope, event.scope);
    scope.setContext(
      "backend.details",
      sanitizeBackendTelemetryValue(redactExceptionTextFields(event.details)) as BackendSentryContextData,
    );
    scope.setTag(manualBackendCaptureTagName, manualBackendCaptureTagValue);
    Sentry.captureException(event.error);
  });
}
