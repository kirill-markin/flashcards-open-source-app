import assert from "node:assert/strict";
import test from "node:test";
import type pg from "pg";
import type { DatabaseExecutor } from "./db";
import { ensureSyncDeviceInExecutor } from "./devices";
import { HttpError } from "./errors";

function makeQueryResult<Row extends pg.QueryResultRow>(
  rows: ReadonlyArray<pg.QueryResultRow>,
): pg.QueryResult<Row> {
  return {
    command: rows.length > 0 ? "SELECT" : "UPDATE",
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows: [...rows] as Array<Row>,
  };
}

test("ensureSyncDeviceInExecutor inserts a new sync device", async () => {
  let updateCalls = 0;
  let selectCalls = 0;

  const executor: DatabaseExecutor = {
    async query<Row extends pg.QueryResultRow>(text: string): Promise<pg.QueryResult<Row>> {
      if (text.includes("INSERT INTO sync.devices")) {
        return makeQueryResult<Row>([{ device_id: "device-1", platform: "web" }]);
      }

      if (text.includes("UPDATE sync.devices")) {
        updateCalls += 1;
        return makeQueryResult<Row>([]);
      }

      if (text.includes("SELECT device_id, platform")) {
        selectCalls += 1;
        return makeQueryResult<Row>([]);
      }

      throw new Error(`Unexpected SQL in test: ${text}`);
    },
  };

  await ensureSyncDeviceInExecutor(
    executor,
    "workspace-1",
    "user-1",
    "device-1",
    "web",
    "web-dev",
  );

  assert.equal(updateCalls, 0);
  assert.equal(selectCalls, 0);
});

test("ensureSyncDeviceInExecutor refreshes an existing device for the same user and platform", async () => {
  let updateCalls = 0;

  const executor: DatabaseExecutor = {
    async query<Row extends pg.QueryResultRow>(text: string): Promise<pg.QueryResult<Row>> {
      if (text.includes("INSERT INTO sync.devices")) {
        return makeQueryResult<Row>([]);
      }

      if (text.includes("UPDATE sync.devices")) {
        updateCalls += 1;
        return makeQueryResult<Row>([{ device_id: "device-1", platform: "web" }]);
      }

      if (text.includes("SELECT device_id, platform")) {
        throw new Error("Platform lookup should not run after a successful update");
      }

      throw new Error(`Unexpected SQL in test: ${text}`);
    },
  };

  await ensureSyncDeviceInExecutor(
    executor,
    "workspace-2",
    "user-1",
    "device-1",
    "web",
    "web-dev",
  );

  assert.equal(updateCalls, 1);
});

test("ensureSyncDeviceInExecutor returns a 409 platform mismatch when the visible device uses another platform", async () => {
  const executor: DatabaseExecutor = {
    async query<Row extends pg.QueryResultRow>(text: string): Promise<pg.QueryResult<Row>> {
      if (text.includes("INSERT INTO sync.devices")) {
        return makeQueryResult<Row>([]);
      }

      if (text.includes("UPDATE sync.devices")) {
        return makeQueryResult<Row>([]);
      }

      if (text.includes("SELECT device_id, platform")) {
        return makeQueryResult<Row>([{ device_id: "device-1", platform: "ios" }]);
      }

      throw new Error(`Unexpected SQL in test: ${text}`);
    },
  };

  await assert.rejects(
    () => ensureSyncDeviceInExecutor(
      executor,
      "workspace-1",
      "user-1",
      "device-1",
      "web",
      "web-dev",
    ),
    (error: unknown) => error instanceof HttpError
      && error.statusCode === 409
      && error.code === "SYNC_DEVICE_PLATFORM_MISMATCH",
  );
});

test("ensureSyncDeviceInExecutor returns a 409 owner mismatch when the device is invisible to the current user", async () => {
  const executor: DatabaseExecutor = {
    async query<Row extends pg.QueryResultRow>(text: string): Promise<pg.QueryResult<Row>> {
      if (text.includes("INSERT INTO sync.devices")) {
        return makeQueryResult<Row>([]);
      }

      if (text.includes("UPDATE sync.devices")) {
        return makeQueryResult<Row>([]);
      }

      if (text.includes("SELECT device_id, platform")) {
        return makeQueryResult<Row>([]);
      }

      throw new Error(`Unexpected SQL in test: ${text}`);
    },
  };

  await assert.rejects(
    () => ensureSyncDeviceInExecutor(
      executor,
      "workspace-1",
      "user-2",
      "device-1",
      "web",
      "web-dev",
    ),
    (error: unknown) => error instanceof HttpError
      && error.statusCode === 409
      && error.code === "SYNC_DEVICE_OWNED_BY_ANOTHER_USER",
  );
});
