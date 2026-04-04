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
