-- Schemas touched/read explicitly: ai, org, auth, security, pg_catalog.
SET LOCAL lock_timeout = '30s';

CREATE TABLE ai.consent_identities (
  actor_user_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES org.user_settings(user_id) ON DELETE CASCADE
);

CREATE INDEX idx_ai_consent_identities_user ON ai.consent_identities(user_id);

CREATE TABLE ai.consent_events (
  event_id UUID PRIMARY KEY,
  actor_user_id TEXT NOT NULL REFERENCES ai.consent_identities(actor_user_id) ON DELETE CASCADE,
  installation_id UUID NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('grant', 'withdraw')),
  decision_sequence BIGINT NOT NULL CHECK (decision_sequence BETWEEN 1 AND 9007199254740991),
  disclosure_version TEXT NOT NULL,
  locale TEXT NOT NULL CHECK (length(locale) BETWEEN 1 AND 100),
  disclosure_text TEXT NOT NULL CHECK (length(disclosure_text) BETWEEN 1 AND 20000),
  provider TEXT NOT NULL CHECK (provider = 'openai'),
  purposes TEXT[] NOT NULL CHECK (purposes = ARRAY['chat', 'transcription', 'image_generation']::text[]),
  app_version TEXT NOT NULL CHECK (length(app_version) BETWEEN 1 AND 100),
  app_build TEXT NOT NULL CHECK (length(app_build) BETWEEN 1 AND 100),
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'macos', 'android', 'web')),
  occurred_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (actor_user_id, installation_id, decision_sequence)
);

CREATE INDEX idx_ai_consent_events_installation_sequence
  ON ai.consent_events(installation_id, decision_sequence DESC);

ALTER TABLE ai.consent_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai.consent_events ENABLE ROW LEVEL SECURITY;

-- The ai schema has broad default privileges; decisions are immutable to the runtime role.
REVOKE ALL ON ai.consent_identities, ai.consent_events FROM backend_app;
GRANT SELECT, INSERT ON ai.consent_identities, ai.consent_events TO backend_app;

CREATE POLICY consent_identities_self_select ON ai.consent_identities
  FOR SELECT TO backend_app USING (user_id = security.current_user_id());
CREATE POLICY consent_identities_self_insert ON ai.consent_identities
  FOR INSERT TO backend_app WITH CHECK (
    user_id = security.current_user_id() AND actor_user_id = security.current_user_id()
  );
CREATE POLICY consent_events_self_select ON ai.consent_events
  FOR SELECT TO backend_app USING (
    EXISTS (SELECT 1 FROM ai.consent_identities AS identities
            WHERE identities.actor_user_id = consent_events.actor_user_id
              AND identities.user_id = security.current_user_id())
  );
CREATE POLICY consent_events_self_insert ON ai.consent_events
  FOR INSERT TO backend_app WITH CHECK (
    actor_user_id = security.current_user_id()
    AND EXISTS (SELECT 1 FROM ai.consent_identities AS identities
                WHERE identities.actor_user_id = consent_events.actor_user_id
                  AND identities.user_id = security.current_user_id())
  );

CREATE FUNCTION ai.transfer_guest_consent(source_guest_id TEXT, destination_user_id TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF destination_user_id IS DISTINCT FROM security.current_user_id()
     OR NOT EXISTS (
       SELECT 1 FROM auth.guest_upgrade_history AS history
       WHERE history.source_guest_user_id = source_guest_id
         AND history.target_user_id = destination_user_id
     ) THEN
    RAISE EXCEPTION 'Consent transfer requires the verified guest upgrade to the current user'
      USING ERRCODE = '42501';
  END IF;
  UPDATE ai.consent_identities AS identities SET user_id = destination_user_id
  WHERE identities.user_id = source_guest_id;
END;
$$;
REVOKE ALL ON FUNCTION ai.transfer_guest_consent(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ai.transfer_guest_consent(TEXT, TEXT) TO backend_app;

GRANT SELECT (actor_user_id, user_id) ON ai.consent_identities TO reporting_readonly;
GRANT SELECT (
  event_id, actor_user_id, installation_id, action, decision_sequence, disclosure_version,
  locale, disclosure_text, provider, purposes, app_version, app_build, platform, occurred_at, received_at
) ON ai.consent_events TO reporting_readonly;
CREATE POLICY consent_identities_reporting_select ON ai.consent_identities
  FOR SELECT TO reporting_readonly USING (true);
CREATE POLICY consent_events_reporting_select ON ai.consent_events
  FOR SELECT TO reporting_readonly USING (true);

-- The receipt survives withdrawal, but follows the account's explicit deletion cascade.
ALTER TABLE ai.chat_runs ADD COLUMN ai_consent_event_id UUID;
GRANT SELECT (ai_consent_event_id) ON ai.chat_runs TO reporting_readonly;
