import {
  backendRolePassword,
  boundaryDefinitions,
  disposableDatabaseName,
} from "./postgresIntegrations/boundaries.mjs";
import {
  asError,
  combineErrors,
  contextualError,
  createTerminalCleanupController,
} from "./postgresIntegrations/errors.mjs";
import {
  createDatabaseUrl,
  requireAdminDatabaseConnection,
} from "./postgresIntegrations/connection.mjs";
import {
  createMutableWorkSupervisor,
} from "./postgresIntegrations/supervisedClient.mjs";
import {
  assertManagedClusterStateAbsent,
  createLifecycleAdminSession,
  preflightAdministrativeCluster,
} from "./postgresIntegrations/lifecycleAdminSession.mjs";
import {
  applyMigrationBoundary,
  assertOwnedRole,
  listMigrationFiles,
} from "./postgresIntegrations/migrations.mjs";
import { runNodeTests } from "./postgresIntegrations/nodeTestChild.mjs";
import {
  cleanupBoundaryStateWithRecovery,
  createDisposableDatabase,
  requireOwnedDatabaseIdentityForWork,
  requireOwnedDatabaseOidForWork,
} from "./postgresIntegrations/cleanup.mjs";

function createSignalInterruptionError(signal, phase) {
  const error = new Error(
    `PostgreSQL integration interrupted by signal. signal=${signal} phase=${phase}`,
  );
  error.name = "PostgresIntegrationSignalError";
  return error;
}

function createSignalSupervisor(handleFirstSignal) {
  let firstSignal = null;
  let activeChild = null;
  let installed = false;

  const terminateActiveChild = (signal) => {
    if (
      activeChild !== null
      && activeChild.exitCode === null
      && activeChild.signalCode === null
    ) {
      activeChild.kill(signal);
    }
  };
  const handleSignal = (signal) => {
    if (firstSignal === null) {
      firstSignal = signal;
      handleFirstSignal(
        signal,
        createSignalInterruptionError(signal, "signal handler"),
      );
    }
    terminateActiveChild(firstSignal);
  };
  const handleSigint = () => handleSignal("SIGINT");
  const handleSigterm = () => handleSignal("SIGTERM");

  return Object.freeze({
    install() {
      if (installed) {
        throw new Error("PostgreSQL integration signal handlers are already installed.");
      }
      process.on("SIGINT", handleSigint);
      process.on("SIGTERM", handleSigterm);
      installed = true;
    },
    uninstall() {
      if (!installed) return;
      process.off("SIGINT", handleSigint);
      process.off("SIGTERM", handleSigterm);
      installed = false;
    },
    firstSignal() {
      return firstSignal;
    },
    throwIfSignaled(phase) {
      if (firstSignal === null) return;
      throw createSignalInterruptionError(firstSignal, phase);
    },
    setActiveChild(child) {
      if (activeChild !== null) {
        throw new Error("A PostgreSQL integration child process is already active.");
      }
      activeChild = child;
      if (
        firstSignal !== null
        && child.exitCode === null
        && child.signalCode === null
      ) {
        child.kill(firstSignal);
      }
    },
    clearActiveChild(child) {
      if (activeChild === child) activeChild = null;
    },
  });
}


async function runBoundary(
  lifecycleAdminSession,
  adminConnection,
  boundaryDefinition,
  initiallyAbsentRoleNames,
  signalSupervisor,
  mutableWorkSupervisor,
  terminalCleanupController,
  isFinalBoundary,
) {
  const migrationFiles = await listMigrationFiles(
    boundaryDefinition.migrationFileName,
    boundaryDefinition.expectedMigrationCount,
  );
  const boundaryState = {
    initiallyAbsentRoleNames,
    ownedDatabaseOid: null,
    ownedRoleOids: new Map(),
    pendingDatabaseOid: null,
  };
  let primaryError = null;
  let phase = "database creation";
  try {
    signalSupervisor.throwIfSignaled(
      `before boundary ${boundaryDefinition.migrationFileName}`,
    );
    const isolationPhase =
      `before boundary ${boundaryDefinition.migrationFileName}`;
    await lifecycleAdminSession.runWork(
      isolationPhase,
      (adminClient) => assertManagedClusterStateAbsent(
        adminClient,
        isolationPhase,
      ),
    );
    signalSupervisor.throwIfSignaled(
      `after isolation check for ${boundaryDefinition.migrationFileName}`,
    );
    const databaseCreationPhase =
      `database creation for ${boundaryDefinition.migrationFileName}`;
    await lifecycleAdminSession.runWork(
      databaseCreationPhase,
      (adminClient) => createDisposableDatabase(
        adminClient,
        boundaryState,
      ),
    );
    const databaseCreationVerificationPhase =
      `after database creation for ${boundaryDefinition.migrationFileName}`;
    await lifecycleAdminSession.runWork(
      databaseCreationVerificationPhase,
      (adminClient) => requireOwnedDatabaseIdentityForWork(
        adminClient,
        boundaryState,
        databaseCreationVerificationPhase,
      ),
    );
    signalSupervisor.throwIfSignaled(
      `after database creation for ${boundaryDefinition.migrationFileName}`,
    );
    const ownerDatabaseUrl = createDatabaseUrl(
      adminConnection,
      disposableDatabaseName,
      adminConnection.username,
      adminConnection.password,
    );
    phase = "migration boundary setup";
    await applyMigrationBoundary(
      adminConnection,
      migrationFiles,
      boundaryDefinition,
      boundaryState,
      lifecycleAdminSession,
      signalSupervisor,
      mutableWorkSupervisor,
    );
    const runtimeDatabaseUrl = createDatabaseUrl(
      adminConnection,
      disposableDatabaseName,
      "backend_app",
      backendRolePassword,
    );
    phase = "integration test child";
    const childVerificationPhase =
      `before integration test child for ${boundaryDefinition.migrationFileName}`;
    await lifecycleAdminSession.runWork(
      childVerificationPhase,
      async (adminClient) => {
        await requireOwnedDatabaseIdentityForWork(
          adminClient,
          boundaryState,
          childVerificationPhase,
        );
        await assertOwnedRole(
          adminClient,
          "backend_app",
          boundaryState,
        );
      },
    );
    const expectedDatabaseOid = requireOwnedDatabaseOidForWork(
      boundaryState,
      `before integration test child for ${boundaryDefinition.migrationFileName}`,
    );
    await runNodeTests(
      boundaryDefinition.testFiles,
      runtimeDatabaseUrl,
      ownerDatabaseUrl,
      expectedDatabaseOid,
      signalSupervisor,
      mutableWorkSupervisor,
    );
    await lifecycleAdminSession.runWork(
      `after integration test child for ${boundaryDefinition.migrationFileName}`,
      () => undefined,
    );
  } catch (error) {
    primaryError = contextualError(
      `PostgreSQL integration boundary failed. boundary=${boundaryDefinition.migrationFileName} phase=${phase}`,
      error,
    );
  }

  const cleanupDeadline = terminalCleanupController.begin(
    `boundary cleanup boundary=${boundaryDefinition.migrationFileName}`,
  );
  const cleanupErrors = await cleanupBoundaryStateWithRecovery(
    lifecycleAdminSession,
    boundaryState,
    boundaryDefinition.migrationFileName,
    cleanupDeadline,
  );
  const failure = combineErrors(
    [
      ...(primaryError === null ? [] : [primaryError]),
      ...cleanupErrors,
    ],
    `PostgreSQL integration phase and cleanup failed. boundary=${boundaryDefinition.migrationFileName}`,
  );
  if (failure !== null) throw failure;
  if (!isFinalBoundary && signalSupervisor.firstSignal() === null) {
    terminalCleanupController.clearCompletedBoundary(cleanupDeadline);
  }
}

const adminConnection = requireAdminDatabaseConnection();
const terminalCleanupController = createTerminalCleanupController();
const mutableWorkSupervisor = createMutableWorkSupervisor();
const lifecycleAdminSession = createLifecycleAdminSession(
  adminConnection,
  mutableWorkSupervisor,
);
const signalSupervisor = createSignalSupervisor((signal, failure) => {
  const cleanupDeadline = terminalCleanupController.begin(
    `signal-driven terminal cleanup signal=${signal}`,
  );
  mutableWorkSupervisor.stopAll(failure);
  lifecycleAdminSession.startTerminalInterruption(
    cleanupDeadline,
    failure,
  );
});
signalSupervisor.install();

let runError = null;
try {
  signalSupervisor.throwIfSignaled("before lifecycle lock connection");
  await lifecycleAdminSession.connectAndAcquire();
  signalSupervisor.throwIfSignaled("lifecycle lock acquisition");
  const initiallyAbsentRoleNames = await lifecycleAdminSession.runWork(
    "administrative preflight",
    (adminClient) => preflightAdministrativeCluster(
      adminClient,
      adminConnection,
      signalSupervisor,
    ),
  );
  for (
    let boundaryIndex = 0;
    boundaryIndex < boundaryDefinitions.length;
    boundaryIndex += 1
  ) {
    const boundaryDefinition = boundaryDefinitions[boundaryIndex];
    await runBoundary(
      lifecycleAdminSession,
      adminConnection,
      boundaryDefinition,
      initiallyAbsentRoleNames,
      signalSupervisor,
      mutableWorkSupervisor,
      terminalCleanupController,
      boundaryIndex === boundaryDefinitions.length - 1,
    );
  }
} catch (error) {
  runError = asError(error);
}

const finalCleanupDeadline = terminalCleanupController.begin(
  "lifecycle administrative finalization",
);
await lifecycleAdminSession.finalize(finalCleanupDeadline);
runError = combineErrors(
  [
    ...(runError === null ? [] : [runError]),
    ...lifecycleAdminSession.errors(),
  ],
  "PostgreSQL integration lifecycle and administrative cleanup failed.",
);

const interruptedBySignal = signalSupervisor.firstSignal();
signalSupervisor.uninstall();
if (interruptedBySignal !== null) {
  if (runError !== null) console.error(runError);
  process.kill(process.pid, interruptedBySignal);
} else if (runError !== null) {
  throw runError;
}
