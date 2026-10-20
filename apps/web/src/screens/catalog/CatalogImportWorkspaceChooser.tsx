import { useState, type ReactElement } from "react";
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
  onCreateWorkspace: (name: string) => void;
}>): ReactElement {
  const { workspaces, isSelectionBusy, onChooseWorkspace, onCreateWorkspace } = props;
  const [isCreateWorkspaceVisible, setIsCreateWorkspaceVisible] = useState<boolean>(false);
  const [workspaceName, setWorkspaceName] = useState<string>("");
  const { messages, t, formatCount } = useI18n();
  const orderedWorkspaces = [...workspaces].sort(compareCatalogWorkspaces);

  return (
    <section className="content-card invite-panel workspace-modal" data-testid="catalog-import-workspace-selector">
      <strong className="panel-subtitle">{t("catalogImport.workspaceTitle")}</strong>
      <div className="workspace-choice-list">
        {orderedWorkspaces.map((workspace, index) => {
          const isRecommended = index === 0;
          return (
            <button
              key={workspace.workspaceId}
              className={`workspace-choice-btn${isRecommended ? " catalog-import-workspace-option-recommended" : ""}`}
              type="button"
              disabled={isSelectionBusy}
              data-workspace-recommended={isRecommended ? "true" : "false"}
              data-testid="catalog-import-workspace-option"
              data-workspace-id={workspace.workspaceId}
              onClick={() => onChooseWorkspace(workspace.workspaceId)}
            >
              <span className="workspace-choice-name">{workspace.name}</span>
              <span className="workspace-choice-meta">
                {formatCount(workspace.cardCount, messages.common.countLabels.card)}
              </span>
            </button>
          );
        })}
      </div>
      {workspaces.length > 1 && !isCreateWorkspaceVisible ? (
        <button
          className="ghost-btn" type="button" disabled={isSelectionBusy}
          data-testid="catalog-import-show-create-workspace"
          onClick={() => setIsCreateWorkspaceVisible(true)}
        >
          {t("settingsCurrentWorkspace.createWorkspace")}
        </button>
      ) : null}
      {workspaces.length > 1 && isCreateWorkspaceVisible ? <form className="catalog-import-create" onSubmit={(event) => {
        event.preventDefault();
        if (workspaceName.trim() !== "" && !isSelectionBusy) onCreateWorkspace(workspaceName.trim());
      }}>
        <label className="invite-field" htmlFor="catalog-import-workspace-name">
          <span>{t("settingsCurrentWorkspace.newWorkspace")}</span>
          <input
            className="text-input" id="catalog-import-workspace-name" data-testid="catalog-import-workspace-name-input"
            value={workspaceName} disabled={isSelectionBusy} autoComplete="off" autoFocus
            placeholder={t("settingsCurrentWorkspace.workspaceNamePlaceholder")}
            onChange={(event) => setWorkspaceName(event.currentTarget.value)}
          />
        </label>
        <button className="ghost-btn" type="submit" disabled={isSelectionBusy || workspaceName.trim() === ""} data-testid="catalog-import-create-workspace">
          {t("catalogImport.createAndAdd")}
        </button>
      </form> : null}
      {isSelectionBusy ? (
        <p className="subtitle" aria-live="polite" data-testid="catalog-import-workspace-loading">
          {t("catalogImport.loading")}
        </p>
      ) : null}
    </section>
  );
}
