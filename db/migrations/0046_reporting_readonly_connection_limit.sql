-- Migration status: Forward-only fix for already-applied environments.
-- Introduces: reporting_readonly connection limit increase for deployed databases.
-- Current guidance: keep this aligned with the backend reporting pool size so warm Lambda concurrency does not exhaust the role budget too early.

ALTER ROLE reporting_readonly CONNECTION LIMIT 10;
