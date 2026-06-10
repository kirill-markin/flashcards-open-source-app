import { createHash, randomUUID } from "node:crypto";
import {
  transactionWithUserScope,
  type DatabaseExecutor,
  type UserDatabaseScope,
} from "../database";
import {
  getAnonymousDisplayNameWordPools,
  type AnonymousDisplayNameWordPools,
} from "./anonymousDisplayNames";

export const publicProfileCreateMaxAttempts = 24;

export type PublicProfile = Readonly<{
  publicProfileId: string;
  anonymousDisplayName: string;
  leaderboardParticipationEnabled: boolean;
}>;

type PublicProfileRow = Readonly<{
  public_profile_id: string;
  leaderboard_participation_enabled: boolean;
}>;

type UserScopedTransactionFn = <Result>(
  scope: UserDatabaseScope,
  callback: (executor: DatabaseExecutor) => Promise<Result>,
) => Promise<Result>;

export type PublicProfileServiceDependencies = Readonly<{
  transactionWithUserScopeFn: UserScopedTransactionFn;
  randomUuidFn: () => string;
  resolveDisplayNameWordPoolsFn: (localeHint: string) => AnonymousDisplayNameWordPools;
  maxCreateAttempts: number;
}>;

export class PublicProfileDisplayNamePoolError extends Error {
  readonly name = "PublicProfileDisplayNamePoolError";
  readonly poolName: "prefix" | "adjective" | "noun";

  constructor(poolName: "prefix" | "adjective" | "noun") {
    super(`Anonymous display-name ${poolName} pool must not be empty.`);
    this.poolName = poolName;
  }
}

export class PublicProfileIdCollisionLimitError extends Error {
  readonly name = "PublicProfileIdCollisionLimitError";
  readonly maxCreateAttempts: number;

  constructor(maxCreateAttempts: number) {
    super(`Public profile id generation collided or raced ${maxCreateAttempts} times.`);
    this.maxCreateAttempts = maxCreateAttempts;
  }
}

const defaultPublicProfileServiceDependencies: PublicProfileServiceDependencies = {
  transactionWithUserScopeFn: transactionWithUserScope,
  randomUuidFn: randomUUID,
  resolveDisplayNameWordPoolsFn: getAnonymousDisplayNameWordPools,
  maxCreateAttempts: publicProfileCreateMaxAttempts,
};

function mapPublicProfileRow(
  row: PublicProfileRow,
  localeHint: string,
  dependencies: PublicProfileServiceDependencies,
): PublicProfile {
  return {
    publicProfileId: row.public_profile_id,
    anonymousDisplayName: createAnonymousDisplayName(
      row.public_profile_id,
      dependencies.resolveDisplayNameWordPoolsFn(localeHint),
    ),
    leaderboardParticipationEnabled: row.leaderboard_participation_enabled,
  };
}

function assertValidCreateAttemptLimit(maxCreateAttempts: number): void {
  if (!Number.isInteger(maxCreateAttempts) || maxCreateAttempts < 1) {
    throw new Error(`maxCreateAttempts must be a positive integer, got ${maxCreateAttempts}.`);
  }
}

function readPoolValue(
  pool: ReadonlyArray<string>,
  poolName: "prefix" | "adjective" | "noun",
  index: number,
): string {
  const value = pool[index];
  if (value === undefined || value.trim() === "") {
    throw new Error(`Anonymous display-name ${poolName} pool returned an empty value at index ${index}.`);
  }

  return value;
}

function createDisplayName(prefix: string, adjective: string, noun: string, separator: string): string {
  return [prefix, adjective, noun].join(separator);
}

function readDeterministicPoolValue(
  hash: Buffer,
  offset: number,
  pool: ReadonlyArray<string>,
  poolName: "prefix" | "adjective" | "noun",
): string {
  if (pool.length < 1) {
    throw new PublicProfileDisplayNamePoolError(poolName);
  }

  return readPoolValue(pool, poolName, hash.readUInt32BE(offset) % pool.length);
}

function createAnonymousDisplayName(
  publicProfileId: string,
  wordPools: AnonymousDisplayNameWordPools,
): string {
  const hash = createHash("sha256").update(publicProfileId.toLowerCase(), "utf8").digest();
  const prefix = readDeterministicPoolValue(hash, 0, wordPools.prefixPool, "prefix");
  const adjective = readDeterministicPoolValue(hash, 4, wordPools.adjectivePool, "adjective");
  const noun = readDeterministicPoolValue(hash, 8, wordPools.nounPool, "noun");
  return createDisplayName(prefix, adjective, noun, wordPools.separator);
}

async function readPublicProfileRowForUserInExecutor(
  executor: DatabaseExecutor,
  userId: string,
): Promise<PublicProfileRow | null> {
  const result = await executor.query<PublicProfileRow>(
    [
      "SELECT public_profile_id, leaderboard_participation_enabled",
      "FROM community.public_profiles",
      "WHERE user_id = $1",
      "LIMIT 1",
    ].join(" "),
    [userId],
  );

  return result.rows[0] ?? null;
}

async function insertPublicProfileCandidateRowInExecutor(
  executor: DatabaseExecutor,
  userId: string,
  publicProfileId: string,
): Promise<PublicProfileRow | null> {
  const result = await executor.query<PublicProfileRow>(
    [
      "WITH inserted_profile AS (",
      "INSERT INTO community.public_profiles",
      "(user_id, public_profile_id)",
      "VALUES ($1, $2)",
      "ON CONFLICT DO NOTHING",
      "RETURNING public_profile_id, leaderboard_participation_enabled",
      ")",
      "SELECT public_profile_id, leaderboard_participation_enabled",
      "FROM inserted_profile",
      "UNION ALL",
      "SELECT public_profile_id, leaderboard_participation_enabled",
      "FROM community.public_profiles",
      "WHERE user_id = $1",
      "AND NOT EXISTS (SELECT 1 FROM inserted_profile)",
      "LIMIT 1",
    ].join(" "),
    [userId, publicProfileId],
  );

  return result.rows[0] ?? null;
}

async function ensurePublicProfileRowForUserInExecutor(
  executor: DatabaseExecutor,
  userId: string,
  dependencies: PublicProfileServiceDependencies,
): Promise<PublicProfileRow> {
  assertValidCreateAttemptLimit(dependencies.maxCreateAttempts);

  const existingRow = await readPublicProfileRowForUserInExecutor(executor, userId);
  if (existingRow !== null) {
    return existingRow;
  }

  for (let attempt = 1; attempt <= dependencies.maxCreateAttempts; attempt += 1) {
    const row = await insertPublicProfileCandidateRowInExecutor(executor, userId, dependencies.randomUuidFn());
    if (row !== null) {
      return row;
    }
  }

  throw new PublicProfileIdCollisionLimitError(dependencies.maxCreateAttempts);
}

async function readPublicProfileForUserInExecutor(
  executor: DatabaseExecutor,
  userId: string,
  localeHint: string,
  dependencies: PublicProfileServiceDependencies,
): Promise<PublicProfile | null> {
  const row = await readPublicProfileRowForUserInExecutor(executor, userId);
  return row === null ? null : mapPublicProfileRow(row, localeHint, dependencies);
}

async function ensurePublicProfileForUserInExecutorWithDependencies(
  executor: DatabaseExecutor,
  userId: string,
  localeHint: string,
  dependencies: PublicProfileServiceDependencies,
): Promise<PublicProfile> {
  const row = await ensurePublicProfileRowForUserInExecutor(executor, userId, dependencies);
  return mapPublicProfileRow(row, localeHint, dependencies);
}

export async function ensurePublicProfileForUserWithDependencies(
  userId: string,
  localeHint: string,
  dependencies: PublicProfileServiceDependencies,
): Promise<PublicProfile> {
  return dependencies.transactionWithUserScopeFn({ userId }, async (executor) => (
    ensurePublicProfileForUserInExecutorWithDependencies(executor, userId, localeHint, dependencies)
  ));
}

export async function ensurePublicProfileForUser(userId: string, localeHint: string): Promise<PublicProfile> {
  return ensurePublicProfileForUserWithDependencies(userId, localeHint, defaultPublicProfileServiceDependencies);
}

export class PublicProfileMissingUserScopeError extends Error {
  readonly name = "PublicProfileMissingUserScopeError";

  constructor() {
    super("No authenticated user scope is set for the current public profile operation.");
  }
}

export type CurrentUserPublicProfileId = Readonly<{
  userId: string;
  publicProfileId: string;
}>;

async function selectCurrentUserIdInExecutor(executor: DatabaseExecutor): Promise<string> {
  const result = await executor.query<Readonly<{ user_id: string | null }>>(
    "SELECT security.current_user_id() AS user_id",
    [],
  );

  const userId = result.rows[0]?.user_id ?? null;
  if (userId === null || userId === "") {
    throw new PublicProfileMissingUserScopeError();
  }

  return userId;
}

/**
 * Ensures and returns the stable public_profile_id for the currently scoped user
 * without computing or storing any display name. Same-transaction fact writes use
 * this so authorship and the opaque identity are captured from the authenticated
 * request scope, never from mutable replica labels.
 */
export async function ensurePublicProfileIdForCurrentUserInExecutorWithDependencies(
  executor: DatabaseExecutor,
  dependencies: PublicProfileServiceDependencies,
): Promise<CurrentUserPublicProfileId> {
  const userId = await selectCurrentUserIdInExecutor(executor);
  const row = await ensurePublicProfileRowForUserInExecutor(executor, userId, dependencies);
  return {
    userId,
    publicProfileId: row.public_profile_id,
  };
}

export async function ensurePublicProfileIdForCurrentUserInExecutor(
  executor: DatabaseExecutor,
): Promise<CurrentUserPublicProfileId> {
  return ensurePublicProfileIdForCurrentUserInExecutorWithDependencies(
    executor,
    defaultPublicProfileServiceDependencies,
  );
}

export async function readPublicProfileForUserWithDependencies(
  userId: string,
  localeHint: string,
  dependencies: PublicProfileServiceDependencies,
): Promise<PublicProfile | null> {
  return dependencies.transactionWithUserScopeFn({ userId }, async (executor) => (
    readPublicProfileForUserInExecutor(executor, userId, localeHint, dependencies)
  ));
}

export async function readPublicProfileForUser(userId: string, localeHint: string): Promise<PublicProfile | null> {
  return readPublicProfileForUserWithDependencies(userId, localeHint, defaultPublicProfileServiceDependencies);
}

export async function updateLeaderboardParticipationWithDependencies(
  userId: string,
  leaderboardParticipationEnabled: boolean,
  localeHint: string,
  dependencies: PublicProfileServiceDependencies,
): Promise<PublicProfile> {
  return dependencies.transactionWithUserScopeFn({ userId }, async (executor) => {
    await ensurePublicProfileForUserInExecutorWithDependencies(executor, userId, localeHint, dependencies);
    const result = await executor.query<PublicProfileRow>(
      [
        "UPDATE community.public_profiles",
        "SET leaderboard_participation_enabled = $2, updated_at = now()",
        "WHERE user_id = $1",
        "RETURNING public_profile_id, leaderboard_participation_enabled",
      ].join(" "),
      [userId, leaderboardParticipationEnabled],
    );

    const row = result.rows[0];
    if (row === undefined) {
      throw new Error(`Failed to update community public profile for user ${userId}.`);
    }

    return mapPublicProfileRow(row, localeHint, dependencies);
  });
}

export async function updateLeaderboardParticipation(
  userId: string,
  leaderboardParticipationEnabled: boolean,
  localeHint: string,
): Promise<PublicProfile> {
  return updateLeaderboardParticipationWithDependencies(
    userId,
    leaderboardParticipationEnabled,
    localeHint,
    defaultPublicProfileServiceDependencies,
  );
}
