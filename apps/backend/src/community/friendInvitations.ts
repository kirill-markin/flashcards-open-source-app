import { createHash, randomBytes, randomUUID } from "node:crypto";
import type pg from "pg";
import {
  transactionWithUserScope,
  type DatabaseExecutor,
  type SqlValue,
  type UserDatabaseScope,
} from "../database";
import { unsafeQuery } from "../database/unsafe";
import { HttpError } from "../shared/errors";
import {
  ensurePublicProfileIdForCurrentUserInExecutor,
  type CurrentUserPublicProfileId,
} from "./publicProfiles";

export const activeFriendInvitationLimit = 20;
export const friendInvitationDisplayNameMaxLength = 30;
export const friendInviteTokenByteLength = 32;
export const friendInviteUrlBase = "https://app.flashcards-open-source-app.com/invite";

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

export type FriendInvitationServiceDependencies = Readonly<{
  transactionWithUserScopeFn: UserScopedTransactionFn;
  unsafeQueryFn: UnsafeQueryFn;
  ensureCurrentUserPublicProfileFn: EnsureCurrentUserPublicProfileFn;
  randomBytesFn: (byteCount: number) => Buffer;
  randomUuidFn: () => string;
  inviteUrlBase: string;
  activeInviteLimit: number;
}>;

type ActiveInvitationCountRow = pg.QueryResultRow & Readonly<{
  active_invitation_count: number | string;
}>;

type CreatedInvitationRow = pg.QueryResultRow & Readonly<{
  expires_at: Date | string;
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

function normalizeTimestamp(value: Date | string, fieldName: string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid friend invitation timestamp for ${fieldName}: ${String(value)}.`);
  }

  return date.toISOString();
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
): Promise<string> {
  const result = await executor.query<CreatedInvitationRow>(
    [
      "INSERT INTO community.friend_invitations",
      "(friend_invitation_id, inviter_user_id, invite_token_hash, invitee_display_name_for_inviter, expires_at)",
      "VALUES ($1, $2, $3, $4, now() + interval '2 days')",
      "RETURNING expires_at",
    ].join(" "),
    [dependencies.randomUuidFn(), inviterUserId, inviteTokenHash, inviteeDisplayName],
  );

  const row = result.rows[0];
  if (row === undefined) {
    throw new Error(`Failed to create friend invitation for inviter user ${inviterUserId}.`);
  }

  return normalizeTimestamp(row.expires_at, "expires_at");
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

  return dependencies.transactionWithUserScopeFn({ userId: input.userId }, async (executor) => {
    const currentProfile = await dependencies.ensureCurrentUserPublicProfileFn(executor);
    assertCurrentUserProfileMatchesRequestUser(currentProfile, input.userId);

    await lockFriendInvitationCreateForInviterInExecutor(executor, input.userId);
    const activeInvitationCount = await readActiveInvitationCountForInviterInExecutor(executor, input.userId);
    assertActiveInvitationLimitNotReached(activeInvitationCount, dependencies.activeInviteLimit);

    const rawInviteToken = createRawFriendInviteToken(dependencies);
    const inviteTokenHash = hashFriendInviteToken(rawInviteToken);
    const expiresAt = await insertFriendInvitationInExecutor(
      executor,
      input.userId,
      inviteTokenHash,
      inviteeDisplayName,
      dependencies,
    );

    return {
      inviteUrl: createFriendInviteUrl(dependencies.inviteUrlBase, rawInviteToken),
      expiresAt,
    };
  });
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

  return dependencies.transactionWithUserScopeFn({ userId: input.userId }, async (executor) => {
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

    return mapAcceptInvitationRow(executor, input.userId, row);
  });
}

export async function acceptFriendInvitation(
  input: FriendInvitationAcceptInput,
): Promise<FriendInvitationAcceptResponse> {
  return acceptFriendInvitationWithDependencies(input, defaultFriendInvitationServiceDependencies);
}
