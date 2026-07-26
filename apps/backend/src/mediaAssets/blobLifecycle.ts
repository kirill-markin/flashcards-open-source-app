import { transactionWithWorkspaceScope, type DatabaseExecutor } from "../database";
import { HttpError } from "../shared/errors";
import { buildMediaBlobStorageKey } from "./storageKeys";
import type { MediaBlobNormalizationVersion } from "./types";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const sha256Pattern = /^[0-9a-f]{64}$/u;
const mimeTypePattern = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/u;
const maximumOperationIdLength = 1_024;
export const mediaBlobCleanupDelayMs = 3_600_000;
export const mediaBlobWriterKinds = ["direct_ingestion", "multipart_completion", "generated_promotion"] as const;
export type MediaBlobWriterKind = typeof mediaBlobWriterKinds[number];
export type MediaBlobWriterIdentity = Readonly<{
  writerKind: MediaBlobWriterKind; workspaceId: string; mediaAssetId: string; operationId: string;
}>;
export type MediaBlobWriterReservationInput = MediaBlobWriterIdentity & Readonly<{
  sha256: string; storageKey: string; mimeType: string; sizeBytes: number;
  normalizationVersion: MediaBlobNormalizationVersion;
}>;
export type MediaBlobWriterReservation = Readonly<{
  reservationToken: string; state: "active" | "ambiguous" | "finalized";
}>;
export type MediaBlobWriterReconciliation = "referenced" | "unreferenced";
type ReservationRow = Readonly<{ reservation_token: string | null; reservation_state: string | null; reservation_status: string }>;
type BooleanRow = Readonly<{ transitioned: boolean }>;
type ReconciliationRow = Readonly<{ reconciliation_status: string }>;
type CleanupClaimRow = Readonly<{ lease_token: string | null }>;
export class MediaBlobLifecycleBusyError extends HttpError {
  constructor() { super( 503, "Media bytes are temporarily fenced by cleanup. Retry shortly.", "MEDIA_BLOB_LIFECYCLE_BUSY", ); this.name = "MediaBlobLifecycleBusyError";
  }
}
export class MediaBlobLifecycleConflictError extends HttpError {
  constructor() { super(409, "Media bytes conflict with immutable content-hash metadata.", "MEDIA_BLOB_METADATA_CONFLICT"); this.name = "MediaBlobLifecycleConflictError";
  }
}
export class MediaBlobWriterFenceError extends Error {
  constructor(action: string) { super(`Permanent media blob writer reservation rejected a stale exact token. action=${action}`); this.name = "MediaBlobWriterFenceError";
  }
}
export function assertMediaBlobWriterReservationToken(reservationToken: string): void {
  if (!uuidPattern.test(reservationToken)) { throw new TypeError("mediaBlobWriterReservationToken must be a lowercase UUID.");
  }
}
function assertReservationInput(input: MediaBlobWriterReservationInput): void {
  if (!mediaBlobWriterKinds.includes(input.writerKind)) { throw new TypeError("writerKind is unsupported.");
  }
  if (!uuidPattern.test(input.workspaceId) || !uuidPattern.test(input.mediaAssetId)) { throw new TypeError("workspaceId and mediaAssetId must be lowercase UUIDs.");
  }
  if ( input.operationId !== input.operationId.trim() || input.operationId.length < 1 || input.operationId.length > maximumOperationIdLength
  ) { throw new TypeError(`operationId must be 1 to ${maximumOperationIdLength} trimmed characters.`);
  }
  if (!sha256Pattern.test(input.sha256)) { throw new TypeError("sha256 must be a normalized lowercase SHA-256 digest.");
  }
  if (input.storageKey !== buildMediaBlobStorageKey(input.sha256)) { throw new TypeError("storageKey does not match sha256.");
  }
  if (!mimeTypePattern.test(input.mimeType)) { throw new TypeError("mimeType must be a normalized lowercase MIME type.");
  }
  if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes < 0) { throw new RangeError("sizeBytes must be a non-negative safe integer.");
  }
}
export async function reserveMediaBlobWriterInExecutor(
  executor: DatabaseExecutor, input: MediaBlobWriterReservationInput,
): Promise<MediaBlobWriterReservation> {
  assertReservationInput(input);
  const result = await executor.query<ReservationRow>( `SELECT reservation_token, reservation_state, reservation_status FROM content.reserve_media_blob_writer($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [ input.sha256, input.storageKey, input.mimeType, input.sizeBytes, input.normalizationVersion, input.writerKind, input.workspaceId, input.mediaAssetId, input.operationId, ],
  ).catch((error: unknown) => {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23514") throw new MediaBlobLifecycleConflictError();
    throw error;
  });
  const row = result.rows[0];
  if (row?.reservation_status === "cleanup_claimed") { throw new MediaBlobLifecycleBusyError();
  }
  if ( row?.reservation_status !== "reserved" || row.reservation_token === null || (row.reservation_state !== "active" && row.reservation_state !== "ambiguous" && row.reservation_state !== "finalized")
  ) { throw new TypeError("PostgreSQL returned an invalid media blob writer reservation.");
  }
  assertMediaBlobWriterReservationToken(row.reservation_token);
  return { reservationToken: row.reservation_token, state: row.reservation_state,
  };
}
export async function reserveMediaBlobWriterForWorkspace(
  userId: string, input: MediaBlobWriterReservationInput,
): Promise<MediaBlobWriterReservation> {
  return transactionWithWorkspaceScope( { userId, workspaceId: input.workspaceId }, async (executor) => reserveMediaBlobWriterInExecutor(executor, input),
  );
}
export async function finalizeMediaBlobWriterInExecutor(
  executor: DatabaseExecutor,
  input: Readonly<{ reservationToken: string; sha256: string; workspaceId: string; mediaAssetId: string;
  }>,
): Promise<void> {
  assertMediaBlobWriterReservationToken(input.reservationToken);
  const result = await executor.query<BooleanRow>( `SELECT content.finalize_media_blob_writer($1, $2, $3, $4) AS transitioned`, [input.reservationToken, input.sha256, input.workspaceId, input.mediaAssetId],
  );
  if (result.rows[0]?.transitioned !== true) { throw new MediaBlobWriterFenceError("finalize");
  }
}
export async function markMediaBlobWriterAmbiguousInExecutor(
  executor: DatabaseExecutor, reservationToken: string,
): Promise<boolean> {
  assertMediaBlobWriterReservationToken(reservationToken);
  const result = await executor.query<BooleanRow>( "SELECT content.mark_media_blob_writer_ambiguous($1) AS transitioned", [reservationToken],
  );
  return result.rows[0]?.transitioned === true;
}
export async function reconcileMediaBlobWriterInExecutor(
  executor: DatabaseExecutor,
  input: Readonly<{ reservationToken: string; sha256: string; workspaceId: string; mediaAssetId: string;
  }>,
): Promise<MediaBlobWriterReconciliation> {
  assertMediaBlobWriterReservationToken(input.reservationToken);
  const result = await executor.query<ReconciliationRow>( `SELECT content.reconcile_media_blob_writer($1, $2, $3, $4, $5) AS reconciliation_status`, [ input.reservationToken, input.sha256, input.workspaceId, input.mediaAssetId, mediaBlobCleanupDelayMs, ],
  );
  const status = result.rows[0]?.reconciliation_status;
  if (status === "referenced" || status === "unreferenced") { return status;
  }
  throw new MediaBlobWriterFenceError("reconcile");
}
export async function failMediaBlobWriterInExecutor(
  executor: DatabaseExecutor, reservationToken: string,
): Promise<void> {
  assertMediaBlobWriterReservationToken(reservationToken);
  const result = await executor.query<BooleanRow>( "SELECT content.fail_media_blob_writer($1, $2) AS transitioned", [reservationToken, mediaBlobCleanupDelayMs],
  );
  if (result.rows[0]?.transitioned !== true) { throw new MediaBlobWriterFenceError("fail");
  }
}
export async function markMediaBlobWriterAmbiguousForWorkspace(
  userId: string, workspaceId: string, reservationToken: string,
): Promise<boolean> {
  return transactionWithWorkspaceScope( { userId, workspaceId }, async (executor) => markMediaBlobWriterAmbiguousInExecutor(executor, reservationToken),
  );
}
export async function reconcileMediaBlobWriterForWorkspace(
  userId: string,
  input: Readonly<{ reservationToken: string; sha256: string; workspaceId: string; mediaAssetId: string;
  }>,
): Promise<MediaBlobWriterReconciliation> {
  return transactionWithWorkspaceScope( { userId, workspaceId: input.workspaceId }, async (executor) => reconcileMediaBlobWriterInExecutor(executor, input),
  );
}
export async function failMediaBlobWriterForWorkspace(
  userId: string, workspaceId: string, reservationToken: string,
): Promise<void> {
  return transactionWithWorkspaceScope( { userId, workspaceId }, async (executor) => failMediaBlobWriterInExecutor(executor, reservationToken),
  );
}
export async function claimMediaBlobCleanupInExecutor(
  executor: DatabaseExecutor, sha256: string, leaseDurationMs: number,
): Promise<string | null> {
  if (!sha256Pattern.test(sha256)) throw new TypeError("sha256 must be normalized.");
  if (!Number.isSafeInteger(leaseDurationMs) || leaseDurationMs < 1 || leaseDurationMs > 3_600_000) { throw new RangeError("leaseDurationMs must be between 1 and 3600000.");
  }
  const result = await executor.query<CleanupClaimRow>( "SELECT content.claim_media_blob_cleanup($1, $2) AS lease_token", [sha256, leaseDurationMs],
  );
  const token = result.rows[0]?.lease_token ?? null;
  if (token !== null) assertMediaBlobWriterReservationToken(token);
  return token;
}
