import type { DatabaseExecutor } from "../database";
import { unsafeTransactionWithDeadline } from "../database/unsafe";
import { buildMediaBlobStorageKey } from "./storageKeys";

const sha256Pattern = /^[0-9a-f]{64}$/u;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export type MediaBlobCleanupClaimStatus =
  | "claimed"
  | "blocked"
  | "completed"
  | "retry_wait"
  | "reconciliation_required"
  | "stale";

export type MediaBlobCleanupClaim = Readonly<{
  cleanupToken: string;
  leaseToken: string;
  sha256: string;
  storageKey: string;
  cleanupGeneration: number;
  leaseExpiresAt: string;
  failureCount: number;
  status: MediaBlobCleanupClaimStatus;
}>;

export type MediaBlobCleanupAuthorizationStatus =
  | "authorized"
  | "blocked"
  | "completed"
  | "stale";

export type MediaBlobCleanupAuthorization = Readonly<{
  storageKey: string | null;
  status: MediaBlobCleanupAuthorizationStatus;
}>;

export type MediaBlobCleanupCompletionStatus = "completed" | "stale";

export type MediaBlobCleanupLeaseRenewalStatus =
  | "renewed"
  | "completed"
  | "stale";

export type MediaBlobCleanupLeaseRenewal = Readonly<{
  leaseExpiresAt: string | null;
  status: MediaBlobCleanupLeaseRenewalStatus;
}>;

export type MediaBlobCleanupLeaseRenewalPhase =
  | "head_object"
  | "delete_object"
  | "complete";

export type MediaBlobCleanupFailurePhase =
  | "authorize"
  | "renew"
  | "head_object"
  | "delete_object"
  | "complete";

export type MediaBlobCleanupFailureDisposition = "retry" | "terminal";

export type MediaBlobCleanupFailureStatus =
  | "retry_scheduled"
  | "reconciliation_required"
  | "completed"
  | "stale";

export type MediaBlobCleanupFailureDecision = Readonly<{
  status: MediaBlobCleanupFailureStatus;
  nextAttemptAt: string | null;
  failureCount: number;
}>;

export type MediaBlobCleanupFailureInput = Readonly<{
  failureToken: string;
  disposition: MediaBlobCleanupFailureDisposition;
  retryDelayMs: number;
  phase: MediaBlobCleanupFailurePhase;
  errorCode: string;
  errorClass: string;
}>;

type CleanupClaimRow = Readonly<{
  cleanup_token: string;
  lease_token: string;
  sha256: string;
  storage_key: string;
  cleanup_generation: string;
  lease_expires_at: Date;
  claim_status: string;
  failure_count: number;
}>;

type CleanupAuthorizationRow = Readonly<{
  storage_key: string | null;
  authorization_status: string;
}>;

type CleanupCompletionRow = Readonly<{
  completion_status: string;
}>;

type CleanupLeaseRenewalRow = Readonly<{
  lease_expires_at: Date | null;
  renewal_status: string;
}>;

type CleanupFailureRow = Readonly<{
  failure_status: string;
  next_attempt_at: Date | null;
  failure_count: number;
}>;

function assertCleanupToken(cleanupToken: string): void {
  if (!uuidPattern.test(cleanupToken)) {
    throw new TypeError("cleanupToken must be a normalized UUID.");
  }
}

function assertCleanupGeneration(cleanupGeneration: number): void {
  if (!Number.isSafeInteger(cleanupGeneration) || cleanupGeneration < 1) {
    throw new RangeError("cleanupGeneration must be a positive safe integer.");
  }
}

function parseCleanupGeneration(value: string): number {
  const cleanupGeneration = Number(value);
  assertCleanupGeneration(cleanupGeneration);
  return cleanupGeneration;
}

function parseClaimStatus(value: string): MediaBlobCleanupClaimStatus {
  if (
    value === "claimed"
    || value === "blocked"
    || value === "completed"
    || value === "retry_wait"
    || value === "reconciliation_required"
    || value === "stale"
  ) {
    return value;
  }
  throw new TypeError("PostgreSQL returned an invalid media-blob cleanup claim status.");
}

function parseFailureCount(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(
      "PostgreSQL returned an invalid media-blob cleanup failure count.",
    );
  }
  return value;
}

function parseAuthorizationStatus(
  value: string,
): MediaBlobCleanupAuthorizationStatus {
  if (
    value === "authorized"
    || value === "blocked"
    || value === "completed"
    || value === "stale"
  ) {
    return value;
  }
  throw new TypeError(
    "PostgreSQL returned an invalid media-blob cleanup authorization status.",
  );
}

function parseLeaseRenewalStatus(
  value: string,
): MediaBlobCleanupLeaseRenewalStatus {
  if (value === "renewed" || value === "completed" || value === "stale") {
    return value;
  }
  throw new TypeError(
    "PostgreSQL returned an invalid media-blob cleanup lease renewal status.",
  );
}

function parseFailureStatus(value: string): MediaBlobCleanupFailureStatus {
  if (
    value === "retry_scheduled"
    || value === "reconciliation_required"
    || value === "completed"
    || value === "stale"
  ) {
    return value;
  }
  throw new TypeError(
    "PostgreSQL returned an invalid media-blob cleanup failure status.",
  );
}

function mapClaimRow(row: CleanupClaimRow): MediaBlobCleanupClaim {
  assertCleanupToken(row.cleanup_token);
  assertCleanupToken(row.lease_token);
  if (!sha256Pattern.test(row.sha256)) {
    throw new TypeError("PostgreSQL returned an invalid cleanup SHA-256.");
  }
  if (row.storage_key !== buildMediaBlobStorageKey(row.sha256)) {
    throw new TypeError(
      "PostgreSQL returned a non-deterministic media-blob cleanup storage key.",
    );
  }
  if (!(row.lease_expires_at instanceof Date)) {
    throw new TypeError(
      "PostgreSQL returned an invalid media-blob cleanup lease expiry.",
    );
  }
  return {
    cleanupToken: row.cleanup_token,
    leaseToken: row.lease_token,
    sha256: row.sha256,
    storageKey: row.storage_key,
    cleanupGeneration: parseCleanupGeneration(row.cleanup_generation),
    leaseExpiresAt: row.lease_expires_at.toISOString(),
    failureCount: parseFailureCount(row.failure_count),
    status: parseClaimStatus(row.claim_status),
  };
}

async function claimNextMediaBlobCleanupInExecutor(
  executor: DatabaseExecutor,
  cleanupToken: string,
  leaseDurationMs: number,
): Promise<MediaBlobCleanupClaim | null> {
  assertCleanupToken(cleanupToken);
  if (
    !Number.isSafeInteger(leaseDurationMs)
    || leaseDurationMs < 1
    || leaseDurationMs > 3_600_000
  ) {
    throw new RangeError(
      "leaseDurationMs must be between 1 and 3600000.",
    );
  }
  const result = await executor.query<CleanupClaimRow>(
    "SELECT * FROM content.claim_next_media_blob_cleanup($1, $2)",
    [cleanupToken, leaseDurationMs],
  );
  const row = result.rows[0];
  return row === undefined ? null : mapClaimRow(row);
}

export async function claimNextMediaBlobCleanup(
  cleanupToken: string,
  leaseDurationMs: number,
  deadlineAtMs: number,
): Promise<MediaBlobCleanupClaim | null> {
  return unsafeTransactionWithDeadline(
    deadlineAtMs,
    (executor) => claimNextMediaBlobCleanupInExecutor(
      executor,
      cleanupToken,
      leaseDurationMs,
    ),
  );
}

async function authorizeMediaBlobCleanupInExecutor(
  executor: DatabaseExecutor,
  claim: MediaBlobCleanupClaim,
): Promise<MediaBlobCleanupAuthorization> {
  assertCleanupToken(claim.cleanupToken);
  assertCleanupToken(claim.leaseToken);
  assertCleanupGeneration(claim.cleanupGeneration);
  const result = await executor.query<CleanupAuthorizationRow>(
    "SELECT * FROM content.authorize_media_blob_cleanup($1, $2, $3)",
    [claim.cleanupToken, claim.cleanupGeneration, claim.leaseToken],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new TypeError(
      "PostgreSQL did not return a media-blob cleanup authorization.",
    );
  }
  if (
    row.storage_key !== null
    && row.storage_key !== buildMediaBlobStorageKey(claim.sha256)
  ) {
    throw new TypeError(
      "PostgreSQL authorized a different media-blob cleanup storage key.",
    );
  }
  return {
    storageKey: row.storage_key,
    status: parseAuthorizationStatus(row.authorization_status),
  };
}

export async function authorizeMediaBlobCleanup(
  claim: MediaBlobCleanupClaim,
  deadlineAtMs: number,
): Promise<MediaBlobCleanupAuthorization> {
  return unsafeTransactionWithDeadline(
    deadlineAtMs,
    (executor) => authorizeMediaBlobCleanupInExecutor(executor, claim),
  );
}

export async function renewMediaBlobCleanupLease(
  claim: MediaBlobCleanupClaim,
  renewalToken: string,
  phase: MediaBlobCleanupLeaseRenewalPhase,
  expectedLeaseExpiresAt: string,
  leaseDurationMs: number,
  deadlineAtMs: number,
): Promise<MediaBlobCleanupLeaseRenewal> {
  assertCleanupToken(claim.cleanupToken);
  assertCleanupToken(claim.leaseToken);
  assertCleanupToken(renewalToken);
  assertCleanupGeneration(claim.cleanupGeneration);
  const expectedExpiry = new Date(expectedLeaseExpiresAt);
  if (Number.isNaN(expectedExpiry.getTime())) {
    throw new TypeError("expectedLeaseExpiresAt must be an ISO timestamp.");
  }
  if (
    !Number.isSafeInteger(leaseDurationMs)
    || leaseDurationMs < 1
    || leaseDurationMs > 3_600_000
  ) {
    throw new RangeError("leaseDurationMs must be between 1 and 3600000.");
  }
  return unsafeTransactionWithDeadline(deadlineAtMs, async (executor) => {
    const result = await executor.query<CleanupLeaseRenewalRow>(
      "SELECT * FROM content.renew_media_blob_cleanup_lease($1, $2, $3, $4, $5, $6, $7)",
      [
        claim.cleanupToken,
        claim.cleanupGeneration,
        claim.leaseToken,
        renewalToken,
        phase,
        expectedExpiry,
        leaseDurationMs,
      ],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new TypeError(
        "PostgreSQL returned an invalid media-blob cleanup lease renewal.",
      );
    }
    const status = parseLeaseRenewalStatus(row.renewal_status);
    if (
      (status === "renewed" && !(row.lease_expires_at instanceof Date))
      || (status !== "renewed" && row.lease_expires_at !== null)
    ) {
      throw new TypeError(
        "PostgreSQL returned an invalid media-blob cleanup lease renewal.",
      );
    }
    return {
      leaseExpiresAt: row.lease_expires_at?.toISOString() ?? null,
      status,
    };
  });
}

function assertFailureText(value: string, fieldName: string): void {
  if (value.length < 1 || value.length > 128) {
    throw new RangeError(`${fieldName} must contain 1 to 128 characters.`);
  }
}

export async function recordMediaBlobCleanupFailure(
  claim: MediaBlobCleanupClaim,
  input: MediaBlobCleanupFailureInput,
  deadlineAtMs: number,
): Promise<MediaBlobCleanupFailureDecision> {
  assertCleanupToken(claim.cleanupToken);
  assertCleanupToken(claim.leaseToken);
  assertCleanupGeneration(claim.cleanupGeneration);
  assertCleanupToken(input.failureToken);
  assertFailureText(input.errorCode, "errorCode");
  assertFailureText(input.errorClass, "errorClass");
  if (
    !Number.isSafeInteger(input.retryDelayMs)
    || (
      input.disposition === "retry"
      && (input.retryDelayMs < 1 || input.retryDelayMs > 3_600_000)
    )
    || (input.disposition === "terminal" && input.retryDelayMs !== 0)
  ) {
    throw new RangeError(
      "retryDelayMs must match the cleanup failure disposition.",
    );
  }
  return unsafeTransactionWithDeadline(deadlineAtMs, async (executor) => {
    const result = await executor.query<CleanupFailureRow>(
      "SELECT * FROM content.record_media_blob_cleanup_failure($1, $2, $3, $4, $5, $6, $7, $8, $9)",
      [
        claim.cleanupToken,
        claim.cleanupGeneration,
        claim.leaseToken,
        input.failureToken,
        input.disposition,
        input.retryDelayMs,
        input.phase,
        input.errorCode,
        input.errorClass,
      ],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new TypeError(
        "PostgreSQL returned an invalid media-blob cleanup failure decision.",
      );
    }
    const status = parseFailureStatus(row.failure_status);
    if (
      (status === "retry_scheduled"
        && !(row.next_attempt_at instanceof Date))
      || (status !== "retry_scheduled" && row.next_attempt_at !== null)
    ) {
      throw new TypeError(
        "PostgreSQL returned an invalid media-blob cleanup failure decision.",
      );
    }
    return {
      status,
      nextAttemptAt: row.next_attempt_at?.toISOString() ?? null,
      failureCount: parseFailureCount(row.failure_count),
    };
  });
}

async function completeMediaBlobCleanupInExecutor(
  executor: DatabaseExecutor,
  claim: MediaBlobCleanupClaim,
): Promise<MediaBlobCleanupCompletionStatus> {
  assertCleanupToken(claim.cleanupToken);
  assertCleanupToken(claim.leaseToken);
  assertCleanupGeneration(claim.cleanupGeneration);
  const result = await executor.query<CleanupCompletionRow>(
    "SELECT content.complete_media_blob_cleanup($1, $2, $3) AS completion_status",
    [claim.cleanupToken, claim.cleanupGeneration, claim.leaseToken],
  );
  const status = result.rows[0]?.completion_status;
  if (status === "completed" || status === "stale") {
    return status;
  }
  throw new TypeError(
    "PostgreSQL returned an invalid media-blob cleanup completion status.",
  );
}

export async function completeMediaBlobCleanup(
  claim: MediaBlobCleanupClaim,
  deadlineAtMs: number,
): Promise<MediaBlobCleanupCompletionStatus> {
  return unsafeTransactionWithDeadline(
    deadlineAtMs,
    (executor) => completeMediaBlobCleanupInExecutor(executor, claim),
  );
}
