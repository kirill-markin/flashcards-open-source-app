// A person's current access in SQL, by the rules `resolveEntitlement` in
// apps/backend/src/billing/resolver.ts owns (docs/premium-entitlements.md); change it only to follow
// that function. It never reads `billing.entitlement_snapshots`, which the reporting role cannot read.

/** The ranks of apps/backend/src/billing/tiers.ts; NULL for a tier outside that catalogue. */
const tierRankSql = "CASE inputs.tier WHEN 'free' THEN 10 WHEN 'premium' THEN 20 WHEN 'lifetime' THEN 30 END";

/**
 * Every purchase and grant the backend store loads for a person, with the status it grants now or
 * NULL. Like the store, it leaves out unattached purchases and purchases carrying `invalidated_at` or
 * `account_deleted_at`; sandbox purchases grant like any other. `until` is the end the resolver
 * publishes: `grace_until` for a purchase in grace.
 */
const accessInputsSql = `SELECT purchases.user_id,
      purchases.purchase_id::text AS candidate_id,
      'purchase' AS source,
      purchases.tier,
      CASE
        WHEN purchases.status = 'active' AND (purchases.until IS NULL OR purchases.until > now()) THEN 'active'
        WHEN purchases.status = 'in_grace' AND (purchases.grace_until IS NULL OR purchases.grace_until > now()) THEN 'in_grace'
      END AS granting_status,
      CASE WHEN purchases.status = 'in_grace' THEN purchases.grace_until ELSE purchases.until END AS until,
      purchases.is_trial,
      purchases.will_renew,
      purchases.environment = 'sandbox' AS is_sandbox
    FROM billing.purchases AS purchases
    WHERE purchases.user_id IS NOT NULL
      AND purchases.invalidated_at IS NULL
      AND purchases.account_deleted_at IS NULL
    UNION ALL
    SELECT grants.user_id,
      grants.grant_id::text,
      'grant',
      grants.tier,
      CASE WHEN grants.revoked_at IS NULL AND (grants.expires_at IS NULL OR grants.expires_at > now()) THEN 'active' END,
      grants.expires_at,
      FALSE,
      FALSE,
      FALSE
    FROM billing.grants AS grants`;

/**
 * `isBetterCandidate`'s order, best first. A missing end sorts as unbounded on an `active` candidate and
 * below every date on an `in_grace` one; the identifier compares in "C" collation, as a JS string does.
 */
const winnerOrderSql = [
  `${tierRankSql} DESC`,
  "inputs.granting_status = 'active' DESC",
  "COALESCE(inputs.until, CASE WHEN inputs.granting_status = 'active' THEN 'infinity'::timestamptz ELSE '-infinity'::timestamptz END) DESC",
  "inputs.will_renew DESC",
  "inputs.is_trial ASC",
  "inputs.source = 'purchase' DESC",
  `inputs.candidate_id COLLATE "C" ASC`,
].join(", ");

function buildWinnerValueSql(valueSql: string): string {
  return `(array_agg(${valueSql} ORDER BY ${winnerOrderSql}) FILTER (WHERE inputs.granting_status IS NOT NULL))[1]`;
}

/**
 * One row per `user_id` any loaded purchase or grant names: the winning candidate's values, NULL when
 * none grants now. Read it only through `buildCurrentAccessColumnsSql`.
 */
export function buildCurrentAccessSql(): string {
  return `SELECT inputs.user_id,
      bool_or(${tierRankSql} IS NULL) AS has_unknown_tier,
      ${buildWinnerValueSql("inputs.tier")} AS tier,
      ${buildWinnerValueSql("inputs.granting_status")} AS status,
      ${buildWinnerValueSql("inputs.until")} AS until,
      ${buildWinnerValueSql("inputs.is_trial")} AS is_trial,
      bool_or(inputs.is_sandbox) FILTER (WHERE inputs.granting_status IS NOT NULL) AS from_sandbox
    FROM (
    ${accessInputsSql}
    ) AS inputs
    GROUP BY inputs.user_id`;
}

export type CurrentAccessColumnsSql = Readonly<{
  /** `free`, `premium` or `lifetime`. */
  tier: string;
  /** `none`, `active` or `in_grace`. */
  status: string;
  /** The winning purchase's `is_trial`; false for a grant and for `free`. */
  isTrial: string;
  /** Whether any purchase granting now is a sandbox one. */
  fromSandbox: string;
  /** The winning candidate's end; NULL for `free`, and an unknown end under `in_grace`. */
  until: string;
}>;

/**
 * The values over a LEFT JOIN of `buildCurrentAccessSql` as `accessAlias`, so a person no row names is
 * `free` with status `none`. Every value is NULL, unknown, when any loaded row names a tier outside the
 * catalogue: the backend then fails to resolve that person and publishes no entitlement at all.
 */
export function buildCurrentAccessColumnsSql(accessAlias: string): CurrentAccessColumnsSql {
  const resolvedSql = (valueSql: string): string => `CASE WHEN ${accessAlias}.has_unknown_tier THEN NULL ELSE ${valueSql} END`;
  return {
    tier: resolvedSql(`COALESCE(${accessAlias}.tier, 'free')`),
    status: resolvedSql(`COALESCE(${accessAlias}.status, 'none')`),
    isTrial: resolvedSql(`COALESCE(${accessAlias}.is_trial, FALSE)`),
    fromSandbox: resolvedSql(`COALESCE(${accessAlias}.from_sandbox, FALSE)`),
    until: resolvedSql(`${accessAlias}.until`),
  };
}
