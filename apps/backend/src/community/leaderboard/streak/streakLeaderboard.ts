import {
  applyUserDatabaseScopeInExecutor,
  type DatabaseExecutor,
} from "../../../database";
import { unsafeTransaction } from "../../../database/unsafe";
import type { AuthTransport } from "../../../auth";
import {
  createAnonymousDisplayName,
  ensurePublicProfileForCurrentUserInExecutor,
} from "../../publicProfiles";
import {
  getAnonymousDisplayNameWordPools,
  resolveAnonymousDisplayNameLocale,
  type AnonymousDisplayNameLocale,
} from "../../anonymousDisplayNames";
import { STREAK_LEADERBOARD_SNAPSHOT_METRIC_VERSION } from "./streakLeaderboardSnapshots";

/**
 * Client-facing streak leaderboard read.
 *
 * The daily job writes tie-neutral base orderings into
 * community.streak_leaderboard_snapshots / _entries. This module derives the
 * viewer-perspective ranking, compact row list, and locale-derived anonymous
 * names at read time. Privacy contract: only opaque public_profile_ids and
 * display names leave this module. Internal user ids, emails, raw dates beyond
 * the public snapshot date, and base_sort_position are never serialized.
 */

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const DAILY_REFRESH_UTC_HOUR = 12;

const STREAK_LEADERBOARD_VIEWER_DISPLAY_NAME = "You" as const;

export const STREAK_LEADERBOARD_STATUSES = [
  "ready",
  "linked_account_required",
  "participation_disabled",
  "snapshot_unavailable",
] as const;

export type StreakLeaderboardStatus = (typeof STREAK_LEADERBOARD_STATUSES)[number];
export type StreakLeaderboardNonReadyStatus = Exclude<StreakLeaderboardStatus, "ready">;

export const STREAK_LEADERBOARD_ROW_KINDS = [
  "top",
  "neighbor",
  "viewer",
  "gap",
] as const;

export type StreakLeaderboardRowKind = (typeof STREAK_LEADERBOARD_ROW_KINDS)[number];

export type StreakLeaderboardMetric = Readonly<{
  metricVersion: typeof STREAK_LEADERBOARD_SNAPSHOT_METRIC_VERSION;
  title: string;
  description: string;
}>;

export type StreakLeaderboardViewer = Readonly<{
  publicProfileId: string;
  displayName: typeof STREAK_LEADERBOARD_VIEWER_DISPLAY_NAME;
  rank: number;
  streakDays: number;
}>;

export type StreakLeaderboardParticipantRow = Readonly<{
  kind: "top" | "neighbor" | "viewer";
  publicProfileId: string;
  anonymousDisplayName: string;
  friendDisplayName?: string;
  streakDays: number;
  rank: number;
}>;

export type StreakLeaderboardGapRow = Readonly<{
  kind: "gap";
}>;

export type StreakLeaderboardRow = StreakLeaderboardParticipantRow | StreakLeaderboardGapRow;

export type StreakLeaderboardRankingRow = Readonly<{
  kind: "participant" | "viewer";
  publicProfileId: string;
  anonymousDisplayName: string;
  friendDisplayName?: string;
  streakDays: number;
  rank: number;
}>;

export type StreakLeaderboardReady = Readonly<{
  status: "ready";
  metric: StreakLeaderboardMetric;
  snapshotId: string;
  snapshotGeneratedAt: string;
  asOfUtcDate: string;
  nextRefreshAfter: string;
  participantCount: number;
  viewer: StreakLeaderboardViewer;
  rows: ReadonlyArray<StreakLeaderboardRow>;
  rankingRows: ReadonlyArray<StreakLeaderboardRankingRow>;
}>;

export type StreakLeaderboardNonReady = Readonly<{
  status: StreakLeaderboardNonReadyStatus;
  metric: StreakLeaderboardMetric;
}>;

export type StreakLeaderboard = StreakLeaderboardReady | StreakLeaderboardNonReady;

export type StreakLeaderboardRequest = Readonly<{
  userId: string;
  transport: AuthTransport;
  localeHint: string;
}>;

type StreakLeaderboardMetricCopy = Readonly<{
  title: string;
  description: string;
}>;

const STREAK_LEADERBOARD_METRIC_COPY_BY_LOCALE: Readonly<
  Record<AnonymousDisplayNameLocale, StreakLeaderboardMetricCopy>
> = {
  en: {
    title: "Current streak days",
    description: "A streak day is a local day with at least one card review rated Again, Hard, Good, or Easy. Ranks use current streak days from the public daily snapshot; public values can trail your live personal streak.",
  },
  ar: {
    title: "أيام السلسلة الحالية",
    description: "يوم السلسلة هو يوم محلي يحتوي على مراجعة بطاقة واحدة على الأقل بتقييم مرة أخرى أو صعب أو جيد أو سهل. يستخدم الترتيب أيام السلسلة الحالية من اللقطة العامة اليومية؛ قد تتأخر القيم العامة عن سلسلتك الشخصية المباشرة.",
  },
  "zh-Hans": {
    title: "当前连续天数",
    description: "连续记录日是至少有一次卡片复习被评为重来、困难、良好或简单的本地日。排名使用公共每日快照中的当前连续天数；公共数值可能落后于你的实时个人连续记录。",
  },
  de: {
    title: "Aktuelle Serien-Tage",
    description: "Ein Serien-Tag ist ein lokaler Tag mit mindestens einer Kartenabfrage, die mit Nochmal, Schwer, Gut oder Leicht bewertet wurde. Ränge verwenden aktuelle Serien-Tage aus dem öffentlichen täglichen Snapshot; öffentliche Werte können deiner aktuellen persönlichen Serie hinterherhinken.",
  },
  hi: {
    title: "मौजूदा स्ट्रीक दिन",
    description: "स्ट्रीक दिन वह स्थानीय दिन है जिसमें कम से कम एक कार्ड समीक्षा को फिर से, कठिन, अच्छा या आसान रेट किया गया हो। रैंक सार्वजनिक दैनिक स्नैपशॉट के मौजूदा स्ट्रीक दिनों का उपयोग करती है; सार्वजनिक मान आपकी लाइव निजी स्ट्रीक से पीछे रह सकते हैं।",
  },
  ja: {
    title: "現在の連続日数",
    description: "連続日とは、少なくとも1回のカード復習がもう一度、難しい、良い、簡単のいずれかで評価されたローカル日です。順位は公開の日次スナップショットの現在の連続日数を使います。公開値は個人の最新連続記録より遅れることがあります。",
  },
  ru: {
    title: "Текущая серия в днях",
    description: "День серии считается локальным днем, когда хотя бы один повтор карточки был оценен как Снова, Трудно, Хорошо или Легко. Рейтинг использует текущую серию в днях из публичного ежедневного снимка; публичные значения могут отставать от вашей личной серии в реальном времени.",
  },
  "es-MX": {
    title: "Días de racha actual",
    description: "Un día de racha es un día local con al menos un repaso de tarjeta calificado como Otra vez, Difícil, Bien o Fácil. La clasificación usa los días de racha actual de la captura pública diaria; los valores públicos pueden ir detrás de tu racha personal en vivo.",
  },
  "es-ES": {
    title: "Días de racha actual",
    description: "Un día de racha es un día local con al menos un repaso de tarjeta valorado como Otra vez, Difícil, Bien o Fácil. La clasificación usa los días de racha actual de la captura pública diaria; los valores públicos pueden ir por detrás de tu racha personal en vivo.",
  },
};

type StreakLeaderboardSnapshotEntry = Readonly<{
  publicProfileId: string;
  streakDays: number;
  baseSortPosition: number;
}>;

type StreakLeaderboardSnapshotHeader = Readonly<{
  snapshotId: string;
  generatedAt: string;
  asOfUtcDate: string;
}>;

type RankedParticipant = Readonly<{
  publicProfileId: string;
  streakDays: number;
  rank: number;
  isViewer: boolean;
}>;

type ViewerPerspectiveRanking = Readonly<{
  ranked: ReadonlyArray<RankedParticipant>;
  viewerRank: number;
  viewerStreakDays: number;
}>;

type StreakLeaderboardSnapshotHeaderRow = Readonly<{
  snapshot_id: string;
  generated_at: Date | string;
  as_of_utc_date: Date | string;
}>;

type StreakLeaderboardSnapshotEntryRow = Readonly<{
  public_profile_id: string;
  streak_days: number | string;
  base_sort_position: number | string;
}>;

type StreakLeaderboardFriendDisplayNameRow = Readonly<{
  friend_public_profile_id: string;
  friend_display_name: string;
}>;

function resolveStreakLeaderboardMetric(localeHint: string): StreakLeaderboardMetric {
  const copy = STREAK_LEADERBOARD_METRIC_COPY_BY_LOCALE[resolveAnonymousDisplayNameLocale(localeHint)];
  return {
    metricVersion: STREAK_LEADERBOARD_SNAPSHOT_METRIC_VERSION,
    title: copy.title,
    description: copy.description,
  };
}

function buildNonReadyStreakLeaderboard(
  status: StreakLeaderboardNonReadyStatus,
  localeHint: string,
): StreakLeaderboardNonReady {
  return {
    status,
    metric: resolveStreakLeaderboardMetric(localeHint),
  };
}

function assertStreakLeaderboardReadTransport(transport: AuthTransport): void {
  if (transport !== "session" && transport !== "bearer" && transport !== "none") {
    throw new Error(
      `Streak leaderboard read requires a signed-in human transport, received ${transport}.`,
    );
  }
}

function normalizeTimestamp(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid streak leaderboard snapshot timestamp: ${String(value)}`);
  }

  return date.toISOString();
}

function normalizeUtcDate(value: Date | string): string {
  const utcDate = value instanceof Date ? value.toISOString().slice(0, 10) : value;
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(utcDate)) {
    throw new Error(`Invalid streak leaderboard UTC date: ${String(value)}`);
  }

  const parsed = new Date(`${utcDate}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== utcDate) {
    throw new Error(`Invalid streak leaderboard UTC date: ${String(value)}`);
  }

  return utcDate;
}

function normalizeNonNegativeInteger(value: number | string, field: string): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid non-negative integer for ${field}: ${String(value)}`);
  }

  return parsed;
}

function normalizePositiveInteger(value: number | string, field: string): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`Invalid positive integer for ${field}: ${String(value)}`);
  }

  return parsed;
}

function normalizeFriendDisplayName(value: string, publicProfileId: string): string {
  const displayNameLength = Array.from(value.trim()).length;
  if (displayNameLength < 1 || displayNameLength > 30 || /[\u0000-\u001F\u007F]/u.test(value)) {
    throw new Error(`Invalid friend display name for public profile ${publicProfileId}.`);
  }

  return value;
}

function computeNextRefreshAfter(generatedAt: string): string {
  const generatedAtDate = new Date(generatedAt);
  if (Number.isNaN(generatedAtDate.getTime())) {
    throw new Error(`Invalid streak leaderboard snapshot generatedAt: ${generatedAt}`);
  }

  const sameDayRefresh = Date.UTC(
    generatedAtDate.getUTCFullYear(),
    generatedAtDate.getUTCMonth(),
    generatedAtDate.getUTCDate(),
    DAILY_REFRESH_UTC_HOUR,
    0,
    0,
    0,
  );
  const nextRefresh = sameDayRefresh > generatedAtDate.getTime()
    ? sameDayRefresh
    : sameDayRefresh + MILLISECONDS_PER_DAY;

  return new Date(nextRefresh).toISOString();
}

/**
 * The streak leaderboard favors the viewer inside ties: equal-streak non-viewers
 * keep their stored base order, but the viewer is inserted before every other
 * participant with the same streakDays value.
 */
function findViewerInsertionIndex(
  others: ReadonlyArray<StreakLeaderboardSnapshotEntry>,
  viewerStreakDays: number,
): number {
  const index = others.findIndex((entry) => entry.streakDays <= viewerStreakDays);
  return index === -1 ? others.length : index;
}

function buildViewerPerspectiveRanking(
  entries: ReadonlyArray<StreakLeaderboardSnapshotEntry>,
  viewerPublicProfileId: string,
): ViewerPerspectiveRanking {
  const viewerEntry = entries.find((entry) => entry.publicProfileId === viewerPublicProfileId) ?? null;
  const viewerStreakDays = viewerEntry === null ? 0 : viewerEntry.streakDays;
  const others = entries
    .filter((entry) => entry.publicProfileId !== viewerPublicProfileId)
    .sort((left, right) => left.baseSortPosition - right.baseSortPosition);

  const viewerInsertionIndex = findViewerInsertionIndex(others, viewerStreakDays);
  const ordered: Array<Readonly<{ publicProfileId: string; streakDays: number; isViewer: boolean }>> = [];
  others.forEach((entry, index) => {
    if (index === viewerInsertionIndex) {
      ordered.push({ publicProfileId: viewerPublicProfileId, streakDays: viewerStreakDays, isViewer: true });
    }

    ordered.push({
      publicProfileId: entry.publicProfileId,
      streakDays: entry.streakDays,
      isViewer: false,
    });
  });
  if (viewerInsertionIndex === others.length) {
    ordered.push({ publicProfileId: viewerPublicProfileId, streakDays: viewerStreakDays, isViewer: true });
  }

  const ranked: ReadonlyArray<RankedParticipant> = ordered.map((participant, index) => ({
    ...participant,
    rank: index + 1,
  }));
  const viewerRank = ranked.find((participant) => participant.isViewer)?.rank ?? ranked.length;

  return { ranked, viewerRank, viewerStreakDays };
}

function buildParticipantRow(
  participant: RankedParticipant,
  topRowCount: number,
  resolveName: (publicProfileId: string) => string,
  friendDisplayNamesByPublicProfileId: ReadonlyMap<string, string>,
): StreakLeaderboardParticipantRow {
  const kind: "top" | "neighbor" | "viewer" = participant.isViewer
    ? "viewer"
    : participant.rank <= topRowCount
      ? "top"
      : "neighbor";
  const friendDisplayName = friendDisplayNamesByPublicProfileId.get(participant.publicProfileId);

  return {
    kind,
    publicProfileId: participant.publicProfileId,
    anonymousDisplayName: resolveName(participant.publicProfileId),
    ...(friendDisplayName === undefined ? {} : { friendDisplayName }),
    streakDays: participant.streakDays,
    rank: participant.rank,
  };
}

function buildRankingRow(
  participant: RankedParticipant,
  resolveName: (publicProfileId: string) => string,
  friendDisplayNamesByPublicProfileId: ReadonlyMap<string, string>,
): StreakLeaderboardRankingRow {
  const friendDisplayName = friendDisplayNamesByPublicProfileId.get(participant.publicProfileId);

  return {
    kind: participant.isViewer ? "viewer" : "participant",
    publicProfileId: participant.publicProfileId,
    anonymousDisplayName: resolveName(participant.publicProfileId),
    ...(friendDisplayName === undefined ? {} : { friendDisplayName }),
    streakDays: participant.streakDays,
    rank: participant.rank,
  };
}

function buildRankingRows(
  ranked: ReadonlyArray<RankedParticipant>,
  resolveName: (publicProfileId: string) => string,
  friendDisplayNamesByPublicProfileId: ReadonlyMap<string, string>,
): ReadonlyArray<StreakLeaderboardRankingRow> {
  return ranked.map((participant) => (
    buildRankingRow(participant, resolveName, friendDisplayNamesByPublicProfileId)
  ));
}

function buildCompactRows(
  ranked: ReadonlyArray<RankedParticipant>,
  viewerRank: number,
  resolveName: (publicProfileId: string) => string,
  friendDisplayNamesByPublicProfileId: ReadonlyMap<string, string>,
): ReadonlyArray<StreakLeaderboardRow> {
  const total = ranked.length;
  const topRowCount = Math.min(3, total);

  const shownRanks = new Set<number>();
  for (let rank = 1; rank <= topRowCount; rank += 1) {
    shownRanks.add(rank);
  }
  if (viewerRank > topRowCount) {
    for (const candidate of [viewerRank - 1, viewerRank, viewerRank + 1]) {
      if (candidate >= 1 && candidate <= total) {
        shownRanks.add(candidate);
      }
    }
  } else if (viewerRank === topRowCount && viewerRank < total) {
    shownRanks.add(viewerRank + 1);
  }
  if (total > topRowCount) {
    shownRanks.add(total);
  }
  for (const participant of ranked) {
    if (friendDisplayNamesByPublicProfileId.has(participant.publicProfileId)) {
      shownRanks.add(participant.rank);
    }
  }

  const orderedRanks = [...shownRanks].sort((left, right) => left - right);
  const rows: Array<StreakLeaderboardRow> = [];
  let previousRank = 0;
  for (const rank of orderedRanks) {
    if (previousRank !== 0 && rank > previousRank + 1) {
      rows.push({ kind: "gap" });
    }

    const participant = ranked[rank - 1];
    if (participant === undefined) {
      throw new Error(`Missing ranked streak participant for rank ${rank}.`);
    }

    rows.push(buildParticipantRow(participant, topRowCount, resolveName, friendDisplayNamesByPublicProfileId));
    previousRank = rank;
  }

  if (previousRank < total) {
    rows.push({ kind: "gap" });
  }

  return rows;
}

function buildReadyStreakLeaderboard(
  header: StreakLeaderboardSnapshotHeader,
  entries: ReadonlyArray<StreakLeaderboardSnapshotEntry>,
  viewerPublicProfileId: string,
  metric: StreakLeaderboardMetric,
  resolveName: (publicProfileId: string) => string,
  friendDisplayNamesByPublicProfileId: ReadonlyMap<string, string>,
): StreakLeaderboardReady {
  const ranking = buildViewerPerspectiveRanking(entries, viewerPublicProfileId);

  return {
    status: "ready",
    metric,
    snapshotId: header.snapshotId,
    snapshotGeneratedAt: header.generatedAt,
    asOfUtcDate: header.asOfUtcDate,
    nextRefreshAfter: computeNextRefreshAfter(header.generatedAt),
    participantCount: ranking.ranked.length,
    viewer: {
      publicProfileId: viewerPublicProfileId,
      displayName: STREAK_LEADERBOARD_VIEWER_DISPLAY_NAME,
      rank: ranking.viewerRank,
      streakDays: ranking.viewerStreakDays,
    },
    rows: buildCompactRows(
      ranking.ranked,
      ranking.viewerRank,
      resolveName,
      friendDisplayNamesByPublicProfileId,
    ),
    rankingRows: buildRankingRows(ranking.ranked, resolveName, friendDisplayNamesByPublicProfileId),
  };
}

async function readLatestStreakLeaderboardSnapshotHeaderInExecutor(
  executor: DatabaseExecutor,
): Promise<StreakLeaderboardSnapshotHeader | null> {
  const result = await executor.query<StreakLeaderboardSnapshotHeaderRow>(
    [
      "SELECT",
      "snapshots.snapshot_id::text AS snapshot_id,",
      "snapshots.generated_at AS generated_at,",
      "snapshots.as_of_utc_date AS as_of_utc_date",
      "FROM community.streak_leaderboard_snapshots AS snapshots",
      "WHERE snapshots.metric_version = $1",
      "ORDER BY snapshots.as_of_utc_date DESC",
      "LIMIT 1",
    ].join(" "),
    [STREAK_LEADERBOARD_SNAPSHOT_METRIC_VERSION],
  );

  const row = result.rows[0];
  if (row === undefined) {
    return null;
  }

  return {
    snapshotId: row.snapshot_id,
    generatedAt: normalizeTimestamp(row.generated_at),
    asOfUtcDate: normalizeUtcDate(row.as_of_utc_date),
  };
}

async function readStreakLeaderboardSnapshotEntriesInExecutor(
  executor: DatabaseExecutor,
  snapshotId: string,
): Promise<ReadonlyArray<StreakLeaderboardSnapshotEntry>> {
  const result = await executor.query<StreakLeaderboardSnapshotEntryRow>(
    [
      "SELECT",
      "entries.public_profile_id::text AS public_profile_id,",
      "entries.streak_days AS streak_days,",
      "entries.base_sort_position AS base_sort_position",
      "FROM community.streak_leaderboard_snapshot_entries AS entries",
      "WHERE entries.snapshot_id = $1::uuid",
      "ORDER BY entries.base_sort_position ASC",
    ].join(" "),
    [snapshotId],
  );

  return result.rows.map((row) => ({
    publicProfileId: row.public_profile_id,
    streakDays: normalizeNonNegativeInteger(row.streak_days, "streak_days"),
    baseSortPosition: normalizePositiveInteger(row.base_sort_position, "base_sort_position"),
  }));
}

async function readViewerFriendDisplayNamesInExecutor(
  executor: DatabaseExecutor,
): Promise<ReadonlyMap<string, string>> {
  const result = await executor.query<StreakLeaderboardFriendDisplayNameRow>(
    [
      "SELECT",
      "friend_labels.friend_public_profile_id::text AS friend_public_profile_id,",
      "friend_labels.friend_display_name AS friend_display_name",
      "FROM community.read_current_user_leaderboard_friend_labels() AS friend_labels",
      "ORDER BY friend_labels.friend_public_profile_id",
    ].join(" "),
    [],
  );

  const friendDisplayNamesByPublicProfileId = new Map<string, string>();
  for (const row of result.rows) {
    friendDisplayNamesByPublicProfileId.set(
      row.friend_public_profile_id,
      normalizeFriendDisplayName(row.friend_display_name, row.friend_public_profile_id),
    );
  }

  return friendDisplayNamesByPublicProfileId;
}

export async function loadStreakLeaderboardInExecutor(
  executor: DatabaseExecutor,
  request: StreakLeaderboardRequest,
): Promise<StreakLeaderboard> {
  assertStreakLeaderboardReadTransport(request.transport);

  const metric = resolveStreakLeaderboardMetric(request.localeHint);
  await applyUserDatabaseScopeInExecutor(executor, { userId: request.userId });

  const viewerProfile = await ensurePublicProfileForCurrentUserInExecutor(executor);
  if (!viewerProfile.leaderboardParticipationEnabled) {
    return buildNonReadyStreakLeaderboard("participation_disabled", request.localeHint);
  }

  const snapshotHeader = await readLatestStreakLeaderboardSnapshotHeaderInExecutor(executor);
  if (snapshotHeader === null) {
    return buildNonReadyStreakLeaderboard("snapshot_unavailable", request.localeHint);
  }

  const friendDisplayNamesByPublicProfileId = await readViewerFriendDisplayNamesInExecutor(executor);
  const entries = await readStreakLeaderboardSnapshotEntriesInExecutor(executor, snapshotHeader.snapshotId);
  const wordPools = getAnonymousDisplayNameWordPools(request.localeHint);
  const resolveName = (publicProfileId: string): string => createAnonymousDisplayName(publicProfileId, wordPools);

  return buildReadyStreakLeaderboard(
    snapshotHeader,
    entries,
    viewerProfile.publicProfileId,
    metric,
    resolveName,
    friendDisplayNamesByPublicProfileId,
  );
}

export async function loadStreakLeaderboard(
  request: StreakLeaderboardRequest,
): Promise<StreakLeaderboard> {
  if (request.transport === "guest") {
    return buildNonReadyStreakLeaderboard("linked_account_required", request.localeHint);
  }

  return unsafeTransaction(
    async (executor) => loadStreakLeaderboardInExecutor(executor, request),
  );
}
