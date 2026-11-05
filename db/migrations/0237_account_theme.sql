-- Schemas touched/read explicitly: org.

ALTER TABLE org.user_settings
  ADD COLUMN theme TEXT NOT NULL DEFAULT 'dark'
    CONSTRAINT user_settings_theme_value CHECK (theme IN ('dark', 'light'));
