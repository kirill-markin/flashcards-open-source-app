import type { Handler } from "aws-lambda";
import type { ChatWorkerEvent } from "./chat/worker";
import {
  captureBackendException,
  continueBackendTrace,
  createBackendObservationScope,
  initializeBackendSentry,
  normalizeCaughtError,
  startBackendSpan,
  type ChatWorkerFailureDetails,
  wrapBackendHandler,
} from "./observability/sentry";

initializeBackendSentry("chat-worker");

type HttpErrorClass = typeof import("./errors").HttpError;
type ChatWorkerRuntime = Readonly<{
  handleChatWorkerEvent: typeof import("./chat/worker").handleChatWorkerEvent;
  flushLangfuseTelemetry: typeof import("./telemetry/langfuse").flushLangfuseTelemetry;
  HttpError: HttpErrorClass;
}>;

let chatWorkerRuntimePromise: Promise<ChatWorkerRuntime> | null = null;

async function createChatWorkerRuntime(): Promise<ChatWorkerRuntime> {
  const [
    { flushLangfuseTelemetry, initializeLangfuseTelemetry },
    { handleChatWorkerEvent },
    { HttpError },
  ] = await Promise.all([
    import("./telemetry/langfuse"),
    import("./chat/worker"),
    import("./errors"),
  ]);
  initializeLangfuseTelemetry();
  return {
    handleChatWorkerEvent,
    flushLangfuseTelemetry,
    HttpError,
  };
}

function getChatWorkerRuntime(): Promise<ChatWorkerRuntime> {
  if (chatWorkerRuntimePromise === null) {
    chatWorkerRuntimePromise = createChatWorkerRuntime();
  }

  return chatWorkerRuntimePromise;
}

function createChatWorkerFailureDetails(
  event: ChatWorkerEvent,
  lambdaRequestId: string | null,
  error: Error,
  HttpError: HttpErrorClass | null,
): ChatWorkerFailureDetails {
  const isHttpError = HttpError !== null && error instanceof HttpError;
  return {
    lambdaRequestId,
    routeRequestId: event.routeRequestId ?? null,
    chatRequestId: event.chatRequestId ?? null,
    runId: event.runId,
    sessionId: event.sessionId ?? null,
    userId: event.userId,
    workspaceId: event.workspaceId,
    statusCode: isHttpError ? error.statusCode : null,
    code: isHttpError ? error.code : null,
    message: error.message,
  };
}

const chatWorkerHandler: Handler<ChatWorkerEvent, void> = async (event, context) => {
  const lambdaRequestId = context.awsRequestId ?? null;
  let runtimeHttpError: HttpErrorClass | null = null;
  let runtime: ChatWorkerRuntime | null = null;
  try {
    const initializedRuntime = await getChatWorkerRuntime();
    runtime = initializedRuntime;
    runtimeHttpError = initializedRuntime.HttpError;
    await continueBackendTrace(event.traceContext ?? null, async () => startBackendSpan(
      "chat.worker.run",
      "queue.process",
      async () => {
        await initializedRuntime.handleChatWorkerEvent(event, {
          lambdaRequestId,
          getRemainingTimeInMillis: (): number => context.getRemainingTimeInMillis(),
        });
      },
    ));
  } catch (error) {
    const normalizedError = normalizeCaughtError(error);
    captureBackendException({
      action: "chat_worker_failed",
      error: normalizedError,
      scope: createBackendObservationScope(
        "chat-worker",
        lambdaRequestId,
        null,
        null,
        event.userId,
        event.workspaceId,
        event.chatRequestId ?? null,
        event.runId,
        event.sessionId ?? null,
      ),
      details: createChatWorkerFailureDetails(event, lambdaRequestId, normalizedError, runtimeHttpError),
    });
    throw error;
  } finally {
    if (runtime !== null) {
      await runtime.flushLangfuseTelemetry();
    }
  }
};

export const handler = wrapBackendHandler(chatWorkerHandler);
