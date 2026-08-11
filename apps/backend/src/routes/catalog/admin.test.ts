import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { AdminRequestContext } from "../../admin/authz";
import type {
  CatalogPackageMediaAsset,
  CatalogPackageVersion,
  CreateCatalogPackageVersionFromWorkspaceInput,
} from "../../catalog/types";
import type { CatalogPackageImageIngestionResult } from "../../catalog/authoring/imageIngestion";
import type { AppEnv } from "../../server/app";
import { HttpError } from "../../shared/errors";
import { createCatalogAdminRoutes } from "./admin";
import { createCatalogAdminImageIngestionRoutes } from "./adminImageIngestion";

const packageId = "11111111-1111-4111-8111-111111111111";
const packageVersionId = "22222222-2222-4222-8222-222222222222";
const cardId = "33333333-3333-4333-8333-333333333333";
const legacyWorkspaceId = "35274129-ef97-d366-954c-955b4bb0fbf0";

function createAdminRequestContext(): AdminRequestContext {
  return {
    email: "admin@example.com",
    transport: "session",
    userId: "admin-user-1",
    subjectUserId: "admin-subject-1",
    requestAuthInputs: {
      authorizationHeader: undefined,
      sessionToken: undefined,
      csrfTokenHeader: undefined,
      originHeader: undefined,
      refererHeader: undefined,
      secFetchSiteHeader: undefined,
    },
  };
}

function createCatalogPackageVersion(sourceWorkspaceId: string): CatalogPackageVersion {
  const timestamp = "2026-08-02T00:00:00.000Z";
  return {
    packageVersionId,
    packageId,
    versionNumber: 1,
    status: "draft",
    slug: "test-package-v1",
    title: "Test package",
    summary: "Test summary",
    description: "Test description",
    languageTags: [],
    topicTags: [],
    license: "CC-BY-4.0",
    contentWarning: null,
    coverPackageMediaKey: null,
    sourceWorkspaceId,
    cardCount: 1,
    createdByAdminEmail: "admin@example.com",
    reviewedByAdminEmail: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    submittedAt: null,
    reviewedAt: null,
    publishedAt: null,
    delistedAt: null,
  };
}

function createCatalogAdminTestApp(
  createVersion: (
    receivedPackageId: string,
    input: CreateCatalogPackageVersionFromWorkspaceInput,
    adminUserId: string,
    adminEmail: string,
  ) => Promise<CatalogPackageVersion>,
  authorize: () => Promise<AdminRequestContext>,
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.onError((error, context) => {
    if (error instanceof HttpError) {
      context.status(error.statusCode as ContentfulStatusCode);
      return context.json({ error: error.message, code: error.code });
    }

    throw error;
  });
  app.route("/", createCatalogAdminRoutes({
    allowedOrigins: [],
    requireAdminRequestFn: authorize,
    createCatalogPackageVersionFromWorkspaceSelectionFn: createVersion,
  }));
  return app;
}

test("POST catalog version from workspace normalizes a legacy PostgreSQL workspace ID", async () => {
  let authorizationChecks = 0;
  let processingCalls = 0;
  const app = createCatalogAdminTestApp(
    async (receivedPackageId, input, adminUserId, adminEmail) => {
      processingCalls += 1;
      assert.equal(receivedPackageId, packageId);
      assert.deepEqual(input, {
        packageVersionId,
        workspaceId: legacyWorkspaceId,
        cardIds: [cardId],
      });
      assert.equal(adminUserId, "admin-user-1");
      assert.equal(adminEmail, "admin@example.com");
      return createCatalogPackageVersion(input.workspaceId);
    },
    async () => {
      authorizationChecks += 1;
      return createAdminRequestContext();
    },
  );

  const response = await app.request(
    `http://localhost/admin/catalog/packages/${packageId}/versions/from-workspace`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        packageVersionId,
        workspaceId: ` \n${legacyWorkspaceId.toUpperCase()}\t`,
        cardIds: [cardId],
      }),
    },
  );

  assert.equal(response.status, 201);
  assert.equal(authorizationChecks, 1);
  assert.equal(processingCalls, 1);
  const payload = await response.json() as Readonly<{
    packageVersion: CatalogPackageVersion;
  }>;
  assert.equal(payload.packageVersion.sourceWorkspaceId, legacyWorkspaceId);
});

test("POST catalog version from workspace preserves malformed workspace errors", async () => {
  let authorizationChecks = 0;
  let processingCalls = 0;
  const app = createCatalogAdminTestApp(
    async () => {
      processingCalls += 1;
      return createCatalogPackageVersion(legacyWorkspaceId);
    },
    async () => {
      authorizationChecks += 1;
      return createAdminRequestContext();
    },
  );

  const response = await app.request(
    `http://localhost/admin/catalog/packages/${packageId}/versions/from-workspace`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        packageVersionId,
        workspaceId: "not-a-uuid",
        cardIds: [cardId],
      }),
    },
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "workspaceId must be a UUID",
    code: null,
  });
  assert.equal(authorizationChecks, 1);
  assert.equal(processingCalls, 0);
});

function createCatalogImageResult(packageMediaKey: string): CatalogPackageImageIngestionResult {
  const timestamp = "2026-08-11T00:00:00.000Z";
  const mediaAsset: CatalogPackageMediaAsset = {
    packageMediaAssetId: "44444444-4444-4444-8444-444444444444",
    packageId,
    packageVersionId: null,
    packageMediaKey,
    mediaBlobId: "55555555-5555-4555-8555-555555555555",
    altText: null,
    credit: null,
    license: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  return { mediaAsset, applied: true, mimeType: "image/jpeg", sizeBytes: 3 };
}

function createCatalogImageTestApp(
  authorize: () => Promise<AdminRequestContext>,
  ingestCard: (packageMediaKey: string, imageBytes: Buffer) => Promise<CatalogPackageImageIngestionResult>,
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("*", async (context, next) => {
    context.set("requestId", "request-1");
    context.set("clientAppVersion", null);
    context.set("clientPlatform", null);
    await next();
  });
  app.onError((error, context) => {
    if (error instanceof HttpError) {
      context.status(error.statusCode as ContentfulStatusCode);
      return context.json({ error: error.message, code: error.code });
    }
    throw error;
  });
  app.route("/", createCatalogAdminImageIngestionRoutes({
    allowedOrigins: [],
    requireAdminRequestFn: authorize,
    ingestCatalogPackageCardImageFn: async (input) => ingestCard(
      input.packageMediaKey,
      input.imageBytes,
    ),
    replaceCatalogPackageCoverImageFn: async () => createCatalogImageResult("cover"),
  }));
  return app;
}

test("catalog image routes authorize before validating raw bodies", async () => {
  let processingCalls = 0;
  const app = createCatalogImageTestApp(
    async () => {
      throw new HttpError(403, "Admin access required.", "ADMIN_ACCESS_REQUIRED");
    },
    async () => {
      processingCalls += 1;
      return createCatalogImageResult("diagram");
    },
  );

  const response = await app.request(
    `http://localhost/admin/catalog/packages/${packageId}/media-assets/images`,
    { method: "POST", body: "not-an-image" },
  );
  assert.equal(response.status, 403);
  assert.equal(processingCalls, 0);
});

test("catalog image routes validate raw input and never expose media blob IDs", async () => {
  let cardCalls = 0;
  const app = createCatalogImageTestApp(
    async () => createAdminRequestContext(),
    async (packageMediaKey, imageBytes) => {
      cardCalls += 1;
      assert.equal(packageMediaKey, "diagram");
      assert.deepEqual(imageBytes, Buffer.from([1, 2, 3]));
      return createCatalogImageResult(packageMediaKey);
    },
  );
  const invalidResponse = await app.request(
    `http://localhost/admin/catalog/packages/${packageId}/media-assets/images`,
    {
      method: "POST",
      headers: { "Content-Type": "text/plain", "x-package-media-key": "diagram" },
      body: "invalid",
    },
  );
  assert.equal(invalidResponse.status, 415);
  assert.equal(cardCalls, 0);

  for (const [path, method, extraHeaders] of [
    [`media-assets/images`, "POST", { "x-package-media-key": " Diagram " }],
    ["cover", "PUT", {}],
  ] as const) {
    const response = await app.request(
      `http://localhost/admin/catalog/packages/${packageId}/${path}`,
      {
        method,
        headers: { "Content-Type": "image/png", ...extraHeaders },
        body: Buffer.from([1, 2, 3]),
      },
    );
    const payload = await response.json() as Readonly<{ mediaAsset: Readonly<Record<string, unknown>> }>;
    assert.equal(response.status, method === "POST" ? 201 : 200);
    assert.equal("mediaBlobId" in payload.mediaAsset, false);
  }
  assert.equal(cardCalls, 1);
});

test("catalog image routes normalize ingestion deadline errors", async () => {
  for (const error of [
    Object.assign(new Error("database deadline"), { code: "55P03" }),
    Object.assign(new Error("database deadline"), { code: "57014" }),
    new HttpError(503, "catalog deadline", "CATALOG_IMAGE_INGESTION_DEADLINE_INVALID"),
  ]) {
    const app = createCatalogImageTestApp(
      async () => createAdminRequestContext(),
      async () => {
        throw error;
      },
    );
    const response = await app.request(
      `http://localhost/admin/catalog/packages/${packageId}/media-assets/images`,
      {
        method: "POST",
        headers: { "Content-Type": "image/png", "x-package-media-key": "diagram" },
        body: Buffer.from([1, 2, 3]),
      },
    );
    assert.equal(response.status, 503);
    assert.equal(
      (await response.json() as Readonly<{ code: string }>).code,
      "MEDIA_ASSET_INGESTION_DEADLINE_EXCEEDED",
    );
  }
});
