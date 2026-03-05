CREATE TABLE IF NOT EXISTS user_settings (
  user_id    TEXT        NOT NULL PRIMARY KEY,
  email      TEXT,
  locale     TEXT        NOT NULL DEFAULT 'en',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON TABLE user_settings TO app;

INSERT INTO user_settings (user_id) VALUES ('local');
