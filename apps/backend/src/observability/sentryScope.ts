import * as Sentry from "@sentry/aws-serverless";
import { sanitizeBackendTelemetryValue } from "./sanitizer";
import { getCurrentBackendService } from "./sentryConfig";
import type {
  BackendObservationScope,
  BackendService,
} from "./sentryEvents";
import { redactExceptionTextFields } from "./sentryRedaction";

type BackendSentryContextData = Parameters<Sentry.Scope["setContext"]>[1];

function getScopeTagValue(value: string | null): string | undefined {
  return value === null || value === "" ? undefined : value;
}

export function setSentryScope(scope: Sentry.Scope, observationScope: BackendObservationScope): void {
  scope.setTag("backend.service", observationScope.service);
  const requestId = getScopeTagValue(observationScope.requestId);
  const route = getScopeTagValue(observationScope.route);
  const method = getScopeTagValue(observationScope.method);
  const workspaceId = getScopeTagValue(observationScope.workspaceId);
  const chatRequestId = getScopeTagValue(observationScope.chatRequestId);
  const runId = getScopeTagValue(observationScope.runId);
  const sessionId = getScopeTagValue(observationScope.sessionId);

  if (requestId !== undefined) scope.setTag("requestId", requestId);
  if (route !== undefined) scope.setTag("route", route);
  if (method !== undefined) scope.setTag("method", method);
  if (workspaceId !== undefined) scope.setTag("workspaceId", workspaceId);
  if (chatRequestId !== undefined) scope.setTag("chatRequestId", chatRequestId);
  if (runId !== undefined) scope.setTag("runId", runId);
  if (sessionId !== undefined) scope.setTag("sessionId", sessionId);
  if (observationScope.userId !== null && observationScope.userId !== "") {
    scope.setUser({ id: observationScope.userId });
    scope.setTag("userId", observationScope.userId);
  }

  scope.setContext("backend", sanitizeBackendTelemetryValue(redactExceptionTextFields(observationScope)) as BackendSentryContextData);
}

export function runWithBackendSentryIsolationScope<Result>(
  scope: BackendObservationScope,
  callback: () => Result,
): Result {
  return Sentry.withIsolationScope((isolationScope) => {
    setSentryScope(isolationScope, scope);
    return callback();
  });
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
  };
}

export function createBackendRuntimeObservationScope(): BackendObservationScope {
  const currentBackendService = getCurrentBackendService();
  if (currentBackendService === null) {
    throw new Error("Backend Sentry must be initialized before creating runtime observation scope.");
  }

  return createBackendObservationScope(
    currentBackendService,
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
