import { buildExcludedActorSqlLines } from "../../filters/filterSql";

// Only final events drop excluded people; unlinked payers count, and erasure alone never drops one. Classification uses all retained chronology.
// Google orders of one subscription are `<root>`, `<root>..0`, `<root>..1`, ...; one is classified only
// when the root and every earlier suffix are retained with known charge evidence, and after a free-trial
// root the first positive suffix, even `..0`, is the first payment. Protobuf omits a zero `units`/`nanos`, read as 0, while an
// absent `total` is unknown.
export function buildPaymentHistoryCtesSql(): string {
  return `history_runs AS (
  SELECT run_id, provider, source, scope_kind, subject_id, requested_from, requested_to,
    started_at, finished_at, status, covered_from, covered_to, failure_code
  FROM billing.history_import_runs WHERE environment = 'production'
), apple_periods AS (
  SELECT transaction_id, original_transaction_id, subject_id, purchased_at,
    (native_fields->>'price')::numeric AS price,
    native_fields->>'offerDiscountType' = 'FREE_TRIAL' AS is_trial,
    native_fields->>'transactionReason' AS native_reason
  FROM billing.apple_transactions
  WHERE environment = 'production'
    AND native_fields->>'type' = 'Auto-Renewable Subscription'
    AND native_fields->>'inAppOwnershipType' IS DISTINCT FROM 'FAMILY_SHARED'
), apple_events AS (
  SELECT 'apple'::text AS provider, period.subject_id, period.purchased_at AS event_at,
    CASE WHEN period.is_trial AND period.price = 0 THEN 'trial'
      WHEN period.price > 0 THEN
        CASE WHEN EXISTS (
          SELECT 1 FROM history_runs AS run
          WHERE run.source = 'apple_transactions' AND run.scope_kind = 'subject'
            AND run.subject_id = period.subject_id AND run.status = 'succeeded'
            AND run.covered_from <= '1970-01-01'::timestamptz
            AND run.covered_to > period.purchased_at
        ) AND EXISTS (
          SELECT 1 FROM apple_periods AS root
          WHERE root.transaction_id = period.original_transaction_id
            AND root.subject_id = period.subject_id
        ) AND NOT EXISTS (
          SELECT 1 FROM apple_periods AS previous
          WHERE previous.subject_id = period.subject_id
            AND previous.purchased_at <= period.purchased_at AND previous.price IS NULL
        ) THEN CASE WHEN EXISTS (
          SELECT 1 FROM apple_periods AS previous
          WHERE previous.subject_id = period.subject_id AND previous.price > 0
            AND (previous.purchased_at, previous.transaction_id) < (period.purchased_at, period.transaction_id)
        ) THEN 'recurring' ELSE 'first' END ELSE 'unclassified' END
    END AS series,
    period.native_reason = 'PURCHASE' AS native_purchase
  FROM apple_periods AS period
  WHERE period.price > 0 OR (period.is_trial AND period.price = 0)
), google_periods AS (
  SELECT orders.order_id, orders.subject_id,
    regexp_replace(orders.order_id, '\\.\\.[0-9]+$', '') AS root_id,
    CASE WHEN orders.order_id ~ '\\.\\.[0-9]+$'
      THEN substring(orders.order_id FROM '\\.\\.([0-9]+)$')::bigint ELSE -1 END AS period_index,
    (orders.native_fields->'orderHistory'->'processedEvent'->>'eventTime')::timestamptz AS paid_at,
    CASE WHEN orders.native_fields ? 'total' THEN
      COALESCE((orders.native_fields->'total'->>'units')::numeric, 0)
        + COALESCE((orders.native_fields->'total'->>'nanos')::numeric, 0) / 1000000000 END AS amount,
    trial.trial_at
  FROM billing.google_orders AS orders
  LEFT JOIN LATERAL (
    SELECT MIN((item->'subscriptionDetails'->>'servicePeriodStartTime')::timestamptz) AS trial_at
    FROM jsonb_array_elements(orders.native_fields->'lineItems') AS item
    WHERE item->'subscriptionDetails'->>'offerPhase' = 'FREE_TRIAL'
      OR item->'subscriptionDetails'->'offerPhaseDetails' ? 'freeTrialDetails'
  ) AS trial ON true
  WHERE orders.environment = 'production'
    AND EXISTS (SELECT 1 FROM jsonb_array_elements(orders.native_fields->'lineItems') AS item
      WHERE item ? 'subscriptionDetails')
), google_events AS (
  SELECT 'google'::text AS provider, subject_id, trial_at AS event_at, 'trial'::text AS series, false AS native_purchase
  FROM (
    SELECT root_id, subject_id, MIN(trial_at) AS trial_at
    FROM google_periods WHERE trial_at IS NOT NULL AND amount = 0
    GROUP BY root_id, subject_id
  ) AS trials
  UNION ALL
  SELECT 'google', period.subject_id, period.paid_at,
    CASE WHEN (
      SELECT COUNT(*) FROM google_periods AS previous
      WHERE previous.root_id = period.root_id AND previous.subject_id = period.subject_id
        AND previous.period_index BETWEEN -1 AND period.period_index
        AND ((previous.amount = 0 AND (previous.paid_at IS NOT NULL OR previous.trial_at IS NOT NULL))
          OR (previous.amount > 0 AND previous.paid_at IS NOT NULL))
    ) = period.period_index + 2 THEN CASE WHEN EXISTS (
      SELECT 1 FROM google_periods AS previous
      WHERE previous.root_id = period.root_id AND previous.subject_id = period.subject_id
        AND previous.amount > 0 AND previous.paid_at IS NOT NULL
        AND (previous.paid_at, previous.order_id) < (period.paid_at, period.order_id)
    ) THEN 'recurring' ELSE 'first' END ELSE 'unclassified' END,
    false
  FROM google_periods AS period WHERE period.amount > 0 AND period.paid_at IS NOT NULL
), stripe_paid_periods AS (
  SELECT payment.invoice_id, invoice.subscription_id, payment.subject_id,
    MIN(to_timestamp((payment.native_fields->'status_transitions'->>'paid_at')::double precision)) AS paid_at
  FROM billing.stripe_payments AS payment
  LEFT JOIN billing.stripe_invoices AS invoice
    ON payment.environment = invoice.environment AND payment.invoice_id = invoice.invoice_id
  WHERE payment.environment = 'production'
    AND payment.status = 'paid' AND (payment.native_fields->>'amount_paid')::numeric > 0
    AND payment.native_fields->'status_transitions'->>'paid_at' IS NOT NULL
    AND (invoice.invoice_id IS NULL OR invoice.subscription_id IS NOT NULL)
  GROUP BY payment.invoice_id, invoice.subscription_id, payment.subject_id
), stripe_events AS (
  SELECT 'stripe'::text AS provider, subject_id,
    to_timestamp((native_fields->>'trial_start')::double precision) AS event_at,
    'trial'::text AS series, false AS native_purchase
  FROM billing.stripe_subscriptions WHERE environment = 'production'
    AND native_fields->>'trial_start' IS NOT NULL
  UNION ALL
  SELECT 'stripe', period.subject_id, period.paid_at,
    CASE WHEN NOT EXISTS (
      SELECT 1 FROM (VALUES ('stripe_subscriptions'), ('stripe_invoices'), ('stripe_payments')) AS required(source)
      WHERE NOT EXISTS (
        SELECT 1 FROM history_runs AS run
        WHERE run.source = required.source AND run.scope_kind = 'provider' AND run.status = 'succeeded'
          AND run.covered_from <= '1970-01-01'::timestamptz AND run.covered_to > period.paid_at
      )
    ) AND EXISTS (
      SELECT 1 FROM billing.stripe_subscriptions AS subscription
      WHERE subscription.environment = 'production' AND subscription.subscription_id = period.subscription_id
    ) THEN CASE WHEN EXISTS (
      SELECT 1 FROM stripe_paid_periods AS previous
      WHERE previous.subscription_id = period.subscription_id
        AND (previous.paid_at, previous.invoice_id) < (period.paid_at, period.invoice_id)
    ) THEN 'recurring' ELSE 'first' END ELSE 'unclassified' END,
    false
  FROM stripe_paid_periods AS period
), payment_events AS (
  SELECT events.provider, events.event_at, events.series, events.native_purchase
  FROM (
    SELECT provider, subject_id, event_at, series, native_purchase FROM apple_events
    UNION ALL SELECT provider, subject_id, event_at, series, native_purchase FROM google_events
    UNION ALL SELECT provider, subject_id, event_at, series, native_purchase FROM stripe_events
  ) AS events
  JOIN billing.history_subjects AS subjects ON subjects.subject_id = events.subject_id
  WHERE subjects.environment = 'production'
${buildExcludedActorSqlLines("pg_catalog.lower(subjects.user_id)").join("\n")}
)`;
}

export function buildPaymentCoverageCtesSql(): string {
  // One supported provider scope per source is declared by the collectors. scope_hash is private.
  return `required_sources(provider, source) AS (
  VALUES ('apple', 'apple_transactions'), ('google', 'google_orders'),
    ('stripe', 'stripe_subscriptions'), ('stripe', 'stripe_invoices'),
    ('stripe', 'stripe_payments')
), latest_sources AS (
  SELECT required.provider, required.source, run.status, run.started_at, run.finished_at,
    run.requested_from, run.requested_to, run.covered_from, run.covered_to, run.failure_code
  FROM required_sources AS required
  LEFT JOIN LATERAL (
    SELECT status, started_at, finished_at, requested_from, requested_to,
      covered_from, covered_to, failure_code
    FROM billing.history_import_runs
    WHERE environment = 'production' AND scope_kind = 'provider' AND source = required.source
    ORDER BY started_at DESC, run_id DESC LIMIT 1
  ) AS run ON true
)`;
}
