import { useId, useLayoutEffect, useRef, useState, type ReactElement } from "react";
import { ApiError, isAuthRedirectError } from "../../../api";
import { loadCardMaintenancePreview } from "../../../api/endpoints/cardMaintenance";
import type { CardMaintenancePreview, CardMaintenanceTarget } from "../../../apiContracts/cardMaintenance";
import { useAppData } from "../../../appData";
import { getErrorMessage } from "../../../appData/domain";
import { supportsWorkspaceMaintenanceLock } from "../../../appData/sync/engine/workspaceMaintenanceLock";
import { confirmWorkspaceMaintenance } from "../../../appData/sync/engine/workspaceMaintenanceProtocol";
import { isCapturedSyncFailure } from "../../../appData/sync/observation/syncErrorObservation";
import { markIndexedDbOpenRecoveryFailureAndCheckActive, useAppErrorDialog } from "../../../appError/AppErrorContext";
import { useI18n } from "../../../i18n";
import { captureAppOperationError } from "../../../observability/appOperationObservation";
import { WorkspaceActionDialog } from "./WorkspaceActionDialog";

type ActionProps = CardMaintenanceTarget & Readonly<{
  disabled: boolean;
  disabledReason?: string;
  canStart?: () => boolean;
  onComplete?: () => void;
  didApplyAfterSync?: () => Promise<boolean>;
}>;

type RecoveryReason = "confirmed" | "uncertain" | "tag-missing";

type DialogState =
  | Readonly<{ stage: "closed" | "loading" | "executing" | "complete" }>
  | Readonly<{ stage: "preview"; preview: CardMaintenancePreview; notice: string }>
  | Readonly<{ stage: "preview-error"; message: string; notice: string }>
  | Readonly<{ stage: "syncing" | "sync-error" | "sync-error-dismissed"; reason: RecoveryReason }>;

export function CardMaintenanceAction(props: ActionProps): ReactElement {
  const { activeWorkspace, cloudSettings, isSessionVerified, session } = useAppData();
  const { t } = useI18n();
  const label = props.kind === "removeTag"
    ? t("cardMaintenance.removeTag")
    : t("settingsWorkspace.resetProgress.title");

  if (
    activeWorkspace === null
    || session === null
    || !isSessionVerified
    || session.browserGuestCapabilities?.isGuest === true
    || cloudSettings?.cloudState !== "linked"
  ) {
    return (
      <button
        type="button"
        className="ghost-btn settings-danger-btn"
        disabled
        title={t("cardMaintenance.linkedWorkspaceRequired")}
        data-testid={`card-maintenance-${props.kind}`}
      >
        {label}
      </button>
    );
  }

  const scopeKey = JSON.stringify([session.userId, activeWorkspace.workspaceId, props.kind, props.target]);
  return (
    <LinkedCardMaintenanceAction
      key={scopeKey}
      {...props}
      userId={session.userId}
      workspaceId={activeWorkspace.workspaceId}
      label={label}
    />
  );
}

function LinkedCardMaintenanceAction({
  kind,
  target,
  disabled,
  disabledReason,
  canStart,
  onComplete,
  didApplyAfterSync,
  userId,
  workspaceId,
  label,
}: ActionProps & Readonly<{ userId: string; workspaceId: string; label: string }>): ReactElement {
  const { cloudSettings, requireActiveWorkspaceSync, runWithCardMaintenanceSync } = useAppData();
  const lockOwner = { userId, workspaceId };
  const supportsMaintenance = supportsWorkspaceMaintenanceLock();
  const { indexedDbOpenRecoveryState } = useAppErrorDialog();
  const { messages, t, formatCount, formatNumber } = useI18n();
  const [dialog, setDialog] = useState<DialogState>({ stage: "closed" });
  const [confirmation, setConfirmation] = useState("");
  const titleId = useId();
  const descriptionId = useId();
  const confirmationId = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);
  const confirmationRef = useRef<HTMLInputElement | null>(null);
  const scopeActiveRef = useRef(false);
  const disabledRef = useRef(disabled);
  const preview = dialog.stage === "preview" ? dialog.preview : null;
  const isBusy = dialog.stage === "loading" || dialog.stage === "executing" || dialog.stage === "syncing";
  const isOpen = dialog.stage !== "closed" && dialog.stage !== "complete" && dialog.stage !== "sync-error-dismissed";
  const isRemoval = kind === "removeTag";

  useLayoutEffect(() => {
    scopeActiveRef.current = true;
    return () => {
      scopeActiveRef.current = false;
    };
  }, []);

  useLayoutEffect(() => {
    disabledRef.current = disabled;
  }, [disabled]);

  function describeRequestError(error: unknown, operation: "card_maintenance_preview" | "card_maintenance_execute"): string {
    if (error instanceof ApiError) {
      if (error.code === "CARD_MAINTENANCE_TARGET_NOT_FOUND") {
        return t("cardMaintenance.targetMissing");
      }

      if (error.code === "CARD_MAINTENANCE_CONFIRMATION_INVALID") {
        return t("settingsWorkspace.resetProgress.initialHelp");
      }
      if (error.code === "CARD_MAINTENANCE_SHARED" || error.code === "CARD_MAINTENANCE_INPUT_INVALID") {
        return error.message;
      }
    }

    if (isCapturedSyncFailure(error)) {
      return t("appError.technicalError.message");
    }

    const wasCaptured = captureAppOperationError(error, {
      feature: "settings",
      operation,
      userId,
      workspaceId,
      installationId: cloudSettings?.installationId ?? null,
      entityId: target,
    });
    return wasCaptured ? t("appError.technicalError.message") : getErrorMessage(error);
  }

  async function loadPreview(notice: string): Promise<void> {
    setConfirmation("");
    setDialog({ stage: "loading" });
    try {
      await requireActiveWorkspaceSync(workspaceId, () => scopeActiveRef.current);
      indexedDbOpenRecoveryState.throwIfFailed();
      if (!scopeActiveRef.current) return;

      const nextPreview = await loadCardMaintenancePreview(workspaceId, userId, { kind, target });
      if (!scopeActiveRef.current) return;

      setDialog({ stage: "preview", preview: nextPreview, notice });
    } catch (error) {
      if (!scopeActiveRef.current || isAuthRedirectError(error)
        || markIndexedDbOpenRecoveryFailureAndCheckActive(indexedDbOpenRecoveryState, error)) return;

      if (isRemoval && error instanceof ApiError && error.code === "CARD_MAINTENANCE_TARGET_NOT_FOUND") {
        await retrySync("tag-missing");
        return;
      }

      setDialog({ stage: "preview-error", message: describeRequestError(error, "card_maintenance_preview"), notice });
    }
  }

  function finishAction(): void {
    if (!scopeActiveRef.current) return;

    setDialog({ stage: "complete" });
    onComplete?.();
  }

  async function settleSyncedAction(reason: RecoveryReason): Promise<void> {
    if (!scopeActiveRef.current) return;
    if (reason === "confirmed" || await didApplyAfterSync?.() === true) {
      finishAction();
    } else if (scopeActiveRef.current) {
      if (reason === "tag-missing") {
        setDialog({ stage: "preview-error", message: t("cardMaintenance.previewChanged"), notice: "" });
      } else {
        await loadPreview(t("cardMaintenance.outcomeUnknown"));
      }
    }
  }

  async function retrySync(reason: RecoveryReason): Promise<void> {
    setDialog({ stage: "syncing", reason });
    try {
      await runWithCardMaintenanceSync(workspaceId, (sync) => sync());
      await settleSyncedAction(reason);
    } catch (error) {
      showSyncError(error, reason);
    }
  }

  function showSyncError(error: unknown, reason: RecoveryReason): void {
    if (!scopeActiveRef.current || isAuthRedirectError(error)
      || markIndexedDbOpenRecoveryFailureAndCheckActive(indexedDbOpenRecoveryState, error)) return;

    setDialog({ stage: "sync-error", reason });
  }

  async function confirmPreview(): Promise<void> {
    if (disabled || preview === null || preview.affectedCardsCount === 0 || confirmation !== preview.confirmationText) {
      return;
    }

    setDialog({ stage: "executing" });
    try {
      const outcome = await runWithCardMaintenanceSync(workspaceId, async (sync) => {
        await sync();
        if (!scopeActiveRef.current || disabledRef.current || canStart?.() === false) return "cancelled";

        const result = await confirmWorkspaceMaintenance(lockOwner, {
          kind,
          target,
          confirmationText: confirmation,
          previewFingerprint: preview.previewFingerprint,
        });
        const reason = result.outcome;
        if (result.outcome === "uncertain") describeRequestError(result.error, "card_maintenance_execute");

        if (scopeActiveRef.current) setDialog({ stage: "syncing", reason });
        try {
          if (result.outcome === "confirmed") result.persistConfirmation();
          await sync();
          return reason;
        } catch (error) {
          showSyncError(error, reason);
          return "retry";
        }
      });

      if (outcome === "cancelled") {
        if (scopeActiveRef.current) dismiss();
      } else if (outcome !== "retry") {
        try {
          await settleSyncedAction(outcome);
        } catch (error) {
          showSyncError(error, outcome);
        }
      }
    } catch (error) {
      if (!scopeActiveRef.current || isAuthRedirectError(error)
        || markIndexedDbOpenRecoveryFailureAndCheckActive(indexedDbOpenRecoveryState, error)) return;

      if (error instanceof ApiError && error.code === "CARD_MAINTENANCE_PREVIEW_CHANGED") {
        await loadPreview(t("cardMaintenance.previewChanged"));
      } else if (isRemoval && error instanceof ApiError && error.code === "CARD_MAINTENANCE_TARGET_NOT_FOUND") {
        await retrySync("tag-missing");
      } else {
        setDialog({ stage: "preview-error", message: describeRequestError(error, "card_maintenance_execute"), notice: "" });
      }
    }
  }

  function dismiss(): void {
    setConfirmation("");
    setDialog(dialog.stage === "sync-error"
      ? { stage: "sync-error-dismissed", reason: dialog.reason }
      : { stage: "closed" });
  }

  const recoveryMessage = dialog.stage === "sync-error" || dialog.stage === "sync-error-dismissed"
    ? dialog.reason === "uncertain"
      ? `${t("cardMaintenance.outcomeUnknown")} ${t("cardMaintenance.syncFailed")}`
      : t("cardMaintenance.syncFailed")
    : null;
  const notice = dialog.stage === "preview" || dialog.stage === "preview-error" ? dialog.notice : "";

  return (
    <div className="cell-stack">
      {dialog.stage === "sync-error-dismissed" ? (
        <>
          <p className="error-banner" role="alert">{recoveryMessage}</p>
          <button
            ref={triggerRef}
            type="button"
            className="ghost-btn"
            onClick={() => void retrySync(dialog.reason)}
            data-testid="card-maintenance-retry-sync"
          >
            {t("common.retry")}
          </button>
        </>
      ) : (
        <button
          ref={triggerRef}
          type="button"
          className="ghost-btn settings-danger-btn"
          disabled={disabled || !supportsMaintenance}
          title={supportsMaintenance ? undefined : t("appError.storageUnavailable.guidance")}
          onClick={() => {
            if (canStart?.() !== false) void loadPreview("");
          }}
          data-testid={`card-maintenance-${kind}`}
        >
          {label}
        </button>
      )}
      {disabledReason === undefined ? null : <p className="subtitle">{disabledReason}</p>}
      {dialog.stage === "complete" && !isRemoval ? (
        <p className="subtitle" role="status">{t("cardMaintenance.resetComplete")}</p>
      ) : null}

      <WorkspaceActionDialog
        isOpen={isOpen}
        titleId={titleId}
        title={label}
        descriptionId={descriptionId}
        description={preview?.targetName ?? null}
        testId="card-maintenance-dialog"
        initialFocusRef={cancelButtonRef}
        dismissalFocusRef={triggerRef}
        operationReturnFocusRef={confirmationRef}
        isOperationSubmitting={isBusy}
        onDismiss={dismiss}
      >
        {isBusy ? (
          <p className="subtitle" role="status">
            {dialog.stage === "syncing" && dialog.reason === "uncertain"
              ? t("cardMaintenance.outcomeUnknown")
              : t("common.loading")}
          </p>
        ) : null}
        {dialog.stage === "preview-error" || dialog.stage === "sync-error" ? (
          <p className="error-banner" role="alert">
            {dialog.stage === "preview-error" ? dialog.message : recoveryMessage}
          </p>
        ) : null}
        {notice === "" ? null : <p className="warning-banner" role="status">{notice}</p>}
        {preview !== null ? (
          <div className="cell-stack">
            {preview.affectedCardsCount === 0 ? (
              <p className="subtitle">{t("cardMaintenance.noChanges")}</p>
            ) : isRemoval ? (
              <p className="warning-banner">
                {t("cardMaintenance.removePreview", {
                  cards: formatCount(preview.affectedCardsCount, messages.common.countLabels.card),
                  decks: formatNumber(preview.affectedDecksCount),
                })}
              </p>
            ) : (
              <p className="warning-banner">
                {t("settingsWorkspace.resetProgress.previewSummary", {
                  count: formatCount(preview.affectedCardsCount, messages.common.countLabels.card),
                })}
              </p>
            )}
            {preview.includesAllCards ? <p className="subtitle">{t("deckDetail.warnings.emptyRules")}</p> : null}
            {preview.affectedCardsCount > 0 && (kind === "resetDeck" || kind === "resetTag") ? (
              <p className="subtitle">{t("cardMaintenance.overlap")}</p>
            ) : null}
            {preview.affectedCardsCount > 0 ? (
              <>
                <p className="subtitle">{t("settingsWorkspace.resetProgress.initialHelp")}</p>
                <p className="settings-delete-phrase" dir="auto" data-testid="card-maintenance-confirmation-phrase">
                  {preview.confirmationText}
                </p>
                <label className="cell-stack" htmlFor={confirmationId}>
                  <span className="cell-secondary">{t("settingsWorkspace.resetProgress.phraseLabel")}</span>
                  <input
                    ref={confirmationRef}
                    id={confirmationId}
                    className="settings-input"
                    type="text"
                    dir="auto"
                    value={confirmation}
                    autoCapitalize="none"
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                    onChange={(event) => setConfirmation(event.target.value)}
                    onPaste={(event) => event.preventDefault()}
                    onDrop={(event) => event.preventDefault()}
                    data-testid="card-maintenance-confirmation-input"
                  />
                </label>
              </>
            ) : null}
          </div>
        ) : null}
        <div className="screen-actions">
          <button ref={cancelButtonRef} className="ghost-btn" type="button" disabled={isBusy} onClick={dismiss}>
            {dialog.stage === "sync-error" || preview?.affectedCardsCount === 0 ? t("common.close") : t("common.cancel")}
          </button>
          {dialog.stage === "preview-error" ? (
            <button className="primary-btn" type="button" onClick={() => void loadPreview(dialog.notice)}>
              {t("common.retry")}
            </button>
          ) : null}
          {dialog.stage === "sync-error" ? (
            <button
              className="primary-btn"
              type="button"
              onClick={() => void retrySync(dialog.reason)}
              data-testid="card-maintenance-retry-sync"
            >
              {t("common.retry")}
            </button>
          ) : null}
          {preview !== null && preview.affectedCardsCount > 0 ? (
            <button
              className="ghost-btn settings-danger-btn"
              type="button"
              disabled={disabled || confirmation !== preview.confirmationText}
              onClick={() => void confirmPreview()}
              data-testid="card-maintenance-confirm"
            >
              {isRemoval ? label : t("settingsWorkspace.resetProgress.value")}
            </button>
          ) : null}
        </div>
      </WorkspaceActionDialog>
    </div>
  );
}
