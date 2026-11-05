import { randomUUID } from "node:crypto";
import type { Context } from "hono";
import { z } from "zod";
import { loadMediaAssetWithBlobForWorkspace } from "../../mediaAssets";
import { ingestImageMediaAsset } from "../../mediaAssets/ingestion";
import { createPresignedMediaAssetDownload } from "../../mediaAssets/storage";
import type { MediaBlob } from "../../mediaAssets/types";
import { readMediaAssetImageIngestionBytes } from "../../mediaAssets/validators";
import { writeCloudWatchRecord } from "../../observability/cloudWatch";
import { createBackendObservationScope, type BackendObservationScope } from "../../observability/sentry";
import type { ChatSandboxMediaDetails } from "../../observability/sentry/events/chat";
import type { AppEnv } from "../../server/app";
import { HttpError } from "../../shared/errors";
import { ensureAIChatSyncReplica } from "../../sync/identity/aiChatIdentity";
import { maximumMediaGetBytes } from "../contract";
import {
  chatSandboxMediaRoutePath,
  verifyChatSandboxSqlAuthorization,
  type ChatSandboxSqlCapability,
} from "../sqlBridge/capability";
import { readActiveChatRunClientDevice } from "../sqlBridge/route";

const mediaAssetIdSchema = z.string().uuid();

function createScope(
  context: Context<AppEnv>,
  capability: ChatSandboxSqlCapability,
  method: "GET" | "POST",
): BackendObservationScope {
  return createBackendObservationScope(
    "backend-api",
    context.get("requestId"),
    chatSandboxMediaRoutePath,
    method,
    capability.userId,
    capability.workspaceId,
    null,
    capability.runId,
    capability.sessionId,
    null,
    null,
  );
}

/** Metadata only, never the image. */
function writeMediaRecord(scope: BackendObservationScope, details: ChatSandboxMediaDetails): void {
  writeCloudWatchRecord({ action: "chat_sandbox_media", scope, details }, "breadcrumb");
}

function parseMediaAssetId(rawMediaAssetId: string): string {
  if (!mediaAssetIdSchema.safeParse(rawMediaAssetId).success) {
    throw new HttpError(
      400,
      `${JSON.stringify(rawMediaAssetId)} is not a media asset id: pass the UUID of an fcasset: image destination.`,
      "CHAT_SANDBOX_MEDIA_ID_INVALID",
    );
  }

  return rawMediaAssetId.toLowerCase();
}

async function loadImageBlob(capability: ChatSandboxSqlCapability, mediaAssetId: string): Promise<MediaBlob> {
  let mediaBlob: MediaBlob;
  try {
    ({ mediaBlob } = await loadMediaAssetWithBlobForWorkspace(capability.userId, capability.workspaceId, mediaAssetId));
  } catch (error) {
    if (error instanceof HttpError && error.code === "MEDIA_ASSET_NOT_FOUND") {
      throw new HttpError(
        404,
        `Image ${mediaAssetId} does not exist in the workspace the user has open, or was deleted: read the card again with SQL and pass an id from its fcasset: image destinations.`,
        "CHAT_SANDBOX_MEDIA_NOT_FOUND",
      );
    }
    throw error;
  }

  if (!mediaBlob.mimeType.startsWith("image/")) {
    throw new HttpError(
      415,
      `Media asset ${mediaAssetId} is ${mediaBlob.mimeType}, not an image; fc-media-get copies only images.`,
      "CHAT_SANDBOX_MEDIA_NOT_IMAGE",
    );
  }

  if (mediaBlob.sizeBytes > maximumMediaGetBytes) {
    throw new HttpError(
      413,
      `Image ${mediaAssetId} is ${mediaBlob.sizeBytes} bytes; fc-media-get copies images of at most ${maximumMediaGetBytes} bytes.`,
      "CHAT_SANDBOX_MEDIA_TOO_LARGE",
    );
  }

  return mediaBlob;
}

/**
 * `fc-media-get`: a short-lived download URL for one managed image of the open workspace, which the
 * sandbox fetches into /work itself, so the image never passes through this Lambda's response.
 */
export async function handleChatSandboxMediaGetRequest(context: Context<AppEnv>): Promise<Response> {
  const capability = await verifyChatSandboxSqlAuthorization(context.req.header("authorization"));
  const mediaAssetId = parseMediaAssetId(context.req.param("mediaAssetId") ?? "");
  await readActiveChatRunClientDevice(capability);
  const scope = createScope(context, capability, "GET");
  const mediaBlob = await loadImageBlob(capability, mediaAssetId);
  const download = await createPresignedMediaAssetDownload({
    workspaceId: capability.workspaceId,
    mediaAssetId,
    storageKey: mediaBlob.storageKey,
    observationScope: scope,
  });
  writeMediaRecord(scope, { kind: "get", mediaAssetId, mimeType: mediaBlob.mimeType, sizeBytes: mediaBlob.sizeBytes });
  return context.json({ mediaAssetId, sizeBytes: mediaBlob.sizeBytes, downloadUrl: download.url });
}

/**
 * `fc-media-put`: the request body is one image, at most `maximumImageIngestionOriginalBytes` so that it
 * fits API Gateway's Lambda payload limit, which becomes a new managed image of the open workspace,
 * normalized like every card image. It is on no card until the command's code puts its id on one with an
 * SQL write, which syncs like any other.
 */
export async function handleChatSandboxMediaPutRequest(context: Context<AppEnv>): Promise<Response> {
  const capability = await verifyChatSandboxSqlAuthorization(context.req.header("authorization"));
  await readActiveChatRunClientDevice(capability);
  const imageBytes = await readMediaAssetImageIngestionBytes(context.req.raw);
  const scope = createScope(context, capability, "POST");
  const replicaId = await ensureAIChatSyncReplica(capability.workspaceId, capability.userId, "web", null);
  const mediaAssetId = randomUUID();
  const createdAt = new Date().toISOString();
  const { mediaAsset } = await ingestImageMediaAsset({
    userId: capability.userId,
    workspaceId: capability.workspaceId,
    metadata: {
      mediaAssetId,
      sourceUrl: null,
      createdAt,
      clientUpdatedAt: createdAt,
      lastModifiedByReplicaId: replicaId,
      lastOperationId: `chat-sandbox-media:${mediaAssetId}`,
    },
    imageBytes,
    observationScope: scope,
  });
  writeMediaRecord(scope, { kind: "put", mediaAssetId, mimeType: mediaAsset.mimeType, sizeBytes: mediaAsset.sizeBytes });
  return context.json({ mediaAssetId });
}
