import assert from "node:assert/strict";
import test from "node:test";
import type {
  BulkCreateCardItem,
  Card,
  CardMetadata,
  CardMutationMetadata,
  CreateCardInput,
} from "../../cards";
import type {
  DatabaseExecutor,
  WorkspaceDatabaseScope,
} from "../../database";
import { HttpError } from "../../shared/errors";
import {
  persistWorkspacePackageImportCardsWithDependencies,
  type WorkspacePackageImportCardPersistenceDependencies,
} from "./importCards";
import {
  planWorkspacePackageImport,
  type PortableWorkspacePackageCardV1,
  type WorkspacePackageCardMetadataV1,
  type WorkspacePackageImportCardPersistenceInput,
  type WorkspacePackageImportCardPersistenceResult,
  type WorkspacePackageImportPlannedCard,
} from "../index";

const testUserId = "user-1";
const testWorkspaceId = "11111111-1111-4111-8111-111111111111";
const testReplicaId = "22222222-2222-4222-8222-222222222222";
const clientUpdatedAt = "2026-06-30T12:01:00.000Z";
const importedAt = "2026-06-30T12:00:00.000Z";
const operationIdPrefix = "import-session-1";

const testMetadata: WorkspacePackageCardMetadataV1 = {
  version: 1,
  source: {
    label: "Package label",
    author: "Package author",
    comment: "Package comment",
    createdAt: "2026-06-01T00:00:00.000Z",
    importedAt,
    importId: operationIdPrefix,
  },
};

type TransactionCall = Readonly<{
  scope: WorkspaceDatabaseScope;
  executor: DatabaseExecutor;
}>;

type CreateCardCall = Readonly<{
  executor: DatabaseExecutor;
  workspaceId: string;
  input: CreateCardInput;
  metadata: CardMutationMetadata;
}>;

type TestPersistenceHarness = Readonly<{
  dependencies: WorkspacePackageImportCardPersistenceDependencies;
  transactionCalls: ReadonlyArray<TransactionCall>;
  createCardCalls: ReadonlyArray<CreateCardCall>;
}>;

function createPlannedCard(
  frontText: string,
  backText: string,
  tags: ReadonlyArray<string>,
  cardType: string,
  metadata: WorkspacePackageCardMetadataV1,
): WorkspacePackageImportPlannedCard {
  return {
    frontText,
    backText,
    tags,
    cardType,
    metadata,
  };
}

function createPortableCard(
  frontText: string,
  backText: string,
): PortableWorkspacePackageCardV1 {
  return {
    frontText,
    backText,
    tags: ["biology"],
    cardType: "basic",
    metadata: {
      version: 1,
      source: null,
    },
  };
}

function createPersistenceInput(
  plannedCards: ReadonlyArray<WorkspacePackageImportPlannedCard>,
): WorkspacePackageImportCardPersistenceInput {
  return {
    userId: testUserId,
    workspaceId: testWorkspaceId,
    plannedCards,
    clientUpdatedAt,
    lastModifiedByReplicaId: testReplicaId,
    operationIdPrefix,
  };
}

function createCreatedCard(item: BulkCreateCardItem, cardIndex: number): Card {
  return {
    cardId: `card-${cardIndex}`,
    frontText: item.input.frontText,
    backText: item.input.backText,
    cardType: item.input.cardType ?? "basic",
    metadata: item.input.metadata ?? ({ version: 1, source: null } satisfies CardMetadata),
    tags: item.input.tags,
    dueAt: null,
    createdAt: item.metadata.clientUpdatedAt,
    reps: 0,
    lapses: 0,
    fsrsCardState: "new",
    fsrsStepIndex: null,
    fsrsStability: null,
    fsrsDifficulty: null,
    fsrsLastReviewedAt: null,
    fsrsScheduledDays: null,
    clientUpdatedAt: item.metadata.clientUpdatedAt,
    lastModifiedByReplicaId: item.metadata.lastModifiedByReplicaId,
    lastOperationId: item.metadata.lastOperationId,
    updatedAt: item.metadata.clientUpdatedAt,
    deletedAt: null,
  };
}

function createPersistenceHarness(): TestPersistenceHarness {
  const transactionCalls: Array<TransactionCall> = [];
  const createCardCalls: Array<CreateCardCall> = [];
  let createdCardIndex = 0;

  return {
    transactionCalls,
    createCardCalls,
    dependencies: {
      createCardInExecutorFn: async (
        executor: DatabaseExecutor,
        workspaceId: string,
        input: CreateCardInput,
        metadata: CardMutationMetadata,
      ): Promise<Card> => {
        createCardCalls.push({ executor, workspaceId, input, metadata });
        const card = createCreatedCard({ input, metadata }, createdCardIndex);
        createdCardIndex += 1;
        return card;
      },
      transactionWithWorkspaceScopeFn: async (
        scope: WorkspaceDatabaseScope,
        callback: (executor: DatabaseExecutor) => Promise<WorkspacePackageImportCardPersistenceResult>,
      ): Promise<WorkspacePackageImportCardPersistenceResult> => {
        const executor: DatabaseExecutor = {
          async query(): Promise<never> {
            throw new Error("Test executor query should not be called");
          },
        };
        transactionCalls.push({ scope, executor });
        return callback(executor);
      },
    },
  };
}

test("workspace package import card persistence returns empty results without opening a transaction", async () => {
  const harness = createPersistenceHarness();

  const result = await persistWorkspacePackageImportCardsWithDependencies(
    createPersistenceInput([]),
    harness.dependencies,
  );

  assert.deepEqual(result.cards, []);
  assert.deepEqual(result.summary, {
    cardCount: 0,
    batchCount: 0,
  });
  assert.deepEqual(harness.transactionCalls, []);
  assert.deepEqual(harness.createCardCalls, []);
});

test("workspace package import card persistence maps one planned card inside one transaction", async () => {
  const plannedCard = createPlannedCard(
    "Prompt",
    "Answer",
    ["biology", "imported"],
    "basic",
    testMetadata,
  );
  const harness = createPersistenceHarness();

  const result = await persistWorkspacePackageImportCardsWithDependencies(
    createPersistenceInput([plannedCard]),
    harness.dependencies,
  );

  assert.equal(harness.transactionCalls.length, 1);
  assert.deepEqual(harness.transactionCalls[0]?.scope, {
    userId: testUserId,
    workspaceId: testWorkspaceId,
  });
  assert.equal(harness.createCardCalls.length, 1);
  assert.equal(harness.createCardCalls[0]?.executor, harness.transactionCalls[0]?.executor);
  assert.equal(harness.createCardCalls[0]?.workspaceId, testWorkspaceId);
  assert.deepEqual(harness.createCardCalls[0]?.input, {
    frontText: "Prompt",
    backText: "Answer",
    tags: ["biology", "imported"],
    cardType: "basic",
    metadata: testMetadata,
  });
  assert.deepEqual(harness.createCardCalls[0]?.metadata, {
    clientUpdatedAt,
    lastModifiedByReplicaId: testReplicaId,
    lastOperationId: `${operationIdPrefix}:card:0`,
  });
  assert.deepEqual(result.summary, {
    cardCount: 1,
    batchCount: 1,
  });
  assert.equal(result.cards[0]?.frontText, "Prompt");
  assert.equal(result.cards[0]?.lastOperationId, `${operationIdPrefix}:card:0`);
});

test("workspace package import card persistence keeps 101 cards ordered inside one transaction", async () => {
  const plannedCards = Array.from({ length: 101 }, (_value, cardIndex) => createPlannedCard(
    `Prompt ${cardIndex}`,
    `Answer ${cardIndex}`,
    [`tag-${cardIndex}`],
    "basic",
    testMetadata,
  ));
  const harness = createPersistenceHarness();

  const result = await persistWorkspacePackageImportCardsWithDependencies(
    createPersistenceInput(plannedCards),
    harness.dependencies,
  );

  assert.equal(harness.transactionCalls.length, 1);
  assert.equal(harness.createCardCalls.length, 101);
  assert.ok(harness.createCardCalls.every((call) => call.executor === harness.transactionCalls[0]?.executor));
  assert.equal(harness.createCardCalls[0]?.metadata.lastOperationId, `${operationIdPrefix}:card:0`);
  assert.equal(harness.createCardCalls[99]?.metadata.lastOperationId, `${operationIdPrefix}:card:99`);
  assert.equal(harness.createCardCalls[100]?.metadata.lastOperationId, `${operationIdPrefix}:card:100`);
  assert.deepEqual(
    result.cards.map((card) => card.cardId),
    plannedCards.map((_card, cardIndex) => `card-${cardIndex}`),
  );
  assert.deepEqual(result.summary, {
    cardCount: 101,
    batchCount: 2,
  });
});

test("workspace package import card persistence preserves later batch HttpError details with context", async () => {
  const details = {
    validationIssues: [
      {
        path: "frontText",
        code: "too_small",
        message: "frontText must not be empty.",
      },
    ],
  };
  const transactionCalls: Array<TransactionCall> = [];
  const createCardCalls: Array<CreateCardCall> = [];
  const dependencies: WorkspacePackageImportCardPersistenceDependencies = {
    createCardInExecutorFn: async (
      executor: DatabaseExecutor,
      workspaceId: string,
      input: CreateCardInput,
      metadata: CardMutationMetadata,
    ): Promise<Card> => {
      createCardCalls.push({ executor, workspaceId, input, metadata });
      if (metadata.lastOperationId === `${operationIdPrefix}:card:100`) {
        throw new HttpError(400, "Card batch is invalid.", "CARD_BATCH_INVALID", details);
      }

      return createCreatedCard({ input, metadata }, createCardCalls.length - 1);
    },
    transactionWithWorkspaceScopeFn: async (
      scope: WorkspaceDatabaseScope,
      callback: (executor: DatabaseExecutor) => Promise<WorkspacePackageImportCardPersistenceResult>,
    ): Promise<WorkspacePackageImportCardPersistenceResult> => {
      const executor: DatabaseExecutor = {
        async query(): Promise<never> {
          throw new Error("Test executor query should not be called");
        },
      };
      transactionCalls.push({ scope, executor });
      return callback(executor);
    },
  };
  const plannedCards = Array.from({ length: 101 }, (_value, cardIndex) => createPlannedCard(
    `Prompt ${cardIndex}`,
    `Answer ${cardIndex}`,
    [`tag-${cardIndex}`],
    "basic",
    testMetadata,
  ));

  await assert.rejects(
    () => persistWorkspacePackageImportCardsWithDependencies(createPersistenceInput(plannedCards), dependencies),
    (error: unknown): boolean => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 400);
      assert.equal(error.code, "CARD_BATCH_INVALID");
      assert.deepEqual(error.details, details);
      assert.match(error.message, /batchIndex=1/);
      assert.match(error.message, /cardRange=100-100/);
      assert.match(error.message, /Card batch is invalid/);
      return true;
    },
  );
  assert.equal(transactionCalls.length, 1);
  assert.equal(createCardCalls.length, 101);
  assert.ok(createCardCalls.every((call) => call.executor === transactionCalls[0]?.executor));
});

test("workspace package import plan output can be persisted directly", async () => {
  const plan = planWorkspacePackageImport({
    cardsJson: {
      formatVersion: 1,
      label: "Biology package",
      author: "Author",
      createdAt: "2026-06-01T00:00:00.000Z",
      cards: [
        createPortableCard(
          "Diagram: ![cell](media/images/cell.png)",
          "Answer",
        ),
      ],
    },
    options: {
      addImportTag: true,
      importTag: "import:2026-06-30-0",
      removeTags: [],
      importedAt,
      importId: operationIdPrefix,
    },
    mediaAssetIdsByPortablePath: new Map([
      ["media/images/cell.png", "image-asset"],
    ]),
  });
  const harness = createPersistenceHarness();

  await persistWorkspacePackageImportCardsWithDependencies(
    createPersistenceInput(plan.cards),
    harness.dependencies,
  );

  assert.equal(harness.createCardCalls[0]?.input.frontText, "Diagram: ![cell](fcasset:image-asset)");
  assert.deepEqual(harness.createCardCalls[0]?.input.tags, ["biology", "import:2026-06-30-0"]);
  assert.deepEqual(harness.createCardCalls[0]?.input.metadata, {
    version: 1,
    source: {
      label: "Biology package",
      author: "Author",
      comment: null,
      createdAt: "2026-06-01T00:00:00.000Z",
      importedAt,
      importId: operationIdPrefix,
    },
  });
});
