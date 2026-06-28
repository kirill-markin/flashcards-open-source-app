import { Hono } from "hono";
import {
  assertMediaAssetUploadIntentAvailableForWorkspace,
  completeMediaAssetUploadForWorkspace,
  loadMediaAssetForWorkspace,
} from "../mediaAssets";
import { buildMediaAssetStorageKey } from "../mediaAssets/storageKeys";
import {
  assertMediaAssetObjectMatches,
  createPresignedMediaAssetDownload,
  createPresignedMediaAssetUpload,
} from "../mediaAssets/storage";
import {
  parseCompleteMediaAssetUploadInput,
  parseMediaAssetIdParam,
  parseMediaAssetUploadIntentInput,
} from "../mediaAssets/validators";
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
import type { AppEnv } from "../server/app";

type MediaAssetsRoutesOptions = Readonly<{
  allowedOrigins: ReadonlyArray<string>;
}>;

function getRequestContextUserId(requestContext: RequestContext | null): string | null {
  return requestContext === null ? null : requestContext.userId;
}

function createMediaAssetsScope(
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

export function createMediaAssetsRoutes(options: MediaAssetsRoutesOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post("/workspaces/:workspaceId/media-assets/upload-intents", async (context) => {
    const requestId = context.get("requestId");
    let requestContext: RequestContext | null = null;
    let workspaceId: string | null = null;
    let mediaAssetId: string | null = null;
    let storageKey: string | null = null;

    try {
      const loadedContext = await loadRequestContextFromRequest(context.req.raw, options.allowedOrigins);
      requestContext = loadedContext.requestContext;
      workspaceId = parseWorkspaceIdParam(context.req.param("workspaceId"));
      await assertUserHasWorkspaceAccess(loadedContext.requestContext.userId, workspaceId);
      const input = parseMediaAssetUploadIntentInput(await parseJsonBody(context.req.raw));
      mediaAssetId = input.mediaAssetId;
      storageKey = buildMediaAssetStorageKey(workspaceId, input.mediaAssetId, input.sha256);
      await assertMediaAssetUploadIntentAvailableForWorkspace(
        loadedContext.requestContext.userId,
        workspaceId,
        input.mediaAssetId,
      );
      const scope = createMediaAssetsScope(requestId, context.req.path, context.req.method, loadedContext.requestContext.userId, workspaceId, context.get("clientAppVersion"), context.get("clientPlatform"));
      const upload = await createPresignedMediaAssetUpload({
        workspaceId,
        mediaAssetId: input.mediaAssetId,
        storageKey,
        mimeType: input.mimeType,
        sha256: input.sha256,
        observationScope: scope,
      });

      addBackendBreadcrumb({
        action: "media_asset_upload_intent_create",
        scope,
        details: {
          statusCode: 201,
          mediaAssetId: input.mediaAssetId,
          storageKey,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
          sha256: input.sha256,
        },
      });
      return context.json({
        mediaAssetId: input.mediaAssetId,
        workspaceId,
        storageKey,
        upload,
      }, 201);
    } catch (error) {
      const scope = createMediaAssetsScope(requestId, context.req.path, context.req.method, getRequestContextUserId(requestContext), workspaceId, context.get("clientAppVersion"), context.get("clientPlatform"));
      const details = {
        mediaAssetId,
        storageKey,
        ...createBackendFailureDetails(error),
      };
      reportBackendExceptionOrBreadcrumb(
        error,
        { action: "media_asset_upload_intent_create_error", error: normalizeCaughtError(error), scope, details },
        { action: "media_asset_upload_intent_create_error", scope, details },
      );
      throw error;
    }
  });

  app.post("/workspaces/:workspaceId/media-assets/:mediaAssetId/complete", async (context) => {
    const requestId = context.get("requestId");
    let requestContext: RequestContext | null = null;
    let workspaceId: string | null = null;
    let mediaAssetId: string | null = null;
    let storageKey: string | null = null;

    try {
      const loadedContext = await loadRequestContextFromRequest(context.req.raw, options.allowedOrigins);
      requestContext = loadedContext.requestContext;
      workspaceId = parseWorkspaceIdParam(context.req.param("workspaceId"));
      await assertUserHasWorkspaceAccess(loadedContext.requestContext.userId, workspaceId);
      mediaAssetId = parseMediaAssetIdParam(context.req.param("mediaAssetId"));
      const input = parseCompleteMediaAssetUploadInput(mediaAssetId, await parseJsonBody(context.req.raw));
      storageKey = buildMediaAssetStorageKey(workspaceId, input.mediaAssetId, input.sha256);
      const scope = createMediaAssetsScope(requestId, context.req.path, context.req.method, loadedContext.requestContext.userId, workspaceId, context.get("clientAppVersion"), context.get("clientPlatform"));

      await assertMediaAssetObjectMatches({
        workspaceId,
        mediaAssetId: input.mediaAssetId,
        storageKey,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        sha256: input.sha256,
        observationScope: scope,
      });
      const result = await completeMediaAssetUploadForWorkspace(
        loadedContext.requestContext.userId,
        workspaceId,
        input,
      );

      addBackendBreadcrumb({
        action: "media_asset_upload_complete",
        scope,
        details: {
          statusCode: 200,
          mediaAssetId: input.mediaAssetId,
          storageKey,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
          sha256: input.sha256,
          applied: result.applied,
        },
      });
      return context.json(result);
    } catch (error) {
      const scope = createMediaAssetsScope(requestId, context.req.path, context.req.method, getRequestContextUserId(requestContext), workspaceId, context.get("clientAppVersion"), context.get("clientPlatform"));
      const details = {
        mediaAssetId,
        storageKey,
        ...createBackendFailureDetails(error),
      };
      reportBackendExceptionOrBreadcrumb(
        error,
        { action: "media_asset_upload_complete_error", error: normalizeCaughtError(error), scope, details },
        { action: "media_asset_upload_complete_error", scope, details },
      );
      throw error;
    }
  });

  app.get("/workspaces/:workspaceId/media-assets/:mediaAssetId", async (context) => {
    const requestId = context.get("requestId");
    let requestContext: RequestContext | null = null;
    let workspaceId: string | null = null;
    let mediaAssetId: string | null = null;
    let storageKey: string | null = null;

    try {
      const loadedContext = await loadRequestContextFromRequest(context.req.raw, options.allowedOrigins);
      requestContext = loadedContext.requestContext;
      workspaceId = parseWorkspaceIdParam(context.req.param("workspaceId"));
      await assertUserHasWorkspaceAccess(loadedContext.requestContext.userId, workspaceId);
      mediaAssetId = parseMediaAssetIdParam(context.req.param("mediaAssetId"));
      const mediaAsset = await loadMediaAssetForWorkspace(
        loadedContext.requestContext.userId,
        workspaceId,
        mediaAssetId,
      );
      storageKey = mediaAsset.storageKey;
      const scope = createMediaAssetsScope(requestId, context.req.path, context.req.method, loadedContext.requestContext.userId, workspaceId, context.get("clientAppVersion"), context.get("clientPlatform"));

      addBackendBreadcrumb({
        action: "media_asset_get",
        scope,
        details: {
          statusCode: 200,
          mediaAssetId,
          storageKey,
        },
      });
      return context.json({ mediaAsset });
    } catch (error) {
      const scope = createMediaAssetsScope(requestId, context.req.path, context.req.method, getRequestContextUserId(requestContext), workspaceId, context.get("clientAppVersion"), context.get("clientPlatform"));
      const details = {
        mediaAssetId,
        storageKey,
        ...createBackendFailureDetails(error),
      };
      reportBackendExceptionOrBreadcrumb(
        error,
        { action: "media_asset_get_error", error: normalizeCaughtError(error), scope, details },
        { action: "media_asset_get_error", scope, details },
      );
      throw error;
    }
  });

  app.get("/workspaces/:workspaceId/media-assets/:mediaAssetId/download-url", async (context) => {
    const requestId = context.get("requestId");
    let requestContext: RequestContext | null = null;
    let workspaceId: string | null = null;
    let mediaAssetId: string | null = null;
    let storageKey: string | null = null;

    try {
      const loadedContext = await loadRequestContextFromRequest(context.req.raw, options.allowedOrigins);
      requestContext = loadedContext.requestContext;
      workspaceId = parseWorkspaceIdParam(context.req.param("workspaceId"));
      await assertUserHasWorkspaceAccess(loadedContext.requestContext.userId, workspaceId);
      mediaAssetId = parseMediaAssetIdParam(context.req.param("mediaAssetId"));
      const mediaAsset = await loadMediaAssetForWorkspace(
        loadedContext.requestContext.userId,
        workspaceId,
        mediaAssetId,
      );
      storageKey = mediaAsset.storageKey;
      const scope = createMediaAssetsScope(requestId, context.req.path, context.req.method, loadedContext.requestContext.userId, workspaceId, context.get("clientAppVersion"), context.get("clientPlatform"));
      const download = await createPresignedMediaAssetDownload({
        workspaceId,
        mediaAssetId,
        storageKey: mediaAsset.storageKey,
        observationScope: scope,
      });

      addBackendBreadcrumb({
        action: "media_asset_download_url_create",
        scope,
        details: {
          statusCode: 200,
          mediaAssetId,
          storageKey: mediaAsset.storageKey,
        },
      });
      return context.json({ mediaAsset, download });
    } catch (error) {
      const scope = createMediaAssetsScope(requestId, context.req.path, context.req.method, getRequestContextUserId(requestContext), workspaceId, context.get("clientAppVersion"), context.get("clientPlatform"));
      const details = {
        mediaAssetId,
        storageKey,
        ...createBackendFailureDetails(error),
      };
      reportBackendExceptionOrBreadcrumb(
        error,
        { action: "media_asset_download_url_create_error", error: normalizeCaughtError(error), scope, details },
        { action: "media_asset_download_url_create_error", scope, details },
      );
      throw error;
    }
  });

  return app;
}
