import test from "node:test";
import assert from "node:assert/strict";
import {
  compareLwwMetadata,
  incomingLwwMetadataWins,
  normalizeIsoTimestamp,
  type LwwMetadata,
} from "./lww";

function makeMetadata(
  clientUpdatedAt: string,
  lastModifiedByDeviceId: string,
  lastOperationId: string,
): LwwMetadata {
  return {
    clientUpdatedAt,
    lastModifiedByDeviceId,
    lastOperationId,
  };
}

test("incomingLwwMetadataWins prefers newer clientUpdatedAt", () => {
  const older = makeMetadata("2026-03-08T09:00:00.000Z", "device-a", "operation-a");
  const newer = makeMetadata("2026-03-08T10:00:00.000Z", "device-a", "operation-a");

  assert.equal(incomingLwwMetadataWins(newer, older), true);
  assert.equal(incomingLwwMetadataWins(older, newer), false);
});

test("incomingLwwMetadataWins breaks ties by deviceId and operationId", () => {
  const sameTimeLowerDevice = makeMetadata("2026-03-08T10:00:00.000Z", "device-a", "operation-z");
  const sameTimeHigherDevice = makeMetadata("2026-03-08T10:00:00.000Z", "device-b", "operation-a");
  const sameTimeSameDeviceHigherOperation = makeMetadata("2026-03-08T10:00:00.000Z", "device-b", "operation-b");

  assert.equal(compareLwwMetadata(sameTimeHigherDevice, sameTimeLowerDevice) > 0, true);
  assert.equal(compareLwwMetadata(sameTimeSameDeviceHigherOperation, sameTimeHigherDevice) > 0, true);
});

test("normalizeIsoTimestamp normalizes valid timestamps and rejects invalid values", () => {
  assert.equal(
    normalizeIsoTimestamp("2026-03-08T10:15:00+02:00", "clientUpdatedAt"),
    "2026-03-08T08:15:00.000Z",
  );

  assert.throws(
    () => normalizeIsoTimestamp("not-a-date", "clientUpdatedAt"),
    /clientUpdatedAt must be a valid ISO timestamp/,
  );
});
