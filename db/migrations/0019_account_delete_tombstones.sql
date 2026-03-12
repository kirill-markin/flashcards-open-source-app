-- Deleted-account tombstones prevent stale Cognito JWTs from reprovisioning
-- a just-deleted account before those tokens naturally expire.

CREATE TABLE IF NOT EXISTS auth.deleted_subjects (
  subject_sha256 TEXT        PRIMARY KEY,
  deleted_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, DELETE ON auth.deleted_subjects TO app;
