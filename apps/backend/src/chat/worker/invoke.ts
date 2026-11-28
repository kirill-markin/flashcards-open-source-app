import { AsyncLocalStorage } from "node:async_hooks";
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { isStandaloneDeployment } from "../../deployment/standalone";
import {
  captureBackendException,
  continueBackendTrace,
  createBackendObservationScope,
  getBackendTraceCarrier,
  normalizeCaughtError,
  startBackendSpan,
  type BackendExceptionEvent,
  type BackendTraceCarrier,
} from "../../observability/sentry";
import { HttpError } from "../../shared/errors";
import { markQueuedChatRunDispatchFailed } from "../runs";
import type { UserOpenAIApiKey } from "../userOpenAIApiKey";
import { createChatWorkerFailureDetails } from "./failureDetails";

export type ChatWorkerDispatch = Readonly<{
  runId: string;
  userId: string;
  workspaceId: string;
  browserGuestSessionId?: string | null;
  initiatingAuthIsSignedIn: boolean;
  userOpenAIApiKey: UserOpenAIApiKey | null;
  routeRequestId?: string | null;
  chatRequestId?: string | null;
  sessionId?: string | null;
}>;

export type ChatWorkerInvocation = Readonly<{
  runId: string;
  userId: string;
  workspaceId: string;
  browserGuestSessionId?: string | null;
  initiatingAuthIsSignedIn?: boolean;
  /**
   * The person's own key in the clear, the only place it leaves the request that carried it. The invoke is
   * asynchronous (`InvocationType: "Event"`) and the chat worker has no dead-letter queue or failure
   * destination, so nothing but Lambda's own event queue holds the payload, and only until delivery.
   */
  userOpenAIApiKey: string | null;
  routeRequestId?: string | null;
  chatRequestId?: string | null;
  sessionId?: string | null;
  traceContext: BackendTraceCarrier | null;
}>;

/** Lambda dispatch is trusted; keep its original account and immutable run identifiers intact. */
export function assertTrustedChatWorkerInvocation(
  payload: Readonly<{ userId: string; workspaceId: string; runId: string; sessionId?: string | null; chatRequestId?: string | null }>,
): void {
  for (const value of [payload.userId, payload.workspaceId, payload.runId]) {
    if (typeof value !== "string" || value.trim() === "") {
      throw new Error("Trusted chat worker dispatch is missing an account, workspace or run identifier");
    }
  }
  for (const value of [payload.sessionId, payload.chatRequestId]) {
    if (value !== undefined && value !== null && (typeof value !== "string" || value.trim() === "")) {
      throw new Error("Trusted chat worker dispatch contains an invalid session or request identifier");
    }
  }
}

type ChatWorkerInvocationDependencies = Readonly<{
  getTraceCarrier: () => BackendTraceCarrier | null;
  getFunctionName: () => string;
  sendCommand: (command: InvokeCommand) => Promise<void>;
}>;

type ChatWorkerDispatchFailureDependencies = Readonly<{
  invokeWorker: (payload: ChatWorkerDispatch) => Promise<void>;
  markDispatchFailed: (
    userId: string,
    workspaceId: string,
    runId: string,
  ) => Promise<void>;
  captureException: (event: BackendExceptionEvent) => void;
}>;

let lambdaClient: LambdaClient | null = null;

/** The chat worker Lambda's timeout, so a standalone run winds down when it would on AWS. */
const inProcessChatWorkerBudgetMs = 15 * 60 * 1000;

// Taken at module load, outside any request: a detached run must not inherit the request's async context,
// such as a database deadline or the request's span, and continues the trace it was handed instead.
const runOutsideRequestContext = AsyncLocalStorage.snapshot();

function getLambdaClient(): LambdaClient {
  if (lambdaClient === null) {
    lambdaClient = new LambdaClient({});
  }

  return lambdaClient;
}

function getChatWorkerFunctionName(): string {
  const functionName = process.env.CHAT_WORKER_FUNCTION_NAME;
  if (functionName === undefined || functionName === "") {
    throw new Error("CHAT_WORKER_FUNCTION_NAME environment variable is not set");
  }

  return functionName;
}

function createChatWorkerInvocation(
  payload: ChatWorkerDispatch,
  traceContext: BackendTraceCarrier | null,
): ChatWorkerInvocation {
  return {
    runId: payload.runId,
    userId: payload.userId,
    workspaceId: payload.workspaceId,
    initiatingAuthIsSignedIn: payload.initiatingAuthIsSignedIn,
    ...(payload.browserGuestSessionId == null ? {} : { browserGuestSessionId: payload.browserGuestSessionId }),
    userOpenAIApiKey: payload.userOpenAIApiKey === null ? null : payload.userOpenAIApiKey.revealRawValue(),
    routeRequestId: payload.routeRequestId ?? null,
    chatRequestId: payload.chatRequestId ?? null,
    sessionId: payload.sessionId ?? null,
    traceContext: traceContext === null
      ? null
      : {
        sentryTrace: traceContext.sentryTrace,
        baggage: traceContext.baggage,
      },
  };
}

function createChatWorkerInvokeCommand(
  functionName: string,
  invocation: ChatWorkerInvocation,
): InvokeCommand {
  return new InvokeCommand({
    FunctionName: functionName,
    InvocationType: "Event",
    Payload: new TextEncoder().encode(JSON.stringify(invocation)),
  });
}

export async function invokeChatWorkerWithDependencies(
  payload: ChatWorkerDispatch,
  dependencies: ChatWorkerInvocationDependencies,
): Promise<void> {
  assertTrustedChatWorkerInvocation(payload);
  const invocation = createChatWorkerInvocation(payload, dependencies.getTraceCarrier());
  const command = createChatWorkerInvokeCommand(dependencies.getFunctionName(), invocation);
  await dependencies.sendCommand(command);
}

/**
 * Standalone runs the worker in this process and does not wait for it, as the asynchronous Lambda invoke
 * does not. A run a restart cuts off is ended by stale-run recovery, as a lost Lambda run is.
 */
async function runChatWorkerInProcess(
  payload: ChatWorkerDispatch,
  invocation: ChatWorkerInvocation,
  startedAtMs: number,
): Promise<void> {
  try {
    const { handleChatWorkerEvent } = await import("./index");
    await continueBackendTrace(invocation.traceContext, async () => startBackendSpan(
      "chat.worker.run",
      "queue.process",
      async () => handleChatWorkerEvent(invocation, {
        lambdaRequestId: null,
        getRemainingTimeInMillis: (): number => Math.max(0, inProcessChatWorkerBudgetMs - (Date.now() - startedAtMs)),
      }),
    ));
  } catch (error) {
    const workerError = normalizeCaughtError(error);
    captureBackendException({
      action: "chat_worker_failed",
      error: workerError,
      scope: createBackendObservationScope(
        "chat-worker",
        null,
        null,
        null,
        invocation.userId,
        invocation.workspaceId,
        invocation.chatRequestId ?? null,
        invocation.runId,
        invocation.sessionId ?? null,
        null,
        null,
      ),
      details: createChatWorkerFailureDetails(invocation, null, workerError, HttpError),
    });
    // Nothing delivers the run again, as Lambda's retries would, so a run the worker left queued ends now.
    try {
      await markQueuedChatRunDispatchFailed(payload.userId, payload.workspaceId, payload.runId);
    } catch (markError) {
      const persistenceError = createDispatchPersistenceFailureError(workerError, normalizeCaughtError(markError));
      captureBackendException(createChatWorkerDispatchFailedEvent(payload, persistenceError, persistenceError.message));
    }
  }
}

function startChatWorkerInProcess(payload: ChatWorkerDispatch): void {
  assertTrustedChatWorkerInvocation(payload);
  const invocation = createChatWorkerInvocation(payload, getBackendTraceCarrier());
  const startedAtMs = Date.now();
  void runOutsideRequestContext(async () => runChatWorkerInProcess(payload, invocation, startedAtMs));
}

export async function invokeChatWorker(
  payload: ChatWorkerDispatch,
): Promise<void> {
  if (isStandaloneDeployment()) {
    startChatWorkerInProcess(payload);
    return;
  }

  await invokeChatWorkerWithDependencies(payload, {
    getTraceCarrier: getBackendTraceCarrier,
    getFunctionName: getChatWorkerFunctionName,
    sendCommand: async (command: InvokeCommand): Promise<void> => {
      await getLambdaClient().send(command);
    },
  });
}

function createChatWorkerDispatchFailedEvent(
  payload: ChatWorkerDispatch,
  error: Error,
  message: string,
): BackendExceptionEvent {
  return {
    action: "chat_worker_dispatch_failed",
    error,
    scope: createBackendObservationScope(
      "backend-api",
      payload.routeRequestId ?? null,
      null,
      null,
      payload.userId,
      payload.workspaceId,
      payload.chatRequestId ?? null,
      payload.runId,
      payload.sessionId ?? null,
      null,
      null,
    ),
    details: {
      message,
    },
  };
}

function createDispatchPersistenceFailureError(
  dispatchError: Error,
  markError: Error,
): Error {
  const error = new Error(
    `Chat worker dispatch failed before failed-state persistence failed: ${dispatchError.message}`,
    { cause: markError },
  );
  error.name = "ChatWorkerDispatchPersistenceFailureError";
  return error;
}

export async function invokeChatWorkerOrPersistFailureWithDependencies(
  payload: ChatWorkerDispatch,
  dependencies: ChatWorkerDispatchFailureDependencies,
): Promise<void> {
  try {
    await dependencies.invokeWorker(payload);
  } catch (error) {
    const dispatchError = normalizeCaughtError(error);
    const message = dispatchError.message;
    dependencies.captureException(createChatWorkerDispatchFailedEvent(payload, dispatchError, message));
    try {
      await dependencies.markDispatchFailed(
        payload.userId,
        payload.workspaceId,
        payload.runId,
      );
    } catch (markError) {
      throw createDispatchPersistenceFailureError(dispatchError, normalizeCaughtError(markError));
    }
    throw dispatchError;
  }
}

export async function invokeChatWorkerOrPersistFailure(
  payload: ChatWorkerDispatch,
): Promise<void> {
  await invokeChatWorkerOrPersistFailureWithDependencies(payload, {
    invokeWorker: invokeChatWorker,
    markDispatchFailed: markQueuedChatRunDispatchFailed,
    captureException: captureBackendException,
  });
}
