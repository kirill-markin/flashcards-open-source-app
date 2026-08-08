import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { AdminRequestContext } from "../../admin/authz";
import type {
  CatalogPackageVersion,
  CreateCatalogPackageVersionFromWorkspaceInput,
} from "../../catalog/types";
import type { AppEnv } from "../../server/app";
import { HttpError } from "../../shared/errors";
import { createCatalogAdminRoutes } from "./admin";

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
