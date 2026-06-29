import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import {
  assertImageMediaAssetIngestionPreconditionsForWorkspace,
  assertMediaAssetUploadSessionPartNumbersInRange,
  beginMediaAssetUploadSessionAbortForWorkspace,
  beginMediaAssetUploadSessionCompletionForWorkspace,
  completeMediaAssetUploadSessionForWorkspace,
  createMediaAssetFromAvailableBlobForWorkspace,
  loadMediaAssetForWorkspace,
  loadMediaAssetUploadSessionForWorkspace,
  loadMediaAssetWithBlobForWorkspace,
  markMediaAssetUploadSessionAbortedForWorkspace,
  recordMediaAssetUploadSessionForWorkspace,
  recoverMediaAssetUploadSessionCompletionForWorkspace,
} from "../mediaAssets";
import { ingestImageMediaAsset } from "../mediaAssets/ingestion";
import {
  buildMediaBlobStorageKey,
  buildMediaMultipartUploadStagingStorageKey,
} from "../mediaAssets/storageKeys";
import {
  abortMultipartMediaAssetUpload,
  completeMultipartMediaAssetUpload,
  createMultipartMediaAssetUpload,
  createPresignedMediaAssetDownload,
  createPresignedMediaAssetUploadParts,
} from "../mediaAssets/storage";
import {
  parseCompleteMediaAssetUploadSessionInput,
  parseMediaAssetImageIngestionMetadataHeaders,
  parseMediaAssetIdParam,
  parseMediaAssetUploadSessionCreateInput,
  parseMediaAssetUploadSessionIdParam,
  parseMediaAssetUploadSessionPartUrlsInput,
  readMediaAssetImageIngestionBytes,
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
import { HttpError } from "../shared/errors";

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

function getFailureStatusCode(error: unknown): number {
  return error instanceof HttpError ? error.statusCode : 500;
}

function getFailureCode(error: unknown): string {
  if (error instanceof HttpError) {
    return error.code ?? "HTTP_ERROR";
  }

  return "INTERNAL_ERROR";
}

function createUploadSessionCompletionRecoveryError(
  completionError: unknown,
  recoveryError: unknown,
  workspaceId: string,
  sessionId: string,
): HttpError {
  return new HttpError(
    500,
    [
      "Media asset upload completion failed and the upload session could not be restored for retry",
      `workspaceId=${workspaceId}`,
      `sessionId=${sessionId}`,
      `completionStatusCode=${getFailureStatusCode(completionError)}`,
      `completionCode=${getFailureCode(completionError)}`,
      `recoveryStatusCode=${getFailureStatusCode(recoveryError)}`,
      `recoveryCode=${getFailureCode(recoveryError)}`,
    ].join(" "),
    "MEDIA_ASSET_UPLOAD_SESSION_RECOVERY_FAILED",
  );
}

export function createMediaAssetsRoutes(options: MediaAssetsRoutesOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post("/workspaces/:workspaceId/media-assets/images", async (context) => {
    const requestId = context.get("requestId");
    let requestContext: RequestContext | null = null;
    let workspaceId: string | null = null;
    let mediaAssetId: string | null = null;

    try {
      const loadedContext = await loadRequestContextFromRequest(context.req.raw, options.allowedOrigins);
      requestContext = loadedContext.requestContext;
      workspaceId = parseWorkspaceIdParam(context.req.param("workspaceId"));
      await assertUserHasWorkspaceAccess(loadedContext.requestContext.userId, workspaceId);
      const metadata = parseMediaAssetImageIngestionMetadataHeaders(context.req.raw.headers);
      mediaAssetId = metadata.mediaAssetId;
      await assertImageMediaAssetIngestionPreconditionsForWorkspace(
        loadedContext.requestContext.userId,
        workspaceId,
        metadata,
      );
      const imageBytes = await readMediaAssetImageIngestionBytes(context.req.raw);
      const scope = createMediaAssetsScope(requestId, context.req.path, context.req.method, loadedContext.requestContext.userId, workspaceId, context.get("clientAppVersion"), context.get("clientPlatform"));
      const result = await ingestImageMediaAsset({
        userId: loadedContext.requestContext.userId,
        workspaceId,
        metadata,
        imageBytes,
        observationScope: scope,
      });

      addBackendBreadcrumb({
        action: "media_asset_image_ingest",
        scope,
        details: {
          statusCode: 200,
          mediaAssetId,
          mimeType: result.mediaAsset.mimeType,
          sizeBytes: result.mediaAsset.sizeBytes,
          applied: result.applied,
        },
      });
      return context.json(result);
    } catch (error) {
      const scope = createMediaAssetsScope(requestId, context.req.path, context.req.method, getRequestContextUserId(requestContext), workspaceId, context.get("clientAppVersion"), context.get("clientPlatform"));
      const details = {
        mediaAssetId,
        ...createBackendFailureDetails(error),
      };
      reportBackendExceptionOrBreadcrumb(
        error,
        { action: "media_asset_image_ingest_error", error: normalizeCaughtError(error), scope, details },
        { action: "media_asset_image_ingest_error", scope, details },
      );
      throw error;
    }
  });

  app.post("/workspaces/:workspaceId/media-assets/upload-sessions", async (context) => {
    const requestId = context.get("requestId");
    let requestContext: RequestContext | null = null;
    let workspaceId: string | null = null;
    let mediaAssetId: string | null = null;
    let sessionId: string | null = null;

    try {
      const loadedContext = await loadRequestContextFromRequest(context.req.raw, options.allowedOrigins);
      requestContext = loadedContext.requestContext;
      workspaceId = parseWorkspaceIdParam(context.req.param("workspaceId"));
      await assertUserHasWorkspaceAccess(loadedContext.requestContext.userId, workspaceId);
      const input = parseMediaAssetUploadSessionCreateInput(await parseJsonBody(context.req.raw));
      mediaAssetId = input.mediaAssetId;
      sessionId = randomUUID();
      const storageKey = buildMediaMultipartUploadStagingStorageKey(workspaceId, input.mediaAssetId, sessionId);
      const blobStorageKey = buildMediaBlobStorageKey(input.sha256);
      const scope = createMediaAssetsScope(requestId, context.req.path, context.req.method, loadedContext.requestContext.userId, workspaceId, context.get("clientAppVersion"), context.get("clientPlatform"));
      const availableResult = await createMediaAssetFromAvailableBlobForWorkspace(
        loadedContext.requestContext.userId,
        workspaceId,
        input,
      );
      if (availableResult !== null) {
        addBackendBreadcrumb({
          action: "media_asset_upload_session_media_reuse",
          scope,
          details: {
            statusCode: 200,
            mediaAssetId: input.mediaAssetId,
            mimeType: input.mimeType,
            sizeBytes: input.sizeBytes,
            applied: availableResult.applied,
          },
        });
        return context.json({
          workspaceId,
          mediaAssetId: input.mediaAssetId,
          status: "already_available",
          mediaAsset: availableResult.mediaAsset,
          uploadSession: null,
        });
      }

      const multipartUpload = await createMultipartMediaAssetUpload({
        workspaceId,
        mediaAssetId: input.mediaAssetId,
        stagingStorageKey: storageKey,
        mimeType: input.mimeType,
        sha256: input.sha256,
        lastOperationId: input.lastOperationId,
        observationScope: scope,
      });
      const sessionResult = await recordMediaAssetUploadSessionForWorkspace(
        loadedContext.requestContext.userId,
        workspaceId,
        sessionId,
        input,
        multipartUpload.storageKey,
        blobStorageKey,
        multipartUpload.s3UploadId,
        multipartUpload.expiresAt,
      );
      if (sessionResult.status === "already_available") {
        await abortMultipartMediaAssetUpload({
          workspaceId,
          mediaAssetId: input.mediaAssetId,
          stagingStorageKey: storageKey,
          s3UploadId: multipartUpload.s3UploadId,
          observationScope: scope,
        });

        addBackendBreadcrumb({
          action: "media_asset_upload_session_concurrent_media_reuse",
          scope,
          details: {
            statusCode: 200,
            mediaAssetId: input.mediaAssetId,
            mimeType: input.mimeType,
            sizeBytes: input.sizeBytes,
            applied: sessionResult.applied,
          },
        });
        return context.json({
          workspaceId,
          mediaAssetId: input.mediaAssetId,
          status: "already_available",
          mediaAsset: sessionResult.mediaAsset,
          uploadSession: null,
        });
      }

      sessionId = sessionResult.uploadSession.sessionId;
      addBackendBreadcrumb({
        action: "media_asset_upload_session_create",
        scope,
        details: {
          statusCode: 201,
          mediaAssetId: input.mediaAssetId,
          sessionId,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
          partSizeBytes: input.partSizeBytes,
          partCount: input.partCount,
        },
      });
      return context.json({
        workspaceId,
        mediaAssetId: input.mediaAssetId,
        status: "upload_required",
        mediaAsset: null,
        uploadSession: {
          sessionId: sessionResult.uploadSession.sessionId,
          expiresAt: sessionResult.uploadSession.expiresAt,
          partSizeBytes: sessionResult.uploadSession.partSizeBytes,
          partCount: sessionResult.uploadSession.partCount,
        },
      }, 201);
    } catch (error) {
      const scope = createMediaAssetsScope(requestId, context.req.path, context.req.method, getRequestContextUserId(requestContext), workspaceId, context.get("clientAppVersion"), context.get("clientPlatform"));
      const details = {
        mediaAssetId,
        sessionId,
        ...createBackendFailureDetails(error),
      };
      reportBackendExceptionOrBreadcrumb(
        error,
        { action: "media_asset_upload_session_create_error", error: normalizeCaughtError(error), scope, details },
        { action: "media_asset_upload_session_create_error", scope, details },
      );
      throw error;
    }
  });

  app.post("/workspaces/:workspaceId/media-assets/upload-sessions/:sessionId/parts", async (context) => {
    const requestId = context.get("requestId");
    let requestContext: RequestContext | null = null;
    let workspaceId: string | null = null;
    let mediaAssetId: string | null = null;
    let sessionId: string | null = null;

    try {
      const loadedContext = await loadRequestContextFromRequest(context.req.raw, options.allowedOrigins);
      requestContext = loadedContext.requestContext;
      workspaceId = parseWorkspaceIdParam(context.req.param("workspaceId"));
      await assertUserHasWorkspaceAccess(loadedContext.requestContext.userId, workspaceId);
      sessionId = parseMediaAssetUploadSessionIdParam(context.req.param("sessionId"));
      const input = parseMediaAssetUploadSessionPartUrlsInput(await parseJsonBody(context.req.raw));
      const session = await loadMediaAssetUploadSessionForWorkspace(
        loadedContext.requestContext.userId,
        workspaceId,
        sessionId,
      );
      mediaAssetId = session.mediaAssetId;
      assertMediaAssetUploadSessionPartNumbersInRange(session, input.parts);
      const scope = createMediaAssetsScope(requestId, context.req.path, context.req.method, loadedContext.requestContext.userId, workspaceId, context.get("clientAppVersion"), context.get("clientPlatform"));
      const partUrls = await createPresignedMediaAssetUploadParts({
        workspaceId,
        mediaAssetId: session.mediaAssetId,
        stagingStorageKey: session.stagingStorageKey,
        s3UploadId: session.s3UploadId,
        parts: input.parts,
        observationScope: scope,
      });

      addBackendBreadcrumb({
        action: "media_asset_upload_session_part_urls_create",
        scope,
        details: {
          statusCode: 200,
          mediaAssetId: session.mediaAssetId,
          sessionId,
          partCount: input.parts.length,
        },
      });
      return context.json({ sessionId, partUrls });
    } catch (error) {
      const scope = createMediaAssetsScope(requestId, context.req.path, context.req.method, getRequestContextUserId(requestContext), workspaceId, context.get("clientAppVersion"), context.get("clientPlatform"));
      const details = {
        mediaAssetId,
        sessionId,
        ...createBackendFailureDetails(error),
      };
      reportBackendExceptionOrBreadcrumb(
        error,
        { action: "media_asset_upload_session_part_urls_create_error", error: normalizeCaughtError(error), scope, details },
        { action: "media_asset_upload_session_part_urls_create_error", scope, details },
      );
      throw error;
    }
  });

  app.post("/workspaces/:workspaceId/media-assets/upload-sessions/:sessionId/complete", async (context) => {
    const requestId = context.get("requestId");
    let requestContext: RequestContext | null = null;
    let workspaceId: string | null = null;
    let mediaAssetId: string | null = null;
    let sessionId: string | null = null;

    try {
      const loadedContext = await loadRequestContextFromRequest(context.req.raw, options.allowedOrigins);
      requestContext = loadedContext.requestContext;
      workspaceId = parseWorkspaceIdParam(context.req.param("workspaceId"));
      await assertUserHasWorkspaceAccess(loadedContext.requestContext.userId, workspaceId);
      sessionId = parseMediaAssetUploadSessionIdParam(context.req.param("sessionId"));
      const input = parseCompleteMediaAssetUploadSessionInput(await parseJsonBody(context.req.raw));
      const completionStart = await beginMediaAssetUploadSessionCompletionForWorkspace(
        loadedContext.requestContext.userId,
        workspaceId,
        sessionId,
        input.parts,
      );
      if (completionStart.status === "already_completed") {
        return context.json({
          mediaAsset: completionStart.mediaAsset,
          applied: completionStart.applied,
        });
      }

      const session = completionStart.uploadSession;
      mediaAssetId = session.mediaAssetId;
      const scope = createMediaAssetsScope(requestId, context.req.path, context.req.method, loadedContext.requestContext.userId, workspaceId, context.get("clientAppVersion"), context.get("clientPlatform"));

      try {
        await completeMultipartMediaAssetUpload({
          workspaceId,
          mediaAssetId: session.mediaAssetId,
          stagingStorageKey: session.stagingStorageKey,
          blobStorageKey: session.blobStorageKey,
          s3UploadId: session.s3UploadId,
          mimeType: session.mimeType,
          sizeBytes: session.sizeBytes,
          sha256: session.mediaBlobSha256,
          lastOperationId: session.lastOperationId,
          parts: input.parts,
          observationScope: scope,
        });
      } catch (completionError) {
        try {
          await recoverMediaAssetUploadSessionCompletionForWorkspace(
            loadedContext.requestContext.userId,
            workspaceId,
            sessionId,
          );
        } catch (recoveryError) {
          throw createUploadSessionCompletionRecoveryError(
            completionError,
            recoveryError,
            workspaceId,
            sessionId,
          );
        }

        throw completionError;
      }
      const result = await completeMediaAssetUploadSessionForWorkspace(
        loadedContext.requestContext.userId,
        workspaceId,
        sessionId,
      );

      addBackendBreadcrumb({
        action: "media_asset_upload_session_complete",
        scope,
        details: {
          statusCode: 200,
          mediaAssetId: session.mediaAssetId,
          sessionId,
          mimeType: session.mimeType,
          sizeBytes: session.sizeBytes,
          applied: result.applied,
        },
      });
      return context.json(result);
    } catch (error) {
      const scope = createMediaAssetsScope(requestId, context.req.path, context.req.method, getRequestContextUserId(requestContext), workspaceId, context.get("clientAppVersion"), context.get("clientPlatform"));
      const details = {
        mediaAssetId,
        sessionId,
        ...createBackendFailureDetails(error),
      };
      reportBackendExceptionOrBreadcrumb(
        error,
        { action: "media_asset_upload_session_complete_error", error: normalizeCaughtError(error), scope, details },
        { action: "media_asset_upload_session_complete_error", scope, details },
      );
      throw error;
    }
  });

  app.post("/workspaces/:workspaceId/media-assets/upload-sessions/:sessionId/abort", async (context) => {
    const requestId = context.get("requestId");
    let requestContext: RequestContext | null = null;
    let workspaceId: string | null = null;
    let mediaAssetId: string | null = null;
    let sessionId: string | null = null;

    try {
      const loadedContext = await loadRequestContextFromRequest(context.req.raw, options.allowedOrigins);
      requestContext = loadedContext.requestContext;
      workspaceId = parseWorkspaceIdParam(context.req.param("workspaceId"));
      await assertUserHasWorkspaceAccess(loadedContext.requestContext.userId, workspaceId);
      sessionId = parseMediaAssetUploadSessionIdParam(context.req.param("sessionId"));
      const abortStart = await beginMediaAssetUploadSessionAbortForWorkspace(
        loadedContext.requestContext.userId,
        workspaceId,
        sessionId,
      );
      if (abortStart.status === "already_aborted") {
        return context.json({ sessionId, abortedAt: abortStart.uploadSession.abortedAt });
      }

      const session = abortStart.uploadSession;
      mediaAssetId = session.mediaAssetId;
      const scope = createMediaAssetsScope(requestId, context.req.path, context.req.method, loadedContext.requestContext.userId, workspaceId, context.get("clientAppVersion"), context.get("clientPlatform"));
      await abortMultipartMediaAssetUpload({
        workspaceId,
        mediaAssetId: session.mediaAssetId,
        stagingStorageKey: session.stagingStorageKey,
        s3UploadId: session.s3UploadId,
        observationScope: scope,
      });
      const abortedSession = await markMediaAssetUploadSessionAbortedForWorkspace(
        loadedContext.requestContext.userId,
        workspaceId,
        sessionId,
      );

      addBackendBreadcrumb({
        action: "media_asset_upload_session_abort",
        scope,
        details: {
          statusCode: 200,
          mediaAssetId: session.mediaAssetId,
          sessionId,
        },
      });
      return context.json({ sessionId, abortedAt: abortedSession.abortedAt });
    } catch (error) {
      const scope = createMediaAssetsScope(requestId, context.req.path, context.req.method, getRequestContextUserId(requestContext), workspaceId, context.get("clientAppVersion"), context.get("clientPlatform"));
      const details = {
        mediaAssetId,
        sessionId,
        ...createBackendFailureDetails(error),
      };
      reportBackendExceptionOrBreadcrumb(
        error,
        { action: "media_asset_upload_session_abort_error", error: normalizeCaughtError(error), scope, details },
        { action: "media_asset_upload_session_abort_error", scope, details },
      );
      throw error;
    }
  });

  app.get("/workspaces/:workspaceId/media-assets/:mediaAssetId", async (context) => {
    const requestId = context.get("requestId");
    let requestContext: RequestContext | null = null;
    let workspaceId: string | null = null;
    let mediaAssetId: string | null = null;

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
      const scope = createMediaAssetsScope(requestId, context.req.path, context.req.method, loadedContext.requestContext.userId, workspaceId, context.get("clientAppVersion"), context.get("clientPlatform"));

      addBackendBreadcrumb({
        action: "media_asset_get",
        scope,
        details: {
          statusCode: 200,
          mediaAssetId,
        },
      });
      return context.json({ mediaAsset });
    } catch (error) {
      const scope = createMediaAssetsScope(requestId, context.req.path, context.req.method, getRequestContextUserId(requestContext), workspaceId, context.get("clientAppVersion"), context.get("clientPlatform"));
      const details = {
        mediaAssetId,
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

    try {
      const loadedContext = await loadRequestContextFromRequest(context.req.raw, options.allowedOrigins);
      requestContext = loadedContext.requestContext;
      workspaceId = parseWorkspaceIdParam(context.req.param("workspaceId"));
      await assertUserHasWorkspaceAccess(loadedContext.requestContext.userId, workspaceId);
      mediaAssetId = parseMediaAssetIdParam(context.req.param("mediaAssetId"));
      const { mediaAsset, mediaBlob } = await loadMediaAssetWithBlobForWorkspace(
        loadedContext.requestContext.userId,
        workspaceId,
        mediaAssetId,
      );
      const scope = createMediaAssetsScope(requestId, context.req.path, context.req.method, loadedContext.requestContext.userId, workspaceId, context.get("clientAppVersion"), context.get("clientPlatform"));
      const download = await createPresignedMediaAssetDownload({
        workspaceId,
        mediaAssetId,
        storageKey: mediaBlob.storageKey,
        observationScope: scope,
      });

      addBackendBreadcrumb({
        action: "media_asset_download_url_create",
        scope,
        details: {
          statusCode: 200,
          mediaAssetId,
        },
      });
      return context.json({ mediaAsset, download });
    } catch (error) {
      const scope = createMediaAssetsScope(requestId, context.req.path, context.req.method, getRequestContextUserId(requestContext), workspaceId, context.get("clientAppVersion"), context.get("clientPlatform"));
      const details = {
        mediaAssetId,
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
