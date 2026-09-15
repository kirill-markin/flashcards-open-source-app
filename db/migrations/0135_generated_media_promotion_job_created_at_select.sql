-- Migration status: Current / additive.
-- Introduces: column-level SELECT on content.generated_media_promotion_jobs.created_at for
--   backend_app, so the runtime can count promotion jobs per UTC day and per UTC calendar month as
--   its generated card image budget. This migration grants no INSERT on the column.
-- Schemas touched/read explicitly: content.

-- No index is added. The table held a few hundred rows at most when this grant was added, and both
-- counts are workspace-scoped: they filter on workspace_id, and the existing SELECT policy on this
-- table admits only rows of the request workspace. If the table grows until those scans matter, one
-- index on (workspace_id, created_at) serves both counts.
GRANT SELECT (created_at) ON content.generated_media_promotion_jobs TO backend_app;
