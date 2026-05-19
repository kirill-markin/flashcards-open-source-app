import assert from "node:assert/strict";
import test from "node:test";
import * as Sentry from "@sentry/aws-serverless";
import {
  addBackendBreadcrumb,
  captureBackendException,
  captureBackendWarning,
} from "./sentryCapture";
import type { ChatWorkerLifecycleDetails } from "./sentryEvents";
import { createBackendObservationScope } from "./sentryScope";
import {
  sentryModule,
  withCapturedConsole,
} from "./sentryTestHelpers";

test("backend breadcrumb serialization keeps CloudWatch JSON shape", () => {
  const details: ChatWorkerLifecycleDetails & Readonly<{
    front_text: string;
    nested: Readonly<{
      raw_response_body: string;
      safeCount: number;
    }>;
  }> = {
    lambdaRequestId: "lambda-request-1",
    abortReason: null,
    signalAborted: false,
    cancellationRequested: false,
    ownershipLost: false,
    runStatus: null,
    sessionState: null,
    providerErrorClass: null,
    providerErrorMessage: null,
    providerErrorStatus: null,
    providerErrorCode: null,
    providerErrorCategory: null,
    providerRequestId: null,
    heartbeatAt: null,
    startedAt: null,
    finishedAt: null,
    outcome: null,
    front_text: "private question",
    nested: {
      raw_response_body: "private response",
      safeCount: 2,
    },
  };

  const messages = withCapturedConsole("log", () => {
    addBackendBreadcrumb({
      action: "chat_worker_skip",
      scope: createBackendObservationScope(
        "chat-worker",
        "lambda-request-1",
        null,
        null,
        "user-1",
        "workspace-1",
        "chat-request-1",
        "run-1",
        null,
      ),
      details,
    });
  });

  assert.equal(messages.length, 1);
  assert.deepEqual(JSON.parse(messages[0] ?? ""), {
    domain: "backend",
    action: "chat_worker_skip",
    service: "chat-worker",
    requestId: "lambda-request-1",
    route: null,
    method: null,
    userId: "user-1",
    workspaceId: "workspace-1",
    chatRequestId: "chat-request-1",
    runId: "run-1",
    sessionId: null,
    lambdaRequestId: "lambda-request-1",
    abortReason: null,
    signalAborted: false,
    cancellationRequested: false,
    ownershipLost: false,
    runStatus: null,
    sessionState: null,
    providerErrorClass: null,
    providerErrorMessage: null,
    providerErrorStatus: null,
    providerErrorCode: null,
    providerErrorCategory: null,
    providerRequestId: null,
    heartbeatAt: null,
    startedAt: null,
    finishedAt: null,
    outcome: null,
    front_text: "<redacted-content>",
    nested: {
      raw_response_body: "<redacted-content>",
      safeCount: 2,
    },
  });
});

test("backend warning and exception serialization include typed details", () => {
  const warningMessages = withCapturedConsole("warn", () => {
    captureBackendWarning({
      action: "global_snapshot_error",
      message: "Snapshot unavailable.",
      scope: createBackendObservationScope(
        "backend-api",
        "request-1",
        "/global/snapshot",
        "GET",
        null,
        null,
        null,
        null,
        null,
      ),
      details: {
        statusCode: 503,
        code: "GLOBAL_METRICS_SNAPSHOT_UNAVAILABLE",
        storageErrorMessage: "S3 object missing for user@example.com",
      },
    });
  });

  const error = new Error("invoke failed for user@example.com");
  error.stack = "Error: invoke failed for user@example.com\n    at dispatch (/var/task/src/chat/worker.ts:12:34)";
  const exceptionMessages = withCapturedConsole("error", () => {
    captureBackendException({
      action: "chat_worker_dispatch_failed",
      error,
      scope: createBackendObservationScope(
        "backend-api",
        null,
        null,
        null,
        "user-1",
        "workspace-1",
        null,
        "run-1",
        null,
      ),
      details: {
        message: "invoke failed for user@example.com",
      },
    });
  });

  assert.equal(JSON.parse(warningMessages[0] ?? "").statusCode, 503);
  assert.equal(
    JSON.parse(warningMessages[0] ?? "").storageErrorMessage,
    "S3 object missing for <masked-email>",
  );
  const exceptionRecord = JSON.parse(exceptionMessages[0] ?? "");
  assert.equal(exceptionRecord.action, "chat_worker_dispatch_failed");
  assert.equal(exceptionRecord.errorClass, "Error");
  assert.equal(exceptionRecord.errorMessage, "invoke failed for <masked-email>");
  assert.equal(
    exceptionRecord.errorStack,
    "Error: invoke failed for <masked-email>\n    at dispatch (/var/task/src/chat/worker.ts:12:34)",
  );
  assert.equal(exceptionRecord.sourceFile, "/var/task/src/chat/worker.ts");
  assert.equal(exceptionRecord.sourceLine, 12);
  assert.equal(exceptionRecord.sourceColumn, 34);
  assert.equal(exceptionRecord.message, "<redacted-content>");
});

test("backend warnings create Sentry warning issues", () => {
  const originalCaptureMessage = sentryModule.captureMessage;
  let captureMessageCount = 0;
  let capturedMessage: Parameters<typeof Sentry.captureMessage>[0] | null = null;
  sentryModule.captureMessage = (message) => {
    captureMessageCount += 1;
    capturedMessage = message;
    return "event-id";
  };

  try {
    withCapturedConsole("warn", () => {
      captureBackendWarning({
        action: "global_snapshot_error",
        message: "Snapshot unavailable for user@example.com.",
        scope: createBackendObservationScope(
          "backend-api",
          "request-1",
          "/global/snapshot",
          "GET",
          null,
          null,
          null,
          null,
          null,
        ),
        details: {
          statusCode: 503,
          code: "GLOBAL_METRICS_SNAPSHOT_UNAVAILABLE",
          storageErrorMessage: "S3 object missing",
        },
      });
    });

    assert.equal(captureMessageCount, 1);
    assert.equal(capturedMessage, "global_snapshot_error");
  } finally {
    sentryModule.captureMessage = originalCaptureMessage;
  }
});

test("backend runtime exception serialization includes chat worker failure context", () => {
  const exceptionMessages = withCapturedConsole("error", () => {
    captureBackendException({
      action: "chat_worker_failed",
      error: new Error("worker failed"),
      scope: createBackendObservationScope(
        "chat-worker",
        "lambda-request-1",
        null,
        null,
        "user-1",
        "workspace-1",
        "chat-request-1",
        "run-1",
        "session-1",
      ),
      details: {
        lambdaRequestId: "lambda-request-1",
        routeRequestId: "route-request-1",
        chatRequestId: "chat-request-1",
        runId: "run-1",
        sessionId: "session-1",
        userId: "user-1",
        workspaceId: "workspace-1",
        statusCode: null,
        code: null,
        message: "worker failed",
      },
    });
  });

  const exceptionRecord = JSON.parse(exceptionMessages[0] ?? "");
  assert.equal(exceptionRecord.action, "chat_worker_failed");
  assert.equal(exceptionRecord.service, "chat-worker");
  assert.equal(exceptionRecord.requestId, "lambda-request-1");
  assert.equal(exceptionRecord.lambdaRequestId, "lambda-request-1");
  assert.equal(exceptionRecord.routeRequestId, "route-request-1");
  assert.equal(exceptionRecord.chatRequestId, "chat-request-1");
  assert.equal(exceptionRecord.userId, "user-1");
  assert.equal(exceptionRecord.workspaceId, "workspace-1");
  assert.equal(exceptionRecord.runId, "run-1");
  assert.equal(exceptionRecord.sessionId, "session-1");
  assert.equal(exceptionRecord.statusCode, null);
  assert.equal(exceptionRecord.code, null);
  assert.equal(exceptionRecord.message, "<redacted-content>");
  assert.equal(exceptionRecord.errorClass, "Error");
  assert.equal(exceptionRecord.errorMessage, "worker failed");
  assert.equal("error" in exceptionRecord, false);
});

test("backend runtime exception serialization includes global metrics failure context", () => {
  const exceptionMessages = withCapturedConsole("error", () => {
    captureBackendException({
      action: "global_metrics_snapshot_failed",
      error: new Error("snapshot failed"),
      scope: createBackendObservationScope(
        "global-metrics-snapshot",
        "lambda-request-2",
        null,
        null,
        null,
        null,
        null,
        null,
        null,
      ),
      details: {
        bucketName: "metrics-bucket",
        objectKey: "v1/global-snapshot.json",
        message: "snapshot failed",
      },
    });
  });

  const exceptionRecord = JSON.parse(exceptionMessages[0] ?? "");
  assert.equal(exceptionRecord.action, "global_metrics_snapshot_failed");
  assert.equal(exceptionRecord.service, "global-metrics-snapshot");
  assert.equal(exceptionRecord.requestId, "lambda-request-2");
  assert.equal(exceptionRecord.bucketName, "metrics-bucket");
  assert.equal(exceptionRecord.objectKey, "v1/global-snapshot.json");
  assert.equal(exceptionRecord.message, "<redacted-content>");
  assert.equal(exceptionRecord.errorClass, "Error");
  assert.equal(exceptionRecord.errorMessage, "snapshot failed");
  assert.equal("error" in exceptionRecord, false);
});

test("backend runtime exception serialization includes migration failure context", () => {
  const exceptionMessages = withCapturedConsole("error", () => {
    captureBackendException({
      action: "migration_failed",
      error: new Error("migration failed"),
      scope: createBackendObservationScope(
        "migration",
        "lambda-request-3",
        null,
        null,
        null,
        null,
        null,
        null,
        null,
      ),
      details: {
        migrationSurface: "lambda",
        operation: "run_migrations",
        message: "migration failed",
      },
    });
  });

  const exceptionRecord = JSON.parse(exceptionMessages[0] ?? "");
  assert.equal(exceptionRecord.action, "migration_failed");
  assert.equal(exceptionRecord.service, "migration");
  assert.equal(exceptionRecord.requestId, "lambda-request-3");
  assert.equal(exceptionRecord.migrationSurface, "lambda");
  assert.equal(exceptionRecord.operation, "run_migrations");
  assert.equal(exceptionRecord.message, "<redacted-content>");
  assert.equal(exceptionRecord.errorClass, "Error");
  assert.equal(exceptionRecord.errorMessage, "migration failed");
  assert.equal("error" in exceptionRecord, false);
});
