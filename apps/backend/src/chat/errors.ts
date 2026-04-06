export class ChatSessionRowNotFoundError extends Error {
  public constructor(operation: string) {
    super(`Chat session ${operation} failed: query returned no row`);
    this.name = "ChatSessionRowNotFoundError";
  }
}

export class ChatItemRowNotFoundError extends Error {
  public constructor(operation: string) {
    super(`Chat item ${operation} failed: query returned no row`);
    this.name = "ChatItemRowNotFoundError";
  }
}

export class ChatRunRowNotFoundError extends Error {
  public constructor(operation: string) {
    super(`Chat run ${operation} failed: query returned no row`);
    this.name = "ChatRunRowNotFoundError";
  }
}

export function isChatStorageEntityNotFoundError(error: unknown): boolean {
  return error instanceof ChatSessionRowNotFoundError
    || error instanceof ChatItemRowNotFoundError
    || error instanceof ChatRunRowNotFoundError;
}

export type ChatSessionRequestedSessionIdConflictError = Error & Readonly<{
  sessionId: string;
}>;

export function createChatSessionRequestedSessionIdConflictError(sessionId: string): ChatSessionRequestedSessionIdConflictError {
  return Object.assign(new Error(`Requested chat session id is already in use: ${sessionId}`), {
    name: "ChatSessionRequestedSessionIdConflictError",
    sessionId,
  });
}

export function isChatSessionRequestedSessionIdConflictError(
  error: unknown,
): error is ChatSessionRequestedSessionIdConflictError {
  return error instanceof Error
    && error.name === "ChatSessionRequestedSessionIdConflictError"
    && typeof (error as Partial<ChatSessionRequestedSessionIdConflictError>).sessionId === "string";
}
