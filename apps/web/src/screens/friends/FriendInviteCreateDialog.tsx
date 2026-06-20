import { useState, type ReactElement } from "react";
import { createPortal } from "react-dom";
import {
  ApiError,
  buildLoginUrl,
  createFriendInvitation,
  isAuthRedirectError,
} from "../../api";
import { isExpectedClipboardWriteError } from "../../access/browserAccess";
import { useAppData } from "../../appData";
import { useAppErrorDialog } from "../../appError/AppErrorContext";
import { useI18n } from "../../i18n";
import type { FriendInvitationCreateResponse } from "../../types";
import { validateFriendInvitationDisplayName } from "../invite/friendInvitationDisplayName";

type FriendInviteCreateDialogProps = Readonly<{
  canCreateInvite: boolean;
  authRedirectUrl: string;
  onClose: () => void;
}>;

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isExpectedFriendInvitationCreateError(error: unknown): boolean {
  return error instanceof ApiError
    && error.statusCode >= 400
    && error.statusCode < 500
    && (
      error.code === "FRIEND_INVITATION_DISPLAY_NAME_INVALID"
      || error.code === "FRIEND_INVITATION_HUMAN_AUTH_REQUIRED"
      || error.code === "FRIEND_INVITATION_LIMIT_REACHED"
    );
}

export function FriendInviteCreateDialog(props: FriendInviteCreateDialogProps): ReactElement {
  const { authRedirectUrl, canCreateInvite, onClose } = props;
  const { activeWorkspace, cloudSettings, session } = useAppData();
  const { showTechnicalError } = useAppErrorDialog();
  const { locale, t, formatDateTime } = useI18n();
  const [friendDisplayName, setFriendDisplayName] = useState<string>("");
  const [fieldErrorMessage, setFieldErrorMessage] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [createdInvite, setCreatedInvite] = useState<FriendInvitationCreateResponse | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isCopying, setIsCopying] = useState<boolean>(false);
  const [isSharing, setIsSharing] = useState<boolean>(false);
  const technicalErrorMessage = t("appError.technicalError.message");

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

      if (isExpectedFriendInvitationCreateError(error)) {
        setErrorMessage(getErrorMessage(error));
        return;
      }

      const wasCaptured = showTechnicalError(error, {
        feature: "progress",
        operation: "friend_invitation_create",
        userId: session?.userId ?? null,
        workspaceId: activeWorkspace?.workspaceId ?? null,
        installationId: cloudSettings?.installationId ?? null,
        entityId: null,
      });
      setErrorMessage(wasCaptured ? technicalErrorMessage : getErrorMessage(error));
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
        setErrorMessage(t("progressScreen.leaderboard.invite.clipboardUnavailable"));
        return;
      }

      await navigator.clipboard.writeText(createdInvite.inviteUrl);
      setStatusMessage(t("progressScreen.leaderboard.invite.copied"));
    } catch (error) {
      if (isExpectedClipboardWriteError(error)) {
        setErrorMessage(t("progressScreen.leaderboard.invite.clipboardUnavailable"));
        return;
      }

      const wasCaptured = showTechnicalError(error, {
        feature: "progress",
        operation: "friend_invitation_copy",
        userId: session?.userId ?? null,
        workspaceId: activeWorkspace?.workspaceId ?? null,
        installationId: cloudSettings?.installationId ?? null,
        entityId: null,
      });
      setErrorMessage(wasCaptured ? technicalErrorMessage : getErrorMessage(error));
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
        setErrorMessage(t("progressScreen.leaderboard.invite.shareUnavailable"));
        return;
      }

      await navigator.share({
        title: t("progressScreen.leaderboard.invite.shareTitle"),
        text: t("progressScreen.leaderboard.invite.shareText"),
        url: createdInvite.inviteUrl,
      });
      setStatusMessage(t("progressScreen.leaderboard.invite.shared"));
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }

      const wasCaptured = showTechnicalError(error, {
        feature: "progress",
        operation: "friend_invitation_share",
        userId: session?.userId ?? null,
        workspaceId: activeWorkspace?.workspaceId ?? null,
        installationId: cloudSettings?.installationId ?? null,
        entityId: null,
      });
      setErrorMessage(wasCaptured ? technicalErrorMessage : getErrorMessage(error));
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
            <a className="primary-btn" href={buildLoginUrl(authRedirectUrl, locale)}>
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
