import { useEffect, useState, type ReactElement } from "react";
import { Link, useParams } from "react-router-dom";
import {
  acceptFriendInvitation,
  buildLoginUrl,
  getOptionalSession,
  isAuthRedirectError,
  previewFriendInvitation,
} from "../../api";
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

const iosAppLink = "https://apps.apple.com/us/app/flashcards-open-source-app/id6760538964";
const androidAppLink = "https://play.google.com/store/apps/details?id=com.flashcardsopensourceapp.app&pcampaignid=web_share";

function readInviteTokenParam(token: string | undefined): string {
  if (token === undefined || token === "") {
    throw new Error("Missing friend invite token route parameter");
  }

  return token;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
    <div className="invite-link-grid" data-testid="friend-invite-success-links">
      <a className="ghost-btn" href={iosAppLink} rel="noreferrer" target="_blank">
        {t("friendInvite.links.ios")}
      </a>
      <a className="ghost-btn" href={androidAppLink} rel="noreferrer" target="_blank">
        {t("friendInvite.links.android")}
      </a>
      <Link className="primary-btn" to={progressLeaderboardRoute}>
        {t("friendInvite.links.web")}
      </Link>
      <span data-testid="friend-invite-web-link-value" hidden>{webHref}</span>
    </div>
  );
}

export function FriendInviteScreen(): ReactElement {
  const { token } = useParams();
  const inviteToken = readInviteTokenParam(token);
  const { locale, t } = useI18n();
  const [loadState, setLoadState] = useState<InviteLoadState>("loading");
  const [preview, setPreview] = useState<FriendInvitationPreviewResponse | null>(null);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [friendDisplayName, setFriendDisplayName] = useState<string>("");
  const [fieldErrorMessage, setFieldErrorMessage] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [acceptedResponse, setAcceptedResponse] = useState<FriendInvitationAcceptResponse | null>(null);

  async function loadInvite(): Promise<void> {
    setLoadState("loading");
    setPreview(null);
    setSession(null);
    setErrorMessage("");
    setFieldErrorMessage("");
    setAcceptedResponse(null);

    try {
      const previewResponse = await previewFriendInvitation(inviteToken);
      setPreview(previewResponse);
      if (previewResponse.status === "inactive") {
        setLoadState("inactive");
        return;
      }

      const optionalSession = await getOptionalSession();
      setSession(optionalSession);
      setLoadState(optionalSession === null ? "signed_out" : "ready");
    } catch (error) {
      if (isAuthRedirectError(error)) {
        return;
      }

      setErrorMessage(getErrorMessage(error));
      setLoadState("error");
    }
  }

  useEffect(() => {
    void loadInvite();
  }, [inviteToken]);

  async function submitInviteAcceptance(): Promise<void> {
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
      if (isAuthRedirectError(error)) {
        return;
      }

      setErrorMessage(getErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  if (loadState === "loading") {
    return (
      <main className="invite-page">
        <section className="content-card invite-panel">
          <p className="subtitle" data-testid="friend-invite-loading">{t("friendInvite.loading")}</p>
        </section>
      </main>
    );
  }

  if (loadState === "inactive") {
    return (
      <main className="invite-page">
        <section className="content-card invite-panel" data-testid="friend-invite-inactive">
          <h1 className="title">{t("friendInvite.inactiveTitle")}</h1>
          <p className="subtitle">{t("friendInvite.inactiveBody")}</p>
          {errorMessage !== "" ? <p className="error-banner" role="alert">{errorMessage}</p> : null}
          <button className="ghost-btn" type="button" onClick={() => void loadInvite()}>
            {t("common.retry")}
          </button>
        </section>
      </main>
    );
  }

  if (loadState === "error") {
    return (
      <main className="invite-page">
        <section className="content-card invite-panel" data-testid="friend-invite-error">
          <h1 className="title">{t("friendInvite.errorTitle")}</h1>
          <p className="subtitle">{t("friendInvite.errorBody")}</p>
          {errorMessage !== "" ? <p className="error-banner" role="alert">{errorMessage}</p> : null}
          <button className="ghost-btn" type="button" onClick={() => void loadInvite()}>
            {t("common.retry")}
          </button>
        </section>
      </main>
    );
  }

  if (loadState === "signed_out") {
    return (
      <main className="invite-page">
        <section className="content-card invite-panel" data-testid="friend-invite-signed-out">
          <h1 className="title">{t("friendInvite.signInTitle")}</h1>
          <p className="subtitle">{t("friendInvite.signInBody")}</p>
          <a className="primary-btn" href={buildLoginUrl(window.location.href, locale)}>
            {t("friendInvite.signInButton")}
          </a>
        </section>
      </main>
    );
  }

  if (loadState === "success") {
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
            onChange={(event) => {
              setFriendDisplayName(event.target.value);
              setFieldErrorMessage("");
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
          disabled={isSubmitting || preview?.status !== "active"}
          onClick={() => void submitInviteAcceptance()}
          data-testid="friend-invite-accept-button"
        >
          {isSubmitting ? t("friendInvite.accepting") : t("friendInvite.accept")}
        </button>
      </section>
    </main>
  );
}
