import assert from "node:assert/strict";
import test from "node:test";
import * as sync from "./sync";

test("sync barrel exports public parse and process functions", () => {
  assert.equal(typeof sync.parseSyncPushInput, "function");
  assert.equal(typeof sync.parseSyncPullInput, "function");
  assert.equal(typeof sync.parseSyncBootstrapInput, "function");
  assert.equal(typeof sync.parseSyncReviewHistoryPullInput, "function");
  assert.equal(typeof sync.parseSyncReviewHistoryImportInput, "function");
  assert.equal(typeof sync.processSyncPush, "function");
  assert.equal(typeof sync.processSyncPull, "function");
  assert.equal(typeof sync.processSyncBootstrap, "function");
  assert.equal(typeof sync.processSyncReviewHistoryPull, "function");
  assert.equal(typeof sync.processSyncReviewHistoryImport, "function");
});
