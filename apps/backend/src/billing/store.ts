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
 * client repeats them per page. Nothing here needs transactional isolation either - the resolved value
 * is recomputed on the next pull, and the cached row is explicitly not a source of truth.
 *
 * Only purchases attached to this person take part, and only those still describing live provider
 * state: a row superseded by another purchase carries invalidated_at, and a row whose account was
 * deleted carries account_deleted_at. Both are kept forever because the provider can still talk about
 * them, and neither may grant anything. The granting rules themselves stay out of this statement so
 * that expiry is decided in one place.
 */
export async function loadEntitlementResolutionInputs(
  userId: string,
): Promise<EntitlementResolutionInputs> {
  const result = await unsafeQuery<EntitlementResolutionInputsRow>(
    [
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
    ].join(" "),
    [userId],
  );

  const row = result.rows[0];
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
 * The DO UPDATE is guarded on that clock. Two concurrent resolutions of the same person commit in an
 * order the database does not fix, so without the guard the older one can land last and leave the row
 * at a superseded value under an older computed_at. Nothing reads the row today, but the entitlement
 * change fact planned on top of this write would flap between the two values.
 */
export async function upsertEntitlementSnapshotInExecutor(
  executor: DatabaseExecutor,
  userId: string,
  resolved: ResolvedEntitlement,
  computedAt: Date,
): Promise<void> {
  await executor.query(
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
}
