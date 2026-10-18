import { establishOnboardingDemoMetadata } from "../../cards/onboardingDemo";
import { applyUserDatabaseScopeInExecutor, type DatabaseExecutor } from "../../database";
import { loadSelectedWorkspaceIdInExecutor } from "../../workspaces/queries";
import { loadGuestCardsInExecutor, type GuestCardRecord } from "./cards";

export async function loadGuestDemoOnlyCardInExecutor(
  executor: DatabaseExecutor,
  guestUserId: string,
  guestWorkspaceId: string,
): Promise<GuestCardRecord | null> {
  // Include tombstones: previously authored content must keep the transfer decision explicit.
  const cards = await loadGuestCardsInExecutor(executor, guestUserId, guestWorkspaceId);
  const card = cards[0];
  if (cards.length !== 1 || card === undefined || card.deletedAt !== null
      || card.metadata.onboardingDemo === undefined
      || establishOnboardingDemoMetadata(card.metadata, card).onboardingDemo?.wasEdited !== false) {
    return null;
  }
  const source = card.metadata.source;
  if (source !== null && (source.label !== null || source.author !== null || source.comment !== null
      || source.importedAt !== null || source.importId !== null)) {
    return null;
  }

  const material = await executor.query<Readonly<{ has_other_content: boolean }>>(
    [
      "SELECT",
      "EXISTS (SELECT 1 FROM content.decks WHERE workspace_id = $1)",
      "OR EXISTS (SELECT 1 FROM content.review_events WHERE workspace_id = $1 AND card_id <> $2)",
      "OR EXISTS (SELECT 1 FROM content.media_assets WHERE workspace_id = $1)",
      "OR EXISTS (SELECT 1 FROM ai.chat_sessions AS sessions WHERE sessions.workspace_id = $1 AND (",
      "sessions.status <> 'idle' OR sessions.active_run_id IS NOT NULL OR sessions.active_run_heartbeat_at IS NOT NULL",
      "OR sessions.title IS NOT NULL OR sessions.archived_at IS NOT NULL OR sessions.main_content_invalidation_version <> 0",
      "OR EXISTS (SELECT 1 FROM ai.chat_items WHERE session_id = sessions.session_id)",
      "OR EXISTS (SELECT 1 FROM ai.chat_runs WHERE session_id = sessions.session_id)))",
      "OR EXISTS (SELECT 1 FROM ai.chat_files WHERE workspace_id = $1)",
      "OR EXISTS (SELECT 1 FROM content.media_upload_sessions WHERE workspace_id = $1)",
      "OR EXISTS (SELECT 1 FROM content.generated_media_promotion_jobs WHERE workspace_id = $1)",
      "OR EXISTS (SELECT 1 FROM catalog.package_versions WHERE source_workspace_id = $1)",
      "OR EXISTS (SELECT 1 FROM sync.catalog_package_install_idempotency WHERE workspace_id = $1)",
      "OR EXISTS (SELECT 1 FROM org.workspace_memberships WHERE user_id = $3 AND workspace_id <> $1)",
      "OR (SELECT count(*) FROM org.workspace_memberships WHERE workspace_id = $1) <> 1",
      "OR NOT EXISTS (SELECT 1 FROM org.workspace_memberships WHERE workspace_id = $1 AND user_id = $3 AND role = 'owner')",
      "AS has_other_content",
    ].join(" "),
    [guestWorkspaceId, card.cardId, guestUserId],
  );
  const row = material.rows[0];
  if (row === undefined) throw new Error("Guest demo-only content probe returned no row.");
  return row.has_other_content ? null : card;
}

export async function loadDemoOnlyDestinationWorkspaceIdInExecutor(
  executor: DatabaseExecutor,
  targetUserId: string,
): Promise<string | null> {
  await applyUserDatabaseScopeInExecutor(executor, { userId: targetUserId });
  const selected = await loadSelectedWorkspaceIdInExecutor(executor, targetUserId);
  const result = await executor.query<Readonly<{ workspace_id: string }>>(
    "SELECT workspace_id FROM org.visible_workspace_ids($1)",
    [selected],
  );
  const visible = result.rows.map((row) => row.workspace_id);
  return selected !== null && visible.includes(selected) ? selected : visible[0] ?? null;
}
