import assert from "node:assert/strict";
import test from "node:test";
import {
  addBackendRuntimeBreadcrumb,
  captureBackendRuntimeException,
  captureBackendRuntimeWarning,
  configureBackendRuntimeObservability,
  createBackendObservationScope,
  createBackendRuntimeObservationScope,
  resetBackendRuntimeObservability,
  type BackendRuntimeObservabilitySink,
} from "./runtime";
import { hasCapturedBackendException } from "./sentry/errorNormalization";
import type {
  BackendBreadcrumbEvent,
  BackendExceptionEvent,
  BackendObservationScope,
  BackendWarningEvent,
} from "./sentry/events";

type ConsoleMethod = "log" | "warn" | "error";

function withCapturedConsole(
  method: ConsoleMethod,
  callback: () => void,
): ReadonlyArray<string> {
  const originalMethod = console[method];
  const messages: Array<string> = [];
  console[method] = (message?: unknown): void => {
    messages.push(typeof message === "string" ? message : String(message));
  };

  try {
    callback();
    return messages;
  } finally {
    console[method] = originalMethod;
  }
}

function parseRecord(message: string): Readonly<Record<string, unknown>> {
  const parsedValue: unknown = JSON.parse(message);
  if (
    typeof parsedValue !== "object"
    || parsedValue === null
    || Array.isArray(parsedValue)
  ) {
    throw new Error("Expected a structured CloudWatch record.");
  }

  return parsedValue as Readonly<Record<string, unknown>>;
}

function createScope(service: "backend-api" | "chat-worker", requestId: string): BackendObservationScope {
  return createBackendObservationScope(
    service,
    requestId,
    "/v1/runtime-test",
    "POST",
    `user-${requestId}`,
    `workspace-${requestId}`,
    null,
    null,
    null,
    null,
    null,
  );
}

function createBreadcrumbEvent(scope: BackendObservationScope): BackendBreadcrumbEvent {
  return {
    action: "database_transient_retry",
    scope,
    details: {
      attempt: 1,
      maxAttempts: 3,
      delayMs: 50,
      sqlState: null,
      errorCode: "ECONNRESET",
      errorClass: "Error",
      errorMessage: "retry failed for user@example.com",
    },
  };
}

function createWarningEvent(scope: BackendObservationScope): BackendWarningEvent {
  return {
    action: "database_pool_error",
    scope,
    details: {
      poolName: "main",
      sqlState: null,
      errorCode: "ECONNRESET",
      errorClass: "Error",
      errorMessage: "pool rejected sk_12345678901234567890",
    },
  };
}

function createExceptionEvent(
  scope: BackendObservationScope,
  error: Error,
): BackendExceptionEvent {
  return {
    action: "request_failed",
    error,
    scope,
    details: {
      statusCode: 500,
      code: "INTERNAL_ERROR",
      message: "private request body",
      validationIssues: [],
    },
  };
}

test("runtime observability emits redacted structured CloudWatch records without a sink", () => {
  resetBackendRuntimeObservability();
  const scope = createScope("backend-api", "fallback");
  const error = new Error("request failed for user@example.com");
  error.stack = "Error: request failed for user@example.com\n    at handler (/var/task/src/handler.ts:12:34)";

  const breadcrumbMessages = withCapturedConsole("log", () => {
    addBackendRuntimeBreadcrumb(createBreadcrumbEvent(scope));
  });
  const warningMessages = withCapturedConsole("warn", () => {
    captureBackendRuntimeWarning(createWarningEvent(scope));
  });
  const exceptionMessages = withCapturedConsole("error", () => {
    captureBackendRuntimeException(createExceptionEvent(scope, error));
  });

  assert.equal(breadcrumbMessages.length, 1);
  assert.equal(warningMessages.length, 1);
  assert.equal(exceptionMessages.length, 1);
  const breadcrumbRecord = parseRecord(breadcrumbMessages[0] ?? "");
  assert.deepEqual(breadcrumbRecord, {
    domain: "backend",
    action: "database_transient_retry",
    ...scope,
    attempt: 1,
    maxAttempts: 3,
    delayMs: 50,
    sqlState: null,
    errorCode: "ECONNRESET",
    errorClass: "Error",
    errorMessage: "retry failed for <masked-email>",
  });
  const warningRecord = parseRecord(warningMessages[0] ?? "");
  assert.equal(warningRecord.errorMessage, "pool rejected <masked-api-key>");
  const exceptionRecord = parseRecord(exceptionMessages[0] ?? "");
  assert.equal(exceptionRecord.message, "<redacted-content>");
  assert.equal(exceptionRecord.errorMessage, "request failed for <masked-email>");
  assert.equal(typeof exceptionRecord.errorStack, "string");
  assert.equal(
    typeof exceptionRecord.errorStack === "string"
      && exceptionRecord.errorStack.includes("user@example.com"),
    false,
  );
  assert.equal(hasCapturedBackendException(error), true);
});

test("runtime observability dispatches each classification to the configured sink", () => {
  resetBackendRuntimeObservability();
  const breadcrumbs: Array<BackendBreadcrumbEvent> = [];
  const warnings: Array<BackendWarningEvent> = [];
  const exceptions: Array<BackendExceptionEvent> = [];
  const sink: BackendRuntimeObservabilitySink = {
    addBreadcrumb: (event) => {
      breadcrumbs.push(event);
    },
    captureWarning: (event) => {
      warnings.push(event);
    },
    captureException: (event) => {
      exceptions.push(event);
    },
  };
  const scope = createScope("chat-worker", "sink");
  const breadcrumb = createBreadcrumbEvent(scope);
  const warning = createWarningEvent(scope);
  const exception = createExceptionEvent(scope, new Error("sink failure"));

  configureBackendRuntimeObservability("chat-worker", sink);
  addBackendRuntimeBreadcrumb(breadcrumb);
  captureBackendRuntimeWarning(warning);
  captureBackendRuntimeException(exception);

  assert.deepEqual(breadcrumbs, [breadcrumb]);
  assert.deepEqual(warnings, [warning]);
  assert.deepEqual(exceptions, [exception]);
  assert.equal(createBackendRuntimeObservationScope().service, "chat-worker");

  resetBackendRuntimeObservability();
  assert.equal(createBackendRuntimeObservationScope().service, "backend-api");
});

test("runtime observability keeps concurrent request scopes isolated", async () => {
  resetBackendRuntimeObservability();
  const breadcrumbs: Array<BackendBreadcrumbEvent> = [];
  configureBackendRuntimeObservability("backend-api", {
    addBreadcrumb: (event) => {
      breadcrumbs.push(event);
    },
    captureWarning: () => {},
    captureException: () => {},
  });
  const requestIds = Array.from({ length: 20 }, (_value, index) => `concurrent-${index}`);

  await Promise.all(requestIds.map(async (requestId) => {
    await Promise.resolve();
    addBackendRuntimeBreadcrumb(createBreadcrumbEvent(createScope("backend-api", requestId)));
  }));

  assert.deepEqual(
    breadcrumbs.map((event) => event.scope.requestId).sort(),
    [...requestIds].sort(),
  );
  assert.deepEqual(
    breadcrumbs.map((event) => event.scope.userId).sort(),
    requestIds.map((requestId) => `user-${requestId}`).sort(),
  );
  resetBackendRuntimeObservability();
});
