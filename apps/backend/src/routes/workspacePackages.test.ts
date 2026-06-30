import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import {
  createWorkspacePackageRoutes,
  workspacePackageImportConfirmRouteMaxZipBytes,
  workspacePackageImportPreviewRouteMaxZipBytes,
} from "./workspacePackages";
import { HttpError } from "../shared/errors";
import type { AppEnv } from "../server/app";
import type { RequestContext } from "../server/requestContext";
import type { Card } from "../cards";
import type { MediaAsset } from "../mediaAssets/types";
import type {
  WorkspacePackageExportPackageInput,
  WorkspacePackageExportPreviewInput,
  WorkspacePackageImportConfirmInput,
  WorkspacePackageImportConfirmResult,
  WorkspacePackageImportPreview,
  WorkspacePackageImportPreviewInput,
} from "../workspacePackages";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const otherWorkspaceId = "22222222-2222-4222-8222-222222222222";
const cardId = "33333333-3333-4333-8333-333333333333";
const replicaId = "44444444-4444-4444-8444-444444444444";
const importedAt = "2026-06-30T12:00:00.000Z";
const clientUpdatedAt = "2026-06-30T12:01:00.000Z";
const importId = "import-session-1";
const operationIdPrefix = "workspace-package-import-1";

type ErrorResponseBody = Readonly<{
  error: string;
  requestId: string;
  code: string | null;
  details?: unknown;
}>;

function createRequestContext(): RequestContext {
  return {
    userId: "user-1",
    subjectUserId: "subject-1",
    selectedWorkspaceId: otherWorkspaceId,
    email: "user@example.com",
    locale: "en",
    userSettingsCreatedAt: "2026-06-30T00:00:00.000Z",
    preferences: {
      reviewReactionAnimationsEnabled: true,
    },
    transport: "bearer",
    connectionId: null,
    guestSessionId: null,
    guestPlatform: null,
  };
}

function createWorkspacePackageExportRequestBody(): Record<string, unknown> {
  return {
    workspaceId: otherWorkspaceId,
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

function createWorkspacePackageImportPreviewResponse(): WorkspacePackageImportPreview {
  return {
    sourceKind: "zip",
    packageMetadata: {
      label: "Imported deck",
      author: null,
      comment: null,
      createdAt: "2026-06-30T00:00:00.000Z",
      sourceUrl: null,
    },
    cardCount: 2,
    tagCounts: [
      {
        tag: "spanish",
        cardsCount: 2,
      },
    ],
    referencedMediaCount: 1,
    packageMediaFileCount: 1,
    warnings: [
      {
        code: "WORKSPACE_PACKAGE_IMPORT_MEDIA_TYPE_UNSUPPORTED",
        message: "Referenced package media may not be supported by the import confirmation flow.",
        mediaPath: "media/audio.wav",
      },
    ],
    defaultOptions: {
      addImportTag: true,
      suggestedImportTag: "import:2026-06-30-1",
      keptTags: ["spanish"],
      removedTags: [],
    },
  };
}

function createWorkspacePackageImportConfirmOptions(): Record<string, unknown> {
  return {
    addImportTag: true,
    importTag: "import:2026-06-30-1",
    removeTags: ["legacy"],
    importedAt,
    importId,
    clientUpdatedAt,
    lastModifiedByReplicaId: replicaId,
    operationIdPrefix,
  };
}

function createWorkspacePackageImportConfirmFormData(
  zipBytes: Buffer,
  options: unknown,
): FormData {
  const formData = new FormData();
  formData.set("file", new File([new Uint8Array(zipBytes)], "flashcards.zip", { type: "application/zip" }));
  formData.set("options", JSON.stringify(options));
  return formData;
}

function createWorkspacePackageImportConfirmCard(): Card {
  return {
    cardId,
    frontText: "Pregunta",
    backText: "Respuesta",
    cardType: "basic",
    metadata: {
      version: 1,
      source: {
        label: "Imported deck",
        author: null,
        comment: null,
        createdAt: "2026-06-29T12:00:00.000Z",
        importedAt,
        importId,
      },
    },
    tags: ["spanish", "import:2026-06-30-1"],
    dueAt: null,
    createdAt: clientUpdatedAt,
    reps: 0,
    lapses: 0,
    fsrsCardState: "new",
    fsrsStepIndex: null,
    fsrsStability: null,
    fsrsDifficulty: null,
    fsrsLastReviewedAt: null,
    fsrsScheduledDays: null,
    clientUpdatedAt,
    lastModifiedByReplicaId: replicaId,
    lastOperationId: `${operationIdPrefix}:card:0`,
    updatedAt: clientUpdatedAt,
    deletedAt: null,
  };
}

function createWorkspacePackageImportConfirmMediaAsset(): MediaAsset {
  return {
    mediaAssetId: "55555555-5555-4555-8555-555555555555",
    workspaceId,
    mimeType: "image/jpeg",
    sizeBytes: 1024,
    sha256: "0".repeat(64),
    sourceUrl: null,
    createdAt: importedAt,
    clientUpdatedAt,
    lastModifiedByReplicaId: replicaId,
    lastOperationId: `${operationIdPrefix}:media:0`,
    updatedAt: clientUpdatedAt,
    deletedAt: null,
  };
}

function createWorkspacePackageImportConfirmResult(): WorkspacePackageImportConfirmResult {
  return {
    cards: [createWorkspacePackageImportConfirmCard()],
    importedMediaAssets: [
      {
        portablePath: "media/images/cell.jpg",
        mediaAsset: createWorkspacePackageImportConfirmMediaAsset(),
        applied: true,
      },
    ],
    summary: {
      cardCount: 1,
      cardBatchCount: 1,
      referencedMediaCount: 1,
      importedMediaAssetCount: 1,
      appliedMediaAssetCount: 1,
      keptTagCount: 1,
      removedTagCount: 1,
      importTag: "import:2026-06-30-1",
    },
  };
}

function createOversizedWorkspacePackageImportPreviewZipBytes(): Buffer {
  return Buffer.alloc(workspacePackageImportPreviewRouteMaxZipBytes + 1, 0x61);
}

function createOversizedWorkspacePackageImportConfirmZipBytes(): Buffer {
  return Buffer.alloc(workspacePackageImportConfirmRouteMaxZipBytes + 1, 0x61);
}

function createWorkspacePackageTestApp(routes: Hono<AppEnv>): Hono<AppEnv> {
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
      return context.json({
        error: error.message,
        requestId: context.get("requestId"),
        code: error.code,
        ...(error.details === null ? {} : { details: error.details }),
      } satisfies ErrorResponseBody);
    }

    context.status(500);
    return context.json({
      error: "Request failed. Try again.",
      requestId: context.get("requestId"),
      code: "INTERNAL_ERROR",
    } satisfies ErrorResponseBody);
  });
  app.route("/", routes);
  return app;
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

function assertImportPreviewInput(
  input: WorkspacePackageImportPreviewInput,
  zipBytes: Buffer,
): void {
  assert.deepEqual(Buffer.from(input.packageBytes), zipBytes);
  assert.equal(new Date(input.generatedAt).toISOString(), input.generatedAt);
  assert.deepEqual(input.existingWorkspaceTags, [
    "import:2026-06-30-0",
    "draft",
  ]);
}

function assertImportConfirmInput(
  input: WorkspacePackageImportConfirmInput,
  zipBytes: Buffer,
): void {
  assert.equal(input.userId, "user-1");
  assert.equal(input.workspaceId, workspaceId);
  assert.deepEqual(Buffer.from(input.packageBytes), zipBytes);
  assert.deepEqual(input.options, {
    addImportTag: true,
    importTag: "import:2026-06-30-1",
    removeTags: ["legacy"],
    importedAt,
    importId,
  });
  assert.equal(input.createdAt, importedAt);
  assert.equal(input.clientUpdatedAt, clientUpdatedAt);
  assert.equal(input.lastModifiedByReplicaId, replicaId);
  assert.equal(input.operationIdPrefix, operationIdPrefix);
  assert.equal(input.observationScope.service, "backend-api");
  assert.equal(input.observationScope.requestId, "request-1");
  assert.equal(input.observationScope.workspaceId, workspaceId);
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

test("POST /workspaces/:workspaceId/packages/import/preview passes ZIP bytes and existing tags to preview service", async () => {
  const zipBytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]);
  const previewJson = createWorkspacePackageImportPreviewResponse();
  let accessChecks = 0;
  let tagSummaryCalls = 0;
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
    listWorkspaceTagsSummaryFn: async (userId, requestedWorkspaceId) => {
      tagSummaryCalls += 1;
      assert.equal(userId, "user-1");
      assert.equal(requestedWorkspaceId, workspaceId);

      return {
        totalCards: 3,
        tags: [
          {
            tag: "import:2026-06-30-0",
            cardsCount: 1,
          },
          {
            tag: "draft",
            cardsCount: 2,
          },
        ],
      };
    },
    previewWorkspacePackageZipImportFn: async (input) => {
      previewCalls += 1;
      assertImportPreviewInput(input, zipBytes);
      return previewJson;
    },
  }));

  const response = await app.request(`http://localhost/workspaces/${workspaceId}/packages/import/preview`, {
    method: "POST",
    headers: {
      "Content-Type": "application/zip",
    },
    body: zipBytes,
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), previewJson);
  assert.equal(accessChecks, 1);
  assert.equal(tagSummaryCalls, 1);
  assert.equal(previewCalls, 1);
});

test("POST /workspaces/:workspaceId/packages/import/preview uses path workspace instead of selected workspace", async () => {
  const zipBytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]);
  const checkedWorkspaceIds: Array<string> = [];
  const app = createWorkspacePackageTestApp(createWorkspacePackageRoutes({
    allowedOrigins: [],
    loadRequestContextFromRequestFn: async () => ({
      requestAuthInputs: {} as never,
      requestContext: createRequestContext(),
    }),
    assertUserHasWorkspaceAccessFn: async (_userId, checkedWorkspaceId) => {
      checkedWorkspaceIds.push(checkedWorkspaceId);
    },
    listWorkspaceTagsSummaryFn: async (_userId, requestedWorkspaceId) => {
      checkedWorkspaceIds.push(requestedWorkspaceId);
      return {
        totalCards: 0,
        tags: [],
      };
    },
    previewWorkspacePackageZipImportFn: async () => createWorkspacePackageImportPreviewResponse(),
  }));

  const response = await app.request(`http://localhost/workspaces/${workspaceId}/packages/import/preview`, {
    method: "POST",
    headers: {
      "Content-Type": "application/zip",
    },
    body: zipBytes,
  });

  assert.equal(response.status, 200);
  assert.deepEqual(checkedWorkspaceIds, [workspaceId, workspaceId]);
  assert.notEqual(workspaceId, createRequestContext().selectedWorkspaceId);
});

test("POST /workspaces/:workspaceId/packages/import/preview rejects content-length over the direct route limit", async () => {
  const zipBytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]);
  let tagSummaryCalls = 0;
  let previewCalls = 0;
  const app = createWorkspacePackageTestApp(createWorkspacePackageRoutes({
    allowedOrigins: [],
    loadRequestContextFromRequestFn: async () => ({
      requestAuthInputs: {} as never,
      requestContext: createRequestContext(),
    }),
    assertUserHasWorkspaceAccessFn: async () => undefined,
    listWorkspaceTagsSummaryFn: async () => {
      tagSummaryCalls += 1;
      throw new Error("Tag summary service must not be called when import preview body is too large.");
    },
    previewWorkspacePackageZipImportFn: async () => {
      previewCalls += 1;
      throw new Error("Import preview service must not be called when import preview body is too large.");
    },
  }));

  const response = await app.request(`http://localhost/workspaces/${workspaceId}/packages/import/preview`, {
    method: "POST",
    headers: {
      "Content-Length": (workspacePackageImportPreviewRouteMaxZipBytes + 1).toString(),
      "Content-Type": "application/zip",
    },
    body: zipBytes,
  });
  const body = await response.json() as ErrorResponseBody;

  assert.equal(response.status, 413);
  assert.equal(body.code, "WORKSPACE_PACKAGE_IMPORT_PREVIEW_BODY_TOO_LARGE");
  assert.match(body.error, new RegExp(workspacePackageImportPreviewRouteMaxZipBytes.toString()));
  assert.equal(tagSummaryCalls, 0);
  assert.equal(previewCalls, 0);
});

test("POST /workspaces/:workspaceId/packages/import/preview rejects actual body bytes over the direct route limit", async () => {
  let tagSummaryCalls = 0;
  let previewCalls = 0;
  const app = createWorkspacePackageTestApp(createWorkspacePackageRoutes({
    allowedOrigins: [],
    loadRequestContextFromRequestFn: async () => ({
      requestAuthInputs: {} as never,
      requestContext: createRequestContext(),
    }),
    assertUserHasWorkspaceAccessFn: async () => undefined,
    listWorkspaceTagsSummaryFn: async () => {
      tagSummaryCalls += 1;
      throw new Error("Tag summary service must not be called when import preview body is too large.");
    },
    previewWorkspacePackageZipImportFn: async () => {
      previewCalls += 1;
      throw new Error("Import preview service must not be called when import preview body is too large.");
    },
  }));

  const response = await app.request(`http://localhost/workspaces/${workspaceId}/packages/import/preview`, {
    method: "POST",
    headers: {
      "Content-Type": "application/zip",
    },
    body: createOversizedWorkspacePackageImportPreviewZipBytes(),
  });
  const body = await response.json() as ErrorResponseBody;

  assert.equal(response.status, 413);
  assert.equal(body.code, "WORKSPACE_PACKAGE_IMPORT_PREVIEW_BODY_TOO_LARGE");
  assert.match(body.error, new RegExp(workspacePackageImportPreviewRouteMaxZipBytes.toString()));
  assert.equal(tagSummaryCalls, 0);
  assert.equal(previewCalls, 0);
});

test("POST /workspaces/:workspaceId/packages/import parses multipart ZIP bytes and options", async () => {
  const zipBytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]);
  const confirmJson = createWorkspacePackageImportConfirmResult();
  let accessChecks = 0;
  let confirmCalls = 0;
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
    confirmWorkspacePackageImportFn: async (input) => {
      confirmCalls += 1;
      assertImportConfirmInput(input, zipBytes);
      return confirmJson;
    },
  }));

  const response = await app.request(`http://localhost/workspaces/${workspaceId}/packages/import`, {
    method: "POST",
    body: createWorkspacePackageImportConfirmFormData(zipBytes, createWorkspacePackageImportConfirmOptions()),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), confirmJson);
  assert.equal(accessChecks, 1);
  assert.equal(confirmCalls, 1);
});

test("POST /workspaces/:workspaceId/packages/import uses path workspace instead of selected workspace", async () => {
  const zipBytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]);
  const requestedWorkspaceIds: Array<string> = [];
  const app = createWorkspacePackageTestApp(createWorkspacePackageRoutes({
    allowedOrigins: [],
    loadRequestContextFromRequestFn: async () => ({
      requestAuthInputs: {} as never,
      requestContext: createRequestContext(),
    }),
    assertUserHasWorkspaceAccessFn: async (_userId, checkedWorkspaceId) => {
      requestedWorkspaceIds.push(checkedWorkspaceId);
    },
    confirmWorkspacePackageImportFn: async (input) => {
      requestedWorkspaceIds.push(input.workspaceId);
      return createWorkspacePackageImportConfirmResult();
    },
  }));

  const response = await app.request(`http://localhost/workspaces/${workspaceId}/packages/import`, {
    method: "POST",
    body: createWorkspacePackageImportConfirmFormData(zipBytes, createWorkspacePackageImportConfirmOptions()),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(requestedWorkspaceIds, [workspaceId, workspaceId]);
  assert.notEqual(workspaceId, createRequestContext().selectedWorkspaceId);
});

test("workspace package import confirm route stops before multipart and confirm service calls when workspace access is denied", async () => {
  let confirmCalls = 0;
  const app = createWorkspacePackageTestApp(createWorkspacePackageRoutes({
    allowedOrigins: [],
    loadRequestContextFromRequestFn: async () => ({
      requestAuthInputs: {} as never,
      requestContext: createRequestContext(),
    }),
    assertUserHasWorkspaceAccessFn: async () => {
      throw new HttpError(403, "Workspace access denied", "WORKSPACE_ACCESS_DENIED");
    },
    confirmWorkspacePackageImportFn: async () => {
      confirmCalls += 1;
      throw new Error("Import confirm service must not be called when workspace access is denied.");
    },
  }));

  const response = await app.request(`http://localhost/workspaces/${workspaceId}/packages/import`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: "not multipart",
  });
  const body = await response.json() as ErrorResponseBody;

  assert.equal(response.status, 403);
  assert.equal(body.code, "WORKSPACE_ACCESS_DENIED");
  assert.equal(confirmCalls, 0);
});

test("POST /workspaces/:workspaceId/packages/import rejects malformed multipart, file, and options inputs", async () => {
  const zipBytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]);
  const validOptions = createWorkspacePackageImportConfirmOptions();
  const cases: ReadonlyArray<Readonly<{
    name: string;
    createRequestInit: () => RequestInit;
    expectedStatus: number;
    expectedCode: string;
    errorPattern: RegExp;
    detailsPattern?: RegExp;
  }>> = [
    {
      name: "unsupported content type",
      createRequestInit: () => ({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(validOptions),
      }),
      expectedStatus: 415,
      expectedCode: "WORKSPACE_PACKAGE_IMPORT_CONTENT_TYPE_UNSUPPORTED",
      errorPattern: /multipart\/form-data/,
    },
    {
      name: "invalid multipart",
      createRequestInit: () => ({
        method: "POST",
        headers: {
          "Content-Type": "multipart/form-data",
        },
        body: "not multipart",
      }),
      expectedStatus: 400,
      expectedCode: "WORKSPACE_PACKAGE_IMPORT_MULTIPART_INVALID",
      errorPattern: /Invalid multipart form data/,
    },
    {
      name: "missing file",
      createRequestInit: () => {
        const formData = new FormData();
        formData.set("options", JSON.stringify(validOptions));
        return {
          method: "POST",
          body: formData,
        };
      },
      expectedStatus: 400,
      expectedCode: "WORKSPACE_PACKAGE_IMPORT_FILE_REQUIRED",
      errorPattern: /file is required/,
    },
    {
      name: "empty file",
      createRequestInit: () => {
        const formData = new FormData();
        formData.set("file", new File([""], "flashcards.zip", { type: "application/zip" }));
        formData.set("options", JSON.stringify(validOptions));
        return {
          method: "POST",
          body: formData,
        };
      },
      expectedStatus: 400,
      expectedCode: "WORKSPACE_PACKAGE_IMPORT_FILE_EMPTY",
      errorPattern: /must not be empty/,
    },
    {
      name: "oversized file",
      createRequestInit: () => ({
        method: "POST",
        body: createWorkspacePackageImportConfirmFormData(
          createOversizedWorkspacePackageImportConfirmZipBytes(),
          validOptions,
        ),
      }),
      expectedStatus: 413,
      expectedCode: "WORKSPACE_PACKAGE_IMPORT_FILE_TOO_LARGE",
      errorPattern: new RegExp(workspacePackageImportConfirmRouteMaxZipBytes.toString()),
    },
    {
      name: "missing options",
      createRequestInit: () => {
        const formData = new FormData();
        formData.set("file", new File([new Uint8Array(zipBytes)], "flashcards.zip", { type: "application/zip" }));
        return {
          method: "POST",
          body: formData,
        };
      },
      expectedStatus: 400,
      expectedCode: "WORKSPACE_PACKAGE_IMPORT_OPTIONS_REQUIRED",
      errorPattern: /options is required/,
    },
    {
      name: "malformed options JSON",
      createRequestInit: () => {
        const formData = new FormData();
        formData.set("file", new File([new Uint8Array(zipBytes)], "flashcards.zip", { type: "application/zip" }));
        formData.set("options", "{not json");
        return {
          method: "POST",
          body: formData,
        };
      },
      expectedStatus: 400,
      expectedCode: "WORKSPACE_PACKAGE_IMPORT_OPTIONS_INVALID_JSON",
      errorPattern: /valid JSON string/,
    },
    {
      name: "invalid options shape",
      createRequestInit: () => ({
        method: "POST",
        body: createWorkspacePackageImportConfirmFormData(zipBytes, {
          ...validOptions,
          removeTags: "legacy",
        }),
      }),
      expectedStatus: 400,
      expectedCode: "WORKSPACE_PACKAGE_IMPORT_OPTIONS_INVALID",
      errorPattern: /options are invalid/,
      detailsPattern: /removeTags/,
    },
    {
      name: "invalid options timestamp",
      createRequestInit: () => ({
        method: "POST",
        body: createWorkspacePackageImportConfirmFormData(zipBytes, {
          ...validOptions,
          importedAt: "not-a-timestamp",
        }),
      }),
      expectedStatus: 400,
      expectedCode: "WORKSPACE_PACKAGE_IMPORT_OPTIONS_INVALID",
      errorPattern: /options are invalid/,
      detailsPattern: /importedAt/,
    },
    {
      name: "invalid replica id",
      createRequestInit: () => ({
        method: "POST",
        body: createWorkspacePackageImportConfirmFormData(zipBytes, {
          ...validOptions,
          lastModifiedByReplicaId: "not-a-uuid",
        }),
      }),
      expectedStatus: 400,
      expectedCode: "WORKSPACE_PACKAGE_IMPORT_OPTIONS_INVALID",
      errorPattern: /options are invalid/,
      detailsPattern: /lastModifiedByReplicaId/,
    },
  ];

  for (const testCase of cases) {
    let confirmCalls = 0;
    const app = createWorkspacePackageTestApp(createWorkspacePackageRoutes({
      allowedOrigins: [],
      loadRequestContextFromRequestFn: async () => ({
        requestAuthInputs: {} as never,
        requestContext: createRequestContext(),
      }),
      assertUserHasWorkspaceAccessFn: async () => undefined,
      confirmWorkspacePackageImportFn: async () => {
        confirmCalls += 1;
        throw new Error("Import confirm service must not be called for malformed import requests.");
      },
    }));

    const response = await app.request(
      `http://localhost/workspaces/${workspaceId}/packages/import`,
      testCase.createRequestInit(),
    );
    const body = await response.json() as ErrorResponseBody;

    assert.equal(response.status, testCase.expectedStatus, testCase.name);
    assert.equal(body.code, testCase.expectedCode, testCase.name);
    assert.match(body.error, testCase.errorPattern, testCase.name);
    if (testCase.detailsPattern !== undefined) {
      assert.match(JSON.stringify(body.details), testCase.detailsPattern, testCase.name);
    }
    assert.equal(confirmCalls, 0, testCase.name);
  }
});

test("POST /workspaces/:workspaceId/packages/export returns ZIP bytes with download headers", async () => {
  const zipBytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]);
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

test("workspace package import preview route stops before tag and preview service calls when workspace access is denied", async () => {
  const zipBytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]);
  let tagSummaryCalls = 0;
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
    listWorkspaceTagsSummaryFn: async () => {
      tagSummaryCalls += 1;
      throw new Error("Tag summary service must not be called when workspace access is denied.");
    },
    previewWorkspacePackageZipImportFn: async () => {
      previewCalls += 1;
      throw new Error("Import preview service must not be called when workspace access is denied.");
    },
  }));

  const response = await app.request(`http://localhost/workspaces/${workspaceId}/packages/import/preview`, {
    method: "POST",
    headers: {
      "Content-Type": "application/zip",
    },
    body: zipBytes,
  });
  const body = await response.json() as ErrorResponseBody;

  assert.equal(response.status, 403);
  assert.equal(body.code, "WORKSPACE_ACCESS_DENIED");
  assert.equal(tagSummaryCalls, 0);
  assert.equal(previewCalls, 0);
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
