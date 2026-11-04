-- Migration status: Current / additive.
-- Introduces: one-time repair of literal `\n` stored inside math in live card text.
-- Schemas touched/read explicitly: content, sync.
--
-- Inside a `$$` or inline `$` math span, an unescaped two-character `\n` not
-- followed by an ASCII letter becomes a line break. TeX defines no bare `\n`, so
-- that pair can only be a stored escape, and a line break inside display math is
-- whitespace. `\n` before a letter starts a control word such as `\ne` or `\nu`
-- and stays, with one exception: a `$$` body that ends with a broken `\n` was
-- wrapped as `$$\n…\n$$`, so a `\n` right after its opening run is a line break
-- too, as in `$$\nC_n=1\n$$`; `$$\nabla f$$` stays. Code, fences and text
-- outside math stay byte for byte; spans are found by the same scan as
-- 0235_repair_literal_card_escapes.sql.
-- A card whose text changes while this runs keeps that edit. Each repaired card
-- gets a hot change with its stored LWW metadata, so every client pulls the text.

-- Scans one token per step, as 0235 does, and repairs only math tokens.
CREATE OR REPLACE FUNCTION pg_temp.repair_literal_newline_in_math(p_text TEXT)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
AS $repair$
  WITH RECURSIVE scan(rest, repaired, fence, at_line_start, escaped) AS (
    SELECT p_text, ''::TEXT, NULL::TEXT, TRUE, FALSE
    UNION ALL
    SELECT
      substr(scan.rest, length(step.token) + 1),
      scan.repaired || CASE
        WHEN step.is_math THEN pairing.repaired_opening || (
          SELECT string_agg(
            CASE WHEN pieces.piece[1] IS NOT NULL THEN E'\n' ELSE pieces.piece[2] END,
            ''
            ORDER BY pieces.ordinality
          )
          FROM regexp_matches(
            pairing.rest_of_token,
            '(\\n(?![A-Za-z]))|(\\.|[^\\]+|\\)',
            'g'
          ) WITH ORDINALITY AS pieces(piece, ordinality)
        )
        ELSE step.token
      END,
      step.next_fence,
      right(step.token, 1) = E'\n',
      step.is_plain AND step.token ~ '(?:^|[^\\])(?:\\\\)*\\$'
    FROM scan
    CROSS JOIN LATERAL (
      SELECT
        substring(scan.rest from '^[^\n]*\n?') AS line,
        CASE WHEN scan.fence IS NULL AND scan.at_line_start THEN
          substring(scan.rest from '^( {0,3}(?:`{3,}(?=[^`\n]*\n)|~{3,}))')
        END AS opener,
        CASE WHEN NOT scan.escaped THEN substring(scan.rest from '^`+') END AS backticks,
        CASE WHEN NOT scan.escaped THEN substring(scan.rest from '^\$+') END AS dollars,
        substring(scan.rest from '^(\$(?![ \t\n$])(?:\\[^\n]|[^$\n\\])*\$)(?![0-9$])') AS inline_math
    ) AS look
    CROSS JOIN LATERAL (
      SELECT CASE
        WHEN scan.rest ~ ('\n {0,3}' || left(ltrim(look.opener), 1) || '{' || length(ltrim(look.opener)) || ',}[ \t]*(?:\n|$)')
          THEN ltrim(look.opener)
      END AS opened_fence
    ) AS opening
    CROSS JOIN LATERAL (
      SELECT CASE
        WHEN scan.fence IS NOT NULL AND scan.at_line_start THEN look.line
        WHEN scan.fence IS NOT NULL THEN NULL
        WHEN opening.opened_fence IS NOT NULL THEN look.opener
        WHEN length(look.backticks) <= 2 THEN substring(
          scan.rest from '^(' || look.backticks || '.*?[^`]' || look.backticks || ')(?:[^`]|$)'
        )
        WHEN length(look.dollars) >= 2 THEN substring(
          scan.rest from '^(' || replace(look.dollars, '$', '\$') || '.*?[^$]'
            || replace(look.dollars, '$', '\$') || ')(?:[^$]|$)'
        )
        WHEN look.dollars IS NOT NULL AND look.inline_math !~ '[ \t\n]\$$' THEN look.inline_math
      END AS protected_token
    ) AS span
    CROSS JOIN LATERAL (
      SELECT
        span.protected_token IS NULL AS is_plain,
        scan.fence IS NULL AND look.dollars IS NOT NULL AND span.protected_token IS NOT NULL AS is_math,
        CASE
          WHEN span.protected_token IS NOT NULL THEN span.protected_token
          WHEN scan.fence IS NOT NULL THEN look.line
          WHEN look.backticks IS NOT NULL THEN look.backticks
          WHEN look.dollars IS NOT NULL THEN look.dollars
          WHEN left(scan.rest, 1) IN ('`', '$', E'\n') THEN left(scan.rest, 1)
          ELSE substring(scan.rest from '^[^`$\n]+')
        END AS token,
        CASE
          WHEN scan.fence IS NOT NULL THEN CASE
            WHEN scan.at_line_start AND look.line ~ ('^ {0,3}' || left(scan.fence, 1) || '{' || length(scan.fence) || ',}[ \t]*\n?$')
              THEN NULL
            ELSE scan.fence
          END
          ELSE opening.opened_fence
        END AS next_fence
    ) AS step
    -- A `$$` token is its opening run, the body, and a closing run of the same
    -- length. When the body starts with `\n` and ends with an unescaped `\n`,
    -- the opening run and that first `\n` (as a line break) are emitted here and
    -- the rest of the token goes through the regular rewrite.
    CROSS JOIN LATERAL (
      SELECT
        CASE WHEN paired.is_paired THEN look.dollars || E'\n' ELSE '' END AS repaired_opening,
        CASE WHEN paired.is_paired THEN substr(step.token, length(look.dollars) + 3) ELSE step.token END AS rest_of_token
      FROM (
        SELECT step.is_math
          AND length(look.dollars) >= 2
          AND substr(step.token, length(look.dollars) + 1, 2) = E'\\n'
          AND left(step.token, -length(look.dollars)) ~ '[^\\](?:\\\\)*\\n$' AS is_paired
      ) AS paired
    ) AS pairing
    WHERE scan.rest <> ''
  )
  SELECT scan.repaired
  FROM scan
  WHERE scan.rest = '';
$repair$;

CREATE TEMP TABLE migration_0236_repaired_cards ON COMMIT DROP AS
WITH candidate_cards AS (
  SELECT
    cards.workspace_id,
    cards.card_id,
    cards.front_text,
    cards.back_text,
    pg_temp.repair_literal_newline_in_math(cards.front_text) AS repaired_front_text,
    pg_temp.repair_literal_newline_in_math(cards.back_text) AS repaired_back_text
  FROM content.cards AS cards
  WHERE cards.deleted_at IS NULL
    AND (
      strpos(cards.front_text, E'\\n') > 0
      OR strpos(cards.back_text, E'\\n') > 0
    )
)
SELECT
  candidate_cards.workspace_id,
  candidate_cards.card_id,
  candidate_cards.front_text,
  candidate_cards.back_text,
  candidate_cards.repaired_front_text,
  candidate_cards.repaired_back_text
FROM candidate_cards
WHERE candidate_cards.repaired_front_text IS DISTINCT FROM candidate_cards.front_text
  OR candidate_cards.repaired_back_text IS DISTINCT FROM candidate_cards.back_text;

DO $$
DECLARE
  unscanned_card_id UUID;
BEGIN
  SELECT repaired_cards.card_id
  INTO unscanned_card_id
  FROM migration_0236_repaired_cards AS repaired_cards
  WHERE repaired_cards.repaired_front_text IS NULL
    OR repaired_cards.repaired_back_text IS NULL
  LIMIT 1;

  IF unscanned_card_id IS NOT NULL THEN
    RAISE EXCEPTION '0236_repair_literal_newline_in_math could not scan card text to its end. card_id=%', unscanned_card_id;
  END IF;
END
$$;

INSERT INTO sync.workspace_sync_metadata (workspace_id, min_available_hot_change_id, updated_at)
SELECT DISTINCT repaired_cards.workspace_id, 0, now()
FROM migration_0236_repaired_cards AS repaired_cards
ON CONFLICT (workspace_id) DO NOTHING;

SELECT metadata.workspace_id
FROM sync.workspace_sync_metadata AS metadata
WHERE metadata.workspace_id IN (
  SELECT DISTINCT repaired_cards.workspace_id
  FROM migration_0236_repaired_cards AS repaired_cards
)
ORDER BY metadata.workspace_id
FOR UPDATE;

WITH updated_cards AS (
  UPDATE content.cards AS cards
  SET
    front_text = repaired_cards.repaired_front_text,
    back_text = repaired_cards.repaired_back_text,
    updated_at = now()
  FROM migration_0236_repaired_cards AS repaired_cards
  WHERE cards.workspace_id = repaired_cards.workspace_id
    AND cards.card_id = repaired_cards.card_id
    AND cards.deleted_at IS NULL
    AND cards.front_text = repaired_cards.front_text
    AND cards.back_text = repaired_cards.back_text
  RETURNING
    cards.workspace_id,
    cards.card_id,
    cards.last_modified_by_replica_id,
    cards.client_updated_at
)
INSERT INTO sync.hot_changes (
  workspace_id,
  entity_type,
  entity_id,
  action,
  replica_id,
  operation_id,
  client_updated_at
)
SELECT
  updated_cards.workspace_id,
  'card',
  updated_cards.card_id::text,
  'upsert',
  updated_cards.last_modified_by_replica_id,
  'migration-0236-math-newline-card-' || updated_cards.card_id::text,
  updated_cards.client_updated_at
FROM updated_cards;
