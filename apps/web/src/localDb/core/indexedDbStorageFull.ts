export class IndexedDbStorageFullError extends Error {}

export function isNativeIndexedDbStorageFull(error: unknown): error is DOMException {
  return error instanceof DOMException
    && (error.name === "QuotaExceededError" || error.message.includes("FILE_ERROR_NO_SPACE"));
}
