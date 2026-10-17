import { useEffect, useRef, useState, type ReactElement } from "react";
import { track } from "../../../analytics";
import { useI18n, type TranslationKey } from "../../../i18n";
import { clearAccountMethodReturn, readAccountMethodReturn } from "../../../api/accountMethodReturn";
import { AccountMethodError, beginEmailMethod, beginProviderMethod, completeEmailMethod, verifyAccountMethodOwner,
  type AccountMethods, type AccountProvider } from "../../../api/accountMethods";
import { accountConnection, accountConnectionReturnUrl, connectionProviderUrl, type ConnectionResponse } from "../../../api/accountConnection";
import { clearPendingConnection, readPendingConnection, storePendingConnection, type PendingConnection } from "./accountConnectionPending";
import { AccountMethodButton } from "./AccountMethodButton";

type Operation = Extract<PendingConnection, { phase: "operation" }>;
type Challenge = Readonly<{ kind: "source"; attempt: string; email: string }> | Readonly<{ kind: "target"; email: string }>;
function errorKey(code: string): TranslationKey {
  switch (code) {
    case "ACCOUNT_CONNECTION_PREVIEW_CHANGED": return "accountConnection.changed";
    case "SESSION_REQUIRED": case "SESSION_REVOKED": case "ACCOUNT_DELETED": return "app.signInAgain";
    case "BROWSER_STORAGE_UNAVAILABLE": return "appError.storageUnavailable.message";
    default: return "accountMethods.fresh";
  }
}
export function AccountConnection(props: Readonly<{ userId: string | null; methods: AccountMethods; providers: ReadonlyArray<AccountProvider>;
  disabled: boolean; onActiveChange: (active: boolean) => void; onCommitted: (signal: AbortSignal) => Promise<void> }>): ReactElement {
  const { t } = useI18n();
  const [open, setOpen] = useState<boolean>(false);
  const [pending, setPending] = useState<PendingConnection | null>(null);
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [email, setEmail] = useState<string>("");
  const [code, setCode] = useState<string>("");
  const [accepted, setAccepted] = useState<boolean>(false);
  const [completed, setCompleted] = useState<"connected" | "already_connected" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<boolean>(false);
  const controller = useRef<AbortController | null>(null);
  const running = useRef<boolean>(false);
  const { userId, onActiveChange } = props;

  function save(next: PendingConnection): void { storePendingConnection(next); setPending(next); }
  function finish(status: "connected" | "already_connected" | "cancelled"): void {
    clearPendingConnection(); setPending(null); setChallenge(null); setAccepted(false); setCode("");
    setCompleted(status === "cancelled" ? null : status); setOpen(status !== "cancelled"); onActiveChange(false);
  }
  async function preview(current: Operation, omittedWorkspaceIds: ReadonlyArray<string>, signal: AbortSignal): Promise<void> {
    setAccepted(false);
    const result = await accountConnection(current.csrfToken, { action: "preview", operation: current.operation, omittedWorkspaceIds }, signal);
    if (signal.aborted) return;
    if (result.status !== "preview" || result.operation !== current.operation || result.choices.operationId !== current.operationId) {
      throw new AccountMethodError("AUTH_COMPLETION_INVALID");
    }
    save({ ...current, preview: result, consent: null }); setChallenge(null);
  }
  async function receive(result: ConnectionResponse, current: PendingConnection, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return;
    if (result.status === "cancelled") { finish(result.status); return; }
    if (result.status === "already_connected") {
      await props.onCommitted(signal);
      if (!signal.aborted) finish("already_connected");
      return;
    }
    if (result.status === "connected") {
      if (current.phase !== "operation" || result.operationId !== current.operationId) throw new AccountMethodError("AUTH_COMPLETION_INVALID");
      await props.onCommitted(signal);
      if (!signal.aborted) finish("connected");
      return;
    }
    if (result.status === "proof_required" || result.status === "proved") {
      if (current.phase === "operation" && (current.operation !== result.receipt.operation || current.operationId !== result.receipt.operationId)) {
        throw new AccountMethodError("AUTH_COMPLETION_INVALID");
      }
      const next: Operation = current.phase === "operation" ? current : { ...current, phase: "operation", operation: result.receipt.operation,
        operationId: result.receipt.operationId, expiresAt: Date.now() + 86_400_000, preview: null, consent: null };
      save(next); setChallenge(null); setCode("");
      if (result.status === "proved") await preview(next, next.preview?.choices.omittedWorkspaceIds ?? [], signal);
      return;
    }
    if (result.status === "email_required") { setChallenge({ kind: "target", email: result.email }); setCode(""); return; }
    throw new AccountMethodError("AUTH_COMPLETION_INVALID");
  }
  async function run(action: (signal: AbortSignal) => Promise<void>): Promise<void> {
    const current = controller.current;
    if (running.current || current === null || current.signal.aborted || props.disabled) return;
    running.current = true; setBusy(true); setError(null);
    try {
      if (userId === null) throw new AccountMethodError("SESSION_REQUIRED");
      await verifyAccountMethodOwner(userId, current.signal);
      if (!current.signal.aborted) await action(current.signal);
    } catch (failure) {
      if (!current.signal.aborted) {
        const failureCode = failure instanceof AccountMethodError ? failure.code : "AUTH_ATTEMPT_RESTART_REQUIRED";
        setError(failureCode);
        if (failureCode === "ACCOUNT_CONNECTION_PREVIEW_CHANGED" && pending?.phase === "operation") {
          try { save({ ...pending, consent: null, preview: null }); setAccepted(false); }
          catch { setError("BROWSER_STORAGE_UNAVAILABLE"); }
        }
      }
    } finally { if (!current.signal.aborted) { running.current = false; setBusy(false); } }
  }
  useEffect(() => {
    const current = new AbortController(); controller.current = current;
    running.current = true; setBusy(true); setPending(null); setChallenge(null); setOpen(false); setCompleted(null); setError(null);
    void (async () => {
      try {
        if (userId === null) return;
        await verifyAccountMethodOwner(userId, current.signal);
        if (current.signal.aborted) return;
        const saved = readPendingConnection(userId);
        const returned = readAccountMethodReturn();
        if (saved === null) {
          if (returned?.connection === true) throw new AccountMethodError("ACCOUNT_CONNECTION_RESTART_REQUIRED");
          return;
        }
        setPending(saved); setOpen(true); onActiveChange(true);
        if (saved.phase === "suggestion") {
          await receive(await accountConnection(saved.csrfToken, { action: "adopt", capability: "canonical-account-v1",
            suggestion: saved.suggestion }, current.signal), saved, current.signal);
        } else if (saved.phase === "source") {
          if (returned?.connection === true && returned.status === "reauthenticated" && returned.completion !== null) {
            clearAccountMethodReturn();
            await receive(await accountConnection(saved.csrfToken, { action: "begin", capability: "canonical-account-v1",
              sourceCompletion: returned.completion }, current.signal), saved, current.signal);
          } else if (returned?.connection === true) throw new AccountMethodError(returned.code ?? "ACCOUNT_CONNECTION_RESTART_REQUIRED");
        } else if (saved.consent === null) {
          if (returned?.connection === true && returned.status !== "provider_proved") {
            throw new AccountMethodError(returned.code ?? "ACCOUNT_CONNECTION_RESTART_REQUIRED");
          }
          await receive(await accountConnection(saved.csrfToken, { action: "load", operation: saved.operation }, current.signal), saved, current.signal);
        }
      } catch (failure) {
        if (!current.signal.aborted) { setOpen(true); setError(failure instanceof AccountMethodError ? failure.code : "AUTH_ATTEMPT_RESTART_REQUIRED"); }
      } finally {
        if (!current.signal.aborted) {
          if (readAccountMethodReturn()?.connection === true) clearAccountMethodReturn();
          running.current = false; setBusy(false);
        }
      }
    })();
    return () => { current.abort(); running.current = false; onActiveChange(false); };
  }, [userId, onActiveChange]);

  function start(): void {
    if (userId === null || busy || props.disabled) return;
    const next: PendingConnection = { userId, csrfToken: props.methods.csrfToken, phase: "source", expiresAt: Date.now() + 600_000 };
    void run(async () => { save(next); setOpen(true); setCompleted(null); onActiveChange(true); });
  }
  function provider(provider: AccountProvider): void {
    if (pending === null) return;
    const current = pending;
    track({ name: "auth_method_selected", method: provider, screen: "settings" });
    void run(async (signal) => {
      if (current.phase === "source") {
        const result = await beginProviderMethod(provider, current.csrfToken, null, null, accountConnectionReturnUrl(), signal);
        if (signal.aborted) return;
        save({ ...current, expiresAt: result.expiresAt });
        track({ name: "auth_provider_requested", method: provider, screen: "settings" }); window.location.assign(result.authorizationUrl);
      } else if (current.phase === "operation") {
        const result = await accountConnection(current.csrfToken, { action: "provider_begin", operation: current.operation, provider,
          codeChallenge: null, redirectUri: accountConnectionReturnUrl() }, signal);
        if (signal.aborted) return;
        if (result.status !== "provider_required") throw new AccountMethodError("AUTH_COMPLETION_INVALID");
        track({ name: "auth_provider_requested", method: provider, screen: "settings" });
        window.location.assign(connectionProviderUrl(result.authorizationUrl, provider));
      }
    });
  }
  function sendEmail(): void {
    if (pending === null) return;
    const current = pending;
    track({ name: "auth_method_selected", method: "email", screen: "settings" });
    void run(async (signal) => {
      if (current.phase === "source") {
        const result = await beginEmailMethod(current.csrfToken, signal, (outcome) => {
          if (!signal.aborted) track({ name: "auth_code_request_finished", method: "email", screen: "settings", action: "initial", outcome });
        });
        if (!signal.aborted) { setChallenge({ kind: "source", attempt: result.attempt, email: result.email }); setCode(""); }
      } else if (current.phase === "operation") await receive(await accountConnection(current.csrfToken, { action: "email_send", operation: current.operation, email }, signal), current, signal);
    });
  }
  function verifyEmail(): void {
    if (pending === null || challenge === null) return;
    const current = pending; const requested = challenge;
    if (locked) return;
    track({ name: "auth_code_submitted", method: "email", screen: "settings" });
    setChallenge(null);
    void run(async (signal) => {
      if (requested.kind === "source") {
        const result = await completeEmailMethod(current.csrfToken, requested.attempt, code, signal, (outcome) => {
          if (!signal.aborted) track({ name: "auth_code_verification_finished", method: "email", screen: "settings", outcome });
        });
        if (!signal.aborted) await receive(await accountConnection(current.csrfToken, { action: "begin", capability: "canonical-account-v1",
          sourceCompletion: result.proof.completion }, signal), current, signal);
      } else if (current.phase === "operation") {
        await receive(await accountConnection(current.csrfToken, { action: "email_verify", operation: current.operation, code }, signal), current, signal);
      }
    });
  }
  function confirm(): void {
    if (pending?.phase !== "operation" || pending.preview === null || (pending.consent === null && !accepted)) return;
    const current = pending;
    const consent = current.consent ?? { action: "confirm" as const, operation: current.operation,
      omittedWorkspaceIds: current.preview!.choices.omittedWorkspaceIds, previewDigest: current.preview!.choices.digest, accepted: true as const };
    void run(async (signal) => {
      const next: Operation = { ...current, consent }; save(next);
      await receive(await accountConnection(next.csrfToken, consent, signal), next, signal);
    });
  }
  function cancel(): void {
    if (pending?.phase === "operation" && pending.consent !== null && error !== "ACCOUNT_CONNECTION_RESTART_REQUIRED") return;
    const current = pending;
    const restartRequired = error === "ACCOUNT_CONNECTION_RESTART_REQUIRED";
    void run(async (signal) => {
      if (current?.phase === "operation" && !restartRequired) {
        const result = await accountConnection(current.csrfToken, { action: "cancel", operation: current.operation }, signal);
        if (result.status !== "cancelled") throw new AccountMethodError("AUTH_COMPLETION_INVALID");
      }
      if (!signal.aborted) finish("cancelled");
    });
  }
  const operation = pending?.phase === "operation" ? pending : null;
  const currentPreview = operation?.preview ?? null;
  const locked = busy || props.disabled;
  return <div data-testid="account-connection" aria-busy={busy}>
    {!open ? <button type="button" className="ghost-btn" onClick={start} disabled={locked} data-testid="account-connection-start">
      {t("accountConnection.title")}</button> : <>
      <h3>{t("accountConnection.title")}</h3>
      {busy ? <p role="status">{t("common.loading")}</p> : null}
      {completed !== null ? <p role="status" data-testid="account-connection-completed">
        {t("accountConnection.completed")}</p>
        : currentPreview !== null ? <>
          <h4>{t("accountConnection.preview")}</h4>
          <p>{t("accountConnection.consequences")}</p>
          <ul>{currentPreview.choices.preview.workspaces.map(({ workspace }) => <li key={workspace.workspace_id}>
            {workspace.name}{workspace.workspace_id === currentPreview.choices.preview.selectedWorkspaceId ? ` — ${t("accountConnection.selected")}` : ""}
            {currentPreview.choices.preview.suppressedWorkspaceIds.includes(workspace.workspace_id) ? ` — ${t("accountConnection.suppressed")}` : ""}
            {currentPreview.omissionCandidateWorkspaceIds.includes(workspace.workspace_id) ? <label>
              <input type="checkbox" disabled={locked || operation?.consent !== null} data-testid={`account-connection-omit-${workspace.workspace_id}`}
                checked={currentPreview.choices.omittedWorkspaceIds.includes(workspace.workspace_id)} onChange={(event) => {
                  if (operation === null) return;
                  const ids = event.target.checked ? [...currentPreview.choices.omittedWorkspaceIds, workspace.workspace_id]
                    : currentPreview.choices.omittedWorkspaceIds.filter((id) => id !== workspace.workspace_id);
                  void run((signal) => preview(operation, ids, signal));
                }}/>{t("accountConnection.omit")}</label> : null}
          </li>)}</ul>
          {operation?.consent === null ? <label><input type="checkbox" checked={accepted} disabled={locked}
            onChange={(event) => setAccepted(event.target.checked)} data-testid="account-connection-consent"/>{t("accountConnection.consent")}</label>
            : <p role="status">{t("accountConnection.retry")}</p>}
          <button type="button" className="ghost-btn" disabled={locked || (operation?.consent === null && !accepted)} onClick={confirm}
            data-testid="account-connection-confirm">{t(operation?.consent === null ? "accountConnection.combine" : "common.retry")}</button>
        </> : challenge !== null ? <form onSubmit={(event) => { event.preventDefault(); verifyEmail(); }}>
          <p role="status">{t("accountConnection.destination", { email: challenge.email })}</p>
          <label htmlFor="account-connection-code">{t("accountMethods.codePrompt")}</label>
          <input id="account-connection-code" data-testid="account-connection-code" value={code} disabled={locked} required
            autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6,8}" minLength={6} maxLength={8}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 8))}/>
          <button type="submit" className="ghost-btn" disabled={locked}>{t("common.continue")}</button>
        </form> : <>
          <p>{t(operation === null ? "accountMethods.confirmCurrent" : "accountConnection.target")}</p>
          <div className="screen-actions">{props.providers.filter((provider) => operation !== null
            || props.methods.methods.some((method) => method.provider === provider && method.status === "active"))
            .map((method) => <AccountMethodButton key={method} provider={method} label={method === "google" ? "Google" : "Apple"}
              disabled={locked || pending === null} onClick={() => provider(method)} testId={`account-connection-provider-${method}`}/>)}
            {operation === null ? <AccountMethodButton provider="email" label={t("accountStatus.labels.email")} disabled={locked || pending === null}
              onClick={sendEmail} testId="account-connection-source-email"/> : null}</div>
          {operation === null ? null : <form onSubmit={(event) => { event.preventDefault(); sendEmail(); }}>
            <label htmlFor="account-connection-email">{t("accountStatus.labels.email")}</label>
            <input id="account-connection-email" data-testid="account-connection-email" type="email" required maxLength={254}
              autoComplete="email" value={email} disabled={locked} onChange={(event) => setEmail(event.target.value)}/>
            <button type="submit" className="ghost-btn" disabled={locked}>{t("common.continue")}</button>
            <button type="button" className="ghost-btn" disabled={locked} onClick={() => void run((signal) => preview(operation, [], signal))}
              data-testid="account-connection-preview">{t("accountConnection.preview")}</button>
          </form>}
        </>}
      {operation?.consent == null || error === "ACCOUNT_CONNECTION_RESTART_REQUIRED" ? <button type="button" className="ghost-btn" onClick={cancel} disabled={locked}
        data-testid="account-connection-cancel">{t("common.cancel")}</button> : null}
      {error === null ? null : <p role="alert" data-testid="account-connection-error">{t(errorKey(error))} <code>{error}</code></p>}
    </>}
  </div>;
}
