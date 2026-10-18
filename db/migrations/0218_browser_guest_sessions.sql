-- Migration status: Current / additive.
-- Schemas touched/read explicitly: auth.

ALTER TABLE auth.guest_sessions
  ADD COLUMN purpose TEXT NOT NULL DEFAULT 'legacy',
  ADD CONSTRAINT guest_sessions_purpose_check
    CHECK (purpose IN ('legacy', 'browser_product')),
  ADD CONSTRAINT guest_sessions_browser_product_platform_check
    CHECK (purpose <> 'browser_product' OR platform IS NOT DISTINCT FROM 'web');

GRANT SELECT (purpose) ON TABLE auth.guest_sessions TO reporting_readonly;
