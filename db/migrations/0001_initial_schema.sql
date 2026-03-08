-- Initial schema for flashcards-open-source-app (v1)
-- Three schemas: org (users & workspaces), content (cards & reviews), sync (devices & replication state).

-- ============================================================
-- Schema: org
-- Organisational layer: workspaces and user settings.
-- ============================================================

CREATE SCHEMA IF NOT EXISTS org;

-- A workspace isolates a full set of cards, reviews, and devices.
-- Each user has exactly one workspace in v1; multi-workspace support may come later.
CREATE TABLE IF NOT EXISTS org.workspaces (
  workspace_id UUID        PRIMARY KEY,                        -- client-generated UUID so devices can create workspaces offline
  name         TEXT        NOT NULL,                           -- human-readable workspace name shown in the UI
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()              -- server timestamp of workspace creation
);

-- Per-user profile, preferences, and workspace binding.
-- One row per authenticated user. Created on first login via ensureUser.
CREATE TABLE IF NOT EXISTS org.user_settings (
  user_id      TEXT        NOT NULL PRIMARY KEY,               -- external identity provider ID (e.g. Cognito sub)
  workspace_id UUID        REFERENCES org.workspaces(workspace_id) ON DELETE SET NULL, -- the workspace this user owns; NULL until first provisioning
  email        TEXT,                                           -- email address from the auth provider; NULL until the provider confirms it
  locale       TEXT        NOT NULL DEFAULT 'en',              -- preferred UI language (ISO 639-1 code)
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()              -- when this user record was first created
);

-- ============================================================
-- Schema: content
-- Domain data: flashcards and spaced-repetition review log.
-- ============================================================

CREATE SCHEMA IF NOT EXISTS content;

-- A single flashcard belonging to a workspace.
CREATE TABLE IF NOT EXISTS content.cards (
  card_id        UUID        PRIMARY KEY,                      -- client-generated UUID so cards can be created offline
  workspace_id   UUID        NOT NULL REFERENCES org.workspaces(workspace_id) ON DELETE CASCADE, -- workspace that owns this card; used for data isolation
  front_text     TEXT        NOT NULL,                         -- question or prompt shown to the user
  back_text      TEXT        NOT NULL,                         -- correct answer revealed after the user responds
  tags           TEXT[]      NOT NULL DEFAULT '{}',            -- user-defined tags for grouping and filtering cards in the UI
  effort_level   TEXT        NOT NULL DEFAULT 'fast'           -- estimated time to answer; used for session planning filters in the UI
                             CHECK (effort_level IN ('fast', 'medium', 'long')),
  due_at         TIMESTAMPTZ,                                  -- when the card should be shown next according to the SRS algorithm; NULL means the card has never been reviewed
  reps           INTEGER     NOT NULL DEFAULT 0 CHECK (reps >= 0),   -- denormalized count of all reviews; derivable from review_events, cached here for SRS performance
  lapses         INTEGER     NOT NULL DEFAULT 0 CHECK (lapses >= 0), -- denormalized count of Again reviews from persisted review state; derivable from review_events plus scheduler state, cached here for SRS performance
  server_version BIGINT      NOT NULL,                         -- monotonically increasing version assigned by the server on every write; clients request cards with server_version > their last known value to get a delta
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),           -- last time this row was modified on the server
  deleted_at     TIMESTAMPTZ                                   -- soft-delete timestamp; non-NULL means the card is deleted but kept as a tombstone so clients can sync the deletion
);

CREATE INDEX IF NOT EXISTS idx_cards_workspace_server_version ON content.cards(workspace_id, server_version);
CREATE INDEX IF NOT EXISTS idx_cards_workspace_due_at          ON content.cards(workspace_id, due_at);
CREATE INDEX IF NOT EXISTS idx_cards_workspace_due_active      ON content.cards(workspace_id, due_at) WHERE deleted_at IS NULL;

-- Append-only log of every card review.
-- Serves as the source of truth for learning history: reps, lapses, and due_at on cards
-- are denormalized caches that can be fully rebuilt from this table.
-- Also used for user-facing statistics (progress graphs, accuracy, heatmaps).
CREATE TABLE IF NOT EXISTS content.review_events (
  review_event_id    UUID        PRIMARY KEY,                  -- server-assigned unique identifier for this review event
  workspace_id       UUID        NOT NULL REFERENCES org.workspaces(workspace_id) ON DELETE CASCADE, -- workspace scope for data isolation
  card_id            UUID        NOT NULL REFERENCES content.cards(card_id) ON DELETE CASCADE,       -- which card was reviewed
  device_id          UUID        NOT NULL,                     -- which device submitted the review; FK to sync.devices added via ALTER TABLE below
  client_event_id    TEXT        NOT NULL,                     -- unique key generated by the client; used with the UNIQUE constraint to prevent duplicate inserts on push retries
  rating             SMALLINT    NOT NULL CHECK (rating BETWEEN 0 AND 3), -- user's self-assessment: 0 = again (forgot), 1 = hard, 2 = good, 3 = easy
  reviewed_at_client TIMESTAMPTZ NOT NULL,                     -- when the user answered on their device (client clock); may differ from server time
  reviewed_at_server TIMESTAMPTZ NOT NULL DEFAULT now(),       -- when the server received and stored this event
  UNIQUE (workspace_id, device_id, client_event_id)            -- prevents the same review from being recorded twice if the client retries the push
);

CREATE INDEX IF NOT EXISTS idx_review_events_workspace_card_time
  ON content.review_events(workspace_id, card_id, reviewed_at_server DESC);

-- ============================================================
-- Schema: sync
-- Offline-first replication: devices and operation log.
-- ============================================================

CREATE SCHEMA IF NOT EXISTS sync;

-- Every mobile client registers as a device before syncing.
-- Used to attribute review events and operations to a specific client installation.
CREATE TABLE IF NOT EXISTS sync.devices (
  device_id    UUID        PRIMARY KEY,                        -- client-generated UUID assigned on first app launch
  workspace_id UUID        NOT NULL REFERENCES org.workspaces(workspace_id) ON DELETE CASCADE, -- which workspace this device syncs with
  user_id      TEXT        NOT NULL,                           -- the user who owns this device (same ID as org.user_settings.user_id)
  platform     TEXT        NOT NULL CHECK (platform IN ('ios', 'android')), -- operating system of the client device
  app_version  TEXT,                                           -- semantic version of the installed app; useful for debugging sync issues; NULL if not reported
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),             -- when this device was first registered on the server
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),             -- updated on every sync request; used to detect stale devices
  UNIQUE (workspace_id, user_id, device_id)
);

CREATE INDEX IF NOT EXISTS idx_devices_workspace_user ON sync.devices(workspace_id, user_id);

-- Cross-schema FK: review_events.device_id -> sync.devices.device_id.
-- Defined here because sync.devices is created after content.review_events.
ALTER TABLE content.review_events
  ADD CONSTRAINT fk_review_events_device
  FOREIGN KEY (device_id) REFERENCES sync.devices(device_id) ON DELETE RESTRICT;

-- Idempotency ledger for push operations.
-- When a client pushes changes, the server records each operation_id here.
-- If the client retries the same operation (e.g. due to network timeout),
-- the server finds the existing row and skips re-application, preventing data corruption.
CREATE TABLE IF NOT EXISTS sync.applied_operations (
  workspace_id   UUID        NOT NULL REFERENCES org.workspaces(workspace_id) ON DELETE CASCADE,  -- workspace scope
  device_id      UUID        NOT NULL REFERENCES sync.devices(device_id) ON DELETE RESTRICT,      -- which device sent this operation
  operation_id   TEXT        NOT NULL,                         -- unique key generated by the client for each push operation
  operation_type TEXT        NOT NULL,                         -- kind of operation: 'upsert_card', 'review', etc.; used for logging and debugging
  applied_at     TIMESTAMPTZ NOT NULL DEFAULT now(),           -- when the server successfully applied this operation
  PRIMARY KEY (workspace_id, device_id, operation_id)          -- guarantees each operation is recorded at most once
);

-- ============================================================
-- Roles & grants
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app') THEN
    CREATE ROLE app LOGIN;
  END IF;
END
$$;

GRANT CONNECT ON DATABASE flashcards TO app;

GRANT USAGE ON SCHEMA org     TO app;
GRANT USAGE ON SCHEMA content TO app;
GRANT USAGE ON SCHEMA sync    TO app;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA org     TO app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA content TO app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA sync    TO app;

ALTER DEFAULT PRIVILEGES IN SCHEMA org     GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app;
ALTER DEFAULT PRIVILEGES IN SCHEMA content GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app;
ALTER DEFAULT PRIVILEGES IN SCHEMA sync    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app;

-- ============================================================
-- Seed data (local development)
-- ============================================================

INSERT INTO org.user_settings (user_id) VALUES ('local');
