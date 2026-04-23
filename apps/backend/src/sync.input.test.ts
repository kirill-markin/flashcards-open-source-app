import assert from "node:assert/strict";
import test from "node:test";
import { HttpError } from "./errors";
import { parseSyncPushInput } from "./sync/input";

type ReviewEventTimestampFixture = Readonly<{
  clientUpdatedAt: string;
  reviewedAtClient: string;
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
