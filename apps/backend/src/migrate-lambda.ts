import type { Handler } from "aws-lambda";
import {
  captureBackendException,
  createBackendObservationScope,
  initializeBackendSentry,
  normalizeCaughtError,
  type MigrationFailureDetails,
  wrapBackendHandler,
} from "./observability/sentry";

initializeBackendSentry("migration");

type MigrationRuntime = Readonly<{
  runMigrations: typeof import("./migrationRunner").runMigrations;
}>;

type MigrationLambdaRuntimeRoleResult = Readonly<{
  roleName: string;
  configured: boolean;
}>;

type MigrationLambdaResult = Readonly<{
  appliedMigrations: ReadonlyArray<string>;
  appliedViews: ReadonlyArray<string>;
  configuredRuntimeRoles: ReadonlyArray<MigrationLambdaRuntimeRoleResult>;
}>;

let migrationRuntimePromise: Promise<MigrationRuntime> | null = null;

async function createMigrationRuntime(): Promise<MigrationRuntime> {
  const { runMigrations } = await import("./migrationRunner");
  return {
    runMigrations,
  };
}

function getMigrationRuntime(): Promise<MigrationRuntime> {
  if (migrationRuntimePromise === null) {
    migrationRuntimePromise = createMigrationRuntime();
  }

  return migrationRuntimePromise;
}

function createMigrationFailureDetails(error: Error): MigrationFailureDetails {
  return {
    migrationSurface: "lambda",
    operation: "run_migrations",
    message: error.message,
  };
}

const migrationHandler: Handler<unknown, MigrationLambdaResult> = async (_event, context) => {
  try {
    const runtime = await getMigrationRuntime();
    const result = await runtime.runMigrations();
    return result;
  } catch (error) {
    const normalizedError = normalizeCaughtError(error);
    captureBackendException({
      action: "migration_failed",
      error: normalizedError,
      scope: createBackendObservationScope(
        "migration",
        context.awsRequestId ?? null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
      ),
      details: createMigrationFailureDetails(normalizedError),
    });
    throw error;
  }
};

export const handler = wrapBackendHandler(migrationHandler);
