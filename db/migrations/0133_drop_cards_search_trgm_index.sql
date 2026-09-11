-- Migration status: Current / corrective drop.
-- Introduces: the drop of content.idx_cards_active_search_trgm, the GIN trigram index from
--   db/migrations/0013_cards_query_indexes.sql. Nothing else changes: no replacement index,
--   and the pg_trgm extension stays installed.
-- Replaces or corrects: db/migrations/0013_cards_query_indexes.sql.
-- Schemas touched/read explicitly: content.
--
-- The index was never usable for the card search it was created for. That search is an OR
-- whose tag arm is a correlated EXISTS (SELECT 1 FROM unnest(tags) ...); Postgres can turn
-- an OR into a BitmapOr only when every arm is indexable, and that arm is not, so the
-- planner cannot choose this index. Its expression, lower(front_text || ' ' || back_text),
-- also differs from the text arm, lower(normalize(front_text || ' ' || back_text, NFC)).
--
-- DROP INDEX takes ACCESS EXCLUSIVE on content.cards: it waits behind every transaction holding a
-- lock on cards while every new cards statement queues behind it. CONCURRENTLY cannot run inside
-- the transaction the runner (apps/backend/src/database/migrationRunner.ts) wraps around each file,
-- and the runner sets no lock_timeout, so the wait would otherwise be unbounded. 30s caps how long
-- cards traffic can queue; past it the drop fails 55P03, the release fails, and a rerun retries the file.
SET LOCAL lock_timeout = '30s';
DROP INDEX IF EXISTS content.idx_cards_active_search_trgm;
