import type { ReactElement, Ref } from "react";
import { Link } from "react-router-dom";
import { buildLoginUrl } from "../../../api";
import { resolveBestLeaderboardPlacement } from "../../../appData/progress/leaderboardPlacement";
import { useI18n } from "../../../i18n";
import { settingsLeaderboardParticipationRoute } from "../../../routes";
import type {
  ProgressLeaderboardSourceState,
  ProgressLeaderboardWindow,
  ProgressLeaderboardWindowKey,
} from "../../../types";
import { progressLeaderboardWindowKeys } from "../../../types";

const millisecondsPerMinute = 60_000;

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

function getLeaderboardElapsedMinutes(snapshotGeneratedAt: string, now: Date): number {
  const snapshotTime = new Date(snapshotGeneratedAt).getTime();
  if (Number.isNaN(snapshotTime)) {
    throw new Error(`Invalid leaderboard snapshot timestamp: ${snapshotGeneratedAt}`);
  }

  return Math.floor(Math.max(0, now.getTime() - snapshotTime) / millisecondsPerMinute);
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

function ProgressLeaderboardRows(props: Readonly<{
  window: ProgressLeaderboardWindow;
}>): ReactElement {
  const { t, formatNumber } = useI18n();
  const { window: leaderboardWindow } = props;

  return (
    <ol className="progress-leaderboard-list">
      {leaderboardWindow.rows.map((row, rowIndex) => {
        if (row.kind === "gap") {
          return (
            <li
              key={`leaderboard-gap-${rowIndex}`}
              className="progress-leaderboard-row progress-leaderboard-gap"
              data-kind="gap"
              data-testid="progress-leaderboard-row-gap"
              aria-hidden="true"
            >
              <span className="progress-leaderboard-gap-dots">…</span>
            </li>
          );
        }

        const rowClassName = row.kind === "viewer"
          ? "progress-leaderboard-row progress-leaderboard-row-viewer"
          : "progress-leaderboard-row";

        return (
          <li
            key={`${row.publicProfileId}-${row.rank}`}
            className={rowClassName}
            data-kind={row.kind}
            data-testid={`progress-leaderboard-row-${row.kind}`}
          >
            <span className="progress-leaderboard-rank">
              {t("progressScreen.leaderboard.rankLabel", { rank: formatNumber(row.rank) })}
            </span>
            <span className="progress-leaderboard-name">
              {row.kind === "viewer" ? t("progressScreen.leaderboard.you") : row.anonymousDisplayName}
            </span>
            <span className="progress-leaderboard-count" data-testid={`progress-leaderboard-count-${row.kind}`}>
              {formatNumber(row.qualifiedReviewCount)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function ProgressLeaderboardBody(props: ProgressLeaderboardBodyProps): ReactElement {
  const { t } = useI18n();
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
        <ProgressLeaderboardRows window={leaderboardWindow} />
      )}
    </>
  );
}

export function ProgressLeaderboardSection(props: ProgressLeaderboardSectionProps): ReactElement {
  const { t, formatNumber } = useI18n();
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
      minutes: formatNumber(getLeaderboardElapsedMinutes(leaderboardWindow.snapshotGeneratedAt, new Date())),
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

      <ProgressLeaderboardBody
        sourceState={sourceState}
        canRenderServerBase={canRenderServerBase}
        selectedWindowKey={selectedWindowKey}
        onSelectWindowKey={onSelectWindowKey}
      />
    </section>
  );
}
