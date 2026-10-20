import { useEffect, useRef, useState, type ReactElement } from "react";
import { useAppData } from "../../appData";
import { useAppErrorDialog } from "../../appError/AppErrorContext";
import { useI18n } from "../../i18n";
import { CatalogImmediateStudy } from "./CatalogImmediateStudy";
import { readCatalogImmediateAttempt, type CatalogImmediateAttempt } from "./catalogImmediateAttempt";
import { CatalogImportStatePanel, type CatalogImportContext } from "./catalogImportShared";
import { useCatalogPackageInstallContext, type CatalogPackageInstallContextLoader } from "./useCatalogPackageInstallContext";

export function CatalogImportEntry(props: Readonly<{
  catalogContext: CatalogImportContext;
  renderManual: (loader: CatalogPackageInstallContextLoader) => ReactElement;
}>): ReactElement {
  const { catalogContext, renderManual } = props;
  const appData = useAppData();
  const { t } = useI18n();
  const { showTechnicalError } = useAppErrorDialog();
  const [retryRevision, setRetryRevision] = useState(0);
  const [forceManual, setForceManual] = useState(false);
  const [prepared, setPrepared] = useState<Readonly<{
    key: string;
    attempt: CatalogImmediateAttempt | null;
  }> | null>(null);
  const [failure, setFailure] = useState<Readonly<{ key: string; message: string }> | null>(null);
  const manualUserId = useRef<string | null>(null);
  const { session, activeWorkspace, cloudSettings, sessionLoadState, isSessionVerified } = appData;
  const identityKey = session !== null && activeWorkspace !== null && isSessionVerified
    && sessionLoadState === "ready" && cloudSettings?.linkedUserId === session.userId
    && cloudSettings.linkedWorkspaceId === activeWorkspace.workspaceId
    ? `${session.userId}:${activeWorkspace.workspaceId}:${cloudSettings.installationId}:${retryRevision}`
    : null;
  const loader = useCatalogPackageInstallContext(
    catalogContext.packageVersionId,
    isSessionVerified && (sessionLoadState === "ready" || sessionLoadState === "selecting_workspace")
      ? session?.userId ?? null : null,
  );

  useEffect(() => {
    if (identityKey === null || session === null) return;
    try {
      const attempt = readCatalogImmediateAttempt(session.userId, catalogContext.packageVersionId);
      setPrepared({ key: identityKey, attempt });
      setFailure(null);
    } catch (error) {
      showTechnicalError(error, {
        feature: "settings", operation: "catalog_import", userId: session.userId,
        workspaceId: activeWorkspace?.workspaceId ?? null,
        installationId: cloudSettings?.installationId ?? null,
        entityId: catalogContext.packageVersionId,
      });
      setFailure({ key: identityKey, message: t("catalogImport.errorBody") });
    }
  }, [activeWorkspace?.workspaceId, catalogContext.packageVersionId, cloudSettings?.installationId, identityKey, session?.userId, showTechnicalError, t]);

  // The existing flow owns credential recovery and explicit workspace selection.
  if (session !== null && (sessionLoadState === "selecting_workspace" || forceManual)) {
    manualUserId.current = session.userId;
  }
  // Preserve the manual component's selection while choosing a different workspace.
  if (session !== null && manualUserId.current === session.userId) return renderManual(loader);
  if (sessionLoadState !== "ready") return renderManual(loader);
  const preparationFailure = failure?.key === identityKey ? failure.message : null;
  if (preparationFailure !== null || loader.state.status === "error") {
    return <CatalogImportStatePanel
      testId="catalog-immediate-entry-error"
      title={t("catalogImport.errorTitle")}
      message={preparationFailure ?? t("catalogImport.errorBody")}
      guidance={null}
      retryLabel={t("common.retry")}
      onRetry={() => {
        setRetryRevision((revision) => revision + 1);
        loader.retry();
      }}
    />;
  }
  if (identityKey === null || prepared?.key !== identityKey || loader.state.status !== "ready") {
    return <CatalogImportStatePanel
      testId="catalog-immediate-entry-loading"
      title={t("catalogImport.title")}
      message={t("catalogImport.loading")}
      guidance={null}
      retryLabel={null}
      onRetry={null}
    />;
  }
  const workspaces = loader.state.context.workspaces;
  const onlyWorkspace = workspaces.length === 1 ? workspaces[0] : undefined;
  const savedAttempt = prepared.attempt;
  if (savedAttempt !== null && !workspaces.some((workspace) => workspace.workspaceId === savedAttempt.workspaceId)) {
    return <CatalogImportStatePanel
      testId="catalog-immediate-recovery-error"
      title={t("catalogImport.errorTitle")}
      message={t("catalogImport.workspaceUnavailable")}
      guidance={null}
      retryLabel={t("common.retry")}
      onRetry={loader.retry}
    />;
  }
  if (forceManual || onlyWorkspace === undefined
    || (savedAttempt === null && onlyWorkspace.onboardingEligibility === "ineligible")) {
    manualUserId.current = session?.userId ?? null;
    return renderManual(loader);
  }
  return <CatalogImmediateStudy
    catalogContext={catalogContext}
    workspaceId={savedAttempt?.workspaceId ?? onlyWorkspace.workspaceId}
    onNotEligible={() => {
      setForceManual(true);
      loader.retry();
    }}
  />;
}
