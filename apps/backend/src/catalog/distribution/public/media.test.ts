import assert from "node:assert/strict";
import test from "node:test";
import type pg from "pg";
import type { DatabaseExecutor, SqlValue } from "../../../database";
import { createCatalogPublicRoutes } from "../../../routes/catalogPublic";
import { HttpError } from "../../../shared/errors";
import {
  loadPublicCatalogPackageMediaForDownloadInExecutor,
} from "./index";
import {
  assertPublicPayloadDoesNotContainUnsafeMediaReferences,
  createQueryResult,
  testPackageVersionId,
} from "../../testSupport";
import type { CatalogPublicPackageMediaDownloadSource } from "../../types";
import {
  createPublicCatalogRouteTestApp,
  createPublicMediaAssetRow,
  unsafePublicPackageMediaKeyFixtures,
} from "./testSupport";

test("public catalog media download lookup authorizes by package media key and keeps storage internal", async () => {
  const realisticBlobSha256 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const realisticBlobStorageKey = `media/blobs/sha256/aa/aa/${realisticBlobSha256}`;
  const executor: DatabaseExecutor = {
    async query<Row extends pg.QueryResultRow>(
      text: string,
      params: ReadonlyArray<SqlValue>,
    ): Promise<pg.QueryResult<Row>> {
      assert.match(text, /media_assets\.package_version_id = \$1/);
      assert.match(text, /media_assets\.package_media_key = \$2/);
      assert.match(text, /versions\.status = 'published'/);
      assert.match(text, /packages\.status = 'published'/);
      assert.match(text, /media_blobs\.sha256 AS sha256/);
      assert.deepEqual(params, [testPackageVersionId, "cover"]);
      return createQueryResult([{
        ...createPublicMediaAssetRow(),
        storage_key: realisticBlobStorageKey,
        sha256: realisticBlobSha256,
      } as unknown as Row]);
    },
  };

  const mediaDownloadSource = await loadPublicCatalogPackageMediaForDownloadInExecutor(
    executor,
    testPackageVersionId,
    "cover",
  );

  assert.equal(mediaDownloadSource.storageKey, realisticBlobStorageKey);
  assert.equal(mediaDownloadSource.sha256, realisticBlobSha256);
  assert.deepEqual(mediaDownloadSource.mediaAsset, {
    packageVersionId: testPackageVersionId,
    packageMediaKey: "cover",
    altText: "Cover image",
    credit: null,
    license: "CC-BY-4.0",
    mimeType: "image/jpeg",
    sizeBytes: 1234,
    downloadUrlPath: `/catalog/package-versions/${testPackageVersionId}/media-assets/cover/download-url`,
  });
  assert.doesNotMatch(JSON.stringify(mediaDownloadSource.mediaAsset), /mediaBlobId|storageKey|storage_key|sha256/);
});

for (const [unsafeKeyLabel, unsafePackageMediaKey] of unsafePublicPackageMediaKeyFixtures) {
  test(`public catalog media download lookup rejects ${unsafeKeyLabel} media keys before query`, async () => {
    let queryCount = 0;
    const executor: DatabaseExecutor = {
      async query<Row extends pg.QueryResultRow>(
        _text: string,
        _params: ReadonlyArray<SqlValue>,
      ): Promise<pg.QueryResult<Row>> {
        queryCount += 1;
        throw new Error("Unsafe public package media keys should be rejected before query");
      },
    };

    await assert.rejects(
      loadPublicCatalogPackageMediaForDownloadInExecutor(
        executor,
        testPackageVersionId,
        unsafePackageMediaKey,
      ),
      (error: unknown) => {
        assert.equal(error instanceof HttpError, true);
        assert.equal((error as HttpError).statusCode, 409);
        assert.equal((error as HttpError).code, "CATALOG_PUBLIC_MEDIA_KEY_NOT_PUBLIC");
        assertPublicPayloadDoesNotContainUnsafeMediaReferences({ error: (error as HttpError).message });
        return true;
      },
    );
    assert.equal(queryCount, 0);
  });
}

test("public catalog media download URL route returns only a backend API URL without storage internals", async () => {
  const realisticBlobSha256 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const realisticBlobStorageKey = `media/blobs/sha256/aa/aa/${realisticBlobSha256}`;
  const oldLeakySignedS3Url = `https://media-bucket.s3.amazonaws.com/${realisticBlobStorageKey}?X-Amz-Signature=abc`;
  let requestedPackageMediaKey: string | null = null;
  const mediaDownloadSource: CatalogPublicPackageMediaDownloadSource = {
    mediaAsset: {
      packageVersionId: testPackageVersionId,
      packageMediaKey: "cover",
      altText: "Cover image",
      credit: null,
      license: "CC-BY-4.0",
      mimeType: "image/jpeg",
      sizeBytes: 1234,
      downloadUrlPath: `/catalog/package-versions/${testPackageVersionId}/media-assets/cover/download-url`,
    },
    storageKey: realisticBlobStorageKey,
    sha256: realisticBlobSha256,
  };
  const app = createPublicCatalogRouteTestApp(createCatalogPublicRoutes({
    loadPublicCatalogPackageMediaForDownloadFn: async (packageVersionId, packageMediaKey) => {
      assert.equal(packageVersionId, testPackageVersionId);
      requestedPackageMediaKey = packageMediaKey;
      return mediaDownloadSource;
    },
  }));

  const response = await app.request(
    `http://localhost:8080/catalog/package-versions/${testPackageVersionId}/media-assets/cover/download-url`,
  );
  const payload = await response.json() as Readonly<Record<string, unknown>>;

  assert.equal(response.status, 200);
  assert.equal(requestedPackageMediaKey, "cover");
  const payloadJson = JSON.stringify(payload);
  assert.doesNotMatch(payloadJson, /media\/blobs|storageKey|storage_key|mediaBlobId|sha256/);
  assert.doesNotMatch(payloadJson, new RegExp(realisticBlobSha256));
  assert.doesNotMatch(payloadJson, new RegExp(oldLeakySignedS3Url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.deepEqual(payload, {
    mediaAsset: mediaDownloadSource.mediaAsset,
    download: {
      method: "GET",
      url: `http://localhost:8080/v1/catalog/package-versions/${testPackageVersionId}/media-assets/cover/download`,
      expiresAt: null,
      rangeRequests: false,
    },
  });
});

test("public catalog media routes reject unsafe media keys without echoing private values", async () => {
  let lookupCount = 0;
  const app = createPublicCatalogRouteTestApp(createCatalogPublicRoutes({
    loadPublicCatalogPackageMediaForDownloadFn: async () => {
      lookupCount += 1;
      throw new Error("Private workspace-derived package media keys should be rejected before lookup");
    },
  }));

  for (const [, unsafePackageMediaKey] of unsafePublicPackageMediaKeyFixtures) {
    for (const routeSuffix of ["download-url", "download"]) {
      const response = await app.request(
        `http://localhost/catalog/package-versions/${testPackageVersionId}/media-assets/${unsafePackageMediaKey}/${routeSuffix}`,
      );
      const payload = await response.json() as Readonly<Record<string, unknown>>;

      assert.equal(response.status, 400);
      assert.equal(payload.code, "CATALOG_PUBLIC_PARAM_INVALID");
      assertPublicPayloadDoesNotContainUnsafeMediaReferences(payload);
    }
  }
  assert.equal(lookupCount, 0);
});

test("public catalog media download route serves bytes through the backend", async () => {
  const realisticBlobSha256 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const realisticBlobStorageKey = `media/blobs/sha256/aa/aa/${realisticBlobSha256}`;
  let loadedStorageKey: string | null = null;
  const mediaDownloadSource: CatalogPublicPackageMediaDownloadSource = {
    mediaAsset: {
      packageVersionId: testPackageVersionId,
      packageMediaKey: "cover",
      altText: "Cover image",
      credit: null,
      license: "CC-BY-4.0",
      mimeType: "image/jpeg",
      sizeBytes: 3,
      downloadUrlPath: `/catalog/package-versions/${testPackageVersionId}/media-assets/cover/download-url`,
    },
    storageKey: realisticBlobStorageKey,
    sha256: realisticBlobSha256,
  };
  const app = createPublicCatalogRouteTestApp(createCatalogPublicRoutes({
    loadPublicCatalogPackageMediaForDownloadFn: async (packageVersionId, packageMediaKey) => {
      assert.equal(packageVersionId, testPackageVersionId);
      assert.equal(packageMediaKey, "cover");
      return mediaDownloadSource;
    },
    loadMediaAssetObjectBytesFn: async (input) => {
      loadedStorageKey = input.storageKey;
      assert.equal(input.workspaceId, testPackageVersionId);
      assert.equal(input.mediaAssetId, "cover");
      assert.equal(input.mimeType, "image/jpeg");
      assert.equal(input.sizeBytes, 3);
      assert.equal(input.sha256, realisticBlobSha256);
      return {
        bytes: Buffer.from([1, 2, 3]),
        mimeType: "image/jpeg",
        sizeBytes: 3,
        sha256: realisticBlobSha256,
      };
    },
  }));

  const response = await app.request(
    `http://localhost/catalog/package-versions/${testPackageVersionId}/media-assets/cover/download`,
  );

  assert.equal(response.status, 200);
  assert.equal(loadedStorageKey, realisticBlobStorageKey);
  assert.equal(response.headers.get("content-type"), "image/jpeg");
  assert.equal(response.headers.get("content-length"), "3");
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), Buffer.from([1, 2, 3]));
});

test("public catalog media download route serves supported non-image bytes through the backend", async () => {
  const realisticBlobSha256 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const realisticBlobStorageKey = `media/blobs/sha256/aa/aa/${realisticBlobSha256}`;
  let loadedMimeType: string | null = null;
  const mediaDownloadSource: CatalogPublicPackageMediaDownloadSource = {
    mediaAsset: {
      packageVersionId: testPackageVersionId,
      packageMediaKey: "guide",
      altText: "PDF guide",
      credit: null,
      license: "CC-BY-4.0",
      mimeType: "application/pdf",
      sizeBytes: 4,
      downloadUrlPath: `/catalog/package-versions/${testPackageVersionId}/media-assets/guide/download-url`,
    },
    storageKey: realisticBlobStorageKey,
    sha256: realisticBlobSha256,
  };
  const app = createPublicCatalogRouteTestApp(createCatalogPublicRoutes({
    loadPublicCatalogPackageMediaForDownloadFn: async (packageVersionId, packageMediaKey) => {
      assert.equal(packageVersionId, testPackageVersionId);
      assert.equal(packageMediaKey, "guide");
      return mediaDownloadSource;
    },
    loadMediaAssetObjectBytesFn: async (input) => {
      loadedMimeType = input.mimeType;
      assert.equal(input.sha256, realisticBlobSha256);
      return {
        bytes: Buffer.from([0x25, 0x50, 0x44, 0x46]),
        mimeType: "application/pdf",
        sizeBytes: 4,
        sha256: realisticBlobSha256,
      };
    },
  }));

  const response = await app.request(
    `http://localhost/catalog/package-versions/${testPackageVersionId}/media-assets/guide/download`,
  );

  assert.equal(response.status, 200);
  assert.equal(loadedMimeType, "application/pdf");
  assert.equal(response.headers.get("content-type"), "application/pdf");
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), Buffer.from([0x25, 0x50, 0x44, 0x46]));
});

test("public catalog media routes reject unsupported MIME types before download", async () => {
  const realisticBlobStorageKey = "media/blobs/sha256/aa/aa/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  let lookupCount = 0;
  let bytesLoaded = false;
  const mediaDownloadSource: CatalogPublicPackageMediaDownloadSource = {
    mediaAsset: {
      packageVersionId: testPackageVersionId,
      packageMediaKey: "notes",
      altText: "Notes",
      credit: null,
      license: "CC-BY-4.0",
      mimeType: "text/plain",
      sizeBytes: 4,
      downloadUrlPath: `/catalog/package-versions/${testPackageVersionId}/media-assets/notes/download-url`,
    },
    storageKey: realisticBlobStorageKey,
    sha256: "a".repeat(64),
  };
  const app = createPublicCatalogRouteTestApp(createCatalogPublicRoutes({
    loadPublicCatalogPackageMediaForDownloadFn: async (packageVersionId, packageMediaKey) => {
      lookupCount += 1;
      assert.equal(packageVersionId, testPackageVersionId);
      assert.equal(packageMediaKey, "notes");
      return mediaDownloadSource;
    },
    loadMediaAssetObjectBytesFn: async () => {
      bytesLoaded = true;
      throw new Error("Unsupported public catalog media should fail before object byte load");
    },
  }));

  for (const routeSuffix of ["download-url", "download"]) {
    const response = await app.request(
      `http://localhost/catalog/package-versions/${testPackageVersionId}/media-assets/notes/${routeSuffix}`,
    );
    const payload = await response.json() as Readonly<Record<string, unknown>>;
    const payloadJson = JSON.stringify(payload);

    assert.equal(response.status, 415);
    assert.equal(payload.code, "CATALOG_PUBLIC_MEDIA_DOWNLOAD_UNSUPPORTED_TYPE");
    assert.match(String(payload.error), /mimeType=text\/plain/);
    assert.doesNotMatch(payloadJson, /media\/blobs|storageKey|storage_key|mediaBlobId|sha256/);
  }
  assert.equal(lookupCount, 2);
  assert.equal(bytesLoaded, false);
});

test("public catalog media download route rejects hash mismatches without exposing hashes", async () => {
  const realisticBlobSha256 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const realisticBlobStorageKey = `media/blobs/sha256/aa/aa/${realisticBlobSha256}`;
  let receivedSha256: string | null = null;
  const mediaDownloadSource: CatalogPublicPackageMediaDownloadSource = {
    mediaAsset: {
      packageVersionId: testPackageVersionId,
      packageMediaKey: "cover",
      altText: "Cover image",
      credit: null,
      license: "CC-BY-4.0",
      mimeType: "image/jpeg",
      sizeBytes: 3,
      downloadUrlPath: `/catalog/package-versions/${testPackageVersionId}/media-assets/cover/download-url`,
    },
    storageKey: realisticBlobStorageKey,
    sha256: realisticBlobSha256,
  };
  const app = createPublicCatalogRouteTestApp(createCatalogPublicRoutes({
    loadPublicCatalogPackageMediaForDownloadFn: async () => mediaDownloadSource,
    loadMediaAssetObjectBytesFn: async (input) => {
      receivedSha256 = input.sha256;
      throw new HttpError(
        409,
        "Media asset object bytes do not match expected metadata workspaceId=public mediaAssetId=cover mismatchedFields=sha256",
        "MEDIA_ASSET_OBJECT_BYTES_MISMATCH",
      );
    },
  }));

  const response = await app.request(
    `http://localhost/catalog/package-versions/${testPackageVersionId}/media-assets/cover/download`,
  );
  const payload = await response.json() as Readonly<Record<string, unknown>>;
  const payloadJson = JSON.stringify(payload);

  assert.equal(response.status, 409);
  assert.equal(receivedSha256, realisticBlobSha256);
  assert.equal(payload.code, "MEDIA_ASSET_OBJECT_BYTES_MISMATCH");
  assert.doesNotMatch(payloadJson, new RegExp(realisticBlobSha256));
  assert.doesNotMatch(payloadJson, /media\/blobs|storageKey|storage_key|mediaBlobId/);
});

test("public catalog media routes reject objects too large for backend proxy delivery", async () => {
  const realisticBlobStorageKey = "media/blobs/sha256/aa/aa/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  let lookupCount = 0;
  let bytesLoaded = false;
  const mediaDownloadSource: CatalogPublicPackageMediaDownloadSource = {
    mediaAsset: {
      packageVersionId: testPackageVersionId,
      packageMediaKey: "cover",
      altText: "Cover image",
      credit: null,
      license: "CC-BY-4.0",
      mimeType: "image/jpeg",
      sizeBytes: 4_500_001,
      downloadUrlPath: `/catalog/package-versions/${testPackageVersionId}/media-assets/cover/download-url`,
    },
    storageKey: realisticBlobStorageKey,
    sha256: "a".repeat(64),
  };
  const app = createPublicCatalogRouteTestApp(createCatalogPublicRoutes({
    loadPublicCatalogPackageMediaForDownloadFn: async (packageVersionId, packageMediaKey) => {
      lookupCount += 1;
      assert.equal(packageVersionId, testPackageVersionId);
      assert.equal(packageMediaKey, "cover");
      return mediaDownloadSource;
    },
    loadMediaAssetObjectBytesFn: async () => {
      bytesLoaded = true;
      throw new Error("Oversized public catalog media should fail before object byte load");
    },
  }));

  for (const routeSuffix of ["download-url", "download"]) {
    const response = await app.request(
      `http://localhost/catalog/package-versions/${testPackageVersionId}/media-assets/cover/${routeSuffix}`,
    );
    const payload = await response.json() as Readonly<Record<string, unknown>>;
    const payloadJson = JSON.stringify(payload);

    assert.equal(response.status, 413);
    assert.equal(payload.code, "CATALOG_PUBLIC_MEDIA_DOWNLOAD_TOO_LARGE");
    assert.match(String(payload.error), /maxBytes=4500000/);
    assert.doesNotMatch(payloadJson, /media\/blobs|storageKey|storage_key|mediaBlobId|sha256/);
  }
  assert.equal(lookupCount, 2);
  assert.equal(bytesLoaded, false);
});

