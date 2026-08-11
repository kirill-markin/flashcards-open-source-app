import assert from "node:assert/strict";
import test from "node:test";
import type pg from "pg";
import type { DatabaseExecutor, SqlValue } from "../../../database";
import { createCatalogPublicRoutes } from "../../../routes/catalog/public";
import { HttpError } from "../../../shared/errors";
import { maximumPublicCatalogMediaDownloadBytes } from "../../publicMediaDelivery";
import { createQueryResult } from "../../testSupport";
import type { CatalogPublicCollectionCoverDownloadSource } from "../../types";
import {
  loadPublicCatalogCollectionCoverForDownloadInExecutor,
} from "./index";
import { createPublicCatalogRouteTestApp } from "./testSupport";

const collectionId = "99999999-1111-4111-8111-111111111111";
const coverMediaBlobId = "99999999-2222-4222-8222-222222222222";
const coverSha256 = "b".repeat(64);
const coverStorageKey = `media/blobs/sha256/bb/bb/${coverSha256}`;

const collectionCoverRow = {
  collection_id: collectionId,
  cover_media_blob_id: coverMediaBlobId,
  mime_type: "image/jpeg",
  size_bytes: 3,
  storage_key: coverStorageKey,
  sha256: coverSha256,
} as const;

const collectionCoverDownloadSource: CatalogPublicCollectionCoverDownloadSource = {
  collectionCover: {
    collectionId,
    mimeType: "image/jpeg",
    sizeBytes: 3,
  },
  storageKey: coverStorageKey,
  sha256: coverSha256,
};

test("public collection cover lookup requires public visibility and keeps private storage internal", async () => {
  const executor: DatabaseExecutor = {
    async query<Row extends pg.QueryResultRow>(
      text: string,
      params: ReadonlyArray<SqlValue>,
    ): Promise<pg.QueryResult<Row>> {
      assert.match(text, /collections\.collection_id = \$1/);
      assert.match(text, /collections\.status = 'published'/);
      assert.match(text, /collections\.delisted_at IS NULL/);
      assert.match(text, /LEFT JOIN content\.media_blobs AS media_blobs/);
      assert.deepEqual(params, [collectionId]);
      return createQueryResult([collectionCoverRow as unknown as Row]);
    },
  };

  const source = await loadPublicCatalogCollectionCoverForDownloadInExecutor(
    executor,
    collectionId,
  );

  assert.deepEqual(source, collectionCoverDownloadSource);
  assert.doesNotMatch(
    JSON.stringify(source.collectionCover),
    /coverMediaBlobId|mediaBlobId|storageKey|storage_key|media\/blobs|sha256/,
  );
});

const unavailableCoverFixtures = [
  {
    name: "unpublished, delisted, or missing collection",
    rows: [],
    statusCode: 404,
    code: "CATALOG_PUBLIC_COLLECTION_COVER_NOT_FOUND",
  },
  {
    name: "collection without an independent cover",
    rows: [{
      ...collectionCoverRow,
      cover_media_blob_id: null,
      mime_type: null,
      size_bytes: null,
      storage_key: null,
      sha256: null,
    }],
    statusCode: 404,
    code: "CATALOG_PUBLIC_COLLECTION_COVER_NOT_FOUND",
  },
  {
    name: "missing referenced media blob",
    rows: [{
      ...collectionCoverRow,
      mime_type: null,
      size_bytes: null,
      storage_key: null,
      sha256: null,
    }],
    statusCode: 409,
    code: "CATALOG_PUBLIC_COLLECTION_COVER_MEDIA_NOT_FOUND",
  },
  {
    name: "unsupported media type",
    rows: [{ ...collectionCoverRow, mime_type: "text/plain" }],
    statusCode: 415,
    code: "CATALOG_PUBLIC_COLLECTION_COVER_UNSUPPORTED_TYPE",
  },
  {
    name: "oversized media",
    rows: [{
      ...collectionCoverRow,
      size_bytes: maximumPublicCatalogMediaDownloadBytes + 1,
    }],
    statusCode: 413,
    code: "CATALOG_PUBLIC_COLLECTION_COVER_TOO_LARGE",
  },
  {
    name: "non-canonical private storage",
    rows: [{ ...collectionCoverRow, storage_key: "media/uploads/private-cover" }],
    statusCode: 409,
    code: "CATALOG_PUBLIC_COLLECTION_COVER_STORAGE_INVALID",
  },
] as const;

for (const fixture of unavailableCoverFixtures) {
  test(`public collection cover lookup rejects ${fixture.name} specifically`, async () => {
    const executor: DatabaseExecutor = {
      async query<Row extends pg.QueryResultRow>(
        text: string,
        params: ReadonlyArray<SqlValue>,
      ): Promise<pg.QueryResult<Row>> {
        assert.match(text, /collections\.status = 'published'/);
        assert.match(text, /collections\.delisted_at IS NULL/);
        assert.deepEqual(params, [collectionId]);
        return createQueryResult(fixture.rows as unknown as ReadonlyArray<Row>);
      },
    };

    await assert.rejects(
      loadPublicCatalogCollectionCoverForDownloadInExecutor(executor, collectionId),
      (error: unknown) => {
        assert.ok(error instanceof HttpError);
        assert.equal(error.statusCode, fixture.statusCode);
        assert.equal(error.code, fixture.code);
        assert.doesNotMatch(
          error.message,
          /coverMediaBlobId|mediaBlobId|storageKey|storage_key|media\/blobs|sha256/,
        );
        return true;
      },
    );
  });
}

test("public collection cover routes return a backend URL and proxy verified bytes", async () => {
  let lookupCount = 0;
  let loadedStorageKey: string | null = null;
  const app = createPublicCatalogRouteTestApp(createCatalogPublicRoutes({
    loadPublicCatalogCollectionCoverForDownloadFn: async (requestedCollectionId) => {
      lookupCount += 1;
      assert.equal(requestedCollectionId, collectionId);
      return collectionCoverDownloadSource;
    },
    loadMediaAssetObjectBytesFn: async (input) => {
      loadedStorageKey = input.storageKey;
      assert.equal(input.workspaceId, collectionId);
      assert.equal(input.mediaAssetId, "cover");
      assert.equal(input.mimeType, "image/jpeg");
      assert.equal(input.sizeBytes, 3);
      assert.equal(input.sha256, coverSha256);
      assert.equal(input.maxByteSize, maximumPublicCatalogMediaDownloadBytes);
      return {
        bytes: Buffer.from([1, 2, 3]),
        mimeType: "image/jpeg",
        sizeBytes: 3,
        sha256: coverSha256,
      };
    },
  }));

  const urlResponse = await app.request(
    `http://localhost:8080/catalog/collections/${collectionId}/cover/download-url`,
  );
  const urlPayload = await urlResponse.json() as Readonly<Record<string, unknown>>;
  assert.equal(urlResponse.status, 200);
  assert.deepEqual(urlPayload, {
    collectionCover: collectionCoverDownloadSource.collectionCover,
    download: {
      method: "GET",
      url: `http://localhost:8080/v1/catalog/collections/${collectionId}/cover/download`,
      expiresAt: null,
      rangeRequests: false,
    },
  });
  assert.doesNotMatch(
    JSON.stringify(urlPayload),
    /coverMediaBlobId|mediaBlobId|storageKey|storage_key|media\/blobs|sha256/,
  );

  const bytesResponse = await app.request(
    `http://localhost:8080/catalog/collections/${collectionId}/cover/download`,
  );
  assert.equal(bytesResponse.status, 200);
  assert.equal(lookupCount, 2);
  assert.equal(loadedStorageKey, coverStorageKey);
  assert.equal(bytesResponse.headers.get("content-type"), "image/jpeg");
  assert.equal(bytesResponse.headers.get("content-length"), "3");
  assert.deepEqual(Buffer.from(await bytesResponse.arrayBuffer()), Buffer.from([1, 2, 3]));
});

test("public collection cover byte route maps a missing private object to a catalog error", async () => {
  const app = createPublicCatalogRouteTestApp(createCatalogPublicRoutes({
    loadPublicCatalogCollectionCoverForDownloadFn: async () => collectionCoverDownloadSource,
    loadMediaAssetObjectBytesFn: async () => {
      throw new HttpError(
        409,
        `Completed media upload is not available for workspaceId=${collectionId} mediaAssetId=cover.`,
        "MEDIA_ASSET_UPLOAD_NOT_FOUND",
      );
    },
  }));

  const response = await app.request(
    `http://localhost:8080/catalog/collections/${collectionId}/cover/download`,
  );
  const payload = await response.json() as Readonly<Record<string, unknown>>;
  assert.equal(response.status, 409);
  assert.equal(payload.code, "CATALOG_PUBLIC_COLLECTION_COVER_OBJECT_NOT_FOUND");
  assert.doesNotMatch(
    JSON.stringify(payload),
    /coverMediaBlobId|mediaBlobId|storageKey|storage_key|media\/blobs|sha256/,
  );
});
