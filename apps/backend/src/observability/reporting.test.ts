import assert from "node:assert/strict";
import test from "node:test";
import { AuthError } from "../auth";
import { HttpError } from "../errors";
import { createBackendFailureDetails } from "../server/logging";
import { captureBackendException } from "./sentry/capture";
import { normalizeCaughtError } from "./sentry/errorNormalization";
import { createBackendObservationScope } from "./sentry/scope";
import { hasReportedBackendException, reportBackendExceptionOrBreadcrumb } from "./reporting";
import {
  sentryModule,
  withCapturedConsole,
} from "./sentry/testHelpers";

test("normalizeCaughtError preserves Error and converts non-Error throws", () => {
  const error = new TypeError("bad input");
  assert.equal(normalizeCaughtError(error), error);

  const normalized = normalizeCaughtError("string failure");
  assert.equal(normalized.name, "NonErrorThrow");
  assert.equal(normalized.message, "string failure");
});

test("createBackendFailureDetails maps auth errors to unauthorized failures", () => {
  const details = createBackendFailureDetails(new AuthError(401, "Invalid token"));

  assert.equal(details.statusCode, 401);
  assert.equal(details.code, "AUTH_UNAUTHORIZED");
  assert.equal(details.message, "Invalid token");
  assert.deepEqual(details.validationIssues, []);
});

test("backend reporting records auth errors as breadcrumbs", () => {
  const originalCaptureException = sentryModule.captureException;
  let captureExceptionCount = 0;
  sentryModule.captureException = () => {
    captureExceptionCount += 1;
    return "event-id";
  };

  try {
    const error = new AuthError(401, "Invalid token");
    const scope = createBackendObservationScope(
      "backend-api",
      "request-auth",
      "/sync/pull",
      "POST",
      null,
      null,
      null,
      null,
      null,
    );
    const details = {
      installationId: null,
      platform: null,
      appVersion: null,
      afterHotChangeId: null,
      nextHotChangeId: null,
      changesCount: null,
      ...createBackendFailureDetails(error),
    };
    const breadcrumbMessages = withCapturedConsole("log", () => {
      reportBackendExceptionOrBreadcrumb(
        error,
        { action: "sync_pull_error", error, scope, details },
        { action: "sync_pull_error", scope, details },
      );
    });

    assert.equal(captureExceptionCount, 0);
    assert.equal(JSON.parse(breadcrumbMessages[0] ?? "").action, "sync_pull_error");
  } finally {
    sentryModule.captureException = originalCaptureException;
  }
});

test("backend reporting keeps non-server http errors as breadcrumbs", () => {
  const originalCaptureException = sentryModule.captureException;
  let captureExceptionCount = 0;
  sentryModule.captureException = () => {
    captureExceptionCount += 1;
    return "event-id";
  };

  try {
    const error = new HttpError(409, "Select a workspace", "WORKSPACE_SELECTION_REQUIRED");
    const scope = createBackendObservationScope(
      "backend-api",
      "request-http",
      "/workspaces",
      "POST",
      "user-1",
      null,
      null,
      null,
      null,
    );
    const details = createBackendFailureDetails(error);
    const breadcrumbMessages = withCapturedConsole("log", () => {
      reportBackendExceptionOrBreadcrumb(
        error,
        { action: "workspace_create_error", error, scope, details },
        { action: "workspace_create_error", scope, details },
      );
    });

    assert.equal(captureExceptionCount, 0);
    assert.equal(JSON.parse(breadcrumbMessages[0] ?? "").code, "WORKSPACE_SELECTION_REQUIRED");
  } finally {
    sentryModule.captureException = originalCaptureException;
  }
});

test("backend reporting does not recapture already captured exceptions", () => {
  const originalCaptureException = sentryModule.captureException;
  let captureExceptionCount = 0;
  sentryModule.captureException = () => {
    captureExceptionCount += 1;
    return "event-id";
  };

  try {
    const error = new Error("dispatch failed");
    const scope = createBackendObservationScope(
      "backend-api",
      "request-1",
      "/chat/worker",
      "POST",
      "user-1",
      "workspace-1",
      null,
      "run-1",
      null,
    );
    const event = {
      action: "workspace_create_error",
      error,
      scope,
      details: {
        statusCode: 500,
        code: "WORKSPACE_CREATE_FAILED",
        message: "dispatch failed",
        validationIssues: [],
      },
    } as const;

    withCapturedConsole("error", () => {
      captureBackendException(event);
    });
    const breadcrumbMessages = withCapturedConsole("log", () => {
      reportBackendExceptionOrBreadcrumb(
        error,
        event,
        {
          action: "workspace_create_error",
          scope,
          details: {
            statusCode: 500,
            code: "WORKSPACE_CREATE_FAILED",
            message: "dispatch failed",
            validationIssues: [],
          },
        },
      );
    });

    assert.equal(captureExceptionCount, 1);
    assert.equal(JSON.parse(breadcrumbMessages[0] ?? "").action, "workspace_create_error");
  } finally {
    sentryModule.captureException = originalCaptureException;
  }
});

test("backend reporting recognizes repeated normalized non-Error throws", () => {
  const originalCaptureException = sentryModule.captureException;
  let captureExceptionCount = 0;
  sentryModule.captureException = () => {
    captureExceptionCount += 1;
    return "event-id";
  };

  try {
    const thrownError = "non-error route failure";
    const scope = createBackendObservationScope(
      "backend-api",
      "request-2",
      "/sync/push",
      "POST",
      "user-2",
      "workspace-2",
      null,
      null,
      null,
    );
    const routeEvent = {
      action: "workspace_create_error",
      error: normalizeCaughtError(thrownError),
      scope,
      details: {
        statusCode: 500,
        code: "INTERNAL_ERROR",
        message: thrownError,
        validationIssues: [],
      },
    } as const;
    const appEvent = {
      action: "request_failed",
      error: normalizeCaughtError(thrownError),
      scope,
      details: {
        statusCode: 500,
        code: "INTERNAL_ERROR",
        message: thrownError,
        validationIssues: [],
      },
    } as const;

    withCapturedConsole("error", () => {
      reportBackendExceptionOrBreadcrumb(
        thrownError,
        routeEvent,
        {
          action: "workspace_create_error",
          scope,
          details: {
            statusCode: 500,
            code: "INTERNAL_ERROR",
            message: thrownError,
            validationIssues: [],
          },
        },
      );
    });
    const appDetectedPreviousReport = hasReportedBackendException(appEvent.error);
    if (appDetectedPreviousReport === false) {
      withCapturedConsole("error", () => {
        captureBackendException(appEvent);
      });
    }

    assert.equal(appDetectedPreviousReport, true);
    assert.equal(captureExceptionCount, 1);
  } finally {
    sentryModule.captureException = originalCaptureException;
  }
});
