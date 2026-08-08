import assert from "node:assert/strict";
import test from "node:test";
import { createCatalogInstallRoutes } from "../../../routes/catalog/install";
import { HttpError } from "../../../shared/errors";
import {
  testInstallTimestamp,
  testPackageVersionId,
  testTimestamp,
  testWorkspaceId,
  testWorkspaceReplicaId,
} from "./installTestSupport";

test("catalog install route rejects unauthorized workspace access before installing", async () => {
  let previewCalled = false;
  const app = createCatalogInstallRoutes({
    allowedOrigins: [],
    loadRequestContextFromRequestFn: async () => ({
      requestAuthInputs: {
        authorizationHeader: undefined,
        sessionToken: undefined,
        csrfTokenHeader: undefined,
        originHeader: undefined,
        refererHeader: undefined,
        secFetchSiteHeader: undefined,
      },
      requestContext: {
        userId: "user-1",
        subjectUserId: "subject-user-1",
        selectedWorkspaceId: null,
        email: "user@example.com",
        locale: "en",
        userSettingsCreatedAt: testTimestamp,
        preferences: {
          reviewReactionAnimationsEnabled: true,
        },
        transport: "api_key",
        connectionId: "connection-1",
        guestSessionId: null,
        guestPlatform: null,
      },
    }),
    assertUserHasWorkspaceAccessFn: async () => {
      throw new HttpError(404, "Workspace not found", "WORKSPACE_NOT_FOUND");
    },
    previewCatalogPackageInstallFn: async () => {
      previewCalled = true;
      throw new Error("preview should not run");
    },
  });
  app.onError((error) => {
    throw error;
  });

  await assert.rejects(
    async () => (
      app.request(
        `http://localhost/workspaces/${testWorkspaceId}/catalog/package-versions/${testPackageVersionId}/install/preview`,
        { method: "POST" },
      )
    ),
    (error: unknown) => {
      assert.equal(error instanceof HttpError, true);
      assert.equal((error as HttpError).statusCode, 404);
      assert.equal((error as HttpError).code, "WORKSPACE_NOT_FOUND");
      return true;
    },
  );
  assert.equal(previewCalled, false);
});

test("catalog install route rejects unsafe operation prefixes without sanitizing them", async () => {
  let installCalled = false;
  const app = createCatalogInstallRoutes({
    allowedOrigins: [],
    loadRequestContextFromRequestFn: async () => ({
      requestAuthInputs: {
        authorizationHeader: undefined,
        sessionToken: undefined,
        csrfTokenHeader: undefined,
        originHeader: undefined,
        refererHeader: undefined,
        secFetchSiteHeader: undefined,
      },
      requestContext: {
        userId: "user-1",
        subjectUserId: "subject-user-1",
        selectedWorkspaceId: null,
        email: "user@example.com",
        locale: "en",
        userSettingsCreatedAt: testTimestamp,
        preferences: {
          reviewReactionAnimationsEnabled: true,
        },
        transport: "api_key",
        connectionId: "connection-1",
        guestSessionId: null,
        guestPlatform: null,
      },
    }),
    assertUserHasWorkspaceAccessFn: async () => undefined,
    installCatalogPackageVersionFn: async () => {
      installCalled = true;
      throw new Error("catalog install must not run for an unsafe operationIdPrefix");
    },
  });
  app.onError((error) => {
    throw error;
  });

  await assert.rejects(
    async () => app.request(
      `http://localhost/workspaces/${testWorkspaceId}/catalog/package-versions/${testPackageVersionId}/install`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          installId: "catalog-install-route-invalid-prefix",
          installedAt: testInstallTimestamp,
          clientUpdatedAt: testInstallTimestamp,
          lastModifiedByReplicaId: testWorkspaceReplicaId,
          operationIdPrefix: " trailing-space ",
        }),
      },
    ),
    (error: unknown): boolean => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 400);
      assert.equal(error.code, "CATALOG_PACKAGE_INSTALL_INVALID_INPUT");
      assert.match(error.message, /operationIdPrefix.*printable ASCII/);
      return true;
    },
  );
  assert.equal(installCalled, false);
});

