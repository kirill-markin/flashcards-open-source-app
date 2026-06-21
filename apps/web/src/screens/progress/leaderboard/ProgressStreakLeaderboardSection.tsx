import { type ReactElement } from "react";
import { Link } from "react-router-dom";
import { buildLoginUrl } from "../../../api";
import { useI18n } from "../../../i18n";
import { settingsLeaderboardParticipationRoute } from "../../../routes";
import type {
  ProgressStreakLeaderboardReadySnapshot,
  ProgressStreakLeaderboardSourceState,
} from "../../../types";
import {
  getProgressLeaderboardElapsedMinutes,
  ProgressLeaderboardRows,
  type ProgressLeaderboardProfileDialogSeed,
  type ProgressLeaderboardDisplayRow,
} from "./ProgressLeaderboardPresentation";

type ProgressStreakLeaderboardSectionProps = Readonly<{
  sourceState: ProgressStreakLeaderboardSourceState;
  canRenderServerBase: boolean;
  isInfoVisible: boolean;
  onToggleInfo: () => void;
  onOpenProfile: (profile: ProgressLeaderboardProfileDialogSeed) => void;
}>;

function ProgressStreakLeaderboardSignInPlaceholder(): ReactElement {
  const { locale, t } = useI18n();

  return (
    <div className="progress-leaderboard-placeholder" data-testid="progress-streak-leaderboard-guest">
      <p className="subtitle">{t("progressScreen.streakLeaderboard.guestBody")}</p>
      <a className="primary-btn" href={buildLoginUrl(window.location.origin, locale)}>
        {t("progressScreen.leaderboard.signIn")}
      </a>
    </div>
  );
}

function buildStreakLeaderboardRows(
  leaderboard: ProgressStreakLeaderboardReadySnapshot,
  formatCount: ReturnType<typeof useI18n>["formatCount"],
  t: ReturnType<typeof useI18n>["t"],
): ReadonlyArray<ProgressLeaderboardDisplayRow> {
  return leaderboard.rows.map((row): ProgressLeaderboardDisplayRow => {
    if (row.kind === "gap") {
      return {
        kind: "gap",
        rowTestId: "progress-streak-leaderboard-row-gap",
      };
    }

    return {
      kind: row.kind,
      publicProfileId: row.publicProfileId,
      anonymousDisplayName: row.anonymousDisplayName,
      friendDisplayName: row.friendDisplayName,
      rank: row.rank,
      metricText: formatCount(row.streakDays, {
        one: t("progressScreen.streakLeaderboard.dayLabels.one"),
        other: t("progressScreen.streakLeaderboard.dayLabels.other"),
      }),
      rowTestId: `progress-streak-leaderboard-row-${row.kind}`,
      metricTestId: `progress-streak-leaderboard-streak-days-${row.kind}`,
    };
  });
}

function ProgressStreakLeaderboardBody(props: Readonly<{
  sourceState: ProgressStreakLeaderboardSourceState;
  canRenderServerBase: boolean;
  onOpenProfile: (profile: ProgressLeaderboardProfileDialogSeed) => void;
}>): ReactElement {
  const { t, formatCount } = useI18n();
  const { sourceState, canRenderServerBase, onOpenProfile } = props;
  const leaderboard = sourceState.renderedSnapshot;

  if (leaderboard === null) {
    if (canRenderServerBase === false) {
      return <ProgressStreakLeaderboardSignInPlaceholder />;
    }

    if (sourceState.errorMessage !== "" && sourceState.isLoading === false) {
      if (sourceState.isNetworkError) {
        return (
          <p className="subtitle" data-testid="progress-streak-leaderboard-offline-empty">
            {t("progressScreen.streakLeaderboard.offlineEmpty")}
          </p>
        );
      }

      return (
        <p className="subtitle" data-testid="progress-streak-leaderboard-unavailable">
          {t("progressScreen.streakLeaderboard.unavailable")}
        </p>
      );
    }

    return (
      <p className="subtitle" data-testid="progress-streak-leaderboard-loading">
        {t("progressScreen.streakLeaderboard.loading")}
      </p>
    );
  }

  if (leaderboard.status === "linked_account_required") {
    return <ProgressStreakLeaderboardSignInPlaceholder />;
  }

  if (leaderboard.status === "participation_disabled") {
    return (
      <div className="progress-leaderboard-placeholder" data-testid="progress-streak-leaderboard-participation-disabled">
        <p className="subtitle">{t("progressScreen.streakLeaderboard.participationDisabledBody")}</p>
        <Link className="ghost-btn" to={settingsLeaderboardParticipationRoute}>
          {t("progressScreen.leaderboard.openParticipationSettings")}
        </Link>
      </div>
    );
  }

  if (leaderboard.status === "snapshot_unavailable") {
    return (
      <p className="subtitle" data-testid="progress-streak-leaderboard-unavailable">
        {t("progressScreen.streakLeaderboard.unavailable")}
      </p>
    );
  }

  if (leaderboard.status !== "ready") {
    return (
      <p className="subtitle" data-testid="progress-streak-leaderboard-unavailable">
        {t("progressScreen.streakLeaderboard.unavailable")}
      </p>
    );
  }

  return (
    <ProgressLeaderboardRows
      rows={buildStreakLeaderboardRows(leaderboard, formatCount, t)}
      paddingRowCount={0}
      paddingRowTestId="progress-streak-leaderboard-row-padding"
      onOpenProfile={leaderboard.source === "server" ? onOpenProfile : undefined}
    />
  );
}

export function ProgressStreakLeaderboardSection(props: ProgressStreakLeaderboardSectionProps): ReactElement {
  const { t, formatNumber } = useI18n();
  const {
    sourceState,
    canRenderServerBase,
    isInfoVisible,
    onToggleInfo,
    onOpenProfile,
  } = props;
  const leaderboard = sourceState.renderedSnapshot;
  const infoUpdatedAt = leaderboard?.status === "ready" && leaderboard.snapshotGeneratedAt !== null
    ? t("progressScreen.streakLeaderboard.updatedAt", {
      minutes: formatNumber(getProgressLeaderboardElapsedMinutes(leaderboard.snapshotGeneratedAt, new Date())),
    })
    : null;

  return (
    <section
      className="content-card progress-section progress-leaderboard-card"
      data-testid="progress-streak-leaderboard-card"
    >
      <div className="progress-section-head">
        <div className="progress-chart-heading">
          <h2 className="progress-section-title">{t("progressScreen.streakLeaderboard.title")}</h2>
        </div>
        <div className="progress-leaderboard-head-actions">
          <button
            type="button"
            className="ghost-btn progress-leaderboard-info-btn"
            aria-expanded={isInfoVisible}
            aria-label={t("progressScreen.streakLeaderboard.infoToggleLabel")}
            onClick={onToggleInfo}
            data-testid="progress-streak-leaderboard-info-toggle"
          >
            <span className="progress-leaderboard-info-icon" aria-hidden="true">i</span>
          </button>
        </div>
      </div>

      {isInfoVisible ? (
        <p className="progress-leaderboard-info" data-testid="progress-streak-leaderboard-info">
          {t("progressScreen.streakLeaderboard.info")}
          {infoUpdatedAt === null ? null : (
            <>
              <br />
              <br />
              {infoUpdatedAt}
            </>
          )}
        </p>
      ) : null}

      <ProgressStreakLeaderboardBody
        sourceState={sourceState}
        canRenderServerBase={canRenderServerBase}
        onOpenProfile={onOpenProfile}
      />
    </section>
  );
}
