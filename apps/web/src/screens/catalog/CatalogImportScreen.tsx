import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { useParams } from "react-router";
import {
  buildLoginUrl,
  getOptionalSession,
  isAuthRedirectError,
  loadPublicCatalog,
} from "../../api";
import {
  markIndexedDbOpenRecoveryFailureAndCheckActive,
  useAppErrorDialog,
} from "../../appError/AppErrorContext";
import { useI18n } from "../../i18n";
import type { CatalogPublicSnapshot, SessionInfo } from "../../types";
import { CatalogImportAuthenticatedFlow } from "./CatalogImportAuthenticatedFlow";
import {
  CatalogImportContextCard,
  CatalogImportStatePanel,
  getCatalogImportErrorMessage,
  type CatalogImportContext,
} from "./catalogImportShared";

type CatalogImportLoadState = "loading" | "error" | "not_found" | "signed_out" | "signed_in";

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

function CatalogImportSignedOutScreen(props: Readonly<{ catalogContext: CatalogImportContext }>): ReactElement {
  const { catalogContext } = props;
  const { locale, t } = useI18n();

  return (
    <main className="invite-page" data-testid="catalog-import-signed-out">
      <CatalogImportContextCard catalogContext={catalogContext} accountEmail={null} />
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

export function CatalogImportScreen(): ReactElement {
  const { packageVersionId: routePackageVersionId } = useParams();
  const packageVersionId = parsePackageVersionId(routePackageVersionId);
  const { indexedDbOpenRecoveryState, showTechnicalError } = useAppErrorDialog();
  const { t } = useI18n();
  const [loadState, setLoadState] = useState<CatalogImportLoadState>("loading");
  const [catalogContext, setCatalogContext] = useState<CatalogImportContext | null>(null);
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
    setCatalogContext(null);
    setSession(null);
    setErrorMessage("");
    try {
      indexedDbOpenRecoveryState.throwIfFailed();
      const snapshot = await loadPublicCatalog();
      indexedDbOpenRecoveryState.throwIfFailed();
      if (loadRequestGenerationRef.current !== requestGeneration) {
        return;
      }
      const nextCatalogContext = resolveCatalogImportContext(snapshot, packageVersionId);
      if (nextCatalogContext === null) {
        setLoadState("not_found");
        return;
      }

      const optionalSession = await getOptionalSession();
      indexedDbOpenRecoveryState.throwIfFailed();
      if (loadRequestGenerationRef.current !== requestGeneration) {
        return;
      }
      setCatalogContext(nextCatalogContext);
      setSession(optionalSession);
      setLoadState(optionalSession === null ? "signed_out" : "signed_in");
    } catch (error) {
      if (markIndexedDbOpenRecoveryFailureAndCheckActive(indexedDbOpenRecoveryState, error)) {
        return;
      }
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
      setErrorMessage(wasCaptured ? technicalErrorMessage : getCatalogImportErrorMessage(error));
      setLoadState("error");
    }
  }, [indexedDbOpenRecoveryState, packageVersionId, showTechnicalError, t, technicalErrorMessage]);

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

  return <CatalogImportAuthenticatedFlow catalogContext={catalogContext} />;
}
