import { REVIEW_FLOW_INSTRUCTIONS } from "../../agent/reviewContract";
import { getConfiguredPublicAppOrigin } from "../../shared/publicUrls";
import { NIBOMO_APP_CLAUSE } from "./assistantContract";
import { MAX_SQL_BATCH_STATEMENT_COUNT, MAX_SQL_RECORD_LIMIT } from "./sqlToolLimits";

export const SQL_QUERY_TOOL_NAME = "sql_query";
export const SQL_EXECUTE_TOOL_NAME = "sql_execute";

/**
 * Flashcard side contract, mandatory across all clients and APIs: `front_text`
 * is only a recall prompt, never the answer, and `back_text` holds the answer.
 */
export const FRONT_BACK_CONTRACT =
  "Card side contract: front_text is a short recall prompt and never contains the answer: a term for vocabulary and definitions, a question for concepts, facts and procedures. back_text holds the answer and may be long. One fact per card. Write a longer front only when the user asks or similar cards in the same deck or tag already use long fronts.";

/**
 * Canonical Markdown and LaTeX authoring contract for every agent surface.
 * Card content stays untouched; agents author decoded values and verify writes.
 */
export const CARD_AUTHORING_CONTRACT =
  "Card fields hold decoded Markdown, real LFs, supported LaTeX. One LF stays within its Markdown paragraph; two make a blank line/new paragraph; literal `\\n` never lays out content. At JSON boundary, `\\n` becomes LF, `\\\\frac` becomes stored `\\frac`, while double-escaped `\\\\n` stores literal `\\n`. Use `$...$` inline for a short expression inside a sentence, with no space just inside either `$` and no digit right after the closing `$`; write a standalone display formula as its own block, with `$$` alone on the opening and closing lines and a blank line before and after it or the start or end of the field, because a `$$` block that does not stand alone stays literal. Escape a currency `$` as `\\$` (`\\\\$` at the JSON boundary). Put math only in a plain paragraph that holds no link, image, bold, italic, strikethrough, or code anywhere in it, and keep it out of headings, lists, tables, blockquotes, code blocks, and raw HTML, and off any side using reference-style link or image definitions; anywhere else it stays literal. After multiline/LaTeX writes, compare read-back with intended decoded text; repair only accidental transport double-escaping, preserving literal escapes intentionally requested/taught by user/card.";

export const CARD_AUTHORING_TOOL_CALL_EXAMPLE =
  "{\"sql\":\"INSERT INTO cards (front_text, back_text, tags) VALUES ('Question?', 'Answer: the ratio $a/b$ is written as\\n\\n$$\\n\\\\frac{a}{b}\\n$$', ('math'))\"}";

/**
 * Product rules for the back side of a card. Shared so the in-app chat system
 * prompt and the MCP `card_authoring` guide state them once. Each entry is a
 * ready-to-use bullet line; the consuming surface supplies its own heading.
 */
export const CARD_BACK_SIDE_RULE_LINES = Object.freeze([
  "- Back side must start with the direct answer.",
  "- Format a back side longer than one short sentence as real Markdown: blank lines between paragraphs, short lists where they help scanning.",
  "- Add an example only when it helps recall; never add examples or extra text to content the user supplied.",
  "- For code cards, put concrete code in fenced Markdown code blocks on the back side.",
]);

/**
 * Tagging rules for newly authored cards, shared by the chat system prompt and
 * the MCP `card_authoring` guide.
 */
export const CARD_TAGGING_RULE_LINES = Object.freeze([
  "- Every newly proposed card must include at least one tag.",
  "- Reuse existing workspace tags whenever that is logically appropriate.",
]);

/**
 * Duplicate check that precedes any card or deck creation, shared by the chat
 * system prompt and the MCP `card_authoring` guide.
 */
export const CARD_DUPLICATE_CHECK_RULE_LINES = Object.freeze([
  "- Before creating any card or deck, silently check the workspace for exact or similar items with a SELECT.",
  "- Mention only real overlaps; when there are none, do not raise duplicates with the user.",
]);

/**
 * Style-alignment rules that keep generated cards close to the cards the user
 * already writes, shared by the chat system prompt and the MCP
 * `card_authoring` guide.
 */
export const CARD_STYLE_ALIGNMENT_RULE_LINES = Object.freeze([
  "- Unless the user asked for a format, first SELECT a few related existing cards and follow the user's local style where it keeps the card side contract.",
  "- Preserve patterns such as examples on backs, punctuation, sentence length, Markdown density and tag style; when similar cards conflict, follow the closest topic or deck.",
]);

/**
 * Preservation rules for the managed image references the server itself writes
 * into card text, shared by the chat system prompt and the MCP
 * `card_authoring` guide.
 *
 * They exist because the attachment is asynchronous: the generated-image tool
 * answers as soon as the job is durable, while
 * `appendPendingManagedImageToCardSideInExecutor` has written only a
 * `fcasset:<id>?state=pending` marker that the promotion job
 * (`apps/backend/src/chat/cardImages/promotion/`) rewrites to `fcasset:<id>`
 * afterwards. A model that composes its next UPDATE from a read taken before
 * the attachment therefore overwrites the reference without ever having seen
 * it, and the asset keeps no record of the card it was on.
 *
 * A shape change on the stored text costs three things. It stops the reference
 * rendering as an image. Before settlement it also costs the image itself,
 * because `markPendingManagedImageReadyOnCardSideInExecutor` in
 * `apps/backend/src/cards/managedMedia/` settles only an exact Markdown image
 * destination and fails the promotion job permanently when it no longer finds
 * one. And it moves the reference out of the snapshot merge's restore set:
 * `collectStoredImageReferencesBySide` in `managedImageSnapshotMerge.ts`
 * gathers restore candidates through
 * `extractManagedMediaImageReferenceSources`, which returns active Markdown
 * images only, so a link or a code-fenced reference is never a candidate. The
 * next stale client snapshot push - the ordinary case that merge exists for,
 * and a review alone triggers one - then stores text without the reference,
 * nothing puts it back, and the card's record of the asset is gone for good.
 *
 * The leniency of `textsMentionMediaAssetId` in the same file belongs to the
 * incoming snapshot, not to this: it counts a link, or any other mention of the
 * id, in the text a client is pushing as still referenced, which is what leaves
 * a person editing their own card alone.
 *
 * The last line repeats, in its general form, the rule the chat's
 * generated-image policy states for its own surface: the reference lives in
 * card text and never in a reply.
 *
 * Deliberately left unhandled: a re-read inside the settlement window can copy a
 * `?state=pending` marker back over an already settled reference.
 */
export const CARD_MANAGED_IMAGE_RULE_LINES = Object.freeze([
  "- The server writes generated images straight into front_text and back_text as Markdown image nodes whose destination starts with fcasset:, and it can do so seconds after the image tool has already answered, so a card you read a moment ago may already carry one you have not seen.",
  "- Before rewriting front_text or back_text on a card that may carry one, SELECT that card's current text immediately before the write, and reproduce every fcasset: destination exactly as you just read it, character for character.",
  "- Reproduce each reference in the shape you found it: one written as a Markdown image in ordinary body text stays exactly that, and one the person already turned into a link or moved into a code fence stays that way too, because they wrote it that way on purpose.",
  "- Changing that shape is never a safe edit: a settled reference stops rendering as an image on the card, and a reference the server has not finished attaching yet is lost for good, because the server comes back looking for the Markdown image it wrote and gives up when it is gone.",
  "- Dropping an fcasset: reference deletes that image from the card, and nothing records which card it belonged to, so it cannot be put back.",
  "- These references belong in card text only: never repeat fcasset: markdown, or the storage details behind it, in a reply to the user.",
]);

const SQL_QUERY_PAGED_READ_EXAMPLE_LINE =
  "- sql_query => {\"sql\": \"SELECT * FROM cards ORDER BY created_at DESC, card_id ASC LIMIT 20 OFFSET 0\"}";
const SQL_QUERY_TAG_FILTER_EXAMPLE_LINE =
  "- sql_query => {\"sql\": \"SELECT card_id, front_text, back_text, tags FROM cards WHERE tags OVERLAP ('english', 'slang') ORDER BY created_at DESC, card_id ASC LIMIT 20 OFFSET 0\"}";

export const SQL_QUERY_TOOL_PROMPT_EXAMPLE_LINES = Object.freeze([
  "- sql_query => {\"sql\": \"SHOW TABLES\"}",
  "- sql_query => {\"sql\": \"DESCRIBE workspace\"}",
  "- sql_query => {\"sql\": \"SHOW COLUMNS FROM cards\"}",
  SQL_QUERY_PAGED_READ_EXAMPLE_LINE,
  "- sql_query => {\"sql\": \"SELECT card_id, front_text, back_text, tags FROM cards ORDER BY RANDOM() LIMIT 3 OFFSET 0\"}",
  "- sql_query => {\"sql\": \"SELECT card_id, front_text, back_text, tags FROM cards WHERE LOWER(front_text) LIKE '%example%' OR LOWER(back_text) LIKE '%example%' ORDER BY created_at DESC, card_id ASC LIMIT 20 OFFSET 0\"}",
  "- sql_query => {\"sql\": \"SELECT card_id, front_text, back_text, tags FROM cards UNNEST tags AS tag WHERE LOWER(tag) = 'typescript' ORDER BY created_at DESC, card_id ASC LIMIT 20 OFFSET 0\"}",
  "- sql_query => {\"sql\": \"SELECT tag, COUNT(*) AS cards_count FROM cards UNNEST tags AS tag WHERE LOWER(tag) IN ('english', 'slang') GROUP BY tag ORDER BY cards_count DESC LIMIT 20 OFFSET 0\"}",
  "- sql_query => {\"sql\": \"SELECT card_id, front_text, back_text, tags FROM cards UNNEST tags AS tag WHERE LOWER(tag) NOT IN ('humor', 'internet') ORDER BY created_at DESC, card_id ASC LIMIT 20 OFFSET 0\"}",
  "- sql_query => {\"sql\": \"SELECT * FROM workspace LIMIT 1 OFFSET 0\"}",
  "- sql_query => {\"sql\": \"SELECT * FROM review_events WHERE card_id = '00000000-0000-4000-8000-000000000000' ORDER BY reviewed_at_server DESC LIMIT 20 OFFSET 0\"}",
  "- sql_query => {\"sql\": \"SELECT tag, COUNT(*) AS cards_count FROM cards UNNEST tags AS tag GROUP BY tag ORDER BY cards_count DESC LIMIT 100 OFFSET 0\"}",
  "- sql_query => {\"sql\": \"SELECT * FROM cards WHERE due_at IS NULL OR due_at <= NOW() ORDER BY due_at ASC, created_at DESC, card_id ASC LIMIT 20 OFFSET 0\"}",
  "- sql_query => {\"sql\": \"SELECT card_id, front_text, back_text, tags FROM cards UNNEST tags AS tag WHERE LOWER(tag) = 'english' AND (LOWER(front_text) LIKE '%example%' OR LOWER(back_text) NOT LIKE '%draft%') ORDER BY created_at DESC, card_id ASC LIMIT 20 OFFSET 0\"}",
  "- sql_query => {\"sql\": \"SELECT card_id, front_text, back_text, tags FROM cards WHERE tags = () ORDER BY created_at DESC, card_id ASC LIMIT 20 OFFSET 0\"}",
  SQL_QUERY_TAG_FILTER_EXAMPLE_LINE,
]);

const SQL_EXECUTE_CREATE_CARD_EXAMPLE_LINE =
  "- sql_execute => {\"sql\": \"INSERT INTO cards (front_text, back_text, tags) VALUES ('Q?', 'A', ('grammar')) RETURNING card_id, front_text, back_text\"}";
const SQL_EXECUTE_TAG_FILTER_EXAMPLE_LINE =
  "- sql_execute => {\"sql\": \"DELETE FROM cards WHERE tags OVERLAP ('some-tag')\"}";

/**
 * Write-only example lines for the split `sql_execute` surface. They cover only
 * the mutation statements (`INSERT`, `UPDATE`, `DELETE`).
 *
 * No INSERT here passes an empty tag list: every newly authored card must carry
 * at least one tag (`CARD_TAGGING_RULE_LINES`), so the `()` literal is shown
 * only on an UPDATE that deliberately clears the tags of an existing card.
 */
export const SQL_EXECUTE_TOOL_PROMPT_EXAMPLE_LINES = Object.freeze([
  `- sql_execute => ${CARD_AUTHORING_TOOL_CALL_EXAMPLE}`,
  "- sql_execute => {\"sql\": \"INSERT INTO cards (front_text, back_text, tags) VALUES ('Q?', 'A', ('grammar', 'a1'))\"}",
  "- sql_execute => {\"sql\": \"UPDATE cards SET back_text = 'Updated answer' WHERE card_id = '00000000-0000-4000-8000-000000000000'\"}",
  "- sql_execute => {\"sql\": \"UPDATE cards SET tags = () WHERE card_id = '00000000-0000-4000-8000-000000000000'\"}",
  "- sql_execute => {\"sql\": \"UPDATE cards SET back_text = 'First update' WHERE card_id = '00000000-0000-4000-8000-000000000000'; UPDATE cards SET back_text = 'Second update' WHERE card_id = '00000000-0000-4000-8000-000000000001'\"}",
  "- sql_execute => {\"sql\": \"DELETE FROM decks WHERE deck_id IN ('00000000-0000-4000-8000-000000000000')\"}",
  SQL_EXECUTE_TAG_FILTER_EXAMPLE_LINE,
  SQL_EXECUTE_CREATE_CARD_EXAMPLE_LINE,
  "- sql_execute => {\"sql\": \"DELETE FROM cards WHERE card_id = '00000000-0000-4000-8000-000000000000' RETURNING *\"}",
]);

/**
 * Shared dialect description fragment. `SQL_DIALECT_GUIDE` is its only
 * consumer: no SQL tool description composes it, because every tool description
 * is metadata under a character budget and restates only the few facts a call
 * cannot get right by guessing.
 *
 */
const SQL_DIALECT_DESCRIPTION_LINES = Object.freeze([
  "This is not full PostgreSQL.",
  CARD_AUTHORING_CONTRACT,
  "Cards, decks, review_events, and workspace are already scoped to the selected workspace.",
  "Use one JSON object: {\"sql\": \"...\"}.",
  "Public docs: https://nibomo.com/docs/mcp-connector/ and https://nibomo.com/docs/api/.",
  "Published resources: workspace, cards, decks, review_events.",
  "Resource semantics: cards have no deck_id column and no deck membership.",
  "A deck is a saved tag filter whose tags column defines the filter, so the only association between a card and a deck is matching tags.",
  "Decks expose deck_id, name, tags, created_at, and updated_at, and have no description column.",
  "Multiple supported statements may be separated with semicolons in one sql string.",
  `A batch may contain at most ${MAX_SQL_BATCH_STATEMENT_COUNT} statements.`,
  "Schema discovery (SHOW TABLES, DESCRIBE, SHOW COLUMNS) must be its own read call and must never share a semicolon-separated sql string with statements that depend on its result, because the whole batch is composed before any statement runs.",
]);

/**
 * Shared WHERE-clause grammar fragment. UPDATE and DELETE resolve their target
 * rows through the same SELECT evaluator, so the read and write surfaces must
 * advertise exactly the same WHERE forms. The fragment is a bare
 * semicolon-separated list of forms with no "WHERE" framing and no trailing
 * conjunction of its own, so each surface can end its own sentence with it.
 * Semicolons mark the item boundaries because several items carry multi-clause
 * explanations of their own.
 */
const SQL_WHERE_SUPPORTED_FORMS_DESCRIPTION =
  "parenthesized AND/OR groups where AND binds tighter than OR; scalar comparison with =, <, <=, >, and >=; IS NULL and IS NOT NULL; LIKE, NOT LIKE, ILIKE, LOWER(column) LIKE '...', LOWER(column) NOT LIKE '...', LOWER(column) ILIKE '...', and LOWER(column) = 'value', which is a case-insensitive whole-string LIKE match, so % and _ in the value are wildcards rather than literal characters; exact value matches via column IN (...); case-insensitive exact string matches via LOWER(column) IN (...) and LOWER(column) NOT IN (...); array comparison against a literal tag list such as tags = ('english', 'slang'), which is exact set equality, meaning the row array must equal exactly the listed values, order-independent and case-sensitive, so a card carrying any additional tag does not match; tags = () for rows with no tags; array-column intersection such as tags OVERLAP ('english', 'slang') for rows carrying at least one of the listed values, compared exactly and case-sensitively, so pass tag values as they are stored; for cards carrying all of several tags, combine intersections such as tags OVERLAP ('english') AND tags OVERLAP ('slang'); MATCH('text') to keep rows where any column of the row contains that text as a case-insensitive substring (it scans every column, including tags and JSON metadata, and there is no tokenization, so prefer one word or an exact phrase)";

/**
 * Text-only WHERE forms. The pattern family (LIKE, NOT LIKE, ILIKE and
 * `LOWER(column) = 'value'`, which the parser compiles into the same `like`
 * predicate, so `%` and `_` stay wildcards there too) is gated by
 * `LIKE_SUPPORTED_COLUMN_TYPES` in
 * `apps/backend/src/aiTools/sqlDialect/selectExecutor.ts` and rejects non-text
 * columns. `column IN (...)` and `LOWER(column) IN (...)` are separate `in`
 * predicates that the same gate does not cover, so the dialect accepts them on a
 * filterable array column such as `tags`; `rowMatchesInPredicate` then returns
 * `false` for the array column value before negation is applied, so the plain,
 * the lowered, and the negated lowered form all match no rows. Only the lowered
 * forms are text-only: `parseLoweredStringLiteralList` accepts string literals
 * alone, while the plain form parses its literals with `parseSqlLiteral` and
 * `valuesEqual` compares them strictly, so `column IN (1, 2)` and
 * `column IN (true)` do compare and do match. The negation exists only as
 * `LOWER(column) NOT IN (...)`: `predicateParser.ts` has no plain
 * `column NOT IN (...)` branch, so that spelling reaches the
 * unsupported-predicate error for every column type. `metadata` reaches neither
 * gate because the dialect schema marks it `filterable: false`.
 *
 * The closing `filterable`/`sortable` rule is stated generally, not per column:
 * naming one rejected column leaves an agent that tries any other with a bare
 * rejection and nothing it could have read first. `DESCRIBE` already returns
 * both flags per column, so the rule is actionable as stated. Every surface takes it from here: do not restate it as a local
 * literal anywhere that already composes this constant.
 *
 * The `sortable` half carries its GROUP BY exception because
 * `validateAggregateSelect` in `selectExecutor.ts` never reads `sortable`: it
 * accepts any ORDER BY item naming an aggregate output or a GROUP BY column,
 * so `SELECT replica_id, COUNT(*) FROM review_events GROUP BY replica_id
 * ORDER BY replica_id` succeeds. `validateRowOrderBy`, the only reader of
 * the flag, runs on the wildcard and projected paths alone.
 *
 * The NULL ordering sentence is `compareRowValues` in `selectExecutor.ts`,
 * which `applyOrderBy` uses on every ORDER BY path; `parseOrderBy` accepts no
 * NULLS FIRST/LAST, so the `IS NOT NULL` filter is the only way to change it.
 *
 * Every outcome claim here is read out of the evaluator. Do not add an intuited
 * one: it would ship a wrong mental model into `SQL_DIALECT_GUIDE`. No tool
 * description composes it, so it is not under a character budget.
 */
const SQL_TEXT_COLUMN_FORMS_DESCRIPTION =
  "LIKE, NOT LIKE, ILIKE, their LOWER(column) variants, and LOWER(column) = 'value' apply only to text-valued columns, meaning the string, uuid, and datetime column types; on array columns such as tags they are rejected with a clear error. LOWER(column) IN (...) and LOWER(column) NOT IN (...) compare text values only; plain column IN (...) compares the column value exactly, so pass integer and boolean literals unquoted. On an array column such as tags none of these IN forms are rejected, but they all match no rows. The negated form exists only as LOWER(column) NOT IN (...); a plain column NOT IN (...) is rejected as an unsupported predicate for every column type. Match tags with tags OVERLAP ('english') or tags = ('english', 'slang') instead. DESCRIBE and SHOW COLUMNS report filterable and sortable per column: a column with filterable false is rejected in a WHERE clause, and a column with sortable false is rejected in ORDER BY unless it is a GROUP BY column. In ORDER BY, NULL sorts before every value ascending and after every value descending; never-reviewed cards have NULL in every fsrs_* column except fsrs_card_state, so add WHERE column IS NOT NULL to keep them out of an ascending sort on such a column. Read both flags before filtering or sorting on an unfamiliar column; metadata, for one, is neither.";

/**
 * Shared supported-forms sentence. `SQL_DIALECT_GUIDE` is its only consumer, so
 * every surface advertises the same SELECT grammar: no tool description carries
 * it, because each is under a character budget and points at the `sql_dialect`
 * guide instead, which `get_guide` serves to MCP and to the in-app chat alike.
 */
export const SQL_SELECT_SUPPORTED_FORMS_DESCRIPTION =
  `SELECT supports projected column lists, COUNT(*), SUM, AVG, MIN, MAX, GROUP BY, NOW(), standalone ORDER BY RANDOM(), and cards UNNEST tags AS tag. SELECT WHERE clauses support ${SQL_WHERE_SUPPORTED_FORMS_DESCRIPTION}. ${SQL_TEXT_COLUMN_FORMS_DESCRIPTION}`;

/**
 * Tag filtering on the write side. `UNNEST` only exists in `SELECT`, so `OVERLAP`
 * is the only way to target rows by tag in `UPDATE` and `DELETE`.
 */
export const SQL_MUTATION_TAG_FILTER_DESCRIPTION =
  "Filter by tag in UPDATE and DELETE with tags OVERLAP ('tag'), because UNNEST is only available in SELECT.";

/**
 * Write-side result projection for `SQL_DIALECT_GUIDE`. Descriptions under a
 * character budget, such as the always-loaded MCP `sql_execute` description,
 * state the same rule in one shorter sentence of their own instead of composing
 * this constant.
 */
export const SQL_RETURNING_DESCRIPTION =
  "INSERT, UPDATE, and DELETE accept a trailing RETURNING * or RETURNING col1, col2 clause; without it INSERT and UPDATE return only the identifier column and DELETE returns no rows. DELETE RETURNING reports each row as it was before deletion. Prefer a narrow column list over RETURNING *.";

/**
 * Write-side mirror of the WHERE grammar, composed from the same predicate
 * guidance as `SQL_SELECT_SUPPORTED_FORMS_DESCRIPTION`. `SQL_DIALECT_GUIDE` is
 * its only consumer.
 * Runtime parsing lives in `apps/backend/src/aiTools/sqlDialect/predicateParser.ts`.
 */
const SQL_MUTATION_WHERE_SUPPORTED_FORMS_DESCRIPTION =
  `UPDATE and DELETE WHERE clauses support ${SQL_WHERE_SUPPORTED_FORMS_DESCRIPTION}. ${SQL_TEXT_COLUMN_FORMS_DESCRIPTION} ${SQL_MUTATION_TAG_FILTER_DESCRIPTION}`;

/**
 * Batch atomicity, shared by `SQL_DIALECT_GUIDE` and `BULK_AUTHORING_GUIDE`.
 * The always-loaded `sql_execute` description, under a character budget, makes
 * the same all-or-nothing promise in its own condensed words, so a change here
 * does not reach it.
 */
export const SQL_BATCH_ATOMICITY_DESCRIPTION =
  "Mutation batches are applied atomically: all statements succeed or the whole batch fails.";

/**
 * Self-contained bulk-write split arithmetic for `SQL_DIALECT_GUIDE` and
 * `BULK_AUTHORING_GUIDE`, so an agent can size a batch without
 * cross-referencing other lines. The always-loaded MCP `sql_execute`
 * description restates the same caps in one shorter sentence instead of
 * composing this constant.
 *
 * Deliberately limited to the three limits the dialect actually enforces on
 * every write surface. Result-payload budgets differ per surface (`sql_query`
 * truncates a single `SELECT` to the rows that fit whenever dropping rows
 * leaves at least one row that fits, and rejects every other oversized read;
 * `sql_execute` shrinks the already committed write instead, shortening the
 * echoed statement text first and only when that makes the emitted payload
 * smaller, then dropping the returned rows if the payload is still over budget;
 * and the in-app chat caps its own serialized SQL tool results in
 * `createSqlToolSuccessResult`, `apps/backend/src/chat/openai/tools/toolResults.ts`), so
 * they are not stated here.
 */
export const SQL_BULK_WRITE_SPLIT_DESCRIPTION =
  `Bulk-write split arithmetic: at most ${MAX_SQL_RECORD_LIMIT} rows affected per statement, at most ${MAX_SQL_BATCH_STATEMENT_COUNT} statements per batch, and a batch must not mix read and write statements. Split larger work across separate statements or separate tool calls.`;

export const SQL_QUERY_TOOL_DESCRIPTION = [
  "Read-only Nibomo SQL, not full PostgreSQL: SHOW TABLES, DESCRIBE, SHOW COLUMNS FROM and SELECT over workspace, cards, decks and review_events.",
  "A deck is a saved tag filter; cards have no deck_id.",
  `At most ${MAX_SQL_RECORD_LIMIT} rows per SELECT; paginate with ORDER BY, LIMIT, OFFSET; after data.rowsTruncated continue at OFFSET data.offset + data.rowCount.`,
  "Run schema discovery in its own call.",
  "Grammar and examples: get_guide(sql_dialect).",
].join(" ");

export const SQL_EXECUTE_TOOL_DESCRIPTION = [
  "Creates, updates or deletes cards and decks with Nibomo SQL INSERT, UPDATE or DELETE, not full PostgreSQL; cannot write review_events or FSRS state.",
  "New cards: front_text is a recall prompt, never the answer; at least one tag.",
  `One call is an atomic batch of up to ${MAX_SQL_BATCH_STATEMENT_COUNT} semicolon-separated writes, ${MAX_SQL_RECORD_LIMIT} affected rows each.`,
  "Arrays: ('a', 'b'), or () to clear; filter UPDATE and DELETE by tag with tags OVERLAP ('tag'); RETURNING col1, col2 returns affected rows.",
  "After saving cards, tell how many and where they are (one card: its link, get_guide(card_authoring); many: data.reviewUrl, the Review page), and offer to study them now.",
  "ok true with data.rowsOmitted or top-level truncated true: the write landed; never resend it, SELECT to check.",
].join(" ");

/**
 * On-demand guide bodies, served by the `get_guide` tool on MCP and the chat
 * and by the REST guide route.
 *
 * A guide composes the shared constants it covers (and
 * `REVIEW_FLOW_INSTRUCTIONS`) rather than restating them, so a rule that
 * changes in its own constant changes in the guide too. Guides are the intended
 * home for the long tail of instructions a client only needs at a specific
 * moment.
 *
 * Before trimming or editing a guide body, grep for every constant it composes:
 * a guide body is not proof the text lives only there, and several constants
 * are shared with other surfaces. The highest-risk one is `REVIEW_FLOW_GUIDE`,
 * which is `REVIEW_FLOW_INSTRUCTIONS` itself; every REST review route also
 * returns that block in full with each result, so shortening the guide
 * silently rewrites those results. The in-app chat system prompt composes some
 * of the same constants too, and an MCP client never sees it.
 */
export const SQL_DIALECT_GUIDE = [
  "SQL dialect guide.",
  ...SQL_DIALECT_DESCRIPTION_LINES,
  "Supported statements: SHOW TABLES, DESCRIBE <resource>, SHOW COLUMNS FROM <resource>, and SELECT on sql_query; INSERT, UPDATE, and DELETE on sql_execute.",
  `SELECT returns at most ${MAX_SQL_RECORD_LIMIT} rows per statement, and INSERT, UPDATE, and DELETE affect at most ${MAX_SQL_RECORD_LIMIT} rows per statement.`,
  "Paginate inside the SQL string with LIMIT and OFFSET; there is no cursor and no separate pagination argument. data.hasMore is true when rows remain after this page.",
  "A single SELECT whose result is too large comes back partial rather than failing whenever dropping rows leaves at least one row that fits; every other oversized read fails, so handle that error too. On a partial result data.rows holds the leading rows that fit, data.rowsTruncated is true, and data.totalRowCount reports how many rows the statement produced, i.e. after WHERE, UNNEST, and any GROUP BY. When those rows are not enough, narrow the query, or read the dropped rows by repeating it at OFFSET = data.offset + data.rowCount; the usual data.offset + data.limit step skips them, because data.limit stays the limit you asked for.",
  SQL_SELECT_SUPPORTED_FORMS_DESCRIPTION,
  SQL_MUTATION_WHERE_SUPPORTED_FORMS_DESCRIPTION,
  "Array columns (e.g. tags) take a parenthesized list: ('tag1', 'tag2'), or () for empty.",
  SQL_RETURNING_DESCRIPTION,
  "A write whose result is too large still succeeds and is never rejected for size: data.sqlOmitted true means the echoed data.sql and data.normalizedSql were shortened, and data.rowsOmitted true means the returned rows were dropped. Do not repeat that write; SELECT the rows an INSERT or UPDATE left when you need them, while rows a DELETE removed are gone, so use smaller batches to keep them.",
  SQL_BATCH_ATOMICITY_DESCRIPTION,
  SQL_BULK_WRITE_SPLIT_DESCRIPTION,
  "Examples (tool-call JSON):",
  ...SQL_QUERY_TOOL_PROMPT_EXAMPLE_LINES,
  ...SQL_EXECUTE_TOOL_PROMPT_EXAMPLE_LINES,
].join("\n");

function resolveCardWebAppOrigin(): string | undefined {
  try {
    return getConfiguredPublicAppOrigin();
  } catch {
    return undefined;
  }
}

const CARD_WEB_APP_ORIGIN: string | undefined = resolveCardWebAppOrigin();

/**
 * Where a card lives on the web, so an agent can hand the user a link instead of
 * an id alone. Filed under its own heading in `CARD_AUTHORING_GUIDE` below (see
 * `CARD_WEB_URL_GUIDE_LINES`) and spread into the in-app chat's card rules
 * (`buildCardRulesSection` in `apps/backend/src/chat/shared.ts`), which state
 * the `card_authoring` guide inline. It stays one sentence,
 * because the chat pays for it on every model call of every turn while the
 * guide body is fetched once on demand.
 *
 * It is not appended to a SQL result: `get_guide` serves a guide body with no
 * result-size budget, while every SQL result is measured
 * (`apps/backend/src/aiTools/agentSql/resultBudget.ts`), so the same sentence
 * appended to a write result would push a mutation sitting just under the
 * budget into truncation and cost it the payload it kept before.
 *
 * Empty when the deployment configured no usable app origin, whether it is
 * unset or set to a value `parsePublicOrigin` rejects: a self-hosted backend
 * without one has no link to give, and a template with a missing or malformed
 * host is worse than no line at all. Catching the rejection matters beyond the
 * text, because this resolves at module load on Lambdas that never call
 * `validatePublicUrlConfiguration()` (`apps/backend/src/entrypoints/lambda-mcp.ts`),
 * where a thrown parse error would fail the import and take the whole MCP
 * surface down over one cosmetic sentence. The explicit local policy
 * (`AUTH_MODE=none` with `ALLOW_INSECURE_LOCAL_AUTH=true` and no
 * `PUBLIC_APP_BASE_URL`) is the unset case on purpose: a `localhost` link would
 * be wrong for an agent talking to a deployed stack, and it is only a
 * development convenience.
 *
 * The places that advertise this subject do not follow that condition and
 * must not. `SQL_EXECUTE_TOOL_DESCRIPTION` above and `GET_GUIDE_TOOL_DESCRIPTION`
 * (`apps/backend/src/aiTools/toolRegistry/specs.ts`) name the web link in
 * `tools/list`, which is a published contract that must not vary by environment
 * and is measured in `apps/backend/src/mcp/toolBudgets.test.ts`;
 * `GUIDE_TOPIC_DESCRIPTIONS` below names it in the REST discovery topic list
 * (`apps/backend/src/agent/discovery.ts`), and `STUDY_GUIDE` points to it. A
 * deployment with no usable app origin therefore advertises a `card_authoring` topic whose body carries no
 * link line, which costs the agent a guide read that answers less than the
 * advertisement promised and nothing more.
 *
 * It names no surface-specific field, because `get_guide` answers the MCP and
 * chat tools and the REST agent routes alike, and only the tools put the
 * resolved workspace on the payload
 * (`apps/backend/src/aiTools/toolRegistry/specs.ts`). The route accepts any
 * workspace id this backend mints rather than a strict RFC 4122 UUID.
 *
 * The origin resolves once at module load, because `GUIDE_BODIES` below hands
 * its callers a plain string and serving a computed body would change that
 * map's value type and every lookup through it, so a test that sets
 * `PUBLIC_APP_BASE_URL` after importing this module does not move this line.
 */
export const CARD_WEB_URL_LINES: ReadonlyArray<string> = CARD_WEB_APP_ORIGIN === undefined
  ? []
  : [
    `A card's web link is ${CARD_WEB_APP_ORIGIN}/w/<workspaceId>/cards/<card_id>; card_id comes back from a SELECT on cards and from an INSERT or UPDATE without RETURNING (data.rows, or data.statements[].rows in a batch). Give it when the user asks where a card is.`,
  ];

/**
 * The workspace's web Review page, under the same origin and the same no-origin rule as
 * `CARD_WEB_URL_LINES`. One link per write rather than one per card: the per-card pattern above
 * already lets the model build a single card's link.
 */
export function buildWorkspaceReviewUrl(workspaceId: string): string | null {
  return CARD_WEB_APP_ORIGIN === undefined ? null : `${CARD_WEB_APP_ORIGIN}/w/${workspaceId}/review`;
}

/**
 * The same line under its own heading, the way every other subject in
 * `CARD_AUTHORING_GUIDE` is filed, so the guide does not read the web link as
 * part of its Markdown and LaTeX rules. Derived rather than folded into
 * `CARD_WEB_URL_LINES` so a deployment without a usable app origin leaves no
 * dangling heading, and so the chat's own card-authoring section
 * (`buildCardRulesSection` in `apps/backend/src/chat/shared.ts`) keeps paying
 * for the sentence alone.
 */
const CARD_WEB_URL_GUIDE_LINES: ReadonlyArray<string> =
  CARD_WEB_URL_LINES.length === 0 ? [] : ["Card web link:", ...CARD_WEB_URL_LINES];

export const CARD_AUTHORING_GUIDE = [
  "Card authoring guide.",
  FRONT_BACK_CONTRACT,
  "Back side:",
  ...CARD_BACK_SIDE_RULE_LINES,
  "Tags:",
  ...CARD_TAGGING_RULE_LINES,
  "Duplicate check before any creation:",
  ...CARD_DUPLICATE_CHECK_RULE_LINES,
  "Card style alignment:",
  ...CARD_STYLE_ALIGNMENT_RULE_LINES,
  "Generated images already in card text:",
  ...CARD_MANAGED_IMAGE_RULE_LINES,
  "Markdown and LaTeX:",
  CARD_AUTHORING_CONTRACT,
  `Example: ${CARD_AUTHORING_TOOL_CALL_EXAMPLE}`,
  ...CARD_WEB_URL_GUIDE_LINES,
].join("\n");

/**
 * The database time budget quoted below is the one enforced in
 * `apps/backend/src/aiTools/agentSql/databaseTimeBudget.ts`. Everything this
 * guide says about it is derived from that module and has to stay aligned with
 * it: the seconds, the QUERY_TIME_LIMIT_EXCEEDED code, the cost model that
 * follows rows touched rather than the caller's statement count, and the claim
 * that a batch at both caps ends in that error instead of landing.
 *
 * The recovery rules below key on `error.code` and name no HTTP status, because
 * a failed call returns an `error` object carrying only `code`, `message` and
 * `details`: a reader of this guide never sees the status an error was raised
 * with. The per-code remediation text from `createAgentRemediationInstructions`
 * (apps/backend/src/aiTools/toolContract/remediationInstructions.ts) reaches
 * the model next to this guide, inside `error.message` on MCP and the chat and
 * as `instructions` on REST, so the recovery rules below are kept consistent
 * with it. What each rule prescribes comes from the
 * write path's own failure sites. Every rejection `runSqlExecute` can raise -
 * from `parseSqlBatch` before the transaction opens, or from the mutation
 * executors inside it - leaves a never-opened or rolled-back transaction, so
 * nothing lands and the remedy is to fix the sql string; a spent budget cancels
 * the statement and takes its transaction down with it (databaseTimeBudget.ts),
 * so nothing lands there either and the remedy is a smaller batch; and a
 * transient failure at COMMIT becomes DATABASE_COMMIT_OUTCOME_UNKNOWN rather
 * than a rollback (`toDatabaseCommitBoundaryError` in
 * apps/backend/src/database/transient.ts), the one outcome that has to be read
 * back instead of retried, which is why it is stated first.
 *
 * No recommended batch size is named, because that module's numbers do not
 * support one: it records the 15 s budget, an 80 ms median execution, a
 * five-statement batch that took 17.0 s before the budget existed, and a cost
 * model counted in executor round trips (four per affected row on the mutation
 * path) rather than in time per row. That yields an upper bound already known
 * to fail and no per-row latency to divide the budget by, so the guide turns
 * the caps into ceilings and has the agent size batches from its own observed
 * call times instead.
 */
export const BULK_AUTHORING_GUIDE = [
  "Bulk authoring guide.",
  "Verify meanings and translations of generated content before saving; prefer fewer accurate cards.",
  SQL_BULK_WRITE_SPLIT_DESCRIPTION,
  SQL_BATCH_ATOMICITY_DESCRIPTION,
  "One sql_execute call also gets 15 seconds of database time; spending it fails with QUERY_TIME_LIMIT_EXCEEDED and cancels the transaction, so nothing lands.",
  `That time follows rows touched, not statements, so the ${MAX_SQL_RECORD_LIMIT}-row and ${MAX_SQL_BATCH_STATEMENT_COUNT}-statement caps are ceilings, not targets: a batch at both caps ends in that error instead of landing.`,
  `Plan the split before the first write: N cards need at least ceil(N / ${MAX_SQL_RECORD_LIMIT}) statements. Start with a small batch and grow the next one only while the observed call time leaves clear headroom under 15 seconds; an observed call also includes work outside the budget, so this errs toward smaller batches on purpose. The first call may carry cold start, so if it stands out, judge growth from the calls after it.`,
  "Save each batch as soon as it is ready; never draft the whole job before the first write: a run can stop at any time, and only committed batches survive.",
  "Resume a stopped job by reading back what landed, then write only the rest.",
  "Keep each batch meaningful on its own and never split one logical card across two batches.",
  "Run any SELECT in its own sql_query call before or after the write batch.",
  "An error does not always mean the batch rolled back, so read error.code before you retry.",
  "When the outcome is unknown - a DATABASE_COMMIT_OUTCOME_UNKNOWN error, or a run interrupted before you saw a result - the batch may already have committed: never re-send it blindly; SELECT what applied, then send only the missing rows.",
  "On QUERY_TIME_LIMIT_EXCEEDED nothing landed: retry the same rows in a smaller batch, never the same batch unchanged.",
  "On QUERY_INVALID_SQL or QUERY_UNSUPPORTED_SYNTAX nothing landed: fix the sql string; a smaller batch helps only when the rejection was one of the size caps.",
  "card_id is server-generated and INSERT rejects it: read back by the tags or front_text values you wrote, and keep the ids each INSERT returns.",
  "A successful write (ok true) with data.rowsOmitted true landed and only its returned rows were dropped; one cut short with top-level truncated true landed too and keeps in data only workspaceId, reviewUrl and the affected counts, the rest cut in dataPreview: never resend it; SELECT the ids back, or a count when what landed is unclear.",
  "When bulk updating or deleting, the card ids are the resume handle: keep the list you are working through and read back which already changed.",
  "Verify the finished job with a read-back SELECT that counts the rows you intended to write.",
  "RETURNING is enough for a small batch; use a separate SELECT when the returned text would be large.",
].join("\n");

/**
 * How studying works and how to explain it. Composes only the shared app clause: every other pointer
 * names the guide or tool that owns the detail.
 */
export const STUDY_GUIDE = [
  "Study guide.",
  `${NIBOMO_APP_CLAUSE}; the user's workspaces and cards are the same on every client and in every connected AI assistant.`,
  "How studying works: the user sees a saved card's front, recalls the answer, reveals the back and grades the recall Again, Hard, Good or Easy; the FSRS scheduler then decides when the card returns, sooner after a miss and later after each good recall. Only saved cards are scheduled.",
  "When the user asks how to study, prepare for an exam or practice: turn the material into saved cards (get_guide(card_authoring)), then study them in the app's Review or here with next_review_card, reveal_answer and submit_review (get_guide(review_flow)). Never invent manual repetition schedules or send the user to other apps; the scheduler owns timing.",
  "Explain this in a sentence or two in the user's terms (cards, Review, grades) unless they ask for more, and suggest a short Review of whatever is due each day. Do not answer a study request with long chat text that belongs on cards.",
  "When the user wants cards only in the chat, say once that such cards are not scheduled, then do what they asked.",
  "When nothing is due (next_review_card returns card:null): say so and give nextDueAt in the user's timezone, then offer to add cards or to practice without grading by quizzing from cards read with sql_query; never call submit_review for that practice.",
  "Pointing to cards: give a single card's web link (pattern in get_guide(card_authoring)); for a set, name its tag or deck, which the user finds in the app's Cards list and can study in Review.",
].join("\n");

/** The review loop is already one canonical block, so the guide is that block. */
export const REVIEW_FLOW_GUIDE = REVIEW_FLOW_INSTRUCTIONS;

export const GUIDE_TOPICS = Object.freeze([
  "study",
  "sql_dialect",
  "card_authoring",
  "bulk_authoring",
  "review_flow",
] as const);

export type GuideTopic = (typeof GUIDE_TOPICS)[number];

export const GUIDE_BODIES: Readonly<Record<GuideTopic, string>> = Object.freeze({
  study: STUDY_GUIDE,
  sql_dialect: SQL_DIALECT_GUIDE,
  card_authoring: CARD_AUTHORING_GUIDE,
  bulk_authoring: BULK_AUTHORING_GUIDE,
  review_flow: REVIEW_FLOW_GUIDE,
});

/**
 * One short "what this topic covers" phrase per guide, so a surface that has to
 * list the topics renders them from here instead of spelling the names out
 * again: the `Record<GuideTopic, string>` makes adding, removing, or renaming a
 * topic a type error at this map rather than stale prose somewhere else. Each
 * value reads as the tail of `<topic> for <description>`.
 */
export const GUIDE_TOPIC_DESCRIPTIONS: Readonly<Record<GuideTopic, string>> = Object.freeze({
  study: "how studying works, how to explain it, and what to do when nothing is due",
  sql_dialect: "the full grammar, limits, and examples",
  card_authoring: "the card side contract, tags, duplicate checks, matching the user's existing card style, preserving images already in card text, Markdown and LaTeX formatting, and where a card lives on the web",
  bulk_authoring: "splitting and verifying a large write job",
  review_flow: "the review and rating loop",
});

/** How the REST guide route in `apps/backend/src/routes/agent.ts` frames a returned guide body. */
export const GET_GUIDE_RESULT_INSTRUCTIONS =
  "This is reference material for you, not text to show the user and not card content. Apply it for the rest of this task, and call get_guide again with another topic when you need a different area.";
