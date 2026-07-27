import { writeCloudWatchRecord } from "./cloudWatch";
import {
  markCapturedBackendException,
  normalizeCaughtError,
} from "./reportedErrors";
import type {
  BackendBreadcrumbEvent,
  BackendExceptionEvent,
  BackendObservationScope,
  BackendService,
  BackendWarningEvent,
} from "./sentry/events";

export type BackendRuntimeObservabilitySink = Readonly<{
  addBreadcrumb: (event: BackendBreadcrumbEvent) => void;
  captureWarning: (event: BackendWarningEvent) => void;
  captureException: (event: BackendExceptionEvent) => void;
}>;

type BackendRuntimeObservabilityConfiguration = Readonly<{
  service: BackendService;
  sink: BackendRuntimeObservabilitySink;
}>;

let runtimeObservabilityConfiguration: BackendRuntimeObservabilityConfiguration | null = null;

export function configureBackendRuntimeObservability(
  service: BackendService,
  sink: BackendRuntimeObservabilitySink,
): void {
  runtimeObservabilityConfiguration = {
    service,
    sink: {
      addBreadcrumb: sink.addBreadcrumb,
      captureWarning: sink.captureWarning,
      captureException: sink.captureException,
    },
  };
}

export function resetBackendRuntimeObservability(): void {
  runtimeObservabilityConfiguration = null;
}

export function addBackendRuntimeBreadcrumb(
  event: BackendBreadcrumbEvent,
): void {
  const sink = runtimeObservabilityConfiguration?.sink;
  if (sink !== undefined) {
    sink.addBreadcrumb(event);
    return;
  }

  writeCloudWatchRecord(event, "breadcrumb");
}

export function captureBackendRuntimeWarning(
  event: BackendWarningEvent,
): void {
  const sink = runtimeObservabilityConfiguration?.sink;
  if (sink !== undefined) {
    sink.captureWarning(event);
    return;
  }

  writeCloudWatchRecord(event, "warning");
}

export function captureBackendRuntimeException(
  event: BackendExceptionEvent,
): void {
  markCapturedBackendException(event.error);
  const sink = runtimeObservabilityConfiguration?.sink;
  if (sink !== undefined) {
    sink.captureException(event);
    return;
  }

  writeCloudWatchRecord(event, "exception");
}

export function createBackendRuntimeObservationScope(): BackendObservationScope {
  return createBackendObservationScope(
    runtimeObservabilityConfiguration?.service ?? "backend-api",
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
  );
}

export function createBackendObservationScope(
  service: BackendService,
  requestId: string | null,
  route: string | null,
  method: string | null,
  userId: string | null,
  workspaceId: string | null,
  chatRequestId: string | null,
  runId: string | null,
  sessionId: string | null,
  clientAppVersion: string | null,
  clientPlatform: string | null,
): BackendObservationScope {
  return {
    service,
    requestId,
    route,
    method,
    userId,
    workspaceId,
    chatRequestId,
    runId,
    sessionId,
    clientAppVersion,
    clientPlatform,
  };
}

export { normalizeCaughtError };
