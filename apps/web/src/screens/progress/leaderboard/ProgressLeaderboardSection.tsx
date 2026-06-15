import { useState, type ReactElement, type Ref } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import {
  buildLoginUrl,
  createFriendInvitation,
  isAuthRedirectError,
} from "../../../api";
import { resolveBestLeaderboardPlacement } from "../../../appData/progress/leaderboardPlacement";
import { useI18n } from "../../../i18n";
import { settingsLeaderboardParticipationRoute } from "../../../routes";
import type { FriendInvitationCreateResponse } from "../../../types";
import type {
  ProgressLeaderboard,
  ProgressLeaderboardSourceState,
  ProgressLeaderboardWindow,
  ProgressLeaderboardWindowKey,
} from "../../../types";
import { progressLeaderboardWindowKeys } from "../../../types";
import {
  friendInvitationDisplayNameMaxLength,
  validateFriendInvitationDisplayName,
} from "../../invite/friendInvitationDisplayName";

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

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function ProgressLeaderboardInviteDialog(props: Readonly<{
  canCreateInvite: boolean;
  onClose: () => void;
}>): ReactElement {
  const { canCreateInvite, onClose } = props;
  const { locale, t, formatDateTime } = useI18n();
  const [friendDisplayName, setFriendDisplayName] = useState<string>("");
  const [fieldErrorMessage, setFieldErrorMessage] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [createdInvite, setCreatedInvite] = useState<FriendInvitationCreateResponse | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isCopying, setIsCopying] = useState<boolean>(false);
  const [isSharing, setIsSharing] = useState<boolean>(false);

  async function submitInviteCreate(): Promise<void> {
    const validationMessage = validateFriendInvitationDisplayName(friendDisplayName, {
      required: t("progressScreen.leaderboard.invite.validation.required"),
      singleLine: t("progressScreen.leaderboard.invite.validation.singleLine"),
      tooLong: t("progressScreen.leaderboard.invite.validation.tooLong"),
    });
    setFieldErrorMessage(validationMessage);
    if (validationMessage !== "") {
      return;
    }

    setIsSubmitting(true);
    setErrorMessage("");
    setStatusMessage("");

    try {
      const response = await createFriendInvitation({
        inviteeDisplayName: friendDisplayName.trim(),
      });
      setCreatedInvite(response);
      setStatusMessage("");
    } catch (error) {
      if (isAuthRedirectError(error)) {
        return;
      }

      setErrorMessage(getErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function copyInviteLink(): Promise<void> {
    if (createdInvite === null) {
      throw new Error("Cannot copy a friend invite before it is created.");
    }

    setIsCopying(true);
    setErrorMessage("");
    setStatusMessage("");

    try {
      if (typeof navigator.clipboard?.writeText !== "function") {
        throw new Error(t("progressScreen.leaderboard.invite.clipboardUnavailable"));
      }

      await navigator.clipboard.writeText(createdInvite.inviteUrl);
      setStatusMessage(t("progressScreen.leaderboard.invite.copied"));
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setIsCopying(false);
    }
  }

  async function shareInviteLink(): Promise<void> {
    if (createdInvite === null) {
      throw new Error("Cannot share a friend invite before it is created.");
    }

    setIsSharing(true);
    setErrorMessage("");
    setStatusMessage("");

    try {
      if (typeof navigator.share !== "function") {
        throw new Error(t("progressScreen.leaderboard.invite.shareUnavailable"));
      }

      await navigator.share({
        title: t("progressScreen.leaderboard.invite.shareTitle"),
        text: t("progressScreen.leaderboard.invite.shareText"),
        url: createdInvite.inviteUrl,
      });
      setStatusMessage(t("progressScreen.leaderboard.invite.shared"));
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setIsSharing(false);
    }
  }

  return createPortal(
    <div className="progress-leaderboard-invite-backdrop" role="dialog" aria-modal="true" aria-labelledby="progress-leaderboard-invite-title">
      <section className="content-card progress-leaderboard-invite-dialog">
        <div className="progress-leaderboard-invite-dialog-head">
          <h2 id="progress-leaderboard-invite-title" className="panel-subtitle">
            {t("progressScreen.leaderboard.invite.title")}
          </h2>
          <button className="ghost-btn progress-leaderboard-invite-close" type="button" onClick={onClose}>
            {t("common.cancel")}
          </button>
        </div>

        {canCreateInvite ? (
          createdInvite === null ? (
            <>
              <p className="subtitle">{t("progressScreen.leaderboard.invite.body")}</p>
              <label className="form-label progress-leaderboard-invite-field">
                <span>{t("progressScreen.leaderboard.invite.friendNameLabel")}</span>
                <input
                  className="text-input"
                  type="text"
                  value={friendDisplayName}
                  disabled={isSubmitting}
                  maxLength={friendInvitationDisplayNameMaxLength + 1}
                  onChange={(event) => {
                    setFriendDisplayName(event.target.value);
                    setFieldErrorMessage("");
                  }}
                  data-testid="progress-leaderboard-invite-name-input"
                />
              </label>
              <p className="progress-leaderboard-invite-note">{t("progressScreen.leaderboard.invite.expiryNote")}</p>
              {fieldErrorMessage !== "" ? (
                <p className="error-banner" role="alert" data-testid="progress-leaderboard-invite-name-error">
                  {fieldErrorMessage}
                </p>
              ) : null}
              <button
                className="primary-btn"
                type="button"
                disabled={isSubmitting}
                onClick={() => void submitInviteCreate()}
                data-testid="progress-leaderboard-invite-create"
              >
                {isSubmitting ? t("progressScreen.leaderboard.invite.creating") : t("progressScreen.leaderboard.invite.create")}
              </button>
            </>
          ) : (
            <>
              <p className="subtitle">
                {t("progressScreen.leaderboard.invite.readyBody", {
                  expiresAt: formatDateTime(createdInvite.expiresAt),
                })}
              </p>
              <input
                className="text-input progress-leaderboard-invite-url"
                type="text"
                readOnly
                value={createdInvite.inviteUrl}
                aria-label={t("progressScreen.leaderboard.invite.linkLabel")}
                data-testid="progress-leaderboard-invite-url"
              />
              <div className="progress-leaderboard-invite-actions">
                <button
                  className="ghost-btn"
                  type="button"
                  disabled={isCopying}
                  onClick={() => void copyInviteLink()}
                  data-testid="progress-leaderboard-invite-copy"
                >
                  {isCopying ? t("progressScreen.leaderboard.invite.copying") : t("progressScreen.leaderboard.invite.copy")}
                </button>
                <button
                  className="ghost-btn"
                  type="button"
                  disabled={isSharing}
                  onClick={() => void shareInviteLink()}
                  data-testid="progress-leaderboard-invite-share"
                >
                  {isSharing ? t("progressScreen.leaderboard.invite.sharing") : t("progressScreen.leaderboard.invite.share")}
                </button>
              </div>
            </>
          )
        ) : (
          <div className="progress-leaderboard-placeholder" data-testid="progress-leaderboard-invite-sign-in">
            <p className="subtitle">{t("progressScreen.leaderboard.invite.signInBody")}</p>
            <a className="primary-btn" href={buildLoginUrl(window.location.href, locale)}>
              {t("progressScreen.leaderboard.signIn")}
            </a>
          </div>
        )}

        {statusMessage !== "" ? <p className="progress-leaderboard-invite-status">{statusMessage}</p> : null}
        {errorMessage !== "" ? <p className="error-banner" role="alert">{errorMessage}</p> : null}
      </section>
    </div>,
    document.body,
  );
}

function resolveLeaderboardReservedRowCount(leaderboard: ProgressLeaderboard): number {
  return leaderboard.windows.reduce(
    (currentMax, window) => Math.max(currentMax, window.rows.length),
    0,
  );
}

function ProgressLeaderboardRows(props: Readonly<{
  window: ProgressLeaderboardWindow;
  reservedRowCount: number;
}>): ReactElement {
  const { t, formatNumber } = useI18n();
  const { window: leaderboardWindow, reservedRowCount } = props;
  const paddingRowCount = Math.max(0, reservedRowCount - leaderboardWindow.rows.length);

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
          : row.friendDisplayName === undefined
            ? "progress-leaderboard-row"
            : "progress-leaderboard-row progress-leaderboard-row-friend";
        const displayName = row.kind === "viewer"
          ? t("progressScreen.leaderboard.you")
          : row.friendDisplayName ?? row.anonymousDisplayName;

        return (
          <li
            key={`${row.publicProfileId}-${row.rank}`}
            className={rowClassName}
            data-kind={row.kind}
            data-friend={row.friendDisplayName === undefined ? "false" : "true"}
            data-testid={`progress-leaderboard-row-${row.kind}`}
          >
            <span className="progress-leaderboard-rank">
              {t("progressScreen.leaderboard.rankLabel", { rank: formatNumber(row.rank) })}
            </span>
            <span className="progress-leaderboard-name">
              {displayName}
            </span>
            <span className="progress-leaderboard-count" data-testid={`progress-leaderboard-count-${row.kind}`}>
              {formatNumber(row.qualifiedReviewCount)}
            </span>
          </li>
        );
      })}
      {Array.from({ length: paddingRowCount }, (_value, index) => (
        <li
          key={`leaderboard-padding-${index}`}
          className="progress-leaderboard-row progress-leaderboard-row-padding"
          data-kind="padding"
          data-testid="progress-leaderboard-row-padding"
          aria-hidden="true"
        />
      ))}
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
        <ProgressLeaderboardRows window={leaderboardWindow} reservedRowCount={reservedRowCount} />
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
        <div className="progress-leaderboard-head-actions">
          <button
            type="button"
            className="ghost-btn progress-leaderboard-invite-btn"
            aria-label={t("progressScreen.leaderboard.invite.actionLabel")}
            title={t("progressScreen.leaderboard.invite.actionLabel")}
            onClick={() => setIsInviteDialogOpen(true)}
            data-testid="progress-leaderboard-invite-open"
          >
            <span className="progress-leaderboard-invite-icon" aria-hidden="true">+</span>
            <span>{t("progressScreen.leaderboard.invite.actionText")}</span>
          </button>
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

      <ProgressLeaderboardBody
        sourceState={sourceState}
        canRenderServerBase={canRenderServerBase}
        selectedWindowKey={selectedWindowKey}
        onSelectWindowKey={onSelectWindowKey}
      />

      {isInviteDialogOpen ? (
        <ProgressLeaderboardInviteDialog
          canCreateInvite={canRenderServerBase}
          onClose={() => setIsInviteDialogOpen(false)}
        />
      ) : null}
    </section>
  );
}
