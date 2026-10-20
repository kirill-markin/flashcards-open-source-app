import {
  establishOnboardingDemoMetadata,
} from "../../../cards/onboardingDemo";
import { appendLegacyEffortTag, normalizeCardMetadata } from "../../../cards/shared";
import type { CardMetadata } from "../../../cards/types";
import type { DatabaseExecutor } from "../../../database";
import type { LegacyEffortLevel } from "../../../sync/contracts/legacyEffort";
import { insertSyncChange, type HotChangeWriteLock } from "../../../sync/replication/changes";
import { toIsoString } from "../../common";
import type { CatalogPackageInstallOnboardingEligibility, TimestampValue } from "../../types";
import type { NormalizedCatalogPackageInstallConfirmInput } from "./replay";

type OnboardingCardRow = Readonly<{
  card_id: string;
  front_text: string;
  back_text: string;
  card_type: string;
  metadata: CardMetadata;
  tags: ReadonlyArray<string>;
  effort_level: LegacyEffortLevel;
  deleted_at: TimestampValue | null;
}>;

export type CatalogInstallOnboardingState = Readonly<{
  eligibility: CatalogPackageInstallOnboardingEligibility;
  demoCardId: string | null;
}>;

export async function loadCatalogInstallOnboardingStateInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
): Promise<CatalogInstallOnboardingState> {
  // Tombstones prove prior content too; two rows already rule out an untouched onboarding shell.
  const result = await executor.query<OnboardingCardRow>(
    [
      "SELECT card_id, front_text, back_text, card_type, metadata, tags, effort_level, deleted_at",
      "FROM content.cards WHERE workspace_id = $1 ORDER BY card_id LIMIT 2",
    ].join(" "),
    [workspaceId],
  );
  const card = result.rows[0];
  if (result.rows.length > 1 || card !== undefined && card.deleted_at !== null) {
    return { eligibility: "ineligible", demoCardId: null };
  }
  if (card !== undefined) {
    const metadata = normalizeCardMetadata(card.metadata);
    const source = metadata.source;
    if (metadata.onboardingDemo === undefined
        || establishOnboardingDemoMetadata(metadata, {
          frontText: card.front_text,
          backText: card.back_text,
          cardType: card.card_type,
          tags: appendLegacyEffortTag(card.tags, card.effort_level),
        }).onboardingDemo?.wasEdited !== false
        || source !== null && (source.label !== null || source.author !== null || source.comment !== null
          || source.importedAt !== null || source.importId !== null)) {
      return { eligibility: "ineligible", demoCardId: null };
    }
  }

  const material = await executor.query<Readonly<{ has_other_content: boolean }>>(
    [
      "SELECT",
      "EXISTS (SELECT 1 FROM content.decks WHERE workspace_id = $1)",
      "OR EXISTS (SELECT 1 FROM content.review_events WHERE workspace_id = $1 AND ($2::uuid IS NULL OR card_id <> $2))",
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
      "AS has_other_content",
    ].join(" "),
    [workspaceId, card?.card_id ?? null],
  );
  const row = material.rows[0];
  if (row === undefined) throw new Error("Catalog onboarding content probe returned no row.");
  return row.has_other_content
    ? { eligibility: "ineligible", demoCardId: null }
    : { eligibility: card === undefined ? "empty" : "demo_only", demoCardId: card?.card_id ?? null };
}

export async function tombstoneCatalogOnboardingDemoInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
  hotChangeWriteLock: HotChangeWriteLock,
  demoCardId: string,
  input: NormalizedCatalogPackageInstallConfirmInput,
): Promise<void> {
  const operationId = `${input.operationIdPrefix}:onboarding-demo`;
  // This is onboarding disposal, not a person deleting authored content. Publish the ordinary
  // card tombstone without collecting a card_deleted authoring fact.
  const result = await executor.query<Readonly<{ client_updated_at: TimestampValue }>>(
    [
      "UPDATE content.cards",
      "SET (deleted_at, client_updated_at) = (SELECT tombstone_at, tombstone_at FROM (",
      "SELECT GREATEST($1::timestamptz, date_trunc('milliseconds', client_updated_at) + interval '1 millisecond') AS tombstone_at",
      ") AS tombstone), last_modified_by_replica_id = $2, last_operation_id = $3, updated_at = now()",
      "WHERE workspace_id = $4 AND card_id = $5 AND deleted_at IS NULL RETURNING client_updated_at",
    ].join(" "),
    [input.clientUpdatedAt, input.lastModifiedByReplicaId, operationId, workspaceId, demoCardId],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error("Confirmed onboarding demo disappeared during catalog import.");
  await insertSyncChange(
    executor, workspaceId, hotChangeWriteLock, "card", demoCardId, "upsert",
    input.lastModifiedByReplicaId, operationId, toIsoString(row.client_updated_at),
  );
}
