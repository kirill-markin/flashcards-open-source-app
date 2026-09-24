-- Migration status: Current / additive.
-- Introduces: ai.usage_events, the append-only record of what one AI provider call actually consumed,
--   and ai.model_prices, the dated price dictionary those counters are read against. No money is
--   stored anywhere here on purpose: a cost report multiplies a row's raw counters by the price that
--   was in effect at its occurred_at, so a provider price change, or a price we entered wrongly, is
--   re-priced from the facts instead of being frozen into a number nobody can take apart later. That
--   is what auth.guest_ai_monthly_usage from db/migrations/0031_guest_ai_identity_and_quota.sql
--   cannot do: it keeps one weighted_tokens total per user-month, with the weights applied at write
--   time, so it cannot be re-priced, split by surface or attributed to a model. It keeps working
--   untouched by this migration; retiring it is separate later work.
-- Current guidance: nothing reads or writes either table yet, so until the writer exists
--   ai.usage_events stays empty. The writer and the monthly cap it feeds are later work, and so is the
--   account-deletion anonymisation that lets a usage row outlive the person it names:
--   anonymizeProductAnalyticsInExecutor in apps/backend/src/auth/accountDeletion.ts already anonymises
--   product analytics on deletion, but it does not cover ai.usage_events yet.
-- Current guidance: row level security is enabled on both tables, with one permissive policy for each
--   role and command that is actually granted, the shape db/migrations/0140_analytics_excluded_actors.sql
--   and db/migrations/0114_product_analytics_storage.sql use. Both tables are owned by the migration
--   role rather than by backend_app, so row level security with no policy would deny every row and
--   every insert to both roles whatever the grants said. The policies are unscoped on purpose, as on
--   the analytics fact tables: what reads usage is an aggregate over many rows rather than one
--   session's own data, and the privilege boundary is the grant. None of them loosens append-only:
--   ai.usage_events has no UPDATE or DELETE policy and no UPDATE or DELETE privilege.
-- Current guidance: append-only on ai.usage_events is enforced by the REVOKE below, not by the narrow
--   GRANT beside it. db/migrations/0032_ai_chat_sessions.sql left ALTER DEFAULT PRIVILEGES IN SCHEMA
--   ai granting backend_app SELECT, INSERT, UPDATE and DELETE on every table the migration role
--   creates in this schema, so a new ai table arrives fully writable and the two privileges have to be
--   taken back explicitly.
-- Current guidance: one row is one provider call, never one chat turn and never one user action. A
--   chat turn runs a tool loop of many model calls, an image tool retries, and every one of those is
--   billed separately. Per-call rows are also what keeps a tiered price reconstructible: a provider
--   that charges a higher rate above a per-request input size can only be priced from the individual
--   call that crossed the threshold, not from a monthly total. request_id is therefore not unique and
--   carries no constraint.
-- Current guidance: ai.model_prices ships empty on purpose and is filled by later migrations. An empty
--   table means every cost report returns nothing. It never means usage went unrecorded, because
--   ai.usage_events is written without consulting it.
-- Schemas touched/read explicitly: ai.
-- See also: db/migrations/0066_reporting_readonly_operational_analytics.sql,
--   db/migrations/0032_ai_chat_sessions.sql, db/migrations/0031_guest_ai_identity_and_quota.sql,
--   db/migrations/0034_guest_upgrade_history.sql, apps/backend/src/guestAiQuota/index.ts.

CREATE TABLE ai.usage_events (
  usage_event_id     UUID        PRIMARY KEY,
  user_id            TEXT        NOT NULL,
  workspace_id       UUID,
  occurred_at        TIMESTAMPTZ NOT NULL,
  surface            TEXT        NOT NULL,
  provider           TEXT        NOT NULL,
  model_id           TEXT        NOT NULL,
  request_id         TEXT,
  tier_at_call       TEXT        NOT NULL,
  input_tokens       BIGINT,
  output_tokens      BIGINT,
  cache_read_tokens  BIGINT,
  cache_write_tokens BIGINT,
  reasoning_tokens   BIGINT,
  audio_seconds      NUMERIC,
  image_count        INTEGER,
  image_size         TEXT,
  image_quality      TEXT,
  CONSTRAINT usage_events_surface_valid CHECK (
    surface IN ('chat', 'dictation', 'card_image', 'composer_suggestion')
  ),
  CONSTRAINT usage_events_counters_non_negative CHECK (
    input_tokens >= 0
    AND output_tokens >= 0
    AND cache_read_tokens >= 0
    AND cache_write_tokens >= 0
    AND reasoning_tokens >= 0
    AND audio_seconds >= 0
    AND image_count >= 0
  )
);

-- The index the monthly cap sum reads: one person, one month of rows.
CREATE INDEX idx_ai_usage_events_user_occurred
  ON ai.usage_events(user_id, occurred_at);

COMMENT ON TABLE ai.usage_events IS
  'Append-only record of one AI provider call and what it consumed. No row is ever updated or deleted: '
  'the counters are the facts, and money is produced at analysis time by multiplying them by the '
  'ai.model_prices row in effect at occurred_at, so a provider price change or a corrected price '
  're-prices history instead of rewriting it. Every counter is nullable because no surface reports all '
  'of them, and every counter is raw: nothing here is weighted, rounded into a quota unit or converted '
  'to currency, because each of those throws away the number a later question needs. One row is one '
  'provider call, so a chat turn that loops over many model calls, and an image call that was retried, '
  'each produce several rows. No foreign key to org.user_settings on purpose: these rows have to '
  'outlive the account they name, so account deletion anonymises them rather than cascading them away. '
  'db/migrations/0034_guest_upgrade_history.sql stores its ids without live-row foreign keys for the '
  'same reason. Row level security is enabled, and the only policies are permissive reads plus the one '
  'insert backend_app is granted: nothing may rewrite or remove a row here.';

COMMENT ON COLUMN ai.usage_events.usage_event_id IS
  'Writer-generated id, and the idempotency key a retried write must reuse so one provider call is '
  'never counted twice.';
COMMENT ON COLUMN ai.usage_events.user_id IS
  'Person the call is billed to, as plain text and with no foreign key, so the row outlives the account.';
COMMENT ON COLUMN ai.usage_events.workspace_id IS
  'Workspace the call was made in, or NULL where the surface has none. No foreign key, for the reason '
  'the table comment gives.';
COMMENT ON COLUMN ai.usage_events.occurred_at IS
  'When the provider call happened. This is the instant a price window is matched against and the '
  'column a monthly cap sums over, so it is the call time and not the time the row was written.';
COMMENT ON COLUMN ai.usage_events.surface IS
  'Which product surface spent the money. The vocabulary is fixed here rather than left open because an '
  'unrecognised surface would be spend nobody can attribute; a new surface is a migration.';
COMMENT ON COLUMN ai.usage_events.provider IS
  'Provider that billed the call. Half of the lookup key into ai.model_prices, kept per row because the '
  'same model reached through a different provider is a different price.';
COMMENT ON COLUMN ai.usage_events.model_id IS
  'Provider model id exactly as it was called, not a family or a friendly name. The other half of the '
  'price key: one surface routes between models at different rates, so the id has to be on the row.';
COMMENT ON COLUMN ai.usage_events.request_id IS
  'Request id the call was made under, for correlating a cost row with backend logs and error reports. '
  'Not unique: one request can make many provider calls, each with its own row here.';
COMMENT ON COLUMN ai.usage_events.tier_at_call IS
  'Plan tier the person was on at the moment of the call. It is stored because it cannot be '
  'reconstructed afterwards: a tier change overwrites the current state, so "what did free users cost '
  'us last month" is unanswerable unless every row carries the tier it actually ran under. Free text '
  'with no foreign key, so a renamed or retired tier keeps naming what was true then.';
COMMENT ON COLUMN ai.usage_events.input_tokens IS
  'Input tokens the provider counted, stored raw. Where a provider bills audio input as tokens, those '
  'tokens belong here and audio_seconds keeps the duration beside them.';
COMMENT ON COLUMN ai.usage_events.output_tokens IS
  'Output tokens the provider counted, stored raw, including any reasoning tokens the provider already '
  'counts inside them.';
COMMENT ON COLUMN ai.usage_events.cache_read_tokens IS
  'Input tokens served from a prompt cache, which a provider usually prices below fresh input. Whether '
  'they are also included in input_tokens is the provider convention, not ours: the OpenAI Responses '
  'API this repository calls today reports cached tokens as a breakdown of input_tokens, so pricing '
  'both in full double-counts them. A writer for another provider records which convention its numbers '
  'follow.';
COMMENT ON COLUMN ai.usage_events.cache_write_tokens IS
  'Input tokens billed for populating a prompt cache, where a provider charges for that. It stays NULL '
  'for the OpenAI calls this repository makes today: their automatic prompt caching discounts reads and '
  'bills nothing to write. The column exists so a provider that does charge for cache writes needs no '
  'migration.';
COMMENT ON COLUMN ai.usage_events.reasoning_tokens IS
  'Reasoning tokens, recorded as a breakdown and not as an addition: on the OpenAI Responses API this '
  'repository calls they are already part of output_tokens, so a cost query that prices both '
  'double-counts them.';
COMMENT ON COLUMN ai.usage_events.audio_seconds IS
  'Seconds of audio the call consumed, NUMERIC because a recording is not whole seconds. Where a '
  'provider bills audio as tokens instead of time, the tokens go in input_tokens and this column keeps '
  'the duration, which is what a published per-minute price is quoted against.';
COMMENT ON COLUMN ai.usage_events.image_count IS
  'Images the call returned, which is what an image provider bills for. A retry that produced an image '
  'is its own provider call and therefore its own row, not a higher count here.';
COMMENT ON COLUMN ai.usage_events.image_size IS
  'Image dimensions as the provider names them, for example 1024x1024. A price selector rather than a '
  'quantity: the same single image costs different money at a different size, so the value has to '
  'survive on the row for it to be priceable at all.';
COMMENT ON COLUMN ai.usage_events.image_quality IS
  'Image quality as the provider names it. A price selector like image_size, and for the same reason.';

ALTER TABLE ai.usage_events ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT ON TABLE ai.usage_events TO backend_app;

-- 0032's ALTER DEFAULT PRIVILEGES IN SCHEMA ai already handed backend_app all four privileges on this
-- table when it was created above, so append-only exists only once these two are taken back.
REVOKE UPDATE, DELETE ON TABLE ai.usage_events FROM backend_app;

-- One policy per granted command, so the append-only shape holds at both layers.
CREATE POLICY usage_events_backend_select
  ON ai.usage_events
  FOR SELECT
  TO backend_app
  USING (true);

CREATE POLICY usage_events_backend_insert
  ON ai.usage_events
  FOR INSERT
  TO backend_app
  WITH CHECK (true);

CREATE TABLE ai.model_prices (
  provider       TEXT        NOT NULL,
  model_id       TEXT        NOT NULL,
  unit_kind      TEXT        NOT NULL,
  unit_price_usd NUMERIC     NOT NULL,
  unit_amount    INTEGER     NOT NULL,
  effective_from TIMESTAMPTZ NOT NULL,
  effective_to   TIMESTAMPTZ,
  PRIMARY KEY (provider, model_id, unit_kind, effective_from),
  CONSTRAINT model_prices_unit_price_non_negative CHECK (unit_price_usd >= 0),
  CONSTRAINT model_prices_unit_amount_positive CHECK (unit_amount > 0),
  CONSTRAINT model_prices_effective_window_ordered CHECK (
    effective_to IS NULL
    OR effective_to > effective_from
  )
);

-- Keeps one open price window per priced unit. What this does and does not guarantee, and how a price
-- migration has to be written because of it, is in the table comment below.
CREATE UNIQUE INDEX model_prices_single_open_window
  ON ai.model_prices (provider, model_id, unit_kind)
  WHERE effective_to IS NULL;

COMMENT ON TABLE ai.model_prices IS
  'Dated price dictionary: what one provider charged for one unit of one ai.usage_events counter '
  'between effective_from and effective_to. It ships empty on purpose and is filled by later '
  'migrations. An empty table means every cost report returns nothing; it never means usage went '
  'unrecorded, because ai.usage_events is written without consulting this table. Rows are added, not '
  'edited: a price change closes the current row with effective_to and inserts a new one, so a report '
  'over an earlier month keeps that month''s price. The unique index model_prices_single_open_window '
  'guarantees at most one open window per provider, model_id and unit_kind, which the primary key alone '
  'would not, because it only forbids a duplicate effective_from. Every other overlap is unchecked: any '
  'pair in which at least one window is closed may still cover the same instant, so a cost query can '
  'match two price rows for one fact. An exclusion constraint would reject those, but btree_gist is not '
  'installed. The index is enforced immediately, row by row, and cannot be deferred - a partial unique '
  'index cannot be declared as a constraint at all - so entering a new price is two statements: UPDATE '
  'the open row''s effective_to, then INSERT the new open row. One statement that does both can fail on '
  'this index, because the order inside a statement is not defined. The first price a model ever gets '
  'has no row to close, and that UPDATE simply matches nothing. A price that depends on more than the '
  'provider, the model and the unit - an image size and quality, or a per-request input-size tier - is '
  'not keyed by that here. The migration that enters such a price decides whether to name the variant in '
  'unit_kind or add a key column, and the facts already carry image_size, image_quality and the per-call '
  'counter it would have to read; unit_kind therefore carries no CHECK constraint, so that choice stays '
  'open.';

COMMENT ON COLUMN ai.model_prices.provider IS
  'Provider this price belongs to, matching ai.usage_events.provider exactly as the writer stored it.';
COMMENT ON COLUMN ai.model_prices.model_id IS
  'Provider model id this price belongs to, matching ai.usage_events.model_id exactly as it was called.';
COMMENT ON COLUMN ai.model_prices.unit_kind IS
  'Name of the ai.usage_events counter column this price applies to, for example input_tokens or '
  'image_count. Deliberately unconstrained; see the table comment.';
COMMENT ON COLUMN ai.model_prices.unit_price_usd IS
  'Price in US dollars for unit_amount units. NUMERIC and never floating point, because this is money '
  'and a published price has exact digits.';
COMMENT ON COLUMN ai.model_prices.unit_amount IS
  'How many units unit_price_usd covers: 1000000 for a per-million-token price, 1 for a per-image one. '
  'Kept as published rather than normalised to a single unit, so a price can be checked against the '
  'provider page it was copied from without arithmetic.';
COMMENT ON COLUMN ai.model_prices.effective_from IS
  'Inclusive start of the window this price applies to, compared against ai.usage_events.occurred_at.';
COMMENT ON COLUMN ai.model_prices.effective_to IS
  'Exclusive end of the window, or NULL while this is the current price.';

ALTER TABLE ai.model_prices ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON TABLE ai.model_prices TO backend_app;

-- The same 0032 default privileges apply here: a price is entered by migration, never by the backend.
REVOKE INSERT, UPDATE, DELETE ON TABLE ai.model_prices FROM backend_app;

CREATE POLICY model_prices_backend_select
  ON ai.model_prices
  FOR SELECT
  TO backend_app
  USING (true);

-- 0066 revoked schema-wide SELECT and the ai default privileges for reporting_readonly, so both new
-- tables are invisible to reporting until their columns are named here.
GRANT SELECT (
  usage_event_id,
  user_id,
  workspace_id,
  occurred_at,
  surface,
  provider,
  model_id,
  request_id,
  tier_at_call,
  input_tokens,
  output_tokens,
  cache_read_tokens,
  cache_write_tokens,
  reasoning_tokens,
  audio_seconds,
  image_count,
  image_size,
  image_quality
) ON TABLE ai.usage_events TO reporting_readonly;

GRANT SELECT (
  provider,
  model_id,
  unit_kind,
  unit_price_usd,
  unit_amount,
  effective_from,
  effective_to
) ON TABLE ai.model_prices TO reporting_readonly;

CREATE POLICY usage_events_reporting_readonly_select
  ON ai.usage_events
  FOR SELECT
  TO reporting_readonly
  USING (true);

CREATE POLICY model_prices_reporting_readonly_select
  ON ai.model_prices
  FOR SELECT
  TO reporting_readonly
  USING (true);
