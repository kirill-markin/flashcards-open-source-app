import type {
  ProgressStreakLeaderboard,
  ProgressStreakLeaderboardMetric,
  ProgressStreakLeaderboardParticipantRow,
  ProgressStreakLeaderboardRankingRow,
  ProgressStreakLeaderboardReadySnapshot,
  ProgressStreakLeaderboardRow,
  ProgressStreakLeaderboardSnapshot,
  ProgressSummarySnapshot,
} from "../../../types";

type ProgressStreakLeaderboardRanklessRankingRow = Readonly<{
  kind: ProgressStreakLeaderboardRankingRow["kind"];
  publicProfileId: string;
  anonymousDisplayName: string;
  friendDisplayName?: string;
  streakDays: number;
}>;

const localProgressStreakLeaderboardMetric: ProgressStreakLeaderboardMetric = {
  metricVersion: "streak_days_v1",
  title: "Current streak days",
  description: "Local current streak days are shown until the public daily snapshot is available.",
};

export function createProgressStreakLeaderboardSnapshot(
  leaderboard: ProgressStreakLeaderboard,
  isApproximate: boolean,
): ProgressStreakLeaderboardSnapshot {
  if (leaderboard.status !== "ready") {
    return {
      status: leaderboard.status,
      metric: leaderboard.metric,
      source: "server",
      isApproximate,
    };
  }

  return {
    status: "ready",
    metric: leaderboard.metric,
    snapshotId: leaderboard.snapshotId,
    snapshotGeneratedAt: leaderboard.snapshotGeneratedAt,
    asOfUtcDate: leaderboard.asOfUtcDate,
    nextRefreshAfter: leaderboard.nextRefreshAfter,
    participantCount: leaderboard.participantCount,
    viewer: leaderboard.viewer,
    rows: buildCompactRows(leaderboard.rankingRows),
    rankingRows: leaderboard.rankingRows,
    source: "server",
    isApproximate,
  };
}

function findViewerRankingRow(
  leaderboard: ProgressStreakLeaderboardReadySnapshot,
): ProgressStreakLeaderboardRankingRow {
  const viewerRankingRow = leaderboard.rankingRows.find((row) => (
    row.kind === "viewer" && row.publicProfileId === leaderboard.viewer.publicProfileId
  )) ?? null;

  if (viewerRankingRow === null) {
    throw new Error(`Streak leaderboard rankingRows must include viewer ${leaderboard.viewer.publicProfileId}.`);
  }

  return viewerRankingRow;
}

function buildOtherRankingRows(
  leaderboard: ProgressStreakLeaderboardReadySnapshot,
): ReadonlyArray<ProgressStreakLeaderboardRankingRow> {
  return leaderboard.rankingRows.filter((row) => {
    if (row.kind === "viewer" && row.publicProfileId !== leaderboard.viewer.publicProfileId) {
      throw new Error(`Streak leaderboard rankingRows contains a viewer row for ${row.publicProfileId}, expected ${leaderboard.viewer.publicProfileId}.`);
    }

    if (row.kind === "participant" && row.publicProfileId === leaderboard.viewer.publicProfileId) {
      throw new Error(`Streak leaderboard rankingRows contains viewer ${leaderboard.viewer.publicProfileId} as a participant row.`);
    }

    return row.publicProfileId !== leaderboard.viewer.publicProfileId;
  });
}

function toRanklessRankingRow(
  row: ProgressStreakLeaderboardRankingRow,
): ProgressStreakLeaderboardRanklessRankingRow {
  return {
    kind: row.kind,
    publicProfileId: row.publicProfileId,
    anonymousDisplayName: row.anonymousDisplayName,
    friendDisplayName: row.friendDisplayName,
    streakDays: row.streakDays,
  };
}

function findViewerInsertionIndex(
  rows: ReadonlyArray<ProgressStreakLeaderboardRankingRow>,
  viewerStreakDays: number,
): number {
  const index = rows.findIndex((row) => row.streakDays <= viewerStreakDays);
  return index === -1 ? rows.length : index;
}

function buildProjectedRankingRows(
  leaderboard: ProgressStreakLeaderboardReadySnapshot,
  viewerStreakDays: number,
): ReadonlyArray<ProgressStreakLeaderboardRankingRow> {
  const viewerRankingRow = findViewerRankingRow(leaderboard);
  const otherRows = buildOtherRankingRows(leaderboard);
  const viewerInsertionIndex = findViewerInsertionIndex(otherRows, viewerStreakDays);
  const projectedRows: Array<ProgressStreakLeaderboardRanklessRankingRow> = [];
  const projectedViewerRow: ProgressStreakLeaderboardRanklessRankingRow = {
    kind: "viewer",
    publicProfileId: leaderboard.viewer.publicProfileId,
    anonymousDisplayName: viewerRankingRow.anonymousDisplayName,
    friendDisplayName: viewerRankingRow.friendDisplayName,
    streakDays: viewerStreakDays,
  };

  otherRows.forEach((row, index) => {
    if (index === viewerInsertionIndex) {
      projectedRows.push(projectedViewerRow);
    }

    projectedRows.push(toRanklessRankingRow(row));
  });

  if (viewerInsertionIndex === otherRows.length) {
    projectedRows.push(projectedViewerRow);
  }

  return projectedRows.map((row, index): ProgressStreakLeaderboardRankingRow => ({
    ...row,
    rank: index + 1,
  }));
}

function buildProgressStreakLeaderboardParticipantRow(
  row: ProgressStreakLeaderboardRankingRow,
  topRowCount: number,
): ProgressStreakLeaderboardParticipantRow {
  return {
    kind: row.kind === "viewer" ? "viewer" : row.rank <= topRowCount ? "top" : "neighbor",
    publicProfileId: row.publicProfileId,
    anonymousDisplayName: row.anonymousDisplayName,
    friendDisplayName: row.friendDisplayName,
    streakDays: row.streakDays,
    rank: row.rank,
  };
}

function buildShownRankList(total: number, viewerRank: number): ReadonlyArray<number> {
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

  return [...shownRanks].sort((left, right) => left - right);
}

function isFriendRankingRow(row: ProgressStreakLeaderboardRankingRow): boolean {
  return row.friendDisplayName !== undefined;
}

function addShownRankingRow(
  rowsByPublicProfileId: Map<string, ProgressStreakLeaderboardRankingRow>,
  row: ProgressStreakLeaderboardRankingRow,
): void {
  if (rowsByPublicProfileId.has(row.publicProfileId)) {
    return;
  }

  rowsByPublicProfileId.set(row.publicProfileId, row);
}

function buildShownRankingRows(
  rankingRows: ReadonlyArray<ProgressStreakLeaderboardRankingRow>,
  shownRanks: ReadonlyArray<number>,
): ReadonlyArray<ProgressStreakLeaderboardRankingRow> {
  const rowsByPublicProfileId = new Map<string, ProgressStreakLeaderboardRankingRow>();

  for (const rank of shownRanks) {
    const rankingRow = rankingRows[rank - 1];
    if (rankingRow === undefined) {
      throw new Error(`Projected streak leaderboard rankingRows is missing rank ${rank}.`);
    }

    addShownRankingRow(rowsByPublicProfileId, rankingRow);
  }

  rankingRows.forEach((row) => {
    if (isFriendRankingRow(row)) {
      addShownRankingRow(rowsByPublicProfileId, row);
    }
  });

  return [...rowsByPublicProfileId.values()].sort((left, right) => left.rank - right.rank);
}

function buildCompactRows(
  rankingRows: ReadonlyArray<ProgressStreakLeaderboardRankingRow>,
): ReadonlyArray<ProgressStreakLeaderboardRow> {
  const viewerRankingRow = rankingRows.find((row) => row.kind === "viewer") ?? null;
  if (viewerRankingRow === null) {
    throw new Error("Projected streak leaderboard rankingRows must include a viewer row.");
  }

  const total = rankingRows.length;
  const topRowCount = Math.min(3, total);
  const shownRanks = buildShownRankList(total, viewerRankingRow.rank);
  const shownRankingRows = buildShownRankingRows(rankingRows, shownRanks);
  const rows: Array<ProgressStreakLeaderboardRow> = [];
  let previousRank = 0;

  for (const rankingRow of shownRankingRows) {
    if (previousRank !== 0 && rankingRow.rank > previousRank + 1) {
      rows.push({ kind: "gap" });
    }

    rows.push(buildProgressStreakLeaderboardParticipantRow(rankingRow, topRowCount));
    previousRank = rankingRow.rank;
  }

  if (previousRank < total) {
    rows.push({ kind: "gap" });
  }

  return rows;
}

function projectProgressStreakLeaderboard(
  leaderboard: ProgressStreakLeaderboardReadySnapshot,
  currentSummary: ProgressSummarySnapshot,
): ProgressStreakLeaderboardReadySnapshot {
  const viewerStreakDays = Math.max(
    leaderboard.viewer.streakDays,
    currentSummary.summary.currentStreakDays,
  );

  if (viewerStreakDays === leaderboard.viewer.streakDays) {
    return leaderboard;
  }

  const projectedRankingRows = buildProjectedRankingRows(leaderboard, viewerStreakDays);
  const projectedViewerRow = projectedRankingRows.find((row) => row.kind === "viewer") ?? null;
  if (projectedViewerRow === null) {
    throw new Error("Projected streak leaderboard rankingRows must include a viewer row.");
  }

  return {
    ...leaderboard,
    viewer: {
      ...leaderboard.viewer,
      rank: projectedViewerRow.rank,
      streakDays: viewerStreakDays,
    },
    rows: buildCompactRows(projectedRankingRows),
    rankingRows: projectedRankingRows,
    isApproximate: true,
  };
}

function createLocalOnlyProgressStreakLeaderboardSnapshot(
  currentSummary: ProgressSummarySnapshot,
  metric: ProgressStreakLeaderboardMetric,
): ProgressStreakLeaderboardReadySnapshot {
  const viewerRow: ProgressStreakLeaderboardRankingRow = {
    kind: "viewer",
    publicProfileId: "local-viewer",
    anonymousDisplayName: "You",
    streakDays: currentSummary.summary.currentStreakDays,
    rank: 1,
  };

  return {
    status: "ready",
    metric,
    snapshotId: null,
    snapshotGeneratedAt: null,
    asOfUtcDate: null,
    nextRefreshAfter: null,
    participantCount: 1,
    viewer: {
      publicProfileId: viewerRow.publicProfileId,
      displayName: "You",
      rank: viewerRow.rank,
      streakDays: viewerRow.streakDays,
    },
    rows: buildCompactRows([viewerRow]),
    rankingRows: [viewerRow],
    source: "local_only",
    isApproximate: true,
  };
}

export function buildRenderedStreakLeaderboard(
  serverBase: ProgressStreakLeaderboardSnapshot | null,
  currentSummary: ProgressSummarySnapshot | null,
  canRenderServerBase: boolean,
): ProgressStreakLeaderboardSnapshot | null {
  const renderableServerBase = canRenderServerBase ? serverBase : null;

  if (currentSummary === null) {
    return renderableServerBase;
  }

  if (renderableServerBase?.status === "ready") {
    return projectProgressStreakLeaderboard(renderableServerBase, currentSummary);
  }

  return createLocalOnlyProgressStreakLeaderboardSnapshot(
    currentSummary,
    renderableServerBase?.metric ?? localProgressStreakLeaderboardMetric,
  );
}
