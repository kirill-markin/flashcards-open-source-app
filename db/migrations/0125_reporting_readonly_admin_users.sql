-- Migration status: Current / additive.
-- Introduces: read-only reporting access to the admin entitlement key, so an admin report can tell
--   which reporting rows belong to an active admin and exclude that activity.
-- Schemas touched/read explicitly: auth.

-- The column pair is the whole entitlement identity a report needs. email is already lower/btrim
-- normalized by the admin_users_email_normalized CHECK in db/migrations/0045_admin_users.sql, so a
-- report joins it directly against a folded org.user_settings.email, and revoked_at IS NULL is what
-- "active admin" means. granted_at, granted_by, note and source are operator prose and stay hidden.
--
-- auth.admin_users has no row-level security, so no policy accompanies this grant, and
-- db/migrations/0066_reporting_readonly_operational_analytics.sql already granted
-- USAGE ON SCHEMA auth to reporting_readonly.
GRANT SELECT (email, revoked_at) ON TABLE auth.admin_users TO reporting_readonly;
