import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { useParams } from "react-router";
import {
  ApiError,
  buildLoginUrl,
  confirmCatalogPackageInstall,
  getOptionalSession,
  isAuthRedirectError,
  loadPublicCatalog,
  previewCatalogPackageInstall,
} from "../../api";
import { AppDataProvider, useAppData } from "../../appData";
import { requireCloudInstallationId } from "../../appData/sync/local/syncCloudSettings";
import { getSyncFailureObservationCaptureState } from "../../appData/sync/observation/syncErrorObservation";
import { useAppErrorDialog } from "../../appError/AppErrorContext";
import { type TranslationKey, type TranslationValues, useI18n } from "../../i18n";
import { buildClientWorkspaceReplicaId } from "../../media/mediaCrypto";
import { captureAppOperationError } from "../../observability/appOperationObservation";
import type {
  CatalogPackageInstallConfirmOptions,
  CatalogPackageInstallPreviewResponse,
  CatalogPublicSnapshot,
  CatalogPublicSnapshotAuthor,
  CatalogPublicSnapshotPackage,
  CatalogPublicSnapshotPackageVersion,
  SessionInfo,
} from "../../types";
import { WorkspaceImportPresentation } from "../settings/workspace/packages/WorkspaceImportPresentation";
import type {
  WorkspaceImportOptions,
  WorkspaceImportPreviewModel,
} from "../settings/workspace/packages/workspaceImportPresentationModel";

type CatalogImportLoadState = "loading" | "error" | "not_found" | "signed_out" | "signed_in";

type CatalogImportContext = Readonly<{
  author: CatalogPublicSnapshotAuthor;
  catalogPackage: CatalogPublicSnapshotPackage;
  packageVersion: CatalogPublicSnapshotPackageVersion;
}>;

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

type CatalogInstallSyncState =
  | Readonly<{ status: "idle" }>
  | Readonly<{ status: "syncing" }>
  | Readonly<{ status: "succeeded" }>
  | Readonly<{ status: "failed"; errorMessage: string }>;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parsePackageVersionId(value: string | undefined): string | null {
  if (value === undefined || uuidPattern.test(value) === false) {
    return null;
  }

  return value.toLowerCase();
}

function resolveCatalogImportContext(
  snapshot: CatalogPublicSnapshot,
  packageVersionId: string,
): CatalogImportContext | null {
  const packageVersion = snapshot.packageVersions.find((version) => version.packageVersionId === packageVersionId) ?? null;
  if (packageVersion === null) {
    return null;
  }

  const catalogPackage = snapshot.packages.find((item) => item.packageId === packageVersion.packageId) ?? null;
  if (catalogPackage === null) {
    throw new Error(`Catalog snapshot package is missing. packageId=${packageVersion.packageId}`);
  }

  const author = snapshot.authors.find((item) => item.authorId === catalogPackage.authorId) ?? null;
  if (author === null) {
    throw new Error(`Catalog snapshot author is missing. authorId=${catalogPackage.authorId}`);
  }

  return { author, catalogPackage, packageVersion };
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isCatalogVersionUnavailableError(error: unknown): boolean {
  return error instanceof ApiError && (
    error.code === "CATALOG_PACKAGE_VERSION_NOT_FOUND"
    || error.code === "CATALOG_PACKAGE_VERSION_NOT_PUBLISHED"
    || error.code === "CATALOG_PACKAGE_VERSION_EMPTY"
  );
}

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

function buildCatalogImportSuccessMessage(
  cardCount: number,
  importTag: string | null,
  t: (key: TranslationKey, values?: TranslationValues) => string,
): string {
  return importTag === null
    ? t("catalogImport.success", { count: cardCount })
    : t("catalogImport.successWithTag", { count: cardCount, tag: importTag });
}

function CatalogImportContextCard(props: Readonly<{ catalogContext: CatalogImportContext }>): ReactElement {
  const { catalogContext } = props;
  const { messages, t, formatCount } = useI18n();
  const cardCount = formatCount(catalogContext.packageVersion.cardCount, messages.common.countLabels.card);

  return (
    <section className="content-card invite-panel" data-testid="catalog-import-context">
      <h1 className="title">{t("catalogImport.title")}</h1>
      <p className="subtitle" data-testid="catalog-import-package-summary">
        {t("catalogImport.packageSummary", {
          title: catalogContext.packageVersion.title,
          count: cardCount,
        })}
      </p>
      <p className="subtitle" data-testid="catalog-import-author">
        {t("catalogImport.author", { author: catalogContext.author.displayName })}
      </p>
    </section>
  );
}

function CatalogImportStatePanel(props: Readonly<{
  testId: string;
  title: string;
  message: string;
  retryLabel: string | null;
  onRetry: (() => void) | null;
}>): ReactElement {
  const { testId, title, message, retryLabel, onRetry } = props;
  return (
    <main className="invite-page">
      <section className="content-card invite-panel" data-testid={testId}>
        <h1 className="title">{title}</h1>
        <p className="subtitle">{message}</p>
        {retryLabel === null || onRetry === null ? null : (
          <button className="primary-btn" type="button" data-testid={`${testId}-retry`} onClick={onRetry}>
            {retryLabel}
          </button>
        )}
      </section>
    </main>
  );
}

function CatalogImportSignedOutScreen(props: Readonly<{ catalogContext: CatalogImportContext }>): ReactElement {
  const { catalogContext } = props;
  const { locale, t } = useI18n();

  return (
    <main className="invite-page" data-testid="catalog-import-signed-out">
      <CatalogImportContextCard catalogContext={catalogContext} />
      <section className="content-card invite-panel">
        <h2 className="panel-subtitle">{t("catalogImport.signInTitle")}</h2>
        <p className="subtitle">{t("catalogImport.signInBody")}</p>
        <a
          className="primary-btn"
          href={buildLoginUrl(window.location.href, locale)}
          data-testid="catalog-import-sign-in"
        >
          {t("catalogImport.signInAction")}
        </a>
      </section>
    </main>
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
  isImportBusy: boolean;
  errorMessage: string;
  onChooseWorkspace: (workspaceId: string) => void;
}>): ReactElement {
  const { isImportBusy, errorMessage, onChooseWorkspace } = props;
  const {
    activeWorkspace,
    availableWorkspaces,
    isChoosingWorkspace,
  } = useAppData();
  const { t, formatDateTime } = useI18n();

  if (availableWorkspaces.length === 1 && activeWorkspace !== null) {
    return (
      <section className="content-card invite-panel" data-testid="catalog-import-workspace-fixed">
        <strong className="panel-subtitle">{t("catalogImport.workspaceTitle")}</strong>
        <p className="subtitle" data-testid="catalog-import-workspace-name">{activeWorkspace.name}</p>
      </section>
    );
  }

  return (
    <section className="content-card invite-panel workspace-modal" data-testid="catalog-import-workspace-selector">
      <strong className="panel-subtitle">{t("catalogImport.workspaceTitle")}</strong>
      <p className="subtitle">{t("catalogImport.workspaceDescription")}</p>
      <div className="workspace-choice-list">
        {availableWorkspaces.map((workspace) => (
          <button
            key={workspace.workspaceId}
            className="ghost-btn workspace-choice-btn"
            type="button"
            disabled={isChoosingWorkspace || isImportBusy || workspace.workspaceId === activeWorkspace?.workspaceId}
            data-testid="catalog-import-workspace-option"
            data-workspace-id={workspace.workspaceId}
            onClick={() => onChooseWorkspace(workspace.workspaceId)}
          >
            <span className="workspace-choice-name">{workspace.name}</span>
            <span className="workspace-choice-meta">{formatDateTime(workspace.createdAt)}</span>
          </button>
        ))}
      </div>
      {errorMessage === "" ? null : <p className="error-banner" role="alert">{errorMessage}</p>}
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
  const { showCapturedTechnicalError } = useAppErrorDialog();
  const { t, formatNumber } = useI18n();
  const [preview, setPreview] = useState<CatalogPackageInstallPreviewResponse | null>(null);
  const [previewIdentity, setPreviewIdentity] = useState<CatalogWorkspaceIdentity | null>(null);
  const [options, setOptions] = useState<WorkspaceImportOptions>(createInitialImportOptions);
  const [installAttempt, setInstallAttempt] = useState<CatalogInstallAttempt | null>(null);
  const [syncState, setSyncState] = useState<CatalogInstallSyncState>({ status: "idle" });
  const [isWorkspaceSelectionPending, setIsWorkspaceSelectionPending] = useState<boolean>(false);
  const [isPreviewing, setIsPreviewing] = useState<boolean>(false);
  const [isInstalling, setIsInstalling] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [successMessage, setSuccessMessage] = useState<string>("");
  const previewRequestGenerationRef = useRef<number>(0);
  const installRequestGenerationRef = useRef<number>(0);
  const syncRequestGenerationRef = useRef<number>(0);
  const activePreviewRequestRef = useRef<number | null>(null);
  const activeInstallRequestRef = useRef<number | null>(null);
  const activeSyncRequestRef = useRef<number | null>(null);
  const workspaceSelectionInFlightRef = useRef<boolean>(false);
  const installAttemptRef = useRef<CatalogInstallAttempt | null>(null);
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
      activeSyncRequestRef.current !== null
      || !isSameCatalogWorkspaceIdentity(workspaceIdentityRef.current, identity)
    ) {
      return;
    }

    const requestGeneration = syncRequestGenerationRef.current + 1;
    syncRequestGenerationRef.current = requestGeneration;
    activeSyncRequestRef.current = requestGeneration;
    setSyncState({ status: "syncing" });

    try {
      await refreshLocalData();
      if (
        activeSyncRequestRef.current !== requestGeneration
        || !isSameCatalogWorkspaceIdentity(workspaceIdentityRef.current, identity)
      ) {
        return;
      }
      setSyncState({ status: "succeeded" });
    } catch (error) {
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
  }, [refreshLocalData, showCapturedTechnicalError, t, technicalErrorMessage]);

  const refreshPreview = useCallback(async function refreshPreview(): Promise<void> {
    const requestIdentity = workspaceIdentityRef.current;
    if (!isImportAvailable || requestIdentity === null) {
      setErrorMessage(t("catalogImport.workspaceUnavailable"));
      setSuccessMessage("");
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
    setOptions(createInitialImportOptions());
    setErrorMessage("");
    setSuccessMessage("");

    try {
      const response = await previewCatalogPackageInstall(
        requestIdentity.workspaceId,
        catalogContext.packageVersion.packageVersionId,
      );
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
      setErrorMessage(wasCaptured ? technicalErrorMessage : getErrorMessage(error));
    } finally {
      if (activePreviewRequestRef.current === requestGeneration) {
        activePreviewRequestRef.current = null;
        setIsPreviewing(false);
      }
    }
  }, [
    captureCatalogImportError,
    catalogContext.packageVersion.packageVersionId,
    isImportAvailable,
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
    installAttemptRef.current = null;
    setPreview(null);
    setPreviewIdentity(null);
    setOptions(createInitialImportOptions());
    setInstallAttempt(null);
    setSyncState({ status: "idle" });
    setIsPreviewing(false);
    setIsInstalling(false);
    setErrorMessage("");
    setSuccessMessage("");
    if (isImportAvailable) {
      void refreshPreview();
    }
  }, [isImportAvailable, refreshPreview, workspaceIdentityKey]);

  async function selectCatalogWorkspace(nextWorkspaceId: string): Promise<void> {
    if (
      workspaceSelectionInFlightRef.current
      || activePreviewRequestRef.current !== null
      || activeInstallRequestRef.current !== null
      || activeSyncRequestRef.current !== null
    ) {
      return;
    }

    workspaceSelectionInFlightRef.current = true;
    setIsWorkspaceSelectionPending(true);
    try {
      await chooseWorkspace(nextWorkspaceId);
    } finally {
      workspaceSelectionInFlightRef.current = false;
      setIsWorkspaceSelectionPending(false);
    }
  }

  async function confirmInstall(importOptions: WorkspaceImportOptions): Promise<void> {
    const requestIdentity = workspaceIdentityRef.current;
    if (!isImportAvailable || requestIdentity === null) {
      setErrorMessage(t("catalogImport.workspaceUnavailable"));
      setSuccessMessage("");
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
    if (!isPreviewCurrent) {
      setErrorMessage(t("catalogImport.previewRequired"));
      setSuccessMessage("");
      return;
    }

    let currentAttempt = installAttemptRef.current;
    const importTag = importOptions.importTag.trim();
    if (currentAttempt === null && importOptions.addImportTag && importTag === "") {
      setErrorMessage(t("workspaceImport.importTagRequired"));
      setSuccessMessage("");
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
    setSuccessMessage("");
    try {
      if (currentAttempt === null) {
        const installationId = requireCloudInstallationId(cloudSettings);
        if (installationId !== requestIdentity.installationId) {
          setErrorMessage(t("catalogImport.workspaceUnavailable"));
          return;
        }

        await refreshLocalData();
        if (
          activeInstallRequestRef.current !== requestGeneration
          || !isSameCatalogWorkspaceIdentity(workspaceIdentityRef.current, requestIdentity)
        ) {
          return;
        }

        const replicaId = await buildClientWorkspaceReplicaId(requestIdentity.workspaceId, installationId);
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
      const result = await confirmCatalogPackageInstall(
        requestAttempt.identity.workspaceId,
        catalogContext.packageVersion.packageVersionId,
        requestAttempt.options,
      );
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
      setSuccessMessage(buildCatalogImportSuccessMessage(
        result.summary.cardCount,
        result.summary.importTag,
        t,
      ));
      void runPostInstallSync(requestAttempt.identity);
    } catch (error) {
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
      setErrorMessage(wasCaptured ? technicalErrorMessage : getErrorMessage(error));
    } finally {
      if (activeInstallRequestRef.current === requestGeneration) {
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
      <CatalogImportContextCard catalogContext={catalogContext} />
      <CatalogImportWorkspaceChooser
        isImportBusy={isImportBusy || isWorkspaceSelectionBusy}
        errorMessage={workspaceErrorMessage}
        onChooseWorkspace={(nextWorkspaceId) => void selectCatalogWorkspace(nextWorkspaceId)}
      />
      {activeWorkspace === null ? null : (
        <section className="settings-group">
          <WorkspaceImportPresentation
            copy={{
              title: t("catalogImport.installTitle"),
              description: t("catalogImport.installDescription"),
              importTagLabel: t("workspaceImport.importTagLabel"),
              importTagDescription: t("workspaceImport.importTagDescription"),
              importTagValueLabel: t("workspaceImport.importTagValueLabel"),
              warningsTitle: t("workspaceImport.previewWarningsTitle"),
              tagsTitle: t("workspaceImport.previewTagsTitle"),
              selectionActionLabel: isPreviewing ? t("catalogImport.previewing") : t("catalogImport.refreshPreview"),
              confirmActionLabel: t("catalogImport.confirm"),
              confirmingActionLabel: t("catalogImport.installing"),
            }}
            preview={previewModel}
            options={options}
            isControlDisabled={!isImportAvailable || isImportBusy || areImportOptionsLocked}
            canConfirm={isPreviewCurrent && !isImportBusy && !isWorkspaceSelectionBusy}
            isConfirming={isInstalling}
            unavailableMessage={isImportAvailable ? null : t("catalogImport.workspaceUnavailable")}
            errorMessage={errorMessage}
            successMessage={successMessage}
            onSelect={() => void refreshPreview()}
            onOptionsChange={setOptions}
            onConfirm={(nextOptions) => void confirmInstall(nextOptions)}
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
        </section>
      )}
    </main>
  );
}

function CatalogImportAuthenticatedScreen(props: Readonly<{ catalogContext: CatalogImportContext }>): ReactElement {
  const { catalogContext } = props;
  return (
    <AppDataProvider>
      <CatalogImportAuthenticatedContent catalogContext={catalogContext} />
    </AppDataProvider>
  );
}

export function CatalogImportScreen(): ReactElement {
  const { packageVersionId: routePackageVersionId } = useParams();
  const packageVersionId = parsePackageVersionId(routePackageVersionId);
  const { showTechnicalError } = useAppErrorDialog();
  const { t } = useI18n();
  const [loadState, setLoadState] = useState<CatalogImportLoadState>("loading");
  const [catalogContext, setCatalogContext] = useState<CatalogImportContext | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [session, setSession] = useState<SessionInfo | null>(null);
  const loadRequestGenerationRef = useRef<number>(0);
  const technicalErrorMessage = t("appError.technicalError.message");

  const loadCatalogImport = useCallback(async function loadCatalogImport(): Promise<void> {
    const requestGeneration = loadRequestGenerationRef.current + 1;
    loadRequestGenerationRef.current = requestGeneration;
    if (packageVersionId === null) {
      setLoadState("error");
      setErrorMessage(t("catalogImport.invalidVersion"));
      return;
    }

    setLoadState("loading");
    setCatalogContext(null);
    setSession(null);
    setErrorMessage("");
    try {
      const snapshot = await loadPublicCatalog();
      if (loadRequestGenerationRef.current !== requestGeneration) {
        return;
      }
      const nextCatalogContext = resolveCatalogImportContext(snapshot, packageVersionId);
      if (nextCatalogContext === null) {
        setLoadState("not_found");
        return;
      }

      const optionalSession = await getOptionalSession();
      if (loadRequestGenerationRef.current !== requestGeneration) {
        return;
      }
      setCatalogContext(nextCatalogContext);
      setSession(optionalSession);
      setLoadState(optionalSession === null ? "signed_out" : "signed_in");
    } catch (error) {
      if (loadRequestGenerationRef.current !== requestGeneration) {
        return;
      }
      if (isAuthRedirectError(error)) {
        return;
      }
      const wasCaptured = showTechnicalError(error, {
        feature: "settings",
        operation: "catalog_import",
        userId: null,
        workspaceId: null,
        installationId: null,
        entityId: packageVersionId,
      });
      setErrorMessage(wasCaptured ? technicalErrorMessage : getErrorMessage(error));
      setLoadState("error");
    }
  }, [packageVersionId, showTechnicalError, t, technicalErrorMessage]);

  useEffect(() => {
    void loadCatalogImport();
  }, [loadCatalogImport]);

  if (loadState === "loading") {
    return (
      <CatalogImportStatePanel
        testId="catalog-import-loading"
        title={t("catalogImport.title")}
        message={t("catalogImport.loading")}
        retryLabel={null}
        onRetry={null}
      />
    );
  }

  if (loadState === "not_found") {
    return (
      <CatalogImportStatePanel
        testId="catalog-import-not-found"
        title={t("catalogImport.unavailableTitle")}
        message={t("catalogImport.versionUnavailable")}
        retryLabel={t("common.retry")}
        onRetry={() => void loadCatalogImport()}
      />
    );
  }

  if (loadState === "error") {
    return (
      <CatalogImportStatePanel
        testId="catalog-import-error"
        title={t("catalogImport.errorTitle")}
        message={errorMessage === "" ? t("catalogImport.errorBody") : errorMessage}
        retryLabel={packageVersionId === null ? null : t("common.retry")}
        onRetry={packageVersionId === null ? null : () => void loadCatalogImport()}
      />
    );
  }

  if (catalogContext === null) {
    throw new Error("Catalog import context is missing after a successful load");
  }

  if (loadState === "signed_out" || session === null) {
    return <CatalogImportSignedOutScreen catalogContext={catalogContext} />;
  }

  return <CatalogImportAuthenticatedScreen catalogContext={catalogContext} />;
}
