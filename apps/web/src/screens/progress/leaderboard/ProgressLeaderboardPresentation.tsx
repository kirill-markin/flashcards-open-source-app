import { type ReactElement } from "react";
import { type Locale, type TranslationKey, useI18n } from "../../../i18n";

const millisecondsPerMinute = 60_000;
const minutesPerHour = 60;

type ProgressLeaderboardDisplayParticipantRowKind = "top" | "neighbor" | "viewer";
type ProgressLeaderboardDurationUnit = "hours" | "minutes";
type ProgressLeaderboardDurationPluralCategory = "zero" | "one" | "two" | "few" | "many" | "other";

type ProgressLeaderboardDurationUnitTranslationKeys = Readonly<Record<ProgressLeaderboardDurationPluralCategory, TranslationKey>>;

const progressLeaderboardDurationUnitTranslationKeys: Readonly<Record<ProgressLeaderboardDurationUnit, ProgressLeaderboardDurationUnitTranslationKeys>> = {
  hours: {
    zero: "progressScreen.leaderboard.updatedAtDuration.hours.zero",
    one: "progressScreen.leaderboard.updatedAtDuration.hours.one",
    two: "progressScreen.leaderboard.updatedAtDuration.hours.two",
    few: "progressScreen.leaderboard.updatedAtDuration.hours.few",
    many: "progressScreen.leaderboard.updatedAtDuration.hours.many",
    other: "progressScreen.leaderboard.updatedAtDuration.hours.other",
  },
  minutes: {
    zero: "progressScreen.leaderboard.updatedAtDuration.minutes.zero",
    one: "progressScreen.leaderboard.updatedAtDuration.minutes.one",
    two: "progressScreen.leaderboard.updatedAtDuration.minutes.two",
    few: "progressScreen.leaderboard.updatedAtDuration.minutes.few",
    many: "progressScreen.leaderboard.updatedAtDuration.minutes.many",
    other: "progressScreen.leaderboard.updatedAtDuration.minutes.other",
  },
};

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

export type ProgressLeaderboardElapsedDuration = Readonly<{
  hours: number;
  minutes: number;
}>;

function getProgressLeaderboardDurationPluralCategory(value: number, locale: Locale): ProgressLeaderboardDurationPluralCategory {
  return new Intl.PluralRules(locale).select(value);
}

function formatProgressLeaderboardDurationUnit(
  value: number,
  unit: ProgressLeaderboardDurationUnit,
  locale: Locale,
  formatNumber: ReturnType<typeof useI18n>["formatNumber"],
  t: ReturnType<typeof useI18n>["t"],
): string {
  const pluralCategory = getProgressLeaderboardDurationPluralCategory(value, locale);
  const translationKey = progressLeaderboardDurationUnitTranslationKeys[unit][pluralCategory];

  return t(translationKey, {
    count: formatNumber(value),
  });
}

export function getProgressLeaderboardElapsedDuration(snapshotGeneratedAt: string, now: Date): ProgressLeaderboardElapsedDuration {
  const snapshotTime = new Date(snapshotGeneratedAt).getTime();
  if (Number.isNaN(snapshotTime)) {
    throw new Error(`Invalid leaderboard snapshot timestamp: ${snapshotGeneratedAt}`);
  }

  const elapsedMinutes = Math.floor(Math.max(0, now.getTime() - snapshotTime) / millisecondsPerMinute);

  return {
    hours: Math.floor(elapsedMinutes / minutesPerHour),
    minutes: elapsedMinutes % minutesPerHour,
  };
}

export function formatProgressLeaderboardElapsedDuration(
  duration: ProgressLeaderboardElapsedDuration,
  locale: Locale,
  formatNumber: ReturnType<typeof useI18n>["formatNumber"],
  t: ReturnType<typeof useI18n>["t"],
): string {
  if (duration.hours === 0) {
    return formatProgressLeaderboardDurationUnit(duration.minutes, "minutes", locale, formatNumber, t);
  }

  const hoursText = formatProgressLeaderboardDurationUnit(duration.hours, "hours", locale, formatNumber, t);
  if (duration.minutes === 0) {
    return hoursText;
  }

  const minutesText = formatProgressLeaderboardDurationUnit(duration.minutes, "minutes", locale, formatNumber, t);

  return t("progressScreen.leaderboard.updatedAtDuration.hoursAndMinutes", {
    hours: hoursText,
    minutes: minutesText,
  });
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
