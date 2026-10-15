import { useEffect, useRef, useState, type ReactElement } from "react";
import { buildLoginUrl, getPreferredAuthUiLocale } from "../../../api/authUrls";
import { track } from "../../../analytics";
import { useAppData } from "../../../appData";
import { getAppConfig } from "../../../config";
import { useI18n, type TranslationKey } from "../../../i18n";
import { clearAccountMethodReturn, readAccountMethodReturn } from "../../../api/accountMethodReturn";
import { AccountMethodError, beginEmailMethod, beginProviderMethod, completeEmailMethod, getAccountMethods, getBrowserProviders,
  unlinkProviderMethod, verifyAccountMethodOwner, type AccountMethods as Methods, type AccountProvider, type MethodOperation, type MethodProof } from "../../../api/accountMethods";
import { clearPendingMethod, readPendingMethod, storePendingMethod } from "./accountMethodPending";
import { AccountMethodButton } from "./AccountMethodButton";

type Proof = Readonly<{ value: MethodProof; expiresAt: number }>;
type EmailChallenge = Readonly<{ attempt: string; csrfToken: string; expiresAt: number }>;
function errorKey(code: string): TranslationKey {
  switch (code) {
    case "SESSION_REQUIRED": case "SESSION_REVOKED": case "ACCOUNT_DELETED": return "app.signInAgain";
    case "BROWSER_STORAGE_UNAVAILABLE": return "appError.storageUnavailable.message";
    case "LAST_USABLE_METHOD": return "accountMethods.lastUsable";
    case "PROVIDER_METHOD_CHANGED": return "accountMethods.changed";
    case "PROVIDER_METHOD_CLEANUP_REQUIRED": case "APPLE_REVOCATION_PENDING": return "accountMethods.cleanup";
    case "PROVIDER_ENROLLMENT_CONFLICT": return "accountMethods.conflict";
    default: return "accountMethods.fresh";
  }
}
function providerName(provider: AccountProvider): string { return provider === "google" ? "Google" : "Apple"; }

export function AccountMethods(): ReactElement {
  const { session } = useAppData();
  const { t } = useI18n();
  const [methods, setMethods] = useState<Methods | null>(null);
  const [available, setAvailable] = useState<ReadonlyArray<AccountProvider>>([]);
  const [operation, setOperation] = useState<MethodOperation | null>(null);
  const [proof, setProof] = useState<Proof | null>(null);
  const [challenge, setChallenge] = useState<EmailChallenge | null>(null);
  const [code, setCode] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<boolean>(true);
  const [alreadyLinked, setAlreadyLinked] = useState<boolean>(false);
  const [completed, setCompleted] = useState<boolean>(false);
  const controller = useRef<AbortController | null>(null);
  const running = useRef<boolean>(false);
  const userId = session?.userId ?? null;

  useEffect(() => {
    const current = new AbortController();
    controller.current = current;
    running.current = true;
    setBusy(true); setMethods(null); setAvailable([]); setOperation(null); setProof(null); setChallenge(null); setCode(""); setError(null); setCompleted(false); setAlreadyLinked(false);
    if (userId === null) { setBusy(false); running.current = false; return () => current.abort(); }
    void (async () => {
      try {
        await verifyAccountMethodOwner(userId, current.signal);
        const [loaded, providers] = await Promise.all([getAccountMethods(current.signal), getBrowserProviders(current.signal)]);
        if (current.signal.aborted) return;
        setMethods(loaded); setAvailable(providers);
        const returned = readAccountMethodReturn();
        const pending = readPendingMethod(userId);
        if (pending !== null) {
          if (returned?.status === "reauthenticated" && returned.completion !== null && pending.phase === "reauth") {
            setOperation(pending.operation);
            setProof({ value: { csrfToken: pending.csrfToken, completion: returned.completion },
              expiresAt: Math.min(pending.expiresAt, Date.now() + 120_000) });
          } else if (returned?.status === "account_method_completed" && pending.phase === "mutation") {
            const confirmed = loaded.methods.some((method) => method.status === "active" && method.provider === pending.operation.provider
              && (pending.operation.kind === "reenable" ? method.providerSubject === pending.operation.target.providerSubject
                && method.generation !== pending.operation.target.generation
                : !pending.baseline.some((previous) => previous.provider === method.provider && previous.providerSubject === method.providerSubject
                  && previous.generation === method.generation)));
            if (confirmed) {
              setCompleted(true);
            } else if (pending.operation.kind === "link" && returned.linkOutcome === "already_linked"
              && loaded.methods.some((method) => method.status === "active" && method.provider === pending.operation.provider
                && pending.baseline.some((previous) => previous.provider === method.provider
                  && previous.providerSubject === method.providerSubject && previous.generation === method.generation))) {
              setAlreadyLinked(true);
            } else setError("PROVIDER_METHOD_CHANGED");
          } else setError(returned?.code ?? "AUTH_ATTEMPT_RESTART_REQUIRED");
        } else if (returned !== null) setError("AUTH_ATTEMPT_RESTART_REQUIRED");
        clearPendingMethod(); clearAccountMethodReturn();
      } catch (failure) {
        if (!current.signal.aborted) setError(failure instanceof AccountMethodError ? failure.code : "AUTH_ATTEMPT_RESTART_REQUIRED");
      } finally {
        if (!current.signal.aborted) { running.current = false; setBusy(false); }
      }
    })();
    return () => { current.abort(); };
  }, [userId]);

  useEffect(() => {
    const expiresAt = proof?.expiresAt ?? challenge?.expiresAt;
    if (expiresAt === undefined) return;
    const timer = window.setTimeout(() => { setProof(null); setChallenge(null); setOperation(null); setCode(""); setError("AUTH_ATTEMPT_RESTART_REQUIRED"); },
      Math.max(0, expiresAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [proof, challenge]);

  async function run(action: (signal: AbortSignal) => Promise<void>): Promise<void> {
    const current = controller.current;
    if (running.current || current === null || current.signal.aborted) return;
    running.current = true; setBusy(true); setError(null); setCompleted(false); setAlreadyLinked(false);
    try {
      if (userId === null) throw new AccountMethodError("SESSION_REQUIRED");
      await verifyAccountMethodOwner(userId, current.signal);
      if (!current.signal.aborted) await action(current.signal);
    }
    catch (failure) {
      if (current.signal.aborted) return;
      setProof(null); setChallenge(null); setOperation(null); setCode("");
      clearAccountMethodReturn();
      const failureCode = failure instanceof AccountMethodError ? failure.code : "AUTH_ATTEMPT_RESTART_REQUIRED";
      setError(failureCode);
      setMethods(null);
      try { clearPendingMethod(); }
      catch { setError("BROWSER_STORAGE_UNAVAILABLE"); return; }
      if (failureCode === "SESSION_REQUIRED") return;
      try {
        const loaded = await getAccountMethods(current.signal);
        if (!current.signal.aborted) setMethods(loaded);
      } catch { if (!current.signal.aborted) setMethods(null); }
    } finally { if (!current.signal.aborted) { running.current = false; setBusy(false); } }
  }

  function select(next: MethodOperation): void {
    if (running.current) return;
    setOperation(next); setProof(null); setChallenge(null); setCode(""); setError(null); setCompleted(false); setAlreadyLinked(false);
  }
  function reset(): void {
    if (running.current) return;
    setOperation(null); setProof(null); setChallenge(null); setCode("");
    clearAccountMethodReturn();
    void run(async (signal) => {
      clearPendingMethod();
      setMethods(null);
      const [loaded, providers] = await Promise.all([getAccountMethods(signal), getBrowserProviders(signal)]);
      if (signal.aborted) return;
      setMethods(loaded); setAvailable(providers);
    });
  }
  function reauthenticate(provider: AccountProvider): void {
    if (methods === null || operation === null || userId === null) return;
    const csrfToken = methods.csrfToken;
    track({ name: "auth_method_selected", method: provider, screen: "settings" });
    void run(async (signal) => {
      const started = await beginProviderMethod(provider, csrfToken, null, null,
        getAppConfig().appBaseUrl + "/settings/account-status", signal);
      if (signal.aborted) return;
      storePendingMethod({ userId, operation, csrfToken, phase: "reauth", provider, baseline: methods.methods, expiresAt: started.expiresAt });
      track({ name: "auth_provider_requested", method: provider, screen: "settings" });
      window.location.assign(started.authorizationUrl);
    });
  }
  function requestEmail(): void {
    if (methods === null) return;
    const csrfToken = methods.csrfToken;
    track({ name: "auth_method_selected", method: "email", screen: "settings" });
    setCode("");
    void run(async (signal) => {
      const started = await beginEmailMethod(csrfToken, signal);
      if (signal.aborted) return;
      setChallenge({ ...started, csrfToken });
      track({ name: "auth_code_request_finished", method: "email", screen: "settings", action: "initial", outcome: "accepted" });
      track({ name: "auth_code_form_shown", method: "email", screen: "settings" });
    });
  }
  function verifyEmail(): void {
    if (challenge === null || challenge.expiresAt <= Date.now()) { setError("AUTH_ATTEMPT_RESTART_REQUIRED"); return; }
    const current = challenge;
    setChallenge(null); setCode("");
    track({ name: "auth_code_submitted", method: "email", screen: "settings" });
    void run(async (signal) => {
      const accepted = await completeEmailMethod(current.csrfToken, current.attempt, code, signal);
      if (signal.aborted) return;
      track({ name: "auth_code_verification_finished", method: "email", screen: "settings", outcome: "verified" });
      setProof({ value: accepted.proof, expiresAt: accepted.expiresAt });
    });
  }
  function mutate(): void {
    if (methods === null || operation === null || proof === null || userId === null) return;
    if (proof.expiresAt <= Date.now()) { setProof(null); setError("AUTH_ATTEMPT_RESTART_REQUIRED"); return; }
    const current = proof.value;
    const selected = operation;
    setProof(null); setOperation(null);
    void run(async (signal) => {
      if (selected.kind === "unlink") {
        await unlinkProviderMethod(methods.csrfToken, selected.target, current, signal);
        const loaded = await getAccountMethods(signal);
        if (signal.aborted) return;
        setMethods(loaded); setCompleted(true);
      } else {
        const started = await beginProviderMethod(selected.provider, methods.csrfToken, selected, current,
          getAppConfig().appBaseUrl + "/settings/account-status#status=account_method_completed", signal);
        if (signal.aborted) return;
        storePendingMethod({ userId, operation: selected, csrfToken: methods.csrfToken, phase: "mutation", provider: selected.provider, baseline: methods.methods, expiresAt: started.expiresAt });
        track({ name: "auth_provider_requested", method: selected.provider, screen: "settings" });
        window.location.assign(started.authorizationUrl);
      }
    });
  }

  return <section className="content-card" data-testid="account-methods" aria-busy={busy}>
    <h2 className="panel-subtitle">{t("accountMethods.title")}</h2>
    {busy ? <p role="status">{t("common.loading")}</p> : null}
    {methods?.methods.map((method, index) => <div key={`${method.provider}:${method.providerSubject}:${method.generation}`}>
      <strong>{providerName(method.provider)}</strong> — {t(method.status === "active" ? "common.active" : "common.disabled")}
      <p className="cell-secondary">{t("accountMethods.generation")}: <code>{method.generation}</code></p>
      {method.revocationPending ? <p>{t("accountMethods.cleanup")}</p> : null}
      {operation !== null ? null : method.status === "active"
        ? <button type="button" className="ghost-btn" disabled={busy} data-testid={`account-methods-unlink-${index}`}
          onClick={() => select({ kind: "unlink", provider: method.provider, target: method })}>{t("accountMethods.unlink")}</button>
        : !method.revocationPending && available.includes(method.provider)
          ? <button type="button" className="ghost-btn" disabled={busy} data-testid={`account-methods-reenable-${index}`}
            onClick={() => select({ kind: "reenable", provider: method.provider, target: method })}>{t("accountMethods.reenable")}</button> : null}
    </div>)}
    {methods === null ? null : <>
      <p>{t("accountMethods.readOnly")}</p>
      {methods.verifiedRecoveryEmails.map((email) => <p key={email}>{email}</p>)}
      {operation === null ? <div className="screen-actions">{available.map((provider) => <AccountMethodButton key={provider} provider={provider}
        label={`${t("accountMethods.link")}: ${providerName(provider)}`} disabled={busy} testId={`account-methods-link-${provider}`}
        onClick={() => select({ kind: "link", provider })}/>)}</div> : <div>
        <h3>{t(`accountMethods.${operation.kind}`)}: {providerName(operation.provider)}</h3>
        {proof !== null ? <>
          <p>{operation.kind === "unlink" ? t("accountMethods.unlink") : t("accountMethods.confirmNewProvider")}</p>
          {operation.kind === "unlink" ? <button type="button" className="ghost-btn" disabled={busy} onClick={mutate}
            data-testid="account-methods-confirm-unlink">{t("accountMethods.unlink")}</button>
            : <AccountMethodButton provider={operation.provider} label={providerName(operation.provider)} disabled={busy}
              onClick={mutate} testId="account-methods-confirm-provider"/>}
        </> : challenge !== null ? <form onSubmit={(event) => { event.preventDefault(); verifyEmail(); }}>
          <label htmlFor="account-method-code">{t("accountMethods.codePrompt")}</label>
          <input id="account-method-code" data-testid="account-methods-code" value={code} disabled={busy} required
            autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6,8}" minLength={6} maxLength={8}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 8))}/>
          <button type="submit" className="ghost-btn" disabled={busy} data-testid="account-methods-verify">{t("common.continue")}</button>
        </form> : <>
          <p>{t("accountMethods.confirmCurrent")}</p>
          <div className="screen-actions">{available.filter((provider) => methods.methods.some((method) => method.provider === provider && method.status === "active"))
            .map((provider) => <AccountMethodButton key={provider} provider={provider} label={providerName(provider)} disabled={busy}
              onClick={() => reauthenticate(provider)} testId={`account-methods-reauth-${provider}`}/>)}
            <AccountMethodButton provider="email" label={t("accountStatus.labels.email")} disabled={busy} onClick={requestEmail}
              testId="account-methods-reauth-email"/>
          </div>
        </>}
        <button type="button" className="ghost-btn" disabled={busy} onClick={reset} data-testid="account-methods-cancel">{t("common.cancel")}</button>
      </div>}
    </>}
    {error === null ? null : <p role="alert" data-testid="account-methods-error">{t(errorKey(error))} <code>{error}</code></p>}
    {error === "SESSION_REQUIRED" || error === "SESSION_REVOKED" || error === "ACCOUNT_DELETED" ? <a className="ghost-btn"
      href={buildLoginUrl(getAppConfig().appBaseUrl + "/settings/account-status", getPreferredAuthUiLocale())}>{t("app.signInAgain")}</a> : null}
    {completed ? <p role="status">{t("common.ok")}</p> : null}
    {alreadyLinked ? <p role="status" data-testid="account-methods-already-linked">{t("accountMethods.alreadyLinked")}</p> : null}
    <button type="button" className="ghost-btn" disabled={busy} onClick={reset} data-testid="account-methods-refresh">{t("common.refresh")}</button>
  </section>;
}
