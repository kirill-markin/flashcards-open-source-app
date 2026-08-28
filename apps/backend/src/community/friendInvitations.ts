import { createHash, randomBytes, randomUUID } from "node:crypto";
import type pg from "pg";
import {
  transactionWithUserScope,
  type DatabaseExecutor,
  type SqlValue,
  type UserDatabaseScope,
} from "../database";
import { getDatabaseErrorFields } from "../database/transient";
import { unsafeQuery } from "../database/unsafe";
import {
  captureBackendWarning,
  createBackendObservationScope,
} from "../observability/sentry";
import { HttpError } from "../shared/errors";
import {
  recordFriendInvitationCreatedAnalytics,
  recordFriendshipCreatedAnalytics,
  type FriendInvitationCreatedFact,
  type FriendshipCreatedFact,
} from "./analytics";
import {
  ensurePublicProfileIdForCurrentUserInExecutor,
  type CurrentUserPublicProfileId,
} from "./publicProfiles";

export const activeFriendInvitationLimit = 20;
export const friendInvitationDisplayNameMaxLength = 30;
export const friendInviteTokenByteLength = 32;
export const friendInviteUrlBase = "https://app.flashcards-open-source-app.com/invite";

// A savepoint name is an identifier and cannot be parameterized, so it is this fixed literal and
// nothing a request supplied ever reaches the statements built from it.
const friendshipAnalyticsFactSavepoint = "friendship_analytics_fact";

const displayNameControlCharacterPattern = /[\u0000-\u001F\u007F]/u;

export type FriendInvitationCreateInput = Readonly<{
  userId: string;
  inviteeDisplayName: string;
}>;

export type FriendInvitationCreateResponse = Readonly<{
  inviteUrl: string;
  expiresAt: string;
}>;

export type FriendInvitationPreviewResponse =
  | Readonly<{ status: "active"; expiresAt: string }>
  | Readonly<{ status: "inactive" }>;

export type FriendInvitationAcceptInput = Readonly<{
  userId: string;
  rawInviteToken: string;
  inviterDisplayName: string;
}>;

export type FriendInvitationAcceptResponse =
  | Readonly<{ status: "accepted" }>
  | Readonly<{ status: "already_friends"; existingFriendDisplayName: string }>
  | Readonly<{ status: "inactive" }>;

type UserScopedTransactionFn = <Result>(
  scope: UserDatabaseScope,
  callback: (executor: DatabaseExecutor) => Promise<Result>,
) => Promise<Result>;

type UnsafeQueryFn = <Row extends pg.QueryResultRow>(
  text: string,
  params: ReadonlyArray<SqlValue>,
) => Promise<pg.QueryResult<Row>>;

type EnsureCurrentUserPublicProfileFn = (
  executor: DatabaseExecutor,
) => Promise<CurrentUserPublicProfileId>;

type RecordFriendInvitationCreatedAnalyticsFn = (
  invitation: FriendInvitationCreatedFact,
) => Promise<void>;

type RecordFriendshipCreatedAnalyticsFn = (friendship: FriendshipCreatedFact) => Promise<void>;

export type FriendInvitationServiceDependencies = Readonly<{
  transactionWithUserScopeFn: UserScopedTransactionFn;
  unsafeQueryFn: UnsafeQueryFn;
  ensureCurrentUserPublicProfileFn: EnsureCurrentUserPublicProfileFn;
  recordFriendInvitationCreatedAnalyticsFn: RecordFriendInvitationCreatedAnalyticsFn;
  recordFriendshipCreatedAnalyticsFn: RecordFriendshipCreatedAnalyticsFn;
  randomBytesFn: (byteCount: number) => Buffer;
  randomUuidFn: () => string;
  inviteUrlBase: string;
  activeInviteLimit: number;
}>;

type ActiveInvitationCountRow = pg.QueryResultRow & Readonly<{
  active_invitation_count: number | string;
}>;

type CreatedInvitationRow = pg.QueryResultRow & Readonly<{
  friend_invitation_id: string;
  created_at: Date | string;
  expires_at: Date | string;
}>;

type CreatedFriendshipRow = pg.QueryResultRow & Readonly<{
  friend_user_id: string;
  created_from_invitation_id: string;
  created_at: Date | string;
}>;

type InsertedFriendInvitation = Readonly<{
  friendInvitationId: string;
  createdAt: Date;
  expiresAt: string;
}>;

type PreviewInvitationRow = pg.QueryResultRow & Readonly<{
  invitation_status: string;
  expires_at: Date | string | null;
}>;

type AcceptInvitationRow = pg.QueryResultRow & Readonly<{
  acceptance_status: string;
  inviter_public_profile_id: string | null;
  invitee_public_profile_id: string | null;
}>;

type ExistingFriendRow = pg.QueryResultRow & Readonly<{
  friend_display_name: string;
}>;

export const defaultFriendInvitationServiceDependencies: FriendInvitationServiceDependencies = {
  transactionWithUserScopeFn: transactionWithUserScope,
  unsafeQueryFn: unsafeQuery,
  ensureCurrentUserPublicProfileFn: ensurePublicProfileIdForCurrentUserInExecutor,
  recordFriendInvitationCreatedAnalyticsFn: recordFriendInvitationCreatedAnalytics,
  recordFriendshipCreatedAnalyticsFn: recordFriendshipCreatedAnalytics,
  randomBytesFn: randomBytes,
  randomUuidFn: randomUUID,
  inviteUrlBase: friendInviteUrlBase,
  activeInviteLimit: activeFriendInvitationLimit,
};

export function hashFriendInviteToken(rawInviteToken: string): string {
  return createHash("sha256").update(rawInviteToken, "utf8").digest("hex");
}

export function parseFriendInvitationDisplayName(value: unknown, fieldName: string): string {
  if (typeof value !== "string") {
    throw new HttpError(
      400,
      `${fieldName} must be a string.`,
      "FRIEND_INVITATION_DISPLAY_NAME_INVALID",
    );
  }

  if (displayNameControlCharacterPattern.test(value)) {
    throw new HttpError(
      400,
      `${fieldName} must not contain control characters or newlines.`,
      "FRIEND_INVITATION_DISPLAY_NAME_INVALID",
    );
  }

  const normalizedDisplayName = value.trim();
  const displayNameLength = Array.from(normalizedDisplayName).length;
  if (displayNameLength < 1 || displayNameLength > friendInvitationDisplayNameMaxLength) {
    throw new HttpError(
      400,
      `${fieldName} must be 1 to ${friendInvitationDisplayNameMaxLength} characters after trimming.`,
      "FRIEND_INVITATION_DISPLAY_NAME_INVALID",
    );
  }

  return normalizedDisplayName;
}

function createRawFriendInviteToken(dependencies: FriendInvitationServiceDependencies): string {
  return dependencies.randomBytesFn(friendInviteTokenByteLength).toString("base64url");
}

function createFriendInviteUrl(inviteUrlBase: string, rawInviteToken: string): string {
  return `${inviteUrlBase}/${rawInviteToken}`;
}

function normalizeTimestampDate(value: Date | string, fieldName: string): Date {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid friend invitation timestamp for ${fieldName}: ${String(value)}.`);
  }

  return date;
}

function normalizeTimestamp(value: Date | string, fieldName: string): string {
  return normalizeTimestampDate(value, fieldName).toISOString();
}

function normalizeActiveInvitationCount(value: number | string): number {
  const parsedValue = typeof value === "number" ? value : Number.parseInt(value, 10);
  if (!Number.isInteger(parsedValue) || parsedValue < 0) {
    throw new Error(`Invalid active friend invitation count: ${String(value)}.`);
  }

  return parsedValue;
}

function assertCurrentUserProfileMatchesRequestUser(
  currentProfile: CurrentUserPublicProfileId,
  requestUserId: string,
): void {
  if (currentProfile.userId !== requestUserId) {
    throw new Error(
      `Current user public profile scope mismatch: expected ${requestUserId}, got ${currentProfile.userId}.`,
    );
  }
}

function assertValidActiveInviteLimit(activeInviteLimit: number): void {
  if (!Number.isInteger(activeInviteLimit) || activeInviteLimit < 1) {
    throw new Error(`activeInviteLimit must be a positive integer, got ${activeInviteLimit}.`);
  }
}

async function readActiveInvitationCountForInviterInExecutor(
  executor: DatabaseExecutor,
  inviterUserId: string,
): Promise<number> {
  const result = await executor.query<ActiveInvitationCountRow>(
    [
      "SELECT COUNT(*)::INTEGER AS active_invitation_count",
      "FROM community.friend_invitations",
      "WHERE inviter_user_id = $1",
      "AND accepted_at IS NULL",
      "AND expires_at > now()",
    ].join(" "),
    [inviterUserId],
  );

  const row = result.rows[0];
  if (row === undefined) {
    throw new Error(`Failed to count active friend invitations for inviter user ${inviterUserId}.`);
  }

  return normalizeActiveInvitationCount(row.active_invitation_count);
}

async function lockFriendInvitationCreateForInviterInExecutor(
  executor: DatabaseExecutor,
  inviterUserId: string,
): Promise<void> {
  await executor.query(
    "SELECT pg_advisory_xact_lock(hashtextextended($1, 0::bigint))",
    [`community.friend_invitations:${inviterUserId}`],
  );
}

async function insertFriendInvitationInExecutor(
  executor: DatabaseExecutor,
  inviterUserId: string,
  inviteTokenHash: string,
  inviteeDisplayName: string,
  dependencies: FriendInvitationServiceDependencies,
): Promise<InsertedFriendInvitation> {
  const result = await executor.query<CreatedInvitationRow>(
    [
      "INSERT INTO community.friend_invitations",
      "(friend_invitation_id, inviter_user_id, invite_token_hash, invitee_display_name_for_inviter, expires_at)",
      "VALUES ($1, $2, $3, $4, now() + interval '2 days')",
      "RETURNING friend_invitation_id, created_at, expires_at",
    ].join(" "),
    [dependencies.randomUuidFn(), inviterUserId, inviteTokenHash, inviteeDisplayName],
  );

  const row = result.rows[0];
  if (row === undefined) {
    throw new Error(`Failed to create friend invitation for inviter user ${inviterUserId}.`);
  }

  return {
    friendInvitationId: row.friend_invitation_id,
    createdAt: normalizeTimestampDate(row.created_at, "created_at"),
    expiresAt: normalizeTimestamp(row.expires_at, "expires_at"),
  };
}

function assertActiveInvitationLimitNotReached(activeInvitationCount: number, activeInviteLimit: number): void {
  if (activeInvitationCount < activeInviteLimit) {
    return;
  }

  throw new HttpError(
    409,
    `You already have ${activeInviteLimit} active friend invitation links. Wait for one to expire or be accepted before creating another.`,
    "FRIEND_INVITATION_LIMIT_REACHED",
  );
}

/**
 * Reads the display name an existing friendship already stores, which is the whole already_friends
 * response.
 *
 * Deliberately not wrapped in the savepoint readCreatedFriendshipFactInExecutor below uses, even
 * though the two reads sit next to each other over the same table with the same scoping. This one is
 * product-required and its result is what the caller answers with, so a failure here has to fail the
 * request. The savepoint next door exists only because that read serves analytics, which must never
 * be what fails a user operation.
 */
async function readExistingFriendDisplayNameInExecutor(
  executor: DatabaseExecutor,
  viewerUserId: string,
  friendPublicProfileId: string,
): Promise<string> {
  const result = await executor.query<ExistingFriendRow>(
    [
      "SELECT friend_display_name",
      "FROM community.friendships",
      "WHERE viewer_user_id = $1",
      "AND friend_public_profile_id = $2",
      "LIMIT 1",
    ].join(" "),
    [viewerUserId, friendPublicProfileId],
  );

  const existingFriendDisplayName = result.rows[0]?.friend_display_name;
  if (existingFriendDisplayName === undefined) {
    throw new Error(
      `community.accept_friend_invitation returned already_friends without an existing friendship display name for viewer user ${viewerUserId}.`,
    );
  }

  return existingFriendDisplayName;
}

/**
 * Reports one acceptance whose friendship_created events were dropped before either of them was
 * attempted.
 *
 * Named after the skipped fact rather than after a failed write, because it is the opposite of
 * product_analytics_server_event_write_failed: no row reached the writer at all. Both directed
 * events are derived from the single row this reports on, so they are always lost together, and the
 * acceptance itself still succeeded, which leaves this warning as the only trace either was owed.
 */
function captureFriendshipCreatedAnalyticsSkipped(
  accepterUserId: string,
  reason: "friendship_row_missing" | "friendship_row_read_failed",
  error: unknown,
): void {
  const errorDetails = error === null ? null : getDatabaseErrorFields(error);
  captureBackendWarning({
    action: "friendship_created_analytics_skipped",
    scope: createBackendObservationScope(
      "backend-api",
      null,
      null,
      null,
      accepterUserId,
      // community.friendships is account-scoped, so there is no workspace, and the accept route
      // takes only signed-in human transport, so there is no guest session to correlate this with.
      null,
      null,
      null,
      null,
      null,
      null,
    ),
    details: {
      reason,
      sqlState: errorDetails?.sqlState ?? null,
      errorClass: errorDetails?.errorClass ?? null,
      errorMessage: errorDetails?.errorMessage ?? null,
    },
  });
}

async function selectCreatedFriendshipFactInExecutor(
  executor: DatabaseExecutor,
  accepterUserId: string,
  inviterPublicProfileId: string,
): Promise<FriendshipCreatedFact | null> {
  const result = await executor.query<CreatedFriendshipRow>(
    [
      "SELECT friend_user_id, created_from_invitation_id, created_at",
      "FROM community.friendships",
      "WHERE viewer_user_id = $1",
      "AND friend_public_profile_id = $2",
      "LIMIT 1",
    ].join(" "),
    [accepterUserId, inviterPublicProfileId],
  );

  const row = result.rows[0];
  if (row === undefined) {
    return null;
  }

  return {
    friendInvitationId: row.created_from_invitation_id,
    inviterUserId: row.friend_user_id,
    accepterUserId,
    createdAt: normalizeTimestampDate(row.created_at, "created_at"),
  };
}

/**
 * Reads the accepter's own directed friendship row, which is the only place the accepter may learn
 * the invitation id and the inviter's user id from.
 *
 * community.accept_friend_invitation returns public profile ids only, and the SELECT policy on
 * community.friend_invitations admits the inviter alone and only while accepted_at is NULL, so the
 * invitation row is unreadable here by design. The accepter's community.friendships row carries the
 * same two ids and is theirs to read.
 *
 * The read runs inside the acceptance's own transaction, which is the cheapest place those rows are
 * readable, and the savepoint is what keeps that from coupling the acceptance to an analytics-only
 * statement. A plain try/catch would be worse than no guard at all: these routes take the
 * non-deadline path, whose commitTransaction issues COMMIT and reports success without inspecting
 * the returned command, so a swallowed statement error would leave the transaction aborted and
 * report an acceptance that Postgres had silently turned into a ROLLBACK. ROLLBACK TO SAVEPOINT
 * clears that aborted state instead, which is what makes swallowing the failure safe here: the
 * acceptance's own statements survive it and COMMIT still commits them.
 */
async function readCreatedFriendshipFactInExecutor(
  executor: DatabaseExecutor,
  accepterUserId: string,
  inviterPublicProfileId: string,
): Promise<FriendshipCreatedFact | null> {
  // Outside the guard on purpose, as is the RELEASE below. Both can only fail on a transaction that
  // can no longer commit anyway, and swallowing a failed SAVEPOINT would leave nothing to roll back
  // to, which is the aborted-transaction hazard this function exists to avoid.
  await executor.query(`SAVEPOINT ${friendshipAnalyticsFactSavepoint}`, []);

  let friendship: FriendshipCreatedFact | null;
  try {
    friendship = await selectCreatedFriendshipFactInExecutor(
      executor,
      accepterUserId,
      inviterPublicProfileId,
    );
  } catch (error) {
    await executor.query(`ROLLBACK TO SAVEPOINT ${friendshipAnalyticsFactSavepoint}`, []);
    captureFriendshipCreatedAnalyticsSkipped(accepterUserId, "friendship_row_read_failed", error);
    return null;
  }

  await executor.query(`RELEASE SAVEPOINT ${friendshipAnalyticsFactSavepoint}`, []);

  if (friendship === null) {
    // Unreachable today: community.accept_friend_invitation inserted this exact row in this
    // transaction before it reported the acceptance, and the read's two predicates match it exactly.
    // It gives up the fact instead of throwing because the acceptance has already happened and
    // analytics must never be what takes it back, so the warning is what keeps that from becoming a
    // silent loss of both events if the premise ever stops holding.
    captureFriendshipCreatedAnalyticsSkipped(accepterUserId, "friendship_row_missing", null);
  }

  return friendship;
}

function assertAcceptProfileIdsPresent(
  row: AcceptInvitationRow,
): asserts row is AcceptInvitationRow & Readonly<{
  inviter_public_profile_id: string;
  invitee_public_profile_id: string;
}> {
  if (row.inviter_public_profile_id === null || row.invitee_public_profile_id === null) {
    throw new Error(
      `community.accept_friend_invitation returned ${row.acceptance_status} without both public profile ids.`,
    );
  }
}

async function mapAcceptInvitationRow(
  executor: DatabaseExecutor,
  viewerUserId: string,
  row: AcceptInvitationRow,
): Promise<FriendInvitationAcceptResponse> {
  switch (row.acceptance_status) {
    case "accepted":
      assertAcceptProfileIdsPresent(row);
      return { status: "accepted" };
    case "already_friends":
      assertAcceptProfileIdsPresent(row);
      return {
        status: "already_friends",
        existingFriendDisplayName: await readExistingFriendDisplayNameInExecutor(
          executor,
          viewerUserId,
          row.inviter_public_profile_id,
        ),
      };
    case "inactive":
    case "already_accepted":
      return { status: "inactive" };
    case "self":
      throw new HttpError(
        409,
        "This is your own invitation link.",
        "FRIEND_INVITATION_SELF",
      );
    default:
      throw new Error(
        `community.accept_friend_invitation returned unexpected status: ${row.acceptance_status}.`,
      );
  }
}

export async function createFriendInvitationWithDependencies(
  input: FriendInvitationCreateInput,
  dependencies: FriendInvitationServiceDependencies,
): Promise<FriendInvitationCreateResponse> {
  assertValidActiveInviteLimit(dependencies.activeInviteLimit);
  const inviteeDisplayName = parseFriendInvitationDisplayName(input.inviteeDisplayName, "inviteeDisplayName");

  const created = await dependencies.transactionWithUserScopeFn({ userId: input.userId }, async (executor) => {
    const currentProfile = await dependencies.ensureCurrentUserPublicProfileFn(executor);
    assertCurrentUserProfileMatchesRequestUser(currentProfile, input.userId);

    await lockFriendInvitationCreateForInviterInExecutor(executor, input.userId);
    const activeInvitationCount = await readActiveInvitationCountForInviterInExecutor(executor, input.userId);
    assertActiveInvitationLimitNotReached(activeInvitationCount, dependencies.activeInviteLimit);

    const rawInviteToken = createRawFriendInviteToken(dependencies);
    const inviteTokenHash = hashFriendInviteToken(rawInviteToken);
    const invitation = await insertFriendInvitationInExecutor(
      executor,
      input.userId,
      inviteTokenHash,
      inviteeDisplayName,
      dependencies,
    );

    return {
      invitation,
      response: {
        inviteUrl: createFriendInviteUrl(dependencies.inviteUrlBase, rawInviteToken),
        expiresAt: invitation.expiresAt,
      },
    };
  });

  // Emitted after the transaction committed, so the row only ever reports a link the inviter really
  // got back. The emission never throws.
  await dependencies.recordFriendInvitationCreatedAnalyticsFn({
    friendInvitationId: created.invitation.friendInvitationId,
    inviterUserId: input.userId,
    createdAt: created.invitation.createdAt,
  });

  return created.response;
}

export async function createFriendInvitation(
  input: FriendInvitationCreateInput,
): Promise<FriendInvitationCreateResponse> {
  return createFriendInvitationWithDependencies(input, defaultFriendInvitationServiceDependencies);
}

export async function previewFriendInvitationWithDependencies(
  rawInviteToken: string,
  dependencies: FriendInvitationServiceDependencies,
): Promise<FriendInvitationPreviewResponse> {
  const result = await dependencies.unsafeQueryFn<PreviewInvitationRow>(
    [
      "SELECT invitation_status, expires_at",
      "FROM community.preview_friend_invitation($1)",
    ].join(" "),
    [hashFriendInviteToken(rawInviteToken)],
  );

  const row = result.rows[0];
  if (row === undefined) {
    throw new Error("community.preview_friend_invitation returned no row.");
  }

  if (row.invitation_status === "inactive") {
    return { status: "inactive" };
  }

  if (row.invitation_status !== "active") {
    throw new Error(`community.preview_friend_invitation returned unexpected status: ${row.invitation_status}.`);
  }

  if (row.expires_at === null) {
    throw new Error("community.preview_friend_invitation returned active without expires_at.");
  }

  return {
    status: "active",
    expiresAt: normalizeTimestamp(row.expires_at, "expires_at"),
  };
}

export async function previewFriendInvitation(rawInviteToken: string): Promise<FriendInvitationPreviewResponse> {
  return previewFriendInvitationWithDependencies(rawInviteToken, defaultFriendInvitationServiceDependencies);
}

export async function acceptFriendInvitationWithDependencies(
  input: FriendInvitationAcceptInput,
  dependencies: FriendInvitationServiceDependencies,
): Promise<FriendInvitationAcceptResponse> {
  const inviterDisplayName = parseFriendInvitationDisplayName(input.inviterDisplayName, "inviterDisplayName");
  const inviteTokenHash = hashFriendInviteToken(input.rawInviteToken);

  const accepted = await dependencies.transactionWithUserScopeFn({ userId: input.userId }, async (executor) => {
    const currentProfile = await dependencies.ensureCurrentUserPublicProfileFn(executor);
    assertCurrentUserProfileMatchesRequestUser(currentProfile, input.userId);

    const result = await executor.query<AcceptInvitationRow>(
      [
        "SELECT acceptance_status, inviter_public_profile_id, invitee_public_profile_id",
        "FROM community.accept_friend_invitation($1, $2)",
      ].join(" "),
      [inviteTokenHash, inviterDisplayName],
    );

    const row = result.rows[0];
    if (row === undefined) {
      throw new Error("community.accept_friend_invitation returned no row.");
    }

    const response = await mapAcceptInvitationRow(executor, input.userId, row);
    if (response.status !== "accepted") {
      return { response, friendship: null };
    }

    assertAcceptProfileIdsPresent(row);

    // Read inside the acceptance's own transaction, which is the cheapest place these rows are
    // readable, and behind a savepoint so this analytics-only read can never be what undoes the
    // acceptance the same transaction already performed.
    return {
      response,
      friendship: await readCreatedFriendshipFactInExecutor(
        executor,
        input.userId,
        row.inviter_public_profile_id,
      ),
    };
  });

  if (accepted.friendship !== null) {
    // Emitted after the transaction committed, so the two rows only report a friendship the database
    // kept. Both emissions never throw, so a lost analytics write cannot take the acceptance with
    // it. One of the two is the inviter's, which makes it the first event in this system attributed
    // to somebody who did not make the request; recordFriendshipCreatedAnalytics says why account
    // deletion still reaches it.
    await dependencies.recordFriendshipCreatedAnalyticsFn(accepted.friendship);
  }

  return accepted.response;
}

export async function acceptFriendInvitation(
  input: FriendInvitationAcceptInput,
): Promise<FriendInvitationAcceptResponse> {
  return acceptFriendInvitationWithDependencies(input, defaultFriendInvitationServiceDependencies);
}
