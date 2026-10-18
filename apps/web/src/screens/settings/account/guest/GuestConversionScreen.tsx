import { useEffect, useRef, useState, type ReactElement } from "react";
import { ApiError, buildLoginUrl, listWorkspaces } from "../../../../api";
import { useAppData } from "../../../../appData";
import { applyFinalizedGuestConversion, completePendingGuestConversion, probePendingGuestConversion,
  reconcileGuestConversionDrops, resumeGuestAfterCancelledSignIn, resumePendingGuestConversion, retireGuestCredential, verifyRetiredGuestConversion } from "../../../../appData/session/guest/browserGuestConversion";
import { readPendingGuestConversion, runWithBrowserGuestLock, subscribeToBrowserGuestChanges } from "../../../../appData/session/guest/browserGuestStorage";
import { captureGuestDemoCards, deleteMergedGuestDemoCards, type GuestDemoCapture } from "../../../../appData/session/guest/demoCardCleanup";
import type { GuestUpgradeSelection } from "../../../../apiContracts/guestAuth";
import { bindGuestStripeCheckout, cancelGuestStripeCheckout } from "../../../../premium/stripeIntent";
import { useI18n } from "../../../../i18n";
import { captureAppOperationError } from "../../../../observability/appOperationObservation";
import type { WorkspaceSummary } from "../../../../types";

function describeFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return error instanceof ApiError ? `${message} (${error.code ?? error.statusCode}; ${error.requestId ?? ""})` : message;
}

export function GuestConversionScreen(props: Readonly<{ returnUrl: string }>): ReactElement {
  const app = useAppData();
  const latest = useRef(app); latest.current = app;
  const { locale, t } = useI18n();
  const [phase, setPhase] = useState<"loading" | "auth" | "choose" | "hydrate" | "error">("loading");
  const [workspaces, setWorkspaces] = useState<ReadonlyArray<WorkspaceSummary>>([]);
  const [error, setError] = useState("");
  const running = useRef(false);
  const bootstrapSettled = useRef(false);
  const [attempt, setAttempt] = useState(0);
  const [sharedVersion, setSharedVersion] = useState(0);
  const observedSharedVersion = useRef(0);
  const initial = useRef(readPendingGuestConversion());
  const fresh = useRef(initial.current?.phase === "awaiting_auth");
  const demo = useRef<GuestDemoCapture | null>(null);
  const destination = useRef<string | null>(null);
  const warning = useRef("");

  function reportCleanupFailure(failure: unknown): void {
    warning.current = `${t("guest.cleanupFailed")} ${describeFailure(failure)}`;
    captureAppOperationError(failure, { feature: "sync", operation: "card_delete", userId: destination.current,
      workspaceId: readPendingGuestConversion()?.result?.workspace.workspaceId ?? null, installationId: null, entityId: null });
  }

  async function complete(selection: GuestUpgradeSelection): Promise<void> {
    if (destination.current === null) throw new Error("Verified conversion destination is unavailable.");
    const pending = readPendingGuestConversion();
    if (fresh.current && pending?.phase === "prepared" && !(selection.type === "existing" && selection.discardDemoOnly === true)) {
      try {
        demo.current = await runWithBrowserGuestLock("exclusive", () => captureGuestDemoCards(pending.sourceWorkspaceId));
      } catch (failure) { reportCleanupFailure(failure); }
    }
    fresh.current = false;
    await completePendingGuestConversion(selection, destination.current);
    setPhase("hydrate");
    await latest.current.initialize();
  }

  async function resume(): Promise<void> {
    if (running.current) return;
    running.current = true; setError(""); setPhase("loading");
    try {
      if (!bootstrapSettled.current) {
        // Bootstrap owns the transport pause until its full initialization has settled.
        await latest.current.initialize();
        bootstrapSettled.current = true;
      }
      const { probe, pending } = await probePendingGuestConversion();
      if (pending === null) {
        fresh.current = false; demo.current = null;
        await verifyRetiredGuestConversion(destination.current);
        setPhase("hydrate");
        await latest.current.initialize();
        return;
      }
      if (!probe.registeredSession.present) { setPhase("auth"); return; }
      if (pending.phase === "completed") {
        fresh.current = false;
        destination.current = pending.destinationUserId;
        setPhase("hydrate");
        await latest.current.initialize();
        return;
      }
      const prepared = await resumePendingGuestConversion();
      destination.current = prepared.session.userId;
      if (prepared.mode === "bound" || prepared.pending.selection !== null) {
        if (prepared.mode === "bound") fresh.current = false;
        await complete(prepared.pending.selection ?? { type: "create_new" });
      } else {
        setWorkspaces((await listWorkspaces()).filter((workspace) => workspace.isVisible !== false));
        setPhase("choose");
      }
    } catch (failure) {
      fresh.current = false; demo.current = null;
      setError(describeFailure(failure)); setPhase("error");
    } finally { running.current = false; setAttempt((value) => value + 1); }
  }

  useEffect(() => { void resume(); }, []);
  useEffect(() => subscribeToBrowserGuestChanges(() => setSharedVersion((value) => value + 1)), []);
  useEffect(() => {
    if (sharedVersion === observedSharedVersion.current || running.current || phase === "hydrate") return;
    observedSharedVersion.current = sharedVersion;
    const pending = readPendingGuestConversion();
    if (pending === null || pending.phase === "completed") void resume();
  }, [sharedVersion, attempt, phase]);

  useEffect(() => {
    const pending = readPendingGuestConversion();
    if (phase === "hydrate" && !running.current && (app.sessionLoadState === "error" || app.sessionLoadState === "storage_unavailable")) {
      demo.current = null; fresh.current = false;
      setError(app.sessionErrorMessage); setPhase("error");
      return;
    }
    if (phase !== "hydrate" || running.current || pending?.phase !== "completed" || pending.result === null
      || pending.destinationUserId === null || app.sessionLoadState !== "ready" || !app.isSessionVerified || app.session?.userId !== pending.destinationUserId
      || app.activeWorkspace?.workspaceId !== pending.result.workspace.workspaceId) return;
    const result = pending.result;
    const destinationUserId = pending.destinationUserId;
    running.current = true;
    void (async () => {
      try {
        await applyFinalizedGuestConversion(async () => { await latest.current.runSync(); });
        await reconcileGuestConversionDrops(result);
        await latest.current.refreshLocalData();
        if (demo.current !== null) {
          const capture = demo.current; demo.current = null;
          try { await deleteMergedGuestDemoCards(result.workspace.workspaceId, capture, latest.current.deleteCardItem); }
          catch (failure) { reportCleanupFailure(failure); }
        }
        await latest.current.refreshLocalData();
        if (warning.current !== "") latest.current.setErrorMessage(warning.current);
        if (!bindGuestStripeCheckout(pending.sourceUserId, destinationUserId)) {
          latest.current.setErrorMessage("The saved Premium choice changed in this browser. Open the Premium offer again to continue purchasing.");
        }
        await retireGuestCredential(destinationUserId);
      } catch (failure) {
        demo.current = null; fresh.current = false;
        try {
          if (readPendingGuestConversion() !== null) throw failure;
          await verifyRetiredGuestConversion(destinationUserId);
          await latest.current.initialize();
        } catch (retirementFailure) {
          setError(describeFailure(retirementFailure)); setPhase("error");
        }
      } finally { running.current = false; setAttempt((value) => value + 1); }
    })();
  }, [app.sessionLoadState, app.isSessionVerified, app.session?.userId, app.activeWorkspace?.workspaceId, app.localReadVersion, phase, attempt]);

  async function choose(selection: GuestUpgradeSelection): Promise<void> {
    if (running.current) return;
    running.current = true; setPhase("loading"); setError("");
    try { await complete(selection); }
    catch (failure) { demo.current = null; fresh.current = false; setError(describeFailure(failure)); setPhase("error"); }
    finally { running.current = false; setAttempt((value) => value + 1); }
  }
  async function cancel(): Promise<void> {
    if (running.current) return;
    running.current = true;
    try {
      const sourceUserId = readPendingGuestConversion()?.sourceUserId;
      await resumeGuestAfterCancelledSignIn();
      if (sourceUserId !== undefined) cancelGuestStripeCheckout(sourceUserId);
      await latest.current.initialize();
    }
    catch (failure) { setError(describeFailure(failure)); setPhase("error"); }
    finally { running.current = false; setAttempt((value) => value + 1); }
  }
  return <main className="page-state" data-testid="guest-conversion">
    <section className="panel state-panel" aria-busy={phase === "loading" || phase === "hydrate"}>
      <h1 className="title">{t("guest.saveProgress")}</h1>
      <p>{t("guest.mergeExplanation")}</p>
      {phase === "loading" || phase === "hydrate" ? <p role="status">{t("accentColorSettings.saving")}</p> : null}
      {phase === "choose" ? <div className="workspace-choice-list" data-testid="guest-destinations">
        {workspaces.map((workspace) => <button type="button" className="workspace-choice-btn" key={workspace.workspaceId}
          data-testid="guest-destination" data-workspace-id={workspace.workspaceId}
          onClick={() => void choose({ type: "existing", workspaceId: workspace.workspaceId })}>{workspace.name}</button>)}
        <button type="button" className="primary-btn" data-testid="guest-create-workspace" onClick={() => void choose({ type: "create_new" })}>
          {t("accountMenu.newWorkspace")}</button>
      </div> : null}
      {phase === "auth" ? <div className="screen-actions">
        {readPendingGuestConversion()?.guestWorkspaceSyncedAndOutboxDrained === true ? <a className="primary-btn"
          data-testid="guest-continue-auth" href={buildLoginUrl(props.returnUrl, locale)}>{t("guest.signIn")}</a> : null}
        <button className="ghost-btn" type="button" data-testid="guest-cancel-auth" onClick={() => void cancel()}>{t("common.cancel")}</button>
      </div> : null}
      {error === "" ? null : <p role="alert" className="error-banner" data-testid="guest-conversion-error">{error}</p>}
      {phase === "error" ? <button type="button" className="primary-btn" data-testid="guest-conversion-retry"
        onClick={() => void resume()}>{t("common.retry")}</button> : null}
    </section>
  </main>;
}
