import { Fragment, useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import {
  confirmCatalogPackageInstall,
  isAuthRedirectError,
  previewCatalogPackageInstall,
} from "../../api";
import { AppDataProvider, useAppData } from "../../appData";
import { requireCloudInstallationId } from "../../appData/sync/local/syncCloudSettings";
import { getSyncFailureObservationCaptureState } from "../../appData/sync/observation/syncErrorObservation";
import {
  markIndexedDbOpenRecoveryFailureAndCheckActive,
  useAppErrorDialog,
} from "../../appError/AppErrorContext";
import { type TranslationKey, type TranslationValues, useI18n } from "../../i18n";
import { buildClientWorkspaceReplicaId } from "../../media/mediaCrypto";
import { captureAppOperationError } from "../../observability/appOperationObservation";
import type {
  CatalogPackageInstallConfirmOptions,
  CatalogPackageInstallPreviewResponse,
} from "../../types";
import type {
  WorkspaceImportOptions,
  WorkspaceImportPreviewModel,
} from "../settings/workspace/packages/workspaceImportPresentationModel";
import { CatalogImportConfirmPanel } from "./CatalogImportConfirmPanel";
import { CatalogImportSuccessPanel } from "./CatalogImportSuccessPanel";
import {
  CatalogImportContextCard,
  CatalogImportStatePanel,
  getCatalogImportErrorMessage,
  isCatalogVersionUnavailableError,
  type CatalogImportContext,
} from "./catalogImportShared";

type CatalogImportStep = "workspace" | "confirm" | "done";

type CatalogWorkspaceIdentity = Readonly<{
  workspaceId: string;
  installationId: string;
}>;

type CatalogInstallAttempt = Readonly<{
  identity: CatalogWorkspaceIdentity;
  options: CatalogPackageInstallConfirmOptions;
  cardCount: number;
  importTag: string | null;
}>;

type CatalogInstallCompletion = Readonly<{
  cardCount: number;
  importTag: string | null;
  workspaceName: string;
}>;

type CatalogInstallSyncState =
  | Readonly<{ status: "idle" }>
  | Readonly<{ status: "syncing" }>
  | Readonly<{ status: "succeeded" }>
  | Readonly<{ status: "failed"; errorMessage: string }>;

function isSameCatalogWorkspaceIdentity(
  left: CatalogWorkspaceIdentity | null,
  right: CatalogWorkspaceIdentity,
): boolean {
  return left !== null
    && left.workspaceId === right.workspaceId
    && left.installationId === right.installationId;
}

function createInitialImportOptions(): WorkspaceImportOptions {
  return {
    addImportTag: true,
    importTag: "",
    removeTags: [],
  };
}

function CatalogImportBackNav(props: Readonly<{ isDisabled: boolean; onBack: () => void }>): ReactElement {
  const { isDisabled, onBack } = props;
  const { t } = useI18n();

  return (
    <div className="catalog-import-back-nav">
      <button
        className="ghost-btn catalog-import-back-button"
        type="button"
        disabled={isDisabled}
        aria-label={t("catalogImport.back")}
        data-testid="catalog-import-back"
        onClick={onBack}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          className="catalog-import-back-icon"
          aria-hidden="true"
        >
          <path d="M15 5l-7 7 7 7" />
        </svg>
      </button>
    </div>
  );
}

function buildCatalogPreviewModel(
  preview: CatalogPackageInstallPreviewResponse,
  t: (key: TranslationKey, values?: TranslationValues) => string,
  formatNumber: (value: number) => string,
): WorkspaceImportPreviewModel {
  return {
    statistics: [
      {
        id: "source",
        label: t("workspaceImport.previewSourceLabel"),
        value: t("catalogImport.previewSourceCatalog"),
        testId: "catalog-import-preview-source",
      },
      {
        id: "cards",
        label: t("workspaceImport.previewCardsLabel"),
        value: formatNumber(preview.summary.cardCount),
        testId: "catalog-import-preview-card-count",
      },
      {
        id: "media",
        label: t("workspaceImport.previewReferencedMediaLabel"),
        value: formatNumber(preview.summary.mediaAssetCount),
        testId: "catalog-import-preview-media-count",
      },
    ],
    metadataRows: [
      {
        id: "author",
        label: t("workspaceImport.previewMetadataAuthor"),
        value: preview.packageVersion.author.displayName,
        href: null,
      },
      {
        id: "version",
        label: t("catalogImport.previewVersionLabel"),
        value: formatNumber(preview.packageVersion.versionNumber),
        href: null,
      },
    ],
    warnings: [],
    tags: preview.tagCounts.map((tagCount) => ({
      tag: tagCount.tag,
      removalLabel: t("workspaceImport.previewRemoveTagLabel", {
        tag: tagCount.tag,
        count: tagCount.cardsCount,
      }),
    })),
    suggestedImportTag: preview.defaultOptions.suggestedImportTag,
  };
}

function CatalogImportWorkspaceChooser(props: Readonly<{
  isSelectionBusy: boolean;
  onChooseWorkspace: (workspaceId: string) => void;
}>): ReactElement {
  const { isSelectionBusy, onChooseWorkspace } = props;
  const { activeWorkspace, availableWorkspaces, isChoosingWorkspace } = useAppData();
  const { t, formatDateTime } = useI18n();

  return (
    <section className="content-card invite-panel workspace-modal" data-testid="catalog-import-workspace-selector">
      <strong className="panel-subtitle">{t("catalogImport.workspaceTitle")}</strong>
      <p className="subtitle">{t("catalogImport.workspaceDescription")}</p>
      <div className="workspace-choice-list">
        {availableWorkspaces.map((workspace) => {
          const isActiveWorkspace = workspace.workspaceId === activeWorkspace?.workspaceId;
          return (
            <button
              key={workspace.workspaceId}
              className={`workspace-choice-btn${isActiveWorkspace ? " catalog-import-workspace-option-active" : ""}`}
              type="button"
              disabled={isChoosingWorkspace || isSelectionBusy}
              aria-current={isActiveWorkspace ? "true" : undefined}
              data-testid="catalog-import-workspace-option"
              data-workspace-id={workspace.workspaceId}
              data-workspace-active={isActiveWorkspace ? "true" : "false"}
              onClick={() => onChooseWorkspace(workspace.workspaceId)}
            >
              <span className="workspace-choice-name">{workspace.name}</span>
              <span className="workspace-choice-meta">{formatDateTime(workspace.createdAt)}</span>
            </button>
          );
        })}
      </div>
      {isSelectionBusy ? (
        <p className="subtitle" aria-live="polite" data-testid="catalog-import-workspace-loading">
          {t("catalogImport.loading")}
        </p>
      ) : null}
    </section>
  );
}

function CatalogImportSyncStatus(props: Readonly<{
  state: CatalogInstallSyncState;
  onRetry: () => void;
}>): ReactElement | null {
  const { state, onRetry } = props;
  const { t } = useI18n();

  if (state.status === "idle" || state.status === "succeeded") {
    return null;
  }

  if (state.status === "syncing") {
    return (
      <p className="subtitle" aria-live="polite" data-testid="catalog-import-syncing">
        {t("catalogImport.syncing")}
      </p>
    );
  }

  return (
    <section className="content-card invite-panel" data-testid="catalog-import-sync-error">
      <p className="error-banner" role="alert">{state.errorMessage}</p>
      <button
        className="primary-btn"
        type="button"
        data-testid="catalog-import-sync-retry"
        onClick={onRetry}
      >
        {t("catalogImport.retrySync")}
      </button>
    </section>
  );
}

function CatalogImportAuthenticatedContent(props: Readonly<{ catalogContext: CatalogImportContext }>): ReactElement {
  const { catalogContext } = props;
  const {
    activeWorkspace,
    availableWorkspaces,
    chooseWorkspace,
    cloudSettings,
    errorMessage: appDataErrorMessage,
    initialize,
    isChoosingWorkspace,
    isSessionVerified,
    refreshLocalData,
    session,
    sessionErrorMessage,
    sessionLoadState,
  } = useAppData();
  const { indexedDbOpenRecoveryState, showCapturedTechnicalError } = useAppErrorDialog();
  const { t, formatNumber } = useI18n();
  const isWorkspaceChoiceAvailable = availableWorkspaces.length > 1;
  const [step, setStep] = useState<CatalogImportStep>(() => (isWorkspaceChoiceAvailable ? "workspace" : "confirm"));
  const [hasWorkspaceStep, setHasWorkspaceStep] = useState<boolean>(isWorkspaceChoiceAvailable);
  const [preview, setPreview] = useState<CatalogPackageInstallPreviewResponse | null>(null);
  const [previewIdentity, setPreviewIdentity] = useState<CatalogWorkspaceIdentity | null>(null);
  const [options, setOptions] = useState<WorkspaceImportOptions>(createInitialImportOptions);
  const [installAttempt, setInstallAttempt] = useState<CatalogInstallAttempt | null>(null);
  const [completion, setCompletion] = useState<CatalogInstallCompletion | null>(null);
  const [syncState, setSyncState] = useState<CatalogInstallSyncState>({ status: "idle" });
  const [isWorkspaceSelectionPending, setIsWorkspaceSelectionPending] = useState<boolean>(false);
  const [isPreviewing, setIsPreviewing] = useState<boolean>(false);
  const [isInstalling, setIsInstalling] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const previewRequestGenerationRef = useRef<number>(0);
  const installRequestGenerationRef = useRef<number>(0);
  const syncRequestGenerationRef = useRef<number>(0);
  const activePreviewRequestRef = useRef<number | null>(null);
  const activeInstallRequestRef = useRef<number | null>(null);
  const activeSyncRequestRef = useRef<number | null>(null);
  const workspaceSelectionInFlightRef = useRef<boolean>(false);
  const pendingWorkspaceSelectionRef = useRef<string | null>(null);
  const hasLeftInitialStepRef = useRef<boolean>(false);
  const installAttemptRef = useRef<CatalogInstallAttempt | null>(null);
  const stepRef = useRef<CatalogImportStep>(step);
  stepRef.current = step;
  const technicalErrorMessage = t("appError.technicalError.message");
  const workspaceId = activeWorkspace?.workspaceId ?? null;
  const workspaceIdentity: CatalogWorkspaceIdentity | null = workspaceId !== null
    && cloudSettings?.cloudState === "linked"
    && cloudSettings.linkedWorkspaceId === workspaceId
    && cloudSettings.installationId.trim() !== ""
    ? { workspaceId, installationId: cloudSettings.installationId }
    : null;
  const workspaceIdentityRef = useRef<CatalogWorkspaceIdentity | null>(workspaceIdentity);
  workspaceIdentityRef.current = workspaceIdentity;
  const workspaceIdentityKey = workspaceIdentity === null
    ? ""
    : `${workspaceIdentity.workspaceId}:${workspaceIdentity.installationId}`;
  const isWorkspaceSelectionBusy = isChoosingWorkspace || isWorkspaceSelectionPending;
  const isImportAvailable = sessionLoadState === "ready"
    && isSessionVerified
    && workspaceIdentity !== null
    && !isWorkspaceSelectionBusy;
  const isImportBusy = isPreviewing || isInstalling || syncState.status === "syncing";
  const isPreviewCurrent = preview !== null
    && previewIdentity !== null
    && isImportAvailable
    && workspaceIdentity !== null
    && isSameCatalogWorkspaceIdentity(previewIdentity, workspaceIdentity);
  const areImportOptionsLocked = installAttempt !== null;
  const previewModel = preview === null ? null : buildCatalogPreviewModel(preview, t, formatNumber);
  const workspaceErrorMessage = syncState.status === "idle" ? appDataErrorMessage : "";
  const canRetryPreview = preview === null && errorMessage !== "" && isImportAvailable && !isImportBusy;

  const captureCatalogImportError = useCallback(function captureCatalogImportError(
    error: unknown,
    identity: CatalogWorkspaceIdentity,
  ): boolean {
    return captureAppOperationError(error, {
      feature: "settings",
      operation: "catalog_import",
      userId: session?.userId ?? null,
      workspaceId: identity.workspaceId,
      installationId: identity.installationId,
      entityId: catalogContext.packageVersion.packageVersionId,
    });
  }, [catalogContext.packageVersion.packageVersionId, session?.userId]);

  const runPostInstallSync = useCallback(async function runPostInstallSync(
    identity: CatalogWorkspaceIdentity,
  ): Promise<void> {
    if (
      indexedDbOpenRecoveryState.hasFailed()
      || activeSyncRequestRef.current !== null
      || !isSameCatalogWorkspaceIdentity(workspaceIdentityRef.current, identity)
    ) {
      return;
    }

    const requestGeneration = syncRequestGenerationRef.current + 1;
    syncRequestGenerationRef.current = requestGeneration;
    activeSyncRequestRef.current = requestGeneration;
    setSyncState({ status: "syncing" });

    try {
      indexedDbOpenRecoveryState.throwIfFailed();
      await refreshLocalData();
      indexedDbOpenRecoveryState.throwIfFailed();
      if (
        activeSyncRequestRef.current !== requestGeneration
        || !isSameCatalogWorkspaceIdentity(workspaceIdentityRef.current, identity)
      ) {
        return;
      }
      setSyncState({ status: "succeeded" });
    } catch (error) {
      if (markIndexedDbOpenRecoveryFailureAndCheckActive(indexedDbOpenRecoveryState, error)) {
        return;
      }
      if (
        activeSyncRequestRef.current !== requestGeneration
        || !isSameCatalogWorkspaceIdentity(workspaceIdentityRef.current, identity)
      ) {
        return;
      }
      if (isAuthRedirectError(error)) {
        return;
      }

      const wasCaptured = getSyncFailureObservationCaptureState(error) === true;
      if (wasCaptured) {
        showCapturedTechnicalError(error);
      }
      setSyncState({
        status: "failed",
        errorMessage: wasCaptured ? technicalErrorMessage : t("catalogImport.syncFailed"),
      });
    } finally {
      if (activeSyncRequestRef.current === requestGeneration) {
        activeSyncRequestRef.current = null;
      }
    }
  }, [indexedDbOpenRecoveryState, refreshLocalData, showCapturedTechnicalError, t, technicalErrorMessage]);

  const refreshPreview = useCallback(async function refreshPreview(): Promise<void> {
    if (indexedDbOpenRecoveryState.hasFailed()) {
      return;
    }

    const requestIdentity = workspaceIdentityRef.current;
    if (!isImportAvailable || requestIdentity === null) {
      setErrorMessage(t("catalogImport.workspaceUnavailable"));
      return;
    }
    if (
      step !== "confirm"
      || workspaceSelectionInFlightRef.current
      || activePreviewRequestRef.current !== null
      || activeInstallRequestRef.current !== null
      || activeSyncRequestRef.current !== null
    ) {
      return;
    }

    const requestGeneration = previewRequestGenerationRef.current + 1;
    previewRequestGenerationRef.current = requestGeneration;
    activePreviewRequestRef.current = requestGeneration;
    installAttemptRef.current = null;
    setInstallAttempt(null);
    setSyncState({ status: "idle" });
    setIsPreviewing(true);
    setPreview(null);
    setPreviewIdentity(null);
    setOptions(createInitialImportOptions());
    setErrorMessage("");

    try {
      indexedDbOpenRecoveryState.throwIfFailed();
      const response = await previewCatalogPackageInstall(
        requestIdentity.workspaceId,
        catalogContext.packageVersion.packageVersionId,
      );
      indexedDbOpenRecoveryState.throwIfFailed();
      if (response.packageVersion.packageVersionId !== catalogContext.packageVersion.packageVersionId) {
        throw new Error(
          `Catalog install preview returned a different package version. expected=${catalogContext.packageVersion.packageVersionId} actual=${response.packageVersion.packageVersionId}`,
        );
      }
      if (
        activePreviewRequestRef.current !== requestGeneration
        || !isSameCatalogWorkspaceIdentity(workspaceIdentityRef.current, requestIdentity)
      ) {
        return;
      }
      setPreview(response);
      setPreviewIdentity(requestIdentity);
      setOptions({
        addImportTag: response.defaultOptions.addImportTag,
        importTag: response.defaultOptions.suggestedImportTag,
        removeTags: [...response.defaultOptions.removedTags],
      });
    } catch (error) {
      if (markIndexedDbOpenRecoveryFailureAndCheckActive(indexedDbOpenRecoveryState, error)) {
        return;
      }
      if (
        activePreviewRequestRef.current !== requestGeneration
        || !isSameCatalogWorkspaceIdentity(workspaceIdentityRef.current, requestIdentity)
      ) {
        return;
      }
      if (isAuthRedirectError(error)) {
        return;
      }
      if (isCatalogVersionUnavailableError(error)) {
        setErrorMessage(t("catalogImport.versionUnavailable"));
        return;
      }

      const wasCaptured = captureCatalogImportError(error, requestIdentity);
      if (wasCaptured) {
        showCapturedTechnicalError(error);
      }
      setErrorMessage(wasCaptured ? technicalErrorMessage : getCatalogImportErrorMessage(error));
    } finally {
      if (
        indexedDbOpenRecoveryState.hasFailed() === false
        && activePreviewRequestRef.current === requestGeneration
      ) {
        activePreviewRequestRef.current = null;
        setIsPreviewing(false);
      }
    }
  }, [
    captureCatalogImportError,
    catalogContext.packageVersion.packageVersionId,
    indexedDbOpenRecoveryState,
    isImportAvailable,
    showCapturedTechnicalError,
    step,
    t,
    technicalErrorMessage,
  ]);

  useEffect(() => {
    if (hasLeftInitialStepRef.current) {
      return;
    }
    setHasWorkspaceStep(isWorkspaceChoiceAvailable);
    setStep(isWorkspaceChoiceAvailable ? "workspace" : "confirm");
  }, [isWorkspaceChoiceAvailable]);

  useEffect(() => {
    if (pendingWorkspaceSelectionRef.current === null || pendingWorkspaceSelectionRef.current !== workspaceId) {
      return;
    }
    pendingWorkspaceSelectionRef.current = null;
    hasLeftInitialStepRef.current = true;
    setStep("confirm");
  }, [workspaceId]);

  useEffect(() => {
    // The done step is terminal: it keeps its own completion data and its post-install
    // sync status, so a later workspace identity change must not blank it.
    if (stepRef.current === "done") {
      return;
    }

    previewRequestGenerationRef.current += 1;
    installRequestGenerationRef.current += 1;
    syncRequestGenerationRef.current += 1;
    activePreviewRequestRef.current = null;
    activeInstallRequestRef.current = null;
    activeSyncRequestRef.current = null;
    installAttemptRef.current = null;
    setPreview(null);
    setPreviewIdentity(null);
    setOptions(createInitialImportOptions());
    setInstallAttempt(null);
    setSyncState({ status: "idle" });
    setIsPreviewing(false);
    setIsInstalling(false);
    setErrorMessage("");
  }, [isImportAvailable, workspaceIdentityKey]);

  useEffect(() => {
    if (!isImportAvailable || step !== "confirm" || preview !== null) {
      return;
    }
    void refreshPreview();
  }, [isImportAvailable, preview, refreshPreview, step, workspaceIdentityKey]);

  function cancelActivePreviewRequest(): void {
    if (activePreviewRequestRef.current === null) {
      return;
    }
    previewRequestGenerationRef.current += 1;
    activePreviewRequestRef.current = null;
    setIsPreviewing(false);
  }

  async function selectCatalogWorkspace(nextWorkspaceId: string): Promise<void> {
    if (indexedDbOpenRecoveryState.hasFailed()) {
      return;
    }

    if (nextWorkspaceId === workspaceId) {
      pendingWorkspaceSelectionRef.current = null;
      hasLeftInitialStepRef.current = true;
      setStep("confirm");
      return;
    }
    if (
      workspaceSelectionInFlightRef.current
      || activeInstallRequestRef.current !== null
      || activeSyncRequestRef.current !== null
    ) {
      return;
    }

    cancelActivePreviewRequest();
    workspaceSelectionInFlightRef.current = true;
    pendingWorkspaceSelectionRef.current = nextWorkspaceId;
    setIsWorkspaceSelectionPending(true);
    try {
      indexedDbOpenRecoveryState.throwIfFailed();
      await chooseWorkspace(nextWorkspaceId);
      indexedDbOpenRecoveryState.throwIfFailed();
    } catch (error) {
      if (markIndexedDbOpenRecoveryFailureAndCheckActive(indexedDbOpenRecoveryState, error)) {
        return;
      }
      pendingWorkspaceSelectionRef.current = null;
      throw error;
    } finally {
      if (indexedDbOpenRecoveryState.hasFailed() === false) {
        workspaceSelectionInFlightRef.current = false;
        setIsWorkspaceSelectionPending(false);
      }
    }
  }

  async function confirmInstall(importOptions: WorkspaceImportOptions): Promise<void> {
    if (indexedDbOpenRecoveryState.hasFailed()) {
      return;
    }

    const requestIdentity = workspaceIdentityRef.current;
    if (!isImportAvailable || requestIdentity === null || activeWorkspace === null) {
      setErrorMessage(t("catalogImport.workspaceUnavailable"));
      return;
    }
    const requestWorkspaceName = activeWorkspace.name;
    if (
      workspaceSelectionInFlightRef.current
      || activePreviewRequestRef.current !== null
      || activeInstallRequestRef.current !== null
      || activeSyncRequestRef.current !== null
    ) {
      return;
    }
    if (!isPreviewCurrent) {
      setErrorMessage(t("catalogImport.previewRequired"));
      return;
    }

    let currentAttempt = installAttemptRef.current;
    const importTag = importOptions.importTag.trim();
    if (currentAttempt === null && importOptions.addImportTag && importTag === "") {
      setErrorMessage(t("workspaceImport.importTagRequired"));
      return;
    }
    if (currentAttempt !== null && !isSameCatalogWorkspaceIdentity(currentAttempt.identity, requestIdentity)) {
      installAttemptRef.current = null;
      setInstallAttempt(null);
      setErrorMessage(t("catalogImport.previewRequired"));
      return;
    }

    const requestGeneration = installRequestGenerationRef.current + 1;
    installRequestGenerationRef.current = requestGeneration;
    activeInstallRequestRef.current = requestGeneration;
    setIsInstalling(true);
    setErrorMessage("");
    try {
      indexedDbOpenRecoveryState.throwIfFailed();
      if (currentAttempt === null) {
        const installationId = requireCloudInstallationId(cloudSettings);
        if (installationId !== requestIdentity.installationId) {
          setErrorMessage(t("catalogImport.workspaceUnavailable"));
          return;
        }

        await refreshLocalData();
        indexedDbOpenRecoveryState.throwIfFailed();
        if (
          activeInstallRequestRef.current !== requestGeneration
          || !isSameCatalogWorkspaceIdentity(workspaceIdentityRef.current, requestIdentity)
        ) {
          return;
        }

        const replicaId = await buildClientWorkspaceReplicaId(requestIdentity.workspaceId, installationId);
        indexedDbOpenRecoveryState.throwIfFailed();
        if (
          activeInstallRequestRef.current !== requestGeneration
          || !isSameCatalogWorkspaceIdentity(workspaceIdentityRef.current, requestIdentity)
        ) {
          return;
        }

        const installId = crypto.randomUUID().toLowerCase();
        const installedAt = new Date().toISOString();
        currentAttempt = {
          identity: requestIdentity,
          options: {
            addImportTag: importOptions.addImportTag,
            importTag,
            removeTags: [...importOptions.removeTags],
            installId,
            installedAt,
            clientUpdatedAt: installedAt,
            lastModifiedByReplicaId: replicaId,
            operationIdPrefix: installId,
          },
          cardCount: preview.summary.cardCount,
          importTag: importOptions.addImportTag ? importTag : null,
        };
        installAttemptRef.current = currentAttempt;
        setInstallAttempt(currentAttempt);
      }

      const requestAttempt = currentAttempt;
      indexedDbOpenRecoveryState.throwIfFailed();
      const result = await confirmCatalogPackageInstall(
        requestAttempt.identity.workspaceId,
        catalogContext.packageVersion.packageVersionId,
        requestAttempt.options,
      );
      indexedDbOpenRecoveryState.throwIfFailed();
      if (
        activeInstallRequestRef.current !== requestGeneration
        || !isSameCatalogWorkspaceIdentity(workspaceIdentityRef.current, requestAttempt.identity)
      ) {
        return;
      }
      if (result.packageVersion.packageVersionId !== catalogContext.packageVersion.packageVersionId) {
        throw new Error(
          `Catalog install returned a different package version. expected=${catalogContext.packageVersion.packageVersionId} actual=${result.packageVersion.packageVersionId}`,
        );
      }
      if (result.summary.installId !== requestAttempt.options.installId) {
        throw new Error(
          `Catalog install returned a different install id. expected=${requestAttempt.options.installId} actual=${result.summary.installId}`,
        );
      }

      setPreview(null);
      setPreviewIdentity(null);
      installAttemptRef.current = null;
      setInstallAttempt(null);
      setCompletion({
        cardCount: result.summary.cardCount,
        importTag: result.summary.importTag,
        workspaceName: requestWorkspaceName,
      });
      hasLeftInitialStepRef.current = true;
      setStep("done");
      void runPostInstallSync(requestAttempt.identity);
    } catch (error) {
      if (markIndexedDbOpenRecoveryFailureAndCheckActive(indexedDbOpenRecoveryState, error)) {
        return;
      }
      if (
        activeInstallRequestRef.current !== requestGeneration
        || !isSameCatalogWorkspaceIdentity(workspaceIdentityRef.current, requestIdentity)
      ) {
        return;
      }
      if (isAuthRedirectError(error)) {
        return;
      }
      if (isCatalogVersionUnavailableError(error)) {
        setPreview(null);
        setPreviewIdentity(null);
        installAttemptRef.current = null;
        setInstallAttempt(null);
        setErrorMessage(t("catalogImport.versionUnavailable"));
        return;
      }

      const wasCaptured = captureCatalogImportError(error, requestIdentity);
      if (wasCaptured) {
        showCapturedTechnicalError(error);
      }
      setErrorMessage(wasCaptured ? technicalErrorMessage : getCatalogImportErrorMessage(error));
    } finally {
      if (
        indexedDbOpenRecoveryState.hasFailed() === false
        && activeInstallRequestRef.current === requestGeneration
      ) {
        activeInstallRequestRef.current = null;
        setIsInstalling(false);
      }
    }
  }

  if (sessionLoadState === "loading" || sessionLoadState === "redirecting") {
    return (
      <CatalogImportStatePanel
        testId="catalog-import-session-loading"
        title={t("catalogImport.title")}
        message={t("loading.restoringSession")}
        retryLabel={null}
        onRetry={null}
      />
    );
  }

  if (sessionLoadState === "error" || sessionLoadState === "deleted") {
    return (
      <CatalogImportStatePanel
        testId="catalog-import-session-error"
        title={t("catalogImport.errorTitle")}
        message={sessionErrorMessage === "" ? t("catalogImport.errorBody") : sessionErrorMessage}
        retryLabel={t("common.retry")}
        onRetry={() => void initialize()}
      />
    );
  }

  return (
    <main className="invite-page" data-testid="catalog-import-authenticated">
      {hasWorkspaceStep && step === "confirm" ? (
        <CatalogImportBackNav
          isDisabled={isImportBusy || isWorkspaceSelectionBusy || areImportOptionsLocked}
          onBack={() => setStep("workspace")}
        />
      ) : null}
      <CatalogImportContextCard
        catalogContext={catalogContext}
        accountEmail={step === "done" ? null : (cloudSettings?.linkedEmail ?? session?.profile.email ?? null)}
      />
      {workspaceErrorMessage === "" ? null : (
        <section className="content-card invite-panel" data-testid="catalog-import-workspace-error">
          <p className="error-banner" role="alert">{workspaceErrorMessage}</p>
        </section>
      )}
      {step === "workspace" ? (
        <CatalogImportWorkspaceChooser
          isSelectionBusy={isWorkspaceSelectionBusy}
          onChooseWorkspace={(nextWorkspaceId) => void selectCatalogWorkspace(nextWorkspaceId)}
        />
      ) : null}
      {step === "confirm" && activeWorkspace !== null ? (
        <CatalogImportConfirmPanel
          copy={{
            title: t("catalogImport.installTitle"),
            description: t("catalogImport.installDescription"),
            workspaceLabel: t("catalogImport.workspaceTitle"),
            previewLoadingLabel: t("catalogImport.loading"),
            advancedTitle: t("catalogImport.advancedTitle"),
            importTagLabel: t("workspaceImport.importTagLabel"),
            importTagDescription: t("workspaceImport.importTagDescription"),
            importTagValueLabel: t("workspaceImport.importTagValueLabel"),
            tagsTitle: t("workspaceImport.previewTagsTitle"),
            confirmActionLabel: t("catalogImport.confirm"),
            confirmingActionLabel: t("catalogImport.installing"),
            retryPreviewLabel: t("common.retry"),
          }}
          workspaceName={activeWorkspace.name}
          preview={previewModel}
          options={options}
          isControlDisabled={!isImportAvailable || isImportBusy || areImportOptionsLocked}
          isPreviewLoading={isPreviewing}
          canConfirm={isPreviewCurrent && !isImportBusy && !isWorkspaceSelectionBusy}
          isConfirming={isInstalling}
          unavailableMessage={isImportAvailable ? null : t("catalogImport.workspaceUnavailable")}
          errorMessage={errorMessage}
          onOptionsChange={setOptions}
          onConfirm={(nextOptions) => void confirmInstall(nextOptions)}
          onRetryPreview={canRetryPreview ? () => void refreshPreview() : null}
        />
      ) : null}
      {step === "done" && completion !== null ? (
        <Fragment>
          <CatalogImportSuccessPanel
            cardCount={completion.cardCount}
            importTag={completion.importTag}
            workspaceName={completion.workspaceName}
            accountEmail={session?.profile.email ?? null}
          />
          <CatalogImportSyncStatus
            state={syncState}
            onRetry={() => {
              const identity = workspaceIdentityRef.current;
              if (identity !== null) {
                void runPostInstallSync(identity);
              }
            }}
          />
        </Fragment>
      ) : null}
    </main>
  );
}

export function CatalogImportAuthenticatedFlow(props: Readonly<{ catalogContext: CatalogImportContext }>): ReactElement {
  const { catalogContext } = props;
  return (
    <AppDataProvider>
      <CatalogImportAuthenticatedContent catalogContext={catalogContext} />
    </AppDataProvider>
  );
}
