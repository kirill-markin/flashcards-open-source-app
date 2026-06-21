import { type ReactElement } from "react";
import { useI18n } from "../../../i18n";

const millisecondsPerMinute = 60_000;

type ProgressLeaderboardDisplayParticipantRowKind = "top" | "neighbor" | "viewer";

export type ProgressLeaderboardDisplayGapRow = Readonly<{
  kind: "gap";
  rowTestId: string;
}>;

export type ProgressLeaderboardDisplayParticipantRow = Readonly<{
  kind: ProgressLeaderboardDisplayParticipantRowKind;
  publicProfileId: string;
  anonymousDisplayName: string;
  friendDisplayName?: string;
  rank: number;
  metricText: string;
  rowTestId: string;
  metricTestId: string;
}>;

export type ProgressLeaderboardDisplayRow =
  | ProgressLeaderboardDisplayGapRow
  | ProgressLeaderboardDisplayParticipantRow;

export type ProgressLeaderboardProfileDialogSeed = Readonly<{
  publicProfileId: string;
  anonymousDisplayName: string;
  friendDisplayName?: string;
  displayName: string;
  isViewer: boolean;
}>;

export function getProgressLeaderboardElapsedMinutes(snapshotGeneratedAt: string, now: Date): number {
  const snapshotTime = new Date(snapshotGeneratedAt).getTime();
  if (Number.isNaN(snapshotTime)) {
    throw new Error(`Invalid leaderboard snapshot timestamp: ${snapshotGeneratedAt}`);
  }

  return Math.floor(Math.max(0, now.getTime() - snapshotTime) / millisecondsPerMinute);
}

function getParticipantRowClassName(row: ProgressLeaderboardDisplayParticipantRow): string {
  if (row.kind === "viewer") {
    return "progress-leaderboard-row progress-leaderboard-row-viewer";
  }

  return row.friendDisplayName === undefined
    ? "progress-leaderboard-row"
    : "progress-leaderboard-row progress-leaderboard-row-friend";
}

export function ProgressLeaderboardRows(props: Readonly<{
  rows: ReadonlyArray<ProgressLeaderboardDisplayRow>;
  paddingRowCount: number;
  paddingRowTestId: string;
  onOpenProfile?: (profile: ProgressLeaderboardProfileDialogSeed) => void;
}>): ReactElement {
  const { t, formatNumber } = useI18n();
  const { rows, paddingRowCount, paddingRowTestId, onOpenProfile } = props;

  return (
    <ol className="progress-leaderboard-list">
      {rows.map((row, rowIndex) => {
        if (row.kind === "gap") {
          return (
            <li
              key={`${row.rowTestId}-${rowIndex}`}
              className="progress-leaderboard-row progress-leaderboard-gap"
              data-kind="gap"
              data-testid={row.rowTestId}
              aria-hidden="true"
            >
              <span className="progress-leaderboard-gap-dots">…</span>
            </li>
          );
        }

        const displayName = row.kind === "viewer"
          ? t("progressScreen.leaderboard.you")
          : row.friendDisplayName ?? row.anonymousDisplayName;
        const rowContent = (
          <>
            <span className="progress-leaderboard-rank">
              {t("progressScreen.leaderboard.rankLabel", { rank: formatNumber(row.rank) })}
            </span>
            <span className="progress-leaderboard-name">
              {displayName}
            </span>
            <span className="progress-leaderboard-count" data-testid={row.metricTestId}>
              {row.metricText}
            </span>
          </>
        );

        if (onOpenProfile === undefined) {
          return (
            <li
              key={`${row.publicProfileId}-${row.rank}`}
              className={getParticipantRowClassName(row)}
              data-kind={row.kind}
              data-friend={row.friendDisplayName === undefined ? "false" : "true"}
              data-testid={row.rowTestId}
            >
              {rowContent}
            </li>
          );
        }

        return (
          <li
            key={`${row.publicProfileId}-${row.rank}`}
            className={`${getParticipantRowClassName(row)} progress-leaderboard-row-actionable`}
            data-kind={row.kind}
            data-friend={row.friendDisplayName === undefined ? "false" : "true"}
            data-testid={row.rowTestId}
          >
            <button
              type="button"
              className="progress-leaderboard-row-button"
              data-testid={`${row.rowTestId}-button`}
              onClick={() => onOpenProfile({
                publicProfileId: row.publicProfileId,
                anonymousDisplayName: row.anonymousDisplayName,
                friendDisplayName: row.friendDisplayName,
                displayName,
                isViewer: row.kind === "viewer",
              })}
            >
              {rowContent}
            </button>
          </li>
        );
      })}
      {Array.from({ length: paddingRowCount }, (_value, index) => (
        <li
          key={`${paddingRowTestId}-${index}`}
          className="progress-leaderboard-row progress-leaderboard-row-padding"
          data-kind="padding"
          data-testid={paddingRowTestId}
          aria-hidden="true"
        />
      ))}
    </ol>
  );
}
