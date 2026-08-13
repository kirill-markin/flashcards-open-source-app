export type IndexedDbOpenRecoveryError = Error & Readonly<{
  indexedDbOperation: "open";
  indexedDbErrorName: "UnknownError";
}>;

export function isIndexedDbOpenRecoveryError(error: unknown): error is IndexedDbOpenRecoveryError {
  return error instanceof Error
    && "indexedDbOperation" in error
    && error.indexedDbOperation === "open"
    && "indexedDbErrorName" in error
    && error.indexedDbErrorName === "UnknownError";
}
