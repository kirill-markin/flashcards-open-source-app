import type { ReactElement } from "react";
import { ApiError } from "../../api";
import { useI18n } from "../../i18n";
import type {
  CatalogPublicSnapshotAuthor,
  CatalogPublicSnapshotPackage,
  CatalogPublicSnapshotPackageVersion,
} from "../../types";

export type CatalogImportContext = Readonly<{
  author: CatalogPublicSnapshotAuthor;
  catalogPackage: CatalogPublicSnapshotPackage;
  packageVersion: CatalogPublicSnapshotPackageVersion;
}>;

export function getCatalogImportErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isCatalogVersionUnavailableError(error: unknown): boolean {
  return error instanceof ApiError && (
    error.code === "CATALOG_PACKAGE_VERSION_NOT_FOUND"
    || error.code === "CATALOG_PACKAGE_VERSION_NOT_PUBLISHED"
    || error.code === "CATALOG_PACKAGE_VERSION_EMPTY"
  );
}

export function CatalogImportContextCard(props: Readonly<{
  catalogContext: CatalogImportContext;
  accountEmail: string | null;
}>): ReactElement {
  const { catalogContext, accountEmail } = props;
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
      {accountEmail === null ? null : (
        <p className="subtitle catalog-import-account-email" data-testid="catalog-import-account-email">
          {t("catalogImport.accountEmail", { email: accountEmail })}
        </p>
      )}
    </section>
  );
}

export function CatalogImportStatePanel(props: Readonly<{
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
