import type { Handler } from "aws-lambda";
import {
  captureBackendException,
  createBackendObservationScope,
  initializeBackendSentry,
  normalizeCaughtError,
  type MigrationFailureDetails,
  wrapBackendHandler,
} from "../observability/sentry";

initializeBackendSentry("migration");

type MigrationRuntime = Readonly<{
  runMigrations: typeof import("../database/migrationRunner").runMigrations;
}>;

type MigrationLambdaRuntimeRoleResult = Readonly<{
  roleName: string;
  configured: boolean;
}>;

type MigrationLambdaResult = Readonly<{
  appliedMigrations: ReadonlyArray<string>;
  installedMigrations: ReadonlyArray<string>;
  appliedViews: ReadonlyArray<string>;
  configuredRuntimeRoles: ReadonlyArray<MigrationLambdaRuntimeRoleResult>;
}>;

type MigrationCustomResourceResult = MigrationLambdaResult & Readonly<{
  PhysicalResourceId: string;
}>;

type MigrationCustomResourceDeleteResult = Readonly<{
  PhysicalResourceId: string;
}>;

type MigrationInvocation =
  | Readonly<{ kind: "direct" }>
  | Readonly<{ kind: "delete" }>
  | Readonly<{ kind: "provision"; requiredMigration: string }>;

const migrationCustomResourcePhysicalId = "flashcards-database-migrations";

let migrationRuntimePromise: Promise<MigrationRuntime> | null = null;

async function createMigrationRuntime(): Promise<MigrationRuntime> {
  const { runMigrations } = await import("../database/migrationRunner");
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

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && Array.isArray(value) === false;
}

export function parseMigrationInvocation(event: unknown): MigrationInvocation {
  if (!isRecord(event) || !("RequestType" in event)) {
    return { kind: "direct" };
  }

  const requestType = event.RequestType;
  if (requestType === "Delete") {
    return { kind: "delete" };
  }
  if (requestType !== "Create" && requestType !== "Update") {
    throw new TypeError(`Migration custom resource RequestType is invalid. requestType=${String(requestType)}`);
  }

  const resourceProperties = event.ResourceProperties;
  if (!isRecord(resourceProperties)) {
    throw new TypeError("Migration custom resource ResourceProperties must be an object");
  }
  const requiredMigration = resourceProperties.RequiredMigration;
  if (typeof requiredMigration !== "string" || requiredMigration.trim() === "") {
    throw new TypeError("Migration custom resource RequiredMigration must be a non-empty string");
  }

  return { kind: "provision", requiredMigration };
}

function assertRequiredMigrationInstalled(
  installedMigrations: ReadonlyArray<string>,
  requiredMigration: string,
): void {
  if (!installedMigrations.includes(requiredMigration)) {
    throw new Error(`Required migration was not installed. requiredMigration=${requiredMigration}`);
  }
}

type MigrationLambdaResponse =
  | MigrationLambdaResult
  | MigrationCustomResourceResult
  | MigrationCustomResourceDeleteResult;

const migrationHandler: Handler<unknown, MigrationLambdaResponse> = async (event, context) => {
  try {
    const invocation = parseMigrationInvocation(event);
    if (invocation.kind === "delete") {
      return { PhysicalResourceId: migrationCustomResourcePhysicalId };
    }

    const runtime = await getMigrationRuntime();
    const result = await runtime.runMigrations();
    if (invocation.kind === "direct") {
      return result;
    }

    assertRequiredMigrationInstalled(result.installedMigrations, invocation.requiredMigration);
    return {
      ...result,
      PhysicalResourceId: migrationCustomResourcePhysicalId,
    };
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
        null,
        null,
      ),
      details: createMigrationFailureDetails(normalizedError),
    });
    throw error;
  }
};

export const handler = wrapBackendHandler(migrationHandler);
