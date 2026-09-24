import type { DatabaseExecutor } from "../database";
import { unsafeQuery } from "../database/unsafe";
import { isEntitlementTier, type EntitlementTier } from "./tiers";
import type {
  EntitlementGrantInput,
  EntitlementPurchaseInput,
  PurchaseStatus,
  ResolvedEntitlement,
} from "./resolver";

/**
 * The reads that feed the resolver and the write of its result. Nothing here decides anything about
 * entitlement: the granting rules live in resolver.ts, so that a snapshot rebuilt from these same
 * rows always reproduces the same answer.
 *
 * No database scope is applied. These rows are keyed by person, but their row-level security policies
 * are unrestricted on purpose, because the rest of the billing layer is written by provider callbacks,
 * reconciliation and operator actions that run outside any request
 * (db/migrations/0151_billing_schema.sql).
 */
type PurchaseJson = Readonly<{
  purchase_id: string;
  tier: string;
  status: string;
  is_trial: boolean;
  will_renew: boolean;
  until: string | null;
  grace_until: string | null;
}>;

type GrantJson = Readonly<{
  grant_id: string;
  tier: string;
  expires_at: string | null;
  revoked_at: string | null;
}>;

type EntitlementSnapshotJson = Readonly<{
  tier: string;
  status: string;
  until: string | null;
  is_trial: boolean;
  will_renew: boolean;
  source: string;
}>;

type EntitlementResolutionInputsRow = Readonly<{
  purchases: ReadonlyArray<PurchaseJson>;
  grants: ReadonlyArray<GrantJson>;
  cached: EntitlementSnapshotJson | null;
}>;

/**
 * Everything the resolver needs for one person, and the cached row it will be compared with.
 */
export type EntitlementResolutionInputs = Readonly<{
  purchases: ReadonlyArray<EntitlementPurchaseInput>;
  grants: ReadonlyArray<EntitlementGrantInput>;
  cached: CachedEntitlementSnapshot | null;
}>;

/**
 * The cached row as stored, with its vocabularies left as text. A cache is compared, never trusted:
 * a stored value this code cannot name simply differs from the resolved one and is overwritten, which
 * is exactly how a rebuildable cache is supposed to heal.
 */
export type CachedEntitlementSnapshot = Readonly<{
  tier: string;
  status: string;
  until: Date | null;
  isTrial: boolean;
  willRenew: boolean;
  source: string;
}>;

function requireEntitlementTier(value: string, rowDescription: string): EntitlementTier {
  if (!isEntitlementTier(value)) {
    throw new Error(`Billing ${rowDescription} names a tier outside the catalogue: ${value}`);
  }

  return value;
}

function requirePurchaseStatus(value: string, purchaseId: string): PurchaseStatus {
  if (value === "active" || value === "in_grace" || value === "expired" || value === "revoked") {
    return value;
  }

  throw new Error(`Billing purchase ${purchaseId} has an unknown status: ${value}`);
}

/**
 * A timestamp that arrived inside a JSON aggregate. Postgres renders a timestamptz there as ISO 8601
 * with its UTC offset, which is why reading it back needs nothing but a Date.
 */
function readNullableTimestamp(value: string | null, fieldDescription: string): Date | null {
  if (value === null) {
    return null;
  }

  const parsedValue = new Date(value);
  if (Number.isNaN(parsedValue.getTime())) {
    throw new Error(`Billing ${fieldDescription} is not a readable timestamp: ${value}`);
  }

  return parsedValue;
}

/**
 * One statement for the whole read, because the steady state of a sync pull writes nothing and finds
 * nothing changed: three sequential statements would spend three round trips per pull, and a paging
 * client repeats them per page.
 *
 * Only purchases attached to this person take part, and only those still describing live provider
 * state: a row superseded by another purchase carries invalidated_at, and a row whose account was
 * deleted carries account_deleted_at. Both are kept forever because the provider can still talk about
 * them, and neither may grant anything. The granting rules themselves stay out of this statement so
 * that expiry is decided in one place.
 *
 * The statement is shared by the two readers below rather than copied, because they must select the
 * same rows under the same filters: one runs on its own pooled connection to decide whether a write is
 * worth opening, the other runs inside the write transaction to decide what is stored.
 */
const entitlementResolutionInputsQuery = [
  "SELECT COALESCE((",
  "SELECT json_agg(json_build_object(",
  "'purchase_id', purchases.purchase_id::text,",
  "'tier', purchases.tier,",
  "'status', purchases.status,",
  "'is_trial', purchases.is_trial,",
  "'will_renew', purchases.will_renew,",
  "'until', purchases.until,",
  "'grace_until', purchases.grace_until",
  "))",
  "FROM billing.purchases",
  "WHERE purchases.user_id = $1",
  "AND purchases.invalidated_at IS NULL",
  "AND purchases.account_deleted_at IS NULL",
  "), '[]'::json) AS purchases,",
  "COALESCE((",
  "SELECT json_agg(json_build_object(",
  "'grant_id', grants.grant_id::text,",
  "'tier', grants.tier,",
  "'expires_at', grants.expires_at,",
  "'revoked_at', grants.revoked_at",
  "))",
  "FROM billing.grants",
  "WHERE grants.user_id = $1",
  "), '[]'::json) AS grants,",
  "(",
  "SELECT json_build_object(",
  "'tier', entitlement_snapshots.tier,",
  "'status', entitlement_snapshots.status,",
  "'until', entitlement_snapshots.until,",
  "'is_trial', entitlement_snapshots.is_trial,",
  "'will_renew', entitlement_snapshots.will_renew,",
  "'source', entitlement_snapshots.source",
  ")",
  "FROM billing.entitlement_snapshots",
  "WHERE entitlement_snapshots.user_id = $1",
  ") AS cached",
].join(" ");

function toEntitlementResolutionInputs(
  row: EntitlementResolutionInputsRow | undefined,
  userId: string,
): EntitlementResolutionInputs {
  if (row === undefined) {
    throw new Error("The billing entitlement read returned no row.");
  }

  const cached = row.cached;
  return {
    purchases: row.purchases.map((purchase) => ({
      purchaseId: purchase.purchase_id,
      tier: requireEntitlementTier(purchase.tier, `purchase ${purchase.purchase_id}`),
      status: requirePurchaseStatus(purchase.status, purchase.purchase_id),
      isTrial: purchase.is_trial,
      willRenew: purchase.will_renew,
      until: readNullableTimestamp(purchase.until, `purchase ${purchase.purchase_id} until`),
      graceUntil: readNullableTimestamp(purchase.grace_until, `purchase ${purchase.purchase_id} grace_until`),
    })),
    grants: row.grants.map((grant) => ({
      grantId: grant.grant_id,
      tier: requireEntitlementTier(grant.tier, `grant ${grant.grant_id}`),
      expiresAt: readNullableTimestamp(grant.expires_at, `grant ${grant.grant_id} expires_at`),
      revokedAt: readNullableTimestamp(grant.revoked_at, `grant ${grant.grant_id} revoked_at`),
    })),
    cached: cached === null ? null : {
      tier: cached.tier,
      status: cached.status,
      until: readNullableTimestamp(cached.until, `entitlement snapshot for ${userId} until`),
      isTrial: cached.is_trial,
      willRenew: cached.will_renew,
      source: cached.source,
    },
  };
}

/**
 * The read on its own pooled connection, which is the one every sync pull makes. Nothing here needs
 * transactional isolation: it is one statement, so its three parts are consistent with each other, and
 * the write re-reads under its own lock before storing anything.
 *
 * That is not licence to treat this as a heuristic. On the branch that carries almost all traffic the
 * cached row matches, no write is opened, and the resolution computed from this read is the entitlement
 * published to the client, so a column dropped here or a value served stale here is a wrong answer for
 * every client rather than one unnecessary transaction. The strict mappers above are part of the same
 * contract: an operator grant or purchase naming a tier or status this code cannot read raises here,
 * which is the failure the sync pull route classifies on its exception path and answers by omitting the
 * entitlement rather than by publishing a free one.
 */
export async function loadEntitlementResolutionInputs(
  userId: string,
): Promise<EntitlementResolutionInputs> {
  const result = await unsafeQuery<EntitlementResolutionInputsRow>(
    entitlementResolutionInputsQuery,
    [userId],
  );
  return toEntitlementResolutionInputs(result.rows[0], userId);
}

/**
 * The same read inside a caller's transaction, so a resolution can be computed from rows that cannot
 * change under it.
 *
 * It exists because the value a write stores has to come from behind the same lock as the state that
 * write replaces. A resolution computed from the pooled read above is a snapshot of an arbitrary
 * earlier instant - the request's own start is not when its read landed - so storing it can put back a
 * value that a resolution which has already committed had superseded, and any fact derived from that
 * describes a transition that never happened.
 *
 * The `cached` field it returns is never the pre-image, and consolidating the two reads to save a round
 * trip would be wrong however much richer this one looks with all six columns against the lock's two.
 * The two agree only when the lock matched a row. When `lockEntitlementSnapshotInExecutor` returned null
 * it locked nothing, and this is a separate statement with its own READ COMMITTED snapshot, so a
 * concurrent first-ever insert committing between them makes this `cached` non-null while the locked
 * read said there was no row. Taking it as the pre-image would make that branch report a transition,
 * which is the one thing it must not do. Only the purchases and grants are why this exists.
 */
export async function loadEntitlementResolutionInputsInExecutor(
  executor: DatabaseExecutor,
  userId: string,
): Promise<EntitlementResolutionInputs> {
  const result = await executor.query<EntitlementResolutionInputsRow>(
    entitlementResolutionInputsQuery,
    [userId],
  );
  return toEntitlementResolutionInputs(result.rows[0], userId);
}

function getUntilTime(until: Date | null): number | null {
  return until === null ? null : until.getTime();
}

export function matchesResolvedEntitlement(
  cached: CachedEntitlementSnapshot,
  resolved: ResolvedEntitlement,
): boolean {
  return cached.tier === resolved.tier
    && cached.status === resolved.status
    && getUntilTime(cached.until) === getUntilTime(resolved.until)
    && cached.isTrial === resolved.isTrial
    && cached.willRenew === resolved.willRenew
    && cached.source === resolved.source;
}

/**
 * Whether the resolution this write carried became the stored one.
 *
 * Deliberately not a boolean: `superseded` is the outcome a caller has to act on, and a name says
 * which of the two happened without the reader having to know which way `true` points.
 */
export type EntitlementSnapshotWriteOutcome = "stored" | "superseded";

/**
 * The stored access a write is about to replace, as text, exactly as the cached row holds it.
 *
 * It is not the row `loadEntitlementResolutionInputs` returned. That read runs on its own connection
 * before the transaction, so by the time the write happens another resolution of the same person may
 * already have replaced what it saw. Only a state read inside the write transaction, by the statement
 * that locks the row, names what that write supersedes.
 */
export type ReplacedEntitlementSnapshotState = Readonly<{
  tier: string;
  status: string;
}>;

/**
 * Locks this person's snapshot row for the rest of the caller's transaction and returns the access it
 * holds, or null when there is no row.
 *
 * Null is the whole of the qualification on this lock, and it matters: `FOR UPDATE` locks rows it
 * matched, so when no row exists it locks nothing at all. Two first-ever resolutions of one person
 * therefore both get null here and neither sees the other; they are serialised only by the primary key,
 * where the second `INSERT ... ON CONFLICT` waits on the first and then evaluates its own clock guard,
 * so both can come back `stored` having seen no earlier state. Nothing may report a
 * transition from that branch - `snapshot.ts` reports nothing whenever this returns null, which is what
 * keeps two racing first resolutions from storing two facts for one arrival.
 *
 * Once a row exists the lock is real, and the compare-and-swap it makes possible is the point: the
 * caller re-reads this person's purchases and grants on the same executor, re-resolves from them, and
 * stores and reports that. A concurrent resolution either reaches this lock first, in which case this
 * read waits for it and returns the row as it left it, or arrives after and waits here.
 */
export async function lockEntitlementSnapshotInExecutor(
  executor: DatabaseExecutor,
  userId: string,
): Promise<ReplacedEntitlementSnapshotState | null> {
  const locked = await executor.query<ReplacedEntitlementSnapshotState>(
    [
      "SELECT tier, status",
      "FROM billing.entitlement_snapshots",
      "WHERE user_id = $1",
      "FOR UPDATE",
    ].join(" "),
    [userId],
  );
  const lockedRow = locked.rows[0];
  return lockedRow === undefined ? null : { tier: lockedRow.tier, status: lockedRow.status };
}

/**
 * One statement writes every derived column, so a row can never be read as resolved while half of it
 * is still a column default: is_trial and will_renew are NOT NULL DEFAULT FALSE, which would make a
 * partially written row indistinguishable from a resolved one.
 *
 * The conflict target is the user_id primary key. The partial unique indexes elsewhere in this schema
 * cannot arbitrate an upsert unless the statement repeats their predicate, and none of them is on
 * this table anyway.
 *
 * computed_at records the clock this resolution used. Because an unchanged entitlement is not
 * rewritten, it is when the stored value became current, not when it was last verified.
 *
 * The DO UPDATE is guarded on that clock, so a resolution carrying an older clock than the stored one
 * leaves the row alone instead of putting it back to a value that has already been superseded, and the
 * comparison is strict, so a resolution carrying exactly the stored clock stores nothing either. That
 * guard is belt and braces and never the ordering mechanism: the clock is the request's start, which
 * says nothing about when that request's input read landed, so ordering by it would let a resolution
 * computed from older rows win. What orders two resolutions is the row lock the caller takes before it
 * re-reads and re-resolves (`lockEntitlementSnapshotInExecutor`), and on a first-ever insert, where
 * there is no row to lock, the primary key - which is why the caller reports no transition there.
 *
 * The outcome is returned because the guard is silent: the statement affects no row and raises nothing,
 * so a caller that assumed it had written would report a change the database refused.
 */
export async function upsertEntitlementSnapshotInExecutor(
  executor: DatabaseExecutor,
  userId: string,
  resolved: ResolvedEntitlement,
  computedAt: Date,
): Promise<EntitlementSnapshotWriteOutcome> {
  const result = await executor.query(
    [
      "INSERT INTO billing.entitlement_snapshots (",
      "user_id, tier, status, until, is_trial, will_renew, source, computed_at",
      ") VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
      "ON CONFLICT (user_id) DO UPDATE SET",
      "tier = EXCLUDED.tier,",
      "status = EXCLUDED.status,",
      "until = EXCLUDED.until,",
      "is_trial = EXCLUDED.is_trial,",
      "will_renew = EXCLUDED.will_renew,",
      "source = EXCLUDED.source,",
      "computed_at = EXCLUDED.computed_at",
      "WHERE entitlement_snapshots.computed_at < EXCLUDED.computed_at",
    ].join(" "),
    [
      userId,
      resolved.tier,
      resolved.status,
      resolved.until === null ? null : resolved.until.toISOString(),
      resolved.isTrial,
      resolved.willRenew,
      resolved.source,
      computedAt.toISOString(),
    ],
  );
  return (result.rowCount ?? 0) === 0 ? "superseded" : "stored";
}
