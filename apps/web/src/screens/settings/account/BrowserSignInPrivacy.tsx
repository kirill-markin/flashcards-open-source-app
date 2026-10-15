import { useAppData } from "../../../appData";
import { type ReactElement, useEffect, useRef, useState } from "react";
import { buildLogoutUrl } from "../../../api";
import { forgetBrowserSignInInformation } from "../../../api/browserHints";
import { useI18n } from "../../../i18n";
import { leaveSignedInAccount } from "../../../SignOutLink";

export function BrowserSignInPrivacy(): ReactElement {
  const { t } = useI18n();
  const { session } = useAppData();
  const task = useRef<number>(0);
  const running = useRef<boolean>(false);
  const [busy, setBusy] = useState<boolean>(false);
  const [forgotten, setForgotten] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);
  useEffect(() => () => { task.current += 1; }, [session?.userId]);

  async function forget(): Promise<boolean> {
    if (running.current) return false;
    running.current = true;
    const current = ++task.current;
    setBusy(true);
    setError(null);
    setForgotten(false);
    try {
      await forgetBrowserSignInInformation();
      if (task.current !== current) return false;
      setForgotten(true);
      return true;
    } catch (failure) {
      if (task.current === current) setError(failure instanceof Error ? failure : new Error(String(failure)));
      return false;
    } finally {
      running.current = false;
      if (task.current === current) setBusy(false);
    }
  }

  async function signOutAndForget(): Promise<void> {
    if (!await forget()) return;
    running.current = true;
    setBusy(true);
    try { await leaveSignedInAccount(buildLogoutUrl()); }
    catch (failure) {
      setError(failure instanceof Error ? failure : new Error(String(failure)));
      running.current = false;
      setBusy(false);
    }
  }

  return <div className="content-card" aria-busy={busy}>
    <div className="screen-actions">
      <button className="ghost-btn" type="button" disabled={busy} onClick={() => { void forget(); }}>
        {t("browserSignInPrivacy.forget")}
      </button>
      <button className="ghost-btn" type="button" disabled={busy} onClick={() => { void signOutAndForget(); }}>
        {t("browserSignInPrivacy.signOutForget")}
      </button>
    </div>
    {forgotten ? <p role="status">{t("browserSignInPrivacy.forgotten")}</p> : null}
    {error === null ? null : <div role="alert">
      <p>{t("browserSignInPrivacy.error")}</p>
      <details><summary>{t("appError.technicalError.detailsToggle")}</summary>{error.message}</details>
    </div>}
  </div>;
}
