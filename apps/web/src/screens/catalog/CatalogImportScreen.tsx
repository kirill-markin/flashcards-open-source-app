import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { useParams } from "react-router";
import {
  buildCatalogInstallAuthReturnUrl,
  reportCatalogInstallFailure,
  reportCatalogInstallLanded,
  reportCatalogInstallSigninStarted,
  toCatalogInstallFailureReason,
  useAnalyticsScreenView,
  useCatalogInstallJourneyId,
} from "../../analytics";
import {
  buildLoginUrl,
  getOptionalSession,
  isAuthRedirectError,
  loadPublicCatalogPackageVersion,
} from "../../api";
import {
  markIndexedDbOpenRecoveryFailureAndCheckActive,
  useAppErrorDialog,
} from "../../appError/AppErrorContext";
import { useI18n } from "../../i18n";
import type { SessionInfo } from "../../types";
import { CatalogImportAuthenticatedFlow } from "./CatalogImportAuthenticatedFlow";
import {
  CatalogImportContextCard,
  CatalogImportStatePanel,
  getCatalogImportErrorMessage,
  isCatalogPublicVersionNotFoundError,
  type CatalogImportContext,
} from "./catalogImportShared";

type CatalogImportLoadState = "loading" | "error" | "not_found" | "signed_out" | "signed_in";

type LoadedCatalogPackage = Readonly<{
  packageVersionId: string;
  title: string;
  cardCount: number;
  authorDisplayName: string;
}>;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parsePackageVersionId(value: string | undefined): string | null {
  if (value === undefined || uuidPattern.test(value) === false) {
    return null;
  }

  return value.toLowerCase();
}

function CatalogImportSignedOutScreen(props: Readonly<{ catalogContext: CatalogImportContext }>): ReactElement {
  const { catalogContext } = props;
  const { locale, t } = useI18n();
  // The gate is rendered only while it is the screen, so mounting it is the entry into it.
  useAnalyticsScreenView("catalog_import_signin");

  return (
    <main className="invite-page" data-testid="catalog-import-signed-out">
      <CatalogImportContextCard catalogContext={catalogContext} accountEmail={null} />
      <section className="content-card invite-panel">
        <h2 className="panel-subtitle">{t("catalogImport.signInTitle")}</h2>
        <p className="subtitle">{t("catalogImport.signInBody")}</p>
        <a
          className="primary-btn"
          href={buildLoginUrl(buildCatalogInstallAuthReturnUrl(catalogContext.installJourneyId), locale)}
          data-testid="catalog-import-sign-in"
          onClick={() => reportCatalogInstallSigninStarted(
            catalogContext.installJourneyId,
            catalogContext.packageVersionId,
          )}
        >
          {t("catalogImport.signInAction")}
        </a>
      </section>
    </main>
  );
}

export function CatalogImportScreen(): ReactElement {
  const { packageVersionId: routePackageVersionId } = useParams();
  const packageVersionId = parsePackageVersionId(routePackageVersionId);
  // The journey id arrives when the consent answer does, which is a network round trip of its own
  // and normally lands after this screen has already loaded. It is deliberately kept out of the load
  // below — through the ref — so settling it never re-runs the fetch this screen already completed.
  const installJourneyId = useCatalogInstallJourneyId(packageVersionId);
  const installJourneyIdRef = useRef<string | null>(installJourneyId);
  installJourneyIdRef.current = installJourneyId;
  const { indexedDbOpenRecoveryState, showTechnicalError } = useAppErrorDialog();
  const { t } = useI18n();
  const [loadState, setLoadState] = useState<CatalogImportLoadState>("loading");
  const [loadedPackage, setLoadedPackage] = useState<LoadedCatalogPackage | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [session, setSession] = useState<SessionInfo | null>(null);
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
    setLoadedPackage(null);
    setSession(null);
    setErrorMessage("");
    try {
      indexedDbOpenRecoveryState.throwIfFailed();
      const packageVersion = await loadPublicCatalogPackageVersion(packageVersionId);
      indexedDbOpenRecoveryState.throwIfFailed();
      if (loadRequestGenerationRef.current !== requestGeneration) {
        return;
      }

      const optionalSession = await getOptionalSession();
      indexedDbOpenRecoveryState.throwIfFailed();
      if (loadRequestGenerationRef.current !== requestGeneration) {
        return;
      }
      setLoadedPackage({
        packageVersionId: packageVersion.packageVersionId,
        title: packageVersion.title,
        cardCount: packageVersion.cardCount,
        authorDisplayName: packageVersion.author.displayName,
      });
      setSession(optionalSession);
      setLoadState(optionalSession === null ? "signed_out" : "signed_in");
    } catch (error) {
      const indexedDbRecoveryFailed = markIndexedDbOpenRecoveryFailureAndCheckActive(
        indexedDbOpenRecoveryState,
        error,
      );
      if (loadRequestGenerationRef.current !== requestGeneration) {
        return;
      }
      reportCatalogInstallFailure(
        installJourneyIdRef.current,
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

  const catalogContext = useMemo<CatalogImportContext | null>(
    () => loadedPackage === null ? null : { ...loadedPackage, installJourneyId },
    [installJourneyId, loadedPackage],
  );

  // Reported from here rather than from the load, because the journey id can settle after it. The
  // landing event is deduplicated by journey, package and name, so a re-run once the id arrives
  // emits exactly one row — and a load that finished before the answer no longer loses the landing.
  useEffect(() => {
    if (catalogContext === null || (loadState !== "signed_in" && loadState !== "signed_out")) {
      return;
    }

    reportCatalogInstallLanded(installJourneyId, catalogContext.packageVersionId, loadState);
  }, [catalogContext, installJourneyId, loadState]);

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

  if (loadState === "signed_out" || session === null) {
    return <CatalogImportSignedOutScreen catalogContext={catalogContext} />;
  }

  return <CatalogImportAuthenticatedFlow catalogContext={catalogContext} />;
}
