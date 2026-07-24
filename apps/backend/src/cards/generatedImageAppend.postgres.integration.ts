import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";
import type { DatabaseExecutor, SqlValue } from "../database";
import { HttpError } from "../shared/errors";
import { type PostgresIntegrationFixture, withPostgresIntegrationFixture } from "../testSupport/postgresIntegration";
import { appendManagedImageToCardSideInExecutor } from "./index";
import type { AppendManagedImageToCardSideInput, AppendManagedImageToCardSideResult } from "./types";

const futureClientUpdatedAt = "2099-01-01T00:00:00.000Z";
const expectedGeneratedClientUpdatedAt = "2099-01-01T00:00:00.001Z";

type BackendPidRow = Readonly<{ backend_pid: number }>;
type BlockingPidsRow = Readonly<{ blocking_pids: ReadonlyArray<number> }>;
type CountRow = Readonly<{ count: string }>;
type PersistedCardRow = Readonly<{
  front_text: string;
  back_text: string;
  client_updated_at: Date;
  last_modified_by_replica_id: string;
  last_operation_id: string;
  updated_at: Date;
  row_version: string;
}>;
type PersistedHotChangeRow = Readonly<{
  entity_type: string;
  entity_id: string;
  replica_id: string;
  operation_id: string;
  client_updated_at: Date;
}>;

function createClientExecutor(client: pg.PoolClient): DatabaseExecutor {
  return {
    query<Row extends pg.QueryResultRow>(text: string, params: ReadonlyArray<SqlValue>): Promise<pg.QueryResult<Row>> {
      return client.query<Row>(text, [...params]);
    },
  };
}

async function beginWorkspaceTransaction(
  client: pg.PoolClient,
  userId: string,
  workspaceId: string,
): Promise<void> {
  await client.query("BEGIN");
  await client.query(
    "SELECT set_config('app.user_id', $1, true), set_config('app.workspace_id', $2, true)",
    [userId, workspaceId],
  );
}

async function withRuntimeTransaction<Result>(
  fixture: PostgresIntegrationFixture,
  workspaceId: string,
  callback: (executor: DatabaseExecutor) => Promise<Result>,
): Promise<Result> {
  const client = await fixture.runtimePool.connect();
  try {
    await beginWorkspaceTransaction(client, fixture.userId, workspaceId);
    const result = await callback(createClientExecutor(client));
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function loadBackendPid(client: pg.PoolClient): Promise<number> {
  const result = await client.query<BackendPidRow>("SELECT pg_backend_pid() AS backend_pid");
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error("PostgreSQL did not return a backend pid for the integration client.");
  }
  return row.backend_pid;
}

async function waitForCardLockBlock(
  fixture: PostgresIntegrationFixture,
  blockedPid: number,
  blockingPid: number,
): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const result = await fixture.ownerPool.query<BlockingPidsRow>(
      "SELECT pg_blocking_pids($1) AS blocking_pids",
      [blockedPid],
    );
    if (result.rows[0]?.blocking_pids.includes(blockingPid) === true) {
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(
    `Card append backend ${blockedPid} did not block behind editor backend ${blockingPid}.`,
  );
}

async function loadPersistedCard(fixture: PostgresIntegrationFixture): Promise<PersistedCardRow> {
  const result = await fixture.ownerPool.query<PersistedCardRow>(
    [
      "SELECT front_text, back_text, client_updated_at, last_modified_by_replica_id,",
      "last_operation_id, updated_at, xmin::text AS row_version",
      "FROM content.cards WHERE workspace_id = $1 AND card_id = $2",
    ].join(" "),
    [fixture.workspaceId, fixture.cardId],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error(`Fixture card was not found. cardId=${fixture.cardId}`);
  }
  return row;
}

async function countCardHotChanges(fixture: PostgresIntegrationFixture): Promise<number> {
  const result = await fixture.ownerPool.query<CountRow>(
    [
      "SELECT count(*)::text AS count FROM sync.hot_changes",
      "WHERE workspace_id = $1 AND entity_type = 'card' AND entity_id = $2",
    ].join(" "),
    [fixture.workspaceId, fixture.cardId],
  );
  return Number.parseInt(result.rows[0]?.count ?? "", 10);
}

test("card image append is atomic, lock-safe, RLS-scoped, and duplicate-free", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    await withRuntimeTransaction(fixture, fixture.outOfScopeWorkspaceId, async (executor) => {
      const result = await executor.query<{ card_id: string }>(
        "SELECT card_id FROM content.cards WHERE workspace_id = $1 AND card_id = $2",
        [fixture.workspaceId, fixture.cardId],
      );
      assert.equal(result.rows.length, 0);
    });

    const validInput: AppendManagedImageToCardSideInput = {
      cardId: fixture.cardId,
      targetSide: "back",
      mediaAssetId: fixture.mediaAssetId,
      altText: "Generated image",
    };
    const appendMetadata = {
      clientUpdatedAt: fixture.createdAt,
      lastModifiedByReplicaId: fixture.replicaId,
      lastOperationId: fixture.operationId,
    };
    for (const [input, expectedMessage] of [
      [{ ...validInput, cardId: "invalid-card-id" }, "cardId must be a UUID"],
      [{ ...validInput, mediaAssetId: "invalid-media-id" }, "mediaAssetId must be a UUID"],
    ] as const) {
      await withRuntimeTransaction(fixture, fixture.workspaceId, async (executor) => {
        let primitiveQueryCount = 0;
        const countedExecutor: DatabaseExecutor = {
          query<Row extends pg.QueryResultRow>(text: string, params: ReadonlyArray<SqlValue>): Promise<pg.QueryResult<Row>> {
            primitiveQueryCount += 1;
            return executor.query<Row>(text, params);
          },
        };
        await assert.rejects(
          appendManagedImageToCardSideInExecutor(countedExecutor, fixture.workspaceId, input, appendMetadata),
          (error: unknown) => error instanceof HttpError
            && error.statusCode === 400
            && error.message === expectedMessage,
        );
        assert.equal(primitiveQueryCount, 0);
      });
    }
    assert.equal(await countCardHotChanges(fixture), 0);

    const editorClient = await fixture.runtimePool.connect();
    const appendClient = await fixture.runtimePool.connect();
    let editorTransactionOpen = false;
    let appendTransactionOpen = false;
    let appendPromise: Promise<AppendManagedImageToCardSideResult> | null = null;
    let appendResult: AppendManagedImageToCardSideResult;
    try {
      await beginWorkspaceTransaction(editorClient, fixture.userId, fixture.workspaceId);
      editorTransactionOpen = true;
      await beginWorkspaceTransaction(appendClient, fixture.userId, fixture.workspaceId);
      appendTransactionOpen = true;
      const editorPid = await loadBackendPid(editorClient);
      const appendPid = await loadBackendPid(appendClient);

      await editorClient.query(
        "SELECT card_id FROM content.cards WHERE workspace_id = $1 AND card_id = $2 FOR UPDATE",
        [fixture.workspaceId, fixture.cardId],
      );
      await editorClient.query(
        [
          "UPDATE content.cards SET back_text = $1, client_updated_at = $2,",
          "last_modified_by_replica_id = $3, last_operation_id = $4, updated_at = now()",
          "WHERE workspace_id = $5 AND card_id = $6",
        ].join(" "),
        [
          "Concurrent answer edit", futureClientUpdatedAt, fixture.replicaId,
          fixture.concurrentOperationId, fixture.workspaceId, fixture.cardId,
        ],
      );

      appendPromise = appendManagedImageToCardSideInExecutor(
        createClientExecutor(appendClient),
        fixture.workspaceId,
        validInput,
        appendMetadata,
      );

      await waitForCardLockBlock(fixture, appendPid, editorPid);
      await editorClient.query("COMMIT");
      editorTransactionOpen = false;
      appendResult = await appendPromise;
      await appendClient.query("COMMIT");
      appendTransactionOpen = false;
    } finally {
      if (editorTransactionOpen) await editorClient.query("ROLLBACK");
      if (appendPromise !== null && appendTransactionOpen) {
        await Promise.allSettled([appendPromise]);
      }
      if (appendTransactionOpen) await appendClient.query("ROLLBACK");
      editorClient.release();
      appendClient.release();
    }

    const expectedBackText = [
      "Concurrent answer edit", "", `![Generated image](fcasset:${fixture.mediaAssetId})`,
    ].join("\n");
    assert.equal(appendResult.applied, true);
    assert.equal(appendResult.card.frontText, "Original question");
    assert.equal(appendResult.card.backText, expectedBackText);
    assert.equal(appendResult.card.clientUpdatedAt, expectedGeneratedClientUpdatedAt);
    assert.equal(appendResult.card.lastModifiedByReplicaId, fixture.replicaId);
    assert.equal(appendResult.card.lastOperationId, fixture.operationId);

    const persistedCard = await loadPersistedCard(fixture);
    assert.equal(persistedCard.front_text, "Original question");
    assert.equal(persistedCard.back_text, expectedBackText);
    assert.equal(persistedCard.client_updated_at.toISOString(), expectedGeneratedClientUpdatedAt);
    assert.equal(persistedCard.last_modified_by_replica_id, fixture.replicaId);
    assert.equal(persistedCard.last_operation_id, fixture.operationId);

    const hotChanges = await fixture.ownerPool.query<PersistedHotChangeRow>(
      [
        "SELECT entity_type, entity_id, replica_id, operation_id, client_updated_at",
        "FROM sync.hot_changes",
        "WHERE workspace_id = $1 AND entity_type = 'card' AND entity_id = $2",
      ].join(" "),
      [fixture.workspaceId, fixture.cardId],
    );
    assert.equal(hotChanges.rows.length, 1);
    const hotChange = hotChanges.rows[0];
    assert.ok(hotChange);
    assert.equal(hotChange.entity_type, "card");
    assert.equal(hotChange.entity_id, fixture.cardId);
    assert.equal(hotChange.replica_id, fixture.replicaId);
    assert.equal(hotChange.operation_id, fixture.operationId);
    assert.equal(hotChange.client_updated_at.toISOString(), expectedGeneratedClientUpdatedAt);

    const duplicateResult = await withRuntimeTransaction(
      fixture,
      fixture.workspaceId,
      async (executor) => appendManagedImageToCardSideInExecutor(
        executor,
        fixture.workspaceId,
        { ...validInput, altText: "Retry image" },
        {
          ...appendMetadata,
          lastOperationId: fixture.retryOperationId,
        },
      ),
    );
    assert.equal(duplicateResult.applied, false);
    assert.equal(duplicateResult.card.backText, expectedBackText);
    assert.equal(duplicateResult.card.lastOperationId, fixture.operationId);
    assert.deepEqual(await loadPersistedCard(fixture), persistedCard);
    assert.equal(await countCardHotChanges(fixture), 1);

    for (const blockedText of ["```markdown\nAnswer", "~~~markdown\nAnswer", "<script>\nAnswer"]) {
      await fixture.ownerPool.query(
        "UPDATE content.cards SET back_text = $1 WHERE workspace_id = $2 AND card_id = $3",
        [blockedText, fixture.workspaceId, fixture.cardId],
      );
      const unchangedCard = await loadPersistedCard(fixture);
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const primitiveQueries: Array<string> = [];
        await assert.rejects(
          withRuntimeTransaction(fixture, fixture.workspaceId, async (executor) => {
            const recordingExecutor: DatabaseExecutor = {
              query<Row extends pg.QueryResultRow>(text: string, params: ReadonlyArray<SqlValue>): Promise<pg.QueryResult<Row>> {
                primitiveQueries.push(text);
                return executor.query<Row>(text, params);
              },
            };
            return appendManagedImageToCardSideInExecutor(
              recordingExecutor, fixture.workspaceId, validInput, appendMetadata,
            );
          }),
          (error: unknown) => error instanceof HttpError
            && error.statusCode === 409
            && error.code === "CARD_IMAGE_APPEND_MARKDOWN_BLOCK_UNCLOSED",
        );
        assert.equal(primitiveQueries.length, 3);
        assert.match(primitiveQueries[1] ?? "", /FROM sync\.workspace_sync_metadata.*FOR UPDATE/su);
        assert.match(primitiveQueries[2] ?? "", /FROM content\.cards.*FOR UPDATE/su);
        assert.deepEqual(await loadPersistedCard(fixture), unchangedCard);
        assert.equal(await countCardHotChanges(fixture), 1);
      }
    }
  });
});
