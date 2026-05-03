import assert from "node:assert/strict";
import test from "node:test";
import type { CardSnapshotInput } from "./cards";
import { HttpError } from "./errors";
import { parseBootstrapEntryRow } from "./sync/bootstrap";
import { parseSyncPushInput } from "./sync/input";
import type { BootstrapProjectionRow } from "./sync/types";

type ReviewEventTimestampFixture = Readonly<{
  clientUpdatedAt: string;
  reviewedAtClient: string;
}>;

type CardDueAtFixture = Readonly<{
  dueAt: string | null;
}>;

type CardSyncPushOperation = Readonly<{
  operationId: string;
  entityType: "card";
  action: "upsert";
  entityId: string;
  clientUpdatedAt: string;
  payload: CardSnapshotInput;
}>;

type CardSyncPushInput = Readonly<{
  installationId: string;
  platform: "ios";
  operations: ReadonlyArray<CardSyncPushOperation>;
}>;

type CardBootstrapPayload = CardSnapshotInput & Readonly<{
  clientUpdatedAt: string;
  lastModifiedByReplicaId: string;
  lastOperationId: string;
  updatedAt: string;
}>;

function createSyncPushInput(
  fixture: ReviewEventTimestampFixture,
): Readonly<{
  installationId: string;
  platform: "ios";
  operations: ReadonlyArray<Readonly<{
    operationId: string;
    entityType: "review_event";
    action: "append";
    entityId: string;
    clientUpdatedAt: string;
    payload: Readonly<{
      reviewEventId: string;
      cardId: string;
      clientEventId: string;
      rating: 2;
      reviewedAtClient: string;
    }>;
  }>>;
}> {
  return {
    installationId: "installation-1",
    platform: "ios",
    operations: [
      {
        operationId: "operation-1",
        entityType: "review_event",
        action: "append",
        entityId: "review-event-1",
        clientUpdatedAt: fixture.clientUpdatedAt,
        payload: {
          reviewEventId: "review-event-1",
          cardId: "card-1",
          clientEventId: "client-event-1",
          rating: 2,
          reviewedAtClient: fixture.reviewedAtClient,
        },
      },
    ],
  };
}

function createCardSnapshotPayload(fixture: CardDueAtFixture): CardSnapshotInput {
  const hasDueAt = fixture.dueAt !== null;

  return {
    cardId: "card-1",
    frontText: "Question",
    backText: "Answer",
    tags: ["sync"],
    effortLevel: "fast",
    dueAt: fixture.dueAt,
    createdAt: "2026-02-28T09:00:00.000Z",
    reps: hasDueAt ? 1 : 0,
    lapses: 0,
    fsrsCardState: hasDueAt ? "review" : "new",
    fsrsStepIndex: null,
    fsrsStability: hasDueAt ? 2.5 : null,
    fsrsDifficulty: hasDueAt ? 4.5 : null,
    fsrsLastReviewedAt: hasDueAt ? "2026-02-28T09:00:00.000Z" : null,
    fsrsScheduledDays: hasDueAt ? 1 : null,
    deletedAt: null,
  };
}

function createCardSyncPushInput(fixture: CardDueAtFixture): CardSyncPushInput {
  return {
    installationId: "installation-1",
    platform: "ios",
    operations: [
      {
        operationId: "operation-card-1",
        entityType: "card",
        action: "upsert",
        entityId: "card-1",
        clientUpdatedAt: "2026-02-28T09:30:00.000Z",
        payload: createCardSnapshotPayload(fixture),
      },
    ],
  };
}

function createCardBootstrapPayload(fixture: CardDueAtFixture): CardBootstrapPayload {
  return {
    ...createCardSnapshotPayload(fixture),
    clientUpdatedAt: "2026-02-28T09:30:00.000Z",
    lastModifiedByReplicaId: "replica-1",
    lastOperationId: "operation-card-1",
    updatedAt: "2026-02-28T09:30:00.000Z",
  };
}

function createCardBootstrapProjectionRow(fixture: CardDueAtFixture): BootstrapProjectionRow {
  return {
    entity_rank: 1,
    entity_type: "card",
    entity_id: "card-1",
    payload: createCardBootstrapPayload(fixture),
  };
}

test("parseSyncPushInput accepts backdated review_event timestamps through the normal sync push contract", () => {
  const input = createSyncPushInput({
    clientUpdatedAt: "2018-02-03T04:05:06.000Z",
    reviewedAtClient: "2018-02-03T04:05:06.000Z",
  });

  const parsedInput = parseSyncPushInput(input);

  assert.equal(parsedInput.operations[0]?.entityType, "review_event");
  if (parsedInput.operations[0]?.entityType !== "review_event") {
    assert.fail("Expected the parsed sync operation to remain a review_event");
  }
  assert.equal(parsedInput.operations[0].clientUpdatedAt, "2018-02-03T04:05:06.000Z");
  assert.equal(parsedInput.operations[0].payload.reviewedAtClient, "2018-02-03T04:05:06.000Z");
});

test("parseSyncPushInput rejects review_event operations when clientUpdatedAt diverges from reviewedAtClient", () => {
  const input = createSyncPushInput({
    clientUpdatedAt: "2018-02-03T04:05:06.000Z",
    reviewedAtClient: "2018-02-02T04:05:06.000Z",
  });

  assert.throws(
    () => parseSyncPushInput(input),
    (error: unknown) => {
      if (!(error instanceof HttpError)) {
        assert.fail("Expected parseSyncPushInput to throw HttpError");
      }

      assert.equal(error.statusCode, 400);
      assert.equal(error.code, "SYNC_INVALID_INPUT");
      assert.deepEqual(error.details?.validationIssues, [
        {
          path: "operations.0.clientUpdatedAt",
          code: "custom",
          message: "review_event clientUpdatedAt must match payload.reviewedAtClient",
        },
      ]);

      return true;
    },
  );
});

test("parseSyncPushInput accepts dueAt as a string or null without numeric public fields", () => {
  const validDueAt = "2028-02-29T10:11:12.345Z";
  const parsedInputWithDueAt = parseSyncPushInput(createCardSyncPushInput({
    dueAt: validDueAt,
  }));
  const operationWithDueAt = parsedInputWithDueAt.operations[0];
  if (operationWithDueAt?.entityType !== "card") {
    assert.fail("Expected the parsed sync operation to remain a card");
  }

  assert.equal(operationWithDueAt.payload.dueAt, validDueAt);
  assert.equal(Object.prototype.hasOwnProperty.call(operationWithDueAt.payload, "dueAtMillis"), false);

  const parsedInputWithoutDueAt = parseSyncPushInput(createCardSyncPushInput({
    dueAt: null,
  }));
  const operationWithoutDueAt = parsedInputWithoutDueAt.operations[0];
  if (operationWithoutDueAt?.entityType !== "card") {
    assert.fail("Expected the parsed sync operation to remain a card");
  }

  assert.equal(operationWithoutDueAt.payload.dueAt, null);
  assert.equal(Object.prototype.hasOwnProperty.call(operationWithoutDueAt.payload, "dueAtMillis"), false);
});

test("parseSyncPushInput rejects malformed non-null dueAt timestamps before ingest", () => {
  const malformedDueAtValues: ReadonlyArray<string> = [
    "2026-02-31T00:00:00.000Z",
    "2026-02-29T00:00:00.000Z",
    "1000",
    "2026-13-01T00:00:00.000Z",
    "2026-12-01T00:60:00.000Z",
    "2026-12-01T00:00:60.000Z",
  ];

  for (const dueAt of malformedDueAtValues) {
    assert.throws(
      () => parseSyncPushInput(createCardSyncPushInput({ dueAt })),
      (error: unknown) => {
        if (!(error instanceof HttpError)) {
          assert.fail("Expected parseSyncPushInput to throw HttpError");
        }

        assert.equal(error.statusCode, 400);
        assert.equal(error.code, "SYNC_INVALID_INPUT");
        const dueAtIssue = error.details?.validationIssues?.find(
          (issue) => issue.path === "operations.0.payload.dueAt",
        );
        assert.notEqual(dueAtIssue, undefined);
        assert.match(dueAtIssue?.message ?? "", /dueAt/);

        return true;
      },
      `Expected dueAt ${dueAt} to be rejected`,
    );
  }
});

test("parseBootstrapEntryRow keeps outbound card dueAt as a string or null without dueAtMillis", () => {
  const validDueAt = "2028-02-29T10:11:12.345Z";
  const entryWithDueAt = parseBootstrapEntryRow(createCardBootstrapProjectionRow({
    dueAt: validDueAt,
  }));
  if (entryWithDueAt.entityType !== "card") {
    assert.fail("Expected the bootstrap entry to remain a card");
  }

  assert.equal(entryWithDueAt.payload.dueAt, validDueAt);
  assert.equal(Object.prototype.hasOwnProperty.call(entryWithDueAt.payload, "dueAtMillis"), false);

  const entryWithoutDueAt = parseBootstrapEntryRow(createCardBootstrapProjectionRow({
    dueAt: null,
  }));
  if (entryWithoutDueAt.entityType !== "card") {
    assert.fail("Expected the bootstrap entry to remain a card");
  }

  assert.equal(entryWithoutDueAt.payload.dueAt, null);
  assert.equal(Object.prototype.hasOwnProperty.call(entryWithoutDueAt.payload, "dueAtMillis"), false);
});
