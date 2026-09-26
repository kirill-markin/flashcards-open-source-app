-- Schemas touched/read explicitly: org.

ALTER TABLE org.user_settings
  ADD COLUMN accent_color TEXT NOT NULL DEFAULT '#C44B2D'
    CONSTRAINT user_settings_accent_color_hex CHECK (
      length(accent_color) = 7 AND accent_color ~ '^#[0-9A-F]{6}$'
    );
