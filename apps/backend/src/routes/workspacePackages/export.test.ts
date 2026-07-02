import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";
import { HttpError } from "../../shared/errors";
import type {
  WorkspacePackageExportPackageInput,
  WorkspacePackageExportPreviewInput,
} from "../../workspacePackages";
import { createWorkspacePackageRoutes } from "./index";
import {
  cardId,
  createRequestContext,
  createWorkspacePackageTestApp,
  createWorkspacePackageZipBytes,
  type ErrorResponseBody,
  workspaceId,
} from "./testSupport";

function createWorkspacePackageExportRequestBody(): Record<string, unknown> {
  return {
    workspaceId: createRequestContext().selectedWorkspaceId,
    selection: {
      kind: "explicitCardIds",
      cardIds: [cardId],
    },
    tagPolicy: {
      additionalRemovedTags: ["draft"],
    },
    packageMetadata: {
      label: "Starter deck",
      author: null,
      comment: null,
      createdAt: null,
      sourceUrl: null,
    },
  };
}

function assertExportInput(input: WorkspacePackageExportPreviewInput): void {
  assert.deepEqual(input.selection, {
    kind: "explicitCardIds",
    cardIds: [cardId],
  });
  assert.deepEqual(input.tagPolicy, {
    additionalRemovedTags: ["draft"],
  });
  assert.deepEqual(input.packageMetadata, {
    label: "Starter deck",
    author: null,
    comment: null,
    createdAt: null,
    sourceUrl: null,
  });
  assert.equal(new Date(input.generatedAt).toISOString(), input.generatedAt);
}

test("POST /workspaces/:workspaceId/packages/export/preview returns preview JSON for the path workspace", async () => {
  let accessChecks = 0;
  let previewCalls = 0;
  const app = createWorkspacePackageTestApp(createWorkspacePackageRoutes({
    allowedOrigins: [],
    loadRequestContextFromRequestFn: async () => ({
      requestAuthInputs: {} as never,
      requestContext: createRequestContext(),
    }),
    assertUserHasWorkspaceAccessFn: async (userId, checkedWorkspaceId) => {
      accessChecks += 1;
      assert.equal(userId, "user-1");
      assert.equal(checkedWorkspaceId, workspaceId);
    },
    previewWorkspacePackageExportFn: async (userId, requestedWorkspaceId, input) => {
      previewCalls += 1;
      assert.equal(userId, "user-1");
      assert.equal(requestedWorkspaceId, workspaceId);
      assertExportInput(input);

      return {
        selectedCardCount: 1,
        availableTagCounts: [
          {
            tag: "draft",
            cardsCount: 1,
          },
        ],
        tagsSelectedForRemoval: [
          {
            tag: "draft",
            cardsCount: 1,
          },
        ],
        referencedMediaCount: 0,
        approximateReferencedMediaBytes: 0,
        defaultPackageMetadata: {
          label: "Starter deck",
          createdAt: input.generatedAt,
        },
      };
    },
  }));

  const response = await app.request(`http://localhost/workspaces/${workspaceId}/packages/export/preview`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(createWorkspacePackageExportRequestBody()),
  });

  assert.equal(response.status, 200);
  const responseBody = await response.json() as Readonly<{
    selectedCardCount: number;
    availableTagCounts: ReadonlyArray<Readonly<{
      tag: string;
      cardsCount: number;
    }>>;
    tagsSelectedForRemoval: ReadonlyArray<Readonly<{
      tag: string;
      cardsCount: number;
    }>>;
    referencedMediaCount: number;
    approximateReferencedMediaBytes: number;
    defaultPackageMetadata: Readonly<{
      label: string;
      createdAt: string;
    }>;
  }>;
  assert.equal(new Date(responseBody.defaultPackageMetadata.createdAt).toISOString(), responseBody.defaultPackageMetadata.createdAt);
  assert.deepEqual(responseBody, {
    selectedCardCount: 1,
    availableTagCounts: [
      {
        tag: "draft",
        cardsCount: 1,
      },
    ],
    tagsSelectedForRemoval: [
      {
        tag: "draft",
        cardsCount: 1,
      },
    ],
    referencedMediaCount: 0,
    approximateReferencedMediaBytes: 0,
    defaultPackageMetadata: {
      label: "Starter deck",
      createdAt: responseBody.defaultPackageMetadata.createdAt,
    },
  });
  assert.equal(accessChecks, 1);
  assert.equal(previewCalls, 1);
});

test("POST /workspaces/:workspaceId/packages/export returns ZIP bytes with download headers", async () => {
  const zipBytes = createWorkspacePackageZipBytes();
  let exportCalls = 0;
  const app = createWorkspacePackageTestApp(createWorkspacePackageRoutes({
    allowedOrigins: [],
    loadRequestContextFromRequestFn: async () => ({
      requestAuthInputs: {} as never,
      requestContext: createRequestContext(),
    }),
    assertUserHasWorkspaceAccessFn: async (userId, checkedWorkspaceId) => {
      assert.equal(userId, "user-1");
      assert.equal(checkedWorkspaceId, workspaceId);
    },
    exportWorkspacePackageFn: async (userId, requestedWorkspaceId, input: WorkspacePackageExportPackageInput) => {
      exportCalls += 1;
      assert.equal(userId, "user-1");
      assert.equal(requestedWorkspaceId, workspaceId);
      assertExportInput(input);
      assert.equal(input.observationScope.service, "backend-api");
      assert.equal(input.observationScope.requestId, "request-1");
      assert.equal(input.observationScope.workspaceId, workspaceId);

      return {
        fileName: "flashcards.zip",
        contentType: "application/zip",
        bytes: zipBytes,
      };
    },
  }));

  const response = await app.request(`http://localhost/workspaces/${workspaceId}/packages/export`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(createWorkspacePackageExportRequestBody()),
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/zip");
  assert.equal(response.headers.get("content-disposition"), 'attachment; filename="flashcards.zip"');
  assert.equal(response.headers.get("content-length"), zipBytes.byteLength.toString());
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), zipBytes);
  assert.equal(exportCalls, 1);
});

test("workspace package export routes stop before service calls when workspace access is denied", async () => {
  let previewCalls = 0;
  const app = createWorkspacePackageTestApp(createWorkspacePackageRoutes({
    allowedOrigins: [],
    loadRequestContextFromRequestFn: async () => ({
      requestAuthInputs: {} as never,
      requestContext: createRequestContext(),
    }),
    assertUserHasWorkspaceAccessFn: async () => {
      throw new HttpError(403, "Workspace access denied", "WORKSPACE_ACCESS_DENIED");
    },
    previewWorkspacePackageExportFn: async () => {
      previewCalls += 1;
      throw new Error("Preview service must not be called when workspace access is denied.");
    },
  }));

  const response = await app.request(`http://localhost/workspaces/${workspaceId}/packages/export/preview`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(createWorkspacePackageExportRequestBody()),
  });
  const body = await response.json() as ErrorResponseBody;

  assert.equal(response.status, 403);
  assert.equal(body.code, "WORKSPACE_ACCESS_DENIED");
  assert.equal(previewCalls, 0);
});

test("workspace package export routes reject malformed requests before service calls", async () => {
  let exportCalls = 0;
  const app = createWorkspacePackageTestApp(createWorkspacePackageRoutes({
    allowedOrigins: [],
    loadRequestContextFromRequestFn: async () => ({
      requestAuthInputs: {} as never,
      requestContext: createRequestContext(),
    }),
    assertUserHasWorkspaceAccessFn: async () => undefined,
    exportWorkspacePackageFn: async () => {
      exportCalls += 1;
      throw new Error("Export service must not be called for malformed requests.");
    },
  }));

  const response = await app.request(`http://localhost/workspaces/${workspaceId}/packages/export`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      selection: {
        kind: "explicitCardIds",
        cardIds: [cardId],
      },
      tagPolicy: {
        additionalRemovedTags: "draft",
      },
      packageMetadata: {
        label: "Starter deck",
        author: null,
        comment: null,
        createdAt: null,
        sourceUrl: null,
      },
    }),
  });
  const body = await response.json() as ErrorResponseBody;

  assert.equal(response.status, 400);
  assert.equal(body.code, "WORKSPACE_PACKAGE_EXPORT_REQUEST_INVALID");
  assert.match(JSON.stringify(body.details), /tagPolicy\.additionalRemovedTags/);
  assert.equal(exportCalls, 0);
});

test("workspace package export routes reject empty explicit card id selections before service calls", async () => {
  let exportCalls = 0;
  const app = createWorkspacePackageTestApp(createWorkspacePackageRoutes({
    allowedOrigins: [],
    loadRequestContextFromRequestFn: async () => ({
      requestAuthInputs: {} as never,
      requestContext: createRequestContext(),
    }),
    assertUserHasWorkspaceAccessFn: async () => undefined,
    exportWorkspacePackageFn: async () => {
      exportCalls += 1;
      throw new Error("Export service must not be called for empty explicit card id selections.");
    },
  }));

  const requestBody = createWorkspacePackageExportRequestBody();
  const response = await app.request(`http://localhost/workspaces/${workspaceId}/packages/export`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ...requestBody,
      selection: {
        kind: "explicitCardIds",
        cardIds: [],
      },
    }),
  });
  const body = await response.json() as ErrorResponseBody;

  assert.equal(response.status, 400);
  assert.equal(body.code, "WORKSPACE_PACKAGE_EXPORT_REQUEST_INVALID");
  assert.match(JSON.stringify(body.details), /selection\.cardIds/);
  assert.equal(exportCalls, 0);
});
