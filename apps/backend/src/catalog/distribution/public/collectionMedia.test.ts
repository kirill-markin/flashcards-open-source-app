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

const catalogMediaCdnBaseUrl = "https://cdn.example.test";
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
  sha256: coverSha256,
};

const publishedCoverObjectUrl = `${catalogMediaCdnBaseUrl}/catalog/media/${coverSha256}`;

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

test("public collection cover routes name and redirect to the published CDN object", async () => {
  let lookupCount = 0;
  const app = createPublicCatalogRouteTestApp(createCatalogPublicRoutes({
    resolveCatalogMediaCdnBaseUrlFn: () => catalogMediaCdnBaseUrl,
    loadPublicCatalogCollectionCoverForDownloadFn: async (requestedCollectionId) => {
      lookupCount += 1;
      assert.equal(requestedCollectionId, collectionId);
      return collectionCoverDownloadSource;
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
      url: publishedCoverObjectUrl,
      expiresAt: null,
      rangeRequests: false,
    },
  });
  assert.doesNotMatch(
    JSON.stringify(urlPayload),
    /coverMediaBlobId|mediaBlobId|storageKey|storage_key|media\/blobs/,
  );

  const redirectResponse = await app.request(
    `http://localhost:8080/catalog/collections/${collectionId}/cover/download`,
  );
  assert.equal(redirectResponse.status, 302);
  assert.equal(lookupCount, 2);
  assert.equal(redirectResponse.headers.get("location"), publishedCoverObjectUrl);
  assert.equal(redirectResponse.headers.get("cache-control"), "public, no-cache");
});

test("public collection cover redirect keeps the published lookup on every request", async () => {
  const app = createPublicCatalogRouteTestApp(createCatalogPublicRoutes({
    resolveCatalogMediaCdnBaseUrlFn: () => catalogMediaCdnBaseUrl,
    loadPublicCatalogCollectionCoverForDownloadFn: async () => {
      throw new HttpError(
        404,
        `Published catalog collection cover not found. collectionId=${collectionId}`,
        "CATALOG_PUBLIC_COLLECTION_COVER_NOT_FOUND",
      );
    },
  }));

  const response = await app.request(
    `http://localhost:8080/catalog/collections/${collectionId}/cover/download`,
  );
  const payload = await response.json() as Readonly<Record<string, unknown>>;
  assert.equal(response.status, 404);
  assert.equal(payload.code, "CATALOG_PUBLIC_COLLECTION_COVER_NOT_FOUND");
  assert.equal(response.headers.get("location"), null);
});
