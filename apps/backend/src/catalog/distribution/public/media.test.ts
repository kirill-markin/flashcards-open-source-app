import assert from "node:assert/strict";
import test from "node:test";
import type pg from "pg";
import type { DatabaseExecutor, SqlValue } from "../../../database";
import { createCatalogPublicRoutes } from "../../../routes/catalog/public";
import { HttpError } from "../../../shared/errors";
import {
  loadPublicCatalogPackageMediaForDownloadInExecutor,
} from "./index";
import {
  assertPublicPayloadDoesNotContainUnsafeMediaReferences,
  createQueryResult,
  testPackageVersionId,
} from "../../testSupport";
import type { CatalogPublicPackageMediaAsset } from "../../types";
import {
  createPublicCatalogRouteTestApp,
  createPublicMediaAssetRow,
  unsafePublicPackageMediaKeyFixtures,
} from "./testSupport";

const catalogMediaCdnBaseUrl = "https://cdn.example.test";
const realisticBlobSha256 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const realisticBlobStorageKey = `media/blobs/sha256/aa/aa/${realisticBlobSha256}`;
const publishedObjectUrl = `${catalogMediaCdnBaseUrl}/catalog/media/${realisticBlobSha256}`;

function createMediaAsset(
  overrides: Partial<CatalogPublicPackageMediaAsset> = {},
): CatalogPublicPackageMediaAsset {
  const packageMediaKey = overrides.packageMediaKey ?? "cover";
  return {
    packageVersionId: testPackageVersionId,
    packageMediaKey,
    altText: "Cover image",
    credit: null,
    license: "CC-BY-4.0",
    mimeType: "image/jpeg",
    sizeBytes: 1234,
    downloadUrl: publishedObjectUrl,
    downloadUrlPath: `/catalog/package-versions/${testPackageVersionId}/media-assets/${packageMediaKey}/download-url`,
    ...overrides,
  };
}

test("public catalog media download lookup authorizes by package media key and addresses the CDN object", async () => {
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
      assert.doesNotMatch(text, /media_blobs\.storage_key/);
      assert.deepEqual(params, [testPackageVersionId, "cover"]);
      return createQueryResult([createPublicMediaAssetRow() as unknown as Row]);
    },
  };

  const mediaDownloadSource = await loadPublicCatalogPackageMediaForDownloadInExecutor(
    executor,
    testPackageVersionId,
    "cover",
    catalogMediaCdnBaseUrl,
  );

  assert.deepEqual(mediaDownloadSource.mediaAsset, createMediaAsset());
  assert.doesNotMatch(
    JSON.stringify(mediaDownloadSource.mediaAsset),
    new RegExp(realisticBlobStorageKey),
  );
  assert.doesNotMatch(
    JSON.stringify(mediaDownloadSource.mediaAsset),
    /mediaBlobId|storageKey|storage_key/,
  );
});

test("public catalog media download lookup gives no CDN URL to media the catalog cannot deliver", async () => {
  const executor: DatabaseExecutor = {
    async query<Row extends pg.QueryResultRow>(): Promise<pg.QueryResult<Row>> {
      return createQueryResult([{
        ...createPublicMediaAssetRow(),
        mime_type: "text/plain",
      } as unknown as Row]);
    },
  };

  const mediaDownloadSource = await loadPublicCatalogPackageMediaForDownloadInExecutor(
    executor,
    testPackageVersionId,
    "cover",
    catalogMediaCdnBaseUrl,
  );

  assert.equal(mediaDownloadSource.mediaAsset.downloadUrl, null);
  assert.equal(
    mediaDownloadSource.mediaAsset.downloadUrlPath,
    `/catalog/package-versions/${testPackageVersionId}/media-assets/cover/download-url`,
  );
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
        catalogMediaCdnBaseUrl,
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

test("public catalog media download URL route returns the CDN object URL without storage internals", async () => {
  const oldLeakySignedS3Url = `https://media-bucket.s3.amazonaws.com/${realisticBlobStorageKey}?X-Amz-Signature=abc`;
  let requestedPackageMediaKey: string | null = null;
  let requestedCdnBaseUrl: string | null = null;
  const mediaAsset = createMediaAsset();
  const app = createPublicCatalogRouteTestApp(createCatalogPublicRoutes({
    resolveCatalogMediaCdnBaseUrlFn: () => catalogMediaCdnBaseUrl,
    loadPublicCatalogPackageMediaForDownloadFn: async (
      packageVersionId,
      packageMediaKey,
      cdnBaseUrl,
    ) => {
      assert.equal(packageVersionId, testPackageVersionId);
      requestedPackageMediaKey = packageMediaKey;
      requestedCdnBaseUrl = cdnBaseUrl;
      return { mediaAsset };
    },
  }));

  const response = await app.request(
    `http://localhost:8080/catalog/package-versions/${testPackageVersionId}/media-assets/cover/download-url`,
  );
  const payload = await response.json() as Readonly<Record<string, unknown>>;

  assert.equal(response.status, 200);
  assert.equal(requestedPackageMediaKey, "cover");
  assert.equal(requestedCdnBaseUrl, catalogMediaCdnBaseUrl);
  const payloadJson = JSON.stringify(payload);
  assert.doesNotMatch(payloadJson, /media\/blobs|storageKey|storage_key|mediaBlobId/);
  assert.doesNotMatch(payloadJson, new RegExp(realisticBlobStorageKey));
  assert.doesNotMatch(payloadJson, new RegExp(oldLeakySignedS3Url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.deepEqual(payload, {
    mediaAsset,
    download: {
      method: "GET",
      url: publishedObjectUrl,
      expiresAt: null,
      rangeRequests: false,
    },
  });
});

test("public catalog media routes reject unsafe media keys without echoing private values", async () => {
  let lookupCount = 0;
  const app = createPublicCatalogRouteTestApp(createCatalogPublicRoutes({
    resolveCatalogMediaCdnBaseUrlFn: () => catalogMediaCdnBaseUrl,
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

const cdnRedirectFixtures = [
  ["image", "cover", "image/jpeg"],
  ["supported non-image", "guide", "application/pdf"],
] as const;

for (const [label, packageMediaKey, mimeType] of cdnRedirectFixtures) {
  test(`public catalog media download route redirects ${label} media to the CDN object`, async () => {
    let lookupCount = 0;
    const app = createPublicCatalogRouteTestApp(createCatalogPublicRoutes({
      resolveCatalogMediaCdnBaseUrlFn: () => catalogMediaCdnBaseUrl,
      loadPublicCatalogPackageMediaForDownloadFn: async (
        requestedPackageVersionId,
        requestedPackageMediaKey,
      ) => {
        lookupCount += 1;
        assert.equal(requestedPackageVersionId, testPackageVersionId);
        assert.equal(requestedPackageMediaKey, packageMediaKey);
        return { mediaAsset: createMediaAsset({ packageMediaKey, mimeType }) };
      },
    }));

    const response = await app.request(
      `http://localhost/catalog/package-versions/${testPackageVersionId}/media-assets/${packageMediaKey}/download`,
    );

    assert.equal(response.status, 302);
    assert.equal(lookupCount, 1);
    assert.equal(response.headers.get("location"), publishedObjectUrl);
    assert.equal(response.headers.get("cache-control"), "public, no-cache");
  });
}

test("public catalog media routes reject unsupported MIME types instead of redirecting", async () => {
  let lookupCount = 0;
  const app = createPublicCatalogRouteTestApp(createCatalogPublicRoutes({
    resolveCatalogMediaCdnBaseUrlFn: () => catalogMediaCdnBaseUrl,
    loadPublicCatalogPackageMediaForDownloadFn: async (packageVersionId, packageMediaKey) => {
      lookupCount += 1;
      assert.equal(packageVersionId, testPackageVersionId);
      assert.equal(packageMediaKey, "notes");
      return {
        mediaAsset: createMediaAsset({
          packageMediaKey: "notes",
          mimeType: "text/plain",
          sizeBytes: 4,
          downloadUrl: null,
        }),
      };
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
});

test("public catalog media routes reject objects the catalog never published to the CDN", async () => {
  let lookupCount = 0;
  const app = createPublicCatalogRouteTestApp(createCatalogPublicRoutes({
    resolveCatalogMediaCdnBaseUrlFn: () => catalogMediaCdnBaseUrl,
    loadPublicCatalogPackageMediaForDownloadFn: async (packageVersionId, packageMediaKey) => {
      lookupCount += 1;
      assert.equal(packageVersionId, testPackageVersionId);
      assert.equal(packageMediaKey, "cover");
      return {
        mediaAsset: createMediaAsset({ sizeBytes: 4_500_001, downloadUrl: null }),
      };
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
});

test("public catalog media download route refuses to redirect an unaddressable object", async () => {
  const app = createPublicCatalogRouteTestApp(createCatalogPublicRoutes({
    resolveCatalogMediaCdnBaseUrlFn: () => catalogMediaCdnBaseUrl,
    loadPublicCatalogPackageMediaForDownloadFn: async () => ({
      mediaAsset: createMediaAsset({ downloadUrl: null }),
    }),
  }));

  const response = await app.request(
    `http://localhost/catalog/package-versions/${testPackageVersionId}/media-assets/cover/download`,
  );
  const payload = await response.json() as Readonly<Record<string, unknown>>;

  assert.equal(response.status, 409);
  assert.equal(payload.code, "CATALOG_PUBLIC_MEDIA_OBJECT_NOT_ADDRESSABLE");
  assert.equal(response.headers.get("location"), null);
});
