import type {
  ProgressLeaderboard,
  ProgressLeaderboardLocalViewerCounts,
  ProgressLeaderboardRow,
  ProgressLeaderboardSnapshot,
  ProgressLeaderboardWindow,
} from "../../../types";

export function createProgressLeaderboardSnapshot(
  leaderboard: ProgressLeaderboard,
  isApproximate: boolean,
): ProgressLeaderboardSnapshot {
  return {
    status: leaderboard.status,
    metric: leaderboard.metric,
    defaultWindowKey: leaderboard.defaultWindowKey,
    windows: leaderboard.windows,
    source: "server",
    isApproximate,
  };
}

function overlayProgressLeaderboardWindowViewerCount(
  window: ProgressLeaderboardWindow,
  localViewerCount: number,
): ProgressLeaderboardWindow {
  return {
    ...window,
    viewer: {
      ...window.viewer,
      qualifiedReviewCount: localViewerCount,
    },
    rows: window.rows.map((row): ProgressLeaderboardRow => (
      row.kind === "viewer"
        ? {
          ...row,
          qualifiedReviewCount: localViewerCount,
        }
        : row
    )),
  };
}

/**
 * Replaces only the viewer's qualified review count with the locally computed
 * live count. Ranks, participant counts, and all other users' rows stay exactly
 * as the server snapshot reported them, so a diverging local count never
 * invents a new rank.
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
    const localViewerCount = localViewerCounts[window.windowKey];

    if (localViewerCount === window.viewer.qualifiedReviewCount) {
      return window;
    }

    hasOverlay = true;
    return overlayProgressLeaderboardWindowViewerCount(window, localViewerCount);
  });

  if (hasOverlay === false) {
    return serverBase;
  }

  return {
    ...serverBase,
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
