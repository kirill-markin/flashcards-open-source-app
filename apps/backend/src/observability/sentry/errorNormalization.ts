const capturedExceptionSet = new WeakSet<Error>();
const normalizedNonErrorObjectMap = new WeakMap<object, Error>();
const normalizedNonErrorPrimitiveMap = new Map<NonErrorPrimitive, Error>();

type NonErrorPrimitive = string | number | boolean | bigint | symbol | null | undefined;

export function normalizeCaughtError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  if ((typeof error === "object" && error !== null) || typeof error === "function") {
    const cachedError = normalizedNonErrorObjectMap.get(error as object);
    if (cachedError !== undefined) {
      return cachedError;
    }

    const normalizedError = createNonErrorThrowWrapper(error);
    normalizedNonErrorObjectMap.set(error as object, normalizedError);
    return normalizedError;
  }

  const primitiveError = error as NonErrorPrimitive;
  const cachedError = normalizedNonErrorPrimitiveMap.get(primitiveError);
  if (cachedError !== undefined) {
    return cachedError;
  }

  const normalizedError = createNonErrorThrowWrapper(error);
  normalizedNonErrorPrimitiveMap.set(primitiveError, normalizedError);
  return normalizedError;
}

function createNonErrorThrowWrapper(error: unknown): Error {
  const normalizedError = new Error(String(error));
  normalizedError.name = "NonErrorThrow";
  return normalizedError;
}

export function markCapturedBackendException(error: Error): void {
  capturedExceptionSet.add(error);
}

export function hasCapturedBackendException(error: Error): boolean {
  return capturedExceptionSet.has(error);
}
