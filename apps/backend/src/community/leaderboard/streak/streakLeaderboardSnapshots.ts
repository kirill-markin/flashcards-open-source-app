import { unsafeRepeatableReadTransaction } from "../../../database/unsafe";
import { type DatabaseExecutor } from "../../../database";
import { formatDateAsTimeZoneLocalDate, requireIanaTimeZone } from "../../../progress/timeZone";
import { evaluateStreakFreeze, streakFreezePolicy } from "../../../progress/streakFreeze";

export const STREAK_LEADERBOARD_SNAPSHOT_METRIC_VERSION = "streak_days_v1";
export const STREAK_LEADERBOARD_SNAPSHOT_BATCH_SIZE = 500;

type WithTransactionFn = <Result>(
  callback: (executor: DatabaseExecutor) => Promise<Result>,
) => Promise<Result>;

export type StreakLeaderboardParticipant = Readonly<{
  publicProfileId: string;
  userId: string;
  progressTimeZone: string;
}>;

export type StreakLeaderboardActiveReviewLocalDate = Readonly<{
  reviewedByUserId: string;
  localDate: string;
}>;

export type StreakLeaderboardSnapshotEntry = Readonly<{
  publicProfileId: string;
  streakDays: number;
  baseSortPosition: number;
}>;

export type StreakLeaderboardSnapshotRunResult = Readonly<{
  metricVersion: string;
  generatedAt: string;
  asOfUtcDate: string;
  snapshotId: string;
  pagesScanned: number;
  participantsScanned: number;
  entryCount: number;
}>;

type ListStreakLeaderboardParticipantsParams = Readonly<{
  afterPublicProfileId: string | null;
  limit: number;
}>;

type ListStreakLeaderboardParticipantsFn = (
  executor: DatabaseExecutor,
  params: ListStreakLeaderboardParticipantsParams,
) => Promise<ReadonlyArray<StreakLeaderboardParticipant>>;

type ListStreakLeaderboardActiveReviewLocalDatesFn = (
  executor: DatabaseExecutor,
  userIds: ReadonlyArray<string>,
) => Promise<ReadonlyArray<StreakLeaderboardActiveReviewLocalDate>>;

type UpsertStreakLeaderboardSnapshotFn = (
  executor: DatabaseExecutor,
  metricVersion: string,
  asOfUtcDate: string,
  generatedAt: string,
) => Promise<string>;

type ReplaceStreakLeaderboardSnapshotEntriesFn = (
  executor: DatabaseExecutor,
  snapshotId: string,
  entries: ReadonlyArray<StreakLeaderboardSnapshotEntry>,
) => Promise<number>;

export type GenerateStreakLeaderboardSnapshotsDependencies = Readonly<{
  metricVersion: string;
  batchSize: number;
  now: () => Date;
  withTransactionFn: WithTransactionFn;
  listParticipantsFn: ListStreakLeaderboardParticipantsFn;
  listActiveReviewLocalDatesFn: ListStreakLeaderboardActiveReviewLocalDatesFn;
  upsertSnapshotFn: UpsertStreakLeaderboardSnapshotFn;
  replaceSnapshotEntriesFn: ReplaceStreakLeaderboardSnapshotEntriesFn;
}>;

type StreakLeaderboardParticipantRow = Readonly<{
  public_profile_id: unknown;
  user_id: unknown;
  progress_time_zone: unknown;
}>;

type StreakLeaderboardActiveReviewLocalDateRow = Readonly<{
  reviewed_by_user_id: unknown;
  local_date: unknown;
}>;

type StreakLeaderboardSnapshotIdRow = Readonly<{
  snapshot_id: unknown;
}>;

type ReplacedStreakLeaderboardSnapshotEntriesRow = Readonly<{
  inserted_entries: unknown;
}>;

type StreakLeaderboardSnapshotComputation = Readonly<{
  entries: ReadonlyArray<StreakLeaderboardSnapshotEntry>;
  pagesScanned: number;
  participantsScanned: number;
}>;

const localDatePattern = /^\d{4}-\d{2}-\d{2}$/;

function normalizeRequiredDatabaseString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value === "") {
    throw new Error(`Database ${fieldName} must be a non-empty string.`);
  }

  return value;
}

function normalizeNonNegativeDatabaseInteger(value: unknown, fieldName: string): number {
  const parsedValue = typeof value === "number" ? value : (
    typeof value === "string" ? Number.parseInt(value, 10) : Number.NaN
  );
  if (!Number.isInteger(parsedValue) || parsedValue < 0) {
    throw new Error(`Database ${fieldName} must be a non-negative integer: ${String(value)}`);
  }

  return parsedValue;
}

function normalizeLocalDate(value: unknown, fieldName: string): string {
  const localDate = normalizeRequiredDatabaseString(value, fieldName);
  if (!localDatePattern.test(localDate)) {
    throw new Error(`Database ${fieldName} must be a YYYY-MM-DD date: ${localDate}`);
  }

  const parsedDate = new Date(`${localDate}T00:00:00.000Z`);
  if (Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== localDate) {
    throw new Error(`Database ${fieldName} must be a valid YYYY-MM-DD date: ${localDate}`);
  }

  return localDate;
}

function normalizeGeneratedAtDate(value: Date): Date {
  if (Number.isNaN(value.getTime())) {
    throw new Error("Streak leaderboard snapshot clock returned an invalid Date.");
  }

  return value;
}

function formatUtcDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function normalizeBatchSize(batchSize: number): number {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1000) {
    throw new Error(`Streak leaderboard snapshot batchSize must be an integer between 1 and 1000: ${batchSize}`);
  }

  return batchSize;
}

function normalizeParticipantRow(row: StreakLeaderboardParticipantRow): StreakLeaderboardParticipant {
  const publicProfileId = normalizeRequiredDatabaseString(row.public_profile_id, "public_profile_id");
  return {
    publicProfileId,
    userId: normalizeRequiredDatabaseString(row.user_id, "user_id"),
    progressTimeZone: requireIanaTimeZone(
      normalizeRequiredDatabaseString(row.progress_time_zone, "progress_time_zone"),
      `progress_time_zone for publicProfileId=${publicProfileId}`,
    ),
  };
}

function normalizeActiveReviewLocalDateRow(
  row: StreakLeaderboardActiveReviewLocalDateRow,
): StreakLeaderboardActiveReviewLocalDate {
  return {
    reviewedByUserId: normalizeRequiredDatabaseString(row.reviewed_by_user_id, "reviewed_by_user_id"),
    localDate: normalizeLocalDate(row.local_date, "local_date"),
  };
}

function groupActiveReviewLocalDatesByUser(
  rows: ReadonlyArray<StreakLeaderboardActiveReviewLocalDate>,
): ReadonlyMap<string, ReadonlyArray<string>> {
  const datesByUser = new Map<string, Array<string>>();
  for (const row of rows) {
    const userDates = datesByUser.get(row.reviewedByUserId) ?? [];
    userDates.push(row.localDate);
    datesByUser.set(row.reviewedByUserId, userDates);
  }

  for (const [userId, localDates] of datesByUser.entries()) {
    datesByUser.set(userId, [...localDates].sort((left, right) => left.localeCompare(right)));
  }

  return datesByUser;
}

function createUnpositionedEntriesForPage(
  participants: ReadonlyArray<StreakLeaderboardParticipant>,
  activeReviewLocalDatesByUser: ReadonlyMap<string, ReadonlyArray<string>>,
  generatedAtDate: Date,
): ReadonlyArray<Readonly<{ publicProfileId: string; streakDays: number }>> {
  return participants.map((participant) => {
    const today = formatDateAsTimeZoneLocalDate(generatedAtDate, participant.progressTimeZone);
    const activeReviewLocalDates = activeReviewLocalDatesByUser.get(participant.userId) ?? [];
    const evaluation = evaluateStreakFreeze(
      activeReviewLocalDates,
      today,
      streakFreezePolicy,
    );

    return {
      publicProfileId: participant.publicProfileId,
      streakDays: evaluation.currentStreakDays,
    };
  });
}

function addBaseSortPositions(
  entries: ReadonlyArray<Readonly<{ publicProfileId: string; streakDays: number }>>,
): ReadonlyArray<StreakLeaderboardSnapshotEntry> {
  // TODO: Add a bounded lookback or checkpoint path if active-day volume makes full-history evaluation too expensive.
  return [...entries]
    .sort((left, right) => {
      if (left.streakDays !== right.streakDays) {
        return right.streakDays - left.streakDays;
      }

      return left.publicProfileId.localeCompare(right.publicProfileId);
    })
    .map((entry, index) => ({
      publicProfileId: entry.publicProfileId,
      streakDays: entry.streakDays,
      baseSortPosition: index + 1,
    }));
}

async function computeStreakLeaderboardSnapshotEntries(
  executor: DatabaseExecutor,
  dependencies: GenerateStreakLeaderboardSnapshotsDependencies,
  generatedAtDate: Date,
  batchSize: number,
): Promise<StreakLeaderboardSnapshotComputation> {
  let afterPublicProfileId: string | null = null;
  let pagesScanned = 0;
  let participantsScanned = 0;
  const unpositionedEntries: Array<Readonly<{ publicProfileId: string; streakDays: number }>> = [];

  while (true) {
    const participantPage = await dependencies.listParticipantsFn(executor, {
      afterPublicProfileId,
      limit: batchSize,
    });
    if (participantPage.length === 0) {
      break;
    }

    pagesScanned += 1;
    participantsScanned += participantPage.length;
    afterPublicProfileId = participantPage[participantPage.length - 1]?.publicProfileId ?? null;

    if (participantPage.length > 0) {
      const activeReviewLocalDates = await dependencies.listActiveReviewLocalDatesFn(
        executor,
        participantPage.map((participant) => participant.userId),
      );
      unpositionedEntries.push(...createUnpositionedEntriesForPage(
        participantPage,
        groupActiveReviewLocalDatesByUser(activeReviewLocalDates),
        generatedAtDate,
      ));
    }

    if (participantPage.length < batchSize) {
      break;
    }
  }

  return {
    entries: addBaseSortPositions(unpositionedEntries),
    pagesScanned,
    participantsScanned,
  };
}

export async function listStreakLeaderboardParticipantsInExecutor(
  executor: DatabaseExecutor,
  params: ListStreakLeaderboardParticipantsParams,
): Promise<ReadonlyArray<StreakLeaderboardParticipant>> {
  const result = await executor.query<StreakLeaderboardParticipantRow>(
    [
      "SELECT public_profile_id, user_id, progress_time_zone",
      "FROM community.list_streak_leaderboard_snapshot_participants($1::uuid, $2::integer)",
    ].join(" "),
    [params.afterPublicProfileId, params.limit],
  );

  return result.rows.map((row) => normalizeParticipantRow(row));
}

export async function listStreakLeaderboardActiveReviewLocalDatesInExecutor(
  executor: DatabaseExecutor,
  userIds: ReadonlyArray<string>,
): Promise<ReadonlyArray<StreakLeaderboardActiveReviewLocalDate>> {
  if (userIds.length === 0) {
    return [];
  }

  const result = await executor.query<StreakLeaderboardActiveReviewLocalDateRow>(
    [
      "SELECT reviewed_by_user_id, local_date",
      "FROM community.list_streak_leaderboard_snapshot_active_days($1::text[])",
    ].join(" "),
    [userIds],
  );

  return result.rows.map((row) => normalizeActiveReviewLocalDateRow(row));
}

export async function upsertStreakLeaderboardSnapshotInExecutor(
  executor: DatabaseExecutor,
  metricVersion: string,
  asOfUtcDate: string,
  generatedAt: string,
): Promise<string> {
  const result = await executor.query<StreakLeaderboardSnapshotIdRow>(
    "SELECT community.upsert_streak_leaderboard_snapshot($1, $2::date, $3) AS snapshot_id",
    [metricVersion, asOfUtcDate, generatedAt],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error(`community.upsert_streak_leaderboard_snapshot returned no row for asOfUtcDate=${asOfUtcDate}.`);
  }

  return normalizeRequiredDatabaseString(row.snapshot_id, "snapshot_id");
}

export async function replaceStreakLeaderboardSnapshotEntriesInExecutor(
  executor: DatabaseExecutor,
  snapshotId: string,
  entries: ReadonlyArray<StreakLeaderboardSnapshotEntry>,
): Promise<number> {
  const result = await executor.query<ReplacedStreakLeaderboardSnapshotEntriesRow>(
    [
      "SELECT community.replace_streak_leaderboard_snapshot_entries(",
      "$1::uuid, $2::uuid[], $3::integer[], $4::integer[]",
      ") AS inserted_entries",
    ].join(" "),
    [
      snapshotId,
      entries.map((entry) => entry.publicProfileId),
      entries.map((entry) => entry.streakDays),
      entries.map((entry) => entry.baseSortPosition),
    ],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error(`community.replace_streak_leaderboard_snapshot_entries returned no row for snapshotId=${snapshotId}.`);
  }

  return normalizeNonNegativeDatabaseInteger(row.inserted_entries, "inserted_entries");
}

export async function generateStreakLeaderboardSnapshotsWithDependencies(
  dependencies: GenerateStreakLeaderboardSnapshotsDependencies,
): Promise<StreakLeaderboardSnapshotRunResult> {
  const batchSize = normalizeBatchSize(dependencies.batchSize);
  const generatedAtDate = normalizeGeneratedAtDate(dependencies.now());
  const generatedAt = generatedAtDate.toISOString();
  const asOfUtcDate = formatUtcDate(generatedAtDate);

  return dependencies.withTransactionFn(async (executor) => {
    const computation = await computeStreakLeaderboardSnapshotEntries(
      executor,
      dependencies,
      generatedAtDate,
      batchSize,
    );
    const snapshotId = await dependencies.upsertSnapshotFn(
      executor,
      dependencies.metricVersion,
      asOfUtcDate,
      generatedAt,
    );
    const insertedEntries = await dependencies.replaceSnapshotEntriesFn(
      executor,
      snapshotId,
      computation.entries,
    );
    if (insertedEntries !== computation.entries.length) {
      throw new Error(
        `Streak leaderboard snapshot entry replacement inserted ${insertedEntries} entries for snapshotId=${snapshotId}; expected ${computation.entries.length}.`,
      );
    }

    return {
      metricVersion: dependencies.metricVersion,
      generatedAt,
      asOfUtcDate,
      snapshotId,
      pagesScanned: computation.pagesScanned,
      participantsScanned: computation.participantsScanned,
      entryCount: insertedEntries,
    };
  });
}

export async function generateStreakLeaderboardSnapshots(): Promise<StreakLeaderboardSnapshotRunResult> {
  return generateStreakLeaderboardSnapshotsWithDependencies({
    metricVersion: STREAK_LEADERBOARD_SNAPSHOT_METRIC_VERSION,
    batchSize: STREAK_LEADERBOARD_SNAPSHOT_BATCH_SIZE,
    now: () => new Date(),
    withTransactionFn: unsafeRepeatableReadTransaction,
    listParticipantsFn: listStreakLeaderboardParticipantsInExecutor,
    listActiveReviewLocalDatesFn: listStreakLeaderboardActiveReviewLocalDatesInExecutor,
    upsertSnapshotFn: upsertStreakLeaderboardSnapshotInExecutor,
    replaceSnapshotEntriesFn: replaceStreakLeaderboardSnapshotEntriesInExecutor,
  });
}
