import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";
import type { DeckRow } from "../../decks";
import type { ParsedSqlStatement } from "../sqlDialect";
import type { AgentToolOperationDependencies } from "./operations";
import type { AgentSqlContext, AgentSqlMutationStatement } from "./shared";

type QueryRecord = Readonly<{
  text: string;
  params: ReadonlyArray<unknown> | null;
}>;

function createQueryResult<Row extends pg.QueryResultRow>(rows: ReadonlyArray<Row>): pg.QueryResult<Row> {
  return {
    command: "SELECT",
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows: [...rows],
  };
}

function createDeckRow(
  deckId: string,
  name: string,
  tags: ReadonlyArray<string>,
  clientUpdatedAt: string,
  lastModifiedByReplicaId: string,
  lastOperationId: string,
): DeckRow {
  return {
    deck_id: deckId,
    workspace_id: "workspace-1",
    name,
    filter_definition: {
      version: 2,
      tags,
    },
    created_at: "2026-02-28T09:00:00.000Z",
    client_updated_at: clientUpdatedAt,
    last_modified_by_replica_id: lastModifiedByReplicaId,
    last_operation_id: lastOperationId,
    updated_at: clientUpdatedAt,
    deleted_at: null,
  };
}

function unusedDependency(name: string): never {
  throw new Error(`${name} should not run`);
}

function createAgentToolDependencies(): AgentToolOperationDependencies {
  return {
    createCards: async () => unusedDependency("createCards"),
    deleteCards: async () => unusedDependency("deleteCards"),
    getCards: async () => unusedDependency("getCards"),
    listReviewHistoryPage: async () => unusedDependency("listReviewHistoryPage"),
    queryCardsPage: async () => unusedDependency("queryCardsPage"),
    updateCards: async () => unusedDependency("updateCards"),
    ensureAgentSyncReplica: async () => "replica-agent-1",
    createDecks: async () => unusedDependency("createDecks"),
    deleteDecks: async () => unusedDependency("deleteDecks"),
    getDecks: async () => unusedDependency("getDecks"),
    listDecksPage: async () => unusedDependency("listDecksPage"),
    searchDecksPage: async () => unusedDependency("searchDecksPage"),
    updateDecks: async () => unusedDependency("updateDecks"),
    getWorkspaceSchedulerSettings: async () => unusedDependency("getWorkspaceSchedulerSettings"),
    listUserWorkspacesForSelectedWorkspace: async () => unusedDependency("listUserWorkspacesForSelectedWorkspace"),
  };
}

function getDeckRow(deckRows: Map<string, DeckRow>, deckId: string): DeckRow {
  const row = deckRows.get(deckId);
  if (row === undefined) {
    throw new Error(`Unexpected deck lookup: ${deckId}`);
  }

  return row;
}

function parseMutationStatements(
  statements: ReadonlyArray<ParsedSqlStatement>,
  isMutationStatement: (statement: ParsedSqlStatement) => statement is AgentSqlMutationStatement,
): ReadonlyArray<AgentSqlMutationStatement> {
  const mutationStatements = statements.filter(isMutationStatement);
  assert.equal(mutationStatements.length, statements.length);
  return mutationStatements;
}

test("executeSqlMutationBatch appends legacy deck effort tags after final tags assignment", async () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalDbSecretArn = process.env.DB_SECRET_ARN;
  const originalPool = pg.Pool;
  const queries: Array<QueryRecord> = [];
  const deckRows = new Map<string, DeckRow>([
    [
      "deck-effort-first",
      createDeckRow(
        "deck-effort-first",
        "Effort first",
        ["existing"],
        "2026-02-28T09:00:00.000Z",
        "replica-old",
        "operation-old-1",
      ),
    ],
    [
      "deck-tags-first",
      createDeckRow(
        "deck-tags-first",
        "Tags first",
        ["existing"],
        "2026-02-28T09:00:00.000Z",
        "replica-old",
        "operation-old-2",
      ),
    ],
  ]);
  let nextChangeId = 1;

  const fakeClient = {
    async query<Row extends pg.QueryResultRow>(
      text: string,
      params?: ReadonlyArray<unknown>,
    ): Promise<pg.QueryResult<Row>> {
      queries.push({
        text,
        params: params ?? null,
      });

      if (text === "BEGIN" || text === "COMMIT" || text === "ROLLBACK") {
        return createQueryResult<Row>([]);
      }

      if (text.includes("set_config('app.user_id'")) {
        return createQueryResult<Row>([]);
      }

      if (text.includes("FROM content.cards")) {
        return createQueryResult<Row>([]);
      }

      if (
        text.includes("FROM content.decks")
        && text.includes("ORDER BY created_at DESC, deck_id DESC")
        && params?.length === 1
      ) {
        return createQueryResult([...deckRows.values()] as ReadonlyArray<unknown> as ReadonlyArray<Row>);
      }

      if (text.includes("FROM content.decks") && params?.length === 2) {
        const deckId = params[1];
        if (typeof deckId !== "string") {
          throw new Error("Deck lookup id must be a string");
        }

        return createQueryResult([getDeckRow(deckRows, deckId) as unknown as Row]);
      }

      if (text.includes("UPDATE content.decks")) {
        if (params === undefined) {
          throw new Error("Deck update params are required");
        }

        const deckId = params[8];
        if (typeof deckId !== "string") {
          throw new Error("Deck update id must be a string");
        }

        const filterDefinitionText = params?.[1];
        if (typeof filterDefinitionText !== "string") {
          throw new Error("Deck update filter definition must be serialized JSON");
        }

        const name = params[0];
        const clientUpdatedAt = params[4];
        const lastModifiedByReplicaId = params[5];
        const lastOperationId = params[6];
        if (
          typeof name !== "string"
          || typeof clientUpdatedAt !== "string"
          || typeof lastModifiedByReplicaId !== "string"
          || typeof lastOperationId !== "string"
        ) {
          throw new Error("Deck update metadata must contain strings");
        }

        const filterDefinition = JSON.parse(filterDefinitionText) as Readonly<{
          version: 2;
          tags: ReadonlyArray<string>;
        }>;
        const updatedRow = createDeckRow(
          deckId,
          name,
          filterDefinition.tags,
          clientUpdatedAt,
          lastModifiedByReplicaId,
          lastOperationId,
        );
        deckRows.set(deckId, updatedRow);
        return createQueryResult([updatedRow as unknown as Row]);
      }

      if (text.includes("INSERT INTO sync.workspace_sync_metadata")) {
        return createQueryResult<Row>([]);
      }

      if (text.includes("INSERT INTO sync.hot_changes")) {
        const row = {
          change_id: nextChangeId,
        };
        nextChangeId += 1;
        return createQueryResult([row as unknown as Row]);
      }

      throw new Error(`Unexpected query: ${text}`);
    },
    release(): void {},
  };

  class FakePool {
    constructor(_config: pg.PoolConfig) {}

    on(_event: string, _listener: (error: Error) => void): void {}

    async connect(): Promise<pg.PoolClient> {
      return fakeClient as unknown as pg.PoolClient;
    }
  }

  process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/test";
  delete process.env.DB_SECRET_ARN;
  (pg as unknown as { Pool: typeof pg.Pool }).Pool = FakePool as unknown as typeof pg.Pool;

  try {
    const { executeSqlMutationBatch } = await import("./batchMutation");
    const { parseSqlStatement, splitSqlStatements } = await import("../sqlDialect");
    const { isSqlMutationStatement } = await import("./shared");
    const sql = [
      "UPDATE decks SET effort_levels = ('long'), tags = ('foo') WHERE deck_id = 'deck-effort-first'",
      "UPDATE decks SET tags = ('bar'), effort_levels = ('medium') WHERE deck_id = 'deck-tags-first'",
    ].join("; ");
    const statementSqls = splitSqlStatements(sql);
    const statements = parseMutationStatements(
      statementSqls.map((statementSql) => parseSqlStatement(statementSql)),
      isSqlMutationStatement,
    );
    const context: AgentSqlContext = {
      workspaceId: "workspace-1",
      userId: "user-1",
      selectedWorkspaceId: null,
      connectionId: "connection-1",
    };

    await executeSqlMutationBatch(
      createAgentToolDependencies(),
      context,
      sql,
      statements,
      statementSqls,
    );

    assert.deepEqual(getDeckRow(deckRows, "deck-effort-first").filter_definition, {
      version: 2,
      tags: ["foo", "long"],
    });
    assert.deepEqual(getDeckRow(deckRows, "deck-tags-first").filter_definition, {
      version: 2,
      tags: ["bar", "medium"],
    });
    assert.equal(queries.some((query) => query.text.includes("UPDATE content.decks")), true);
  } finally {
    (pg as unknown as { Pool: typeof pg.Pool }).Pool = originalPool;
    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalDatabaseUrl;
    }

    if (originalDbSecretArn === undefined) {
      delete process.env.DB_SECRET_ARN;
    } else {
      process.env.DB_SECRET_ARN = originalDbSecretArn;
    }
  }
});
