import { useState, type ReactElement } from "react";
import { buildLoginUrl } from "../../../../api";
import { useAppData } from "../../../../appData";
import { beginGuestSignIn } from "../../../../appData/session/guest/browserGuestConversion";
import { useI18n } from "../../../../i18n";
import { GuestAccountAttentionBadge } from "./GuestAccountAttentionBadge";

export function GuestSignIn(props: Readonly<{ label: string; testId: string; returnUrl?: string; onStarted?: () => void; onPressed?: () => void; guestAccountAttention?: boolean }>): ReactElement {
  const { session, activeWorkspace, isSessionVerified, drainGuestWorkspace, setErrorMessage } = useAppData();
  const { locale, t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function signIn(): Promise<void> {
    if (busy || !isSessionVerified || session === null || activeWorkspace === null) return;
    setBusy(true); setError(""); props.onPressed?.();
    try {
      if (session.browserGuestCapabilities?.isGuest === true) {
        await beginGuestSignIn(session.userId, activeWorkspace.workspaceId, drainGuestWorkspace);
      }
      props.onStarted?.();
      window.location.assign(buildLoginUrl(props.returnUrl ?? window.location.origin + "/", locale));
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : String(failure);
      setError(message);
      setErrorMessage(message);
      setBusy(false);
    }
  }
  return <span className="guest-sign-in-control">
    <button type="button" className={`primary-btn${props.guestAccountAttention ? " guest-account-attention-target" : ""}`} data-testid={props.testId} disabled={busy || !isSessionVerified}
      aria-busy={busy} onClick={() => void signIn()}>
      {busy ? t("accentColorSettings.saving") : props.label}
      {props.guestAccountAttention ? <GuestAccountAttentionBadge /> : null}
    </button>
    {error === "" ? null : <span role="alert" className="error-banner">{error}</span>}
  </span>;
}
