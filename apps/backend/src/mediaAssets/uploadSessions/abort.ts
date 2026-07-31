import { transactionWithWorkspaceScope } from "../../database";
import { HttpError } from "../../shared/errors";
import type {
  MediaAssetUploadSession,
  MediaAssetUploadSessionRow,
} from "../types";
import { isValidMediaAssetLastOperationId } from "../lastOperationId";
import {
  assertMediaAssetUploadSessionCanAbort,
  assertMediaAssetUploadSessionState,
  createMediaAssetUploadSessionNotFoundError,
  findMediaAssetUploadSessionRowForUpdateInExecutor,
  mapMediaAssetUploadSessionRow,
  MEDIA_UPLOAD_SESSION_COLUMNS,
  type MediaAssetUploadSessionAbortStartRow,
  type MediaAssetUploadSessionAbortStartWithWriterResult,
} from "./shared";

export async function beginMediaAssetUploadSessionAbortForWorkspace(
  userId: string,
  workspaceId: string,
  sessionId: string,
): Promise<MediaAssetUploadSessionAbortStartWithWriterResult> {
  return transactionWithWorkspaceScope({ userId, workspaceId }, async (executor) => {
    const initialResult = await executor.query<MediaAssetUploadSessionRow>(
      `SELECT ${MEDIA_UPLOAD_SESSION_COLUMNS}
       FROM content.media_upload_sessions
       WHERE workspace_id = $1
         AND media_upload_session_id = $2`,
      [workspaceId, sessionId],
    );
    const initialRow = initialResult.rows[0];
    if (initialRow === undefined) {
      throw createMediaAssetUploadSessionNotFoundError(sessionId);
    }
    const initialSession = mapMediaAssetUploadSessionRow(initialRow);
    const beginAbort = async (): Promise<string> => {
      const result =
        await executor.query<MediaAssetUploadSessionAbortStartRow>(
          `SELECT content.begin_media_upload_session_abort_with_owner(
             $1, $2, $3, $4
           ) AS abort_status`,
          [userId, workspaceId, sessionId, initialSession.mediaAssetId],
        );
      if (result.rows.length !== 1) {
        throw new TypeError(
          "PostgreSQL returned an invalid multipart abort admission row count.",
        );
      }
      const abortStatus = result.rows[0]?.abort_status;
      if (typeof abortStatus !== "string") {
        throw new TypeError(
          "PostgreSQL returned an invalid multipart abort admission status.",
        );
      }
      return abortStatus;
    };
    let status = await beginAbort();
    if (status === "access_denied") {
      throw new HttpError(
        403,
        "Workspace access is required.",
        "WORKSPACE_ACCESS_DENIED",
      );
    }
    if (status === "not_found") {
      throw createMediaAssetUploadSessionNotFoundError(sessionId);
    }

    let finalRow = await findMediaAssetUploadSessionRowForUpdateInExecutor(
      executor,
      workspaceId,
      sessionId,
    );
    if (finalRow === null) {
      throw createMediaAssetUploadSessionNotFoundError(sessionId);
    }
    let session = mapMediaAssetUploadSessionRow(finalRow);
    if (
      status === "stale"
      && initialSession.state === "completing"
      && isValidMediaAssetLastOperationId(initialSession.lastOperationId)
        === false
      && session.state === "completing"
      && session.lastOperationId === initialSession.lastOperationId
    ) {
      const recovery =
        await executor.query<MediaAssetUploadSessionRow>(
          [
            "UPDATE content.media_upload_sessions",
            "SET state = 'active'",
            "WHERE workspace_id = $1",
            "AND media_upload_session_id = $2",
            "AND state = 'completing'",
            "AND last_operation_id = $3",
            "RETURNING",
            MEDIA_UPLOAD_SESSION_COLUMNS,
          ].join(" "),
          [workspaceId, sessionId, initialSession.lastOperationId],
        );
      if (recovery.rows.length !== 1) {
        throw new Error(
          `Quiescent legacy media upload session recovery did not return one active row. sessionId=${sessionId}`,
        );
      }
      status = await beginAbort();
      if (status !== "abort_required") {
        throw new Error(
          `Quiescent legacy media upload session recovery was not admitted for abort. sessionId=${sessionId} status=${status}`,
        );
      }
      finalRow = await findMediaAssetUploadSessionRowForUpdateInExecutor(
        executor,
        workspaceId,
        sessionId,
      );
      if (finalRow === null) {
        throw createMediaAssetUploadSessionNotFoundError(sessionId);
      }
      session = mapMediaAssetUploadSessionRow(finalRow);
    }
    if (status === "already_aborted") {
      return {
        status,
        uploadSession: session,
        completionAttemptMayExist: true,
      };
    }
    if (status === "completion_in_progress") {
      return { status, uploadSession: session };
    }
    if (status === "completion_pending") {
      return { status, uploadSession: session };
    }
    if (status === "abort_required") {
      return {
        status,
        uploadSession: session,
        completionAttemptMayExist: initialSession.state === "completing",
      };
    }
    if (status === "stale") {
      assertMediaAssetUploadSessionCanAbort(session);
      throw new HttpError(
        409,
        `Multipart abort admission became stale. sessionId=${sessionId}`,
        "MEDIA_ASSET_UPLOAD_SESSION_STATE_CONFLICT",
      );
    }
    throw new TypeError(
      `PostgreSQL returned an invalid multipart abort admission status. status=${String(status)}`,
    );
  });
}

export async function markMediaAssetUploadSessionAbortedForWorkspace(
  userId: string,
  workspaceId: string,
  sessionId: string,
): Promise<MediaAssetUploadSession> {
  return transactionWithWorkspaceScope({ userId, workspaceId }, async (executor) => {
    const row = await findMediaAssetUploadSessionRowForUpdateInExecutor(executor, workspaceId, sessionId);
    if (row === null) {
      throw createMediaAssetUploadSessionNotFoundError(sessionId);
    }

    const session = mapMediaAssetUploadSessionRow(row);
    if (session.state === "aborted") {
      return session;
    }

    assertMediaAssetUploadSessionState(session, "aborting");
    const result = await executor.query<MediaAssetUploadSessionRow>(
      [
        "UPDATE content.media_upload_sessions",
        "SET state = 'aborted', aborted_at = now()",
        "WHERE workspace_id = $1",
        "AND media_upload_session_id = $2",
        "AND state = 'aborting'",
        "RETURNING",
        MEDIA_UPLOAD_SESSION_COLUMNS,
      ].join(" "),
      [workspaceId, sessionId],
    );

    const updatedRow = result.rows[0];
    if (updatedRow === undefined) {
      throw new Error(`Media asset upload session aborted update did not return a row. sessionId=${sessionId}`);
    }

    return mapMediaAssetUploadSessionRow(updatedRow);
  });
}
