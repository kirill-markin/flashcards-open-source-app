import assert from "node:assert/strict";
import type pg from "pg";

export const testPackageId = "11111111-1111-4111-8111-111111111111";
export const testAuthorId = "22222222-2222-4222-8222-222222222222";
export const testPackageVersionId = "33333333-3333-4333-8333-333333333333";
export const testMediaBlobId = "44444444-4444-4444-8444-444444444444";
export const testPackageMediaAssetId = "55555555-5555-4555-8555-555555555555";
export const testWorkspaceId = "66666666-6666-4666-8666-666666666666";
export const testWorkspaceCardId = "77777777-7777-4777-8777-777777777777";
export const testWorkspaceMediaAssetId = "88888888-8888-4888-8888-888888888888";
export const testTimestamp = "2026-04-18T10:00:00.000Z";

export const testPackageMediaKey = "media-1";

export function createQueryResult<Row extends pg.QueryResultRow>(rows: ReadonlyArray<Row>): pg.QueryResult<Row> {
  return {
    command: "SELECT",
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows: [...rows],
  };
}

export function assertPublicPayloadDoesNotContainUnsafeMediaReferences(payload: unknown): void {
  const testSecondWorkspaceMediaAssetId = "99999999-9999-4999-8999-999999999999";
  const unsafeShaPackageMediaKey = "a".repeat(64);
  const unsafeStorageKeyLikePackageMediaKey = `media.blobs.sha256.aa.aa.${unsafeShaPackageMediaKey}`;
  const payloadJson = JSON.stringify(payload);
  const normalizedPayloadJson = payloadJson.toLowerCase();
  assert.doesNotMatch(payloadJson, new RegExp(testWorkspaceMediaAssetId, "i"));
  assert.doesNotMatch(payloadJson, new RegExp(testSecondWorkspaceMediaAssetId, "i"));
  assert.doesNotMatch(payloadJson, /media[/._-]blobs[/._-]sha256/i);
  assert.equal(normalizedPayloadJson.includes(unsafeShaPackageMediaKey), false);
  assert.equal(normalizedPayloadJson.includes(unsafeStorageKeyLikePackageMediaKey), false);
}
