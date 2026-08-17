import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";
import type { DatabaseExecutor, SqlValue } from "../../database";
import { HttpError } from "../../shared/errors";
import {
  appendManagedImageToCardSideInExecutor,
  appendManagedImageToCardText,
  buildManagedImageMarkdownReference,
} from "./managedImageSettlement";
import type { AppendManagedImageToCardSideInput, CardMutationMetadata, CardRow, CardTextSide } from "../types";

const testWorkspaceId = "22222222-2222-4222-8222-222222222222";
const testCardId = "33333333-3333-4333-8333-333333333333";
const testReplicaId = "44444444-4444-4444-8444-444444444444";
const testMediaAssetId = "66666666-6666-4666-8666-666666666666";
const testTimestamp = "2026-07-23T10:00:00.000Z";

const testMetadata: CardMutationMetadata = {
  clientUpdatedAt: testTimestamp,
  lastModifiedByReplicaId: testReplicaId,
  lastOperationId: "generated-image-card-append",
};

type QueryRecord = Readonly<{ text: string; params: ReadonlyArray<SqlValue> }>;

function classifyAppendQuery(text: string): string {
  if (text.includes("INSERT INTO sync.workspace_sync_metadata")) return "ensure-hot-metadata";
  if (text.includes("FROM sync.workspace_sync_metadata")) return "lock-hot-metadata";
  if (text.includes("FROM content.cards")) return "lock-card";
  if (text.includes("UPDATE content.cards")) return "update-card";
  if (text.includes("INSERT INTO sync.hot_changes")) return "record-hot-change";
  return "unexpected";
}

function createQueryResult<Row extends pg.QueryResultRow>(command: string, rows: Array<Row>): pg.QueryResult<Row> {
  return { command, rowCount: rows.length, oid: 0, fields: [], rows };
}

function createCardRow(clientUpdatedAt: string): CardRow {
  return {
    card_id: testCardId,
    front_text: "Question",
    back_text: "Answer",
    card_type: "basic",
    metadata: { version: 1, source: null },
    tags: [],
    effort_level: "fast",
    due_at: null,
    created_at: testTimestamp,
    reps: 0,
    lapses: 0,
    fsrs_card_state: "new",
    fsrs_step_index: null,
    fsrs_stability: null,
    fsrs_difficulty: null,
    fsrs_last_reviewed_at: null,
    fsrs_scheduled_days: null,
    client_updated_at: clientUpdatedAt,
    last_modified_by_replica_id: "55555555-5555-4555-8555-555555555555",
    last_operation_id: "previous-operation",
    updated_at: clientUpdatedAt,
    deleted_at: null,
  };
}

test("managed image Markdown is canonical and parser-safe", () => {
  assert.equal(
    buildManagedImageMarkdownReference(
      testMediaAssetId.toUpperCase(),
      "  Diagram [labeled]\r\n path\\\t detail  ",
    ),
    `![Diagram (labeled) path＼ detail](fcasset:${testMediaAssetId})`,
  );

  assert.throws(
    () => buildManagedImageMarkdownReference("asset-1", "Diagram"),
    (error: unknown) => error instanceof HttpError
      && error.statusCode === 400
      && error.message === "mediaAssetId must be a UUID",
  );
  assert.throws(
    () => buildManagedImageMarkdownReference(testMediaAssetId, " \n "),
    (error: unknown) => error instanceof HttpError
      && error.statusCode === 400
      && error.message === "altText must not be empty",
  );
});

test("managed image append uses one canonical Markdown block boundary", () => {
  const reference = `![Generated image](fcasset:${testMediaAssetId})`;
  const cases: ReadonlyArray<readonly [string, string]> = [
    ["", reference],
    ["Answer", `Answer\n\n${reference}`],
    ["Answer\n", `Answer\n\n${reference}`],
    ["Answer\n\n", `Answer\n\n${reference}`],
  ];

  for (const [text, expectedText] of cases) {
    assert.deepEqual(
      appendManagedImageToCardText(text, testMediaAssetId, "Generated image"),
      { text: expectedText, applied: true },
    );
  }
});

test("managed image duplicate detection uses only exact active image destinations", () => {
  const duplicateTexts = [
    `![Canonical](fcasset:${testMediaAssetId})`,
    `![Titled](fcasset:${testMediaAssetId} "Generated image")`,
    String.raw`![Escaped \] label](fcasset:${testMediaAssetId})`,
  ];
  for (const text of duplicateTexts) {
    assert.deepEqual(
      appendManagedImageToCardText(text, testMediaAssetId, "Generated image"),
      { text, applied: false },
    );
  }

  const nonDuplicateTexts = [
    `Mention fcasset:${testMediaAssetId} in prose.`,
    `[Link](fcasset:${testMediaAssetId})`,
    `\`![Code](fcasset:${testMediaAssetId})\``,
    ["```markdown", `![Code](fcasset:${testMediaAssetId})`, "```"].join("\n"),
    `![Malformed](fcasset:${testMediaAssetId}`,
    `![Longer](fcasset:${testMediaAssetId}-suffix)`,
  ];
  for (const text of nonDuplicateTexts) {
    const result = appendManagedImageToCardText(text, testMediaAssetId, "Generated image");
    assert.equal(result.applied, true);
    assert.equal(result.text.endsWith(`![Generated image](fcasset:${testMediaAssetId})`), true);
  }
});

test("card-side append rejects invalid inputs before executing a query", async () => {
  let queryCount = 0;
  const executor: DatabaseExecutor = {
    async query<Row extends pg.QueryResultRow>(text: string, params: ReadonlyArray<SqlValue>): Promise<pg.QueryResult<Row>> {
      queryCount += 1;
      throw new Error(`Invalid append input executed a query: ${text}; params=${JSON.stringify(params)}`);
    },
  };
  const validInput: AppendManagedImageToCardSideInput = {
    cardId: testCardId,
    targetSide: "back",
    mediaAssetId: testMediaAssetId,
    altText: "Generated image",
  };
  const cases: ReadonlyArray<readonly [AppendManagedImageToCardSideInput, string]> = [
    [{ ...validInput, cardId: "not-a-card-uuid" }, "cardId must be a UUID"],
    [{ ...validInput, mediaAssetId: "not-a-media-uuid" }, "mediaAssetId must be a UUID"],
    [{ ...validInput, targetSide: "middle" as CardTextSide }, "targetSide must be either front or back"],
  ];

  for (const [input, expectedMessage] of cases) {
    await assert.rejects(
      appendManagedImageToCardSideInExecutor(executor, testWorkspaceId, input, testMetadata),
      (error: unknown) => error instanceof HttpError
        && error.statusCode === 400
        && error.message === expectedMessage,
    );
  }
  assert.equal(queryCount, 0);
});

test("card-side append updates atomically and rejects inactive image placement without writes", async () => {
  const storedClientUpdatedAt = "2099-01-01T00:00:00.000Z";
  const expectedClientUpdatedAt = "2099-01-01T00:00:00.001Z";
  let currentRow = createCardRow(storedClientUpdatedAt);
  const queries: Array<QueryRecord> = [];
  const executor: DatabaseExecutor = {
    async query<Row extends pg.QueryResultRow>(text: string, params: ReadonlyArray<SqlValue>): Promise<pg.QueryResult<Row>> {
      queries.push({ text, params });

      if (text.includes("INSERT INTO sync.workspace_sync_metadata")) {
        return createQueryResult<Row>("INSERT", []);
      }
      if (text.includes("FROM sync.workspace_sync_metadata") && text.includes("FOR UPDATE")) {
        return createQueryResult<Row>("SELECT", [{ workspace_id: testWorkspaceId } as unknown as Row]);
      }
      if (text.includes("FROM content.cards") && text.includes("FOR UPDATE")) {
        return createQueryResult<Row>("SELECT", [currentRow as unknown as Row]);
      }
      if (text.includes("UPDATE content.cards")) {
        currentRow = {
          ...currentRow,
          front_text: String(params[0]),
          client_updated_at: String(params[1]),
          last_modified_by_replica_id: String(params[2]),
          last_operation_id: String(params[3]),
          updated_at: expectedClientUpdatedAt,
        };
        return createQueryResult<Row>("UPDATE", [currentRow as unknown as Row]);
      }
      if (text.includes("INSERT INTO sync.hot_changes")) {
        return createQueryResult<Row>("INSERT", [{ change_id: 1 } as unknown as Row]);
      }

      throw new Error(`Unexpected generated image append query: ${text}`);
    },
  };

  const appendInput: AppendManagedImageToCardSideInput = {
    cardId: testCardId,
    targetSide: "front",
    mediaAssetId: testMediaAssetId,
    altText: "Generated image",
  };
  const result = await appendManagedImageToCardSideInExecutor(
    executor,
    testWorkspaceId,
    {
      ...appendInput,
      cardId: appendInput.cardId.toUpperCase(),
      mediaAssetId: appendInput.mediaAssetId.toUpperCase(),
    },
    testMetadata,
  );

  assert.equal(result.applied, true);
  assert.equal(result.card.frontText, `Question\n\n![Generated image](fcasset:${testMediaAssetId})`);
  assert.equal(result.card.backText, "Answer");
  assert.equal(result.card.clientUpdatedAt, expectedClientUpdatedAt);
  assert.deepEqual(
    queries.map((query) => classifyAppendQuery(query.text)),
    ["ensure-hot-metadata", "lock-hot-metadata", "lock-card", "update-card", "record-hot-change"],
  );
  assert.deepEqual(queries[2]?.params, [testWorkspaceId, testCardId]);
  assert.match(queries[3]?.text ?? "", /SET front_text = \$1/u);
  assert.doesNotMatch(queries[3]?.text ?? "", /back_text =/u);
  assert.equal(queries[3]?.params[1], expectedClientUpdatedAt);
  assert.deepEqual(queries[4]?.params, [
    testWorkspaceId, "card", testCardId, "upsert", testReplicaId,
    testMetadata.lastOperationId, expectedClientUpdatedAt,
  ]);
  const duplicateResult = await appendManagedImageToCardSideInExecutor(
    executor,
    testWorkspaceId,
    {
      ...appendInput,
      altText: "Retry image",
    },
    testMetadata,
  );
  assert.equal(duplicateResult.applied, false);
  assert.equal(duplicateResult.card.frontText, currentRow.front_text);
  assert.equal(duplicateResult.card.lastOperationId, testMetadata.lastOperationId);
  assert.deepEqual(
    queries.slice(5).map((query) => classifyAppendQuery(query.text)),
    ["ensure-hot-metadata", "lock-hot-metadata", "lock-card"],
  );

  for (const blockedText of ["```markdown\nAnswer", "~~~markdown\nAnswer", "<script>\nAnswer"]) {
    const unchangedRow = { ...currentRow, front_text: blockedText };
    currentRow = unchangedRow;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const firstQueryIndex = queries.length;
      await assert.rejects(
        appendManagedImageToCardSideInExecutor(
          executor,
          testWorkspaceId,
          appendInput,
          testMetadata,
        ),
        (error: unknown) => error instanceof HttpError
          && error.statusCode === 409
          && error.code === "CARD_IMAGE_APPEND_MARKDOWN_BLOCK_UNCLOSED",
      );
      assert.deepEqual(currentRow, unchangedRow);
      assert.deepEqual(
        queries.slice(firstQueryIndex).map((query) => classifyAppendQuery(query.text)),
        ["ensure-hot-metadata", "lock-hot-metadata", "lock-card"],
      );
    }
  }
});
