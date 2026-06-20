import { useState, type ReactElement, type Ref } from "react";
import { Link } from "react-router-dom";
import { buildLoginUrl } from "../../../api";
import { resolveBestLeaderboardPlacement } from "../../../appData/progress/leaderboardPlacement";
import { useI18n } from "../../../i18n";
import { settingsLeaderboardParticipationRoute } from "../../../routes";
import type {
  ProgressLeaderboard,
  ProgressLeaderboardSourceState,
  ProgressLeaderboardWindow,
  ProgressLeaderboardWindowKey,
} from "../../../types";
import { progressLeaderboardWindowKeys } from "../../../types";
import { FriendInviteCreateDialog } from "../../friends/FriendInviteCreateDialog";
import {
  getProgressLeaderboardElapsedMinutes,
  ProgressLeaderboardRows,
  type ProgressLeaderboardDisplayRow,
} from "./ProgressLeaderboardPresentation";

function getLeaderboardPeriodLabel(windowKey: ProgressLeaderboardWindowKey, t: ReturnType<typeof useI18n>["t"]): string {
  if (windowKey === "last_24_hours") {
    return t("progressScreen.leaderboard.periods.last24Hours");
  }

  if (windowKey === "last_3_days") {
    return t("progressScreen.leaderboard.periods.last3Days");
  }

  if (windowKey === "last_7_days") {
    return t("progressScreen.leaderboard.periods.last7Days");
  }

  if (windowKey === "last_30_days") {
    return t("progressScreen.leaderboard.periods.last30Days");
  }

  return t("progressScreen.leaderboard.periods.allTime");
}

function resolveLeaderboardWindow(
  sourceState: ProgressLeaderboardSourceState,
  selectedWindowKey: ProgressLeaderboardWindowKey | null,
): ProgressLeaderboardWindow | null {
  const leaderboard = sourceState.renderedSnapshot;
  if (leaderboard === null || leaderboard.status !== "ready") {
    return null;
  }

  const resolvedWindowKey = selectedWindowKey
    ?? resolveBestLeaderboardPlacement(leaderboard)?.windowKey
    ?? leaderboard.defaultWindowKey;

  return leaderboard.windows.find((window) => window.windowKey === resolvedWindowKey) ?? null;
}

function resolveSelectedLeaderboardWindowKey(
  sourceState: ProgressLeaderboardSourceState,
  selectedWindowKey: ProgressLeaderboardWindowKey | null,
): ProgressLeaderboardWindowKey | null {
  const leaderboard = sourceState.renderedSnapshot;
  if (leaderboard === null || leaderboard.status !== "ready") {
    return null;
  }

  return selectedWindowKey
    ?? resolveBestLeaderboardPlacement(leaderboard)?.windowKey
    ?? leaderboard.defaultWindowKey;
}

type ProgressLeaderboardBodyProps = Readonly<{
  sourceState: ProgressLeaderboardSourceState;
  canRenderServerBase: boolean;
  selectedWindowKey: ProgressLeaderboardWindowKey | null;
  onSelectWindowKey: (windowKey: ProgressLeaderboardWindowKey) => void;
}>;

type ProgressLeaderboardSectionProps = ProgressLeaderboardBodyProps & Readonly<{
  sectionId: string;
  sectionRef: Ref<HTMLElement>;
  isInfoVisible: boolean;
  onToggleInfo: () => void;
}>;

function ProgressLeaderboardSignInPlaceholder(): ReactElement {
  const { locale, t } = useI18n();

  return (
    <div className="progress-leaderboard-placeholder" data-testid="progress-leaderboard-guest">
      <p className="subtitle">{t("progressScreen.leaderboard.guestBody")}</p>
      <a className="primary-btn" href={buildLoginUrl(window.location.origin, locale)}>
        {t("progressScreen.leaderboard.signIn")}
      </a>
    </div>
  );
}

function resolveLeaderboardReservedRowCount(leaderboard: ProgressLeaderboard): number {
  return leaderboard.windows.reduce(
    (currentMax, window) => Math.max(currentMax, window.rows.length),
    0,
  );
}

function buildRatingLeaderboardRows(
  leaderboardWindow: ProgressLeaderboardWindow,
  formatNumber: ReturnType<typeof useI18n>["formatNumber"],
): ReadonlyArray<ProgressLeaderboardDisplayRow> {
  return leaderboardWindow.rows.map((row): ProgressLeaderboardDisplayRow => {
    if (row.kind === "gap") {
      return {
        kind: "gap",
        rowTestId: "progress-leaderboard-row-gap",
      };
    }

    return {
      kind: row.kind,
      publicProfileId: row.publicProfileId,
      anonymousDisplayName: row.anonymousDisplayName,
      friendDisplayName: row.friendDisplayName,
      rank: row.rank,
      metricText: formatNumber(row.qualifiedReviewCount),
      rowTestId: `progress-leaderboard-row-${row.kind}`,
      metricTestId: `progress-leaderboard-count-${row.kind}`,
    };
  });
}

function ProgressLeaderboardBody(props: ProgressLeaderboardBodyProps): ReactElement {
  const { t, formatNumber } = useI18n();
  const { sourceState, canRenderServerBase, selectedWindowKey, onSelectWindowKey } = props;
  const leaderboard = sourceState.renderedSnapshot;

  if (canRenderServerBase === false) {
    return <ProgressLeaderboardSignInPlaceholder />;
  }

  if (leaderboard === null) {
    if (sourceState.errorMessage !== "" && sourceState.isLoading === false) {
      if (sourceState.isNetworkError) {
        return (
          <p className="subtitle" data-testid="progress-leaderboard-offline-empty">
            {t("progressScreen.leaderboard.offlineEmpty")}
          </p>
        );
      }

      return (
        <p className="subtitle" data-testid="progress-leaderboard-unavailable">
          {t("progressScreen.leaderboard.unavailable")}
        </p>
      );
    }

    return (
      <p className="subtitle" data-testid="progress-leaderboard-loading">
        {t("progressScreen.leaderboard.loading")}
      </p>
    );
  }

  if (leaderboard.status === "linked_account_required") {
    return <ProgressLeaderboardSignInPlaceholder />;
  }

  if (leaderboard.status === "participation_disabled") {
    return (
      <div className="progress-leaderboard-placeholder" data-testid="progress-leaderboard-participation-disabled">
        <p className="subtitle">{t("progressScreen.leaderboard.participationDisabledBody")}</p>
        <Link className="ghost-btn" to={settingsLeaderboardParticipationRoute}>
          {t("progressScreen.leaderboard.openParticipationSettings")}
        </Link>
      </div>
    );
  }

  if (leaderboard.status === "snapshot_unavailable") {
    return (
      <p className="subtitle" data-testid="progress-leaderboard-unavailable">
        {t("progressScreen.leaderboard.unavailable")}
      </p>
    );
  }

  const resolvedWindowKey = resolveSelectedLeaderboardWindowKey(sourceState, selectedWindowKey) ?? leaderboard.defaultWindowKey;
  const leaderboardWindow = resolveLeaderboardWindow(sourceState, selectedWindowKey);
  const reservedRowCount = resolveLeaderboardReservedRowCount(leaderboard);

  return (
    <>
      <div className="progress-leaderboard-periods" role="group" aria-label={t("progressScreen.leaderboard.periodsLabel")}>
        {progressLeaderboardWindowKeys.map((windowKey) => (
          <button
            key={windowKey}
            type="button"
            className={windowKey === resolvedWindowKey
              ? "progress-leaderboard-period-btn is-selected"
              : "progress-leaderboard-period-btn"}
            aria-pressed={windowKey === resolvedWindowKey}
            onClick={() => onSelectWindowKey(windowKey)}
            data-testid={`progress-leaderboard-period-${windowKey}`}
          >
            {getLeaderboardPeriodLabel(windowKey, t)}
          </button>
        ))}
      </div>
      {leaderboardWindow === null ? (
        <p className="subtitle" data-testid="progress-leaderboard-unavailable">
          {t("progressScreen.leaderboard.unavailable")}
        </p>
      ) : (
        <ProgressLeaderboardRows
          rows={buildRatingLeaderboardRows(leaderboardWindow, formatNumber)}
          paddingRowCount={Math.max(0, reservedRowCount - leaderboardWindow.rows.length)}
          paddingRowTestId="progress-leaderboard-row-padding"
        />
      )}
    </>
  );
}

export function ProgressLeaderboardSection(props: ProgressLeaderboardSectionProps): ReactElement {
  const { t, formatNumber } = useI18n();
  const [isInviteDialogOpen, setIsInviteDialogOpen] = useState<boolean>(false);
  const {
    sourceState,
    canRenderServerBase,
    selectedWindowKey,
    onSelectWindowKey,
    sectionId,
    sectionRef,
    isInfoVisible,
    onToggleInfo,
  } = props;
  const leaderboardWindow = resolveLeaderboardWindow(sourceState, selectedWindowKey);
  const infoUpdatedAt = leaderboardWindow === null
    ? null
    : t("progressScreen.leaderboard.updatedAt", {
      minutes: formatNumber(getProgressLeaderboardElapsedMinutes(leaderboardWindow.snapshotGeneratedAt, new Date())),
    });

  return (
    <section
      id={sectionId}
      ref={sectionRef}
      className="content-card progress-section progress-leaderboard-card"
      data-testid="progress-leaderboard-card"
    >
      <div className="progress-section-head">
        <div className="progress-chart-heading">
          <h2 className="progress-section-title">{t("progressScreen.leaderboard.title")}</h2>
        </div>
        <div className="progress-leaderboard-head-actions">
          <button
            type="button"
            className="ghost-btn progress-leaderboard-info-btn"
            aria-expanded={isInfoVisible}
            aria-label={t("progressScreen.leaderboard.infoToggleLabel")}
            onClick={onToggleInfo}
            data-testid="progress-leaderboard-info-toggle"
          >
            <span className="progress-leaderboard-info-icon" aria-hidden="true">i</span>
          </button>
        </div>
      </div>

      {isInfoVisible ? (
        <p className="progress-leaderboard-info" data-testid="progress-leaderboard-info">
          {t("progressScreen.leaderboard.info")}
          {infoUpdatedAt === null ? null : (
            <>
              <br />
              <br />
              {infoUpdatedAt}
            </>
          )}
        </p>
      ) : null}

      <div className="progress-leaderboard-invite-row">
        <button
          type="button"
          className="primary-btn progress-leaderboard-invite-cta"
          aria-label={t("progressScreen.leaderboard.invite.actionLabel")}
          title={t("progressScreen.leaderboard.invite.actionLabel")}
          onClick={() => setIsInviteDialogOpen(true)}
          data-testid="progress-leaderboard-invite-open"
        >
          {t("progressScreen.leaderboard.invite.actionText")}
        </button>
      </div>

      <ProgressLeaderboardBody
        sourceState={sourceState}
        canRenderServerBase={canRenderServerBase}
        selectedWindowKey={selectedWindowKey}
        onSelectWindowKey={onSelectWindowKey}
      />

      {isInviteDialogOpen ? (
        <FriendInviteCreateDialog
          canCreateInvite={canRenderServerBase}
          authRedirectUrl={window.location.href}
          onClose={() => setIsInviteDialogOpen(false)}
        />
      ) : null}
    </section>
  );
}
