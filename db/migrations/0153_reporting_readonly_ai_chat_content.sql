-- Migration status: Current / additive.
-- Introduces: read access for reporting_readonly to hosted AI chat content itself - the transcript
--   in ai.chat_items, the turn input and error text on ai.chat_runs, and the composer suggestions on
--   ai.chat_sessions and ai.chat_composer_suggestion_generations - beside the metadata that
--   db/migrations/0066_reporting_readonly_operational_analytics.sql already granted.
-- Current guidance: this is a decision, not an oversight being repaired. Administrator access to
--   hosted AI chat content is opened deliberately, so that dashboards can analyze how people use the
--   AI and make it better, and this is not a secret. It supersedes the stance 0066 took, whose header
--   says that "Secret hashes, raw chat payloads, prompts, suggestions, and legacy payload-heavy sync
--   feeds remain hidden": raw chat payloads, prompts and suggestions are open to reporting from here
--   on. db/migrations/README.md carries the correction entry for that sentence, because an applied
--   migration's header cannot be edited.
-- Current guidance: the privacy policy says this first. The `Hosted AI and External AI Clients`
--   section of src/content/en/pages/privacy/index.md in the separate repository
--   kirill-markin/flashcards-open-source-app-website, and its nine translations, disclose that the
--   operator's administrators may read hosted AI chat content in order to analyze how the AI features
--   are used and improve them. That disclosure merged before this migration.
-- Current guidance: ai.chat_items is granted here for the first time and needs both halves. 0066 gave
--   this role column lists rather than whole rows, so the grant below names every column this table
--   carries today, and a column added to it later stays unreadable to reporting until its own
--   migration names it. Row-level security on this table carried policies for backend_app only, so
--   without the SELECT policy below the grant would read no rows at all. The other three tables
--   already hold their reporting policy from 0066 and need the columns alone.
-- Current guidance: ai.chat_runs.client_platform is in that list because
--   db/migrations/0136_ai_chat_run_client_platform.sql added it after 0066 had enumerated the table
--   and granted nothing, which left the platform dimension missing from exactly the analysis this
--   migration exists to enable.
-- Current guidance: this opens AI chat content and nothing else. Secret hashes, provider subjects,
--   API key hashes, auth.admin_users beyond what is already granted, and the legacy sync.changes
--   payload feed stay closed; they are not AI content and are not part of this decision. The
--   migration is the grant alone and adds no reader: ad hoc operator analysis comes first, and an
--   admin report only once that analysis has said which one is worth building.
-- Schemas touched/read explicitly: ai.
-- See also: db/migrations/0066_reporting_readonly_operational_analytics.sql,
--   db/migrations/0032_ai_chat_sessions.sql,
--   db/migrations/0041_ai_chat_session_composer_suggestions.sql,
--   db/migrations/0136_ai_chat_run_client_platform.sql, db/migrations/README.md,
--   docs/analytics-db-access.md.

GRANT SELECT (
  item_id,
  session_id,
  item_order,
  item_kind,
  state,
  payload,
  created_at,
  updated_at
) ON TABLE ai.chat_items TO reporting_readonly;

GRANT SELECT (
  turn_input,
  last_error_message,
  client_platform
) ON TABLE ai.chat_runs TO reporting_readonly;

GRANT SELECT (composer_suggestions) ON TABLE ai.chat_sessions TO reporting_readonly;

GRANT SELECT (suggestions) ON TABLE ai.chat_composer_suggestion_generations TO reporting_readonly;

DROP POLICY IF EXISTS chat_items_reporting_readonly_select ON ai.chat_items;
CREATE POLICY chat_items_reporting_readonly_select
  ON ai.chat_items
  FOR SELECT
  TO reporting_readonly
  USING (true);
