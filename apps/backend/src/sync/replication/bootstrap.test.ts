import assert from "node:assert/strict";
import test from "node:test";
import type pg from "pg";
import type { DatabaseExecutor, SqlValue } from "../../database";
import {
  bootstrapPushIncludesMediaAssets,
  loadRemoteEmptyState,
} from "./bootstrap";
import type { RemoteEmptyRow } from "../contracts/types";

function createQueryResult<Row extends pg.QueryResultRow>(rows: ReadonlyArray<Row>): pg.QueryResult<Row> {
  return {
    command: "SELECT",
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows: [...rows],
  };
}

function createRemoteEmptyStateExecutor(row: RemoteEmptyRow): DatabaseExecutor {
  return {
    query: async <Row extends pg.QueryResultRow>(
      text: string,
      params: ReadonlyArray<SqlValue>,
    ): Promise<pg.QueryResult<Row>> => {
      assert.match(text, /FROM content\.media_assets/);
      assert.deepEqual(params, ["workspace-1"]);
      return createQueryResult([row as unknown as Row]);
    },
  };
}

test("loadRemoteEmptyState ignores media-only state for clients without media asset visibility", async () => {
  const remoteIsEmpty = await loadRemoteEmptyState(
    createRemoteEmptyStateExecutor({
      has_cards: false,
      has_decks: false,
      has_review_events: false,
      has_media_assets: true,
    }),
    "workspace-1",
    false,
  );

  assert.equal(remoteIsEmpty, true);
});

test("loadRemoteEmptyState counts media-only state for media-aware clients", async () => {
  const remoteIsEmpty = await loadRemoteEmptyState(
    createRemoteEmptyStateExecutor({
      has_cards: false,
      has_decks: false,
      has_review_events: false,
      has_media_assets: true,
    }),
    "workspace-1",
    true,
  );

  assert.equal(remoteIsEmpty, false);
});

test("bootstrapPushIncludesMediaAssets is true for explicit media-aware bootstrap pushes", () => {
  assert.equal(bootstrapPushIncludesMediaAssets({
    includeMediaAssets: true,
    entries: [],
  }), true);
});

test("bootstrapPushIncludesMediaAssets preserves media entry compatibility", () => {
  assert.equal(bootstrapPushIncludesMediaAssets({
    entries: [
      { entityType: "card" },
      { entityType: "deck" },
    ],
  }), false);
  assert.equal(bootstrapPushIncludesMediaAssets({
    entries: [
      { entityType: "media_asset" },
    ],
  }), true);
});

test("bootstrap push media opt-in checks media-only remote state as non-empty", async () => {
  const remoteIsEmpty = await loadRemoteEmptyState(
    createRemoteEmptyStateExecutor({
      has_cards: false,
      has_decks: false,
      has_review_events: false,
      has_media_assets: true,
    }),
    "workspace-1",
    bootstrapPushIncludesMediaAssets({
      includeMediaAssets: true,
      entries: [],
    }),
  );

  assert.equal(remoteIsEmpty, false);
});
