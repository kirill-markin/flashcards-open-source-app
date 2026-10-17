-- Schemas touched/read explicitly: org.

ALTER TABLE org.user_settings
  ALTER COLUMN accent_color SET DEFAULT '#FF6719';

UPDATE org.user_settings
SET accent_color = '#FF6719'
WHERE accent_color = '#C44B2D';
