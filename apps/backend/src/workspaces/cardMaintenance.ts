import { createHash } from "node:crypto";
import {
  applyWorkspaceDatabaseScopeInExecutor,
  transactionWithUserScope,
  transactionWithUserScopeReadOnly,
  type DatabaseExecutor,
} from "../database";
import { listDecksInExecutor, loadActiveDeckInExecutor, type Deck } from "../decks";
import { HttpError } from "../shared/errors";
import { normalizeTagKey } from "../shared/tagKey";
import { lockWorkspaceSyncMetadataForHotChangesInExecutor } from "../sync/replication/changes";
import {
  lockWorkspaceAccessLifecycleInExecutor,
  lockWorkspaceMembershipLifecyclesInExecutor,
} from "./accessLocks";
import {
  ensureCardMaintenanceReplicaInExecutor,
  removeCardTagsInExecutor,
  resetCardProgressInExecutor,
} from "./cardMaintenanceWrites";
import { cardNeedsProgressResetSql, loadWorkspaceManagementRowInExecutor } from "./queries";
import { assertWorkspaceOwner, assertWorkspaceSoleMembership } from "./shared";

export type CardMaintenanceKind = "resetCard" | "resetDeck" | "resetTag" | "removeTag";

export type CardMaintenanceInput = Readonly<{
  kind: CardMaintenanceKind;
  target: string;
}>;

export type CardMaintenanceExecution = CardMaintenanceInput & Readonly<{
  confirmationText: string;
  previewFingerprint: string;
}>;

type CardMaintenanceResult = Readonly<{ affectedCardsCount: number }>;

export type CardMaintenancePreview = CardMaintenanceResult & Readonly<{
  targetName: string;
  confirmationText: string;
  previewFingerprint: string;
  includesAllCards: boolean;
  affectedDecksCount: number;
}>;

type CardIdRow = Readonly<{ card_id: string }>;

type TaggedCardRow = CardIdRow & Readonly<{
  tags: ReadonlyArray<string>;
  needs_reset: boolean;
}>;

type TagRemovalRow = CardIdRow & Readonly<{ removed_tags: ReadonlyArray<string> }>;

type MaintenanceScope = Readonly<{
  targetName: string;
  includesAllCards: boolean;
  decks: ReadonlyArray<Deck>;
}> & (
  | Readonly<{ kind: "reset"; cards: ReadonlyArray<CardIdRow> }>
  | Readonly<{ kind: "removeTag"; cards: ReadonlyArray<TagRemovalRow> }>
);

const confirmationTexts: Readonly<Record<CardMaintenanceKind, string>> = {
  resetCard: "reset progress for this card",
  resetDeck: "reset progress for this deck",
  resetTag: "reset progress for cards with this tag",
  removeTag: "remove this tag from all matching cards",
};

async function applyCardMaintenanceScopeInExecutor(
  executor: DatabaseExecutor,
  userId: string,
  workspaceId: string,
): Promise<void> {
  const workspace = await loadWorkspaceManagementRowInExecutor(executor, userId, workspaceId);
  assertWorkspaceOwner(workspace.role);
  assertWorkspaceSoleMembership(
    workspace.member_count,
    "Card maintenance requires a workspace with a single member.",
    "CARD_MAINTENANCE_SHARED",
  );
  await applyWorkspaceDatabaseScopeInExecutor(executor, { userId, workspaceId });
}

async function loadMatchingTaggedCardsInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
  tags: ReadonlyArray<string>,
): Promise<ReadonlyArray<TaggedCardRow>> {
  // SQL lower() can both add and miss matches, so only narrow by active cards with stored tags.
  const result = await executor.query<TaggedCardRow>(
    [
      `SELECT card_id, tags, ${cardNeedsProgressResetSql} AS needs_reset`,
      "FROM content.cards WHERE workspace_id = $1 AND deleted_at IS NULL AND cardinality(tags) > 0",
      "ORDER BY card_id",
    ].join(" "),
    [workspaceId],
  );
  const keys = new Set(tags.map(normalizeTagKey));
  return result.rows.filter((card) => card.tags.some((tag) => keys.has(normalizeTagKey(tag))));
}

async function resolveTagRemovalInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
  target: string,
  cards: ReadonlyArray<TaggedCardRow>,
): Promise<MaintenanceScope> {
  const key = normalizeTagKey(target);
  const decks = await listDecksInExecutor(executor, workspaceId);
  return {
    kind: "removeTag",
    targetName: target,
    includesAllCards: false,
    cards: cards.map((card) => ({
      card_id: card.card_id,
      removed_tags: [...new Set(card.tags.filter((tag) => normalizeTagKey(tag) === key))].sort(),
    })),
    decks: decks.filter((deck) => deck.filterDefinition.tags.some((tag) => normalizeTagKey(tag) === key)),
  };
}

async function resolveMaintenanceScopeInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
  input: CardMaintenanceInput,
): Promise<MaintenanceScope | null> {
  if (input.kind === "resetCard") {
    const result = await executor.query<CardIdRow & Readonly<{ front_text: string; needs_reset: boolean }>>(
      [
        `SELECT card_id, front_text, ${cardNeedsProgressResetSql} AS needs_reset`,
        "FROM content.cards WHERE workspace_id = $1 AND card_id = $2 AND deleted_at IS NULL",
      ].join(" "),
      [workspaceId, input.target],
    );
    const card = result.rows[0];
    return card === undefined ? null : {
      kind: "reset",
      targetName: card.front_text,
      includesAllCards: false,
      cards: card.needs_reset ? [card] : [],
      decks: [],
    };
  }

  if (input.kind === "resetDeck") {
    const deck = await loadActiveDeckInExecutor(executor, workspaceId, input.target);
    if (deck === null) {
      return null;
    }
    const tags = deck.filterDefinition.tags;
    const includesAllCards = tags.length === 0;
    const cards = includesAllCards
      ? (await executor.query<CardIdRow>(
        [
          "SELECT card_id FROM content.cards WHERE workspace_id = $1 AND deleted_at IS NULL AND",
          cardNeedsProgressResetSql,
          "ORDER BY card_id",
        ].join(" "),
        [workspaceId],
      )).rows
      : (await loadMatchingTaggedCardsInExecutor(executor, workspaceId, tags)).filter((card) => card.needs_reset);

    return {
      kind: "reset",
      targetName: deck.name,
      includesAllCards,
      cards,
      decks: [deck],
    };
  }

  const cards = await loadMatchingTaggedCardsInExecutor(executor, workspaceId, [input.target]);
  if (cards.length === 0) {
    return null;
  }
  if (input.kind === "removeTag") {
    return resolveTagRemovalInExecutor(executor, workspaceId, input.target, cards);
  }
  return {
    kind: "reset",
    targetName: input.target,
    includesAllCards: false,
    cards: cards.filter((card) => card.needs_reset),
    decks: [],
  };
}

function fingerprint(
  userId: string,
  workspaceId: string,
  input: CardMaintenanceInput,
  scope: MaintenanceScope,
): string {
  const deckRules = scope.decks.map(
    (deck) => [deck.deckId, [...deck.filterDefinition.tags].sort()] as const,
  ).sort(([left], [right]) => left.localeCompare(right));

  return createHash("sha256").update(JSON.stringify([
    userId, workspaceId, input.kind, input.target, scope.targetName, scope.includesAllCards,
    scope.cards.map((card) => card.card_id),
    deckRules,
    scope.kind === "removeTag" ? scope.cards.map((card) => card.removed_tags) : null,
  ])).digest("hex");
}

export async function previewCardMaintenanceForUser(
  userId: string,
  workspaceId: string,
  input: CardMaintenanceInput,
): Promise<CardMaintenancePreview> {
  return transactionWithUserScopeReadOnly({ userId }, async (executor) => {
    await applyCardMaintenanceScopeInExecutor(executor, userId, workspaceId);
    const scope = await resolveMaintenanceScopeInExecutor(executor, workspaceId, input);
    if (scope === null) {
      const message = input.kind === "resetTag" || input.kind === "removeTag" ? "Tag not found" : "Card or deck not found";
      throw new HttpError(404, message, "CARD_MAINTENANCE_TARGET_NOT_FOUND");
    }

    return {
      targetName: scope.targetName,
      affectedCardsCount: scope.cards.length,
      confirmationText: confirmationTexts[input.kind],
      previewFingerprint: fingerprint(userId, workspaceId, input, scope),
      includesAllCards: scope.includesAllCards,
      affectedDecksCount: scope.kind === "removeTag" ? scope.decks.length : 0,
    };
  });
}

export async function executeCardMaintenanceForUser(
  userId: string,
  workspaceId: string,
  input: CardMaintenanceExecution,
): Promise<CardMaintenanceResult> {
  const expectedText = confirmationTexts[input.kind];
  if (input.confirmationText !== expectedText) {
    throw new HttpError(400, `Type "${expectedText}" exactly to confirm card maintenance.`, "CARD_MAINTENANCE_CONFIRMATION_INVALID");
  }

  return transactionWithUserScope({ userId }, async (executor) => {
    await lockWorkspaceMembershipLifecyclesInExecutor(executor, [workspaceId]);
    await lockWorkspaceAccessLifecycleInExecutor(executor, userId, workspaceId);
    await applyCardMaintenanceScopeInExecutor(executor, userId, workspaceId);

    // Card and deck writers take this lock before touching rows, including inserts into the scope.
    const lock = await lockWorkspaceSyncMetadataForHotChangesInExecutor(executor, workspaceId);
    const scope = await resolveMaintenanceScopeInExecutor(executor, workspaceId, input);
    if (scope === null || fingerprint(userId, workspaceId, input, scope) !== input.previewFingerprint) {
      throw new HttpError(
        409,
        "Card maintenance preview changed. Load the preview again and confirm the current scope.",
        "CARD_MAINTENANCE_PREVIEW_CHANGED",
      );
    }
    if (scope.cards.length === 0) {
      return { affectedCardsCount: 0 };
    }

    // The access lock already serializes registration of the maintenance actor.
    const actorKey = scope.kind === "removeTag" ? "remove-tag" : "reset-progress";
    const replicaId = await ensureCardMaintenanceReplicaInExecutor(executor, userId, workspaceId, actorKey);
    if (scope.kind === "removeTag") {
      for (const card of scope.cards) {
        await removeCardTagsInExecutor(executor, workspaceId, lock, replicaId, card.card_id, card.removed_tags);
      }
    } else {
      for (const card of scope.cards) {
        await resetCardProgressInExecutor(executor, workspaceId, lock, replicaId, card.card_id);
      }
    }
    return { affectedCardsCount: scope.cards.length };
  });
}
