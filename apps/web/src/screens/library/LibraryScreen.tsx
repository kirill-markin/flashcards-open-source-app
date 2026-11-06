import { useEffect, useRef, useState, type ReactElement } from "react";
import { useAppData } from "../../appData";
import {
  markIndexedDbOpenRecoveryFailureAndCheckActive,
  useAppErrorDialog,
} from "../../appError/AppErrorContext";
import { useI18n } from "../../i18n";
import { loadAllActiveDecksForSql } from "../../localDb/cards/decks";
import { loadWorkspaceTagsSummary } from "../../localDb/cards/workspace";
import { captureAppOperationError } from "../../observability/appOperationObservation";
import { getPublicSiteCatalogUrl } from "../../publicSiteUrl";
import {
  cardsRoute,
  libraryDecksRoute,
  libraryExportRoute,
  libraryImportRoute,
  libraryTagsRoute,
} from "../../routes";
import { useWorkspacePath } from "../../useWorkspacePath";
import { SettingsExternalLinkCard, SettingsGroup, SettingsNavigationCard, SettingsShell } from "../settings/SettingsShared";

type LibraryCounts = Readonly<{
  cards: number;
  tags: number;
  decks: number;
}>;

async function loadLibraryCounts(workspaceId: string): Promise<LibraryCounts> {
  const [tagsSummary, decks] = await Promise.all([
    loadWorkspaceTagsSummary(workspaceId),
    loadAllActiveDecksForSql(workspaceId),
  ]);

  return {
    cards: tagsSummary.totalCards,
    tags: tagsSummary.tags.length,
    decks: decks.length,
  };
}

/** The rows render at once and every count fills in when the local database answers. */
export function LibraryScreen(): ReactElement {
  const { activeWorkspace, cloudSettings, localReadVersion, session } = useAppData();
  const { indexedDbOpenRecoveryState, showCapturedTechnicalError } = useAppErrorDialog();
  const { t, formatNumber, locale } = useI18n();
  const workspacePath = useWorkspacePath();
  const [counts, setCounts] = useState<LibraryCounts | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const observationIdentityRef = useRef<Readonly<{
    userId: string | null;
    installationId: string | null;
  }>>({
    userId: null,
    installationId: null,
  });
  const technicalErrorMessage = t("appError.technicalError.message");
  observationIdentityRef.current = {
    userId: session?.userId ?? null,
    installationId: cloudSettings?.installationId ?? null,
  };

  useEffect(() => {
    let isCancelled = false;

    async function loadCounts(): Promise<void> {
      if (indexedDbOpenRecoveryState.hasFailed()) {
        return;
      }

      setErrorMessage("");

      try {
        if (activeWorkspace === null) {
          throw new Error("Workspace is unavailable");
        }

        const nextCounts = await loadLibraryCounts(activeWorkspace.workspaceId);
        indexedDbOpenRecoveryState.throwIfFailed();
        if (isCancelled) {
          return;
        }

        setCounts(nextCounts);
      } catch (error) {
        if (markIndexedDbOpenRecoveryFailureAndCheckActive(indexedDbOpenRecoveryState, error)) {
          return;
        }
        if (isCancelled) {
          return;
        }

        if (activeWorkspace !== null) {
          const observationIdentity = observationIdentityRef.current;
          const wasCaptured = captureAppOperationError(error, {
            feature: "cards",
            operation: "library_counts_load",
            userId: observationIdentity.userId,
            workspaceId: activeWorkspace.workspaceId,
            installationId: observationIdentity.installationId,
            entityId: null,
          });
          if (wasCaptured) {
            showCapturedTechnicalError(error);
            setErrorMessage(technicalErrorMessage);
            return;
          }
        }
        setErrorMessage(error instanceof Error ? error.message : String(error));
      }
    }

    void loadCounts();

    return () => {
      isCancelled = true;
    };
  }, [activeWorkspace, indexedDbOpenRecoveryState, localReadVersion]);

  function formatCountValue(count: number | undefined): string | null {
    return count === undefined ? null : formatNumber(count);
  }

  return (
    <SettingsShell
      title={t("libraryScreen.title")}
      subtitle={null}
      activeTab="workspace"
    >
      {errorMessage === "" ? null : <p className="error-banner" role="alert">{errorMessage}</p>}

      <SettingsGroup title={t("libraryScreen.groups.yourCards")}>
        <div className="settings-nav-list">
          <SettingsNavigationCard
            title={t("navigation.cards")}
            description={t("libraryScreen.cards.description")}
            value={formatCountValue(counts?.cards)}
            to={workspacePath(cardsRoute)}
            testId="library-row-cards"
          />
          <SettingsNavigationCard
            title={t("settingsWorkspace.tags.title")}
            description={t("libraryScreen.tags.description")}
            value={formatCountValue(counts?.tags)}
            to={workspacePath(libraryTagsRoute)}
            testId="library-row-tags"
          />
          <SettingsNavigationCard
            title={t("settingsWorkspace.decks.title")}
            description={t("libraryScreen.decks.description")}
            value={formatCountValue(counts?.decks)}
            to={workspacePath(libraryDecksRoute)}
            testId="library-row-decks"
          />
        </div>
      </SettingsGroup>

      <SettingsGroup title={t("libraryScreen.groups.addCards")}>
        <div className="settings-nav-list">
          <SettingsExternalLinkCard
            title={t("libraryScreen.deckCatalog.title")}
            description={t("libraryScreen.deckCatalog.description")}
            href={getPublicSiteCatalogUrl(locale)}
            testId="library-row-deck-catalog"
            opensInNewTab={false}
          />
          <SettingsNavigationCard
            title={t("settingsWorkspace.import.title")}
            description={t("libraryScreen.import.description")}
            value={null}
            to={workspacePath(libraryImportRoute)}
            testId="library-row-import"
          />
        </div>
      </SettingsGroup>

      <SettingsGroup>
        <div className="settings-nav-list">
          <SettingsNavigationCard
            title={t("settingsWorkspace.export.title")}
            description={t("libraryScreen.export.description")}
            value={null}
            to={workspacePath(libraryExportRoute)}
            testId="library-row-export"
          />
        </div>
      </SettingsGroup>
    </SettingsShell>
  );
}
