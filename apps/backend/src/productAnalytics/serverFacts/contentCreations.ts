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
  captureBackendRuntimeWarning,
  createBackendObservationScope,
} from "../../observability/runtime";
import type { ProductAnalyticsEventName, ProductAnalyticsPlatform } from "../catalog";
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
  toWorkspaceReplicaPlatform,
  toWorkspaceReplicaRowPlatform,
  type WorkspaceReplicaPlatformFacts,
  type WorkspaceReplicaPlatformRow,
} from "./replicaPlatforms";
import {
  deriveServerDerivedProductAnalyticsEventId,
  type ServerDerivedProductAnalyticsEvent,
} from "./serverEvents";

export type ContentCreationEntityType = "card" | "deck";

/**
 * One card or deck that a product transaction brought into existence.
 *
 * Only creations are reported here. An update is deliberately not a fact this producer knows about:
 * the overwhelming majority of writes that reach content.cards are reviews rescheduling a card, a
 * workspace progress reset touching every card in the library at once, or background media
 * settlement with no person acting at all, so a single "content was written" event would have
 * counted review volume under an authoring name. Deciding what counts as an authoring update is its
 * own question; a creation has no such ambiguity, because none of those paths ever inserts a row.
 */
export type ContentCreation = Readonly<{
  entityType: ContentCreationEntityType;
  // The row's own id, always a canonical UUID because it is read back from a uuid column.
  entityId: string;
  workspaceId: string;
  // content.cards.last_modified_by_replica_id or content.decks.last_modified_by_replica_id as the
  // insert stored it, which on a creation is the replica that wrote the row rather than the last one
  // to touch it. It is carried as the id rather than as a platform because the replica row lives in
  // another table: resolving it is one lookup for a whole drain instead of one per row on the content
  // write. See resolveContentCreationPlatforms.
  replicaId: string;
  // sync.hot_changes.client_updated_at for the write that created the row, as an ISO string.
  clientUpdatedAt: string;
}>;

const contentCreationEventNames: Readonly<
  Record<ContentCreationEntityType, ProductAnalyticsEventName>
> = {
  card: "card_created",
  deck: "deck_created",
};

// Reporting inline would hold sync.workspace_sync_metadata's write lock across a second database
// transaction per creation, and that analytics transaction could not roll back with the product
// write. The shared lifecycle keeps the facts on this executor until its transaction commits.
const collectedContentCreations = createPostCommitFactBuffer<ContentCreation>();

/**
 * Records that this transaction created one card or deck, to be reported once it commits.
 *
 * Callers must only reach this from a branch that genuinely inserted the row. Both snapshot upserts
 * insert with `ON CONFLICT DO NOTHING ... RETURNING`, so a returned row is a real insert and the
 * conflict branches below it continue as updates of a row that already existed; the direct create
 * paths insert unconditionally on a freshly minted id. The LWW-lost branches return early with
 * `applied: false` and write no hot change at all, so they never get here.
 *
 * The creations only reach analytics through a transaction opened by one of the wrappers below.
 */
export function collectContentCreation(
  executor: DatabaseExecutor,
  creation: ContentCreation,
): void {
  collectPostCommitFact(collectedContentCreations, executor, creation);
}

// The platform behind a replica this transaction writes through, keyed by the executor running it
// and with the same lifetime as the creations above: created on first use, dropped with the executor.
//
// A caller that ensured a replica already holds everything the derivation needs, so what it names
// here is exactly what the drain would otherwise read sync.workspace_replicas back for. A null value
// is an answer like any other - "this replica justifies no platform" - and saves that read just as
// much as a device does.
const declaredReplicaPlatforms = new WeakMap<
  DatabaseExecutor,
  Map<string, ProductAnalyticsPlatform | null>
>();

/**
 * Names the platform behind one replica, from the facts the caller ensured that replica with.
 *
 * Callers must pass the actor kind and platform the stored row really carries, which is what
 * ensuring the replica guarantees: the upsert refuses a replica whose row disagrees with either. The
 * derivation is the drain's own, so a platform named here and one read back later cannot differ.
 *
 * Declaring is optional everywhere. Creations naming a replica nothing declared are resolved by the
 * drain instead, which is the only route left to a caller that was handed a replica id and no facts
 * at all - a workspace-package import, or a tool write whose replica was ensured in an earlier
 * transaction.
 */
export function declareContentCreationReplicaPlatform(
  executor: DatabaseExecutor,
  replicaId: string,
  replica: WorkspaceReplicaPlatformFacts,
): void {
  const platform = toWorkspaceReplicaPlatform(replica);
  const declared = declaredReplicaPlatforms.get(executor);
  if (declared === undefined) {
    declaredReplicaPlatforms.set(
      executor,
      new Map<string, ProductAnalyticsPlatform | null>([[replicaId, platform]]),
    );
    return;
  }

  declared.set(replicaId, platform);
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
function resolveContentCreationOccurredAt(clientUpdatedAt: string, recordedAt: Date): Date {
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
const contentCreationPlatformResolutionTimeoutMs = 2_000;

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
 * what makes it affordable: the creations were collected per transaction, so the content write
 * itself pays nothing and a 5,000-card import resolves through one indexed lookup rather than one
 * query per card.
 *
 * The read is scoped with the drain's own actor and the workspace of the creations it is resolving,
 * which is the scope those writes ran under and the only one the RLS policy on
 * sync.workspace_replicas admits (workspace_replicas_scoped_select_runtime, stated in full in
 * ./reviewAnswers.ts). Every path that reaches this producer writes into one workspace as one
 * identity, the guest upgrade included: the merge recreates the guest's replicas under the target
 * user and workspace and stores those ids on the rows it re-inserts, so the account the drain reports
 * as the actor is also the account that owns the replicas behind them.
 *
 * Best effort, and it must be: the cards and decks are committed and this producer may not reject
 * into a caller whose transaction is already closed. A read that fails, a budget that is already
 * spent, a replica the scoped read does not reach - each leaves its creations out of a per-platform
 * breakdown rather than guessing at a platform the append-only table could never be corrected of.
 */
async function resolveContentCreationPlatforms(
  creations: ReadonlyArray<ContentCreation>,
  declaredPlatformByReplicaId: ReadonlyMap<string, ProductAnalyticsPlatform | null>,
  actorUserId: string,
  budget: PostCommitAnalyticsBudget,
): Promise<ReadonlyMap<string, ProductAnalyticsPlatform | null>> {
  const undeclaredCreations = creations.filter(
    (creation) => !declaredPlatformByReplicaId.has(creation.replicaId),
  );
  const scopingCreation = undeclaredCreations[0];
  if (scopingCreation === undefined) {
    return declaredPlatformByReplicaId;
  }

  // The budget is checked here for the same reason a chunk checks it: this runs after COMMIT on the
  // request's own clock. A drain that finds it spent resolves nothing and the loop below then stops
  // on the same check, so the request pays for neither. A drain with nothing left to read returned
  // above without reaching this, so it neither starts that clock nor spends it.
  if (!budget.hasTimeForAnotherOperation()) {
    return declaredPlatformByReplicaId;
  }

  const replicaIds = [...new Set(undeclaredCreations.map((creation) => creation.replicaId))];
  const platformByReplicaId = new Map(declaredPlatformByReplicaId);
  const resolutionScope = createBackendObservationScope(
    "backend-api",
    null,
    null,
    null,
    actorUserId,
    scopingCreation.workspaceId,
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
      Date.now() + contentCreationPlatformResolutionTimeoutMs,
      async () => transactionWithWorkspaceScope(
        { userId: actorUserId, workspaceId: scopingCreation.workspaceId },
        async (executor) => {
          const result = await executor.query<WorkspaceReplicaPlatformRow>(
            [
              "SELECT replica_id, actor_kind, platform",
              "FROM sync.workspace_replicas",
              "WHERE replica_id = ANY($1::uuid[])",
            ].join(" "),
            [replicaIds],
          );
          return result.rows;
        },
      ),
    );
    if (replicas.length < replicaIds.length) {
      // The read succeeded without matching every replica it asked about, so nothing throws and the
      // creations behind the missing rows go on to be stored with a null platform. replicaIds is
      // deduplicated and replica_id is the primary key of sync.workspace_replicas, so the read can
      // only come back short, never long, and the shortfall is exactly what is reported here. Both
      // content.cards.last_modified_by_replica_id and content.decks.last_modified_by_replica_id
      // reference that table (db/migrations/0037_workspace_delete_schema_cleanup.sql), so a missing
      // row is never a deleted replica - it is a row this scoped read no longer reaches, which
      // ./reviewAnswers.ts states in full for the same read.
      captureBackendRuntimeWarning({
        action: "product_analytics_content_creation_platform_resolution_incomplete",
        scope: resolutionScope,
        details: {
          replicaIdCount: replicaIds.length,
          matchedReplicaCount: replicas.length,
          creationCount: undeclaredCreations.length,
        },
      });
    }
    for (const replica of replicas) {
      platformByReplicaId.set(replica.replica_id, toWorkspaceReplicaRowPlatform(replica));
    }
  } catch (error) {
    // Reported rather than swallowed. The events themselves are unaffected and still worth storing,
    // so nothing here stops the drain - but a resolution that fails for every drain is otherwise
    // invisible, because the rows keep arriving and only the platform quietly stops being on them.
    const errorDetails = getDatabaseErrorFields(error);
    captureBackendRuntimeWarning({
      action: "product_analytics_content_creation_platform_resolution_failed",
      scope: resolutionScope,
      details: {
        replicaIdCount: replicaIds.length,
        creationCount: undeclaredCreations.length,
        sqlState: errorDetails.sqlState,
        errorClass: errorDetails.errorClass,
        errorMessage: errorDetails.errorMessage,
      },
    });
  }

  return platformByReplicaId;
}

function toContentCreationEvent(
  creation: ContentCreation,
  actorUserId: string,
  recordedAt: Date,
  platform: ProductAnalyticsPlatform | null,
): ServerDerivedProductAnalyticsEvent {
  const eventName = contentCreationEventNames[creation.entityType];
  return {
    // Keyed on the row id alone. There is only ever one creation per row, so any path that reaches
    // this producer again for the same row - a replayed sync push, a guest merge - derives the same
    // id and conflicts on event_id in the writer instead of counting a second creation. Only a path
    // that preserves the row id dedupes this way: the workspace-package import mints a fresh card id
    // per card, so a re-import is genuinely new cards and correctly counts new creations.
    eventId: deriveServerDerivedProductAnalyticsEventId(eventName, [creation.entityId]),
    eventName,
    occurredAt: resolveContentCreationOccurredAt(creation.clientUpdatedAt, recordedAt),
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
    workspaceId: creation.workspaceId,
    // The platform of the replica that wrote the row: named by the transaction that ensured that
    // replica itself, and otherwise read back from sync.workspace_replicas once for the whole drain.
    // See resolveContentCreationPlatforms.
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
    properties: {},
    // Provenance about how a row was produced belongs to the backfill that reconstructs history.
    // A write observed as it happens has none.
    details: null,
  };
}

/**
 * Names the creations the drain gave up on, so an aborted drain is legible rather than silent.
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
function reportAbandonedContentCreations(
  abandoned: PostCommitFactEmissionAbortedOutcome & Readonly<{
    actorUserId: string;
    workspaceId: string | null;
  }>,
): void {
  if (abandoned.skippedEventCount <= 0) {
    return;
  }

  captureBackendRuntimeWarning({
    action: "product_analytics_content_creation_drain_aborted",
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
 * Reports one committed transaction's creations after resolving all undeclared replica platforms.
 * Workspace-package imports, bootstrap pushes and guest merges can collect thousands of creations;
 * the shared lifecycle bounds and partitions their sequential writer work. The platform lookup is
 * released before emission starts, so a drain still holds at most one database connection at once.
 *
 * Bounding the drain is especially important for a 5,000-card import: allowing analytics timeouts
 * to push the response past API Gateway's limit could invite a retry after the product commit, and
 * that retry would mint new card ids and duplicate the imported library.
 */
async function emitCollectedContentCreations(
  executor: DatabaseExecutor,
  actorUserId: string,
  budget: PostCommitAnalyticsBudget,
): Promise<void> {
  const collected = takePostCommitFacts(collectedContentCreations, executor);
  if (collected === undefined) {
    return;
  }

  const declaredPlatformByReplicaId: ReadonlyMap<string, ProductAnalyticsPlatform | null>
    = declaredReplicaPlatforms.get(executor) ?? new Map<string, ProductAnalyticsPlatform | null>();
  declaredReplicaPlatforms.delete(executor);
  // The server timestamp every event of this drain carries. The drain's stop clock is no longer read
  // here: it belongs to the request rather than to this drain, so it is the budget's.
  const recordedAt = new Date();
  // What the transaction named as it wrote, plus at most one read of the product database for the
  // replicas it did not, before the first chunk and after the commit that released this transaction's
  // connection. Creations left unresolved keep the null platform they always had; nothing here can
  // fail the drain.
  const platformByReplicaId = await resolveContentCreationPlatforms(
    collected,
    declaredPlatformByReplicaId,
    actorUserId,
    budget,
  );
  const outcome = await emitPostCommitFactEvents(
    collected,
    budget,
    (creation) => toContentCreationEvent(
      creation,
      actorUserId,
      recordedAt,
      platformByReplicaId.get(creation.replicaId) ?? null,
    ),
  );
  if (outcome.status === "aborted") {
    reportAbandonedContentCreations({
      ...outcome,
      actorUserId,
      // For either stop this is the first event not stored, and for a refusal it is also the event
      // named by the writer's failure warning.
      workspaceId: collected[outcome.storedEventCount]?.workspaceId ?? null,
    });
  }
}

async function runTransactionReportingContentCreations<Result>(
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
    async (committed) => emitCollectedContentCreations(
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
 * Opens one workspace-scoped product transaction and reports the cards and decks it created.
 *
 * Every transaction that can reach a card or deck insert must be opened through this instead of
 * transactionWithWorkspaceScope, otherwise its creations are collected and then dropped. The scope's
 * own user is the actor, because it is the identity every statement in the transaction runs as.
 */
export async function transactionWithWorkspaceScopeReportingContentCreations<Result>(
  scope: WorkspaceDatabaseScope,
  callback: (executor: DatabaseExecutor) => Promise<Result>,
  budget?: PostCommitAnalyticsBudget,
): Promise<Result> {
  return runTransactionReportingContentCreations<Result>(
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
export async function unsafeTransactionReportingContentCreations<Result>(
  callback: (executor: DatabaseExecutor) => Promise<Result>,
  resolveActorUserId: (result: Result) => string,
  budget?: PostCommitAnalyticsBudget,
): Promise<Result> {
  return runTransactionReportingContentCreations<Result>(
    (body) => unsafeTransaction(body),
    callback,
    resolveActorUserId,
    resolvePostCommitAnalyticsBudget(budget),
  );
}
