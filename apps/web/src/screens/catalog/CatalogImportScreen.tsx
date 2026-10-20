import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { useParams } from "react-router";
import {
  reportCatalogInstallFailure,
  toCatalogInstallFailureReason,
} from "../../analytics";
import {
  isAuthRedirectError,
  loadPublicCatalogPackageVersion,
} from "../../api";
import {
  markIndexedDbOpenRecoveryFailureAndCheckActive,
  useAppErrorDialog,
} from "../../appError/AppErrorContext";
import { useI18n } from "../../i18n";
import { CatalogImportAuthenticatedFlow } from "./CatalogImportAuthenticatedFlow";
import {
  CatalogImportStatePanel,
  getCatalogImportErrorMessage,
  isCatalogPublicVersionNotFoundError,
  type CatalogImportContext,
} from "./catalogImportShared";

type CatalogImportLoadState = "loading" | "error" | "not_found" | "ready";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parsePackageVersionId(value: string | undefined): string | null {
  if (value === undefined || uuidPattern.test(value) === false) {
    return null;
  }

  return value.toLowerCase();
}

export function CatalogImportScreen(): ReactElement {
  const { packageVersionId: routePackageVersionId } = useParams();
  const packageVersionId = parsePackageVersionId(routePackageVersionId);
  const { indexedDbOpenRecoveryState, showTechnicalError } = useAppErrorDialog();
  const { t } = useI18n();
  const [loadState, setLoadState] = useState<CatalogImportLoadState>("loading");
  const [catalogContext, setCatalogContext] = useState<CatalogImportContext | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const loadRequestGenerationRef = useRef<number>(0);
  const technicalErrorMessage = t("appError.technicalError.message");

  const loadCatalogImport = useCallback(async function loadCatalogImport(): Promise<void> {
    if (indexedDbOpenRecoveryState.hasFailed()) {
      return;
    }

    const requestGeneration = loadRequestGenerationRef.current + 1;
    loadRequestGenerationRef.current = requestGeneration;
    if (packageVersionId === null) {
      setLoadState("error");
      setErrorMessage(t("catalogImport.invalidVersion"));
      return;
    }

    setLoadState("loading");
    setCatalogContext(null);
    setErrorMessage("");
    try {
      indexedDbOpenRecoveryState.throwIfFailed();
      const packageVersion = await loadPublicCatalogPackageVersion(packageVersionId);
      indexedDbOpenRecoveryState.throwIfFailed();
      if (loadRequestGenerationRef.current !== requestGeneration) {
        return;
      }

      setCatalogContext({
        packageVersionId: packageVersion.packageVersionId,
        packageSlug: packageVersion.slug,
        title: packageVersion.title,
        cardCount: packageVersion.cardCount,
        authorDisplayName: packageVersion.author.displayName,
      });
      setLoadState("ready");
    } catch (error) {
      const indexedDbRecoveryFailed = markIndexedDbOpenRecoveryFailureAndCheckActive(
        indexedDbOpenRecoveryState,
        error,
      );
      if (loadRequestGenerationRef.current !== requestGeneration) {
        return;
      }
      reportCatalogInstallFailure(
        packageVersionId,
        "landing",
        isCatalogPublicVersionNotFoundError(error)
          ? "package_unavailable"
          : toCatalogInstallFailureReason(error),
      );
      if (indexedDbRecoveryFailed) {
        return;
      }
      if (isAuthRedirectError(error)) {
        return;
      }
      if (isCatalogPublicVersionNotFoundError(error)) {
        setLoadState("not_found");
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
      setErrorMessage(wasCaptured ? technicalErrorMessage : getCatalogImportErrorMessage(error));
      setLoadState("error");
    }
  }, [
    indexedDbOpenRecoveryState,
    packageVersionId,
    showTechnicalError,
    t,
    technicalErrorMessage,
  ]);

  useEffect(() => {
    void loadCatalogImport();
  }, [loadCatalogImport]);

  if (loadState === "loading") {
    return (
      <CatalogImportStatePanel
        testId="catalog-import-loading"
        title={t("catalogImport.title")}
        message={t("catalogImport.loading")}
        guidance={null}
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
        guidance={null}
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
        guidance={null}
        retryLabel={packageVersionId === null ? null : t("common.retry")}
        onRetry={packageVersionId === null ? null : () => void loadCatalogImport()}
      />
    );
  }

  if (catalogContext === null) {
    throw new Error("Catalog import context is missing after a successful load");
  }

  return <CatalogImportAuthenticatedFlow catalogContext={catalogContext} />;
}
