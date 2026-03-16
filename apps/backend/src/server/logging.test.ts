import assert from "node:assert/strict";
import test from "node:test";
import { HttpError } from "../errors";
import { getErrorLogContext, logRequestError } from "./logging";

test("getErrorLogContext extracts the first stack-frame location", () => {
  const error = new Error("boom");
  error.stack = [
    "Error: boom",
    "    at doThing (/var/task/dist/chat/http.js:123:45)",
    "    at handler (/var/task/dist/index.js:20:3)",
  ].join("\n");

  const context = getErrorLogContext(error);

  assert.equal(context.errorClass, "Error");
  assert.equal(context.errorMessage, "boom");
  assert.equal(context.sourceFile, "/var/task/dist/chat/http.js");
  assert.equal(context.sourceLine, 123);
  assert.equal(context.sourceColumn, 45);
});

test("logRequestError includes validation messages for HttpError failures", () => {
  const originalConsoleError = console.error;
  const capturedLogs: Array<string> = [];
  console.error = (message?: unknown) => {
    capturedLogs.push(String(message));
  };

  try {
    logRequestError(
      "request-validation-1",
      "/v1/chat/local-turn",
      "POST",
      new HttpError(
        400,
        "chatSessionId must be a string",
        undefined,
        {
          validationIssues: [{
            path: "chatSessionId",
            code: "invalid_type",
            message: "chatSessionId must be a string",
          }],
        },
      ),
    );

    assert.equal(capturedLogs.length, 1);
    const loggedRecord = JSON.parse(capturedLogs[0] ?? "{}") as Record<string, unknown>;
    assert.equal(loggedRecord.action, "request_error");
    assert.equal(loggedRecord.statusCode, 400);
    assert.equal(loggedRecord.errorMessage, "chatSessionId must be a string");
    assert.deepEqual(loggedRecord.validationIssues, [{
      path: "chatSessionId",
      code: "invalid_type",
      message: "chatSessionId must be a string",
    }]);
  } finally {
    console.error = originalConsoleError;
  }
});
