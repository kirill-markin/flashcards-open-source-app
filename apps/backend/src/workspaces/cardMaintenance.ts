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
  resetCardsProgressInExecutor,
} from "./cardMaintenanceWrites";
import {
  assertUserHasWorkspaceMembershipInExecutor,
  cardNeedsProgressResetSql,
  loadWorkspaceManagementRowInExecutor,
} from "./queries";
import { assertWorkspaceOwner, assertWorkspaceSoleMembership } from "./shared";

export type CardMaintenanceKind = "resetCard" | "resetDeck" | "resetTag" | "removeTag";

export type CardMaintenanceInput = Readonly<{
  kind: CardMaintenanceKind;
  target: string;
}>;

type CardMaintenancePreviewFingerprint = Readonly<{
  value: string;
  expiresAtMs: number;
}>;

type CardMaintenanceExecution = CardMaintenanceInput & Readonly<{
  confirmationText: string;
  previewFingerprint: CardMaintenancePreviewFingerprint;
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
  | Readonly<{ kind: "reset"; cards: ReadonlyArray<CardIdRow>; newCardIds: ReadonlyArray<string> | null }>
  | Readonly<{ kind: "removeTag"; cards: ReadonlyArray<TagRemovalRow> }>
);

const previewLifetimeMs = 120_000;

const confirmationTexts: Readonly<Record<CardMaintenanceKind, string>> = {
  resetCard: "reset progress for this card",
  resetDeck: "reset progress for this deck",
  resetTag: "reset progress for cards with this tag",
  removeTag: "remove this tag from all matching cards",
};

export function parseCardMaintenancePreviewFingerprint(value: unknown): CardMaintenancePreviewFingerprint {
  if (typeof value === "string") {
    const match = /^([1-9][0-9]{0,15})\.[0-9a-f]{64}$/.exec(value);
    const expiresAtMs = Number(match?.[1]);
    if (match?.[0] === value && Number.isSafeInteger(expiresAtMs)) {
      return { value, expiresAtMs };
    }
  }
  throw new HttpError(400, "previewFingerprint must be the value returned by preview", "CARD_MAINTENANCE_INPUT_INVALID");
}

async function loadDatabaseTimeMsInExecutor(executor: DatabaseExecutor): Promise<number> {
  const result = await executor.query<Readonly<{ time_ms: number }>>(
    "SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::double precision AS time_ms",
    [],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error("Could not read the database clock for card maintenance");
  }
  return row.time_ms;
}

function previewChangedError(): HttpError {
  return new HttpError(
    409,
    "Card maintenance preview changed. Load the preview again and confirm the current scope.",
    "CARD_MAINTENANCE_PREVIEW_CHANGED",
  );
}

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
      newCardIds: [],
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
    const matchingCards = includesAllCards ? null : await loadMatchingTaggedCardsInExecutor(executor, workspaceId, tags);
    const cards = matchingCards === null
      ? (await executor.query<CardIdRow>(
        [
          "SELECT card_id FROM content.cards WHERE workspace_id = $1 AND deleted_at IS NULL AND",
          cardNeedsProgressResetSql,
          "ORDER BY card_id",
        ].join(" "),
        [workspaceId],
      )).rows
      : matchingCards.filter((card) => card.needs_reset);

    return {
      kind: "reset",
      targetName: deck.name,
      includesAllCards,
      cards,
      newCardIds: matchingCards === null ? null : matchingCards.filter((card) => !card.needs_reset).map((card) => card.card_id),
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
    newCardIds: cards.filter((card) => !card.needs_reset).map((card) => card.card_id),
    decks: [],
  };
}

export function buildCardMaintenancePreviewFingerprint(
  userId: string,
  workspaceId: string,
  input: CardMaintenanceInput,
  scope: MaintenanceScope,
  expiresAtMs: number,
): string {
  const deckRules = scope.decks.map(
    (deck) => [deck.deckId, [...deck.filterDefinition.tags].sort()] as const,
  ).sort(([left], [right]) => left.localeCompare(right));

  const hash = createHash("sha256").update(JSON.stringify([
    expiresAtMs, userId, workspaceId, input.kind, input.target, scope.targetName, scope.includesAllCards,
    scope.cards.map((card) => card.card_id),
    deckRules,
    scope.kind === "removeTag" ? scope.cards.map((card) => card.removed_tags) : null,
  ])).digest("hex");
  return `${expiresAtMs}.${hash}`;
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

    const expiresAtMs = await loadDatabaseTimeMsInExecutor(executor) + previewLifetimeMs;
    return {
      targetName: scope.targetName,
      affectedCardsCount: scope.cards.length,
      confirmationText: confirmationTexts[input.kind],
      previewFingerprint: buildCardMaintenancePreviewFingerprint(userId, workspaceId, input, scope, expiresAtMs),
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
    const { value, expiresAtMs } = input.previewFingerprint;
    if (await loadDatabaseTimeMsInExecutor(executor) >= expiresAtMs) {
      throw previewChangedError();
    }

    const scope = await resolveMaintenanceScopeInExecutor(executor, workspaceId, input);
    if (scope === null || buildCardMaintenancePreviewFingerprint(userId, workspaceId, input, scope, expiresAtMs) !== value) {
      throw previewChangedError();
    }
    if (scope.cards.length === 0) {
      return { affectedCardsCount: 0 };
    }

    // The access lock already serializes registration of the maintenance actor.
    const actorKey = scope.kind === "removeTag" ? "remove-tag" : "reset-progress";
    const replicaId = await ensureCardMaintenanceReplicaInExecutor(executor, userId, workspaceId, actorKey);
    if (scope.kind === "removeTag") {
      for (const card of scope.cards) {
        await removeCardTagsInExecutor(
          executor, workspaceId, lock, replicaId, card.card_id, card.removed_tags, normalizeTagKey(input.target),
        );
      }
    } else {
      await resetCardsProgressInExecutor(executor, lock, replicaId, scope.cards, scope.newCardIds);
    }
    return { affectedCardsCount: scope.cards.length };
  });
}

export async function reconcileCardMaintenanceForUser(
  userId: string,
  workspaceId: string,
  previewFingerprint: CardMaintenancePreviewFingerprint,
): Promise<Readonly<{ isSettled: boolean }>> {
  return transactionWithUserScope({ userId }, async (executor) => {
    // An execute admitted before expiry holds this lock through commit or rollback.
    await lockWorkspaceAccessLifecycleInExecutor(executor, userId, workspaceId);
    await assertUserHasWorkspaceMembershipInExecutor(executor, userId, workspaceId);
    return { isSettled: await loadDatabaseTimeMsInExecutor(executor) >= previewFingerprint.expiresAtMs };
  });
}
