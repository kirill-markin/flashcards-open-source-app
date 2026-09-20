import { withReportingReadOnlyTransaction } from "../admin/reportingDb";
import { unsafeQuery } from "../database/unsafe";
import {
  addBackendBreadcrumb,
  captureBackendWarning,
  type BackendObservationScope,
} from "../observability/sentry";

/**
 * The value written into `analytics.excluded_actors.excluded_by`, which the table reserves for a
 * label explaining who excluded the actor. A human restore records its own label beside it, so this
 * one stays constant and identifies every row the detector wrote.
 */
export const syntheticActorDetectorLabel = "job:synthetic-actor-detector";

/**
 * At or above this many insertions, a single run reports itself to Sentry.
 *
 * The rule matches roughly two organic actors a quarter, and the scripted run that prompted this
 * job produced seventy-six in one morning. Ten is far beyond anything the organic rate can reach in
 * a day, and small enough that a scripted run an eighth the size of that one still raises. The
 * first run after deployment inserts the whole standing backlog and therefore raises as well, which
 * is the run a human most wants to look at.
 */
export const syntheticActorLargeRunThreshold = 10;

const syntheticActorReason = "no client_installation replica and no app_opened event";

/**
 * One synthetic actor, with the signals measured for it. `reviewAnsweredEvents`, `appOpenedEvents`
 * and `clientInstallationReplicas` are the population scope and the two matched signals, and they
 * are read off the same query that selected the candidate rather than asserted, so the log record
 * carries the measurement the decision was made on.
 */
export type SyntheticActorCandidate = Readonly<{
  actorId: string;
  analyticsEvents: number;
  reviewAnsweredEvents: number;
  appOpenedEvents: number;
  clientInstallationReplicas: number;
  workspaceReplicas: number;
  firstEventAtUtc: string;
  lastEventAtUtc: string;
}>;

export type SyntheticActorDetectorResult = Readonly<{
  candidateActors: number;
  inserted: number;
  alreadyRecorded: number;
  largeRun: boolean;
}>;

type SyntheticActorCandidateRow = Readonly<{
  actor_id: string;
  analytics_events: number;
  review_answered_events: number;
  app_opened_events: number;
  client_installation_replicas: number;
  workspace_replicas: number;
  first_event_at: Date;
  last_event_at: Date;
}>;

type InsertedExcludedActorRow = Readonly<{ actor_id: string }>;

/**
 * The rule, as one statement.
 *
 * A reviewing actor is synthetic when both signals hold: no `client_installation` workspace replica
 * was ever registered for any id that actor's events name, and no `app_opened` event this statement
 * counts exists anywhere in that actor's history, meaning none outside the credential-free rows the
 * `trust_level` predicate below drops. Either signal alone is wrong - every actor without a replica
 * that looks human has app opens - so the conjunction is what separates a scripted run from a
 * person whose installation row simply predates the replica the client now registers.
 *
 * The population is reviewing actors, which is what the `HAVING` on `actor_signals` states: an
 * actor becomes a candidate only once it has answered a review. That is the population the rule was
 * validated on, and the scope is load-bearing rather than a narrowing convenience. Applied to every
 * actor in the event store, the same two signals match roughly three and a half times as many,
 * because a catalog visitor who signs in on the web without the app ever emitting `app_opened`
 * holds both signals while being an entirely real person. The scope must stay a `HAVING` on the
 * existing group: written as a `WHERE` on `resolved.event_name` it would restrict the rows the
 * group sees, drive `app_opened_events` to zero for every actor and so delete the second safety
 * signal while appearing to narrow the population.
 *
 * `app_opened_events = 0` is evaluated on the actor's whole resolved history with no time bound, so
 * the statement cannot match an actor that has any `app_opened` event outside the credential-free
 * rows the `trust_level` predicate below drops: the count is taken over every other row
 * `analytics.product_events_resolved` attributes to that actor, and one such row makes it non-zero.
 * A `0121`-backfilled `app_opened` row is such a row and does block a detection, the way it counts
 * everywhere else: the rule keeps the server's own observations and drops only the unverified
 * claim.
 *
 * `trust_level <> 'anonymous_client'` RESTATES RATHER THAN CALLS the rule
 * `buildTrustedActorRowsFilterSql` in `apps/admin/src/filters/filterSql.ts` owns and states in
 * full, because the backend cannot import the admin package. The credential-free collector
 * (`docs/anonymous-client-analytics.md`) writes rows with no credential behind them, and the
 * caller-supplied `anonymous_id` they carry is what `actor_id` falls back to, so such a row is
 * evidence that an event happened and not evidence about the person it resolves onto. It reaches
 * this rule in the weaker direction only: the candidate population is gated on the server-only
 * `review_answered`, so no collector row can make a candidate, while without this predicate one
 * collector row carrying `app_opened` would switch off the second safety signal for an actor and
 * suppress a detection.
 *
 * `person_ids` is why the replica signal is evaluated on more than the analytics actor id. A row of
 * `analytics.product_events_resolved` carries, beside its resolved `actor_id`, the raw `user_id`
 * the request context supplied and the `subject_user_id` the server set, and all three name the
 * same person. Replicas are registered under whichever of those ids was live at the time, so
 * checking only `actor_id` would check one id and call it the person. Widening the check can only
 * remove matches, never add them.
 *
 * One actor produces exactly one row, and the id inserted is always its analytics actor id - the id
 * the admin surfaces match on and the only id a human restoring the actor can reach. The person's
 * other ids are read for the replica signal and for the restore gate and are never inserted: every
 * published figure counts only review rows whose replica is `actor_kind = 'client_installation'`
 * (`clientInstallationActivityWhereSqlFragments` in `apps/backend/src/globalMetrics/reporting.ts`),
 * and an actor this rule can match has no such replica under any of its ids, so it contributes
 * nothing to the published figures and recording a replica-side id would change no published
 * number. It would instead spread one person over two primary keys in a table whose restore is per
 * key and final, leaving the replica-side row permanently active after a human restored the one row
 * the admin surface shows them.
 *
 * Both `NOT EXISTS` clauses against `analytics.excluded_actors` are bounds on the size of the
 * insert, not the restore rule: the restore rule is the primary key and the `ON CONFLICT
 * (actor_id) DO NOTHING` the insert carries, which cannot touch a row that already exists whatever
 * this query returns. The person-level one additionally stops the detector from re-adding an actor
 * whose row a human restored under another of that person's ids, which no per-row conflict can
 * express.
 *
 * That person-level gate is read here, in the reporting snapshot, while the insert runs later on
 * its own connection, so a restore committed between the two is invisible to the run. It is the one
 * case where the gate is weaker than a key: a restore of the actor's own id is still caught by the
 * insert's conflict target, but an actor whose restore sits on another of the person's ids is
 * inserted anyway. The window is seconds, the schedule is daily, and the next run sees the restore.
 *
 * The budget for this scan is the reporting role's own 30s `statement_timeout`
 * (`db/migrations/0044_reporting_readonly_role.sql`), not the five-minute timeout the Lambda is
 * configured with. The statement is an unbounded full-history aggregation over
 * `analytics.product_events`, which is append-only and never pruned, with a per-actor
 * `array_agg(DISTINCT ...)` and a join predicate,
 * `pg_catalog.lower(pg_catalog.btrim(replicas.user_id))`, that no index on
 * `sync.workspace_replicas` can serve. It fits today and it grows. The night it crosses 30s the run
 * fails with `57014` and every run after it fails the same way, filling nothing - surfacing as the
 * `synthetic_actor_detector_failed` Sentry exception, which is the signal to bound the scan by time
 * or by candidate id rather than to raise the timeout.
 *
 * Every id compared here is folded with `pg_catalog.lower(pg_catalog.btrim(...))`, the fold
 * `analytics.excluded_actors.actor_id` stores and every reader applies to its own side.
 */
const syntheticActorCandidateSql = `
WITH actor_signals AS (
  SELECT
    pg_catalog.lower(pg_catalog.btrim(resolved.actor_id::text)) AS actor_id,
    count(*) AS analytics_events,
    count(*) FILTER (WHERE resolved.event_name = 'review_answered') AS review_answered_events,
    count(*) FILTER (WHERE resolved.event_name = 'app_opened') AS app_opened_events,
    min(resolved.occurred_at) AS first_event_at,
    max(resolved.occurred_at) AS last_event_at,
    array_agg(DISTINCT pg_catalog.lower(pg_catalog.btrim(resolved.user_id::text)))
      FILTER (WHERE resolved.user_id IS NOT NULL) AS event_user_ids,
    array_agg(DISTINCT pg_catalog.lower(pg_catalog.btrim(resolved.subject_user_id::text)))
      FILTER (WHERE resolved.subject_user_id IS NOT NULL) AS event_subject_user_ids
  FROM analytics.product_events_resolved AS resolved
  WHERE resolved.actor_id IS NOT NULL
    AND resolved.trust_level <> 'anonymous_client'
  GROUP BY 1
  HAVING count(*) FILTER (WHERE resolved.event_name = 'review_answered') > 0
),
person_ids AS (
  SELECT DISTINCT
    actor_signals.actor_id,
    person_key.person_id
  FROM actor_signals
  CROSS JOIN LATERAL unnest(
    ARRAY[actor_signals.actor_id]
      || COALESCE(actor_signals.event_user_ids, ARRAY[]::text[])
      || COALESCE(actor_signals.event_subject_user_ids, ARRAY[]::text[])
  ) AS person_key(person_id)
  WHERE actor_signals.app_opened_events = 0
),
id_replicas AS (
  SELECT
    person_ids.actor_id,
    person_ids.person_id,
    count(replicas.replica_id) AS workspace_replicas,
    count(replicas.replica_id) FILTER (
      WHERE replicas.actor_kind = 'client_installation'
    ) AS client_installation_replicas
  FROM person_ids
  LEFT JOIN sync.workspace_replicas AS replicas
    ON pg_catalog.lower(pg_catalog.btrim(replicas.user_id)) = person_ids.person_id
  GROUP BY 1, 2
),
person_replicas AS (
  SELECT
    id_replicas.actor_id,
    sum(id_replicas.workspace_replicas) AS workspace_replicas,
    sum(id_replicas.client_installation_replicas) AS client_installation_replicas
  FROM id_replicas
  GROUP BY 1
)
SELECT
  person_replicas.actor_id,
  CAST(actor_signals.analytics_events AS INTEGER) AS analytics_events,
  CAST(actor_signals.review_answered_events AS INTEGER) AS review_answered_events,
  CAST(actor_signals.app_opened_events AS INTEGER) AS app_opened_events,
  CAST(person_replicas.client_installation_replicas AS INTEGER) AS client_installation_replicas,
  CAST(person_replicas.workspace_replicas AS INTEGER) AS workspace_replicas,
  actor_signals.first_event_at,
  actor_signals.last_event_at
FROM person_replicas
JOIN actor_signals ON actor_signals.actor_id = person_replicas.actor_id
WHERE person_replicas.client_installation_replicas = 0
  AND NOT EXISTS (
    SELECT 1
    FROM analytics.excluded_actors AS restored
    JOIN person_ids AS restored_person
      ON restored_person.person_id = restored.actor_id
    WHERE restored_person.actor_id = person_replicas.actor_id
      AND restored.restored_at IS NOT NULL
  )
  AND NOT EXISTS (
    SELECT 1
    FROM analytics.excluded_actors AS recorded
    WHERE recorded.actor_id = person_replicas.actor_id
  )
ORDER BY person_replicas.actor_id
`;

function toCandidate(row: SyntheticActorCandidateRow): SyntheticActorCandidate {
  return {
    actorId: row.actor_id,
    analyticsEvents: row.analytics_events,
    reviewAnsweredEvents: row.review_answered_events,
    appOpenedEvents: row.app_opened_events,
    clientInstallationReplicas: row.client_installation_replicas,
    workspaceReplicas: row.workspace_replicas,
    firstEventAtUtc: row.first_event_at.toISOString(),
    lastEventAtUtc: row.last_event_at.toISOString(),
  };
}

async function loadSyntheticActorCandidates(): Promise<ReadonlyArray<SyntheticActorCandidate>> {
  return withReportingReadOnlyTransaction(async (client) => {
    const result = await client.query<SyntheticActorCandidateRow>(syntheticActorCandidateSql);
    return result.rows.map(toCandidate);
  });
}

/**
 * `ON CONFLICT (actor_id) DO NOTHING` is the restore rule, and it is the database's own key rather
 * than a predicate a later edit can drop. A restore is recorded on the row instead of deleting it,
 * so a restored actor is always a conflicting key, and the run skips it and keeps going.
 *
 * A plain multi-row insert would raise `unique_violation` on the first restored actor it matched
 * again and abort the whole run, silently dropping every other exclusion in it. `DO UPDATE` would
 * be worse: it would resurrect a human's exclusion, which the table's
 * `excluded_actors_restore_is_final` trigger rejects with 23514 anyway, so the job must not even
 * try.
 *
 * `RETURNING` reports exactly the rows this statement created, which is what the per-actor log
 * records and the large-run threshold are counted from.
 *
 * Deliberately not wrapped in `withTransientDatabaseRetry`, unlike the neighbouring scheduled jobs.
 * A connection lost mid-statement leaves the commit outcome unknown, and a second attempt whose
 * first attempt had committed would conflict on every row and return nothing - the run would then
 * write no log record for exclusions that exist, which is the one thing the safety net on automatic
 * insertion cannot lose. The daily schedule is the retry, and the rows themselves carry
 * `excluded_by`, `excluded_at` and `reason`.
 */
async function insertSyntheticActorExclusions(
  candidates: ReadonlyArray<SyntheticActorCandidate>,
): Promise<ReadonlySet<string>> {
  const actorIds = candidates.map((candidate) => candidate.actorId);
  const result = await unsafeQuery<InsertedExcludedActorRow>(
    `INSERT INTO analytics.excluded_actors (actor_id, excluded_by, reason, source)
     SELECT candidate.actor_id, $2::text, $3::text, 'automatic'
     FROM unnest($1::text[]) AS candidate(actor_id)
     ON CONFLICT (actor_id) DO NOTHING
     RETURNING actor_id`,
    [actorIds, syntheticActorDetectorLabel, syntheticActorReason],
  );

  return new Set(result.rows.map((row) => row.actor_id));
}

export async function excludeSyntheticActors(
  scope: BackendObservationScope,
): Promise<SyntheticActorDetectorResult> {
  const candidates = await loadSyntheticActorCandidates();
  const insertedActorIds = await insertSyntheticActorExclusions(candidates);
  for (const candidate of candidates) {
    if (!insertedActorIds.has(candidate.actorId)) {
      continue;
    }
    addBackendBreadcrumb({
      action: "synthetic_actor_excluded",
      scope,
      details: candidate,
    });
  }

  const result: SyntheticActorDetectorResult = {
    candidateActors: candidates.length,
    inserted: insertedActorIds.size,
    alreadyRecorded: candidates.length - insertedActorIds.size,
    largeRun: insertedActorIds.size >= syntheticActorLargeRunThreshold,
  };

  addBackendBreadcrumb({
    action: "synthetic_actor_detector_completed",
    scope,
    details: { ...result, largeRunThreshold: syntheticActorLargeRunThreshold },
  });

  if (result.largeRun) {
    captureBackendWarning({
      action: "synthetic_actor_detector_large_run",
      scope,
      message: `Synthetic actor detector excluded ${result.inserted} of ${result.candidateActors} candidate actors in one run, at or above the ${syntheticActorLargeRunThreshold} threshold. Review analytics.excluded_actors and restore anyone the rule caught by mistake.`,
      details: {
        candidateActors: result.candidateActors,
        inserted: result.inserted,
        threshold: syntheticActorLargeRunThreshold,
      },
    });
  }

  return result;
}
