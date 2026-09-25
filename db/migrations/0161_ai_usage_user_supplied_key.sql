-- Migration status: Current / additive.
-- Introduces: ai.usage_events.user_supplied_key, which records whether a provider call was paid with an
--   API key the person supplied instead of the platform key. Every row already stored was paid with the
--   platform key, and the DEFAULT states exactly that for them: adding a column with a constant default
--   is a catalog change and rewrites no row.
-- Current guidance: the monthly AI allowance and the weighted-token total read by
--   apps/backend/src/aiUsage/cap.ts count only rows where this is false. A row where it is true is still
--   a fact about the product and is metered like any other; it is reported to the person beside the
--   allowance rather than against it.
-- Current guidance: backend_app's INSERT on ai.usage_events is table-wide
--   (db/migrations/0152_ai_usage_facts.sql), so the writer needs no new privilege. The UPDATE granted by
--   db/migrations/0154_ai_usage_identity_rewrites.sql is column-scoped to the three columns that name
--   somebody and does not reach this one, so the flag is as immutable as the counters.
-- Current guidance: 0152 granted reporting_readonly an explicit column list on this table, so a column
--   added later is invisible to that role until it is named, which the GRANT below does.
-- Schemas touched/read explicitly: ai.
-- See also: db/migrations/0152_ai_usage_facts.sql, db/migrations/0154_ai_usage_identity_rewrites.sql,
--   apps/backend/src/aiUsage/record.ts.

ALTER TABLE ai.usage_events
  ADD COLUMN user_supplied_key BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN ai.usage_events.user_supplied_key IS
  'True when the provider call was paid with an API key the person supplied rather than the platform '
  'key. Such a call is metered like any other, and it never counts against the monthly AI allowance.';

GRANT SELECT (user_supplied_key) ON TABLE ai.usage_events TO reporting_readonly;
