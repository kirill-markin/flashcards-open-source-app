import {
  applyWorkspaceDatabaseScopeInExecutor,
  transactionWithWorkspaceScope,
  transactionWithWorkspaceScopeDeadline,
  type DatabaseExecutor,
} from "../database";
import { unsafeTransaction, unsafeTransactionWithDeadline } from "../database/unsafe";
import { HttpError } from "../shared/errors";
import { buildMediaBlobStorageKey } from "./storageKeys";
import {
  mediaBlobNormalizationVersions,
  passthroughMediaBlobNormalizationVersion,
  type MediaBlobNormalizationVersion,
  type TimestampValue,
} from "./types";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const sha256Pattern = /^[0-9a-f]{64}$/u;
const mimeTypePattern = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/u;
const maximumOperationIdLength = 1_024;
const maximumMediaBlobWriterAttemptLeaseDurationMs = 3_600_000;
const maximumMediaBlobWriterOperationDeadlineMs = 3_600_000;
const maximumMediaBlobCleanupDelayMs = 604_800_000;
const directMediaBlobWriterLeaseDatabaseSkewMarginMs = 100;
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
  normalizationVersion: MediaBlobNormalizationVersion;
}>;
export type MediaBlobWriterExactInput = MediaBlobWriterReservationInput & Readonly<{
  reservationToken: string;
}>;
export type MediaBlobWriterReconciliation = "referenced" | "unreferenced";
export type DirectMediaBlobWriterResolution =
  | MediaBlobWriterReconciliation
  | "absent"
  | "access_active"
  | "stale";
export type DirectMediaBlobWriterResolutionInput = Readonly<{
  userId: string; workspaceId: string; mediaAssetId: string; operationId: string;
  lastModifiedByReplicaId: string; sha256: string; storageKey: string;
  mimeType: string; sizeBytes: number;
}>;
export type DirectMediaBlobWriterReservationInput =
  DirectMediaBlobWriterResolutionInput & Readonly<{ normalizationVersion: MediaBlobNormalizationVersion }>;
export type DirectMediaBlobWriterAttemptInput = DirectMediaBlobWriterReservationInput & Readonly<{
  attemptToken: string; sourceUrl: string | null; assetCreatedAt: string; clientUpdatedAt: string;
}>;
export type DirectMediaBlobWriterAttemptExactInput =
  DirectMediaBlobWriterAttemptInput & Readonly<{ reservationToken: string }>;
export type DirectMediaBlobWriterAttemptLease = Readonly<{
  leaseTargetAt: string; operationDeadlineAt: string;
}>;
declare const directMediaBlobStorageCapabilityType: unique symbol;
declare const directMediaBlobWriterApplyExecutorType: unique symbol;
type DirectMediaBlobStorageCapabilityPayload = Readonly<{
  writerKind: "direct_ingestion"; attemptToken: string; reservationToken: string;
  leaseExpiresAt: string; operationDeadlineAt: string; userId: string;
  workspaceId: string; mediaAssetId: string; operationId: string;
  lastModifiedByReplicaId: string; sha256: string; storageKey: string;
  mimeType: string; sizeBytes: number; normalizationVersion: MediaBlobNormalizationVersion;
  sourceUrl: string | null; assetCreatedAt: string; clientUpdatedAt: string;
}>;
type DirectMediaBlobWriterApplyExecutorClaim = Readonly<{
  input: DirectMediaBlobWriterAttemptExactInput;
  operationDeadlineAt: string;
  operationDeadlineAtMs: number;
}>;
export type DirectMediaBlobStorageCapability = Readonly<{
  readonly [directMediaBlobStorageCapabilityType]: true;
}>;
export type DirectMediaBlobWriterApplyExecutor = DatabaseExecutor & Readonly<{
  readonly [directMediaBlobWriterApplyExecutorType]: true;
}>;
const directAttemptTerminalStatuses = ["already_applied", "live_applied", "peer_conflict",
  "referenced", "unreferenced", "aborted", "stale_attempt"] as const;
const directAttemptRejectionStatuses = ["access_denied", "replica_mismatch",
  "ownership_mismatch", "writer_conflict", "cleanup_claimed", "stale"] as const;
const directAttemptBeginStatuses = [...directAttemptTerminalStatuses,
  ...directAttemptRejectionStatuses, "busy"] as const;
const directAttemptFenceStatuses = [...directAttemptTerminalStatuses,
  ...directAttemptRejectionStatuses, "ready"] as const;
const directAttemptFinishStatuses = [...directAttemptTerminalStatuses,
  ...directAttemptRejectionStatuses] as const;
const directAttemptFailureStatuses = [...directAttemptFinishStatuses] as const;
const directAttemptRevocationStatuses =
  [...directAttemptFinishStatuses, "access_active", "busy"] as const;
export type DirectMediaBlobWriterAttemptFenceStatus = typeof directAttemptFenceStatuses[number];
export type DirectMediaBlobWriterAttemptFinishStatus = typeof directAttemptFinishStatuses[number];
export type DirectMediaBlobWriterAttemptFailureStatus = typeof directAttemptFailureStatuses[number];
export type DirectMediaBlobWriterAttemptRevocationStatus = typeof directAttemptRevocationStatuses[number];
export type DirectMediaBlobWriterAttemptResult =
  | Readonly<{
    status: "acquired" | "replayed" | "expired_takeover";
    reservationToken: string; normalizationVersion: MediaBlobNormalizationVersion;
    leaseExpiresAt: string; storageCapability: DirectMediaBlobStorageCapability;
  }>
  | Readonly<{ status: "busy"; leaseExpiresAt: string }>
  | Readonly<{ status: Exclude<typeof directAttemptBeginStatuses[number], "busy"> }>;
type ReservationRow = Readonly<{
  reservation_token: string | null; reservation_state: string | null;
  reservation_status: string; normalization_version: string;
}>;
type BooleanRow = Readonly<{ transitioned: boolean }>;
type ReconciliationRow = Readonly<{ reconciliation_status: string }>;
type DirectResolutionRow = Readonly<{ resolution_status: string }>;
type AttemptBeginRow = Readonly<{
  attempt_status: string; reservation_token: string | null;
  normalization_version: string | null; lease_expires_at: TimestampValue | null;
}>;
type AttemptStatusRow = Readonly<{ attempt_status: string }>;
type CleanupClaimRow = Readonly<{ lease_token: string | null }>;
const directMediaBlobStorageCapabilityClaims =
  new WeakMap<DirectMediaBlobStorageCapability, DirectMediaBlobStorageCapabilityPayload>();
const directMediaBlobWriterApplyExecutorClaims =
  new WeakMap<DirectMediaBlobWriterApplyExecutor, DirectMediaBlobWriterApplyExecutorClaim>();
export class MediaBlobLifecycleBusyError extends HttpError {
  constructor() { super( 503, "Media bytes are temporarily fenced by cleanup. Retry shortly.", "MEDIA_BLOB_LIFECYCLE_BUSY", { retryAfterSeconds: 1 }, ); this.name = "MediaBlobLifecycleBusyError";
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
export function assertMediaBlobWriterAttemptToken(attemptToken: string): void {
  if (!uuidPattern.test(attemptToken)) {
    throw new TypeError("mediaBlobWriterAttemptToken must be a lowercase UUID.");
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
  if (!mediaBlobNormalizationVersions.some((version) => version === input.normalizationVersion)) {
    throw new TypeError("normalizationVersion is unsupported.");
  }
}
function requireNormalizationVersion(value: string): MediaBlobNormalizationVersion {
  const version = mediaBlobNormalizationVersions.find((candidate) => candidate === value);
  if (version === undefined) {
    throw new TypeError("PostgreSQL returned an invalid media blob normalization version.");
  }
  return version;
}
function assertHistoricalWriterOwner(userId: string, replicaId: string): void {
  if (userId !== userId.trim() || userId.length === 0) throw new TypeError("userId must be non-empty and trimmed.");
  if (!uuidPattern.test(replicaId)) throw new TypeError("lastModifiedByReplicaId must be a lowercase UUID.");
}
function requireIsoTimestamp(value: TimestampValue, fieldName: string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError(`${fieldName} must be a valid timestamp.`);
  return date.toISOString();
}
function assertPositiveBoundedDuration(value: number, fieldName: string, maximumMs: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximumMs) {
    throw new RangeError(`${fieldName} must be an integer between 1 and ${maximumMs}.`);
  }
}
type DirectMediaBlobWriterOperationDeadline = Readonly<{
  operationDeadlineAt: string;
  operationDeadlineAtMs: number;
}>;
type DirectMediaBlobWriterAttemptLeaseSnapshot =
  DirectMediaBlobWriterOperationDeadline & Readonly<{
    leaseTargetAt: string;
    leaseTargetAtMs: number;
  }>;
export class MediaBlobWriterLeaseDeadlineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MediaBlobWriterLeaseDeadlineError";
  }
}
export class MediaBlobWriterOperationDeadlineExpiredError extends Error {
  constructor() {
    super("Direct media blob writer operation deadline has expired.");
    this.name = "MediaBlobWriterOperationDeadlineExpiredError";
  }
}
function snapshotDirectAttemptOperationDeadline(
  rawOperationDeadlineAt: string,
): DirectMediaBlobWriterOperationDeadline {
  if (typeof rawOperationDeadlineAt !== "string") {
    throw new TypeError("operationDeadlineAt must be an ISO timestamp string.");
  }
  const operationDeadlineAt = requireIsoTimestamp(rawOperationDeadlineAt, "operationDeadlineAt");
  const operationDeadlineAtMs = Date.parse(operationDeadlineAt);
  const remainingMs = operationDeadlineAtMs - Date.now();
  if (remainingMs <= 0) {
    throw new MediaBlobWriterOperationDeadlineExpiredError();
  }
  if (remainingMs > maximumMediaBlobWriterOperationDeadlineMs) {
    throw new RangeError(
      `operationDeadlineAt must be within the next ${maximumMediaBlobWriterOperationDeadlineMs} milliseconds.`,
    );
  }
  return Object.freeze({ operationDeadlineAt, operationDeadlineAtMs });
}
function snapshotDirectAttemptLease(
  lease: DirectMediaBlobWriterAttemptLease,
): DirectMediaBlobWriterAttemptLeaseSnapshot {
  if (typeof lease !== "object" || lease === null) {
    throw new TypeError("Direct writer attempt lease must be an object.");
  }
  const deadline = snapshotDirectAttemptOperationDeadline(lease.operationDeadlineAt);
  if (typeof lease.leaseTargetAt !== "string") {
    throw new TypeError("leaseTargetAt must be an ISO timestamp string.");
  }
  const leaseTargetAt = requireIsoTimestamp(lease.leaseTargetAt, "leaseTargetAt");
  const leaseTargetAtMs = Date.parse(leaseTargetAt);
  const remainingLeaseMs = leaseTargetAtMs - Date.now();
  if (
    remainingLeaseMs <= 0
    || remainingLeaseMs > maximumMediaBlobWriterAttemptLeaseDurationMs
    || leaseTargetAtMs <= deadline.operationDeadlineAtMs
  ) {
    throw new MediaBlobWriterLeaseDeadlineError(
      "leaseTargetAt must be a future timestamp strictly after operationDeadlineAt.",
    );
  }
  return Object.freeze({ leaseTargetAt, leaseTargetAtMs, ...deadline });
}
function deriveDirectAttemptLeaseDurationMs(
  lease: DirectMediaBlobWriterAttemptLeaseSnapshot,
): number {
  const nowMs = Date.now();
  const leaseDurationMs = Math.floor(
    lease.leaseTargetAtMs
    - nowMs
    - directMediaBlobWriterLeaseDatabaseSkewMarginMs,
  );
  assertPositiveBoundedDuration(
    leaseDurationMs,
    "leaseDurationMs",
    maximumMediaBlobWriterAttemptLeaseDurationMs,
  );
  if (lease.operationDeadlineAtMs - nowMs >= leaseDurationMs) {
    throw new MediaBlobWriterLeaseDeadlineError(
      "Insufficient exact writer lease budget remains for the operation deadline.",
    );
  }
  return leaseDurationMs;
}
function snapshotDirectAttemptInput(
  input: DirectMediaBlobWriterAttemptInput,
): DirectMediaBlobWriterAttemptInput {
  if (typeof input !== "object" || input === null) {
    throw new TypeError("Direct writer attempt input must be an object.");
  }
  const snapshot = {
    attemptToken: input.attemptToken, userId: input.userId, workspaceId: input.workspaceId,
    mediaAssetId: input.mediaAssetId, operationId: input.operationId,
    lastModifiedByReplicaId: input.lastModifiedByReplicaId, sha256: input.sha256,
    storageKey: input.storageKey, mimeType: input.mimeType, sizeBytes: input.sizeBytes,
    normalizationVersion: input.normalizationVersion, sourceUrl: input.sourceUrl,
    assetCreatedAt: input.assetCreatedAt, clientUpdatedAt: input.clientUpdatedAt,
  };
  if ([
    snapshot.attemptToken, snapshot.userId, snapshot.workspaceId, snapshot.mediaAssetId,
    snapshot.operationId, snapshot.lastModifiedByReplicaId, snapshot.sha256,
    snapshot.storageKey, snapshot.mimeType, snapshot.assetCreatedAt, snapshot.clientUpdatedAt,
  ].some((value) => typeof value !== "string")) {
    throw new TypeError("Direct writer attempt string fields must be strings.");
  }
  if (snapshot.sourceUrl !== null && typeof snapshot.sourceUrl !== "string") {
    throw new TypeError("sourceUrl must be a string or null.");
  }
  const canonical = Object.freeze({
    ...snapshot,
    assetCreatedAt: requireIsoTimestamp(snapshot.assetCreatedAt, "assetCreatedAt"),
    clientUpdatedAt: requireIsoTimestamp(snapshot.clientUpdatedAt, "clientUpdatedAt"),
  });
  assertMediaBlobWriterAttemptToken(canonical.attemptToken);
  assertReservationInput({ ...canonical, writerKind: "direct_ingestion" });
  assertHistoricalWriterOwner(canonical.userId, canonical.lastModifiedByReplicaId);
  return canonical;
}
function snapshotDirectAttemptExactInput(
  input: DirectMediaBlobWriterAttemptExactInput,
): DirectMediaBlobWriterAttemptExactInput {
  const reservationToken = input.reservationToken;
  const snapshot = snapshotDirectAttemptInput(input);
  if (typeof reservationToken !== "string") {
    throw new TypeError("reservationToken must be a string.");
  }
  assertMediaBlobWriterReservationToken(reservationToken);
  return Object.freeze({ ...snapshot, reservationToken });
}
function toDirectAttemptParams(
  input: DirectMediaBlobWriterAttemptInput,
): ReadonlyArray<string | number | null> {
  return [
    input.userId, input.workspaceId, input.mediaAssetId, input.operationId,
    input.lastModifiedByReplicaId, input.sha256, input.storageKey, input.mimeType,
    input.sizeBytes, input.normalizationVersion, input.sourceUrl,
    input.assetCreatedAt, input.clientUpdatedAt,
  ];
}
function requireDirectAttemptStatus<Status extends string>(
  value: string | undefined,
  statuses: ReadonlyArray<Status>,
  operation: string,
): Status {
  const status = statuses.find((candidate) => candidate === value);
  if (status === undefined) {
    throw new TypeError(`PostgreSQL returned an invalid direct writer attempt status. operation=${operation}`);
  }
  return status;
}
function createDirectMediaBlobStorageCapability(
  input: DirectMediaBlobWriterAttemptExactInput,
  leaseExpiresAt: string,
  operationDeadlineAt: string,
): DirectMediaBlobStorageCapability {
  const payload: DirectMediaBlobStorageCapabilityPayload = Object.freeze({
    writerKind: "direct_ingestion", attemptToken: input.attemptToken,
    reservationToken: input.reservationToken, leaseExpiresAt, operationDeadlineAt,
    userId: input.userId, workspaceId: input.workspaceId,
    mediaAssetId: input.mediaAssetId, operationId: input.operationId,
    lastModifiedByReplicaId: input.lastModifiedByReplicaId, sha256: input.sha256,
    storageKey: input.storageKey, mimeType: input.mimeType, sizeBytes: input.sizeBytes,
    normalizationVersion: input.normalizationVersion, sourceUrl: input.sourceUrl,
    assetCreatedAt: requireIsoTimestamp(input.assetCreatedAt, "assetCreatedAt"),
    clientUpdatedAt: requireIsoTimestamp(input.clientUpdatedAt, "clientUpdatedAt"),
  });
  const capability = Object.freeze({}) as DirectMediaBlobStorageCapability;
  directMediaBlobStorageCapabilityClaims.set(capability, payload);
  return capability;
}
function hasExactDirectMediaBlobWriterAttemptInput(
  expected: DirectMediaBlobWriterAttemptExactInput,
  actual: DirectMediaBlobWriterAttemptExactInput,
): boolean {
  return expected.attemptToken === actual.attemptToken
    && expected.reservationToken === actual.reservationToken
    && expected.userId === actual.userId
    && expected.workspaceId === actual.workspaceId
    && expected.mediaAssetId === actual.mediaAssetId
    && expected.operationId === actual.operationId
    && expected.lastModifiedByReplicaId === actual.lastModifiedByReplicaId
    && expected.sha256 === actual.sha256
    && expected.storageKey === actual.storageKey
    && expected.mimeType === actual.mimeType
    && expected.sizeBytes === actual.sizeBytes
    && expected.normalizationVersion === actual.normalizationVersion
    && expected.sourceUrl === actual.sourceUrl
    && expected.assetCreatedAt === actual.assetCreatedAt
    && expected.clientUpdatedAt === actual.clientUpdatedAt;
}
function assertDirectMediaBlobStorageCapabilityForMutationAtTime(
  capability: DirectMediaBlobStorageCapability,
  input: DirectMediaBlobWriterAttemptExactInput,
  observedAtMs: number,
): void {
  const exactInput = snapshotDirectAttemptExactInput(input);
  const payload = typeof capability === "object" && capability !== null
    ? directMediaBlobStorageCapabilityClaims.get(capability)
    : undefined;
  const exactMatch = payload !== undefined
    && Object.isFrozen(capability)
    && Object.isFrozen(payload)
    && payload.writerKind === "direct_ingestion"
    && hasExactDirectMediaBlobWriterAttemptInput(payload, exactInput);
  if (!exactMatch) throw new MediaBlobWriterFenceError("verify_direct_storage_capability");
  if (
    Date.parse(payload.leaseExpiresAt) <= observedAtMs
    || Date.parse(payload.operationDeadlineAt) <= observedAtMs
  ) {
    throw new MediaBlobWriterFenceError("verify_direct_storage_capability_expired");
  }
}
export function assertDirectMediaBlobStorageCapabilityForMutation(
  capability: DirectMediaBlobStorageCapability,
  input: DirectMediaBlobWriterAttemptExactInput,
): void {
  assertDirectMediaBlobStorageCapabilityForMutationAtTime(capability, input, Date.now());
}
export async function reserveMediaBlobWriterInExecutor(
  executor: DatabaseExecutor, input: MediaBlobWriterReservationInput,
): Promise<MediaBlobWriterReservation> {
  assertReservationInput(input);
  const result = await executor.query<ReservationRow>( `SELECT reservation_token, reservation_state, reservation_status, normalization_version FROM content.reserve_media_blob_writer($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [ input.sha256, input.storageKey, input.mimeType, input.sizeBytes, input.normalizationVersion, input.writerKind, input.workspaceId, input.mediaAssetId, input.operationId, ],
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
    normalizationVersion: requireNormalizationVersion(row.normalization_version),
  };
}
export async function reserveMediaBlobWriterForWorkspace(
  userId: string, input: MediaBlobWriterReservationInput,
): Promise<MediaBlobWriterReservation> {
  return transactionWithWorkspaceScope( { userId, workspaceId: input.workspaceId }, async (executor) => reserveMediaBlobWriterInExecutor(executor, input),
  );
}
export async function reserveDirectMediaBlobWriterWithOwnerInExecutor(
  executor: DatabaseExecutor,
  input: DirectMediaBlobWriterReservationInput,
): Promise<MediaBlobWriterReservation> {
  assertReservationInput({ ...input, writerKind: "direct_ingestion" });
  assertHistoricalWriterOwner(input.userId, input.lastModifiedByReplicaId);
  const result = await executor.query<ReservationRow>(
    `SELECT reservation_token, reservation_state, reservation_status, normalization_version FROM content.reserve_direct_media_blob_writer_with_owner($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      input.userId, input.workspaceId, input.mediaAssetId, input.operationId,
      input.lastModifiedByReplicaId, input.sha256, input.storageKey, input.mimeType,
      input.sizeBytes, input.normalizationVersion,
    ],
  );
  const row = result.rows[0];
  if (row?.reservation_status === "cleanup_claimed") throw new MediaBlobLifecycleBusyError();
  if (row?.reservation_status !== "reserved" || row.reservation_token === null
    || (row.reservation_state !== "active" && row.reservation_state !== "ambiguous"
      && row.reservation_state !== "finalized")
  ) throw new MediaBlobWriterFenceError("reserve_direct_owner");
  assertMediaBlobWriterReservationToken(row.reservation_token);
  return { reservationToken: row.reservation_token, state: row.reservation_state,
    normalizationVersion: requireNormalizationVersion(row.normalization_version) };
}
export async function reserveDirectMediaBlobWriterWithOwner(
  input: DirectMediaBlobWriterReservationInput,
): Promise<MediaBlobWriterReservation> {
  return transactionWithWorkspaceScope( { userId: input.userId, workspaceId: input.workspaceId },
    (executor) => reserveDirectMediaBlobWriterWithOwnerInExecutor(executor, input));
}
async function beginDirectMediaBlobWriterAttemptSnapshotInExecutor(
  executor: DatabaseExecutor,
  input: DirectMediaBlobWriterAttemptInput,
  lease: DirectMediaBlobWriterAttemptLeaseSnapshot,
): Promise<DirectMediaBlobWriterAttemptResult> {
  const leaseDurationMs = deriveDirectAttemptLeaseDurationMs(lease);
  const result = await executor.query<AttemptBeginRow>(
    `SELECT attempt_status, reservation_token, normalization_version, lease_expires_at
     FROM content.begin_direct_media_blob_writer_attempt_with_owner(
       $1,$2,ROW($3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ::content.direct_media_blob_writer_attempt_payload
     )`,
    [input.attemptToken, leaseDurationMs, ...toDirectAttemptParams(input)],
  );
  if (result.rows.length !== 1) {
    throw new TypeError("PostgreSQL returned an invalid direct writer attempt row count.");
  }
  const row = result.rows[0];
  if (row?.attempt_status === "acquired" || row?.attempt_status === "replayed"
    || row?.attempt_status === "expired_takeover") {
    if (row.reservation_token === null || row.normalization_version === null
      || row.lease_expires_at === null) {
      throw new TypeError("PostgreSQL returned an incomplete direct writer attempt acquisition.");
    }
    assertMediaBlobWriterReservationToken(row.reservation_token);
    const normalizationVersion = requireNormalizationVersion(row.normalization_version);
    const leaseExpiresAt = requireIsoTimestamp(row.lease_expires_at, "leaseExpiresAt");
    const leaseExpiresAtMs = Date.parse(leaseExpiresAt);
    if (
      leaseExpiresAtMs <= lease.operationDeadlineAtMs
      || leaseExpiresAtMs > lease.leaseTargetAtMs
    ) {
      throw new MediaBlobWriterLeaseDeadlineError(
        "PostgreSQL returned a writer lease outside the exact operation window.",
      );
    }
    const exactInput = Object.freeze({
      ...input,
      reservationToken: row.reservation_token,
      normalizationVersion,
    });
    return {
      status: row.attempt_status,
      reservationToken: row.reservation_token,
      normalizationVersion,
      leaseExpiresAt,
      storageCapability: createDirectMediaBlobStorageCapability(
        exactInput,
        leaseExpiresAt,
        lease.operationDeadlineAt,
      ),
    };
  }
  const status = requireDirectAttemptStatus(
    row?.attempt_status, directAttemptBeginStatuses, "begin_direct_writer_attempt",
  );
  if (row.reservation_token !== null) {
    throw new TypeError("PostgreSQL returned an invalid direct writer attempt acquisition result.");
  }
  if (status === "cleanup_claimed") {
    if (row.normalization_version === null || row.lease_expires_at !== null) {
      throw new TypeError("PostgreSQL returned an invalid cleanup-claimed writer result.");
    }
    requireNormalizationVersion(row.normalization_version);
    return { status };
  }
  if (row.normalization_version !== null) {
    throw new TypeError("PostgreSQL returned an unexpected direct writer normalization version.");
  }
  if (status === "busy") {
    if (row.lease_expires_at === null) {
      throw new TypeError("PostgreSQL returned a busy direct writer attempt without its lease expiry.");
    }
    return { status, leaseExpiresAt: requireIsoTimestamp(row.lease_expires_at, "leaseExpiresAt") };
  }
  if (row.lease_expires_at !== null) {
    throw new TypeError("PostgreSQL returned an unexpected direct writer attempt lease.");
  }
  return { status };
}
export function beginDirectMediaBlobWriterAttemptWithOwner(
  input: DirectMediaBlobWriterAttemptInput,
  lease: DirectMediaBlobWriterAttemptLease,
): Promise<DirectMediaBlobWriterAttemptResult> {
  const snapshot = snapshotDirectAttemptInput(input);
  const leaseSnapshot = snapshotDirectAttemptLease(lease);
  return transactionWithWorkspaceScopeDeadline(
    { userId: snapshot.userId, workspaceId: snapshot.workspaceId },
    leaseSnapshot.operationDeadlineAtMs,
    (executor) => beginDirectMediaBlobWriterAttemptSnapshotInExecutor(
      executor, snapshot, leaseSnapshot,
    ),
  );
}
async function queryDirectAttemptStatus<Status extends string>(
  executor: DatabaseExecutor,
  sql: string,
  input: DirectMediaBlobWriterAttemptExactInput,
  cleanupDelayMs: number,
  statuses: ReadonlyArray<Status>,
  operation: string,
): Promise<Status> {
  assertPositiveBoundedDuration(
    cleanupDelayMs,
    "cleanupDelayMs",
    maximumMediaBlobCleanupDelayMs,
  );
  const result = await executor.query<AttemptStatusRow>(sql, [
    input.attemptToken, input.reservationToken, ...toDirectAttemptParams(input),
    cleanupDelayMs,
  ]);
  if (result.rows.length !== 1) {
    throw new TypeError(`PostgreSQL returned an invalid direct writer status row count. operation=${operation}`);
  }
  return requireDirectAttemptStatus(result.rows[0]?.attempt_status, statuses, operation);
}
function createDirectMediaBlobWriterApplyExecutor(
  executor: DatabaseExecutor,
  input: DirectMediaBlobWriterAttemptExactInput,
  deadline: DirectMediaBlobWriterOperationDeadline,
): DirectMediaBlobWriterApplyExecutor {
  const applyExecutor = Object.freeze(executor) as DirectMediaBlobWriterApplyExecutor;
  directMediaBlobWriterApplyExecutorClaims.set(applyExecutor, Object.freeze({
    input,
    operationDeadlineAt: deadline.operationDeadlineAt,
    operationDeadlineAtMs: deadline.operationDeadlineAtMs,
  }));
  return applyExecutor;
}
function assertDirectMediaBlobWriterApplyExecutor(
  executor: DirectMediaBlobWriterApplyExecutor,
  input: DirectMediaBlobWriterAttemptExactInput,
  deadline: DirectMediaBlobWriterOperationDeadline,
): void {
  const claim = typeof executor === "object" && executor !== null
    ? directMediaBlobWriterApplyExecutorClaims.get(executor)
    : undefined;
  if (
    claim === undefined
    || claim.operationDeadlineAt !== deadline.operationDeadlineAt
    || claim.operationDeadlineAtMs !== deadline.operationDeadlineAtMs
    || !hasExactDirectMediaBlobWriterAttemptInput(claim.input, input)
  ) {
    throw new TypeError("Direct writer apply executor does not match its exact attempt and deadline.");
  }
}
export function transactionWithDirectMediaBlobWriterApplyDeadline<Result>(
  input: DirectMediaBlobWriterAttemptExactInput,
  operationDeadlineAt: string,
  callback: (
    executor: DirectMediaBlobWriterApplyExecutor,
    snapshot: DirectMediaBlobWriterAttemptExactInput,
    exactOperationDeadlineAt: string,
  ) => Promise<Result>,
): Promise<Result> {
  const snapshot = snapshotDirectAttemptExactInput(input);
  const deadline = snapshotDirectAttemptOperationDeadline(operationDeadlineAt);
  return transactionWithWorkspaceScopeDeadline(
    { userId: snapshot.userId, workspaceId: snapshot.workspaceId },
    deadline.operationDeadlineAtMs,
    async (executor) => {
      const applyExecutor = createDirectMediaBlobWriterApplyExecutor(
        executor, snapshot, deadline,
      );
      try {
        return await callback(applyExecutor, snapshot, deadline.operationDeadlineAt);
      } finally {
        directMediaBlobWriterApplyExecutorClaims.delete(applyExecutor);
      }
    },
  );
}
export function fenceDirectMediaBlobWriterAttemptApplyWithOwnerInExecutor(
  executor: DirectMediaBlobWriterApplyExecutor,
  input: DirectMediaBlobWriterAttemptExactInput,
  cleanupDelayMs: number,
  operationDeadlineAt: string,
): Promise<DirectMediaBlobWriterAttemptFenceStatus> {
  const snapshot = snapshotDirectAttemptExactInput(input);
  const deadline = snapshotDirectAttemptOperationDeadline(operationDeadlineAt);
  assertDirectMediaBlobWriterApplyExecutor(executor, snapshot, deadline);
  return queryDirectAttemptStatus(
    executor,
    `SELECT content.fence_direct_media_blob_writer_attempt_apply_with_owner(
       $1,$2,ROW($3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ::content.direct_media_blob_writer_attempt_payload,$16
    ) AS attempt_status`,
    snapshot, cleanupDelayMs, directAttemptFenceStatuses, "fence_direct_writer_attempt_apply",
  );
}
export function finishDirectMediaBlobWriterAttemptApplyWithOwnerInExecutor(
  executor: DirectMediaBlobWriterApplyExecutor,
  input: DirectMediaBlobWriterAttemptExactInput,
  cleanupDelayMs: number,
  operationDeadlineAt: string,
): Promise<DirectMediaBlobWriterAttemptFinishStatus> {
  const snapshot = snapshotDirectAttemptExactInput(input);
  const deadline = snapshotDirectAttemptOperationDeadline(operationDeadlineAt);
  assertDirectMediaBlobWriterApplyExecutor(executor, snapshot, deadline);
  return queryDirectAttemptStatus(
    executor,
    `SELECT content.finish_direct_media_blob_writer_attempt_apply_with_owner(
       $1,$2,ROW($3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ::content.direct_media_blob_writer_attempt_payload,$16
    ) AS attempt_status`,
    snapshot, cleanupDelayMs, directAttemptFinishStatuses, "finish_direct_writer_attempt_apply",
  );
}
export function resolveDirectMediaBlobWriterAttemptFailureWithOwner(
  input: DirectMediaBlobWriterAttemptExactInput,
  cleanupDelayMs: number,
  operationDeadlineAt: string,
): Promise<DirectMediaBlobWriterAttemptFailureStatus> {
  const snapshot = snapshotDirectAttemptExactInput(input);
  const deadline = snapshotDirectAttemptOperationDeadline(operationDeadlineAt);
  return transactionWithWorkspaceScopeDeadline(
    { userId: snapshot.userId, workspaceId: snapshot.workspaceId },
    deadline.operationDeadlineAtMs,
    (executor) => queryDirectAttemptStatus(
      executor,
      `SELECT content.resolve_direct_media_blob_writer_attempt_failure_with_owner(
         $1,$2,ROW($3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         ::content.direct_media_blob_writer_attempt_payload,$16
       ) AS attempt_status`,
      snapshot, cleanupDelayMs, directAttemptFailureStatuses, "resolve_direct_writer_attempt_failure",
    ),
  );
}
export function resolveDirectMediaBlobWriterAttemptAfterAccessRevocation(
  input: DirectMediaBlobWriterAttemptExactInput,
  cleanupDelayMs: number,
  operationDeadlineAt: string,
): Promise<DirectMediaBlobWriterAttemptRevocationStatus> {
  const snapshot = snapshotDirectAttemptExactInput(input);
  const deadline = snapshotDirectAttemptOperationDeadline(operationDeadlineAt);
  return unsafeTransactionWithDeadline(deadline.operationDeadlineAtMs, async (executor) => {
    await applyWorkspaceDatabaseScopeInExecutor(
      executor,
      { userId: snapshot.userId, workspaceId: snapshot.workspaceId },
    );
    return queryDirectAttemptStatus(
      executor,
      `SELECT content.resolve_direct_media_blob_writer_attempt_after_access_revocation(
         $1,$2,ROW($3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         ::content.direct_media_blob_writer_attempt_payload,$16
       ) AS attempt_status`,
      snapshot, cleanupDelayMs, directAttemptRevocationStatuses,
      "resolve_direct_writer_attempt_after_access_revocation",
    );
  });
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
export async function terminalizeMediaBlobWriterFailureInExecutor(
  executor: DatabaseExecutor, input: MediaBlobWriterExactInput,
): Promise<MediaBlobWriterReconciliation> {
  assertReservationInput(input);
  assertMediaBlobWriterReservationToken(input.reservationToken);
  const result = await executor.query<ReconciliationRow>(
    `SELECT content.terminalize_media_blob_writer_failure(
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
     ) AS reconciliation_status`,
    [
      input.reservationToken, input.sha256, input.storageKey, input.mimeType, input.sizeBytes,
      input.normalizationVersion, input.writerKind, input.workspaceId, input.mediaAssetId,
      input.operationId, mediaBlobCleanupDelayMs,
    ],
  );
  const status = result.rows[0]?.reconciliation_status;
  if (status === "referenced" || status === "unreferenced") return status;
  throw new MediaBlobWriterFenceError("terminalize_failure");
}
export async function resolveDirectMediaBlobWriterAfterAccessRevocationInExecutor(
  executor: DatabaseExecutor,
  input: DirectMediaBlobWriterResolutionInput,
): Promise<DirectMediaBlobWriterResolution> {
  assertReservationInput({
    ...input,
    writerKind: "direct_ingestion",
    normalizationVersion: passthroughMediaBlobNormalizationVersion,
  });
  assertHistoricalWriterOwner(input.userId, input.lastModifiedByReplicaId);
  const result = await executor.query<DirectResolutionRow>(
    `SELECT content.resolve_direct_media_blob_writer_after_access_revocation(
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
     ) AS resolution_status`,
    [
      input.userId, input.workspaceId, input.mediaAssetId, input.operationId,
      input.lastModifiedByReplicaId, input.sha256, input.storageKey, input.mimeType,
      input.sizeBytes, mediaBlobCleanupDelayMs,
    ],
  );
  const status = result.rows[0]?.resolution_status;
  if (
    status === "absent" || status === "referenced" || status === "unreferenced"
    || status === "access_active" || status === "stale"
  ) return status;
  throw new TypeError("PostgreSQL returned an invalid direct media blob writer resolution.");
}
export async function resolveDirectMediaBlobWriterAfterAccessRevocation(
  input: DirectMediaBlobWriterResolutionInput,
): Promise<DirectMediaBlobWriterResolution> {
  return unsafeTransaction(
    (executor) => resolveDirectMediaBlobWriterAfterAccessRevocationInExecutor(executor, input),
  );
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
