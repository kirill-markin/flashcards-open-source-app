import type {
  ProgressLeaderboard,
  ProgressLeaderboardWindowKey,
} from "../../types";
import { progressLeaderboardWindowKeys } from "../../types";

export type ProgressLeaderboardBestPlacement = Readonly<{
  windowKey: ProgressLeaderboardWindowKey;
  rank: number;
}>;

export function resolveBestLeaderboardPlacement(
  leaderboard: ProgressLeaderboard | null,
): ProgressLeaderboardBestPlacement | null {
  if (leaderboard === null || leaderboard.status !== "ready") {
    return null;
  }

  let bestPlacement: ProgressLeaderboardBestPlacement | null = null;

  for (const windowKey of progressLeaderboardWindowKeys) {
    const window = leaderboard.windows.find((candidate) => candidate.windowKey === windowKey);
    if (window === undefined) {
      continue;
    }

    if (bestPlacement === null || window.viewer.rank < bestPlacement.rank) {
      bestPlacement = {
        windowKey,
        rank: window.viewer.rank,
      };
    }
  }

  return bestPlacement;
}
