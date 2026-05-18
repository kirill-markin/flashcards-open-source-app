/**
 * Backend-owned chat worker dispatch helpers.
 * The route layer persists the run first, then this module triggers the worker so the run survives client disconnects.
 */
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import {
  captureBackendException,
  createBackendObservationScope,
  getBackendTraceCarrier,
  normalizeCaughtError,
  type BackendExceptionEvent,
  type BackendTraceCarrier,
} from "../observability/sentry";
import { markQueuedChatRunDispatchFailed } from "./runs";

export type ChatWorkerDispatch = Readonly<{
  runId: string;
  userId: string;
  workspaceId: string;
  routeRequestId?: string | null;
  chatRequestId?: string | null;
  sessionId?: string | null;
}>;

export type ChatWorkerInvocation = Readonly<{
  runId: string;
  userId: string;
  workspaceId: string;
  routeRequestId?: string | null;
  chatRequestId?: string | null;
  sessionId?: string | null;
  traceContext: BackendTraceCarrier | null;
}>;

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
    errorMessage: string,
  ) => Promise<void>;
  captureException: (event: BackendExceptionEvent) => void;
}>;

let lambdaClient: LambdaClient | null = null;

/**
 * Returns the process-local Lambda client used to trigger chat workers.
 */
function getLambdaClient(): LambdaClient {
  if (lambdaClient === null) {
    lambdaClient = new LambdaClient({});
  }

  return lambdaClient;
}

/**
 * Reads the Lambda function name that owns backend-owned chat execution.
 */
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
  const invocation = createChatWorkerInvocation(payload, dependencies.getTraceCarrier());
  const command = createChatWorkerInvokeCommand(dependencies.getFunctionName(), invocation);
  await dependencies.sendCommand(command);
}

/**
 * Dispatches a persisted chat run to the asynchronous worker without waiting for completion.
 */
export async function invokeChatWorker(
  payload: ChatWorkerDispatch,
): Promise<void> {
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
        `Chat worker dispatch failed: ${message}`,
      );
    } catch (markError) {
      throw createDispatchPersistenceFailureError(dispatchError, normalizeCaughtError(markError));
    }
    throw dispatchError;
  }
}

/**
 * Dispatches a persisted chat run and marks it as failed if worker invocation itself fails.
 */
export async function invokeChatWorkerOrPersistFailure(
  payload: ChatWorkerDispatch,
): Promise<void> {
  await invokeChatWorkerOrPersistFailureWithDependencies(payload, {
    invokeWorker: invokeChatWorker,
    markDispatchFailed: markQueuedChatRunDispatchFailed,
    captureException: captureBackendException,
  });
}
