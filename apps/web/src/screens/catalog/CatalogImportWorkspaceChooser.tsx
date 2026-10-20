import type { ReactElement } from "react";
import { useAppData } from "../../appData";
import { useI18n } from "../../i18n";
import type { CatalogPackageInstallWorkspaceContext } from "../../types/catalog";

function compareCatalogWorkspaces(
  left: CatalogPackageInstallWorkspaceContext,
  right: CatalogPackageInstallWorkspaceContext,
): number {
  if (left.lastReviewedAt !== null && right.lastReviewedAt === null) {
    return -1;
  }
  if (left.lastReviewedAt === null && right.lastReviewedAt !== null) {
    return 1;
  }
  const activityOrder = left.lastReviewedAt !== null && right.lastReviewedAt !== null
    ? Date.parse(right.lastReviewedAt) - Date.parse(left.lastReviewedAt)
    : right.cardCount - left.cardCount;
  return activityOrder
    || Date.parse(left.createdAt) - Date.parse(right.createdAt)
    || left.workspaceId.localeCompare(right.workspaceId);
}

export function CatalogImportWorkspaceChooser(props: Readonly<{
  workspaces: ReadonlyArray<CatalogPackageInstallWorkspaceContext>;
  isSelectionBusy: boolean;
  onChooseWorkspace: (workspaceId: string) => void;
}>): ReactElement {
  const { workspaces, isSelectionBusy, onChooseWorkspace } = props;
  const { activeWorkspace, availableWorkspaces, isChoosingWorkspace } = useAppData();
  const { messages, t, formatCount, formatDateTime } = useI18n();
  const visibleWorkspaceIds = new Set(availableWorkspaces
    .filter((workspace) => workspace.isVisible !== false)
    .map((workspace) => workspace.workspaceId));
  const orderedWorkspaces = workspaces
    .filter((workspace) => visibleWorkspaceIds.has(workspace.workspaceId))
    .sort(compareCatalogWorkspaces);

  return (
    <section className="content-card invite-panel workspace-modal" data-testid="catalog-import-workspace-selector">
      <strong className="panel-subtitle">{t("catalogImport.workspaceTitle")}</strong>
      <p className="subtitle">{t("catalogImport.workspaceDescription")}</p>
      <div className="workspace-choice-list">
        {orderedWorkspaces.map((workspace) => {
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
              <span className="workspace-choice-meta">
                {formatCount(workspace.cardCount, messages.common.countLabels.card)}
                {" · "}
                <time dateTime={workspace.createdAt}>{formatDateTime(workspace.createdAt)}</time>
              </span>
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
