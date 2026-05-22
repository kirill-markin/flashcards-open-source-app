import { HttpError } from "../../shared/errors";
import { isChatSessionRequestedSessionIdConflictError } from "../errors";
import {
  ChatSessionConflictError,
  ChatSessionNotFoundError,
} from "../store";

const chatSessionIdConflictCode = "CHAT_SESSION_ID_CONFLICT";

/**
 * Maps store-layer errors into the HTTP error contract used by the thin chat clients.
 */
export function mapStoreError(error: unknown): never {
  if (error instanceof ChatSessionNotFoundError) {
    throw new HttpError(404, error.message);
  }

  if (isChatSessionRequestedSessionIdConflictError(error)) {
    throw new HttpError(
      409,
      "Requested chat session id is already in use.",
      chatSessionIdConflictCode,
    );
  }

  if (error instanceof ChatSessionConflictError) {
    throw new HttpError(
      409,
      "Chat session already has an active response",
      "CHAT_ACTIVE_RUN_IN_PROGRESS",
    );
  }

  throw error;
}
