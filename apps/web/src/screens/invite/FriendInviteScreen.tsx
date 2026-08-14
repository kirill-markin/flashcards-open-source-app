import { useEffect, useState, type ReactElement } from "react";
import { useParams } from "react-router";
import {
  ApiError,
  acceptFriendInvitation,
  buildLoginUrl,
  getOptionalSession,
  isAuthRedirectError,
  previewFriendInvitation,
} from "../../api";
import {
  AppPlatformLinksGrid,
  buildAppPlatformOptions,
  friendInviteStoreLinks,
  resolveClientPlatform,
} from "../../appPlatformLinks";
import {
  markIndexedDbOpenRecoveryFailureAndCheckActive,
  useAppErrorDialog,
} from "../../appError/AppErrorContext";
import { invalidateServerProgress } from "../../appData/progress/invalidation/progressInvalidation";
import { clearPersistedProgressLeaderboard } from "../../appData/progress/storage/progressStorage";
import { getAppConfig } from "../../config";
import { useI18n } from "../../i18n";
import { progressLeaderboardRoute } from "../../routes";
import type {
  FriendInvitationAcceptResponse,
  FriendInvitationPreviewResponse,
  SessionInfo,
} from "../../types";
import { validateFriendInvitationDisplayName } from "./friendInvitationDisplayName";

type InviteLoadState = "loading" | "inactive" | "error" | "signed_out" | "ready" | "success";

function readInviteTokenParam(token: string | undefined): string {
  if (token === undefined || token === "") {
    throw new Error("Missing friend invite token route parameter");
  }

  return token;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function hasExpectedFriendInvitationApiCode(error: unknown, codes: ReadonlyArray<string>): boolean {
  return error instanceof ApiError
    && error.statusCode >= 400
    && error.statusCode < 500
    && error.code !== null
    && codes.includes(error.code);
}

function isExpectedFriendInvitationPreviewError(error: unknown): boolean {
  return hasExpectedFriendInvitationApiCode(error, [
    "FRIEND_INVITATION_API_KEY_AUTH_UNSUPPORTED",
    "FRIEND_INVITATION_TOKEN_REQUIRED",
  ]);
}

function isExpectedFriendInvitationAcceptError(error: unknown): boolean {
  return hasExpectedFriendInvitationApiCode(error, [
    "FRIEND_INVITATION_DISPLAY_NAME_INVALID",
    "FRIEND_INVITATION_HUMAN_AUTH_REQUIRED",
    "FRIEND_INVITATION_SELF",
    "FRIEND_INVITATION_TOKEN_REQUIRED",
  ]);
}

function isInviteAccepted(response: FriendInvitationAcceptResponse): boolean {
  return response.status === "accepted" || response.status === "already_friends";
}

function InviteMobileLinksNotice(): ReactElement {
  const { t } = useI18n();

  return (
    <p className="invite-note">
      {t("friendInvite.mobileSameEmailNote")}
    </p>
  );
}

function InviteSuccessLinks(): ReactElement {
  const { t } = useI18n();
  const webHref = `${getAppConfig().appBaseUrl}${progressLeaderboardRoute}`;

  return (
    <AppPlatformLinksGrid
      options={buildAppPlatformOptions({
        platforms: ["ios", "android", "web", "mcp"],
        storeLinks: friendInviteStoreLinks,
        webHref,
        labels: {
          ios: t("appPlatformLinks.ios"),
          android: t("appPlatformLinks.android"),
          web: t("appPlatformLinks.web"),
          mcp: t("appPlatformLinks.mcp.label"),
        },
        qrTitles: {
          ios: t("appPlatformLinks.qr.ios"),
          android: t("appPlatformLinks.qr.android"),
        },
        clientPlatform: resolveClientPlatform(navigator.userAgent),
      })}
      testIdPrefix="friend-invite-success"
    />
  );
}

type FriendInviteRetryPanelProps = Readonly<{
  errorMessage: string;
  onRetry: () => void;
}>;

type FriendInviteSignedOutPanelProps = Readonly<{
  loginHref: string;
}>;

type FriendInviteSuccessPanelProps = Readonly<{
  acceptedResponse: FriendInvitationAcceptResponse | null;
}>;

type FriendInviteReadyPanelProps = Readonly<{
  friendDisplayName: string;
  fieldErrorMessage: string;
  errorMessage: string;
  isSubmitting: boolean;
  canAccept: boolean;
  onFriendDisplayNameChange: (value: string) => void;
  onAccept: () => void;
}>;

// Dev previews for these production panels are documented in docs/web-invite-previews.md.
export function FriendInviteLoadingPanel(): ReactElement {
  const { t } = useI18n();

  return (
    <main className="invite-page">
      <section className="content-card invite-panel">
        <p className="subtitle" data-testid="friend-invite-loading">{t("friendInvite.loading")}</p>
      </section>
    </main>
  );
}

export function FriendInviteInactivePanel({ errorMessage, onRetry }: FriendInviteRetryPanelProps): ReactElement {
  const { t } = useI18n();

  return (
    <main className="invite-page">
      <section className="content-card invite-panel" data-testid="friend-invite-inactive">
        <h1 className="title">{t("friendInvite.inactiveTitle")}</h1>
        <p className="subtitle">{t("friendInvite.inactiveBody")}</p>
        {errorMessage !== "" ? <p className="error-banner" role="alert">{errorMessage}</p> : null}
        <button className="ghost-btn" type="button" onClick={onRetry}>
          {t("common.retry")}
        </button>
      </section>
    </main>
  );
}

export function FriendInviteErrorPanel({ errorMessage, onRetry }: FriendInviteRetryPanelProps): ReactElement {
  const { t } = useI18n();

  return (
    <main className="invite-page">
      <section className="content-card invite-panel" data-testid="friend-invite-error">
        <h1 className="title">{t("friendInvite.errorTitle")}</h1>
        <p className="subtitle">{t("friendInvite.errorBody")}</p>
        {errorMessage !== "" ? <p className="error-banner" role="alert">{errorMessage}</p> : null}
        <button className="ghost-btn" type="button" onClick={onRetry}>
          {t("common.retry")}
        </button>
      </section>
    </main>
  );
}

export function FriendInviteSignedOutPanel({ loginHref }: FriendInviteSignedOutPanelProps): ReactElement {
  const { t } = useI18n();

  return (
    <main className="invite-page">
      <section className="content-card invite-panel" data-testid="friend-invite-signed-out">
        <h1 className="title">{t("friendInvite.signInTitle")}</h1>
        <p className="subtitle">{t("friendInvite.signInBody")}</p>
        <a className="primary-btn" href={loginHref}>
          {t("friendInvite.signInButton")}
        </a>
      </section>
    </main>
  );
}

export function FriendInviteSuccessPanel({ acceptedResponse }: FriendInviteSuccessPanelProps): ReactElement {
  const { t } = useI18n();
  const isAlreadyFriends = acceptedResponse?.status === "already_friends";

  return (
    <main className="invite-page">
      <section className="content-card invite-panel" data-testid="friend-invite-success">
        <h1 className="title">
          {isAlreadyFriends ? t("friendInvite.alreadyFriendsTitle") : t("friendInvite.successTitle")}
        </h1>
        <p className="subtitle">
          {isAlreadyFriends && acceptedResponse?.status === "already_friends"
            ? t("friendInvite.alreadyFriendsBody", { name: acceptedResponse.existingFriendDisplayName })
            : t("friendInvite.successBody")}
        </p>
        <InviteSuccessLinks />
        <InviteMobileLinksNotice />
      </section>
    </main>
  );
}

export function FriendInviteReadyPanel({
  friendDisplayName,
  fieldErrorMessage,
  errorMessage,
  isSubmitting,
  canAccept,
  onFriendDisplayNameChange,
  onAccept,
}: FriendInviteReadyPanelProps): ReactElement {
  const { t } = useI18n();
  const hasFriendDisplayName = friendDisplayName.trim() !== "";

  return (
    <main className="invite-page">
      <section className="content-card invite-panel" data-testid="friend-invite-ready">
        <h1 className="title">{t("friendInvite.formTitle")}</h1>
        <p className="subtitle">{t("friendInvite.formBody")}</p>
        <label className="form-label invite-field">
          <span>{t("friendInvite.displayNameLabel")}</span>
          <input
            className="text-input"
            type="text"
            value={friendDisplayName}
            disabled={isSubmitting}
            placeholder={t("friendInvite.displayNamePlaceholder")}
            required
            onChange={(event) => {
              onFriendDisplayNameChange(event.target.value);
            }}
            data-testid="friend-invite-display-name-input"
          />
        </label>
        {fieldErrorMessage !== "" ? (
          <p className="error-banner" role="alert" data-testid="friend-invite-display-name-error">
            {fieldErrorMessage}
          </p>
        ) : null}
        {errorMessage !== "" ? <p className="error-banner" role="alert">{errorMessage}</p> : null}
        <button
          className="primary-btn"
          type="button"
          disabled={isSubmitting || !canAccept || !hasFriendDisplayName}
          onClick={onAccept}
          data-testid="friend-invite-accept-button"
        >
          {isSubmitting ? t("friendInvite.accepting") : t("friendInvite.accept")}
        </button>
      </section>
    </main>
  );
}

export function FriendInviteScreen(): ReactElement {
  const { token } = useParams();
  const inviteToken = readInviteTokenParam(token);
  const { indexedDbOpenRecoveryState, showTechnicalError } = useAppErrorDialog();
  const { locale, t } = useI18n();
  const [loadState, setLoadState] = useState<InviteLoadState>("loading");
  const [preview, setPreview] = useState<FriendInvitationPreviewResponse | null>(null);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [friendDisplayName, setFriendDisplayName] = useState<string>("");
  const [fieldErrorMessage, setFieldErrorMessage] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [acceptedResponse, setAcceptedResponse] = useState<FriendInvitationAcceptResponse | null>(null);
  const technicalErrorMessage = t("appError.technicalError.message");

  async function loadInvite(): Promise<void> {
    if (indexedDbOpenRecoveryState.hasFailed()) {
      return;
    }

    setLoadState("loading");
    setPreview(null);
    setSession(null);
    setErrorMessage("");
    setFieldErrorMessage("");
    setAcceptedResponse(null);

    try {
      const previewResponse = await previewFriendInvitation(inviteToken);
      indexedDbOpenRecoveryState.throwIfFailed();
      setPreview(previewResponse);
      if (previewResponse.status === "inactive") {
        setLoadState("inactive");
        return;
      }

      const optionalSession = await getOptionalSession();
      indexedDbOpenRecoveryState.throwIfFailed();
      setSession(optionalSession);
      setLoadState(optionalSession === null ? "signed_out" : "ready");
    } catch (error) {
      if (markIndexedDbOpenRecoveryFailureAndCheckActive(indexedDbOpenRecoveryState, error)) {
        return;
      }
      if (isAuthRedirectError(error)) {
        return;
      }

      if (isExpectedFriendInvitationPreviewError(error)) {
        setErrorMessage(getErrorMessage(error));
        setLoadState("error");
        return;
      }

      const wasCaptured = showTechnicalError(error, {
        feature: "progress",
        operation: "friend_invitation_preview",
        userId: null,
        workspaceId: null,
        installationId: null,
        entityId: null,
      });
      setErrorMessage(wasCaptured ? technicalErrorMessage : getErrorMessage(error));
      setLoadState("error");
    }
  }

  useEffect(() => {
    void loadInvite();
  }, [indexedDbOpenRecoveryState, inviteToken]);

  async function submitInviteAcceptance(): Promise<void> {
    if (indexedDbOpenRecoveryState.hasFailed()) {
      return;
    }

    if (session === null) {
      setErrorMessage(t("friendInvite.signInBody"));
      setLoadState("signed_out");
      return;
    }

    const validationMessage = validateFriendInvitationDisplayName(friendDisplayName, {
      required: t("friendInvite.validation.required"),
      singleLine: t("friendInvite.validation.singleLine"),
      tooLong: t("friendInvite.validation.tooLong"),
    });
    setFieldErrorMessage(validationMessage);
    if (validationMessage !== "") {
      return;
    }

    setIsSubmitting(true);
    setErrorMessage("");

    try {
      const response = await acceptFriendInvitation(inviteToken, {
        inviterDisplayName: friendDisplayName.trim(),
      });
      indexedDbOpenRecoveryState.throwIfFailed();

      if (response.status === "inactive") {
        setLoadState("inactive");
        return;
      }

      if (isInviteAccepted(response)) {
        clearPersistedProgressLeaderboard();
        invalidateServerProgress();
        setAcceptedResponse(response);
        setLoadState("success");
      }
    } catch (error) {
      if (markIndexedDbOpenRecoveryFailureAndCheckActive(indexedDbOpenRecoveryState, error)) {
        return;
      }
      if (isAuthRedirectError(error)) {
        return;
      }

      if (isExpectedFriendInvitationAcceptError(error)) {
        setErrorMessage(getErrorMessage(error));
        return;
      }

      const wasCaptured = showTechnicalError(error, {
        feature: "progress",
        operation: "friend_invitation_accept",
        userId: session.userId,
        workspaceId: null,
        installationId: null,
        entityId: null,
      });
      setErrorMessage(wasCaptured ? technicalErrorMessage : getErrorMessage(error));
    } finally {
      if (indexedDbOpenRecoveryState.hasFailed() === false) {
        setIsSubmitting(false);
      }
    }
  }

  function retryInviteLoad(): void {
    if (indexedDbOpenRecoveryState.hasFailed()) {
      return;
    }

    void loadInvite();
  }

  function updateFriendDisplayName(value: string): void {
    if (indexedDbOpenRecoveryState.hasFailed()) {
      return;
    }

    setFriendDisplayName(value);
    setFieldErrorMessage("");
  }

  function acceptInvite(): void {
    if (indexedDbOpenRecoveryState.hasFailed()) {
      return;
    }

    void submitInviteAcceptance();
  }

  if (loadState === "loading") {
    return <FriendInviteLoadingPanel />;
  }

  if (loadState === "inactive") {
    return <FriendInviteInactivePanel errorMessage={errorMessage} onRetry={retryInviteLoad} />;
  }

  if (loadState === "error") {
    return <FriendInviteErrorPanel errorMessage={errorMessage} onRetry={retryInviteLoad} />;
  }

  if (loadState === "signed_out") {
    return <FriendInviteSignedOutPanel loginHref={buildLoginUrl(window.location.href, locale)} />;
  }

  if (loadState === "success") {
    return <FriendInviteSuccessPanel acceptedResponse={acceptedResponse} />;
  }

  return (
    <FriendInviteReadyPanel
      friendDisplayName={friendDisplayName}
      fieldErrorMessage={fieldErrorMessage}
      errorMessage={errorMessage}
      isSubmitting={isSubmitting}
      canAccept={preview?.status === "active"}
      onFriendDisplayNameChange={updateFriendDisplayName}
      onAccept={acceptInvite}
    />
  );
}
