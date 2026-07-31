import { performance } from "node:perf_hooks";
import { lifecycleCleanupTimeoutMilliseconds } from "./boundaries.mjs";

export function asError(error) {
  return error instanceof Error ? error : new Error(String(error));
}

export function contextualError(message, error) {
  const cause = asError(error);
  return new Error(`${message} cause=${cause.message}`, { cause });
}

function rootError(error) {
  let current = asError(error);
  const visited = new Set();
  while (
    current.cause instanceof Error
    && !visited.has(current.cause)
  ) {
    visited.add(current);
    current = current.cause;
  }
  return current;
}

export function combineErrors(errors, message) {
  const seenRootErrors = new Set();
  const uniqueErrors = errors.filter((error) => {
    const root = rootError(error);
    if (seenRootErrors.has(root)) return false;
    seenRootErrors.add(root);
    return true;
  });
  if (uniqueErrors.length === 0) return null;
  if (uniqueErrors.length === 1) return uniqueErrors[0];
  return new AggregateError(uniqueErrors, message);
}

function createCleanupDeadline(phase) {
  return Object.freeze({
    expiresAt: performance.now() + lifecycleCleanupTimeoutMilliseconds,
    phase,
    timeoutMilliseconds: lifecycleCleanupTimeoutMilliseconds,
  });
}

export function createTerminalCleanupController() {
  let activeDeadline = null;
  return Object.freeze({
    begin(phase) {
      if (activeDeadline === null) {
        activeDeadline = createCleanupDeadline(phase);
      }
      return activeDeadline;
    },
    clearCompletedBoundary(cleanupDeadline) {
      if (activeDeadline !== cleanupDeadline) {
        throw new Error(
          "PostgreSQL integration terminal cleanup deadline changed unexpectedly while completing a boundary.",
        );
      }
      activeDeadline = null;
    },
  });
}

export function cleanupRemainingMilliseconds(cleanupDeadline, phase) {
  const remainingMilliseconds = Math.ceil(
    cleanupDeadline.expiresAt - performance.now(),
  );
  if (remainingMilliseconds <= 0) {
    const error = new Error(
      `PostgreSQL integration cleanup deadline expired before starting an operation. cleanupPhase=${cleanupDeadline.phase} operationPhase=${phase} timeoutMilliseconds=${cleanupDeadline.timeoutMilliseconds}`,
    );
    error.name = "PostgresIntegrationCleanupTimeoutError";
    throw error;
  }
  return remainingMilliseconds;
}

export function cleanupOperationTimeoutError(cleanupDeadline, phase) {
  const error = new Error(
    `PostgreSQL integration cleanup operation exceeded the shared deadline and its client connection was forcibly terminated. cleanupPhase=${cleanupDeadline.phase} operationPhase=${phase} timeoutMilliseconds=${cleanupDeadline.timeoutMilliseconds}`,
  );
  error.name = "PostgresIntegrationCleanupTimeoutError";
  return error;
}
