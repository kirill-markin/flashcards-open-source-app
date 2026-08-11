import type { PublicHttpErrorDetails } from "../shared/errors";
import { getPublicAgentDocs, type PublicAgentDocs } from "../shared/publicUrls";

export type AgentDocs = PublicAgentDocs;

export type AgentEnvelope<Data> = Readonly<{
  ok: true;
  data: Data;
  instructions: string;
  docs: AgentDocs;
}>;

export type AgentErrorEnvelope = Readonly<{
  ok: false;
  data: Record<string, never>;
  instructions: string;
  docs: AgentDocs;
  error: Readonly<{
    code: string;
    message: string;
    details?: PublicHttpErrorDetails;
  }>;
  requestId?: string;
}>;

export function createAgentEnvelope<Data>(
  requestUrl: string,
  data: Data,
  instructions: string,
): AgentEnvelope<Data> {
  return {
    ok: true,
    data,
    instructions,
    docs: getPublicAgentDocs(requestUrl),
  };
}

export function createAgentErrorEnvelope(
  requestUrl: string,
  code: string,
  message: string,
  instructions: string,
  requestId?: string,
  details?: PublicHttpErrorDetails,
): AgentErrorEnvelope {
  return {
    ok: false,
    data: {},
    instructions,
    docs: getPublicAgentDocs(requestUrl),
    error: {
      code,
      message,
      ...(details !== undefined ? { details } : {}),
    },
    requestId,
  };
}

export function isAgentApiKeyAuthorizationHeader(
  authorizationHeader: string | null | undefined,
): boolean {
  return authorizationHeader !== null
    && authorizationHeader !== undefined
    && authorizationHeader.startsWith("ApiKey ");
}

type MultipartAgentRequestAction =
  | "completion"
  | "abort"
  | "other";

function getMultipartAgentRequestAction(
  requestUrl: string,
): MultipartAgentRequestAction {
  const pathname = new URL(
    requestUrl,
    "https://api.flashcards-open-source-app.com",
  ).pathname;
  if (
    /\/media-assets\/upload-sessions\/[^/]+\/complete\/?$/.test(pathname)
  ) {
    return "completion";
  }
  if (
    /\/media-assets\/upload-sessions\/[^/]+\/abort\/?$/.test(pathname)
  ) {
    return "abort";
  }
  return "other";
}

export function createAgentErrorInstructions(
  code: string | null,
  statusCode: number,
  requestUrl: string,
): string {
  const multipartAction = getMultipartAgentRequestAction(requestUrl);
  switch (code) {
    case "SERVICE_UNAVAILABLE":
      if (multipartAction === "completion") {
        return "Reload the upload session and media asset because the database outcome may be unknown. Do not assume rollback. After the Retry-After delay, retry the same completion with unchanged session and parts only if canonical state does not already show completion or durable processing.";
      }
      if (multipartAction === "abort") {
        return "Reload the upload session and media asset because abort admission or closure may have committed. Do not assume rollback. After the Retry-After delay, retry the same abort only if canonical state is not already terminal.";
      }
      return "Retry the same request after the Retry-After delay. If it fails again, treat it as a server-side error and stop changing the request. Use requestId when debugging.";
    case "AUTH_VERIFICATION_TEMPORARILY_UNAVAILABLE":
      return "Retry the same authenticated request after the Retry-After delay without changing the token. If it keeps failing, sign in again and use requestId when debugging.";
    case "MEDIA_BLOB_LIFECYCLE_BUSY":
      if (multipartAction === "completion") {
        return "Blob cleanup temporarily fenced database application after storage work may have occurred. Do not assume rollback. Wait for Retry-After, then retry the same completion with the unchanged session and parts.";
      }
      if (multipartAction === "abort") {
        return "S3 abort completed, but database closure is temporarily fenced and the session may remain aborting. Wait for Retry-After, reload the session, and retry the same abort if it is not already terminal.";
      }
      return "Retry the unchanged request after the Retry-After delay. If it fails again, stop and use requestId when debugging.";
    case "MEDIA_ASSET_STORAGE_UNAVAILABLE":
      if (multipartAction === "completion") {
        return "Multipart completion or promotion failed with an unknown storage mutation outcome. Do not assume rollback, abort, or replace the upload. Retry the same completion with the unchanged session and parts after any Retry-After delay.";
      }
      if (multipartAction === "abort") {
        return "Abort was admitted before storage failed, so the session may be aborting and the S3 outcome may be unknown. Do not assume rollback. Reload the session, then retry the same abort after any Retry-After delay if it is not already terminal.";
      }
      return "The storage mutation outcome may be unknown. Do not assume rollback. Retry the unchanged request after any Retry-After delay and use requestId if it fails again.";
    case "MEDIA_ASSET_WRITER_BUSY":
    case "MEDIA_ASSET_INGESTION_DEADLINE_EXCEEDED":
      return "Retry the unchanged request after the Retry-After delay. If it fails again, stop and use requestId when debugging.";
    case "MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_DEADLINE_EXCEEDED":
      return "Wait for the Retry-After delay, then retry the same completion with the unchanged session and parts. Do not abort the session or create a replacement upload.";
    case "MEDIA_ASSET_UPLOAD_SESSION_RESTART_REQUIRED":
      return "This legacy upload session cannot complete durably. Abort it if it is still open, then create a fresh multipart upload session, upload the bytes again, and complete the new session.";
    case "MEDIA_ASSET_UPLOAD_SESSION_EXPIRED":
      return "This expired upload session has already been closed. Create a fresh multipart upload session, upload the bytes again, and complete the new session; do not retry this completion request.";
    case "MEDIA_ASSET_UPLOAD_SESSION_COMPLETED":
      return "Completion already won for this upload session. Reload and use the completed media asset, or replay the original completion only to retrieve its idempotent result. Do not retry abort or create a replacement upload.";
    case "MEDIA_ASSET_UPLOAD_SESSION_STATE_CONFLICT":
      return "Reload the upload session and media asset to determine their canonical state before choosing the next action. Do not blindly replay completion or abort, and do not assume earlier storage work was rolled back.";
    case "MEDIA_ASSET_UPLOAD_MISMATCH":
    case "MEDIA_ASSET_UPLOAD_PROOF_MISMATCH":
      return "Reload the upload session and media asset before taking another action. Do not blindly replay the mismatched completion or assume rollback; if no completed asset exists, close the stale session as allowed and create a fresh upload with the correct bytes and metadata.";
    case "MEDIA_ASSET_UPLOAD_NOT_FOUND":
      return "Reload the upload session and media asset before taking another action. Do not blindly replay or assume rollback; if no completion is pending or applied, create a fresh upload session and upload the bytes again.";
    case "MEDIA_ASSET_UPLOAD_SESSION_ACCESS_DENIED":
      return "Reload account, workspace access, upload-session, and media-asset state. Do not retry completion until access is restored, and do not assume earlier storage work was rolled back.";
    case "WORKSPACE_ACCESS_DENIED":
      if (multipartAction === "completion") {
        return "Reload account and workspace access, the upload session, and the media asset. Completion may have performed storage work before access changed, so do not assume rollback. Retry completion only after access is restored and canonical state is known.";
      }
      if (multipartAction === "abort") {
        return "Reload account and workspace access, the upload session, and the media asset. Access loss may have occurred before abort admission or after admitted S3 work, so do not assume rollback. Retry abort only after access is restored and canonical state is known.";
      }
      return "Reload account and workspace access before retrying. Do not assume an in-flight mutation was rolled back.";
    case "MEDIA_ASSET_REPLICA_INVALID":
      return "Reload the workspace replicas, upload session, and media asset before retrying with a currently accessible lastModifiedByReplicaId. Do not assume earlier storage work was rolled back.";
    case "MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_IN_PROGRESS":
      if (multipartAction === "completion") {
        return statusCode === 409
          ? "Expiry cleanup was denied because completion is being durably reconciled; abort admission made no database or S3 mutation. Wait for Retry-After, then retry the unchanged completion with the same session and parts."
          : "Completion has a live writer or was accepted for durable processing. Wait for Retry-After, then retry the unchanged completion with the same session and parts; do not abort or replace the upload.";
      }
      if (multipartAction === "abort") {
        return "Abort admission was denied and this abort made no database or S3 mutation. Wait for Retry-After, then retry completion or session creation to observe the durable outcome; do not start a replacement byte upload or retry abort while completion remains active.";
      }
      return "Wait for the Retry-After delay, then retry the unchanged completion or session creation request. Do not abort the session or start a replacement byte upload.";
    case "MEDIA_ASSET_UPLOAD_SESSION_CREATION_IN_PROGRESS":
      return "Wait for the Retry-After delay, then retry the unchanged session creation request. Do not start a parallel byte upload.";
    case "MEDIA_ASSET_UPLOAD_SESSION_NOT_FOUND":
      if (multipartAction === "completion") {
        return "Reload canonical upload-session and media-asset state and verify the sessionId. Correct a wrong identifier; if the stale session no longer exists, create a fresh session only after confirming no completion is pending or applied. Do not blindly retry this completion.";
      }
      if (multipartAction === "abort") {
        return "Reload canonical upload-session and media-asset state and verify the sessionId. Correct a wrong identifier, or stop retrying abort if the stale session no longer exists.";
      }
      return "Reload canonical upload-session and media-asset state and verify the sessionId before retrying or creating replacement state.";
    case "AUTH_UNAUTHORIZED":
    case "AGENT_API_KEY_INVALID":
      return "Use a valid non-revoked API key in the Authorization header as: ApiKey $FLASHCARDS_OPEN_SOURCE_API_KEY after exporting it once. If needed, restart from GET /v1/agent.";
    case "QUERY_INVALID_SQL":
    case "QUERY_UNSUPPORTED_SYNTAX":
      return "Fix the sql string using error.message and any error.details.validationIssues, then retry the same endpoint: POST /v1/agent/sql/query for reads or POST /v1/agent/sql/execute for writes. Use docs.discoveryUrl for runtime routes and docs.source.agentRoutesUrl for implementation details.";
    case "WORKSPACE_SELECTION_REQUIRED":
      return "Call GET /v1/agent/me, then GET /v1/agent/workspaces?limit=100. A first workspace is auto-provisioned for new users. If data.nextCursor is not null, continue with the same limit and cursor=data.nextCursor. If multiple workspaces exist, select one with POST /v1/agent/workspaces/{workspaceId}/select before calling POST /v1/agent/sql/query or POST /v1/agent/sql/execute.";
    case "WORKSPACE_ID_REQUIRED":
    case "WORKSPACE_ID_INVALID":
      return "Provide a valid workspaceId UUID in the request URL, then retry the action.";
    case "DATABASE_COMMIT_OUTCOME_UNKNOWN":
      if (multipartAction === "completion") {
        return "The completion database commit outcome is unknown and rollback is not guaranteed. Reload or replay the exact completion with the same session and parts to observe canonical state before taking any other action; do not abort or replace the upload.";
      }
      if (multipartAction === "abort") {
        return "The abort database commit outcome is unknown and rollback is not guaranteed. Reload the upload session and media asset before retrying the same abort, and stop if canonical state is already terminal.";
      }
      return "Do not blindly replay the same request. Reload and check the current state first, then retry only if the requested change is confirmed absent. Use requestId when debugging.";
  }

  if (statusCode >= 500) {
    return "Retry the same request once. If it fails again, treat it as a server-side error and stop changing the request. Use requestId when debugging.";
  }

  if (statusCode === 404) {
    return "Verify that the referenced resource id exists in the selected workspace, then retry only after correcting the id.";
  }

  if (statusCode >= 400) {
    return "Fix the request using error.message and any error.details.validationIssues, then retry the same request.";
  }

  return "If the issue persists, reload account context from GET /v1/agent/me or restart from GET /v1/agent.";
}

export function createAgentApiKeyErrorEnvelope(
  requestUrl: string,
  code: string,
  message: string,
  statusCode: number,
  requestId: string | undefined,
  details: PublicHttpErrorDetails | undefined,
): AgentErrorEnvelope {
  return createAgentErrorEnvelope(
    requestUrl,
    code,
    message,
    createAgentErrorInstructions(code, statusCode, requestUrl),
    requestId,
    details,
  );
}
