import assert from "node:assert/strict";
import test from "node:test";
import { InvokeCommand } from "@aws-sdk/client-lambda";
import type {
  BackendExceptionEvent,
  BackendObservationScope,
  BackendTraceCarrier,
  ChatWorkerDispatchFailureDetails,
} from "../../observability/sentry";
import type { ChatWorkerEvent } from "../worker";
import {
  invokeChatWorkerOrPersistFailureWithDependencies,
  invokeChatWorkerWithDependencies,
  type ChatWorkerInvocation,
} from "../worker/invoke";

type ChatWorkerDispatchFailureEvent = Readonly<{
  action: "chat_worker_dispatch_failed";
  error: Error;
  scope: BackendObservationScope;
  details: ChatWorkerDispatchFailureDetails;
}>;

function requireDispatchFailureEvent(
  event: BackendExceptionEvent | undefined,
): ChatWorkerDispatchFailureEvent {
  if (event === undefined || event.action !== "chat_worker_dispatch_failed") {
    throw new Error("Expected chat_worker_dispatch_failed event");
  }

  return event;
}

test("ChatWorkerEvent includes and preserves Sentry trace carrier fields", () => {
  const event: ChatWorkerEvent = {
    runId: "run-1",
    userId: "user-1",
    workspaceId: "workspace-1",
    traceContext: {
      sentryTrace: "0123456789abcdef0123456789abcdef-0123456789abcdef-1",
      baggage: "sentry-release=abc123,sentry-environment=production",
    },
  };

  assert.deepEqual(JSON.parse(JSON.stringify(event)), {
    runId: "run-1",
    userId: "user-1",
    workspaceId: "workspace-1",
    traceContext: {
      sentryTrace: "0123456789abcdef0123456789abcdef-0123456789abcdef-1",
      baggage: "sentry-release=abc123,sentry-environment=production",
    },
  });
});

test("invokeChatWorkerWithDependencies copies trace context into the Lambda event payload", async () => {
  const traceContext: BackendTraceCarrier = {
    sentryTrace: "fedcba9876543210fedcba9876543210-fedcba9876543210-1",
    baggage: "sentry-release=def456,sentry-environment=preview",
  };
  const sentCommands: Array<InvokeCommand> = [];

  await invokeChatWorkerWithDependencies({
    runId: "run-2",
    userId: "user-2",
    workspaceId: "workspace-2",
  }, {
    getTraceCarrier: () => traceContext,
    getFunctionName: () => "chat-worker-test",
    sendCommand: async (command: InvokeCommand): Promise<void> => {
      sentCommands.push(command);
    },
  });

  assert.equal(sentCommands.length, 1);
  const command = sentCommands.at(0);
  assert.ok(command !== undefined);
  assert.equal(command.input.FunctionName, "chat-worker-test");
  assert.equal(command.input.InvocationType, "Event");

  const payload = command.input.Payload;
  assert.ok(payload instanceof Uint8Array);
  const event = JSON.parse(new TextDecoder().decode(payload)) as ChatWorkerInvocation;
  assert.deepEqual(event, {
    runId: "run-2",
    userId: "user-2",
    workspaceId: "workspace-2",
    routeRequestId: null,
    chatRequestId: null,
    sessionId: null,
    traceContext,
  });
});

test("invokeChatWorkerOrPersistFailureWithDependencies captures dispatch failure before marking the run failed", async () => {
  const dispatchError = new Error("Lambda invoke rejected");
  const markError = new Error("database update rejected");
  const capturedEvents: Array<BackendExceptionEvent> = [];
  let markCallCount = 0;
  let persistedErrorMessage: string | null = null;

  await assert.rejects(
    async () => invokeChatWorkerOrPersistFailureWithDependencies({
      runId: "run-3",
      userId: "user-3",
      workspaceId: "workspace-3",
      routeRequestId: "route-request-3",
      chatRequestId: "client-request-3",
      sessionId: "session-3",
    }, {
      invokeWorker: async (): Promise<void> => {
        throw dispatchError;
      },
      markDispatchFailed: async (
        _userId: string,
        _workspaceId: string,
        _runId: string,
        errorMessage: string,
      ): Promise<void> => {
        markCallCount += 1;
        persistedErrorMessage = errorMessage;
        throw markError;
      },
      captureException: (event: BackendExceptionEvent): void => {
        capturedEvents.push(event);
      },
    }),
    (error: unknown): boolean => {
      assert.ok(error instanceof Error);
      assert.equal(error.name, "ChatWorkerDispatchPersistenceFailureError");
      assert.equal(
        error.message,
        "Chat worker dispatch failed before failed-state persistence failed: Lambda invoke rejected",
      );
      assert.equal(error.cause, markError);
      return true;
    },
  );

  assert.equal(markCallCount, 1);
  assert.equal(persistedErrorMessage, "Chat worker dispatch failed: Lambda invoke rejected");
  const capturedEvent = requireDispatchFailureEvent(capturedEvents.at(0));
  assert.equal(capturedEvents.length, 1);
  assert.equal(capturedEvent.error, dispatchError);
  assert.equal(capturedEvent.details.message, "Lambda invoke rejected");
  assert.equal(capturedEvent.scope.requestId, "route-request-3");
  assert.equal(capturedEvent.scope.userId, "user-3");
  assert.equal(capturedEvent.scope.workspaceId, "workspace-3");
  assert.equal(capturedEvent.scope.chatRequestId, "client-request-3");
  assert.equal(capturedEvent.scope.runId, "run-3");
  assert.equal(capturedEvent.scope.sessionId, "session-3");
});
