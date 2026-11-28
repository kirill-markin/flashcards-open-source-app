-- Schemas touched/read explicitly: org.

ALTER TABLE org.user_settings
  ADD COLUMN follow_system_appearance BOOLEAN NOT NULL DEFAULT FALSE;
