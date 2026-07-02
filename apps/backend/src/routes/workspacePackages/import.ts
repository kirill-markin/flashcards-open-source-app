import { Buffer } from "node:buffer";
import { Hono } from "hono";
import { z } from "zod";
import { listWorkspaceTagsSummary } from "../../cards";
import {
  confirmWorkspacePackageImport,
  previewWorkspacePackageZipImport,
  type WorkspacePackageImportConfirmResult,
  type WorkspacePackageImportPlanOptions,
  type WorkspacePackageImportPreview,
} from "../../workspacePackages";
import { assertUserHasWorkspaceAccess } from "../../workspaces";
import {
  loadRequestContextFromRequest,
  parseWorkspaceIdParam,
  type RequestContext,
} from "../../server/requestContext";
import { createBackendFailureDetails } from "../../server/logging";
import {
  addBackendBreadcrumb,
  normalizeCaughtError,
} from "../../observability/sentry";
import { reportBackendExceptionOrBreadcrumb } from "../../observability/reporting";
import { HttpError } from "../../shared/errors";
import type { AppEnv } from "../../server/app";
import {
  createWorkspacePackageScope,
  getRequestContextUserId,
  summarizeValidationDetails,
} from "./shared";

export type WorkspacePackageImportRoutesOptions = Readonly<{
  allowedOrigins: ReadonlyArray<string>;
  loadRequestContextFromRequestFn?: typeof loadRequestContextFromRequest;
  assertUserHasWorkspaceAccessFn?: typeof assertUserHasWorkspaceAccess;
  listWorkspaceTagsSummaryFn?: typeof listWorkspaceTagsSummary;
  previewWorkspacePackageZipImportFn?: typeof previewWorkspacePackageZipImport;
  confirmWorkspacePackageImportFn?: typeof confirmWorkspacePackageImport;
}>;

type WorkspacePackageImportPreviewResponse = WorkspacePackageImportPreview;
type WorkspacePackageImportConfirmResponse = WorkspacePackageImportConfirmResult;

type WorkspacePackageImportConfirmRouteOptions = WorkspacePackageImportPlanOptions & Readonly<{
  clientUpdatedAt: string;
  lastModifiedByReplicaId: string;
  operationIdPrefix: string;
}>;

type WorkspacePackageImportConfirmUpload = Readonly<{
  packageBytes: Buffer;
  options: WorkspacePackageImportConfirmRouteOptions;
}>;

export const workspacePackageImportPreviewRouteMaxZipBytes = 4_000_000;
export const workspacePackageImportConfirmRouteMaxZipBytes = workspacePackageImportPreviewRouteMaxZipBytes;

const workspacePackageImportConfirmTimestampSchema = z.string().datetime().transform(
  (value): string => new Date(value).toISOString(),
);
const workspacePackageImportConfirmUuidSchema = z.string().uuid().transform(
  (value): string => value.toLowerCase(),
);

const workspacePackageImportConfirmRouteOptionsSchema = z.object({
  addImportTag: z.boolean(),
  importTag: z.string().min(1),
  removeTags: z.array(z.string().min(1)),
  importedAt: workspacePackageImportConfirmTimestampSchema,
  importId: z.string().min(1),
  clientUpdatedAt: workspacePackageImportConfirmTimestampSchema,
  lastModifiedByReplicaId: workspacePackageImportConfirmUuidSchema,
  operationIdPrefix: z.string().min(1),
}).transform((input): WorkspacePackageImportConfirmRouteOptions => ({
  addImportTag: input.addImportTag,
  importTag: input.importTag,
  removeTags: input.removeTags,
  importedAt: input.importedAt,
  importId: input.importId,
  clientUpdatedAt: input.clientUpdatedAt,
  lastModifiedByReplicaId: input.lastModifiedByReplicaId,
  operationIdPrefix: input.operationIdPrefix,
}));

function assertWorkspacePackageImportPreviewContentType(headers: Headers): void {
  const contentTypeHeader = headers.get("content-type");
  const contentType = contentTypeHeader?.split(";")[0]?.trim().toLowerCase() ?? "";
  if (contentType !== "application/zip") {
    throw new HttpError(
      415,
      "content-type must be application/zip",
      "WORKSPACE_PACKAGE_IMPORT_PREVIEW_CONTENT_TYPE_UNSUPPORTED",
    );
  }
}

function assertWorkspacePackageImportConfirmContentType(headers: Headers): void {
  const contentTypeHeader = headers.get("content-type");
  const contentType = contentTypeHeader?.split(";")[0]?.trim().toLowerCase() ?? "";
  if (contentType !== "multipart/form-data") {
    throw new HttpError(
      415,
      "content-type must be multipart/form-data",
      "WORKSPACE_PACKAGE_IMPORT_CONTENT_TYPE_UNSUPPORTED",
    );
  }
}

function assertWorkspacePackageImportPreviewZipBytesNotEmpty(byteLength: number): void {
  if (byteLength === 0) {
    throw new HttpError(
      400,
      "Workspace package ZIP request body must not be empty",
      "WORKSPACE_PACKAGE_IMPORT_PREVIEW_ZIP_EMPTY",
    );
  }
}

function createWorkspacePackageImportPreviewBodyTooLargeError(byteLength: number): HttpError {
  return new HttpError(
    413,
    `Direct workspace package import preview ZIP is too large for this endpoint. zipBytes=${byteLength} maxZipBytes=${workspacePackageImportPreviewRouteMaxZipBytes}`,
    "WORKSPACE_PACKAGE_IMPORT_PREVIEW_BODY_TOO_LARGE",
  );
}

function assertWorkspacePackageImportPreviewZipBytesWithinRouteLimit(byteLength: number): void {
  if (byteLength > workspacePackageImportPreviewRouteMaxZipBytes) {
    throw createWorkspacePackageImportPreviewBodyTooLargeError(byteLength);
  }
}

function createWorkspacePackageImportConfirmFileTooLargeError(byteLength: number): HttpError {
  return new HttpError(
    413,
    `Direct workspace package import ZIP is too large for this endpoint. zipBytes=${byteLength} maxZipBytes=${workspacePackageImportConfirmRouteMaxZipBytes}`,
    "WORKSPACE_PACKAGE_IMPORT_FILE_TOO_LARGE",
  );
}

function assertWorkspacePackageImportConfirmZipBytesNotEmpty(byteLength: number): void {
  if (byteLength === 0) {
    throw new HttpError(
      400,
      "Workspace package import file must not be empty",
      "WORKSPACE_PACKAGE_IMPORT_FILE_EMPTY",
    );
  }
}

function assertWorkspacePackageImportConfirmZipBytesWithinRouteLimit(byteLength: number): void {
  if (byteLength > workspacePackageImportConfirmRouteMaxZipBytes) {
    throw createWorkspacePackageImportConfirmFileTooLargeError(byteLength);
  }
}

function parseWorkspacePackageImportConfirmOptions(value: string): WorkspacePackageImportConfirmRouteOptions {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(value);
  } catch {
    throw new HttpError(
      400,
      "options must be a valid JSON string",
      "WORKSPACE_PACKAGE_IMPORT_OPTIONS_INVALID_JSON",
    );
  }

  const parsedOptions = workspacePackageImportConfirmRouteOptionsSchema.safeParse(parsedJson);
  if (parsedOptions.success) {
    return parsedOptions.data;
  }

  throw new HttpError(
    400,
    "Workspace package import options are invalid.",
    "WORKSPACE_PACKAGE_IMPORT_OPTIONS_INVALID",
    summarizeValidationDetails(parsedOptions.error),
  );
}

async function readWorkspacePackageImportConfirmUpload(request: Request): Promise<WorkspacePackageImportConfirmUpload> {
  assertWorkspacePackageImportConfirmContentType(request.headers);

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    throw new HttpError(
      400,
      "Invalid multipart form data",
      "WORKSPACE_PACKAGE_IMPORT_MULTIPART_INVALID",
    );
  }

  const fileValue = formData.get("file");
  if (!(fileValue instanceof File)) {
    throw new HttpError(
      400,
      "file is required",
      "WORKSPACE_PACKAGE_IMPORT_FILE_REQUIRED",
    );
  }

  assertWorkspacePackageImportConfirmZipBytesNotEmpty(fileValue.size);
  assertWorkspacePackageImportConfirmZipBytesWithinRouteLimit(fileValue.size);
  const packageBytes = Buffer.from(await fileValue.arrayBuffer());
  assertWorkspacePackageImportConfirmZipBytesNotEmpty(packageBytes.byteLength);
  assertWorkspacePackageImportConfirmZipBytesWithinRouteLimit(packageBytes.byteLength);

  const optionsValue = formData.get("options");
  if (optionsValue === null) {
    throw new HttpError(
      400,
      "options is required",
      "WORKSPACE_PACKAGE_IMPORT_OPTIONS_REQUIRED",
    );
  }

  if (typeof optionsValue !== "string") {
    throw new HttpError(
      400,
      "options must be a JSON string",
      "WORKSPACE_PACKAGE_IMPORT_OPTIONS_INVALID_JSON",
    );
  }

  return {
    packageBytes,
    options: parseWorkspacePackageImportConfirmOptions(optionsValue),
  };
}

function parseWorkspacePackageImportPreviewContentLength(headers: Headers): number | null {
  const contentLengthHeader = headers.get("content-length");
  if (contentLengthHeader === null) {
    return null;
  }

  if (/^\d+$/.test(contentLengthHeader) === false) {
    throw new HttpError(400, "content-length must be a non-negative safe integer", "CONTENT_LENGTH_INVALID");
  }

  const contentLength = Number.parseInt(contentLengthHeader, 10);
  if (Number.isSafeInteger(contentLength) === false) {
    throw new HttpError(400, "content-length must be a non-negative safe integer", "CONTENT_LENGTH_INVALID");
  }

  return contentLength;
}

async function readWorkspacePackageImportPreviewZipBytes(request: Request): Promise<Buffer> {
  assertWorkspacePackageImportPreviewContentType(request.headers);
  const contentLength = parseWorkspacePackageImportPreviewContentLength(request.headers);
  if (contentLength !== null) {
    assertWorkspacePackageImportPreviewZipBytesWithinRouteLimit(contentLength);
  }

  const bytes = Buffer.from(await request.arrayBuffer());
  assertWorkspacePackageImportPreviewZipBytesNotEmpty(bytes.byteLength);
  assertWorkspacePackageImportPreviewZipBytesWithinRouteLimit(bytes.byteLength);
  return bytes;
}

export function createWorkspacePackageImportRoutes(options: WorkspacePackageImportRoutesOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const loadRequestContextFromRequestFn = options.loadRequestContextFromRequestFn ?? loadRequestContextFromRequest;
  const assertUserHasWorkspaceAccessFn = options.assertUserHasWorkspaceAccessFn ?? assertUserHasWorkspaceAccess;
  const listWorkspaceTagsSummaryFn = options.listWorkspaceTagsSummaryFn ?? listWorkspaceTagsSummary;
  const previewWorkspacePackageZipImportFn = options.previewWorkspacePackageZipImportFn ?? previewWorkspacePackageZipImport;
  const confirmWorkspacePackageImportFn = options.confirmWorkspacePackageImportFn ?? confirmWorkspacePackageImport;

  app.post("/workspaces/:workspaceId/packages/import/preview", async (context) => {
    const requestId = context.get("requestId");
    let requestContext: RequestContext | null = null;
    let workspaceId: string | null = null;

    try {
      const loadedContext = await loadRequestContextFromRequestFn(context.req.raw, options.allowedOrigins);
      requestContext = loadedContext.requestContext;
      workspaceId = parseWorkspaceIdParam(context.req.param("workspaceId"));
      await assertUserHasWorkspaceAccessFn(requestContext.userId, workspaceId);
      const packageBytes = await readWorkspacePackageImportPreviewZipBytes(context.req.raw);
      const existingWorkspaceTags = (await listWorkspaceTagsSummaryFn(requestContext.userId, workspaceId))
        .tags
        .map((tagSummary) => tagSummary.tag);
      const preview = await previewWorkspacePackageZipImportFn({
        packageBytes,
        generatedAt: new Date().toISOString(),
        existingWorkspaceTags,
      });
      const scope = createWorkspacePackageScope(requestId, context.req.path, context.req.method, requestContext.userId, workspaceId, context.get("clientAppVersion"), context.get("clientPlatform"));
      addBackendBreadcrumb({
        action: "workspace_package_import_preview",
        scope,
        details: {
          statusCode: 200,
          bytesCount: packageBytes.byteLength,
          cardCount: preview.cardCount,
          referencedMediaCount: preview.referencedMediaCount,
          packageMediaFileCount: preview.packageMediaFileCount,
        },
      });

      return context.json(preview satisfies WorkspacePackageImportPreviewResponse);
    } catch (error) {
      const scope = createWorkspacePackageScope(requestId, context.req.path, context.req.method, getRequestContextUserId(requestContext), workspaceId, context.get("clientAppVersion"), context.get("clientPlatform"));
      const details = {
        bytesCount: null,
        cardCount: null,
        referencedMediaCount: null,
        packageMediaFileCount: null,
        ...createBackendFailureDetails(error),
      };
      reportBackendExceptionOrBreadcrumb(
        error,
        { action: "workspace_package_import_preview_error", error: normalizeCaughtError(error), scope, details },
        { action: "workspace_package_import_preview_error", scope, details },
      );
      throw error;
    }
  });

  app.post("/workspaces/:workspaceId/packages/import", async (context) => {
    const requestId = context.get("requestId");
    let requestContext: RequestContext | null = null;
    let workspaceId: string | null = null;

    try {
      const loadedContext = await loadRequestContextFromRequestFn(context.req.raw, options.allowedOrigins);
      requestContext = loadedContext.requestContext;
      workspaceId = parseWorkspaceIdParam(context.req.param("workspaceId"));
      await assertUserHasWorkspaceAccessFn(requestContext.userId, workspaceId);
      const scope = createWorkspacePackageScope(requestId, context.req.path, context.req.method, requestContext.userId, workspaceId, context.get("clientAppVersion"), context.get("clientPlatform"));
      const upload = await readWorkspacePackageImportConfirmUpload(context.req.raw);
      const result = await confirmWorkspacePackageImportFn({
        userId: requestContext.userId,
        workspaceId,
        packageBytes: upload.packageBytes,
        options: {
          addImportTag: upload.options.addImportTag,
          importTag: upload.options.importTag,
          removeTags: upload.options.removeTags,
          importedAt: upload.options.importedAt,
          importId: upload.options.importId,
        },
        createdAt: upload.options.importedAt,
        clientUpdatedAt: upload.options.clientUpdatedAt,
        lastModifiedByReplicaId: upload.options.lastModifiedByReplicaId,
        operationIdPrefix: upload.options.operationIdPrefix,
        observationScope: scope,
      });
      addBackendBreadcrumb({
        action: "workspace_package_import",
        scope,
        details: {
          statusCode: 200,
          bytesCount: upload.packageBytes.byteLength,
          cardCount: result.summary.cardCount,
          referencedMediaCount: result.summary.referencedMediaCount,
          importedMediaAssetCount: result.summary.importedMediaAssetCount,
          appliedMediaAssetCount: result.summary.appliedMediaAssetCount,
        },
      });

      return context.json(result satisfies WorkspacePackageImportConfirmResponse);
    } catch (error) {
      const scope = createWorkspacePackageScope(requestId, context.req.path, context.req.method, getRequestContextUserId(requestContext), workspaceId, context.get("clientAppVersion"), context.get("clientPlatform"));
      const details = {
        bytesCount: null,
        cardCount: null,
        referencedMediaCount: null,
        importedMediaAssetCount: null,
        appliedMediaAssetCount: null,
        ...createBackendFailureDetails(error),
      };
      reportBackendExceptionOrBreadcrumb(
        error,
        { action: "workspace_package_import_error", error: normalizeCaughtError(error), scope, details },
        { action: "workspace_package_import_error", scope, details },
      );
      throw error;
    }
  });

  return app;
}
