import type {
  ProgressLeaderboard,
  ProgressLeaderboardLocalViewerCounts,
  ProgressLeaderboardParticipantRow,
  ProgressLeaderboardRankingRow,
  ProgressLeaderboardRow,
  ProgressLeaderboardSnapshot,
  ProgressLeaderboardWindow,
  ProgressLeaderboardWindowKey,
} from "../../../types";
import { progressLeaderboardWindowKeys } from "../../../types";

type ProgressLeaderboardRanklessRankingRow = Readonly<{
  kind: ProgressLeaderboardRankingRow["kind"];
  publicProfileId: string;
  anonymousDisplayName: string;
  friendDisplayName?: string;
  qualifiedReviewCount: number;
}>;

export function createProgressLeaderboardSnapshot(
  leaderboard: ProgressLeaderboard,
  isApproximate: boolean,
): ProgressLeaderboardSnapshot {
  return {
    status: leaderboard.status,
    metric: leaderboard.metric,
    defaultWindowKey: leaderboard.defaultWindowKey,
    windows: leaderboard.status === "ready"
      ? leaderboard.windows.map(rebuildProgressLeaderboardWindowRows)
      : leaderboard.windows,
    source: "server",
    isApproximate,
  };
}

function findViewerRankingRow(
  window: ProgressLeaderboardWindow,
): ProgressLeaderboardRankingRow {
  const viewerRankingRow = window.rankingRows.find((row) => (
    row.kind === "viewer" && row.publicProfileId === window.viewer.publicProfileId
  )) ?? null;

  if (viewerRankingRow === null) {
    throw new Error(`Leaderboard window ${window.windowKey} rankingRows must include viewer ${window.viewer.publicProfileId}.`);
  }

  return viewerRankingRow;
}

function buildOtherRankingRows(
  window: ProgressLeaderboardWindow,
): ReadonlyArray<ProgressLeaderboardRankingRow> {
  return window.rankingRows.filter((row) => {
    if (row.kind === "viewer" && row.publicProfileId !== window.viewer.publicProfileId) {
      throw new Error(`Leaderboard window ${window.windowKey} rankingRows contains a viewer row for ${row.publicProfileId}, expected ${window.viewer.publicProfileId}.`);
    }

    if (row.kind === "participant" && row.publicProfileId === window.viewer.publicProfileId) {
      throw new Error(`Leaderboard window ${window.windowKey} rankingRows contains viewer ${window.viewer.publicProfileId} as a participant row.`);
    }

    return row.publicProfileId !== window.viewer.publicProfileId;
  });
}

function toRanklessRankingRow(
  row: ProgressLeaderboardRankingRow,
): ProgressLeaderboardRanklessRankingRow {
  return {
    kind: row.kind,
    publicProfileId: row.publicProfileId,
    anonymousDisplayName: row.anonymousDisplayName,
    friendDisplayName: row.friendDisplayName,
    qualifiedReviewCount: row.qualifiedReviewCount,
  };
}

function findViewerInsertionIndex(
  rows: ReadonlyArray<ProgressLeaderboardRankingRow>,
  viewerCount: number,
): number {
  const index = rows.findIndex((row) => row.qualifiedReviewCount < viewerCount);
  return index === -1 ? rows.length : index;
}

function buildProjectedRankingRows(
  window: ProgressLeaderboardWindow,
  viewerCount: number,
): ReadonlyArray<ProgressLeaderboardRankingRow> {
  const viewerRankingRow = findViewerRankingRow(window);
  const otherRows = buildOtherRankingRows(window);
  const viewerInsertionIndex = findViewerInsertionIndex(otherRows, viewerCount);
  const projectedRows: Array<ProgressLeaderboardRanklessRankingRow> = [];
  const projectedViewerRow: ProgressLeaderboardRanklessRankingRow = {
    kind: "viewer",
    publicProfileId: window.viewer.publicProfileId,
    anonymousDisplayName: viewerRankingRow.anonymousDisplayName,
    friendDisplayName: viewerRankingRow.friendDisplayName,
    qualifiedReviewCount: viewerCount,
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

  return projectedRows.map((row, index): ProgressLeaderboardRankingRow => ({
    ...row,
    rank: index + 1,
  }));
}

function buildProgressLeaderboardParticipantRow(
  row: ProgressLeaderboardRankingRow,
  topRowCount: number,
): ProgressLeaderboardParticipantRow {
  return {
    kind: row.kind === "viewer" ? "viewer" : row.rank <= topRowCount ? "top" : "neighbor",
    publicProfileId: row.publicProfileId,
    anonymousDisplayName: row.anonymousDisplayName,
    friendDisplayName: row.friendDisplayName,
    qualifiedReviewCount: row.qualifiedReviewCount,
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

function isFriendRankingRow(row: ProgressLeaderboardRankingRow): boolean {
  return row.friendDisplayName !== undefined;
}

function addShownRankingRow(
  rowsByPublicProfileId: Map<string, ProgressLeaderboardRankingRow>,
  row: ProgressLeaderboardRankingRow,
): void {
  if (rowsByPublicProfileId.has(row.publicProfileId)) {
    return;
  }

  rowsByPublicProfileId.set(row.publicProfileId, row);
}

function buildShownRankingRows(
  rankingRows: ReadonlyArray<ProgressLeaderboardRankingRow>,
  shownRanks: ReadonlyArray<number>,
): ReadonlyArray<ProgressLeaderboardRankingRow> {
  const rowsByPublicProfileId = new Map<string, ProgressLeaderboardRankingRow>();

  for (const rank of shownRanks) {
    const rankingRow = rankingRows[rank - 1];
    if (rankingRow === undefined) {
      throw new Error(`Projected leaderboard rankingRows is missing rank ${rank}.`);
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
  rankingRows: ReadonlyArray<ProgressLeaderboardRankingRow>,
): ReadonlyArray<ProgressLeaderboardRow> {
  const viewerRankingRow = rankingRows.find((row) => row.kind === "viewer") ?? null;
  if (viewerRankingRow === null) {
    throw new Error("Projected leaderboard rankingRows must include a viewer row.");
  }

  const total = rankingRows.length;
  const topRowCount = Math.min(3, total);
  const shownRanks = buildShownRankList(total, viewerRankingRow.rank);
  const shownRankingRows = buildShownRankingRows(rankingRows, shownRanks);
  const rows: Array<ProgressLeaderboardRow> = [];
  let previousRank = 0;

  for (const rankingRow of shownRankingRows) {
    if (previousRank !== 0 && rankingRow.rank > previousRank + 1) {
      rows.push({ kind: "gap" });
    }

    rows.push(buildProgressLeaderboardParticipantRow(rankingRow, topRowCount));
    previousRank = rankingRow.rank;
  }

  if (previousRank < total) {
    rows.push({ kind: "gap" });
  }

  return rows;
}

function rebuildProgressLeaderboardWindowRows(
  window: ProgressLeaderboardWindow,
): ProgressLeaderboardWindow {
  return {
    ...window,
    rows: buildCompactRows(window.rankingRows),
  };
}

function projectProgressLeaderboardWindow(
  window: ProgressLeaderboardWindow,
  localViewerCounts: ProgressLeaderboardLocalViewerCounts,
): ProgressLeaderboardWindow {
  const viewerCount = Math.max(
    window.viewer.qualifiedReviewCount,
    localViewerCounts[window.windowKey],
  );

  if (viewerCount === window.viewer.qualifiedReviewCount) {
    return window;
  }

  const projectedRankingRows = buildProjectedRankingRows(window, viewerCount);
  const projectedViewerRow = projectedRankingRows.find((row) => row.kind === "viewer") ?? null;
  if (projectedViewerRow === null) {
    throw new Error(`Projected leaderboard window ${window.windowKey} rankingRows must include a viewer row.`);
  }

  return {
    ...window,
    viewer: {
      ...window.viewer,
      rank: projectedViewerRow.rank,
      qualifiedReviewCount: viewerCount,
    },
    rows: buildCompactRows(projectedRankingRows),
    rankingRows: projectedRankingRows,
  };
}

function resolveProjectedDefaultWindowKey(
  windows: ReadonlyArray<ProgressLeaderboardWindow>,
  currentDefaultWindowKey: ProgressLeaderboardWindowKey,
): ProgressLeaderboardWindowKey {
  let bestWindow: ProgressLeaderboardWindow | null = null;

  for (const windowKey of progressLeaderboardWindowKeys) {
    const window = windows.find((candidate) => candidate.windowKey === windowKey);
    if (window === undefined) {
      continue;
    }

    if (bestWindow === null || window.viewer.rank < bestWindow.viewer.rank) {
      bestWindow = window;
    }
  }

  return bestWindow === null ? currentDefaultWindowKey : bestWindow.windowKey;
}

/**
 * Projects a live viewer-only count onto the server-frozen ranking rows. Other
 * participants retain server order; the viewer is reinserted below equal counts
 * and above the first lower count, then compact rows are rebuilt from that
 * projected rank list.
 */
function mergeProgressLeaderboardWithLocalViewerCounts(
  serverBase: ProgressLeaderboardSnapshot,
  localViewerCounts: ProgressLeaderboardLocalViewerCounts | null,
): ProgressLeaderboardSnapshot {
  if (localViewerCounts === null || serverBase.status !== "ready") {
    return serverBase;
  }

  let hasOverlay = false;
  const windows = serverBase.windows.map((window): ProgressLeaderboardWindow => {
    const projectedWindow = projectProgressLeaderboardWindow(window, localViewerCounts);

    if (projectedWindow !== window) {
      hasOverlay = true;
    }

    return projectedWindow;
  });

  if (hasOverlay === false) {
    return serverBase;
  }

  return {
    ...serverBase,
    defaultWindowKey: resolveProjectedDefaultWindowKey(windows, serverBase.defaultWindowKey),
    windows,
    isApproximate: true,
  };
}

export function buildRenderedLeaderboard(
  serverBase: ProgressLeaderboardSnapshot | null,
  localViewerCounts: ProgressLeaderboardLocalViewerCounts | null,
  canRenderServerBase: boolean,
): ProgressLeaderboardSnapshot | null {
  if (canRenderServerBase === false || serverBase === null) {
    return null;
  }

  return mergeProgressLeaderboardWithLocalViewerCounts(serverBase, localViewerCounts);
}
