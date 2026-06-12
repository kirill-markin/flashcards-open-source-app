import {
  applyUserDatabaseScopeInExecutor,
  type DatabaseExecutor,
} from "../../database";
import { unsafeTransaction } from "../../database/unsafe";
import type { AuthTransport } from "../../auth";
import {
  createAnonymousDisplayName,
  ensurePublicProfileForCurrentUserInExecutor,
} from "../publicProfiles";
import {
  getAnonymousDisplayNameWordPools,
  resolveAnonymousDisplayNameLocale,
  type AnonymousDisplayNameLocale,
} from "../anonymousDisplayNames";
import {
  DEFAULT_COMPACT_LEADERBOARD_WINDOW_KEY,
  LEADERBOARD_SNAPSHOT_METRIC_VERSION,
  LEADERBOARD_WINDOW_KEYS,
  assertLeaderboardWindowKey,
  isLeaderboardWindowKey,
  resolveDefaultLeaderboardWindowKey,
  truncateToServerHour,
  type LeaderboardWindowKey,
} from "./leaderboardWindows";

/**
 * Client-facing compact Progress-tab leaderboard read.
 *
 * The hourly job (see leaderboardSnapshots.ts) writes tie-neutral base orderings
 * into community.leaderboard_snapshots / _entries. This module is the read side:
 * it derives the viewer-perspective ranking, the per-viewer tie rule, the compact
 * row window, and the locale-derived anonymous names at read time, and returns
 * every window in one payload so a client never makes one request per segment.
 *
 * Privacy contract: only opaque public_profile_ids and derived display names ever
 * leave this module. Internal user ids, raw review timestamps, and the snapshot
 * base_sort_position are never serialized. Guests and opted-out users receive an
 * explicit status with no other users' rows.
 */

const MILLISECONDS_PER_HOUR = 60 * 60 * 1000;

const PROGRESS_LEADERBOARD_VIEWER_DISPLAY_NAME = "You" as const;

export const PROGRESS_LEADERBOARD_STATUSES = [
  "ready",
  "linked_account_required",
  "participation_disabled",
  "snapshot_unavailable",
] as const;

export type ProgressLeaderboardStatus = (typeof PROGRESS_LEADERBOARD_STATUSES)[number];

export const PROGRESS_LEADERBOARD_ROW_KINDS = [
  "top",
  "neighbor",
  "viewer",
  "gap",
] as const;

export type ProgressLeaderboardRowKind = (typeof PROGRESS_LEADERBOARD_ROW_KINDS)[number];

export type ProgressLeaderboardMetric = Readonly<{
  metricVersion: typeof LEADERBOARD_SNAPSHOT_METRIC_VERSION;
  title: string;
  description: string;
}>;

export type ProgressLeaderboardViewer = Readonly<{
  publicProfileId: string;
  displayName: typeof PROGRESS_LEADERBOARD_VIEWER_DISPLAY_NAME;
  rank: number;
  qualifiedReviewCount: number;
}>;

export type ProgressLeaderboardParticipantRow = Readonly<{
  kind: "top" | "neighbor" | "viewer";
  publicProfileId: string;
  anonymousDisplayName: string;
  qualifiedReviewCount: number;
  rank: number;
}>;

export type ProgressLeaderboardGapRow = Readonly<{
  kind: "gap";
}>;

export type ProgressLeaderboardRow = ProgressLeaderboardParticipantRow | ProgressLeaderboardGapRow;

export type ProgressLeaderboardWindow = Readonly<{
  windowKey: LeaderboardWindowKey;
  snapshotId: string;
  snapshotGeneratedAt: string;
  asOfServerHour: string;
  nextRefreshAfter: string;
  participantCount: number;
  viewer: ProgressLeaderboardViewer;
  rows: ReadonlyArray<ProgressLeaderboardRow>;
}>;

export type ProgressLeaderboard = Readonly<{
  status: ProgressLeaderboardStatus;
  metric: ProgressLeaderboardMetric;
  defaultWindowKey: LeaderboardWindowKey;
  windows: ReadonlyArray<ProgressLeaderboardWindow>;
}>;

export type ProgressLeaderboardRequest = Readonly<{
  userId: string;
  transport: AuthTransport;
  localeHint: string;
}>;

type ProgressLeaderboardMetricCopy = Readonly<{
  title: string;
  description: string;
}>;

// Localized metric copy mirrors the anonymous-display-name locale set so the whole
// payload (names plus metric text) stays consistent for the resolved locale.
const PROGRESS_LEADERBOARD_METRIC_COPY_BY_LOCALE: Readonly<
  Record<AnonymousDisplayNameLocale, ProgressLeaderboardMetricCopy>
> = {
  en: {
    title: "Qualified reviews",
    description: "Hard, Good, and Easy reviews count toward your rank. Again does not.",
  },
  ar: {
    title: "المراجعات المحتسبة",
    description: "تُحتسب مراجعات صعب وجيد وسهل في ترتيبك، أما مرة أخرى فلا تُحتسب.",
  },
  "zh-Hans": {
    title: "有效复习",
    description: "“困难”“良好”“简单”计入排名，“重来”不计入。",
  },
  de: {
    title: "Gewertete Wiederholungen",
    description: "Schwer, Gut und Leicht zählen für deinen Rang. Nochmal zählt nicht.",
  },
  hi: {
    title: "मान्य समीक्षाएँ",
    description: "कठिन, अच्छा और आसान समीक्षाएँ आपकी रैंक में गिनी जाती हैं। फिर से नहीं गिना जाता।",
  },
  ja: {
    title: "有効な復習",
    description: "「難しい」「普通」「簡単」はランクに加算されます。「もう一度」は加算されません。",
  },
  ru: {
    title: "Зачтённые повторения",
    description: "«Трудно», «Хорошо» и «Легко» учитываются в рейтинге. «Снова» не учитывается.",
  },
  "es-MX": {
    title: "Repasos válidos",
    description: "Los repasos Difícil, Bien y Fácil cuentan para tu posición. Otra vez no cuenta.",
  },
  "es-ES": {
    title: "Repasos válidos",
    description: "Los repasos Difícil, Bien y Fácil cuentan para tu posición. Otra vez no cuenta.",
  },
};

type LeaderboardSnapshotEntry = Readonly<{
  publicProfileId: string;
  qualifiedReviewCount: number;
  baseSortPosition: number;
}>;

type LeaderboardSnapshotHeader = Readonly<{
  windowKey: LeaderboardWindowKey;
  snapshotId: string;
  generatedAt: string;
  asOfServerHour: string;
}>;

type RankedParticipant = Readonly<{
  publicProfileId: string;
  qualifiedReviewCount: number;
  rank: number;
  isViewer: boolean;
}>;

type ViewerPerspectiveRanking = Readonly<{
  ranked: ReadonlyArray<RankedParticipant>;
  viewerRank: number;
  viewerCount: number;
}>;

type LeaderboardSnapshotHeaderRow = Readonly<{
  window_key: string;
  snapshot_id: string;
  generated_at: Date | string;
  as_of_server_hour: Date | string;
}>;

type LeaderboardSnapshotEntryRow = Readonly<{
  snapshot_id: string;
  public_profile_id: string;
  qualified_review_count: number | string;
  base_sort_position: number | string;
}>;

type ViewerLatestReviewRow = Readonly<{
  latest_reviewed_at_client: Date | string | null;
}>;

function resolveProgressLeaderboardMetric(localeHint: string): ProgressLeaderboardMetric {
  const copy = PROGRESS_LEADERBOARD_METRIC_COPY_BY_LOCALE[resolveAnonymousDisplayNameLocale(localeHint)];
  return {
    metricVersion: LEADERBOARD_SNAPSHOT_METRIC_VERSION,
    title: copy.title,
    description: copy.description,
  };
}

function buildNonReadyProgressLeaderboard(
  status: ProgressLeaderboardStatus,
  localeHint: string,
): ProgressLeaderboard {
  return {
    status,
    metric: resolveProgressLeaderboardMetric(localeHint),
    defaultWindowKey: DEFAULT_COMPACT_LEADERBOARD_WINDOW_KEY,
    windows: [],
  };
}

function assertProgressLeaderboardReadTransport(transport: AuthTransport): void {
  // session/bearer are the production human transports; "none" is the local
  // AUTH_MODE=none development stand-in for a signed-in user. Guests are handled
  // by the public wrapper before any read and api_key is rejected by the route.
  if (transport !== "session" && transport !== "bearer" && transport !== "none") {
    throw new Error(
      `Progress leaderboard read requires a signed-in human transport, received ${transport}.`,
    );
  }
}

function normalizeTimestamp(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid leaderboard snapshot timestamp: ${String(value)}`);
  }

  return date.toISOString();
}

function normalizeNonNegativeInteger(value: number | string, field: string): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid non-negative integer for ${field}: ${String(value)}`);
  }

  return parsed;
}

function computeNextRefreshAfter(now: Date): string {
  // Snapshots regenerate at the top of every hour (cron 0 * * * ? *). Anchoring on
  // the next hour boundary from now (rather than the snapshot's server hour) keeps
  // this hint in the future even if the hourly job lags and serves an older
  // snapshot; in healthy operation it equals as_of_server_hour + 1h.
  return new Date(truncateToServerHour(now).getTime() + MILLISECONDS_PER_HOUR).toISOString();
}

function computeElapsedHoursSinceReview(
  latestReviewedAtClient: string | null,
  now: Date,
): number | null {
  if (latestReviewedAtClient === null) {
    return null;
  }

  return (now.getTime() - Date.parse(latestReviewedAtClient)) / MILLISECONDS_PER_HOUR;
}

/**
 * Where the viewer slots into the count-descending list of other participants.
 * Equal-count users rank above the viewer (the per-viewer tie rule), so the viewer
 * is placed before the first other participant with a strictly lower count.
 */
function findViewerInsertionIndex(
  others: ReadonlyArray<LeaderboardSnapshotEntry>,
  viewerCount: number,
): number {
  const index = others.findIndex((entry) => entry.qualifiedReviewCount < viewerCount);
  return index === -1 ? others.length : index;
}

/**
 * Builds the full viewer-perspective ranking for one window. Higher count ranks
 * above lower count; for equal counts the viewer is placed below other users
 * (so one more review visibly moves them up) while other equal-count users keep
 * the tie-neutral snapshot order (base_sort_position ascending). The viewer is
 * always included, with count 0 when absent from the snapshot.
 */
function buildViewerPerspectiveRanking(
  entries: ReadonlyArray<LeaderboardSnapshotEntry>,
  viewerPublicProfileId: string,
): ViewerPerspectiveRanking {
  const viewerEntry = entries.find((entry) => entry.publicProfileId === viewerPublicProfileId) ?? null;
  const viewerCount = viewerEntry === null ? 0 : viewerEntry.qualifiedReviewCount;
  const others = entries
    .filter((entry) => entry.publicProfileId !== viewerPublicProfileId)
    .sort((left, right) => left.baseSortPosition - right.baseSortPosition);

  const viewerInsertionIndex = findViewerInsertionIndex(others, viewerCount);
  const ordered: Array<Readonly<{ publicProfileId: string; qualifiedReviewCount: number; isViewer: boolean }>> = [];
  others.forEach((entry, index) => {
    if (index === viewerInsertionIndex) {
      ordered.push({ publicProfileId: viewerPublicProfileId, qualifiedReviewCount: viewerCount, isViewer: true });
    }

    ordered.push({
      publicProfileId: entry.publicProfileId,
      qualifiedReviewCount: entry.qualifiedReviewCount,
      isViewer: false,
    });
  });
  if (viewerInsertionIndex === others.length) {
    ordered.push({ publicProfileId: viewerPublicProfileId, qualifiedReviewCount: viewerCount, isViewer: true });
  }

  const ranked: ReadonlyArray<RankedParticipant> = ordered.map((participant, index) => ({
    ...participant,
    rank: index + 1,
  }));
  const viewerRank = ranked.find((participant) => participant.isViewer)?.rank ?? ranked.length;

  return { ranked, viewerRank, viewerCount };
}

function buildParticipantRow(
  participant: RankedParticipant,
  topRowCount: number,
  resolveName: (publicProfileId: string) => string,
): ProgressLeaderboardParticipantRow {
  const kind: "top" | "neighbor" | "viewer" = participant.isViewer
    ? "viewer"
    : participant.rank <= topRowCount
      ? "top"
      : "neighbor";

  return {
    kind,
    publicProfileId: participant.publicProfileId,
    anonymousDisplayName: resolveName(participant.publicProfileId),
    qualifiedReviewCount: participant.qualifiedReviewCount,
    rank: participant.rank,
  };
}

/**
 * Selects the compact rows server-side so every client renders the same list:
 * the top three rows (when that many participants exist), the row before the
 * viewer, the viewer, and the row after the viewer. Overlapping groups are
 * de-duplicated by rank, a gap row is inserted when hidden ranks sit between
 * the top block and the viewer-neighbor block, and a trailing gap row is
 * inserted when more participants remain below the last shown row.
 */
function buildCompactRows(
  ranked: ReadonlyArray<RankedParticipant>,
  viewerRank: number,
  resolveName: (publicProfileId: string) => string,
): ReadonlyArray<ProgressLeaderboardRow> {
  const total = ranked.length;
  const topRowCount = Math.min(3, total);

  const shownRanks = new Set<number>();
  for (let rank = 1; rank <= topRowCount; rank += 1) {
    shownRanks.add(rank);
  }
  for (const candidate of [viewerRank - 1, viewerRank, viewerRank + 1]) {
    if (candidate >= 1 && candidate <= total) {
      shownRanks.add(candidate);
    }
  }

  const orderedRanks = [...shownRanks].sort((left, right) => left - right);
  const rows: Array<ProgressLeaderboardRow> = [];
  let previousRank = 0;
  for (const rank of orderedRanks) {
    if (previousRank !== 0 && rank > previousRank + 1) {
      rows.push({ kind: "gap" });
    }

    const participant = ranked[rank - 1];
    if (participant === undefined) {
      throw new Error(`Missing ranked participant for rank ${rank}.`);
    }

    rows.push(buildParticipantRow(participant, topRowCount, resolveName));
    previousRank = rank;
  }

  if (previousRank < total) {
    rows.push({ kind: "gap" });
  }

  return rows;
}

function buildLeaderboardWindow(
  header: LeaderboardSnapshotHeader,
  entries: ReadonlyArray<LeaderboardSnapshotEntry>,
  viewerPublicProfileId: string,
  resolveName: (publicProfileId: string) => string,
  now: Date,
): ProgressLeaderboardWindow {
  const ranking = buildViewerPerspectiveRanking(entries, viewerPublicProfileId);

  return {
    windowKey: header.windowKey,
    snapshotId: header.snapshotId,
    snapshotGeneratedAt: header.generatedAt,
    asOfServerHour: header.asOfServerHour,
    nextRefreshAfter: computeNextRefreshAfter(now),
    // Size of the viewer-perspective ranking, which always includes the viewer
    // (count 0 when absent from the snapshot). This keeps viewer rank <=
    // participantCount, so clients can safely render "rank X of N".
    participantCount: ranking.ranked.length,
    viewer: {
      publicProfileId: viewerPublicProfileId,
      displayName: PROGRESS_LEADERBOARD_VIEWER_DISPLAY_NAME,
      rank: ranking.viewerRank,
      qualifiedReviewCount: ranking.viewerCount,
    },
    rows: buildCompactRows(ranking.ranked, ranking.viewerRank, resolveName),
  };
}

async function readViewerLatestCountableReviewInExecutor(
  executor: DatabaseExecutor,
): Promise<string | null> {
  const result = await executor.query<ViewerLatestReviewRow>(
    [
      "SELECT MAX(facts.reviewed_at_client) AS latest_reviewed_at_client",
      "FROM community.public_review_activity_facts AS facts",
      "WHERE facts.metric_version = $1",
      "AND facts.is_countable = TRUE",
    ].join(" "),
    [LEADERBOARD_SNAPSHOT_METRIC_VERSION],
  );

  const value = result.rows[0]?.latest_reviewed_at_client ?? null;
  return value === null ? null : normalizeTimestamp(value);
}

async function readLatestLeaderboardSnapshotHeadersInExecutor(
  executor: DatabaseExecutor,
): Promise<ReadonlyArray<LeaderboardSnapshotHeader>> {
  const result = await executor.query<LeaderboardSnapshotHeaderRow>(
    [
      "SELECT DISTINCT ON (snapshots.window_key)",
      "snapshots.window_key AS window_key,",
      "snapshots.snapshot_id::text AS snapshot_id,",
      "snapshots.generated_at AS generated_at,",
      "snapshots.as_of_server_hour AS as_of_server_hour",
      "FROM community.leaderboard_snapshots AS snapshots",
      "WHERE snapshots.metric_version = $1",
      "ORDER BY snapshots.window_key, snapshots.as_of_server_hour DESC",
    ].join(" "),
    [LEADERBOARD_SNAPSHOT_METRIC_VERSION],
  );

  return result.rows
    .filter((row) => isLeaderboardWindowKey(row.window_key))
    .map((row) => ({
      windowKey: assertLeaderboardWindowKey(row.window_key),
      snapshotId: row.snapshot_id,
      generatedAt: normalizeTimestamp(row.generated_at),
      asOfServerHour: normalizeTimestamp(row.as_of_server_hour),
    }));
}

async function readLeaderboardSnapshotEntriesInExecutor(
  executor: DatabaseExecutor,
  snapshotIds: ReadonlyArray<string>,
): Promise<ReadonlyMap<string, ReadonlyArray<LeaderboardSnapshotEntry>>> {
  const entriesBySnapshotId = new Map<string, Array<LeaderboardSnapshotEntry>>();
  if (snapshotIds.length === 0) {
    return entriesBySnapshotId;
  }

  const result = await executor.query<LeaderboardSnapshotEntryRow>(
    [
      "SELECT",
      "entries.snapshot_id::text AS snapshot_id,",
      "entries.public_profile_id::text AS public_profile_id,",
      "entries.qualified_review_count AS qualified_review_count,",
      "entries.base_sort_position AS base_sort_position",
      "FROM community.leaderboard_snapshot_entries AS entries",
      "WHERE entries.snapshot_id = ANY($1::uuid[])",
      "ORDER BY entries.snapshot_id, entries.base_sort_position ASC",
    ].join(" "),
    [snapshotIds],
  );

  for (const row of result.rows) {
    const list = entriesBySnapshotId.get(row.snapshot_id) ?? [];
    list.push({
      publicProfileId: row.public_profile_id,
      qualifiedReviewCount: normalizeNonNegativeInteger(row.qualified_review_count, "qualified_review_count"),
      baseSortPosition: normalizeNonNegativeInteger(row.base_sort_position, "base_sort_position"),
    });
    entriesBySnapshotId.set(row.snapshot_id, list);
  }

  return entriesBySnapshotId;
}

function indexSnapshotHeadersByWindowKey(
  headers: ReadonlyArray<LeaderboardSnapshotHeader>,
): ReadonlyMap<LeaderboardWindowKey, LeaderboardSnapshotHeader> {
  const headersByWindowKey = new Map<LeaderboardWindowKey, LeaderboardSnapshotHeader>();
  for (const header of headers) {
    headersByWindowKey.set(header.windowKey, header);
  }

  return headersByWindowKey;
}

function collectCompleteSnapshotHeaders(
  headersByWindowKey: ReadonlyMap<LeaderboardWindowKey, LeaderboardSnapshotHeader>,
): ReadonlyArray<LeaderboardSnapshotHeader> | null {
  const orderedHeaders: Array<LeaderboardSnapshotHeader> = [];
  for (const windowKey of LEADERBOARD_WINDOW_KEYS) {
    const header = headersByWindowKey.get(windowKey);
    if (header === undefined) {
      return null;
    }

    orderedHeaders.push(header);
  }

  return orderedHeaders;
}

export async function loadProgressLeaderboardInExecutor(
  executor: DatabaseExecutor,
  request: ProgressLeaderboardRequest,
  now: Date,
): Promise<ProgressLeaderboard> {
  assertProgressLeaderboardReadTransport(request.transport);

  const metric = resolveProgressLeaderboardMetric(request.localeHint);
  await applyUserDatabaseScopeInExecutor(executor, { userId: request.userId });

  const viewerProfile = await ensurePublicProfileForCurrentUserInExecutor(executor);
  if (!viewerProfile.leaderboardParticipationEnabled) {
    return buildNonReadyProgressLeaderboard("participation_disabled", request.localeHint);
  }

  const snapshotHeaders = await readLatestLeaderboardSnapshotHeadersInExecutor(executor);
  const completeHeaders = collectCompleteSnapshotHeaders(indexSnapshotHeadersByWindowKey(snapshotHeaders));
  if (completeHeaders === null) {
    return buildNonReadyProgressLeaderboard("snapshot_unavailable", request.localeHint);
  }

  const latestReviewedAtClient = await readViewerLatestCountableReviewInExecutor(executor);
  const defaultWindowKey = resolveDefaultLeaderboardWindowKey(
    computeElapsedHoursSinceReview(latestReviewedAtClient, now),
  );

  const entriesBySnapshotId = await readLeaderboardSnapshotEntriesInExecutor(
    executor,
    completeHeaders.map((header) => header.snapshotId),
  );
  const wordPools = getAnonymousDisplayNameWordPools(request.localeHint);
  const resolveName = (publicProfileId: string): string => createAnonymousDisplayName(publicProfileId, wordPools);

  const windows = completeHeaders.map((header) => buildLeaderboardWindow(
    header,
    entriesBySnapshotId.get(header.snapshotId) ?? [],
    viewerProfile.publicProfileId,
    resolveName,
    now,
  ));

  return {
    status: "ready",
    metric,
    defaultWindowKey,
    windows,
  };
}

export async function loadProgressLeaderboard(
  request: ProgressLeaderboardRequest,
): Promise<ProgressLeaderboard> {
  if (request.transport === "guest") {
    // Guests get the linked-account-required state with no rows and never open a
    // transaction, since they are excluded from leaderboard participation.
    return buildNonReadyProgressLeaderboard("linked_account_required", request.localeHint);
  }

  // Default (READ COMMITTED) isolation: this read also ensures the viewer's public
  // profile, an idempotent INSERT ... ON CONFLICT DO NOTHING that READ COMMITTED
  // absorbs without a serialization error, matching how /me/community/profile
  // ensures profiles. The leaderboard data is hourly snapshots whose entries are
  // replaced atomically, so it needs no stronger cross-statement isolation.
  return unsafeTransaction(
    async (executor) => loadProgressLeaderboardInExecutor(executor, request, new Date()),
  );
}
