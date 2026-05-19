import * as Sentry from "@sentry/aws-serverless";
import { getCurrentBackendService } from "./config";
import type {
  BackendObservationScope,
  BackendService,
} from "./events";
import {
  hashSentryIdentifier,
  redactExceptionTextFields,
  sanitizeBackendSentryIdentifierValue,
  sanitizeBackendSentryTelemetryValue,
} from "./redaction";

type BackendSentryContextData = Parameters<Sentry.Scope["setContext"]>[1];

function getScopeTagValue(value: string | null): string | undefined {
  return value === null || value === "" ? undefined : value;
}

function getSentryIdentifierHashTagValue(key: string, value: string | null): string | undefined {
  const sanitizedValue = sanitizeBackendSentryIdentifierValue(key, value);
  return typeof sanitizedValue === "string" ? getScopeTagValue(sanitizedValue) : undefined;
}

function getSentryStringTag(key: string, value: string | null): readonly [string, string] | null {
  if (value === null || value === "") {
    return null;
  }

  const sanitizedTag = sanitizeBackendSentryTelemetryValue({ [key]: value });
  if (typeof sanitizedTag !== "object" || sanitizedTag === null || Array.isArray(sanitizedTag)) {
    throw new Error("Expected sanitized Sentry tag to remain an object.");
  }

  const tagEntry = Object.entries(sanitizedTag).find((entry): entry is [string, string] => {
    const [, tagValue] = entry;
    return typeof tagValue === "string" && tagValue !== "";
  });

  return tagEntry ?? null;
}

export function setSentryScope(scope: Sentry.Scope, observationScope: BackendObservationScope): void {
  scope.setTag("backend.service", observationScope.service);
  const requestIdTag = getSentryStringTag("requestId", observationScope.requestId);
  const route = getScopeTagValue(observationScope.route);
  const method = getScopeTagValue(observationScope.method);
  const workspaceIdHash = getSentryIdentifierHashTagValue("workspaceId", observationScope.workspaceId);
  const chatRequestIdTag = getSentryStringTag("chatRequestId", observationScope.chatRequestId);
  const runIdHash = getSentryIdentifierHashTagValue("runId", observationScope.runId);
  const sessionIdHash = getSentryIdentifierHashTagValue("sessionId", observationScope.sessionId);

  if (requestIdTag !== null) scope.setTag(requestIdTag[0], requestIdTag[1]);
  if (route !== undefined) scope.setTag("route", route);
  if (method !== undefined) scope.setTag("method", method);
  if (workspaceIdHash !== undefined) scope.setTag("workspaceIdHash", workspaceIdHash);
  if (chatRequestIdTag !== null) scope.setTag(chatRequestIdTag[0], chatRequestIdTag[1]);
  if (runIdHash !== undefined) scope.setTag("runIdHash", runIdHash);
  if (sessionIdHash !== undefined) scope.setTag("sessionIdHash", sessionIdHash);
  if (observationScope.userId !== null && observationScope.userId !== "") {
    const userIdHash = hashSentryIdentifier("userId", observationScope.userId);
    scope.setUser({ id: userIdHash });
    scope.setTag("userIdHash", userIdHash);
  }

  scope.setContext(
    "backend",
    sanitizeBackendSentryTelemetryValue(redactExceptionTextFields(observationScope)) as BackendSentryContextData,
  );
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
