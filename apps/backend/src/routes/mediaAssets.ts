import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import {
  loadMediaAssetForWorkspace,
  loadMediaAssetWithBlobForWorkspace,
} from "../mediaAssets";
import {
  assertMediaAssetUploadSessionPartNumbersInRange,
  isMediaAssetUploadSessionExpired,
  loadMediaAssetUploadSessionForCompletionForWorkspace,
  loadMediaAssetUploadSessionForWorkspace,
} from "../mediaAssets/uploadSessions";
import {
  createMediaAssetsScope,
  createMultipartCompletionDeadlineError,
  createMultipartCompletionRequestDeadline,
  createUploadSessionExpiredError,
  getRequestContextUserId,
  runDatabaseOperationOnce,
} from "../mediaAssets/multipart/requestBoundary";
import {
  createMultipartUploadSessionAtApplicationBoundary,
  multipartUploadSessionCreationApplicationDependencies,
  multipartUploadSessionCreationClaimLeaseDurationMs,
  type MultipartUploadSessionCreationApplicationDependencies,
} from "../mediaAssets/multipart/creationBoundary";
import {
  mapMultipartCompletionDeadlineError,
} from "../mediaAssets/multipart/writerLease";
import {
  abortMultipartUploadSessionAtApplicationBoundary,
  beginUploadSessionAbort,
  completeMultipartUploadSessionAtApplicationBoundary,
  multipartCompletionApplicationDependencies,
} from "../mediaAssets/multipart/completionBoundary";
import {
  buildMediaBlobStorageKey,
  buildMediaMultipartUploadStagingStorageKey,
} from "../mediaAssets/storageKeys";
import {
  abortMultipartMediaAssetUpload,
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
} from "../mediaAssets/validators";
import { assertUserHasWorkspaceAccess } from "../workspaces";
import {
  loadRequestContextFromRequest,
  loadRequestContextFromRequestWithAbortSignal,
  parseWorkspaceIdParam,
  type RequestContext,
} from "../server/requestContext";
import { parseJsonBody } from "../server/requestParsing";
import { createBackendFailureDetails } from "../server/logging";
import {
  addBackendBreadcrumb,
  normalizeCaughtError,
} from "../observability/sentry";
import { reportBackendExceptionOrBreadcrumb } from "../observability/reporting";
import type { AppEnv } from "../server/app";
import { runDatabaseOperationsWithDeadline } from "../database";
import {
  createDirectImageIngestionRoutes,
  type DirectImageIngestionRoutesOptions,
} from "./directImageIngestion";
import {
  createStandaloneMultipartCompletionRequestTiming,
  getMultipartCompletionRequestTimingContext,
} from "../server/multipartCompletionRequestTiming";

type MediaAssetsRoutesOptions = DirectImageIngestionRoutesOptions & Readonly<{
  loadRequestContextFromRequestFn?: typeof loadRequestContextFromRequest;
  multipartUploadSessionCreationApplicationDependencies?:
    MultipartUploadSessionCreationApplicationDependencies;
}>;

export function createMediaAssetsRoutes(options: MediaAssetsRoutesOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const loadRequestContextFromRequestFn =
    options.loadRequestContextFromRequestFn ?? loadRequestContextFromRequest;
  const assertUserHasWorkspaceAccessFn =
    options.assertUserHasWorkspaceAccessFn ?? assertUserHasWorkspaceAccess;
  const multipartUploadSessionCreationDependencies =
    options.multipartUploadSessionCreationApplicationDependencies
    ?? multipartUploadSessionCreationApplicationDependencies;

  app.route("/", createDirectImageIngestionRoutes(options));

  app.post("/workspaces/:workspaceId/media-assets/upload-sessions", async (context) => {
    const requestId = context.get("requestId");
    let requestContext: RequestContext | null = null;
    let workspaceId: string | null = null;
    let mediaAssetId: string | null = null;
    let sessionId: string | null = null;

    try {
      const loadedContext = await loadRequestContextFromRequestFn(context.req.raw, options.allowedOrigins);
      requestContext = loadedContext.requestContext;
      workspaceId = parseWorkspaceIdParam(context.req.param("workspaceId"));
      await assertUserHasWorkspaceAccessFn(loadedContext.requestContext.userId, workspaceId);
      const input = parseMediaAssetUploadSessionCreateInput(await parseJsonBody(context.req.raw));
      mediaAssetId = input.mediaAssetId;
      sessionId = randomUUID();
      const claimToken = randomUUID();
      const storageKey = buildMediaMultipartUploadStagingStorageKey(workspaceId, input.mediaAssetId, sessionId);
      const blobStorageKey = buildMediaBlobStorageKey(input.sha256);
      const scope = createMediaAssetsScope(requestId, context.req.path, context.req.method, loadedContext.requestContext.userId, workspaceId, context.get("clientAppVersion"), context.get("clientPlatform"));
      const applicationResult =
        await createMultipartUploadSessionAtApplicationBoundary(
          loadedContext.requestContext.userId,
          workspaceId,
          sessionId,
          claimToken,
          input,
          storageKey,
          blobStorageKey,
          scope,
          context.req.raw.signal,
          multipartUploadSessionCreationClaimLeaseDurationMs,
          multipartUploadSessionCreationDependencies,
        );
      const sessionResult = applicationResult.sessionResult;
      if (sessionResult.status === "already_available") {
        addBackendBreadcrumb({
          action: applicationResult.multipartUploadCreated
            ? "media_asset_upload_session_concurrent_media_reuse"
            : "media_asset_upload_session_media_reuse",
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
      const scope = createMediaAssetsScope(requestId, context.req.path, context.req.method, loadedContext.requestContext.userId, workspaceId, context.get("clientAppVersion"), context.get("clientPlatform"));
      if (isMediaAssetUploadSessionExpired(session)) {
        const expiry = await beginUploadSessionAbort(
          loadedContext.requestContext.userId,
          workspaceId,
          sessionId,
          runDatabaseOperationOnce,
        );
        await abortMultipartUploadSessionAtApplicationBoundary(
          loadedContext.requestContext.userId,
          expiry,
          scope,
          context.req.raw.signal,
          runDatabaseOperationOnce,
          abortMultipartMediaAssetUpload,
        );
        throw createUploadSessionExpiredError(session);
      }
      assertMediaAssetUploadSessionPartNumbersInRange(session, input.parts);
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
    const observedAtMs = Date.now();
    const timingContext = getMultipartCompletionRequestTimingContext();
    const requestTiming = timingContext === null
      ? createStandaloneMultipartCompletionRequestTiming(observedAtMs)
      : timingContext.timing;
    const requestDeadlineAtMs =
      requestTiming?.requestDeadlineAtMs ?? observedAtMs;
    const operationDeadlineAtMs =
      requestTiming?.operationDeadlineAtMs ?? observedAtMs;
    const writerLeaseTargetAtMs =
      requestTiming?.writerLeaseTargetAtMs ?? observedAtMs;
    const requestDeadline =
      createMultipartCompletionRequestDeadline(requestDeadlineAtMs);
    const operationDeadline =
      createMultipartCompletionRequestDeadline(operationDeadlineAtMs);
    const requestId = context.get("requestId");
    let requestContext: RequestContext | null = null;
    let workspaceId: string | null = null;
    let mediaAssetId: string | null = null;
    let sessionId: string | null = null;

    try {
      if (
        requestTiming === null
        || observedAtMs >= requestTiming.acquisitionDeadlineAtMs
        || observedAtMs >= requestTiming.integrationDeadlineAtMs
      ) {
        throw createMultipartCompletionDeadlineError();
      }
      return await runDatabaseOperationsWithDeadline(
        requestDeadlineAtMs,
        async () => {
          const prepared = await runDatabaseOperationsWithDeadline(
            operationDeadlineAtMs,
            async () => {
              const loadedContext =
                await loadRequestContextFromRequestWithAbortSignal(
                  context.req.raw,
                  options.allowedOrigins,
                  operationDeadline.signal,
                );
              requestContext = loadedContext.requestContext;
              const parsedWorkspaceId = parseWorkspaceIdParam(
                context.req.param("workspaceId"),
              );
              workspaceId = parsedWorkspaceId;
              await assertUserHasWorkspaceAccess(
                loadedContext.requestContext.userId,
                parsedWorkspaceId,
              );
              const parsedSessionId = parseMediaAssetUploadSessionIdParam(
                context.req.param("sessionId"),
              );
              sessionId = parsedSessionId;
              const input = parseCompleteMediaAssetUploadSessionInput(
                await parseJsonBody(context.req.raw),
              );
              const session =
                await loadMediaAssetUploadSessionForCompletionForWorkspace(
                  loadedContext.requestContext.userId,
                  parsedWorkspaceId,
                  parsedSessionId,
                );
              return {
                loadedContext,
                input,
                session,
                workspaceId: parsedWorkspaceId,
                sessionId: parsedSessionId,
              };
            },
          );
          const {
            loadedContext,
            input,
            session,
            workspaceId: preparedWorkspaceId,
            sessionId: preparedSessionId,
          } = prepared;
          mediaAssetId = session.mediaAssetId;
          const scope = createMediaAssetsScope(
            requestId,
            context.req.path,
            context.req.method,
            loadedContext.requestContext.userId,
            preparedWorkspaceId,
            context.get("clientAppVersion"),
            context.get("clientPlatform"),
          );
          const result =
            await completeMultipartUploadSessionAtApplicationBoundary(
              loadedContext.requestContext.userId,
              session,
              input.parts,
              randomUUID(),
              scope,
              operationDeadline,
              writerLeaseTargetAtMs,
              requestDeadline,
              multipartCompletionApplicationDependencies,
            );

          addBackendBreadcrumb({
            action: "media_asset_upload_session_complete",
            scope,
            details: {
              statusCode: 200,
              mediaAssetId: session.mediaAssetId,
              sessionId: preparedSessionId,
              mimeType: session.mimeType,
              sizeBytes: session.sizeBytes,
              applied: result.applied,
            },
          });
          return context.json(result);
        },
      );
    } catch (error) {
      const mappedError = mapMultipartCompletionDeadlineError(
        error,
        operationDeadline,
        requestDeadline,
      );
      const scope = createMediaAssetsScope(requestId, context.req.path, context.req.method, getRequestContextUserId(requestContext), workspaceId, context.get("clientAppVersion"), context.get("clientPlatform"));
      const details = {
        mediaAssetId,
        sessionId,
        ...createBackendFailureDetails(mappedError),
      };
      reportBackendExceptionOrBreadcrumb(
        mappedError,
        { action: "media_asset_upload_session_complete_error", error: normalizeCaughtError(mappedError), scope, details },
        { action: "media_asset_upload_session_complete_error", scope, details },
      );
      throw mappedError;
    } finally {
      operationDeadline.dispose();
      requestDeadline.dispose();
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
      const abortStart = await beginUploadSessionAbort(
        loadedContext.requestContext.userId,
        workspaceId,
        sessionId,
        runDatabaseOperationOnce,
      );
      const session = abortStart.uploadSession;
      mediaAssetId = session.mediaAssetId;
      const scope = createMediaAssetsScope(requestId, context.req.path, context.req.method, loadedContext.requestContext.userId, workspaceId, context.get("clientAppVersion"), context.get("clientPlatform"));
      const abortedSession =
        await abortMultipartUploadSessionAtApplicationBoundary(
          loadedContext.requestContext.userId,
          abortStart,
          scope,
          context.req.raw.signal,
          runDatabaseOperationOnce,
          abortMultipartMediaAssetUpload,
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
