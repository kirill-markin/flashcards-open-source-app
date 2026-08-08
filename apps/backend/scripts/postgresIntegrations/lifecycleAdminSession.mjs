import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import {
  cleanupClientTeardownReserveMilliseconds,
  databaseTerminationPollMilliseconds,
  disposableDatabaseName,
  emergencyClientTeardownReserveMilliseconds,
  lifecycleLockKeys,
  managedRoleNames,
  postgresConnectionTimeoutMilliseconds,
} from "./boundaries.mjs";
import {
  cleanupOperationTimeoutError,
  cleanupRemainingMilliseconds,
  combineErrors,
  contextualError,
} from "./errors.mjs";
import { createPostgresClientOptions } from "./connection.mjs";
import {
  assertPostgresSessionContractState,
  createSupervisedPostgresClient,
  postgresSessionContractSql,
  requireCleanupSessionContract,
  requirePostgresSessionContract,
  runCleanupClientOperation,
  runCleanupQuery,
  runEmergencyClientOperation,
} from "./supervisedClient.mjs";
import {
  acquireLifecycleLock,
  inspectDatabaseIdentityForCleanup,
  reacquireLifecycleLockForCleanup,
  terminateDatabaseSessionsByOid,
} from "./identityGuards.mjs";

async function releaseLifecycleLock(cleanupSession, cleanupDeadline) {
  const result = await runCleanupQuery(
    cleanupSession,
    cleanupDeadline,
    "lifecycle lock release",
    `SELECT pg_catalog.pg_advisory_unlock($1::integer, $2::integer) AS released`,
    lifecycleLockKeys,
  );
  if (result.rows[0]?.released !== true) {
    throw new Error(
      "PostgreSQL integration lifecycle lock was not held by the administrative session during release.",
    );
  }
}

async function assertLifecycleLockHeld(cleanupSession, cleanupDeadline) {
  const result = await runCleanupQuery(
    cleanupSession,
    cleanupDeadline,
    "lifecycle lock verification",
    `SELECT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_locks
       WHERE
         locktype = 'advisory'
         AND pid = pg_catalog.pg_backend_pid()
         AND classid = $1::oid
         AND objid = $2::oid
         AND objsubid = 2
         AND granted
     ) AS held`,
    lifecycleLockKeys,
  );
  if (result.rows[0]?.held !== true) {
    throw new Error(
      "PostgreSQL integration administrative session no longer owns the lifecycle advisory lock.",
    );
  }
}


export function createLifecycleAdminSession(
  adminConnection,
  mutableWorkSupervisor,
) {
  let activeSession = null;
  let fatalBackgroundFailure = null;
  let terminalInterruptionPromise = null;
  const administrativeErrors = [];

  const recordBackgroundFailure = (session, failure) => {
    session.connected = false;
    session.lockHeld = false;
    if (session.closed) return;
    administrativeErrors.push(failure);
    if (fatalBackgroundFailure === null) {
      fatalBackgroundFailure = failure;
    }
    mutableWorkSupervisor.stopAll(failure);
  };

  const terminateTimedOutOperation = async (
    session,
    cleanupDeadline,
    phase,
  ) => {
    const targetClient = session.supervisedClient.client;
    const targetBackendPid = targetClient.processID;
    const targetClosePromise = session.supervisedClient.abort();
    targetClosePromise.catch(() => {});
    if (!Number.isInteger(targetBackendPid)) {
      await runEmergencyClientOperation(
        session.supervisedClient,
        cleanupDeadline,
        `${phase} client teardown before backend identity was available`,
        () => targetClosePromise,
      );
      return;
    }

    const remainingMilliseconds = cleanupRemainingMilliseconds(
      cleanupDeadline,
      `${phase} timed-out backend termination connection creation`,
    );
    if (remainingMilliseconds <= emergencyClientTeardownReserveMilliseconds) {
      throw cleanupOperationTimeoutError(
        cleanupDeadline,
        `${phase} timed-out backend termination connection creation`,
      );
    }
    const emergencyClient = createSupervisedPostgresClient(
      {
        ...createPostgresClientOptions(
          adminConnection,
          adminConnection.database,
          adminConnection.username,
          adminConnection.password,
          "postgres-integration-timeout-terminator",
        ),
        connectionTimeoutMillis:
          remainingMilliseconds - emergencyClientTeardownReserveMilliseconds,
        statement_timeout:
          remainingMilliseconds - emergencyClientTeardownReserveMilliseconds,
      },
      `${phase} timed-out backend termination`,
      null,
    );
    let primaryError = null;
    const finalizationErrors = [];
    try {
      await runEmergencyClientOperation(
        emergencyClient,
        cleanupDeadline,
        `${phase} timed-out backend termination connection establishment`,
        () => emergencyClient.client.connect(),
      );
      const sessionContractResult = await runEmergencyClientOperation(
        emergencyClient,
        cleanupDeadline,
        `${phase} timeout terminator session contract verification`,
        () => emergencyClient.client.query(postgresSessionContractSql),
      );
      assertPostgresSessionContractState(
        sessionContractResult.rows[0],
        adminConnection.database,
        `${phase} timeout terminator session contract verification`,
      );
      await runEmergencyClientOperation(
        emergencyClient,
        cleanupDeadline,
        `${phase} timed-out backend termination signal`,
        () => emergencyClient.client.query(
          "SELECT pg_catalog.pg_terminate_backend($1::integer, 0) AS terminated",
          [targetBackendPid],
        ),
      );

      while (true) {
        const targetResult = await runEmergencyClientOperation(
          emergencyClient,
          cleanupDeadline,
          `${phase} timed-out backend termination polling`,
          () => emergencyClient.client.query(
            `SELECT EXISTS (
               SELECT 1
               FROM pg_catalog.pg_stat_activity
               WHERE pid = $1::integer
             ) AS target_exists`,
            [targetBackendPid],
          ),
        );
        if (targetResult.rows[0]?.target_exists !== true) break;
        const pollRemainingMilliseconds = Math.floor(
          cleanupDeadline.expiresAt - performance.now(),
        );
        if (
          pollRemainingMilliseconds
          <= emergencyClientTeardownReserveMilliseconds
        ) {
          throw cleanupOperationTimeoutError(
            cleanupDeadline,
            `${phase} timed-out backend termination polling`,
          );
        }
        await delay(Math.min(
          databaseTerminationPollMilliseconds,
          pollRemainingMilliseconds
            - emergencyClientTeardownReserveMilliseconds,
        ));
      }
      await runEmergencyClientOperation(
        emergencyClient,
        cleanupDeadline,
        `${phase} timed-out client teardown completion`,
        () => targetClosePromise,
      );
    } catch (error) {
      primaryError = contextualError(
        `Failed to terminate and await a timed-out PostgreSQL cleanup backend. operationPhase=${phase} backendPid=${targetBackendPid}`,
        error,
      );
    }

    try {
      await runEmergencyClientOperation(
        emergencyClient,
        cleanupDeadline,
        `${phase} timeout terminator client close`,
        () => emergencyClient.close(),
      );
    } catch (error) {
      finalizationErrors.push(contextualError(
        `Failed to close the PostgreSQL timeout terminator client. operationPhase=${phase}`,
        error,
      ));
    }
    const backgroundFailure = emergencyClient.backgroundFailure();
    emergencyClient.detach();
    const failure = combineErrors(
      [
        ...(primaryError === null ? [] : [primaryError]),
        ...(backgroundFailure === null ? [] : [backgroundFailure]),
        ...finalizationErrors,
      ],
      `PostgreSQL timed-out cleanup backend termination and emergency client finalization failed. operationPhase=${phase} backendPid=${targetBackendPid}`,
    );
    if (failure !== null) throw failure;
  };

  const createSession = (phase, connectionTimeoutMilliseconds) => {
    const session = {
      closed: false,
      connectAttempted: false,
      connected: false,
      lockHeld: false,
      supervisedClient: null,
      terminateTimedOutOperation: null,
    };
    session.supervisedClient = createSupervisedPostgresClient(
      {
        ...createPostgresClientOptions(
          adminConnection,
          adminConnection.database,
          adminConnection.username,
          adminConnection.password,
          "postgres-integration-database-supervisor",
        ),
        connectionTimeoutMillis: connectionTimeoutMilliseconds,
      },
      phase,
      (failure) => recordBackgroundFailure(session, failure),
    );
    session.terminateTimedOutOperation = (
      cleanupDeadline,
      operationPhase,
    ) => terminateTimedOutOperation(
      session,
      cleanupDeadline,
      operationPhase,
    );
    activeSession = session;
    return session;
  };

  const connectSession = async (session) => {
    session.connectAttempted = true;
    await session.supervisedClient.client.connect();
    session.connected = true;
  };

  const closeSessionForCleanup = async (
    session,
    cleanupDeadline,
    phase,
  ) => {
    if (session.closed) return;
    let closeError = null;
    try {
      if (session.connectAttempted) {
        await runCleanupClientOperation(
          session,
          cleanupDeadline,
          phase,
          () => session.supervisedClient.close(),
        );
      }
    } catch (error) {
      closeError = contextualError(
        `Failed to close a supervised PostgreSQL administrative client. phase=${phase}`,
        error,
      );
    } finally {
      if (closeError !== null) {
        const abortPromise = session.supervisedClient.abort();
        abortPromise.catch((error) => {
          administrativeErrors.push(contextualError(
            `Failed to force-close a supervised PostgreSQL administrative client. phase=${phase}`,
            error,
          ));
        });
      }
      session.supervisedClient.detach();
      session.closed = true;
      session.connected = false;
      session.lockHeld = false;
    }
    if (closeError !== null) throw closeError;
  };

  const isSessionHealthy = (session) => (
    session !== null
    && !session.closed
    && session.connected
    && session.lockHeld
    && session.supervisedClient.backgroundFailure() === null
  );

  const startTerminalInterruption = (cleanupDeadline, failure) => {
    if (fatalBackgroundFailure === null) {
      fatalBackgroundFailure = failure;
    }
    mutableWorkSupervisor.stopAll(failure);
    const session = activeSession;
    if (
      terminalInterruptionPromise !== null
      || session === null
      || session.closed
      || !session.connectAttempted
    ) {
      return;
    }
    session.connected = false;
    session.lockHeld = false;
    terminalInterruptionPromise = terminateTimedOutOperation(
      session,
      cleanupDeadline,
      "signal-driven lifecycle administrative interruption",
    ).catch((error) => {
      administrativeErrors.push(contextualError(
        "Failed to terminate and await the lifecycle administrative backend after a signal.",
        error,
      ));
    });
  };

  const awaitTerminalInterruption = async () => {
    if (terminalInterruptionPromise === null) return;
    await terminalInterruptionPromise;
  };

  const requireClientForWork = (phase) => {
    if (fatalBackgroundFailure !== null) {
      throw contextualError(
        `Refusing to continue mutable PostgreSQL integration work after losing the lifecycle-lock session. phase=${phase}`,
        fatalBackgroundFailure,
      );
    }
    if (!isSessionHealthy(activeSession)) {
      throw new Error(
        `PostgreSQL integration lifecycle-lock session is not healthy. phase=${phase}`,
      );
    }
    return activeSession.supervisedClient.client;
  };

  return Object.freeze({
    async connectAndAcquire() {
      if (activeSession !== null) {
        throw new Error(
          "PostgreSQL integration lifecycle administrative session is already initialized.",
        );
      }
      const session = createSession(
        "lifecycle lock session",
        postgresConnectionTimeoutMilliseconds,
      );
      await mutableWorkSupervisor.awaitOperation(
        connectSession(session),
        "lifecycle lock connection establishment",
      );
      await mutableWorkSupervisor.awaitOperation(
        requirePostgresSessionContract(
          session.supervisedClient.client,
          adminConnection.database,
          "lifecycle lock session contract verification",
        ),
        "lifecycle lock session contract verification",
      );
      await mutableWorkSupervisor.awaitOperation(
        acquireLifecycleLock(session.supervisedClient.client),
        "lifecycle lock acquisition",
      );
      session.lockHeld = true;
    },
    errors() {
      return [
        ...administrativeErrors,
        ...mutableWorkSupervisor.errors(),
      ];
    },
    async finalize(cleanupDeadline) {
      await awaitTerminalInterruption();
      try {
        await mutableWorkSupervisor.waitForStopped(cleanupDeadline);
      } catch (error) {
        administrativeErrors.push(contextualError(
          "Failed to await mutable PostgreSQL integration work during lifecycle finalization.",
          error,
        ));
      }
      const session = activeSession;
      if (session === null) return;
      if (isSessionHealthy(session)) {
        try {
          await releaseLifecycleLock(session, cleanupDeadline);
          session.lockHeld = false;
        } catch (error) {
          administrativeErrors.push(contextualError(
            "Failed to release the PostgreSQL integration lifecycle lock.",
            error,
          ));
        }
      }
      try {
        await closeSessionForCleanup(
          session,
          cleanupDeadline,
          "lifecycle finalization",
        );
      } catch (error) {
        administrativeErrors.push(error);
      }
    },
    async getClientForCleanup(databaseOwnership, cleanupDeadline) {
      await awaitTerminalInterruption();
      await mutableWorkSupervisor.waitForStopped(cleanupDeadline);
      if (isSessionHealthy(activeSession)) {
        try {
          await assertLifecycleLockHeld(
            activeSession,
            cleanupDeadline,
          );
          return activeSession;
        } catch (error) {
          recordBackgroundFailure(
            activeSession,
            contextualError(
              "Failed to verify the PostgreSQL integration lifecycle lock before cleanup.",
              error,
            ),
          );
        }
      }
      if (activeSession !== null) {
        await closeSessionForCleanup(
          activeSession,
          cleanupDeadline,
          "before lifecycle cleanup recovery",
        );
      }
      const remainingMilliseconds = cleanupRemainingMilliseconds(
        cleanupDeadline,
        "lifecycle cleanup recovery connection creation",
      );
      if (remainingMilliseconds <= cleanupClientTeardownReserveMilliseconds) {
        throw cleanupOperationTimeoutError(
          cleanupDeadline,
          "lifecycle cleanup recovery connection creation",
        );
      }
      const recoverySession = createSession(
        "lifecycle cleanup recovery session",
        remainingMilliseconds - cleanupClientTeardownReserveMilliseconds,
      );
      try {
        await runCleanupClientOperation(
          recoverySession,
          cleanupDeadline,
          "lifecycle cleanup recovery connection establishment",
          () => connectSession(recoverySession),
        );
        await requireCleanupSessionContract(
          recoverySession,
          cleanupDeadline,
          adminConnection.database,
          "lifecycle cleanup recovery session contract verification",
        );
        if (databaseOwnership !== null) {
          const databaseIdentity = await inspectDatabaseIdentityForCleanup(
            recoverySession,
            cleanupDeadline,
            databaseOwnership.databaseOid,
            "pre-lock recovery database identity classification",
          );
          if (databaseIdentity.oidMatch !== null) {
            await terminateDatabaseSessionsByOid(
              recoverySession,
              cleanupDeadline,
              databaseOwnership.databaseOid,
              `before lifecycle-lock cleanup recovery ownershipState=${databaseOwnership.ownershipState} classification=${databaseIdentity.classification}`,
            );
          }
        }
        await reacquireLifecycleLockForCleanup(
          recoverySession,
          cleanupDeadline,
        );
        recoverySession.lockHeld = true;
        return recoverySession;
      } catch (error) {
        const recoveryError = contextualError(
          "Failed to establish an advisory-locked PostgreSQL administrative session for safe cleanup.",
          error,
        );
        administrativeErrors.push(recoveryError);
        let closeError = null;
        try {
          await closeSessionForCleanup(
            recoverySession,
            cleanupDeadline,
            "failed lifecycle cleanup recovery",
          );
        } catch (error) {
          closeError = error;
          administrativeErrors.push(error);
        }
        throw combineErrors(
          [
            recoveryError,
            ...(closeError === null ? [] : [closeError]),
          ],
          "PostgreSQL lifecycle cleanup recovery and client teardown failed.",
        );
      }
    },
    async runWork(phase, callback) {
      const client = requireClientForWork(phase);
      return mutableWorkSupervisor.awaitOperation(
        callback(client),
        phase,
      );
    },
    isCleanupClientHealthy() {
      return isSessionHealthy(activeSession);
    },
    startTerminalInterruption(cleanupDeadline, failure) {
      startTerminalInterruption(cleanupDeadline, failure);
    },
  });
}


async function inspectManagedClusterState(adminClient) {
  const result = await adminClient.query(
    `SELECT
       EXISTS (
         SELECT 1 FROM pg_catalog.pg_database WHERE datname = $1
       ) AS database_exists,
       COALESCE(
         array_agg(roles.rolname::text ORDER BY roles.rolname)
           FILTER (WHERE roles.rolname IS NOT NULL),
         ARRAY[]::text[]
       ) AS existing_roles
     FROM (SELECT 1) AS singleton
     LEFT JOIN pg_catalog.pg_roles AS roles
       ON roles.rolname = ANY($2::text[])`,
    [disposableDatabaseName, managedRoleNames],
  );
  const state = result.rows[0];
  if (state === undefined) {
    throw new Error(
      "PostgreSQL integration could not inspect disposable database and managed role state.",
    );
  }
  return state;
}

export async function assertManagedClusterStateAbsent(adminClient, phase) {
  const state = await inspectManagedClusterState(adminClient);
  if (state.database_exists === true || state.existing_roles.length > 0) {
    throw new Error(
      `Refusing to mutate a non-isolated PostgreSQL cluster. phase=${phase} database=${disposableDatabaseName} databaseExists=${state.database_exists} existingManagedRoles=${JSON.stringify(state.existing_roles)}`,
    );
  }
}

export async function preflightAdministrativeCluster(
  adminClient,
  adminConnection,
  signalSupervisor,
) {
  const capabilities = await adminClient.query(`
    SELECT
      current_setting('server_version_num')::int / 10000 AS major,
      current_database() AS database_name,
      current_user AS role_name,
      roles.rolsuper
    FROM pg_catalog.pg_roles AS roles
    WHERE roles.rolname = current_user
  `);
  const capability = capabilities.rows[0];
  if (capability === undefined) {
    throw new Error(
      "PostgreSQL integration could not inspect the administrative role capabilities.",
    );
  }
  if (capability.major !== 18) {
    throw new Error(
      `PostgreSQL integration gate requires PostgreSQL 18. actualMajor=${capability.major}`,
    );
  }
  if (capability.database_name === disposableDatabaseName) {
    throw new Error(
      `PostgreSQL integration administrative connection targets the disposable database. database=${capability.database_name}`,
    );
  }
  if (capability.rolsuper !== true) {
    throw new Error(
      `PostgreSQL integration administrative role must be a superuser for deterministic isolated-cluster cleanup. role=${capability.role_name} requiredAttribute=SUPERUSER`,
    );
  }
  if (capability.database_name !== adminConnection.database) {
    throw new Error(
      `POSTGRES_INTEGRATION_ADMIN_URL resolved to an unexpected database. configuredDatabase=${adminConnection.database} actualDatabase=${capability.database_name}`,
    );
  }

  await assertManagedClusterStateAbsent(
    adminClient,
    "administrative preflight",
  );
  signalSupervisor.throwIfSignaled("administrative preflight");
  return new Set(managedRoleNames);
}

