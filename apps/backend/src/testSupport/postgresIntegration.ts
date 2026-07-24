import { randomUUID } from "node:crypto";
import pg from "pg";

export type PostgresIntegrationFixture = Readonly<{
  runtimePool: pg.Pool;
  ownerPool: pg.Pool;
  userId: string;
  workspaceId: string;
  outOfScopeWorkspaceId: string;
  replicaId: string;
  cardId: string;
  mediaAssetId: string;
  operationId: string;
  retryOperationId: string;
  concurrentOperationId: string;
  createdAt: string;
}>;

type RemainingFixtureRows = Readonly<{ remaining: boolean }>;

function requireDatabaseUrl(environmentVariable: "DATABASE_URL" | "TEST_DATABASE_ADMIN_URL"): string {
  const databaseUrl = process.env[environmentVariable]?.trim();
  if (databaseUrl === undefined || databaseUrl === "") {
    throw new Error(
      `${environmentVariable} is required for the PostgreSQL integration test and must be a PostgreSQL connection URL.`,
    );
  }

  return databaseUrl;
}

function createFixtureIds(): Omit<PostgresIntegrationFixture, "runtimePool" | "ownerPool" | "createdAt"> {
  const operationNamespace = randomUUID();
  return {
    userId: `postgres-integration-${randomUUID()}`,
    workspaceId: randomUUID(),
    outOfScopeWorkspaceId: randomUUID(),
    replicaId: randomUUID(),
    cardId: randomUUID(),
    mediaAssetId: randomUUID(),
    operationId: `postgres-integration-append-${operationNamespace}`,
    retryOperationId: `postgres-integration-append-retry-${operationNamespace}`,
    concurrentOperationId: `postgres-integration-concurrent-edit-${operationNamespace}`,
  };
}

async function createFixtureRows(fixture: PostgresIntegrationFixture): Promise<void> {
  const ownerClient = await fixture.ownerPool.connect();
  try {
    await ownerClient.query("BEGIN");
    await ownerClient.query("INSERT INTO org.user_settings (user_id) VALUES ($1)", [fixture.userId]);
    await ownerClient.query(
      [
        "INSERT INTO org.workspaces (",
        "workspace_id, name, fsrs_client_updated_at, fsrs_last_modified_by_replica_id, fsrs_last_operation_id",
        ") VALUES ($1, $2, $3, $4, $5)",
      ].join(" "),
      [
        fixture.workspaceId,
        "Generated image append integration",
        fixture.createdAt,
        fixture.replicaId,
        `postgres-integration-workspace-${fixture.workspaceId}`,
      ],
    );
    await ownerClient.query(
      "INSERT INTO org.workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, 'owner')",
      [fixture.workspaceId, fixture.userId],
    );
    await ownerClient.query(
      [
        "INSERT INTO sync.workspace_replicas (",
        "replica_id, workspace_id, user_id, actor_kind, installation_id, actor_key, platform, app_version",
        ") VALUES ($1, $2, $3, 'ai_chat', NULL, $4, 'system', $5)",
      ].join(" "),
      [
        fixture.replicaId,
        fixture.workspaceId,
        fixture.userId,
        `postgres-integration-${fixture.replicaId}`,
        "postgres-integration",
      ],
    );
    await ownerClient.query(
      [
        "INSERT INTO content.cards (",
        "card_id, workspace_id, front_text, back_text, card_type, metadata, tags, effort_level, due_at, created_at,",
        "reps, lapses, fsrs_card_state, fsrs_step_index, fsrs_stability, fsrs_difficulty, fsrs_last_reviewed_at, fsrs_scheduled_days,",
        "client_updated_at, last_modified_by_replica_id, last_operation_id",
        ") VALUES ($1, $2, $3, $4, 'basic', $5::jsonb, '{}', 'fast', NULL, $6, 0, 0, 'new', NULL, NULL, NULL, NULL, NULL, $7, $8, $9)",
      ].join(" "),
      [
        fixture.cardId,
        fixture.workspaceId,
        "Original question",
        "Original answer",
        JSON.stringify({ version: 1, source: null }),
        fixture.createdAt,
        fixture.createdAt,
        fixture.replicaId,
        `postgres-integration-card-${fixture.cardId}`,
      ],
    );
    await ownerClient.query("COMMIT");
  } catch (error) {
    await ownerClient.query("ROLLBACK");
    throw error;
  } finally {
    ownerClient.release();
  }
}

async function deleteAndVerifyFixtureRows(fixture: PostgresIntegrationFixture): Promise<void> {
  const ownerClient = await fixture.ownerPool.connect();
  try {
    await ownerClient.query("BEGIN");
    await ownerClient.query("DELETE FROM org.workspaces WHERE workspace_id = $1", [fixture.workspaceId]);
    await ownerClient.query("DELETE FROM org.user_settings WHERE user_id = $1", [fixture.userId]);
    const verification = await ownerClient.query<RemainingFixtureRows>([
      "SELECT EXISTS (SELECT 1 FROM org.workspaces WHERE workspace_id = $1)",
      "OR EXISTS (SELECT 1 FROM org.user_settings WHERE user_id = $2)",
      "OR EXISTS (SELECT 1 FROM sync.workspace_replicas WHERE replica_id = $3)",
      "OR EXISTS (SELECT 1 FROM content.cards WHERE card_id = $4)",
      "OR EXISTS (SELECT 1 FROM sync.hot_changes WHERE workspace_id = $1) AS remaining",
    ].join(" "),
      [fixture.workspaceId, fixture.userId, fixture.replicaId, fixture.cardId],
    );
    if (verification.rows[0]?.remaining !== false) {
      throw new Error(
        `PostgreSQL integration cleanup left fixture rows. workspaceId=${fixture.workspaceId}; cardId=${fixture.cardId}`,
      );
    }
    await ownerClient.query("COMMIT");
  } catch (error) {
    await ownerClient.query("ROLLBACK");
    throw error;
  } finally {
    ownerClient.release();
  }
}

async function closeFixturePools(fixture: PostgresIntegrationFixture): Promise<void> {
  const closeResults = await Promise.allSettled([fixture.runtimePool.end(), fixture.ownerPool.end()]);
  const closeErrors = closeResults.flatMap((result) => (
    result.status === "rejected" ? [result.reason as unknown] : []
  ));
  if (closeErrors.length > 0) {
    throw new AggregateError(closeErrors, "Failed to close PostgreSQL integration pools.");
  }
}

export async function withPostgresIntegrationFixture<Result>(
  callback: (fixture: PostgresIntegrationFixture) => Promise<Result>,
): Promise<Result> {
  const fixtureIds = createFixtureIds();
  const fixture: PostgresIntegrationFixture = {
    runtimePool: new pg.Pool({
      connectionString: requireDatabaseUrl("DATABASE_URL"),
      application_name: "generated-image-append-integration-runtime",
    }),
    ownerPool: new pg.Pool({
      connectionString: requireDatabaseUrl("TEST_DATABASE_ADMIN_URL"),
      application_name: "generated-image-append-integration-owner",
    }),
    ...fixtureIds,
    createdAt: new Date().toISOString(),
  };

  let result!: Result;
  const errors: Array<unknown> = [];
  try {
    await createFixtureRows(fixture);
    result = await callback(fixture);
  } catch (error) {
    errors.push(error);
  } finally {
    try {
      await deleteAndVerifyFixtureRows(fixture);
    } catch (error) {
      errors.push(error);
    }
    try {
      await closeFixturePools(fixture);
    } catch (error) {
      errors.push(error);
    }
  }

  if (errors.length === 1) {
    throw errors[0];
  }
  if (errors.length > 1) {
    throw new AggregateError(errors, "PostgreSQL integration or fixture cleanup failed.");
  }

  return result;
}
