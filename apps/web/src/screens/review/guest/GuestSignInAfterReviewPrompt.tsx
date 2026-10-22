import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { track, trackScreenViewedOnDismiss, useAnalyticsScreenView } from "../../../analytics";
import { useAppData } from "../../../appData";
import { readPendingGuestConversion } from "../../../appData/session/guest/browserGuestStorage";
import { useI18n } from "../../../i18n";
import { loadReviewEventsForSql } from "../../../localDb/reviews";
import { captureAppOperationError } from "../../../observability/appOperationObservation";
import { GuestSignIn } from "../../settings/account/guest/GuestSignIn";
import { trapFocusInsideDialog } from "../reviewDialogFocus";

type PromptState = Readonly<{ lastShownReviewCount: number; snoozedUntil: number; accepted: boolean }>;
const snoozeMillis = 7 * 24 * 60 * 60 * 1000;

export function GuestSignInAfterReviewPrompt(props: Readonly<{ blocked: boolean; onVisibilityChange: (visible: boolean) => void }>): ReactElement | null {
  const app = useAppData();
  const { t } = useI18n();
  const [count, setCount] = useState<number | null>(null);
  const [recheck, setRecheck] = useState(0);
  const [externalModalOpen, setExternalModalOpen] = useState(false);
  // One answer per showing; a ref, so `later` and with it the focus effect stay stable.
  const answeredRef = useRef(false);
  const dialog = useRef<HTMLElement | null>(null);
  const key = `guest-sign-in-after-review:${app.session?.userId ?? ""}`;
  const workspaceId = app.activeWorkspace?.workspaceId ?? null;
  const isGuest = app.session?.browserGuestCapabilities?.isGuest === true;
  const report = useCallback((failure: unknown): void => {
    captureAppOperationError(failure, { feature: "review", operation: "review_data_load", userId: app.session?.userId ?? null,
      workspaceId, installationId: app.cloudSettings?.installationId ?? null, entityId: null });
  }, [app.session?.userId, app.cloudSettings?.installationId, workspaceId]);
  useEffect(() => {
    const observeModal = (): void => {
      setExternalModalOpen(document.querySelector('dialog[open], [aria-modal="true"]:not([data-testid="guest-review-reminder"])') !== null);
    };
    const observer = new MutationObserver(observeModal);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["open", "aria-modal"] });
    document.addEventListener("close", observeModal, true);
    document.addEventListener("toggle", observeModal, true);
    observeModal();
    return () => {
      observer.disconnect();
      document.removeEventListener("close", observeModal, true);
      document.removeEventListener("toggle", observeModal, true);
    };
  }, []);
  const visible = count !== null && !props.blocked && !externalModalOpen && isGuest && app.isSessionVerified;
  useEffect(() => { if (visible) answeredRef.current = false; }, [visible]);
  useEffect(() => {
    props.onVisibilityChange(visible);
    return () => props.onVisibilityChange(false);
  }, [visible, props.onVisibilityChange]);
  useEffect(() => {
    if (!isGuest || !app.isSessionVerified || workspaceId === null || props.blocked || externalModalOpen || readPendingGuestConversion() !== null) return;
    let current = true;
    let timer: number | undefined;
    void (async () => {
      const events = await loadReviewEventsForSql(workspaceId);
      if (!current || events.length < 20 || document.querySelector('dialog[open], [aria-modal="true"]:not([data-testid="guest-review-reminder"])') !== null) return;
      const raw = localStorage.getItem(key);
      const state: PromptState | null = raw === null ? null : JSON.parse(raw) as PromptState;
      if (state !== null && (typeof state.accepted !== "boolean" || !Number.isFinite(state.snoozedUntil)
        || !Number.isFinite(state.lastShownReviewCount))) throw new Error("Saved guest review reminder is invalid.");
      if (state?.accepted || (state !== null && events.length < state.lastShownReviewCount + 10)) return;
      if (state !== null && Date.now() < state.snoozedUntil) {
        timer = window.setTimeout(() => setRecheck((value) => value + 1), Math.min(state.snoozedUntil - Date.now(), 2_147_483_647));
        return;
      }
      if (current) setCount(events.length);
    })().catch(report);
    return () => { current = false; window.clearTimeout(timer); };
  }, [isGuest, app.isSessionVerified, workspaceId, app.localReadVersion, props.blocked, externalModalOpen, key, recheck, report]);

  const later = useCallback((): void => {
    if (!answeredRef.current) {
      answeredRef.current = true;
      track({ name: "prompt_answered", prompt: "signin_after_review_prompt", outcome: "snoozed" });
    }
    trackScreenViewedOnDismiss({ dismissed: "signin_after_review_prompt", restored: "review" });
    try {
      localStorage.setItem(key, JSON.stringify({ lastShownReviewCount: count, snoozedUntil: Date.now() + snoozeMillis, accepted: false }));
      setCount(null); setRecheck((value) => value + 1);
    } catch (failure) { report(failure); }
  }, [key, count, report]);
  const signInPressed = useCallback((): void => {
    // Before sign-in's first await: starting it unverifies the session, which hides the prompt and
    // hands the stamp back to `review`. Recorded on the press, as iOS and Android do.
    if (answeredRef.current) return;
    answeredRef.current = true;
    track({ name: "prompt_answered", prompt: "signin_after_review_prompt", outcome: "accepted" });
  }, []);
  useEffect(() => {
    if (!visible) return;
    const previous = document.activeElement;
    dialog.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") { event.preventDefault(); later(); }
      if (event.key === "Tab" && dialog.current !== null) trapFocusInsideDialog(event, dialog.current);
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); if (previous instanceof HTMLElement && previous.isConnected
      && document.querySelector('dialog[open], [aria-modal="true"]:not([data-testid="guest-review-reminder"])') === null) previous.focus(); };
  }, [visible, later]);
  useAnalyticsScreenView(visible ? "signin_after_review_prompt" : null);
  if (!visible) return null;
  return <div className="review-hard-reminder-overlay">
    <section ref={dialog} className="panel review-hard-reminder-modal" role="dialog" aria-modal="true"
      aria-labelledby="guest-review-prompt-title" aria-describedby="guest-review-prompt-body" data-testid="guest-review-reminder">
      <h2 id="guest-review-prompt-title" className="title">{t("guest.saveProgress")}</h2>
      <p id="guest-review-prompt-body">{t("guest.reminder")}</p>
      <div className="screen-actions">
        <GuestSignIn label={t("guest.signIn")} testId="guest-review-sign-in" onPressed={signInPressed} onStarted={() => {
          try { localStorage.setItem(key, JSON.stringify({ lastShownReviewCount: count, snoozedUntil: 0, accepted: true })); }
          catch (failure) { report(failure); }
        }} />
        <button className="ghost-btn" type="button" data-testid="guest-review-later" onClick={later}>{t("guest.later")}</button>
      </div>
    </section>
  </div>;
}
