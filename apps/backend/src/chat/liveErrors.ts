import type { ContentfulStatusCode } from "hono/utils/http-status";
import { AuthError } from "../auth";
import { HttpError } from "../errors";

export const CHAT_LIVE_SESSION_ID_REQUIRED_CODE = "CHAT_LIVE_SESSION_ID_REQUIRED";
export const CHAT_LIVE_RUN_ID_REQUIRED_CODE = "CHAT_LIVE_RUN_ID_REQUIRED";
export const CHAT_LIVE_AFTER_CURSOR_INVALID_CODE = "CHAT_LIVE_AFTER_CURSOR_INVALID";
export const CHAT_LIVE_WORKSPACE_SELECTION_REQUIRED_CODE = "WORKSPACE_SELECTION_REQUIRED";

export type ChatLiveErrorEnvelope = Readonly<{
  error: string;
  requestId: string;
  code: string;
}>;

export type ChatLiveErrorResponse = Readonly<{
  statusCode: ContentfulStatusCode;
  body: ChatLiveErrorEnvelope;
}>;

/**
 * Normalizes live SSE request failures into the same machine-readable error
 * envelope shape used by the main backend app.
 */
export function createChatLiveErrorResponse(
  error: unknown,
  requestId: string,
): ChatLiveErrorResponse {
  if (error instanceof AuthError) {
    return {
      statusCode: error.statusCode as ContentfulStatusCode,
      body: {
        error: "Authentication failed. Sign in again.",
        requestId,
        code: "AUTH_UNAUTHORIZED",
      },
    };
  }

  if (error instanceof HttpError) {
    return {
      statusCode: error.statusCode as ContentfulStatusCode,
      body: {
        error: error.message,
        requestId,
        code: error.code ?? "REQUEST_FAILED",
      },
    };
  }

  return {
    statusCode: 500,
    body: {
      error: "Request failed. Try again.",
      requestId,
      code: "INTERNAL_ERROR",
    },
  };
}
