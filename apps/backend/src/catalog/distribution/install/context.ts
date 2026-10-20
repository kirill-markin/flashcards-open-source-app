import {
  applyWorkspaceDatabaseScopeInExecutor,
  transactionWithUserScopeReadOnly,
  type DatabaseExecutor,
} from "../../../database";
import { loadActiveCardCountInExecutor } from "../../../workspaces/queries";
import { toIsoString, toOptionalIsoString, toSafeNumber } from "../../common";
import type {
  CatalogPackageInstallContext,
  CatalogPackageInstallPreviousInstall,
  CatalogPackageInstallWorkspaceContext,
  TimestampValue,
} from "../../types";
import { loadCatalogInstallOnboardingStateInExecutor } from "./onboarding";
import { loadCatalogPackageInstallVersionInExecutor } from "./preview";

type WorkspaceRow = Readonly<{
  workspace_id: string;
  name: string;
  created_at: TimestampValue;
}>;

type PreviousInstallRow = Readonly<{
  install_id: string;
  package_version_id: string;
  title: string;
  retained_card_count: string | number;
}>;

async function loadPreviousCatalogInstallInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
  packageId: string,
): Promise<CatalogPackageInstallPreviousInstall | null> {
  const result = await executor.query<PreviousInstallRow>(
    [
      "SELECT installs.install_id, installs.package_version_id,",
      "installs.install_result->'packageVersion'->>'title' AS title, retained.retained_card_count",
      "FROM sync.catalog_package_install_idempotency AS installs",
      "CROSS JOIN LATERAL (SELECT COUNT(*) AS retained_card_count FROM content.cards AS cards",
      "WHERE cards.workspace_id = installs.workspace_id AND cards.deleted_at IS NULL",
      "AND cards.metadata->'source'->>'importId' = installs.install_id) AS retained",
      "WHERE installs.workspace_id = $1",
      "AND installs.install_result->'packageVersion'->>'packageId' = $2",
      "AND installs.install_result->'packageVersion'->>'packageVersionId' = installs.package_version_id::text",
      "AND retained.retained_card_count > 0",
      "ORDER BY installs.completed_at DESC, installs.install_id ASC LIMIT 1",
    ].join(" "),
    [workspaceId, packageId],
  );
  const row = result.rows[0];
  return row === undefined ? null : {
    installId: row.install_id,
    packageVersionId: row.package_version_id,
    title: row.title,
    retainedCardCount: toSafeNumber(row.retained_card_count, "retained_card_count"),
  };
}

export async function loadCatalogPackageInstallContextInExecutor(
  executor: DatabaseExecutor,
  userId: string,
  selectedWorkspaceId: string | null,
  packageVersionId: string,
): Promise<CatalogPackageInstallContext> {
  const version = await loadCatalogPackageInstallVersionInExecutor(executor, packageVersionId);
  const result = await executor.query<WorkspaceRow>(
    [
      "SELECT workspaces.workspace_id, workspaces.name, workspaces.created_at",
      "FROM org.workspace_memberships AS memberships",
      "INNER JOIN org.workspaces AS workspaces ON workspaces.workspace_id = memberships.workspace_id",
      "WHERE memberships.user_id = $1",
      "AND workspaces.workspace_id IN (SELECT workspace_id FROM org.visible_workspace_ids($2))",
      "ORDER BY workspaces.created_at ASC, workspaces.workspace_id ASC",
    ].join(" "),
    [userId, selectedWorkspaceId],
  );
  const workspaces: Array<CatalogPackageInstallWorkspaceContext> = [];
  // Content RLS requires each workspace scope; the surrounding read transaction keeps one snapshot.
  for (const workspace of result.rows) {
    await applyWorkspaceDatabaseScopeInExecutor(executor, { userId, workspaceId: workspace.workspace_id });
    const cardCount = await loadActiveCardCountInExecutor(executor, workspace.workspace_id);
    const reviews = await executor.query<Readonly<{ last_reviewed_at: TimestampValue | null }>>(
      "SELECT MAX(reviewed_at_client) AS last_reviewed_at FROM content.review_events WHERE workspace_id = $1",
      [workspace.workspace_id],
    );
    const review = reviews.rows[0];
    if (review === undefined) throw new Error("Catalog workspace review recency query returned no row.");
    const onboarding = await loadCatalogInstallOnboardingStateInExecutor(executor, workspace.workspace_id);
    const previousInstall = await loadPreviousCatalogInstallInExecutor(executor, workspace.workspace_id, version.package_id);
    workspaces.push({
      workspaceId: workspace.workspace_id,
      name: workspace.name,
      createdAt: toIsoString(workspace.created_at),
      isSelected: workspace.workspace_id === selectedWorkspaceId,
      cardCount,
      lastReviewedAt: toOptionalIsoString(review.last_reviewed_at),
      onboardingEligibility: onboarding.eligibility,
      previousInstall,
    });
  }
  workspaces.sort((left, right) => (right.lastReviewedAt ?? "").localeCompare(left.lastReviewedAt ?? "")
    || left.createdAt.localeCompare(right.createdAt) || left.workspaceId.localeCompare(right.workspaceId));
  return { workspaces };
}

export async function loadCatalogPackageInstallContext(
  userId: string,
  selectedWorkspaceId: string | null,
  packageVersionId: string,
): Promise<CatalogPackageInstallContext> {
  return transactionWithUserScopeReadOnly({ userId }, async (executor) => (
    loadCatalogPackageInstallContextInExecutor(executor, userId, selectedWorkspaceId, packageVersionId)
  ));
}
