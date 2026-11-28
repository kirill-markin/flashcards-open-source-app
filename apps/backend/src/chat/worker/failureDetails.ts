import type { ChatWorkerFailureDetails } from "../../observability/sentry";
import type { HttpError } from "../../shared/errors";
import type { ChatWorkerEvent } from "./index";

/**
 * The details of one `chat_worker_failed` report, the same from the Lambda and the in-process worker.
 * `HttpErrorClass` is null when the Lambda failed before its lazily loaded runtime brought the class.
 */
export function createChatWorkerFailureDetails(
  event: ChatWorkerEvent,
  lambdaRequestId: string | null,
  error: Error,
  HttpErrorClass: typeof HttpError | null,
): ChatWorkerFailureDetails {
  const isHttpError = HttpErrorClass !== null && error instanceof HttpErrorClass;
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
