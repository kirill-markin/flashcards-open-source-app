import assert from "node:assert/strict";
import test from "node:test";
import type pg from "pg";
import { HttpError } from "../errors";
import type { DatabaseExecutor } from "../db";
import {
  mapReviewHistoryRows,
  processSyncReviewHistoryImportInExecutor,
} from "./reviewHistory";

function makeQueryResult<Row extends pg.QueryResultRow>(rows: ReadonlyArray<Row>): pg.QueryResult<Row> {
  return {
    command: "SELECT",
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows: [...rows],
  };
}

test("mapReviewHistoryRows preserves ordering and normalizes timestamps", () => {
  const reviewEvents = mapReviewHistoryRows([{
    review_event_id: "review-1",
    workspace_id: "workspace-1",
    device_id: "device-1",
    client_event_id: "client-event-1",
    card_id: "card-1",
    rating: 2,
    reviewed_at_client: "2026-03-09T10:00:00.000Z",
    reviewed_at_server: new Date("2026-03-09T10:00:01.000Z"),
    review_sequence: 7,
  }]);

  assert.deepEqual(reviewEvents, [{
    reviewEventId: "review-1",
    workspaceId: "workspace-1",
    cardId: "card-1",
    deviceId: "device-1",
    clientEventId: "client-event-1",
    rating: 2,
    reviewedAtClient: "2026-03-09T10:00:00.000Z",
    reviewedAtServer: "2026-03-09T10:00:01.000Z",
  }]);
});

test("processSyncReviewHistoryImportInExecutor rejects events from another device", async () => {
  const executor: DatabaseExecutor = {
    async query<Row extends pg.QueryResultRow>(): Promise<pg.QueryResult<Row>> {
      throw new Error("No query expected");
    },
  };

  await assert.rejects(
    () => processSyncReviewHistoryImportInExecutor(
      executor,
      "workspace-1",
      "device-1",
      {
        deviceId: "device-1",
        platform: "ios",
        appVersion: "1.0.0",
        reviewEvents: [{
          reviewEventId: "review-1",
          workspaceId: "workspace-1",
          cardId: "card-1",
          deviceId: "device-2",
          clientEventId: "client-event-1",
          rating: 2,
          reviewedAtClient: "2026-03-09T10:00:00.000Z",
          reviewedAtServer: "2026-03-09T10:00:01.000Z",
        }],
      },
    ),
    (error: unknown) => error instanceof HttpError && error.statusCode === 400,
  );
});

test("processSyncReviewHistoryImportInExecutor returns imported and duplicate counts", async () => {
  const executor: DatabaseExecutor = {
    async query<Row extends pg.QueryResultRow>(text: string): Promise<pg.QueryResult<Row>> {
      if (text.includes("SELECT COALESCE(MAX(review_sequence), 0) AS review_sequence")) {
        return makeQueryResult([{ review_sequence: 4 }]) as unknown as pg.QueryResult<Row>;
      }

      return makeQueryResult([]) as pg.QueryResult<Row>;
    },
  };

  const originalDateNow = Date.now;
  try {
    Date.now = () => new Date("2026-03-09T10:00:01.000Z").valueOf();
    const result = await processSyncReviewHistoryImportInExecutor(
      executor,
      "workspace-1",
      "device-1",
      {
        deviceId: "device-1",
        platform: "ios",
        appVersion: "1.0.0",
        reviewEvents: [],
      },
    );

    assert.deepEqual(result, {
      importedCount: 0,
      duplicateCount: 0,
      nextReviewSequenceId: 4,
    });
  } finally {
    Date.now = originalDateNow;
  }
});
