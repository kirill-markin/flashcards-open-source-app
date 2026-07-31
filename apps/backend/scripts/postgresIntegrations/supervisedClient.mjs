import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import PgClient from "pg/lib/client.js";
import {
  cleanupClientTeardownReserveMilliseconds,
  emergencyClientTeardownReserveMilliseconds,
  mutableWorkShutdownPollMilliseconds,
} from "./boundaries.mjs";
import {
  asError,
  cleanupOperationTimeoutError,
  cleanupRemainingMilliseconds,
  combineErrors,
  contextualError,
} from "./errors.mjs";

export const postgresSessionContractSql = `
  SELECT
    current_database() AS database_name,
    current_setting('client_encoding') AS client_encoding,
    current_setting('standard_conforming_strings') AS standard_conforming_strings
`;

export function assertPostgresSessionContractState(
  state,
  expectedDatabaseName,
  phase,
) {
  if (
    state?.database_name !== expectedDatabaseName
    || state.client_encoding !== "UTF8"
    || state.standard_conforming_strings !== "on"
  ) {
    throw new Error(
      `PostgreSQL session contract is invalid. phase=${phase} expectedDatabase=${expectedDatabaseName} actualDatabase=${state?.database_name ?? "missing"} expectedClientEncoding=UTF8 actualClientEncoding=${state?.client_encoding ?? "missing"} expectedStandardConformingStrings=on actualStandardConformingStrings=${state?.standard_conforming_strings ?? "missing"}`,
    );
  }
}

export async function requirePostgresSessionContract(
  client,
  expectedDatabaseName,
  phase,
) {
  const result = await client.query(postgresSessionContractSql);
  assertPostgresSessionContractState(
    result.rows[0],
    expectedDatabaseName,
    phase,
  );
}

export function createSupervisedPostgresClient(
  clientOptions,
  phase,
  onBackgroundFailure,
) {
  const client = new PgClient(clientOptions);
  let backgroundFailure = null;
  let closePromise = null;
  const handleError = (error) => {
    if (backgroundFailure !== null) return;
    backgroundFailure = contextualError(
      `PostgreSQL client emitted a background connection error. phase=${phase}`,
      error,
    );
    if (onBackgroundFailure !== null) {
      onBackgroundFailure(backgroundFailure);
    }
  };
  client.on("error", handleError);
  const beginClose = () => {
    if (closePromise !== null) return closePromise;
    try {
      closePromise = Promise.resolve(client.end());
    } catch (error) {
      closePromise = Promise.reject(error);
    }
    return closePromise;
  };
  return Object.freeze({
    abort() {
      const closing = beginClose();
      client.connection.stream.destroy();
      return closing;
    },
    backgroundFailure() {
      return backgroundFailure;
    },
    client,
    close() {
      return beginClose();
    },
    detach() {
      client.off("error", handleError);
    },
  });
}

async function finishTimedOutPostgresOperation(
  cleanupDeadline,
  phase,
  timeoutError,
  terminateTimedOutOperation,
) {
  const teardownPromise = Promise.resolve()
    .then(terminateTimedOutOperation);
  const teardownMilliseconds = Math.max(
    0,
    Math.floor(cleanupDeadline.expiresAt - performance.now()),
  );
  let teardownTimeoutHandle;
  const teardownTimeout = new Promise((resolve, reject) => {
    teardownTimeoutHandle = setTimeout(() => {
      reject(new Error(
        `Timed out awaiting forced PostgreSQL client/backend teardown. cleanupPhase=${cleanupDeadline.phase} operationPhase=${phase} timeoutMilliseconds=${cleanupDeadline.timeoutMilliseconds}`,
      ));
    }, teardownMilliseconds);
  });
  try {
    await Promise.race([teardownPromise, teardownTimeout]);
  } catch (teardownError) {
    throw new AggregateError(
      [timeoutError, asError(teardownError)],
      `PostgreSQL operation and forced client/backend teardown exceeded the shared deadline. cleanupPhase=${cleanupDeadline.phase} operationPhase=${phase}`,
    );
  } finally {
    clearTimeout(teardownTimeoutHandle);
  }
  throw timeoutError;
}

async function runDeadlineBoundPostgresOperation(
  cleanupDeadline,
  phase,
  teardownReserveMilliseconds,
  operation,
  terminateTimedOutOperation,
) {
  const remainingMilliseconds = cleanupRemainingMilliseconds(
    cleanupDeadline,
    phase,
  );
  if (remainingMilliseconds <= teardownReserveMilliseconds) {
    await finishTimedOutPostgresOperation(
      cleanupDeadline,
      phase,
      cleanupOperationTimeoutError(cleanupDeadline, phase),
      terminateTimedOutOperation,
    );
  }
  const operationTimeoutMilliseconds =
    remainingMilliseconds - teardownReserveMilliseconds;
  const neverSettles = new Promise(() => {});
  let timedOut = false;
  let timeoutHandle;
  const operationPromise = Promise.resolve()
    .then(operation)
    .then(
      (result) => (timedOut ? neverSettles : result),
      (error) => {
        if (timedOut) return neverSettles;
        throw error;
      },
    );
  const timeoutPromise = new Promise((resolve, reject) => {
    timeoutHandle = setTimeout(() => {
      timedOut = true;
      const timeoutError = cleanupOperationTimeoutError(
        cleanupDeadline,
        phase,
      );
      finishTimedOutPostgresOperation(
        cleanupDeadline,
        phase,
        timeoutError,
        terminateTimedOutOperation,
      ).catch(reject);
    }, operationTimeoutMilliseconds);
  });
  try {
    return await Promise.race([operationPromise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutHandle);
  }
}

export function runCleanupClientOperation(
  cleanupSession,
  cleanupDeadline,
  phase,
  operation,
) {
  return runDeadlineBoundPostgresOperation(
    cleanupDeadline,
    phase,
    cleanupClientTeardownReserveMilliseconds,
    operation,
    () => {
      cleanupSession.connected = false;
      cleanupSession.lockHeld = false;
      return cleanupSession.terminateTimedOutOperation(
        cleanupDeadline,
        phase,
      );
    },
  );
}

export async function runEmergencyClientOperation(
  supervisedClient,
  cleanupDeadline,
  phase,
  operation,
) {
  return runDeadlineBoundPostgresOperation(
    cleanupDeadline,
    phase,
    emergencyClientTeardownReserveMilliseconds,
    operation,
    () => supervisedClient.abort(),
  );
}

export function runCleanupQuery(
  cleanupSession,
  cleanupDeadline,
  phase,
  text,
  values,
) {
  return runCleanupClientOperation(
    cleanupSession,
    cleanupDeadline,
    phase,
    () => cleanupSession.supervisedClient.client.query(text, values),
  );
}

export async function requireCleanupSessionContract(
  cleanupSession,
  cleanupDeadline,
  expectedDatabaseName,
  phase,
) {
  const result = await runCleanupQuery(
    cleanupSession,
    cleanupDeadline,
    phase,
    postgresSessionContractSql,
    [],
  );
  assertPostgresSessionContractState(
    result.rows[0],
    expectedDatabaseName,
    phase,
  );
}

export function createMutableWorkSupervisor() {
  let firstShutdownFailure = null;
  let nextWorkId = 1;
  const activeWork = new Map();
  const shutdownErrors = [];
  let resolveShutdown;
  const shutdown = new Promise((resolveStartedShutdown) => {
    resolveShutdown = resolveStartedShutdown;
  });

  const finishEntry = (entry) => {
    if (
      !entry.completed
      || entry.rawOperations.size > 0
      || (entry.stopPromise !== null && !entry.stopSettled)
    ) {
      return;
    }
    activeWork.delete(entry.workId);
    entry.resolveSettlement();
  };

  const requestStop = (entry) => {
    if (entry.stopPromise !== null) return;
    entry.stopPromise = Promise.resolve()
      .then(entry.stop)
      .catch((error) => {
        shutdownErrors.push(contextualError(
          `Failed to stop mutable PostgreSQL integration work during terminal shutdown. phase=${entry.phase}`,
          error,
        ));
      })
      .finally(() => {
        entry.stopSettled = true;
        finishEntry(entry);
      });
  };

  const awaitTrackedOperation = (entry, operation, operationPhase) => {
    const rawOperation = Promise.resolve(operation);
    const operationState = {
      callerInterrupted: false,
      callerSettled: false,
      operationPhase,
      rawOperation,
    };
    entry.rawOperations.add(operationState);
    rawOperation.then(
      () => {
        entry.rawOperations.delete(operationState);
        finishEntry(entry);
      },
      (error) => {
        if (operationState.callerInterrupted) {
          shutdownErrors.push(contextualError(
            `Mutable PostgreSQL integration operation failed after terminal shutdown interrupted its caller. phase=${entry.phase} operationPhase=${operationPhase}`,
            error,
          ));
        }
        entry.rawOperations.delete(operationState);
        finishEntry(entry);
      },
    );

    const operationForCaller = rawOperation.then(
      (result) => {
        operationState.callerSettled = true;
        return result;
      },
      (error) => {
        operationState.callerSettled = true;
        throw error;
      },
    );
    const shutdownForCaller = shutdown.then((failure) => {
      if (!operationState.callerSettled) {
        operationState.callerInterrupted = true;
        operationState.callerSettled = true;
      }
      throw contextualError(
        `PostgreSQL integration work was interrupted by terminal shutdown. phase=${operationPhase}`,
        failure,
      );
    });
    return Promise.race([operationForCaller, shutdownForCaller]);
  };

  return Object.freeze({
    assertCanStart(phase) {
      if (firstShutdownFailure === null) return;
      throw contextualError(
        `Refusing to start mutable PostgreSQL integration work after terminal shutdown began. phase=${phase}`,
        firstShutdownFailure,
      );
    },
    async awaitOperation(operation, phase) {
      if (firstShutdownFailure !== null) {
        throw contextualError(
          `Refusing to await mutable PostgreSQL integration work after terminal shutdown began. phase=${phase}`,
          firstShutdownFailure,
        );
      }
      return Promise.race([
        Promise.resolve(operation),
        shutdown.then((failure) => {
          throw contextualError(
            `PostgreSQL integration work was interrupted by terminal shutdown. phase=${phase}`,
            failure,
          );
        }),
      ]);
    },
    errors() {
      return [...shutdownErrors];
    },
    register(phase, stop) {
      let resolveSettlement;
      const settlement = new Promise((resolveRegisteredWork) => {
        resolveSettlement = resolveRegisteredWork;
      });
      const workId = nextWorkId;
      nextWorkId += 1;
      const entry = {
        completed: false,
        phase,
        rawOperations: new Set(),
        resolveSettlement,
        settlement,
        stop,
        stopPromise: null,
        stopSettled: false,
        workId,
      };
      activeWork.set(workId, entry);
      if (firstShutdownFailure !== null) requestStop(entry);

      return Object.freeze({
        assertCanStart() {
          if (firstShutdownFailure === null) return;
          throw contextualError(
            `Refusing to start mutable PostgreSQL integration work after terminal shutdown began. phase=${phase}`,
            firstShutdownFailure,
          );
        },
        awaitOperation(operation, operationPhase) {
          return awaitTrackedOperation(
            entry,
            operation,
            operationPhase,
          );
        },
        complete() {
          if (entry.completed) return;
          entry.completed = true;
          finishEntry(entry);
        },
      });
    },
    stopAll(failure) {
      if (firstShutdownFailure === null) {
        firstShutdownFailure = failure;
        resolveShutdown(failure);
      }
      for (const entry of activeWork.values()) {
        requestStop(entry);
      }
    },
    async waitForStopped(cleanupDeadline) {
      if (activeWork.size === 0) return;
      while (activeWork.size > 0) {
        const entries = [...activeWork.values()];
        if (firstShutdownFailure !== null) {
          for (const entry of entries) requestStop(entry);
        }
        const remainingMilliseconds = cleanupRemainingMilliseconds(
          cleanupDeadline,
          `mutable work shutdown activePhases=${JSON.stringify(entries.map((entry) => entry.phase))}`,
        );
        await Promise.race([
          Promise.all(entries.map((entry) => entry.settlement)),
          delay(Math.min(
            mutableWorkShutdownPollMilliseconds,
            remainingMilliseconds,
          )),
        ]);
      }
    },
  });
}

export async function withPostgresClient(
  clientOptions,
  phase,
  callback,
  mutableWorkSupervisor,
) {
  const supervisedClient = createSupervisedPostgresClient(
    clientOptions,
    phase,
    null,
  );
  const { client } = supervisedClient;
  const mutableWork = mutableWorkSupervisor.register(
    phase,
    () => supervisedClient.abort(),
  );
  let result;
  let primaryError = null;
  try {
    mutableWork.assertCanStart();
    await mutableWork.awaitOperation(
      client.connect(),
      `${phase} connection establishment`,
    );
    mutableWork.assertCanStart();
    await mutableWork.awaitOperation(
      requirePostgresSessionContract(
        client,
        clientOptions.database,
        `${phase} session contract verification`,
      ),
      `${phase} session contract verification`,
    );
    mutableWork.assertCanStart();
    result = await mutableWork.awaitOperation(
      callback(client),
      phase,
    );
  } catch (error) {
    primaryError = contextualError(
      `PostgreSQL integration client operation failed. phase=${phase}`,
      error,
    );
  }

  let closeError = null;
  try {
    await mutableWork.awaitOperation(
      supervisedClient.close(),
      `${phase} client close`,
    );
  } catch (error) {
    closeError = contextualError(
      `PostgreSQL integration client close failed. phase=${phase}`,
      error,
    );
  }
  const backgroundFailure = supervisedClient.backgroundFailure();
  supervisedClient.detach();
  mutableWork.complete();
  const failure = combineErrors(
    [
      ...(primaryError === null ? [] : [primaryError]),
      ...(backgroundFailure === null ? [] : [backgroundFailure]),
      ...(closeError === null ? [] : [closeError]),
    ],
    `PostgreSQL integration operation and client close failed. phase=${phase}`,
  );
  if (failure !== null) throw failure;
  return result;
}
