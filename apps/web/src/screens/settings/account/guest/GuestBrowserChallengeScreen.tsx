import { useEffect, useRef, useState, type ReactElement } from "react";
import { buildLoginUrl } from "../../../../api";
import { submitGuestBrowserChallengeToken, type GuestBrowserChallenge } from "../../../../appData/session/guest/guestBrowserChallenge";
import { useI18n } from "../../../../i18n";
import { guestSessionTurnstileAction, loadTurnstile } from "./turnstile";

type WidgetState =
  | Readonly<{ status: "loading" | "ready" | "load_failed" }>
  | Readonly<{ status: "check_failed"; errorCode: string }>;

/** Shown only while guest creation waits for a Turnstile token; the gate removes it once creation settles. */
export function GuestBrowserChallengeScreen(props: Readonly<{ challenge: GuestBrowserChallenge }>): ReactElement {
  const { locale, t } = useI18n();
  const widgetContainerRef = useRef<HTMLDivElement | null>(null);
  const [widgetState, setWidgetState] = useState<WidgetState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const { siteKey } = props.challenge;
  const isAwaitingToken = props.challenge.status === "awaiting_token";
  const previousTokenRejected = props.challenge.status === "awaiting_token" && props.challenge.previousTokenRejected;

  useEffect(() => {
    if (isAwaitingToken === false) return undefined;
    const container = widgetContainerRef.current;
    if (container === null) throw new Error("The browser check container is not mounted.");
    let isCurrent = true;
    let widgetId: string | null = null;
    setWidgetState({ status: "loading" });
    loadTurnstile().then((turnstile) => {
      if (isCurrent === false) return;
      // Automatic retries stay off so a failure surfaces here with a retry the user controls.
      widgetId = turnstile.render(container, {
        sitekey: siteKey,
        action: guestSessionTurnstileAction,
        retry: "never",
        callback: (token) => { if (isCurrent) submitGuestBrowserChallengeToken(token); },
        // Returning true tells Turnstile this screen handles the error.
        "error-callback": (errorCode) => {
          if (isCurrent) setWidgetState({ status: "check_failed", errorCode });
          return true;
        },
      }) ?? null;
      setWidgetState({ status: widgetId === null ? "load_failed" : "ready" });
    }).catch(() => {
      if (isCurrent) setWidgetState({ status: "load_failed" });
    });
    return () => {
      isCurrent = false;
      if (widgetId !== null) window.turnstile?.remove(widgetId);
    };
  }, [attempt, isAwaitingToken, siteKey]);

  const errorMessage = isAwaitingToken === false ? null
    : widgetState.status === "load_failed" ? t("guest.browserCheck.loadFailed")
      : widgetState.status === "check_failed" ? `${t("guest.browserCheck.failed")} (${widgetState.errorCode})`
        : previousTokenRejected ? t("guest.browserCheck.rejected") : null;
  const statusMessage = isAwaitingToken === false ? t("guest.browserCheck.verifying")
    : widgetState.status === "loading" ? t("guest.browserCheck.loading") : null;
  const canRetry = isAwaitingToken && (widgetState.status === "load_failed" || widgetState.status === "check_failed");

  return <main className="page-state" data-testid="guest-browser-check">
    <section className="panel panel-center state-panel" aria-busy={statusMessage !== null}>
      <h1 className="title">{t("guest.browserCheck.title")}</h1>
      <p className="subtitle">{t("guest.browserCheck.description")}</p>
      <div ref={widgetContainerRef} className="guest-browser-check-widget" data-testid="guest-browser-check-widget" hidden={isAwaitingToken === false} />
      {statusMessage === null ? null : <>
        <span className="page-state-spinner" aria-hidden="true" />
        <p className="subtitle" role="status">{statusMessage}</p>
      </>}
      {errorMessage === null ? null : <p role="alert" className="error-banner" data-testid="guest-browser-check-error">{errorMessage}</p>}
      <div className="guest-sign-in-control">
        {canRetry ? <button type="button" className="primary-btn" data-testid="guest-browser-check-retry"
          onClick={() => setAttempt((value) => value + 1)}>{t("common.retry")}</button> : null}
        <a className="ghost-btn" data-testid="guest-browser-check-sign-in" href={buildLoginUrl(window.location.href, locale)}>{t("guest.signIn")}</a>
      </div>
    </section>
  </main>;
}
