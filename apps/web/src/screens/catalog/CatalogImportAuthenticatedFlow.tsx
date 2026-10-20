import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { useNavigate } from "react-router";
import {
  createCatalogInstallReportScope,
  reportCatalogInstallFailure,
  reportCatalogInstallPreviewReady,
  toCatalogInstallFailureReason,
  trackCatalogDeckInstallStarted,
  useAnalyticsScreenView,
  type CatalogInstallFailureStage,
  type CatalogInstallReportScope,
} from "../../analytics";
import {
  ApiContractError,
  confirmCatalogPackageInstall,
  isAuthRedirectError,
  previewCatalogPackageInstall,
} from "../../api";
import { useAppData } from "../../appData";
import { storeSelectedReviewFilterForWorkspace } from "../../appData/context/reviewFilterPersistence";
import { PublicGuestAppDataProvider } from "../settings/account/guest/GuestConversionGate";
import { requireCloudInstallationId } from "../../appData/sync/local/syncCloudSettings";
import { getSyncFailureObservationCaptureState } from "../../appData/sync/observation/syncErrorObservation";
import {
  markIndexedDbOpenRecoveryFailureAndCheckActive,
  useAppErrorDialog,
} from "../../appError/AppErrorContext";
import { useI18n } from "../../i18n";
import { loadCardsByIds } from "../../localDb/cards/cards";
import { buildClientWorkspaceReplicaId } from "../../media/mediaCrypto";
import { captureAppOperationError } from "../../observability/appOperationObservation";
import { buildWorkspaceRoute, reviewRoute } from "../../routes";
import type {
  CatalogPackageInstallConfirmOptions,
  CatalogPackageInstallPreviewResponse,
  CatalogPackageInstallWorkspaceContext,
  ReviewFilter,
} from "../../types";
import { CatalogImportConfirmPanel } from "./CatalogImportConfirmPanel";
import { CatalogImportWorkspaceChooser } from "./CatalogImportWorkspaceChooser";
import { CatalogImportEntry } from "./CatalogImportEntry";
import {
  CatalogImportContextCard,
  CatalogImportStatePanel,
  getCatalogImportErrorMessage,
  isCatalogVersionUnavailableError,
  type CatalogImportContext,
} from "./catalogImportShared";
import {
  useCatalogPackageInstallContext,
  type CatalogPackageInstallContextLoader,
} from "./useCatalogPackageInstallContext";

type CatalogImportStep = "confirm" | "workspace" | "destination";

type CatalogWorkspaceIdentity = Readonly<{
  userId: string;
  workspaceId: string;
  installationId: string;
}>;

type CatalogInstallAttempt = Readonly<{
  identity: CatalogWorkspaceIdentity;
  options: CatalogPackageInstallConfirmOptions;
}>;

type CatalogImportedCopy = Readonly<{
  identity: CatalogWorkspaceIdentity;
  cardIds: ReadonlyArray<string>;
  reviewFilter: Extract<ReviewFilter, { kind: "catalogImport" }>;
}>;

type CatalogInstallSyncState =
  | Readonly<{ status: "idle" }>
  | Readonly<{ status: "syncing" }>
  | Readonly<{ status: "failed"; errorMessage: string }>;

function isSameCatalogWorkspaceIdentity(
  left: CatalogWorkspaceIdentity | null,
  right: CatalogWorkspaceIdentity,
): boolean {
  return left !== null
    && left.userId === right.userId
    && left.workspaceId === right.workspaceId
    && left.installationId === right.installationId;
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

function CatalogImportSyncStatus(props: Readonly<{
  state: CatalogInstallSyncState;
  onRetry: () => void;
}>): ReactElement | null {
  const { state, onRetry } = props;
  const { t } = useI18n();

  if (state.status === "idle") {
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

function CatalogImportAuthenticatedContent(props: Readonly<{
  catalogContext: CatalogImportContext;
  installContextLoader?: CatalogPackageInstallContextLoader;
}>): ReactElement {
  const { catalogContext, installContextLoader } = props;
  const navigate = useNavigate();
  const {
    activeWorkspace,
    chooseWorkspace,
    createWorkspace,
    cloudSettings,
    errorMessage: appDataErrorMessage,
    initialize,
    isChoosingWorkspace,
    isSessionVerified,
    openReview,
    refreshLocalData,
    session,
    sessionErrorMessage,
    sessionLoadState,
  } = useAppData();
  const localInstallContextLoader = useCatalogPackageInstallContext(
    catalogContext.packageVersionId,
    installContextLoader === undefined
      && (sessionLoadState === "ready" || sessionLoadState === "selecting_workspace")
      && isSessionVerified
      ? session?.userId ?? null
      : null,
  );
  const resolvedInstallContextLoader = installContextLoader ?? localInstallContextLoader;
  const installContextState = resolvedInstallContextLoader.state;
  const { indexedDbOpenRecoveryState, showCapturedTechnicalError } = useAppErrorDialog();
  const { messages, t, formatCount } = useI18n();
  const isWorkspaceChoiceAvailable = installContextState.status === "ready"
    && installContextState.context.workspaces.length > 1;
  const [step, setStep] = useState<CatalogImportStep>("confirm");
  const [createdWorkspace, setCreatedWorkspace] = useState<CatalogPackageInstallWorkspaceContext | null>(null);
  const [preview, setPreview] = useState<CatalogPackageInstallPreviewResponse | null>(null);
  const [previewIdentity, setPreviewIdentity] = useState<CatalogWorkspaceIdentity | null>(null);
  const [installAttempt, setInstallAttempt] = useState<CatalogInstallAttempt | null>(null);
  const [importedCopy, setImportedCopy] = useState<CatalogImportedCopy | null>(null);
  const [syncState, setSyncState] = useState<CatalogInstallSyncState>({ status: "idle" });
  const [isWorkspaceSelectionPending, setIsWorkspaceSelectionPending] = useState<boolean>(false);
  const [isPreviewing, setIsPreviewing] = useState<boolean>(false);
  const [isInstalling, setIsInstalling] = useState<boolean>(false);
  const [isStudyingExisting, setIsStudyingExisting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [previewReportScope] = useState<CatalogInstallReportScope>(createCatalogInstallReportScope);
  const previewRequestGenerationRef = useRef<number>(0);
  const installRequestGenerationRef = useRef<number>(0);
  const syncRequestGenerationRef = useRef<number>(0);
  const activePreviewRequestRef = useRef<number | null>(null);
  const activeInstallRequestRef = useRef<number | null>(null);
  const activeSyncRequestRef = useRef<number | null>(null);
  const activeStudyRequestRef = useRef<number | null>(null);
  const workspaceSelectionInFlightRef = useRef<boolean>(false);
  const pendingWorkspaceSelectionRef = useRef<string | null>(null);
  const pendingImportRef = useRef<Readonly<{ userId: string; workspaceId: string }> | null>(null);
  const installAttemptRef = useRef<CatalogInstallAttempt | null>(null);
  const technicalErrorMessage = t("appError.technicalError.message");
  const workspaceId = activeWorkspace?.workspaceId ?? null;
  const workspaceIdentity: CatalogWorkspaceIdentity | null = workspaceId !== null
    && session !== null
    && cloudSettings?.linkedUserId === session.userId
    && (session.browserGuestCapabilities?.isGuest === true
      ? cloudSettings.cloudState === "guest" && session.selectedWorkspaceId === workspaceId
      : cloudSettings.cloudState === "linked")
    && cloudSettings.linkedWorkspaceId === workspaceId
    && cloudSettings.installationId.trim() !== ""
    ? { userId: session.userId, workspaceId, installationId: cloudSettings.installationId }
    : null;
  const sessionUserIdRef = useRef(session?.userId ?? null);
  sessionUserIdRef.current = session?.userId ?? null;
  const workspaceIdentityRef = useRef<CatalogWorkspaceIdentity | null>(workspaceIdentity);
  workspaceIdentityRef.current = workspaceIdentity;
  const workspaceIdentityKey = workspaceIdentity === null
    ? ""
    : `${workspaceIdentity.userId}:${workspaceIdentity.workspaceId}:${workspaceIdentity.installationId}`;
  const isWorkspaceSelectionBusy = isChoosingWorkspace || isWorkspaceSelectionPending;
  const isImportAvailable = sessionLoadState === "ready"
    && installContextState.status === "ready"
    && isSessionVerified
    && workspaceIdentity !== null
    && !isWorkspaceSelectionBusy;
  const selectedWorkspaceContext = installContextState.status === "ready"
    ? installContextState.context.workspaces.find((workspace) => workspace.workspaceId === workspaceId)
      ?? (createdWorkspace?.workspaceId === workspaceId ? createdWorkspace : null)
    : null;
  const previousInstall = selectedWorkspaceContext?.previousInstall ?? null;
  const isImportContextReady = selectedWorkspaceContext !== null;
  const isImportContextLoading = installContextState.status === "idle" || installContextState.status === "loading";
  const importContextErrorMessage = installContextState.status === "error"
    ? getCatalogImportErrorMessage(installContextState.error)
    : installContextState.status === "ready" && selectedWorkspaceContext === null
      ? t("catalogImport.workspaceUnavailable")
      : "";
  const isImportBusy = isPreviewing || isInstalling || isStudyingExisting || syncState.status === "syncing";
  const isPreviewCurrent = preview !== null
    && previewIdentity !== null
    && isImportAvailable
    && workspaceIdentity !== null
    && isSameCatalogWorkspaceIdentity(previewIdentity, workspaceIdentity);
  const areImportOptionsLocked = installAttempt !== null;
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
      entityId: catalogContext.packageVersionId,
    });
  }, [catalogContext.packageVersionId, session?.userId]);

  const runPostInstallSync = useCallback(async function runPostInstallSync(
    copy: CatalogImportedCopy,
  ): Promise<void> {
    const { identity, cardIds, reviewFilter } = copy;
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
      const localCards = await loadCardsByIds(identity.workspaceId, cardIds);
      indexedDbOpenRecoveryState.throwIfFailed();
      if (activeSyncRequestRef.current !== requestGeneration
        || !isSameCatalogWorkspaceIdentity(workspaceIdentityRef.current, identity)) {
        return;
      }
      if (cardIds.length === 0 || localCards.size !== cardIds.length
        || [...localCards.values()].some((card) => card.metadata.source?.importId !== reviewFilter.importId)) {
        throw new Error("Catalog import has not fully hydrated locally. Retry to sync the imported copy.");
      }
      storeSelectedReviewFilterForWorkspace(identity.workspaceId, reviewFilter);
      openReview(reviewFilter);
      navigate(buildWorkspaceRoute(identity.workspaceId, reviewRoute));
    } catch (error) {
      const indexedDbRecoveryFailed = markIndexedDbOpenRecoveryFailureAndCheckActive(
        indexedDbOpenRecoveryState,
        error,
      );
      if (
        activeSyncRequestRef.current !== requestGeneration
        || !isSameCatalogWorkspaceIdentity(workspaceIdentityRef.current, identity)
      ) {
        return;
      }
      reportCatalogInstallFailure(
        catalogContext.packageVersionId,
        "postinstall_sync",
        toCatalogInstallFailureReason(error),
      );
      if (indexedDbRecoveryFailed) {
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
  }, [
    catalogContext.packageVersionId,
    indexedDbOpenRecoveryState,
    navigate,
    openReview,
    refreshLocalData,
    showCapturedTechnicalError,
    t,
    technicalErrorMessage,
  ]);

  const refreshPreview = useCallback(async function refreshPreview(): Promise<void> {
    if (indexedDbOpenRecoveryState.hasFailed()) {
      return;
    }

    const requestIdentity = workspaceIdentityRef.current;
    if (!isImportAvailable || requestIdentity === null) {
      reportCatalogInstallFailure(
        catalogContext.packageVersionId,
        "preview",
        "workspace_unavailable",
      );
      setErrorMessage(t("catalogImport.workspaceUnavailable"));
      return;
    }
    if (
      workspaceSelectionInFlightRef.current
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
    setErrorMessage("");

    try {
      indexedDbOpenRecoveryState.throwIfFailed();
      const response = await previewCatalogPackageInstall(
        requestIdentity.workspaceId,
        catalogContext.packageVersionId,
      );
      indexedDbOpenRecoveryState.throwIfFailed();
      if (response.packageVersion.packageVersionId !== catalogContext.packageVersionId) {
        throw new ApiContractError(
          "POST /workspaces/{workspaceId}/catalog/package-versions/{packageVersionId}/install/preview",
          "packageVersion.packageVersionId",
          JSON.stringify(catalogContext.packageVersionId),
        );
      }
      if (
        activePreviewRequestRef.current !== requestGeneration
        || !isSameCatalogWorkspaceIdentity(workspaceIdentityRef.current, requestIdentity)
      ) {
        return;
      }
      reportCatalogInstallPreviewReady(
        previewReportScope,
        catalogContext.packageVersionId,
      );
      setPreview(response);
      setPreviewIdentity(requestIdentity);
    } catch (error) {
      const indexedDbRecoveryFailed = markIndexedDbOpenRecoveryFailureAndCheckActive(
        indexedDbOpenRecoveryState,
        error,
      );
      if (
        activePreviewRequestRef.current !== requestGeneration
        || !isSameCatalogWorkspaceIdentity(workspaceIdentityRef.current, requestIdentity)
      ) {
        return;
      }
      reportCatalogInstallFailure(
        catalogContext.packageVersionId,
        "preview",
        isCatalogVersionUnavailableError(error)
          ? "package_unavailable"
          : toCatalogInstallFailureReason(error),
      );
      if (indexedDbRecoveryFailed) {
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
    catalogContext.packageVersionId,
    indexedDbOpenRecoveryState,
    isImportAvailable,
    previewReportScope,
    showCapturedTechnicalError,
    t,
    technicalErrorMessage,
  ]);

  useEffect(() => {
    previewRequestGenerationRef.current += 1;
    installRequestGenerationRef.current += 1;
    syncRequestGenerationRef.current += 1;
    activePreviewRequestRef.current = null;
    activeInstallRequestRef.current = null;
    activeSyncRequestRef.current = null;
    activeStudyRequestRef.current = null;
    installAttemptRef.current = null;
    setPreview(null);
    setPreviewIdentity(null);
    setInstallAttempt(null);
    setImportedCopy(null);
    setSyncState({ status: "idle" });
    setIsPreviewing(false);
    setIsInstalling(false);
    setIsStudyingExisting(false);
    setErrorMessage("");
    return () => {
      activePreviewRequestRef.current = null;
      activeInstallRequestRef.current = null;
      activeSyncRequestRef.current = null;
      activeStudyRequestRef.current = null;
    };
  }, [isImportAvailable, workspaceIdentityKey]);

  useEffect(() => {
    if (!isImportAvailable || (step === "confirm" && isWorkspaceChoiceAvailable) || step === "workspace"
      || preview !== null || importedCopy !== null) {
      return;
    }
    void refreshPreview();
  }, [importedCopy, isImportAvailable, isWorkspaceChoiceAvailable, preview, refreshPreview, step, workspaceIdentityKey]);

  function cancelActivePreviewRequest(): void {
    if (activePreviewRequestRef.current === null) {
      return;
    }
    previewRequestGenerationRef.current += 1;
    activePreviewRequestRef.current = null;
    setIsPreviewing(false);
  }

  async function selectCatalogWorkspace(nextWorkspaceId: string): Promise<void> {
    if (indexedDbOpenRecoveryState.hasFailed() || session === null || workspaceSelectionInFlightRef.current
      || activeInstallRequestRef.current !== null || activeSyncRequestRef.current !== null) return;

    pendingImportRef.current = { userId: session.userId, workspaceId: nextWorkspaceId };
    if (nextWorkspaceId === workspaceId) {
      setStep("destination");
      return;
    }
    cancelActivePreviewRequest();
    workspaceSelectionInFlightRef.current = true;
    pendingWorkspaceSelectionRef.current = nextWorkspaceId;
    setIsWorkspaceSelectionPending(true);
    setErrorMessage("");
    try {
      await chooseWorkspace(nextWorkspaceId);
      indexedDbOpenRecoveryState.throwIfFailed();
    } catch (error) {
      pendingImportRef.current = null;
      if (!markIndexedDbOpenRecoveryFailureAndCheckActive(indexedDbOpenRecoveryState, error) && !isAuthRedirectError(error)) {
        setErrorMessage(getCatalogImportErrorMessage(error));
      }
    } finally {
      if (!indexedDbOpenRecoveryState.hasFailed()) {
        workspaceSelectionInFlightRef.current = false;
        setIsWorkspaceSelectionPending(false);
      }
    }
  }

  async function createCatalogWorkspace(name: string): Promise<void> {
    if (session === null || !isWorkspaceChoiceAvailable || workspaceSelectionInFlightRef.current || isImportBusy) return;
    const userId = session.userId;
    pendingImportRef.current = null;
    pendingWorkspaceSelectionRef.current = null;
    workspaceSelectionInFlightRef.current = true;
    setIsWorkspaceSelectionPending(true);
    setErrorMessage("");
    try {
      const workspace = await createWorkspace(name);
      indexedDbOpenRecoveryState.throwIfFailed();
      if (workspace === null || sessionUserIdRef.current !== userId) return;
      setCreatedWorkspace({
        ...workspace, cardCount: 0, lastReviewedAt: null, onboardingEligibility: "empty", previousInstall: null,
      });
      pendingImportRef.current = { userId, workspaceId: workspace.workspaceId };
      pendingWorkspaceSelectionRef.current = workspace.workspaceId;
    } catch (error) {
      if (!markIndexedDbOpenRecoveryFailureAndCheckActive(indexedDbOpenRecoveryState, error) && !isAuthRedirectError(error)) {
        setErrorMessage(getCatalogImportErrorMessage(error));
      }
    } finally {
      if (!indexedDbOpenRecoveryState.hasFailed()) {
        workspaceSelectionInFlightRef.current = false;
        setIsWorkspaceSelectionPending(false);
      }
    }
  }

  useEffect(() => {
    const pending = pendingImportRef.current;
    if (pending !== null && pending.userId !== session?.userId) {
      pendingImportRef.current = null;
      pendingWorkspaceSelectionRef.current = null;
      setCreatedWorkspace(null);
      setStep("confirm");
      return;
    }
    if (pendingWorkspaceSelectionRef.current === workspaceId && workspaceId !== null && !isWorkspaceSelectionBusy) {
      pendingWorkspaceSelectionRef.current = null;
      setStep("destination");
    }
  }, [session?.userId, workspaceId, isWorkspaceSelectionBusy]);

  useEffect(() => {
    const pending = pendingImportRef.current;
    if (pending === null || pending.userId !== session?.userId || pending.workspaceId !== workspaceId
      || step !== "destination" || !isPreviewCurrent || !isImportContextReady || isImportBusy) return;
    pendingImportRef.current = null;
    if (previousInstall === null) void confirmInstall();
  });

  async function studyExistingCards(): Promise<void> {
    const identity = workspaceIdentityRef.current;
    if (identity === null || previousInstall === null || !isImportAvailable || isImportBusy
      || areImportOptionsLocked || workspaceSelectionInFlightRef.current
      || activePreviewRequestRef.current !== null || activeInstallRequestRef.current !== null
      || activeSyncRequestRef.current !== null || activeStudyRequestRef.current !== null) {
      return;
    }
    const requestGeneration = syncRequestGenerationRef.current + 1;
    syncRequestGenerationRef.current = requestGeneration;
    activeStudyRequestRef.current = requestGeneration;
    setIsStudyingExisting(true);
    setErrorMessage("");
    try {
      indexedDbOpenRecoveryState.throwIfFailed();
      await refreshLocalData();
      indexedDbOpenRecoveryState.throwIfFailed();
      if (activeStudyRequestRef.current !== requestGeneration
        || !isSameCatalogWorkspaceIdentity(workspaceIdentityRef.current, identity)) {
        return;
      }
      const reviewFilter: ReviewFilter = {
        kind: "catalogImport",
        importId: previousInstall.installId,
        title: previousInstall.title,
      };
      storeSelectedReviewFilterForWorkspace(identity.workspaceId, reviewFilter);
      openReview(reviewFilter);
      navigate(buildWorkspaceRoute(identity.workspaceId, reviewRoute));
    } catch (error) {
      if (markIndexedDbOpenRecoveryFailureAndCheckActive(indexedDbOpenRecoveryState, error)
        || activeStudyRequestRef.current !== requestGeneration
        || !isSameCatalogWorkspaceIdentity(workspaceIdentityRef.current, identity)
        || isAuthRedirectError(error)) {
        return;
      }
      const wasCaptured = captureCatalogImportError(error, identity);
      if (wasCaptured) {
        showCapturedTechnicalError(error);
      }
      setErrorMessage(wasCaptured ? technicalErrorMessage : getCatalogImportErrorMessage(error));
    } finally {
      if (activeStudyRequestRef.current === requestGeneration) {
        activeStudyRequestRef.current = null;
        setIsStudyingExisting(false);
      }
    }
  }

  async function confirmInstall(): Promise<void> {
    if (indexedDbOpenRecoveryState.hasFailed()) {
      return;
    }

    const requestIdentity = workspaceIdentityRef.current;
    if (!isImportAvailable || requestIdentity === null || activeWorkspace === null) {
      reportCatalogInstallFailure(
        catalogContext.packageVersionId,
        "preinstall_sync",
        "workspace_unavailable",
      );
      setErrorMessage(t("catalogImport.workspaceUnavailable"));
      return;
    }
    if (
      workspaceSelectionInFlightRef.current
      || activePreviewRequestRef.current !== null
      || activeInstallRequestRef.current !== null
      || activeSyncRequestRef.current !== null
    ) {
      return;
    }
    if (!isPreviewCurrent || !isImportContextReady || activeStudyRequestRef.current !== null) {
      setErrorMessage(t("catalogImport.previewRequired"));
      return;
    }

    let currentAttempt = installAttemptRef.current;
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
    trackCatalogDeckInstallStarted(
      preview.packageVersion.slug,
      catalogContext.packageVersionId,
    );
    let failureStage: CatalogInstallFailureStage = currentAttempt === null
      ? "preinstall_sync"
      : "install";
    try {
      indexedDbOpenRecoveryState.throwIfFailed();
      if (currentAttempt === null) {
        const installationId = requireCloudInstallationId(cloudSettings);
        if (installationId !== requestIdentity.installationId) {
          reportCatalogInstallFailure(
            catalogContext.packageVersionId,
            "preinstall_sync",
            "workspace_unavailable",
          );
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
            addImportTag: false,
            importTag: "",
            removeTags: [],
            installId,
            installedAt,
            clientUpdatedAt: installedAt,
            lastModifiedByReplicaId: replicaId,
            operationIdPrefix: installId,
          },
        };
        installAttemptRef.current = currentAttempt;
        setInstallAttempt(currentAttempt);
      }

      const requestAttempt = currentAttempt;
      failureStage = "install";
      indexedDbOpenRecoveryState.throwIfFailed();
      const result = await confirmCatalogPackageInstall(
        requestAttempt.identity.workspaceId,
        catalogContext.packageVersionId,
        requestAttempt.options,
      );
      indexedDbOpenRecoveryState.throwIfFailed();
      if (
        activeInstallRequestRef.current !== requestGeneration
        || !isSameCatalogWorkspaceIdentity(workspaceIdentityRef.current, requestAttempt.identity)
      ) {
        return;
      }
      if (result.packageVersion.packageVersionId !== catalogContext.packageVersionId) {
        throw new ApiContractError(
          "POST /workspaces/{workspaceId}/catalog/package-versions/{packageVersionId}/install",
          "packageVersion.packageVersionId",
          JSON.stringify(catalogContext.packageVersionId),
        );
      }
      if (result.summary.installId !== requestAttempt.options.installId) {
        throw new ApiContractError(
          "POST /workspaces/{workspaceId}/catalog/package-versions/{packageVersionId}/install",
          "summary.installId",
          JSON.stringify(requestAttempt.options.installId),
        );
      }

      setPreview(null);
      setPreviewIdentity(null);
      installAttemptRef.current = null;
      setInstallAttempt(null);
      const copy: CatalogImportedCopy = {
        identity: requestAttempt.identity,
        cardIds: result.installedCards.map((card) => card.cardId),
        reviewFilter: {
          kind: "catalogImport",
          importId: result.summary.installId,
          title: result.packageVersion.title,
        },
      };
      setImportedCopy(copy);
      void runPostInstallSync(copy);
    } catch (error) {
      const indexedDbRecoveryFailed = markIndexedDbOpenRecoveryFailureAndCheckActive(
        indexedDbOpenRecoveryState,
        error,
      );
      if (
        activeInstallRequestRef.current !== requestGeneration
        || !isSameCatalogWorkspaceIdentity(workspaceIdentityRef.current, requestIdentity)
      ) {
        return;
      }
      reportCatalogInstallFailure(
        catalogContext.packageVersionId,
        failureStage,
        isCatalogVersionUnavailableError(error)
          ? "package_unavailable"
          : toCatalogInstallFailureReason(error),
      );
      if (indexedDbRecoveryFailed) {
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

  const isSessionPanelVisible = sessionLoadState === "loading"
    || sessionLoadState === "redirecting"
    || sessionLoadState === "error"
    || sessionLoadState === "guest_recovery"
    || sessionLoadState === "deleted"
    || sessionLoadState === "storage_unavailable"
    || installContextState.status !== "ready";
  useAnalyticsScreenView(isSessionPanelVisible || importedCopy !== null ? null
    : step === "workspace" ? "catalog_import_workspace" : "catalog_import_confirm");

  if (sessionLoadState === "loading" || sessionLoadState === "redirecting") {
    return (
      <CatalogImportStatePanel
        testId="catalog-import-session-loading"
        title={t("catalogImport.title")}
        message={t("loading.restoringSession")}
        guidance={null}
        retryLabel={null}
        onRetry={null}
      />
    );
  }

  if (sessionLoadState === "storage_unavailable") {
    // Retrying cannot help a browser that exposes no storage, so this panel offers no retry.
    return (
      <CatalogImportStatePanel
        testId="catalog-import-session-storage-unavailable"
        title={t("appError.storageUnavailable.title")}
        message={t("appError.storageUnavailable.message")}
        guidance={t("appError.storageUnavailable.guidance")}
        retryLabel={null}
        onRetry={null}
      />
    );
  }

  if (sessionLoadState === "error" || sessionLoadState === "guest_recovery" || sessionLoadState === "deleted") {
    return (
      <CatalogImportStatePanel
        testId="catalog-import-session-error"
        title={t("catalogImport.errorTitle")}
        message={sessionErrorMessage === "" ? t("catalogImport.errorBody") : sessionErrorMessage}
        guidance={null}
        retryLabel={t("common.retry")}
        onRetry={() => void initialize()}
      />
    );
  }

  if (installContextState.status === "error") {
    return (
      <CatalogImportStatePanel
        testId="catalog-import-context-error"
        title={t("catalogImport.errorTitle")}
        message={isCatalogVersionUnavailableError(installContextState.error)
          ? t("catalogImport.versionUnavailable")
          : getCatalogImportErrorMessage(installContextState.error)}
        guidance={null}
        retryLabel={t("common.retry")}
        onRetry={resolvedInstallContextLoader.retry}
      />
    );
  }

  if (installContextState.status !== "ready") {
    return (
      <CatalogImportStatePanel
        testId="catalog-import-context-loading"
        title={t("catalogImport.title")}
        message={t("catalogImport.loading")}
        guidance={null}
        retryLabel={null}
        onRetry={null}
      />
    );
  }

  const isFirstConfirmation = step === "confirm";
  const isDestinationChoice = isFirstConfirmation && isWorkspaceChoiceAvailable;
  const existingCopy = isDestinationChoice ? null : previousInstall;
  const isBusy = isImportBusy || isWorkspaceSelectionBusy;
  const destinationCount = selectedWorkspaceContext === null ? null
    : formatCount(selectedWorkspaceContext.cardCount, messages.common.countLabels.card);

  return (
    <main className="invite-page" data-testid="catalog-import-authenticated">
      {importedCopy === null ? <CatalogImportBackNav
        isDisabled={isBusy || areImportOptionsLocked}
        onBack={() => {
          pendingImportRef.current = null;
          setErrorMessage("");
          if (step === "workspace") setStep("confirm");
          else if (step === "destination") setStep(isWorkspaceChoiceAvailable ? "workspace" : "confirm");
          else navigate(workspaceId === null ? "/" : buildWorkspaceRoute(workspaceId, reviewRoute));
        }}
      /> : null}
      {workspaceErrorMessage === "" ? null : (
        <section className="content-card invite-panel" data-testid="catalog-import-workspace-error">
          <p className="error-banner" role="alert">{workspaceErrorMessage}</p>
        </section>
      )}
      {importedCopy === null && step === "workspace" ? (
        <>
          <CatalogImportWorkspaceChooser
            workspaces={installContextState.context.workspaces}
            isSelectionBusy={isBusy}
            onChooseWorkspace={(nextWorkspaceId) => void selectCatalogWorkspace(nextWorkspaceId)}
            onCreateWorkspace={(name) => void createCatalogWorkspace(name)}
          />
          {errorMessage === "" ? null : <p className="error-banner" role="alert" data-testid="workspace-import-error">{errorMessage}</p>}
        </>
      ) : null}
      {importedCopy === null && step !== "workspace" ? (
        <CatalogImportConfirmPanel
          description={t("catalogImport.installDescription")}
          confirmActionLabel={existingCopy === null
            ? t("catalogImport.confirm", { count: formatCount(catalogContext.cardCount, messages.common.countLabels.card) })
            : t("catalogImport.importAnotherCopy")}
          confirmingActionLabel={t("catalogImport.installing")}
          loadingLabel={t("catalogImport.loading")}
          retryLabel={t("common.retry")}
          isLoading={!isDestinationChoice && (isPreviewing || isImportContextLoading)}
          canConfirm={!isBusy && (isDestinationChoice || (isPreviewCurrent && isImportContextReady))}
          isConfirming={isInstalling}
          errorMessage={errorMessage || (isDestinationChoice ? "" : importContextErrorMessage)}
          existingCopy={existingCopy === null ? null : {
            notice: t("catalogImport.existingCopyNotice", {
              title: existingCopy.title,
              count: formatCount(existingCopy.retainedCardCount, messages.common.countLabels.card),
            }),
            actionLabel: t("catalogImport.studyExistingCards"),
            isLoading: isStudyingExisting,
            isDisabled: !isImportAvailable || isBusy || areImportOptionsLocked,
            onStudy: () => void studyExistingCards(),
          }}
          onConfirm={() => {
            if (isDestinationChoice) setStep("workspace");
            else void confirmInstall();
          }}
          onRetry={importContextErrorMessage !== "" && !isDestinationChoice
            ? resolvedInstallContextLoader.retry : canRetryPreview ? () => void refreshPreview() : null}
        >
          <CatalogImportContextCard catalogContext={catalogContext}
            accountEmail={session?.browserGuestCapabilities?.isGuest === true
              ? null : cloudSettings?.linkedEmail ?? session?.profile.email ?? null} />
          {isDestinationChoice ? (
            <p className="subtitle" data-testid="catalog-import-visible-card-count">
              {t("catalogImport.visibleCardCount", {
                count: formatCount(installContextState.context.workspaces.reduce((sum, workspace) => sum + workspace.cardCount, 0), messages.common.countLabels.card),
              })}
            </p>
          ) : selectedWorkspaceContext === null || destinationCount === null ? null : (
            <p className="subtitle" data-testid="catalog-import-workspace-name">
              {selectedWorkspaceContext.name} · {destinationCount}
            </p>
          )}
        </CatalogImportConfirmPanel>
      ) : null}
      {importedCopy === null ? null : (
        <CatalogImportSyncStatus state={syncState} onRetry={() => void runPostInstallSync(importedCopy)} />
      )}
    </main>
  );
}

export function CatalogImportAuthenticatedFlow(props: Readonly<{
  catalogContext: CatalogImportContext;
  installContextLoader?: CatalogPackageInstallContextLoader;
}>): ReactElement {
  const { catalogContext, installContextLoader } = props;
  return (
    <PublicGuestAppDataProvider>
      <CatalogImportEntry
        key={catalogContext.packageVersionId}
        catalogContext={catalogContext}
        renderManual={(loader) => <CatalogImportAuthenticatedContent
          catalogContext={catalogContext}
          installContextLoader={installContextLoader ?? loader}
        />}
      />
    </PublicGuestAppDataProvider>
  );
}
