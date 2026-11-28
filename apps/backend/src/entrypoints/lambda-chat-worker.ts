import type { Handler } from "aws-lambda";
import type { ChatWorkerEvent } from "../chat/worker";
import { createChatWorkerFailureDetails } from "../chat/worker/failureDetails";
import {
  captureBackendException,
  continueBackendTrace,
  createBackendObservationScope,
  initializeBackendSentry,
  normalizeCaughtError,
  startBackendSpan,
  wrapBackendHandler,
} from "../observability/sentry";

initializeBackendSentry("chat-worker");

type HttpErrorClass = typeof import("../shared/errors").HttpError;
type ChatWorkerRuntime = Readonly<{
  handleChatWorkerEvent: typeof import("../chat/worker").handleChatWorkerEvent;
  HttpError: HttpErrorClass;
}>;

let chatWorkerRuntimePromise: Promise<ChatWorkerRuntime> | null = null;

async function createChatWorkerRuntime(): Promise<ChatWorkerRuntime> {
  const [
    { handleChatWorkerEvent },
    { HttpError },
  ] = await Promise.all([
    import("../chat/worker"),
    import("../shared/errors"),
  ]);
  return {
    handleChatWorkerEvent,
    HttpError,
  };
}

function getChatWorkerRuntime(): Promise<ChatWorkerRuntime> {
  if (chatWorkerRuntimePromise === null) {
    chatWorkerRuntimePromise = createChatWorkerRuntime();
  }

  return chatWorkerRuntimePromise;
}

const chatWorkerHandler: Handler<ChatWorkerEvent, void> = async (event, context) => {
  const lambdaRequestId = context.awsRequestId ?? null;
  const observationScope = createBackendObservationScope(
    "chat-worker",
    lambdaRequestId,
    null,
    null,
    event.userId,
    event.workspaceId,
    event.chatRequestId ?? null,
    event.runId,
    event.sessionId ?? null,
    null,
    null,
  );
  let runtimeHttpError: HttpErrorClass | null = null;
  try {
    const initializedRuntime = await getChatWorkerRuntime();
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
      scope: observationScope,
      details: createChatWorkerFailureDetails(event, lambdaRequestId, normalizedError, runtimeHttpError),
    });
    throw error;
  }
};

export const handler = wrapBackendHandler(chatWorkerHandler);
