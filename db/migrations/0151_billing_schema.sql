-- Migration status: Current / additive.
-- Introduces: the billing schema and five tables. billing.provider_events keeps every store and
--   payment notification exactly as it arrived, billing.purchases keeps one row per provider-side
--   purchase, billing.grants keeps entitlements handed out by an operator, billing.user_billing_state
--   keeps the durable per-person billing facts, and billing.entitlement_snapshots is the derived
--   entitlement cache. No code path reads or writes any of them in this migration: it creates the
--   storage so that the webhook, resolver, metering and admin work that follows has somewhere to
--   write.
-- Current guidance: identifiers here are stored without foreign keys to org.user_settings, which is
--   the precedent db/migrations/0034_guest_upgrade_history.sql records. A row outliving the account
--   named in it is the point rather than an accident: the provider side of a purchase does not
--   disappear when the account does, a refund or a renewal can still arrive afterwards, and
--   billing.user_billing_state.ever_purchased_at is what keeps a paying person away from the guest
--   reaper once a purchase has been transferred to somebody else.
-- Current guidance: row-level security is enabled on all five tables and every table carries an
--   explicit permissive policy for each role that must reach it. Those policies are load-bearing,
--   not decoration. The migration role owns these tables, so backend_app and reporting_readonly are
--   both subject to row-level security, and an RLS-enabled table with no policy returns no rows and
--   accepts no write from them however wide the column grants are. The policies are unrestricted on
--   purpose: these rows are keyed by person, but they are written by provider callbacks, scheduled
--   reconciliation and operator actions that run outside any request carrying
--   security.current_user_id(), so the per-person predicates used in org and content cannot apply
--   here. Access is narrowed by the grants and by the column lists below instead.
-- Current guidance: closed vocabularies are TEXT with a CHECK constraint rather than enum types,
--   matching the rest of db/migrations, because widening a CHECK is an ALTER in a later migration
--   with no type-catalog surgery. These columns are deliberately left unconstrained:
--   purchases.tier, grants.tier, and tier, status and source on entitlement_snapshots. The tier
--   catalogue and the resolver that fills the snapshot own those names, they are not in this
--   migration, and a CHECK written here would guess them and then cost a whole migration per
--   correction. The later migration that constrains the tier vocabulary has to cover purchases.tier
--   and grants.tier together, because both name the same catalogue.
-- Current guidance: reporting_readonly reads billing.purchases, billing.grants and
--   billing.user_billing_state through named column lists, and reads nothing else in this schema.
--   Store transaction identifiers are not withheld: support and reconciliation have to be able to
--   name the purchase a provider is talking about, which is why purchases.provider_purchase_id and
--   purchases.linked_from_purchase_id are granted. What is withheld is verbatim provider input and
--   the per-person attribution keys. billing.provider_events is withheld in full because payload_raw
--   is exactly that input and can carry signed tokens and buyer detail no report needs. The
--   provider-side account handles on billing.user_billing_state are withheld because they are the
--   values a notification is attributed by, so they are credential-shaped rather than descriptive
--   and a report names a person by user_id instead. billing.entitlement_snapshots is
--   withheld because it is a cache: a report that reads it would report whatever the cache last
--   happened to hold instead of deriving the answer from the purchase and grant rows, and the cache
--   may be truncated at any time. Adding a later column grant here is a one-line migration, which is
--   how db/migrations/0150_reporting_readonly_guest_product_analytics.sql added one.
-- Current guidance: no privilege in this schema is granted to auth_app. Everything billing needs
--   today runs in the backend service. Whatever account-lifecycle work later needs to reach these
--   tables from the auth service grants exactly what it uses in its own migration.
-- Schemas touched/read explicitly: billing.
-- See also: db/migrations/0034_guest_upgrade_history.sql,
--   db/migrations/0114_product_analytics_storage.sql, db/migrations/0137_audience_context.sql,
--   db/migrations/0066_reporting_readonly_operational_analytics.sql,
--   db/migrations/0044_reporting_readonly_role.sql, db/migrations/0024_auth_runtime_roles.sql,
--   docs/architecture.md.

CREATE SCHEMA IF NOT EXISTS billing;

COMMENT ON SCHEMA billing IS
  'Purchases, operator grants, per-person billing state and the derived entitlement cache, together '
  'with the raw provider notifications all of it is reconstructed from. Reachable from the backend '
  'service only, plus a narrow column-level read for reporting.';

CREATE TABLE IF NOT EXISTS billing.provider_events (
  provider             TEXT        NOT NULL,
  event_id             TEXT        NOT NULL,
  event_type           TEXT,
  occurred_at          TIMESTAMPTZ,
  received_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  payload_raw          TEXT        NOT NULL,
  payload              JSONB,
  user_id              TEXT,
  provider_purchase_id TEXT,
  environment          TEXT,
  processed_at         TIMESTAMPTZ,
  processing_error     TEXT,
  CONSTRAINT provider_events_pkey PRIMARY KEY (provider, event_id),
  CONSTRAINT provider_events_provider_valid CHECK (
    provider IN ('apple', 'google', 'stripe')
  ),
  CONSTRAINT provider_events_environment_valid CHECK (
    environment IN ('production', 'sandbox')
  )
);

COMMENT ON TABLE billing.provider_events IS
  'Every store and payment-provider notification, stored as received and processed afterwards. '
  'The primary key (provider, event_id) is the idempotency key: a provider that redelivers a '
  'notification, and every provider does, collides here instead of being handled twice. The row is '
  'therefore written as soon as the provider delivery id can be read and before any business logic '
  'runs, which is not the same point for every provider: the Pub/Sub messageId for Google and '
  'event.id for Stripe are in the envelope, so the insert is the first step of handling, while '
  'notificationUUID for Apple is inside the signed payload, so the JWS is decoded and verified first '
  'and the insert is the first step after that. Nothing may synthesize an event_id to insert '
  'earlier: a redelivery would carry a different synthetic id and be handled twice, which is the one '
  'thing this key exists to prevent. The columns taken from the decoded payload stay nullable '
  'because for Google and Stripe the insert precedes the decode, which is why so few are NOT NULL. '
  'This table is the audit trail and the replay source for everything else in the schema, so rows '
  'are kept after processing rather than consumed.';
COMMENT ON COLUMN billing.provider_events.provider IS
  'Which provider sent the notification. Part of the idempotency key because event ids are only '
  'unique within one provider.';
COMMENT ON COLUMN billing.provider_events.event_id IS
  'The id the provider itself gives this delivery: notificationUUID for Apple, the Pub/Sub messageId '
  'for Google, event.id for Stripe. Never a value of ours, so a redelivery carries the same one.';
COMMENT ON COLUMN billing.provider_events.event_type IS
  'Provider notification type as sent, kept in provider spelling rather than mapped. NULL until the '
  'payload has been decoded, which for Apple means verifying a JWS.';
COMMENT ON COLUMN billing.provider_events.occurred_at IS
  'When the provider says the event happened. NULL when the provider does not supply it or the '
  'payload has not been decoded yet. Use received_at for anything that must be monotonic.';
COMMENT ON COLUMN billing.provider_events.received_at IS
  'When this row was written, which is the one timestamp here that is always set and always ours.';
COMMENT ON COLUMN billing.provider_events.payload_raw IS
  'The exact bytes as received, unparsed and unformatted. Signature verification needs them: Stripe '
  'signs the byte string and Apple sends a JWS whose signature covers its own encoding, so a '
  'reserialized payload cannot be verified again. Withheld from reporting.';
COMMENT ON COLUMN billing.provider_events.payload IS
  'The decoded notification, for querying. NULL while payload_raw has not been decoded or could not '
  'be. Never the verification input; payload_raw is.';
COMMENT ON COLUMN billing.provider_events.user_id IS
  'The person this notification turned out to concern, once known. NULL is ordinary: most providers '
  'identify the purchase and not the buyer, so the person is resolved through the purchase.';
COMMENT ON COLUMN billing.provider_events.provider_purchase_id IS
  'The provider-side purchase this notification concerns, once known, matching '
  'billing.purchases.provider_purchase_id.';
COMMENT ON COLUMN billing.provider_events.environment IS
  'Whether the notification came from the live or the test side of the provider. NULL until decoded. '
  'A sandbox notification must never be allowed to change a production purchase, which is why the '
  'value is stored beside the event rather than inferred at read time.';
COMMENT ON COLUMN billing.provider_events.processed_at IS
  'When handling finished. NULL means unprocessed or still in flight, so the pair of this column and '
  'processing_error is the whole state machine: unprocessed, failed, or done.';
COMMENT ON COLUMN billing.provider_events.processing_error IS
  'Why the last handling attempt failed, kept so a failure is visible here instead of only in logs. '
  'A later successful attempt sets processed_at; this column is not cleared as a matter of course, so '
  'read it together with processed_at rather than on its own.';

-- The unprocessed queue and the per-purchase replay lookup are the two reads the comments above
-- define, over a table that grows forever and is never pruned, so both get an index instead of a
-- sequential scan of the whole audit trail. Both are partial: unprocessed rows are a small tail of
-- an ever-growing table, and provider_purchase_id is NULL until the purchase is resolved, which for
-- Google and Stripe is every row at insert time, while an Apple row is inserted after its payload
-- has been decoded and can already carry the originalTransactionId.
CREATE INDEX IF NOT EXISTS idx_provider_events_unprocessed
  ON billing.provider_events (received_at)
  WHERE processed_at IS NULL;

-- The lookup column list is the same triple billing.purchases is unique on, because environment is
-- part of a purchase identity here and the replay lookup is always for one purchase: the two sides of
-- a provider issue identifiers independently and may collide, so provider and purchase id alone can
-- name two different purchases.
CREATE INDEX IF NOT EXISTS idx_provider_events_provider_purchase
  ON billing.provider_events (provider, provider_purchase_id, environment)
  WHERE provider_purchase_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS billing.purchases (
  purchase_id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  provider                TEXT        NOT NULL,
  provider_purchase_id    TEXT        NOT NULL,
  kind                    TEXT        NOT NULL,
  user_id                 TEXT,
  previous_user_id        TEXT,
  tier                    TEXT        NOT NULL,
  status                  TEXT        NOT NULL,
  is_trial                BOOLEAN     NOT NULL DEFAULT FALSE,
  will_renew              BOOLEAN     NOT NULL DEFAULT FALSE,
  until                   TIMESTAMPTZ,
  grace_until             TIMESTAMPTZ,
  provider_status_raw     TEXT,
  environment             TEXT        NOT NULL,
  linked_from_purchase_id TEXT,
  invalidated_at          TIMESTAMPTZ,
  account_deleted_at      TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT purchases_provider_valid CHECK (
    provider IN ('apple', 'google', 'stripe')
  ),
  CONSTRAINT purchases_kind_valid CHECK (
    kind IN ('subscription', 'one_time')
  ),
  CONSTRAINT purchases_status_valid CHECK (
    status IN ('active', 'in_grace', 'expired', 'revoked')
  ),
  CONSTRAINT purchases_environment_valid CHECK (
    environment IN ('production', 'sandbox')
  ),
  CONSTRAINT purchases_provider_identity_unique UNIQUE (provider, provider_purchase_id, environment)
);

COMMENT ON TABLE billing.purchases IS
  'One row per purchase held on a provider, kept as our reading of the provider state rather than as '
  'a decision about what anybody is entitled to. Deliberately without a constraint limiting a person '
  'to one active purchase: two active purchases on one person is a supported state, reached by buying '
  'on two stores or by a transfer, and rejecting the second write would lose a purchase somebody paid '
  'for. The resolver decides which one wins; this table records both.';
COMMENT ON COLUMN billing.purchases.purchase_id IS
  'Our own identifier for the row, so other tables and logs can name a purchase without repeating a '
  'provider identifier.';
COMMENT ON COLUMN billing.purchases.provider IS
  'Which store or payment provider holds this purchase. Part of the uniqueness constraint because a '
  'provider-side identifier means nothing without the provider that issued it.';
COMMENT ON COLUMN billing.purchases.provider_purchase_id IS
  'The identifier the provider uses: the originalTransactionId for Apple, the purchase token for '
  'Google, the subscription or payment-intent id for Stripe.';
COMMENT ON COLUMN billing.purchases.kind IS
  'Whether the purchase renews on its own or was bought once. A one_time row carries FALSE in '
  'will_renew and normally leaves until NULL.';
COMMENT ON COLUMN billing.purchases.user_id IS
  'The person this purchase currently belongs to. NULL is a real and expected state: a purchase can '
  'reach us before it can be attributed, and it must be stored anyway so the money is not lost track '
  'of. Stored without a foreign key so the row survives deletion of that account.';
COMMENT ON COLUMN billing.purchases.previous_user_id IS
  'The person this purchase belonged to before it was last transferred, kept so a transfer can be '
  'traced and disputed. Only the previous holder, not a full chain.';
COMMENT ON COLUMN billing.purchases.tier IS
  'The tier this purchase pays for, as named by the tier catalogue. Intentionally not constrained '
  'here: the catalogue is not in this migration, and a CHECK would have to guess it.';
COMMENT ON COLUMN billing.purchases.status IS
  'Our normalized reading of the provider state. in_grace means the provider is retrying payment and '
  'access is still owed; revoked means the provider took the purchase back, through a refund or a '
  'chargeback, and access is not owed even if until is still in the future.';
COMMENT ON COLUMN billing.purchases.is_trial IS
  'Whether the current period is a trial the person is not paying for. NOT NULL with a FALSE default '
  'on purpose: a third state here would be read as a trial in some branches and not in others.';
COMMENT ON COLUMN billing.purchases.will_renew IS
  'Whether the provider says it intends to charge again at the end of the current period. FALSE also '
  'covers a subscription that is cancelled but still paid for until it lapses, which is exactly what '
  'until is for. NOT NULL with a FALSE default for the same reason as is_trial.';
COMMENT ON COLUMN billing.purchases.until IS
  'End of the period already paid for. Access is owed up to here whatever will_renew says. NULL for a '
  'purchase with no period, so a NULL is not an expiry.';
COMMENT ON COLUMN billing.purchases.grace_until IS
  'How long access stays owed while the provider retries a failed payment. Separate from until '
  'because grace is not paid for and reporting on paid time must be able to exclude it.';
COMMENT ON COLUMN billing.purchases.provider_status_raw IS
  'The provider status string exactly as received, kept so a wrong reading in status can be diagnosed '
  'against what the provider actually said.';
COMMENT ON COLUMN billing.purchases.environment IS
  'Live or test side of the provider. Part of the uniqueness constraint because the two sides issue '
  'identifiers independently and may collide, and NOT NULL because a NULL in a unique key would let '
  'the same purchase be stored twice.';
COMMENT ON COLUMN billing.purchases.linked_from_purchase_id IS
  'The provider-side identifier this purchase replaced, not a purchase_id of ours, which is why it is '
  'TEXT and carries no foreign key. Google chains purchase tokens on an upgrade, downgrade or '
  'resignup: the new token names the token it supersedes, and only that chain shows that two rows are '
  'one continuing subscription rather than two purchases.';
COMMENT ON COLUMN billing.purchases.invalidated_at IS
  'When this purchase was superseded by another one naming it in linked_from_purchase_id. The row is '
  'kept rather than deleted, because the provider can still send notifications about a token it has '
  'already replaced.';
COMMENT ON COLUMN billing.purchases.account_deleted_at IS
  'When the account this purchase belonged to was deleted. The row deliberately outlives it: the '
  'purchase still exists on the provider, can still renew or be refunded, and can still be '
  'transferred to another account, none of which we could handle from a deleted row.';
COMMENT ON COLUMN billing.purchases.created_at IS
  'When we first stored this purchase, which is not when it was bought: a purchase already running '
  'can reach us later, and until and occurred_at on the events are the provider timeline.';
COMMENT ON COLUMN billing.purchases.updated_at IS
  'When we last rewrote this row from provider input.';

CREATE INDEX IF NOT EXISTS idx_purchases_user_status
  ON billing.purchases(user_id, status);

CREATE TABLE IF NOT EXISTS billing.grants (
  grant_id   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    TEXT        NOT NULL,
  tier       TEXT        NOT NULL,
  source     TEXT        NOT NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  reason     TEXT        NOT NULL,
  revoked_at TIMESTAMPTZ,
  CONSTRAINT grants_source_valid CHECK (
    source IN ('admin_grant', 'gift')
  ),
  CONSTRAINT grants_expires_after_granted CHECK (
    expires_at IS NULL OR expires_at >= granted_at
  ),
  CONSTRAINT grants_revoked_after_granted CHECK (
    revoked_at IS NULL OR revoked_at >= granted_at
  )
);

COMMENT ON TABLE billing.grants IS
  'Entitlements given to a person without a payment: an operator grant or a gift. A grant stands on '
  'its own beside any purchase rather than modifying one, so withdrawing it cannot disturb something '
  'that was paid for. Rows are kept and marked revoked instead of deleted, because who gave what to '
  'whom, and why, is the whole value of the table.';
COMMENT ON COLUMN billing.grants.grant_id IS
  'Identifier for one grant. Grants are separate rows rather than a single state per person, so one '
  'person can hold several at once and each can be revoked on its own.';
COMMENT ON COLUMN billing.grants.user_id IS
  'The person the grant is for, stored without a foreign key so the record survives deletion of that '
  'account.';
COMMENT ON COLUMN billing.grants.tier IS
  'The tier granted, as named by the tier catalogue. Unconstrained here for the same reason as '
  'billing.purchases.tier.';
COMMENT ON COLUMN billing.grants.source IS
  'Why the grant exists: admin_grant for an operator decision such as support or compensation, gift '
  'for one person paying for another.';
COMMENT ON COLUMN billing.grants.granted_at IS
  'When the grant starts applying, which is also when it was recorded. The grant confers its tier from '
  'here until expires_at, or until revoked_at when that comes first.';
COMMENT ON COLUMN billing.grants.expires_at IS
  'When the grant stops applying. NULL means it never does, which is how a lifetime grant is stored, '
  'so a NULL here must not be read as already expired. A CHECK keeps it at or after granted_at, '
  'because a grant that expires before it starts confers nothing and is a write mistake.';
COMMENT ON COLUMN billing.grants.reason IS
  'Why this grant was given, in the words of whoever gave it. NOT NULL because an unexplained '
  'entitlement cannot be reviewed afterwards; a grant is not blocked for want of a reason, it is '
  'required to carry one.';
COMMENT ON COLUMN billing.grants.revoked_at IS
  'When the grant was withdrawn. A revoked grant confers nothing from that moment and is kept for the '
  'record. A CHECK keeps it at or after granted_at, as '
  'auth.admin_users.admin_users_revoked_after_granted does on the same column pair, because a grant '
  'withdrawn before it was given is a write mistake rather than a state.';

CREATE INDEX IF NOT EXISTS idx_grants_user_granted
  ON billing.grants(user_id, granted_at DESC);

CREATE TABLE IF NOT EXISTS billing.user_billing_state (
  user_id                      TEXT        PRIMARY KEY,
  trial_consumed_at            TIMESTAMPTZ,
  trial_provider               TEXT,
  ever_purchased_at            TIMESTAMPTZ,
  stripe_customer_id           TEXT,
  apple_app_account_token      UUID,
  google_obfuscated_account_id TEXT,
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT user_billing_state_trial_provider_valid CHECK (
    trial_provider IN ('apple', 'google', 'stripe')
  ),
  CONSTRAINT user_billing_state_trial_shape CHECK (
    (trial_consumed_at IS NULL) = (trial_provider IS NULL)
  )
);

COMMENT ON TABLE billing.user_billing_state IS
  'The per-person billing facts that must remain true no matter what happens to the purchases. This '
  'row is the durable one in the schema: it outlives the entitlement cache, and it outlives the '
  'purchase rows themselves, because a purchase can be transferred to somebody else while the facts '
  'about this person do not move with it. Nothing here is derived, so nothing here may be rebuilt '
  'from the other tables, and losing the row is not recoverable: it would offer a second free trial '
  'to somebody who has had one, and expose a paying person to the guest reaper. It carries no tier '
  'and no entitlement; what a person is entitled to is resolved from purchases and grants.';
COMMENT ON COLUMN billing.user_billing_state.user_id IS
  'The person these facts are about, stored without a foreign key so the row survives account '
  'deletion and guest cleanup, which is the entire reason it can be trusted.';
COMMENT ON COLUMN billing.user_billing_state.trial_consumed_at IS
  'When this person started the free trial they are allowed once. Set when the trial begins and not '
  'cleared when it ends, so it records that the one trial has been used rather than whether a trial '
  'is running now, which billing.purchases.is_trial answers.';
COMMENT ON COLUMN billing.user_billing_state.trial_provider IS
  'Which provider the consumed trial was started on, kept because each store enforces its own trial '
  'eligibility separately and disagreements between us and a store have to be traceable to one. A '
  'CHECK keeps this set exactly when trial_consumed_at is: naming the provider of a trial the row '
  'does not record as consumed says nothing, and a consumed trial with no provider cannot be '
  'reconciled against the store that granted it.';
COMMENT ON COLUMN billing.user_billing_state.ever_purchased_at IS
  'When this person first paid for anything. Never cleared and never recomputed from billing.purchases, '
  'because a transfer moves the purchase row away and a refund can remove it while the fact of having '
  'paid remains. This is what protects a paying person from the guest reaper.';
COMMENT ON COLUMN billing.user_billing_state.stripe_customer_id IS
  'The Stripe customer this person is billed as. Withheld from reporting for the same reason as the '
  'Apple and Google handles beside it: it is what a notification is attributed by, and a report '
  'names a person by user_id.';
COMMENT ON COLUMN billing.user_billing_state.apple_app_account_token IS
  'The opaque token we send to Apple with a purchase so Apple can hand it back on a notification. '
  'Ours, generated per person, and deliberately not the user id: it is the value that lets an Apple '
  'notification be attributed without exposing an identifier of ours to the store. Withheld from '
  'reporting.';
COMMENT ON COLUMN billing.user_billing_state.google_obfuscated_account_id IS
  'The obfuscated account identifier we give Google Play for the same purpose as '
  'apple_app_account_token. Withheld from reporting.';
COMMENT ON COLUMN billing.user_billing_state.created_at IS
  'When this row was first written, which is when the person first did anything billing-related, not '
  'when the account was created.';
COMMENT ON COLUMN billing.user_billing_state.updated_at IS
  'When any fact in this row last changed.';

-- These three handles exist for one access path: a provider notification arrives carrying one of
-- them and the person is looked up by it. Each therefore needs an index, because the table is keyed
-- only by user_id and the lookup would otherwise scan it, and each needs uniqueness, because two
-- rows holding the same handle would attribute a notification ambiguously and silently bill or
-- entitle the wrong person. Merging two people, as a guest upgrade does, is the obvious way to reach
-- that state. Partial on IS NOT NULL following
-- db/migrations/0117_guest_session_creation_idempotency.sql, since a person who has never bought on
-- a provider holds NULL there and most rows hold NULL in at least two of the three.
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_billing_state_stripe_customer
  ON billing.user_billing_state (stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_billing_state_apple_app_account_token
  ON billing.user_billing_state (apple_app_account_token)
  WHERE apple_app_account_token IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_billing_state_google_obfuscated_account
  ON billing.user_billing_state (google_obfuscated_account_id)
  WHERE google_obfuscated_account_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS billing.entitlement_snapshots (
  user_id     TEXT        PRIMARY KEY,
  tier        TEXT        NOT NULL,
  status      TEXT        NOT NULL,
  until       TIMESTAMPTZ,
  is_trial    BOOLEAN     NOT NULL DEFAULT FALSE,
  will_renew  BOOLEAN     NOT NULL DEFAULT FALSE,
  source      TEXT        NOT NULL,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE billing.entitlement_snapshots IS
  'A derived cache of the last resolved entitlement per person, held so a read does not have to '
  'resolve one. It is not the source of truth and nothing may treat it as one: every row here is '
  'reproducible from billing.purchases, billing.grants and billing.user_billing_state, and those '
  'tables win wherever they disagree with this one. The whole table is safe to TRUNCATE and rebuild, '
  'and a missing row means not yet computed rather than not entitled. It follows that nothing may '
  'write a fact here that exists nowhere else, and that no report may count from here: a decision '
  'that would be wrong after a truncate does not belong to this table.';
COMMENT ON COLUMN billing.entitlement_snapshots.user_id IS
  'The person this resolved entitlement is for. One row per person, replaced in place on each '
  'resolution.';
COMMENT ON COLUMN billing.entitlement_snapshots.tier IS
  'The resolved tier. Unconstrained, like status and source here, because the resolver that fills this '
  'table owns these vocabularies and is not in this migration.';
COMMENT ON COLUMN billing.entitlement_snapshots.status IS
  'The resolved state of that entitlement. Not a copy of billing.purchases.status: a resolution can '
  'draw on several purchases and grants, and it must also be able to express having nothing.';
COMMENT ON COLUMN billing.entitlement_snapshots.until IS
  'When the resolved entitlement lapses unless something changes, so a stale row can be recognized '
  'without resolving again. NULL where the entitlement has no end.';
COMMENT ON COLUMN billing.entitlement_snapshots.is_trial IS
  'Whether the resolved entitlement is currently a trial rather than something paid for.';
COMMENT ON COLUMN billing.entitlement_snapshots.will_renew IS
  'Whether the resolved entitlement is expected to continue past until on its own.';
COMMENT ON COLUMN billing.entitlement_snapshots.source IS
  'What the resolution rested on, so a surprising tier can be traced back to a purchase or a grant '
  'without recomputing it.';
COMMENT ON COLUMN billing.entitlement_snapshots.computed_at IS
  'When this row was resolved. It is the age of the cache entry and nothing else: it says nothing '
  'about when the underlying purchase or grant changed.';

ALTER TABLE billing.provider_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing.purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing.grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing.user_billing_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing.entitlement_snapshots ENABLE ROW LEVEL SECURITY;

GRANT USAGE ON SCHEMA billing TO backend_app;

-- The four durable tables carry no DELETE. Each of them is explicitly kept rather than consumed:
-- provider_events is the audit trail and the replay source, a superseded purchase is marked with
-- invalidated_at and a deleted account with account_deleted_at, a withdrawn grant is marked with
-- revoked_at, and losing a user_billing_state row is not recoverable at all. Account deletion
-- stamps these rows rather than removing them, so no caller needs the privilege today. Following
-- db/migrations/0140_analytics_excluded_actors.sql, which grants DELETE for one erasure path it
-- names by file, a DELETE here belongs to the migration that has a named caller for it.
GRANT SELECT, INSERT, UPDATE ON TABLE billing.provider_events TO backend_app;
GRANT SELECT, INSERT, UPDATE ON TABLE billing.purchases TO backend_app;
GRANT SELECT, INSERT, UPDATE ON TABLE billing.grants TO backend_app;
GRANT SELECT, INSERT, UPDATE ON TABLE billing.user_billing_state TO backend_app;

-- billing.entitlement_snapshots is the droppable one, so it gets both ways of emptying it: DELETE to
-- invalidate one person's cache entry, and TRUNCATE for the whole-table rebuild its table comment
-- promises. TRUNCATE is a privilege of its own and DELETE does not imply it, so without this line
-- that rebuild would fail at runtime with permission denied.
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON TABLE billing.entitlement_snapshots TO backend_app;

DROP POLICY IF EXISTS provider_events_backend ON billing.provider_events;
CREATE POLICY provider_events_backend ON billing.provider_events
  FOR ALL TO backend_app USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS purchases_backend ON billing.purchases;
CREATE POLICY purchases_backend ON billing.purchases
  FOR ALL TO backend_app USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS grants_backend ON billing.grants;
CREATE POLICY grants_backend ON billing.grants
  FOR ALL TO backend_app USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS user_billing_state_backend ON billing.user_billing_state;
CREATE POLICY user_billing_state_backend ON billing.user_billing_state
  FOR ALL TO backend_app USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS entitlement_snapshots_backend ON billing.entitlement_snapshots;
CREATE POLICY entitlement_snapshots_backend ON billing.entitlement_snapshots
  FOR ALL TO backend_app USING (true) WITH CHECK (true);

GRANT USAGE ON SCHEMA billing TO reporting_readonly;

REVOKE SELECT ON ALL TABLES IN SCHEMA billing FROM reporting_readonly;

ALTER DEFAULT PRIVILEGES IN SCHEMA billing
  REVOKE SELECT ON TABLES FROM reporting_readonly;

GRANT SELECT (
  purchase_id,
  provider,
  provider_purchase_id,
  kind,
  user_id,
  previous_user_id,
  tier,
  status,
  is_trial,
  will_renew,
  until,
  grace_until,
  provider_status_raw,
  environment,
  linked_from_purchase_id,
  invalidated_at,
  account_deleted_at,
  created_at,
  updated_at
) ON TABLE billing.purchases TO reporting_readonly;

GRANT SELECT (
  grant_id,
  user_id,
  tier,
  source,
  granted_at,
  expires_at,
  reason,
  revoked_at
) ON TABLE billing.grants TO reporting_readonly;

GRANT SELECT (
  user_id,
  trial_consumed_at,
  trial_provider,
  ever_purchased_at,
  created_at,
  updated_at
) ON TABLE billing.user_billing_state TO reporting_readonly;

DROP POLICY IF EXISTS purchases_reporting_readonly ON billing.purchases;
CREATE POLICY purchases_reporting_readonly ON billing.purchases
  FOR SELECT TO reporting_readonly USING (true);

DROP POLICY IF EXISTS grants_reporting_readonly ON billing.grants;
CREATE POLICY grants_reporting_readonly ON billing.grants
  FOR SELECT TO reporting_readonly USING (true);

DROP POLICY IF EXISTS user_billing_state_reporting_readonly ON billing.user_billing_state;
CREATE POLICY user_billing_state_reporting_readonly ON billing.user_billing_state
  FOR SELECT TO reporting_readonly USING (true);
