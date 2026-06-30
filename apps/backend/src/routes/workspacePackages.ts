import { Hono } from "hono";
import { z } from "zod";
import {
  exportWorkspacePackage,
  previewWorkspacePackageExport,
  type WorkspacePackageExportCardSelection,
  type WorkspacePackageExportMetadataInput,
  type WorkspacePackageExportPackage,
  type WorkspacePackageExportPackageInput,
  type WorkspacePackageExportPreview,
  type WorkspacePackageExportPreviewInput,
  type WorkspacePackageExportTagPolicyInput,
} from "../workspacePackages";
import { assertUserHasWorkspaceAccess } from "../workspaces";
import {
  loadRequestContextFromRequest,
  parseWorkspaceIdParam,
  type RequestContext,
} from "../server/requestContext";
import { parseJsonBody } from "../server/requestParsing";
import { createBackendFailureDetails } from "../server/logging";
import {
  addBackendBreadcrumb,
  createBackendObservationScope,
  normalizeCaughtError,
  type BackendObservationScope,
} from "../observability/sentry";
import { reportBackendExceptionOrBreadcrumb } from "../observability/reporting";
import { HttpError, type HttpErrorDetails, type ValidationIssueSummary } from "../shared/errors";
import type { AppEnv } from "../server/app";

type WorkspacePackageRoutesOptions = Readonly<{
  allowedOrigins: ReadonlyArray<string>;
  loadRequestContextFromRequestFn?: typeof loadRequestContextFromRequest;
  assertUserHasWorkspaceAccessFn?: typeof assertUserHasWorkspaceAccess;
  previewWorkspacePackageExportFn?: typeof previewWorkspacePackageExport;
  exportWorkspacePackageFn?: typeof exportWorkspacePackage;
}>;

type WorkspacePackageExportRouteInput = Readonly<{
  selection: WorkspacePackageExportCardSelection;
  tagPolicy: WorkspacePackageExportTagPolicyInput;
  packageMetadata: WorkspacePackageExportMetadataInput;
}>;

type WorkspacePackageExportPreviewResponse = WorkspacePackageExportPreview;

const allActiveCardsSelectionSchema = z.object({
  kind: z.literal("allActiveCards"),
});

const tagFiltersSelectionSchema = z.object({
  kind: z.literal("tagFilters"),
  includeTags: z.array(z.string()),
  excludeTags: z.array(z.string()),
});

const explicitCardIdsSelectionSchema = z.object({
  kind: z.literal("explicitCardIds"),
  cardIds: z.array(z.string()).min(1),
});

const workspacePackageExportSelectionSchema = z.discriminatedUnion("kind", [
  allActiveCardsSelectionSchema,
  tagFiltersSelectionSchema,
  explicitCardIdsSelectionSchema,
]).transform((selection): WorkspacePackageExportCardSelection => {
  switch (selection.kind) {
  case "allActiveCards":
    return {
      kind: "allActiveCards",
    };
  case "tagFilters":
    return {
      kind: "tagFilters",
      includeTags: selection.includeTags,
      excludeTags: selection.excludeTags,
    };
  case "explicitCardIds":
    return {
      kind: "explicitCardIds",
      cardIds: selection.cardIds,
    };
  }
});

const workspacePackageExportTagPolicySchema = z.object({
  additionalRemovedTags: z.array(z.string()),
}).transform((tagPolicy): WorkspacePackageExportTagPolicyInput => ({
  additionalRemovedTags: tagPolicy.additionalRemovedTags,
}));

const workspacePackageExportMetadataSchema = z.object({
  label: z.string().nullable(),
  author: z.string().nullable(),
  comment: z.string().nullable(),
  createdAt: z.string().nullable(),
  sourceUrl: z.string().nullable(),
}).transform((packageMetadata): WorkspacePackageExportMetadataInput => ({
  label: packageMetadata.label,
  author: packageMetadata.author,
  comment: packageMetadata.comment,
  createdAt: packageMetadata.createdAt,
  sourceUrl: packageMetadata.sourceUrl,
}));

const workspacePackageExportRouteInputSchema = z.object({
  selection: workspacePackageExportSelectionSchema,
  tagPolicy: workspacePackageExportTagPolicySchema,
  packageMetadata: workspacePackageExportMetadataSchema,
}).transform((input): WorkspacePackageExportRouteInput => ({
  selection: input.selection,
  tagPolicy: input.tagPolicy,
  packageMetadata: input.packageMetadata,
}));

function summarizeValidationPath(path: ReadonlyArray<PropertyKey>): string {
  if (path.length === 0) {
    return "<root>";
  }

  return path.join(".");
}

function summarizeValidationIssue(issue: z.core.$ZodIssue): ValidationIssueSummary {
  return {
    path: summarizeValidationPath(issue.path),
    code: issue.code,
    message: issue.message,
  };
}

function summarizeValidationDetails(error: z.ZodError): HttpErrorDetails {
  return {
    validationIssues: error.issues.map(summarizeValidationIssue),
  };
}

export function parseWorkspacePackageExportRouteInput(value: unknown): WorkspacePackageExportRouteInput {
  const parsedInput = workspacePackageExportRouteInputSchema.safeParse(value);
  if (parsedInput.success) {
    return parsedInput.data;
  }

  throw new HttpError(
    400,
    "Workspace package export request is invalid.",
    "WORKSPACE_PACKAGE_EXPORT_REQUEST_INVALID",
    summarizeValidationDetails(parsedInput.error),
  );
}

function createWorkspacePackageExportInput(
  routeInput: WorkspacePackageExportRouteInput,
  generatedAt: string,
): WorkspacePackageExportPreviewInput {
  return {
    selection: routeInput.selection,
    tagPolicy: routeInput.tagPolicy,
    packageMetadata: routeInput.packageMetadata,
    generatedAt,
  };
}

function createWorkspacePackageScope(
  requestId: string,
  route: string,
  method: string,
  userId: string | null,
  workspaceId: string | null,
  clientAppVersion: string | null,
  clientPlatform: string | null,
): BackendObservationScope {
  return createBackendObservationScope(
    "backend-api",
    requestId,
    route,
    method,
    userId,
    workspaceId,
    null,
    null,
    null,
    clientAppVersion,
    clientPlatform,
  );
}

function getRequestContextUserId(requestContext: RequestContext | null): string | null {
  return requestContext === null ? null : requestContext.userId;
}

function createContentDispositionHeader(packageExport: WorkspacePackageExportPackage): string {
  return `attachment; filename="${packageExport.fileName}"`;
}

export function createWorkspacePackageRoutes(options: WorkspacePackageRoutesOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const loadRequestContextFromRequestFn = options.loadRequestContextFromRequestFn ?? loadRequestContextFromRequest;
  const assertUserHasWorkspaceAccessFn = options.assertUserHasWorkspaceAccessFn ?? assertUserHasWorkspaceAccess;
  const previewWorkspacePackageExportFn = options.previewWorkspacePackageExportFn ?? previewWorkspacePackageExport;
  const exportWorkspacePackageFn = options.exportWorkspacePackageFn ?? exportWorkspacePackage;

  app.post("/workspaces/:workspaceId/packages/export/preview", async (context) => {
    const requestId = context.get("requestId");
    let requestContext: RequestContext | null = null;
    let workspaceId: string | null = null;

    try {
      const loadedContext = await loadRequestContextFromRequestFn(context.req.raw, options.allowedOrigins);
      requestContext = loadedContext.requestContext;
      workspaceId = parseWorkspaceIdParam(context.req.param("workspaceId"));
      await assertUserHasWorkspaceAccessFn(requestContext.userId, workspaceId);
      const routeInput = parseWorkspacePackageExportRouteInput(await parseJsonBody(context.req.raw));
      const input = createWorkspacePackageExportInput(routeInput, new Date().toISOString());
      const preview = await previewWorkspacePackageExportFn(requestContext.userId, workspaceId, input);
      const scope = createWorkspacePackageScope(requestId, context.req.path, context.req.method, requestContext.userId, workspaceId, context.get("clientAppVersion"), context.get("clientPlatform"));
      addBackendBreadcrumb({
        action: "workspace_package_export_preview",
        scope,
        details: {
          statusCode: 200,
          selectedCardCount: preview.selectedCardCount,
          referencedMediaCount: preview.referencedMediaCount,
        },
      });

      return context.json(preview satisfies WorkspacePackageExportPreviewResponse);
    } catch (error) {
      const scope = createWorkspacePackageScope(requestId, context.req.path, context.req.method, getRequestContextUserId(requestContext), workspaceId, context.get("clientAppVersion"), context.get("clientPlatform"));
      const details = {
        selectedCardCount: null,
        referencedMediaCount: null,
        ...createBackendFailureDetails(error),
      };
      reportBackendExceptionOrBreadcrumb(
        error,
        { action: "workspace_package_export_preview_error", error: normalizeCaughtError(error), scope, details },
        { action: "workspace_package_export_preview_error", scope, details },
      );
      throw error;
    }
  });

  app.post("/workspaces/:workspaceId/packages/export", async (context) => {
    const requestId = context.get("requestId");
    let requestContext: RequestContext | null = null;
    let workspaceId: string | null = null;

    try {
      const loadedContext = await loadRequestContextFromRequestFn(context.req.raw, options.allowedOrigins);
      requestContext = loadedContext.requestContext;
      workspaceId = parseWorkspaceIdParam(context.req.param("workspaceId"));
      await assertUserHasWorkspaceAccessFn(requestContext.userId, workspaceId);
      const scope = createWorkspacePackageScope(requestId, context.req.path, context.req.method, requestContext.userId, workspaceId, context.get("clientAppVersion"), context.get("clientPlatform"));
      const routeInput = parseWorkspacePackageExportRouteInput(await parseJsonBody(context.req.raw));
      const input: WorkspacePackageExportPackageInput = {
        ...createWorkspacePackageExportInput(routeInput, new Date().toISOString()),
        observationScope: scope,
      };
      const packageExport = await exportWorkspacePackageFn(requestContext.userId, workspaceId, input);
      addBackendBreadcrumb({
        action: "workspace_package_export",
        scope,
        details: {
          statusCode: 200,
          bytesCount: packageExport.bytes.byteLength,
        },
      });

      context.header("Content-Disposition", createContentDispositionHeader(packageExport));
      context.header("Content-Length", packageExport.bytes.byteLength.toString());
      context.header("Content-Type", packageExport.contentType);
      return context.body(new Uint8Array(packageExport.bytes), 200);
    } catch (error) {
      const scope = createWorkspacePackageScope(requestId, context.req.path, context.req.method, getRequestContextUserId(requestContext), workspaceId, context.get("clientAppVersion"), context.get("clientPlatform"));
      const details = {
        bytesCount: null,
        ...createBackendFailureDetails(error),
      };
      reportBackendExceptionOrBreadcrumb(
        error,
        { action: "workspace_package_export_error", error: normalizeCaughtError(error), scope, details },
        { action: "workspace_package_export_error", scope, details },
      );
      throw error;
    }
  });

  return app;
}
