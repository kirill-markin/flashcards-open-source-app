import { useEffect, useRef, type ReactElement } from "react";
import { useI18n } from "../../../i18n";
import { GuestSignIn } from "../../settings/account/guest/GuestSignIn";
import { trapFocusInsideDialog } from "../reviewDialogFocus";

export type GuestSignInAfterReviewPromptProps = Readonly<{
  isOpen: boolean;
  onLater: () => void;
  onSignInPressed: () => void;
}>;

export function GuestSignInAfterReviewPrompt(props: GuestSignInAfterReviewPromptProps): ReactElement | null {
  const { isOpen, onLater, onSignInPressed } = props;
  const { t } = useI18n();
  const dialog = useRef<HTMLElement | null>(null);
  // A ref, so the focus effect runs once per showing rather than on every parent render.
  const onLaterRef = useRef(onLater);
  onLaterRef.current = onLater;
  useEffect(() => {
    if (!isOpen) return;
    const previous = document.activeElement;
    dialog.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") { event.preventDefault(); onLaterRef.current(); }
      if (event.key === "Tab" && dialog.current !== null) trapFocusInsideDialog(event, dialog.current);
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); if (previous instanceof HTMLElement && previous.isConnected
      && document.querySelector('dialog[open], [aria-modal="true"]:not([data-testid="guest-review-reminder"])') === null) previous.focus(); };
  }, [isOpen]);
  if (!isOpen) return null;
  return <div className="review-hard-reminder-overlay">
    <section ref={dialog} className="panel review-hard-reminder-modal" role="dialog" aria-modal="true"
      aria-labelledby="guest-review-prompt-title" aria-describedby="guest-review-prompt-body" data-testid="guest-review-reminder">
      <h2 id="guest-review-prompt-title" className="title">{t("guest.saveProgress")}</h2>
      <p id="guest-review-prompt-body">{t("guest.reminder")}</p>
      <div className="screen-actions">
        <GuestSignIn label={t("guest.signIn")} testId="guest-review-sign-in" onPressed={onSignInPressed} />
        <button className="ghost-btn" type="button" data-testid="guest-review-later" onClick={onLater}>{t("guest.later")}</button>
      </div>
    </section>
  </div>;
}
