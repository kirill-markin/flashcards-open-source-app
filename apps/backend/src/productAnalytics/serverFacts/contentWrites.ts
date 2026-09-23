import {
  transactionWithWorkspaceScope,
  type DatabaseExecutor,
  type WorkspaceDatabaseScope,
} from "../../database";
import { getDatabaseErrorFields } from "../../database/transient";
import {
  unsafeRunDatabaseOperationsWithIndependentDeadline,
  unsafeTransaction,
} from "../../database/unsafe";
// Report through `observability/runtime`, never through `observability/sentry`. Deck writes reach
// this module from `decks/index.ts`, which the direct image ingestion Lambda pulls in through
// `guestAuth/store/decks.ts`, and that bundle deliberately excludes the Sentry SDK -
// `entrypoints/directImageIngestion/lambda.test.ts` asserts its import graph reaches no
// `observability/sentry/capture`, `config` or `tracing` module. Both halves of this module are
// reachable from there, the drain included, so the runtime indirection is what keeps that true
// rather than any split. It costs the handlers that do initialize Sentry nothing:
// `initializeBackendSentry` installs `captureBackendWarning` as the runtime sink, so the warning
// below is the same Sentry warning there and the same structured CloudWatch record in the lean
// handler.
import {
  addBackendRuntimeBreadcrumb,
  captureBackendRuntimeWarning,
  createBackendObservationScope,
} from "../../observability/runtime";
import type { WorkspaceReplicaActorKind } from "../../sync/identity/replica";
import type {
  ProductAnalyticsEventName,
  ProductAnalyticsPlatform,
  productAnalyticsEventCatalog,
} from "../catalog";
import { productAnalyticsMaxEventAgeMs } from "../validation";
import {
  createPostCommitAnalyticsBudget,
  type PostCommitAnalyticsBudget,
} from "./postCommitBudget";
import {
  collectPostCommitFact,
  createPostCommitFactBuffer,
  emitPostCommitFactEvents,
  runTransactionWithPostCommitDrain,
  takePostCommitFacts,
  type CommittedTransaction,
  type PostCommitFactEmissionAbortedOutcome,
} from "./postCommitFactLifecycle";
import {
  toWorkspaceReplicaAttribution,
  type WorkspaceReplicaAttribution,
  type WorkspaceReplicaPlatformFacts,
  type WorkspaceReplicaPlatformRow,
} from "./replicaPlatforms";
import {
  deriveServerDerivedProductAnalyticsEventId,
  type ServerDerivedProductAnalyticsEvent,
} from "./serverEvents";

// db/migrations/0120 and 0121 cite this module as `contentCreations.ts`, which is what it was
// called while it reported creations alone. Migration comments are immutable, so the pointer is
// kept here rather than corrected there.
export type ContentWriteEntityType = "card" | "deck";

// What a write did to the row, which is what separates the facts this producer reports.
//
// "updated" is deliberately not "the row was written again". The overwhelming majority of writes
// that reach content.cards are reviews rescheduling a card, a workspace progress reset putting a
// whole library back to new, or background media settlement with no person acting at all, so a
// single "content was written" event would have counted review volume under an authoring name.
//
// What "updated" means here is one authoring edit: a write that left the entity alive and left at
// least one authored field different from the value the server held before it. Authored fields are
// a card's front text, back text and tags, and a deck's name and the tags its filter selects, and
// nothing else. Everything else these two tables carry is scheduling state, provenance metadata,
// sync bookkeeping or the tombstone, and a write that moves only those reports nothing.
// ../catalog.ts states that boundary for readers of the table, which is where it has to be
// legible.
type ContentWriteAction = "created" | "updated" | "deleted";

/**
 * One card or deck a product transaction brought into existence, authored an edit to, or
 * tombstoned.
 */
export type ContentWrite = Readonly<{
  entityType: ContentWriteEntityType;
  // The row's own id, always a canonical UUID because it is read back from a uuid column.
  entityId: string;
  workspaceId: string;
  // content.cards.last_modified_by_replica_id or content.decks.last_modified_by_replica_id as the
  // write stored it, which is the replica that made this change rather than the last one to touch
  // the row before it. It is carried as the id rather than as a platform because the replica row
  // lives in another table: resolving it is one lookup for a whole drain instead of one per row on
  // the content write. See resolveContentWriteReplicaAttributions.
  replicaId: string;
  // sync.hot_changes.client_updated_at for the write, as an ISO string.
  clientUpdatedAt: string;
}>;

// An authoring edit carries the writing operation's own id beside the entity id, because unlike a
// creation and a first tombstone an entity can be edited any number of times, so the entity alone
// cannot key it. The other two actions deliberately keep their entity-only key: see
// toContentWriteEvent.
type CollectedContentWrite =
  | (ContentWrite & Readonly<{ action: "created" | "deleted" }>)
  | (ContentWrite & Readonly<{ action: "updated"; operationId: string }>);

const contentWriteEventNames: Readonly<
  Record<ContentWriteEntityType, Readonly<Record<ContentWriteAction, ProductAnalyticsEventName>>>
> = {
  card: { created: "card_created", updated: "card_updated", deleted: "card_deleted" },
  deck: { created: "deck_created", updated: "deck_updated", deleted: "deck_deleted" },
};

// Reporting inline would hold sync.workspace_sync_metadata's write lock across a second database
// transaction per write, and that analytics transaction could not roll back with the product
// write. The shared lifecycle keeps the facts on this executor until its transaction commits.
//
// All three actions share one buffer, so a transaction that creates, edits and deletes - the agent
// SQL batch mutation can do all three - drains once, resolves its replicas with one read and spends
// the post-commit budget once for everything it wrote.
const collectedContentWrites = createPostCommitFactBuffer<CollectedContentWrite>();

/**
 * Records that this transaction created one card or deck, to be reported once it commits.
 *
 * Callers must only reach this from a branch that genuinely inserted the row. Both snapshot upserts
 * insert with `ON CONFLICT DO NOTHING ... RETURNING`, so a returned row is a real insert and the
 * conflict branches below it continue as updates of a row that already existed; the direct create
 * paths insert unconditionally on a freshly minted id. The LWW-lost branches return early with
 * `applied: false` and write no hot change at all, so they never get here.
 *
 * The writes only reach analytics through a transaction opened by one of the wrappers below.
 */
export function collectContentCreation(
  executor: DatabaseExecutor,
  write: ContentWrite,
): void {
  collectPostCommitFact(collectedContentWrites, executor, { ...write, action: "created" });
}

/**
 * Records that this transaction made one authoring edit to a card or deck, to be reported once it
 * commits.
 *
 * Callers must only reach this from a branch that compared the authored fields the write found
 * against the authored fields it left, on a row the write left alive. Four rules hold at every call
 * site and all four exist to keep this from counting something that is not authoring:
 *
 *  - Only the authored fields count. A card's front text, back text and tags, a deck's name and
 *    the tags its filter selects. Scheduling state, provenance metadata, `card_type`, `created_at`
 *    and the sync bookkeeping columns are not authored, so a review, a progress reset and a re-sync
 *    report nothing whenever the write leaves the authored fields holding what the row already
 *    held. For a progress reset that is certain rather than ordinary: it is a server-side UPDATE
 *    of scheduling columns (../../workspaces/management.ts) that reaches no branch here at all.
 *    Do not read the other two as a guarantee, though. A review and a re-sync each arrive as a
 *    whole snapshot carrying authored text as well, frozen into the client's outbox when the write
 *    was queued, and a snapshot whose text is stale reverts the stored text, which is a change and
 *    is collected here. That needs no server-side writer: the usual source of the newer text is
 *    another of the person's own devices. ../catalog.ts discloses that over-count to readers of
 *    the table, which is where it has to be legible.
 *  - The comparison is against the row the server actually held, never against the request body. A
 *    client pushing a full snapshot re-sends every field on every write, so "the request named this
 *    field" says nothing at all about whether anything changed.
 *  - A write that tombstones a live row reports its deletion and no edit, even if it also carried
 *    different text. The write's meaning is the deletion, and collectContentDeletion covers it.
 *  - A write to a row that is already tombstoned reports nothing, because editing a tombstone is
 *    not authoring. A write that brings a tombstoned row back alive with different authored text
 *    does report an edit: the row is live again and carries text a person wrote.
 *
 * Nothing that writes card or deck text as a side effect may call this. Backend managed-image
 * append and settlement rewrite a card's own text with no person acting, through a statement of
 * their own (../../cards/managedMedia/managedImageSettlement.ts) that reaches no branch here. A
 * person attaching media in a client does reach one, because there the reference is written into
 * the card's text locally and pushed as an edit of it; `media_attached` is that person's own
 * client event for the same action.
 *
 * `operationId` must be the writing operation's own `last_operation_id`, because the event id is
 * derived from it beside the entity id. On the sync push that is the client's own queued operation
 * id, so a replayed push of one edit derives the same event id and the writer drops it. The agent
 * surfaces mint a fresh id per call instead (../../aiTools/agentSql/operations.ts and
 * ../../aiTools/agentSql/batchMutation.ts), so a repeated agent call derives a different event id
 * and is stopped by the comparison rather than by the key: the first call already stored the text
 * the second one sends, so the second finds nothing changed and collects nothing.
 */
export function collectContentAuthoringUpdate(
  executor: DatabaseExecutor,
  write: ContentWrite & Readonly<{ operationId: string }>,
): void {
  collectPostCommitFact(collectedContentWrites, executor, { ...write, action: "updated" });
}

/**
 * Records that this transaction tombstoned one card or deck, to be reported once it commits.
 *
 * Callers must only reach this from a branch whose own write left a row tombstoned that was not
 * tombstoned before it - the live-to-tombstone update, and the snapshot insert that stores a row
 * already carrying deleted_at because it was created and deleted before its first sync. A
 * tombstone written over one the server already held reports nothing: a client re-syncing a
 * library it already deleted from would otherwise count every deletion again on an append-only
 * table.
 *
 * Nothing that removes content as a side effect may call this. A workspace or account deletion
 * drops the workspace row and takes its cards and decks with it without ever reaching a per-entity
 * path, and those two decisions report their own events instead.
 */
export function collectContentDeletion(
  executor: DatabaseExecutor,
  write: ContentWrite,
): void {
  collectPostCommitFact(collectedContentWrites, executor, { ...write, action: "deleted" });
}

// The channel a creation came through, as card_created.source spells it.
type ContentCreationSource =
  (typeof productAnalyticsEventCatalog)["card_created"]["properties"]["source"]["values"][number];

// The channel the replica's own actor kind names, read from that column and never from platform,
// exactly as ./reviewAnswers.ts reads it for review_answered.source and with the same vocabulary, so
// a creation and an answer that came through one channel join by equality. workspace_seed and
// workspace_reset are no channel a person authors through, so they map to null and the row omits
// `source`, as it does for an actor kind this table does not know: a guess could never be corrected
// on an append-only table. Keyed by every WorkspaceReplicaActorKind, so a new actor kind does not
// compile until it is answered here.
const contentCreationSourceByActorKind = {
  client_installation: "app",
  ai_chat: "ai_chat",
  agent_connection: "agent",
  workspace_seed: null,
  workspace_reset: null,
} as const satisfies Readonly<Record<WorkspaceReplicaActorKind, ContentCreationSource | null>>;

function toActorKindContentCreationSource(actorKind: string): ContentCreationSource | null {
  return Object.hasOwn(contentCreationSourceByActorKind, actorKind)
    ? contentCreationSourceByActorKind[actorKind as WorkspaceReplicaActorKind]
    : null;
}

// The channel this transaction says every creation it collects came through, keyed by the executor
// running it and dropped with it, like the replica facts above.
//
// It exists because the actor kind cannot answer for every channel. A workspace-package import
// writes through the person's own client installation replica, so the replica says `app` and is not
// wrong about the device - but the cards came out of a file rather than out of authoring, and only
// the transaction doing the import knows that. A transaction that declares nothing keeps the actor
// kind's answer.
const declaredContentCreationSources = new WeakMap<DatabaseExecutor, ContentCreationSource>();

/**
 * Names the channel every creation of this transaction came through.
 *
 * Only a transaction whose writes are all one channel may declare one, because the declaration
 * covers the whole executor rather than a single write.
 */
export function declareContentCreationSource(
  executor: DatabaseExecutor,
  source: ContentCreationSource,
): void {
  declaredContentCreationSources.set(executor, source);
}

// Everything one replica decides for the writes attributed to it. It is the shared attribution
// plus the creation channel, because both are read off the same replica row and neither may be
// derived without the actor kind beside it.
type ContentWriteReplicaAttribution = WorkspaceReplicaAttribution & Readonly<{
  source: ContentCreationSource | null;
}>;

function toContentWriteReplicaAttribution(
  replica: WorkspaceReplicaPlatformFacts,
): ContentWriteReplicaAttribution {
  return {
    ...toWorkspaceReplicaAttribution(replica),
    source: toActorKindContentCreationSource(replica.actorKind),
  };
}

// What a replica this transaction writes through decides for its writes, keyed by the executor
// running it and with the same lifetime as the writes above: created on first use, dropped with
// the executor.
//
// A caller that ensured a replica already holds everything the derivation needs, so what it names
// here is exactly what the drain would otherwise read sync.workspace_replicas back for. A null
// platform is an answer like any other - "this replica justifies no platform" - and saves that read
// just as much as a device does.
const declaredReplicaAttributions = new WeakMap<
  DatabaseExecutor,
  Map<string, ContentWriteReplicaAttribution>
>();

/**
 * Names what one replica decides for its writes, from the facts the caller ensured it with.
 *
 * Callers must pass the actor kind and platform the stored row really carries, which is what
 * ensuring the replica guarantees: the upsert refuses a replica whose row disagrees with either. The
 * derivation is the drain's own, so a platform named here and one read back later cannot differ.
 *
 * The automation marker holds the same way, and nothing here reads it back: a declared replica is
 * never resolved, so what a caller names must already be the stored marker. The caller reads it
 * from sync.claim_installation, which returns it from the row it just locked, and folds this
 * request's own declaration into it before naming it (../../sync/identity/replica.ts). A client that
 * declares automation once therefore reports nothing for any write afterwards, including on the
 * requests it declares nothing on - naming this request's body here instead would silently un-mark
 * the installation for exactly those.
 *
 * Declaring is optional everywhere. Writes naming a replica nothing declared are resolved by the
 * drain instead, which is the only route left to a caller that was handed a replica id and no facts
 * at all - a workspace-package import, or a tool write whose replica was ensured in an earlier
 * transaction.
 */
export function declareContentWriteReplicaFacts(
  executor: DatabaseExecutor,
  replicaId: string,
  replica: WorkspaceReplicaPlatformFacts,
): void {
  const attribution = toContentWriteReplicaAttribution(replica);
  const declared = declaredReplicaAttributions.get(executor);
  if (declared === undefined) {
    declaredReplicaAttributions.set(
      executor,
      new Map<string, ContentWriteReplicaAttribution>([[replicaId, attribution]]),
    );
    return;
  }

  declared.set(replicaId, attribution);
}

/**
 * The moment the person made the change, corrected for the device clock that reported it.
 *
 * client_updated_at is a client timestamp with no constraint of any kind behind it, and an
 * offline-first write can legitimately be days older than the sync that carried it, so the value is
 * kept only where it is plausible: within the same 30-day window the live client ingest accepts, and
 * never after the server clock. Outside that window the server clock is used instead, which loses
 * the offline interval but keeps a broken device clock from parking events on an arbitrary day
 * forever on an append-only table.
 */
function resolveContentWriteOccurredAt(clientUpdatedAt: string, recordedAt: Date): Date {
  const clientUpdatedAtMs = new Date(clientUpdatedAt).getTime();
  if (Number.isNaN(clientUpdatedAtMs)) {
    return recordedAt;
  }

  if (clientUpdatedAtMs > recordedAt.getTime()) {
    return recordedAt;
  }

  if (clientUpdatedAtMs < recordedAt.getTime() - productAnalyticsMaxEventAgeMs) {
    return recordedAt;
  }

  return new Date(clientUpdatedAtMs);
}

// The most one drain may spend resolving the replicas nothing declared, including the product
// connection it checks out to do it. It matches ./reviewAnswers.ts because the read, the table and
// the budget gating it are the same, and that file derives the figure.
const contentWritePlatformResolutionTimeoutMs = 2_000;

/**
 * Resolves the replicas of one drain to the platform each of their rows was created on.
 *
 * What the transaction declared as it wrote is taken as it stands, and only the replicas it did not
 * name are read back. A drain that named all of them opens no transaction and spends none of the
 * post-commit budget, which is the common case by volume: the sync push, the sync bootstrap push and
 * the guest upgrade merge all ensure every replica they write through on the transaction's own
 * executor.
 *
 * What is left is one query for the whole drain, after the product transaction committed, which is
 * what makes it affordable: the writes were collected per transaction, so the content write
 * itself pays nothing and a 5,000-card import resolves through one indexed lookup rather than one
 * query per card.
 *
 * The read is scoped with the drain's own actor and the workspace of the writes it is resolving,
 * which is the scope those writes ran under and the only one the RLS policy on
 * sync.workspace_replicas admits (workspace_replicas_scoped_select_runtime, stated in full in
 * ./reviewAnswers.ts). Every path that reaches this producer writes into one workspace as one
 * identity, the guest upgrade included: the merge recreates the guest's replicas under the target
 * user and workspace and stores those ids on the rows it re-inserts, so the account the drain reports
 * as the actor is also the account that owns the replicas behind them.
 *
 * Best effort, and it must be: the cards and decks are committed and this producer may not reject
 * into a caller whose transaction is already closed. A read that fails, a budget that is already
 * spent, a replica the scoped read does not reach - each leaves its writes out of a per-platform
 * breakdown rather than guessing at a platform the append-only table could never be corrected of.
 */
async function resolveContentWriteReplicaAttributions(
  writes: ReadonlyArray<ContentWrite>,
  declaredAttributionByReplicaId: ReadonlyMap<string, ContentWriteReplicaAttribution>,
  actorUserId: string,
  budget: PostCommitAnalyticsBudget,
): Promise<ReadonlyMap<string, ContentWriteReplicaAttribution>> {
  const undeclaredWrites = writes.filter(
    (write) => !declaredAttributionByReplicaId.has(write.replicaId),
  );
  const scopingWrite = undeclaredWrites[0];
  if (scopingWrite === undefined) {
    return declaredAttributionByReplicaId;
  }

  // The budget is checked here for the same reason a chunk checks it: this runs after COMMIT on the
  // request's own clock. A drain that finds it spent resolves nothing and the loop below then stops
  // on the same check, so the request pays for neither. A drain with nothing left to read returned
  // above without reaching this, so it neither starts that clock nor spends it.
  if (!budget.hasTimeForAnotherOperation()) {
    return declaredAttributionByReplicaId;
  }

  const replicaIds = [...new Set(undeclaredWrites.map((write) => write.replicaId))];
  const attributionByReplicaId = new Map(declaredAttributionByReplicaId);
  const resolutionScope = createBackendObservationScope(
    "backend-api",
    null,
    null,
    null,
    actorUserId,
    scopingWrite.workspaceId,
    null,
    null,
    null,
    null,
    null,
  );
  try {
    // Its own clock, and deliberately not the request's:
    // unsafeRunDatabaseOperationsWithIndependentDeadline replaces any ambient database deadline for
    // the length of this read instead of narrowing to it, and transactionWithWorkspaceScope reads
    // that deadline back out of the ambient store, so the read is bounded by it end to end. The
    // agent SQL surface runs its whole execution under such a deadline
    // (../../aiTools/agentSql/databaseTimeBudget.ts) and this read is not part of that execution:
    // the cards are committed, nothing is waiting on the answer, and inheriting a nearly spent
    // budget would not shorten the read but cancel it before its first statement - storing every
    // card the machine API just created with no platform at all, permanently, on an append-only
    // table, at the one surface where `agent` is a value only this read can produce.
    const replicas = await unsafeRunDatabaseOperationsWithIndependentDeadline(
      Date.now() + contentWritePlatformResolutionTimeoutMs,
      async () => transactionWithWorkspaceScope(
        { userId: actorUserId, workspaceId: scopingWrite.workspaceId },
        async (executor) => {
          const result = await executor.query<WorkspaceReplicaPlatformRow>(
            [
              // The automation marker lives on the installation rather than on the replica, so it is
              // joined rather than selected: sync.installations is the row the client declared it on
              // and the only place it is ever stored. A replica with no installation behind it - every
              // actor kind but client_installation - joins to no row and is no automation.
              "SELECT replicas.replica_id, replicas.actor_kind, replicas.platform,",
              "COALESCE(installations.is_automation, FALSE) AS is_automation",
              "FROM sync.workspace_replicas AS replicas",
              "LEFT JOIN sync.installations AS installations",
              "ON installations.installation_id = replicas.installation_id",
              "WHERE replicas.replica_id = ANY($1::uuid[])",
            ].join(" "),
            [replicaIds],
          );
          return result.rows;
        },
      ),
    );
    if (replicas.length < replicaIds.length) {
      // The read succeeded without matching every replica it asked about, so nothing throws and the
      // writes behind the missing rows go on to be stored with a null platform. replicaIds is
      // deduplicated and replica_id is the primary key of sync.workspace_replicas, so the read can
      // only come back short, never long, and the shortfall is exactly what is reported here. Both
      // content.cards.last_modified_by_replica_id and content.decks.last_modified_by_replica_id
      // reference that table (db/migrations/0037_workspace_delete_schema_cleanup.sql), so a missing
      // row is never a deleted replica - it is a row this scoped read no longer reaches, which
      // ./reviewAnswers.ts states in full for the same read.
      captureBackendRuntimeWarning({
        action: "product_analytics_content_write_platform_resolution_incomplete",
        scope: resolutionScope,
        details: {
          replicaIdCount: replicaIds.length,
          matchedReplicaCount: replicas.length,
          writeCount: undeclaredWrites.length,
        },
      });
    }
    for (const replica of replicas) {
      attributionByReplicaId.set(replica.replica_id, toContentWriteReplicaAttribution({
        actorKind: replica.actor_kind,
        platform: replica.platform,
        isAutomation: replica.is_automation,
      }));
    }
  } catch (error) {
    // Reported rather than swallowed. The events themselves are unaffected and still worth storing,
    // so nothing here stops the drain - but a resolution that fails for every drain is otherwise
    // invisible, because the rows keep arriving and only the platform quietly stops being on them.
    const errorDetails = getDatabaseErrorFields(error);
    captureBackendRuntimeWarning({
      action: "product_analytics_content_write_platform_resolution_failed",
      scope: resolutionScope,
      details: {
        replicaIdCount: replicaIds.length,
        writeCount: undeclaredWrites.length,
        sqlState: errorDetails.sqlState,
        errorClass: errorDetails.errorClass,
        errorMessage: errorDetails.errorMessage,
      },
    });
  }

  return attributionByReplicaId;
}

function toContentWriteEvent(
  write: CollectedContentWrite,
  actorUserId: string,
  recordedAt: Date,
  platform: ProductAnalyticsPlatform | null,
  source: ContentCreationSource | null,
): ServerDerivedProductAnalyticsEvent {
  const eventName = contentWriteEventNames[write.entityType][write.action];
  return {
    // A creation and a deletion are keyed on the row id alone, under an event name that already
    // separates them. There is only ever one creation and one first tombstone per row, so any path
    // that reaches this producer again for the same row - a replayed sync push, a guest merge, a
    // re-sent delete - derives the same id and conflicts on event_id in the writer instead of
    // counting a second fact. Only a path that preserves the row id dedupes this way: the
    // workspace-package import mints a fresh card id per card, so a re-import is genuinely new
    // cards and correctly counts new creations.
    //
    // An authoring edit cannot use that key and does not: an entity can be edited any number of
    // times, and an entity-keyed edit would count "entities ever edited" rather than edits. It is
    // keyed on the row id and the writing operation's id together, so one row here is one write
    // that changed what a person authored. A replayed sync push carries the client's own queued
    // operation id again, derives the same event id and conflicts in the writer; a repeated agent
    // call mints a new operation id and would not, which is why the collection points compare the
    // stored row rather than the request - the repeat finds the text it sends already stored and
    // collects nothing. Two genuine edits made inside one millisecond are two operations and stay
    // two rows, which a timestamp key would have collapsed.
    eventId: deriveServerDerivedProductAnalyticsEventId(
      eventName,
      write.action === "updated" ? [write.entityId, write.operationId] : [write.entityId],
    ),
    eventName,
    occurredAt: resolveContentWriteOccurredAt(write.clientUpdatedAt, recordedAt),
    // The server clock, read once in Node after the product transaction committed and shared by
    // every event of one drain. It is deliberately not the same instant as
    // sync.hot_changes.recorded_at for the same write: that column defaults to now(), which in
    // Postgres is the transaction's start timestamp, so every hot change a 5,000-card import wrote
    // carries one instant while these rows carry a later one, ahead of it by the whole transaction.
    // What stays recoverable from this row is the client skew, as the difference against occurred_at.
    serverReceivedAt: recordedAt,
    // The identity the transaction wrote as, named by the caller that opened it rather than looked
    // up here.
    //
    // It is written into both identity columns. For a guest that is exactly what a guest-transport
    // ingest request stores, and it is what lets a guest's content follow the account afterwards:
    // analytics.product_events_resolved reads the guest upgrade link through subject_user_id, so
    // without it every card written before signing up would stay stranded on the guest identity. For
    // an account the two columns differ only when a Cognito subject was merged, where an ingest row
    // keeps the pre-merge subject here and this row keeps the authoritative id instead. That cannot
    // change how either row resolves: the only link keyed on subject_user_id is a guest upgrade, and
    // no account's authoritative id is ever a merged-away guest user id.
    userId: actorUserId,
    subjectUserId: actorUserId,
    // The guest session behind the write is an auth-layer value this path never sees; the caller
    // names the acting user and nothing else. A guest's rows are still identifiable as one actor
    // through subject_user_id above, so what is lost here is the guest/account split on the row
    // itself, not the attribution.
    guestSessionId: null,
    workspaceId: write.workspaceId,
    // The platform of the replica that wrote the row: named by the transaction that ensured that
    // replica itself, and otherwise read back from sync.workspace_replicas once for the whole drain.
    // See resolveContentWriteReplicaAttributions.
    //
    // The platform column may never be read without the actor kind beside it, and the two actor kinds
    // that reach this producer with no device behind them are why: the machine API writes cards
    // through an agent_connection replica storing 'web' while being no browser, and the AI chat
    // through an ai_chat replica whose hardcoded 'web' describes no device either.
    // toWorkspaceReplicaPlatform is what keeps that rule, so the machine API resolves to agent from
    // its actor kind rather than from that column, and the AI chat resolves to nothing at all.
    //
    // Null stays the answer for everything the resolution cannot justify - a replica the guard turns
    // down, a replica the scoped read did not reach, a resolution the drain could not make - because
    // a guess would file the row under a platform it never had, permanently, on an append-only table,
    // while null only leaves it out of a per-platform breakdown.
    platform,
    // `source` goes on card creations and nowhere else, because that is the only place the catalog
    // declares it and a property the catalog does not declare makes the writer refuse the whole
    // batch. A deletion is left out because the channel a tombstone arrived over is a different
    // question from the channel a card was authored through, and `deck_created` because a deck is a
    // saved filter rather than something a channel writes for you.
    properties: write.entityType === "card" && write.action === "created" && source !== null
      ? { source }
      : {},
    // Provenance about how a row was produced belongs to the backfill that reconstructs history.
    // A write observed as it happens has none.
    details: null,
  };
}

/**
 * Names the writes the drain gave up on, so an aborted drain is legible rather than silent.
 *
 * The reason says which of the two stop rules fired, because they call for opposite responses:
 * "writer_refused" means the analytics writer turned a chunk down and is degraded or down, while
 * "budget_exhausted" means every chunk it answered was stored and the drain was simply larger than
 * one request's clock can carry. Only "writer_refused" has a paired
 * product_analytics_server_event_write_failed carrying the error, and only it can report a non-zero
 * failedEventCount.
 *
 * The skip guard only ever fires for a refusal: a budget stop is decided before an unreached chunk,
 * so it always has something to name. A refusal of the last chunk abandoned nothing, and the write
 * failure that chunk already raised is the whole story, so a transaction small enough to fit one
 * chunk - which is almost all of them - still produces exactly one warning for one refusal.
 */
function reportAbandonedContentWrites(
  abandoned: PostCommitFactEmissionAbortedOutcome & Readonly<{
    actorUserId: string;
    workspaceId: string | null;
  }>,
): void {
  if (abandoned.skippedEventCount <= 0) {
    return;
  }

  captureBackendRuntimeWarning({
    action: "product_analytics_content_write_drain_aborted",
    scope: createBackendObservationScope(
      "backend-api",
      null,
      null,
      null,
      abandoned.actorUserId,
      abandoned.workspaceId,
      null,
      null,
      null,
      null,
      null,
    ),
    details: {
      reason: abandoned.reason,
      storedEventCount: abandoned.storedEventCount,
      failedEventCount: abandoned.failedEventCount,
      skippedEventCount: abandoned.skippedEventCount,
    },
  });
}

/**
 * Keeps only the writes of replicas that may be reported at all.
 *
 * An installation that declared itself automation produces no product analytics, and a write it
 * wrote is dropped whole rather than stored with a null platform: the marker says the actor is not a
 * person, not that the device is unknown. A replica the resolution did not reach carries no marker
 * either way and is reported as it always was.
 *
 * That last case is emit-on-unknown and is deliberate. Once the declaration reflects storage, a
 * write reaches it only when the resolution read threw or the post-commit budget ran out, and
 * both are transient: dropping on an unknown marker would lose a real person's writes to a
 * failure that has nothing to do with them, while reporting one costs a marked installation a few
 * writes that the exclusion work removes downstream anyway. Do not "tighten" this to a drop.
 *
 * The drop is recorded rather than silent, so a run that produces nothing is legible as this rule
 * firing instead of as a producer that stopped working.
 */
function dropAutomationContentWrites(
  writes: ReadonlyArray<CollectedContentWrite>,
  attributionByReplicaId: ReadonlyMap<string, ContentWriteReplicaAttribution>,
  actorUserId: string,
): ReadonlyArray<CollectedContentWrite> {
  const reportable = writes.filter(
    (write) => attributionByReplicaId.get(write.replicaId)?.isAutomation !== true,
  );
  const suppressed = writes.length - reportable.length;
  if (suppressed === 0) {
    return reportable;
  }

  addBackendRuntimeBreadcrumb({
    action: "product_analytics_content_write_automation_suppressed",
    scope: createBackendObservationScope(
      "backend-api",
      null,
      null,
      null,
      actorUserId,
      writes[0]?.workspaceId ?? null,
      null,
      null,
      null,
      null,
      null,
    ),
    details: {
      factCount: writes.length,
      suppressedFactCount: suppressed,
    },
  });

  return reportable;
}

/**
 * Reports one committed transaction's writes after resolving all undeclared replica platforms.
 * Workspace-package imports, bootstrap pushes and guest merges can collect thousands of writes;
 * the shared lifecycle bounds and partitions their sequential writer work. The platform lookup is
 * released before emission starts, so a drain still holds at most one database connection at once.
 *
 * Bounding the drain is especially important for a 5,000-card import: allowing analytics timeouts
 * to push the response past API Gateway's limit could invite a retry after the product commit, and
 * that retry would mint new card ids and duplicate the imported library.
 */
async function emitCollectedContentWrites(
  executor: DatabaseExecutor,
  actorUserId: string,
  budget: PostCommitAnalyticsBudget,
): Promise<void> {
  const collected = takePostCommitFacts(collectedContentWrites, executor);
  if (collected === undefined) {
    return;
  }

  const declaredAttributionByReplicaId: ReadonlyMap<string, ContentWriteReplicaAttribution>
    = declaredReplicaAttributions.get(executor) ?? new Map<string, ContentWriteReplicaAttribution>();
  declaredReplicaAttributions.delete(executor);
  // A channel the transaction named for itself wins over the replica's actor kind, because it is
  // the more specific answer: the replica still says which device wrote, and the declaration says
  // what the writing was. Only the workspace-package import declares one today.
  const declaredSource = declaredContentCreationSources.get(executor) ?? null;
  declaredContentCreationSources.delete(executor);
  // The server timestamp every event of this drain carries. The drain's stop clock is no longer read
  // here: it belongs to the request rather than to this drain, so it is the budget's.
  const recordedAt = new Date();
  // What the transaction named as it wrote, plus at most one read of the product database for the
  // replicas it did not, before the first chunk and after the commit that released this transaction's
  // connection. Writes left unresolved keep the null platform they always had; nothing here can
  // fail the drain.
  const attributionByReplicaId = await resolveContentWriteReplicaAttributions(
    collected,
    declaredAttributionByReplicaId,
    actorUserId,
    budget,
  );
  const reportable = dropAutomationContentWrites(collected, attributionByReplicaId, actorUserId);
  if (reportable.length === 0) {
    return;
  }

  const outcome = await emitPostCommitFactEvents(
    reportable,
    budget,
    (write) => toContentWriteEvent(
      write,
      actorUserId,
      recordedAt,
      attributionByReplicaId.get(write.replicaId)?.platform ?? null,
      declaredSource ?? attributionByReplicaId.get(write.replicaId)?.source ?? null,
    ),
  );
  if (outcome.status === "aborted") {
    reportAbandonedContentWrites({
      ...outcome,
      actorUserId,
      // For either stop this is the first event not stored, and for a refusal it is also the event
      // named by the writer's failure warning.
      workspaceId: reportable[outcome.storedEventCount]?.workspaceId ?? null,
    });
  }
}

async function runTransactionReportingContentWrites<Result>(
  openTransaction: (
    body: (executor: DatabaseExecutor) => Promise<CommittedTransaction<Result>>,
  ) => Promise<CommittedTransaction<Result>>,
  body: (executor: DatabaseExecutor) => Promise<Result>,
  resolveActorUserId: (result: Result) => string,
  budget: PostCommitAnalyticsBudget,
): Promise<Result> {
  return runTransactionWithPostCommitDrain(
    openTransaction,
    body,
    async (committed) => emitCollectedContentWrites(
      committed.executor,
      resolveActorUserId(committed.result),
      budget,
    ),
  );
}

// The post-commit analytics clock both wrappers below hand their drain.
//
// It is optional because most callers open a transaction whose only post-commit analytics stage is
// that drain, and a stage that is alone on a request may as well be given a clock of its own. A
// caller that runs any other post-commit analytics stage - a second producer's drain, or a write of
// its own afterwards - must create one budget with createPostCommitAnalyticsBudget and pass it to
// every stage, because separate budgets sum and the request's tail then grows with the number of
// producers. See ./postCommitBudget.ts.
function resolvePostCommitAnalyticsBudget(
  budget: PostCommitAnalyticsBudget | undefined,
): PostCommitAnalyticsBudget {
  return budget ?? createPostCommitAnalyticsBudget();
}

/**
 * Opens one workspace-scoped product transaction and reports the card and deck writes it made -
 * every action the buffer above holds, not only creations.
 *
 * Every transaction that can reach any collect* function in this module must be opened through this
 * instead of transactionWithWorkspaceScope, otherwise its writes are collected and then dropped
 * with no error raised anywhere. Do not read that rule as being about inserts: a card or deck
 * deletion and a card or deck authoring edit are collected the same way and vanish the same way, so
 * a new caller of updateCard, updateCards or any other editing path needs this wrapper exactly as
 * much as a creating one does. The scope's own user is the actor, because it is the identity every
 * statement in the transaction runs as.
 */
export async function transactionWithWorkspaceScopeReportingContentWrites<Result>(
  scope: WorkspaceDatabaseScope,
  callback: (executor: DatabaseExecutor) => Promise<Result>,
  budget?: PostCommitAnalyticsBudget,
): Promise<Result> {
  return runTransactionReportingContentWrites<Result>(
    (body) => transactionWithWorkspaceScope(scope, body),
    callback,
    () => scope.userId,
    resolvePostCommitAnalyticsBudget(budget),
  );
}

/**
 * The same, for a privileged transaction that applies its scopes itself.
 *
 * The actor is resolved from the transaction's result because such a transaction has no single scope
 * to read it from: the guest upgrade opens unscoped, works under the guest scope, and only then
 * re-scopes to the account it is merging into.
 */
export async function unsafeTransactionReportingContentWrites<Result>(
  callback: (executor: DatabaseExecutor) => Promise<Result>,
  resolveActorUserId: (result: Result) => string,
  budget?: PostCommitAnalyticsBudget,
): Promise<Result> {
  return runTransactionReportingContentWrites<Result>(
    (body) => unsafeTransaction(body),
    callback,
    resolveActorUserId,
    resolvePostCommitAnalyticsBudget(budget),
  );
}
