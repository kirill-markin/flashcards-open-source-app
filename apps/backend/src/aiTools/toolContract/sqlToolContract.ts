import type { FunctionTool } from "openai/resources/responses/responses";
import { z } from "zod";
import { MAX_SQL_BATCH_STATEMENT_COUNT, MAX_SQL_RECORD_LIMIT } from "./sqlToolLimits";

export const SQL_TOOL_NAME = "sql";
export const SQL_QUERY_TOOL_NAME = "sql_query";
export const SQL_EXECUTE_TOOL_NAME = "sql_execute";

/**
 * Flashcard side contract, mandatory across all clients and APIs: `front_text`
 * is only a question/review prompt, never the answer, and `back_text` holds the
 * answer. Shared so the MCP tools and the in-app AI agent stay on one contract.
 */
export const FRONT_BACK_CONTRACT =
  "Card side contract: front_text is only a question or review prompt and must never contain the answer; back_text contains the answer, optionally with a concrete example (prefer a fenced markdown code block when helpful).";

/**
 * Canonical Markdown and LaTeX authoring contract for every agent surface.
 * Card content stays untouched; agents author decoded values and verify writes.
 */
export const CARD_AUTHORING_CONTRACT =
  "Card fields hold decoded Markdown, real LFs, supported LaTeX. One LF stays within its Markdown paragraph; two make a blank line/new paragraph; literal `\\n` never lays out content. At JSON boundary, `\\n` becomes LF, `\\\\frac` becomes stored `\\frac`, while double-escaped `\\\\n` stores literal `\\n`. Use `$...$` and top-level delimiter-only `$$` lines as standalone blocks. Keep math outside other Markdown. After multiline/LaTeX writes, compare read-back with intended decoded text; repair only accidental transport double-escaping, preserving literal escapes intentionally requested/taught by user/card.";

export const CARD_AUTHORING_TOOL_CALL_EXAMPLE =
  "{\"sql\":\"INSERT INTO cards (front_text, back_text, tags) VALUES ('Question?', 'Answer\\n\\n$$\\n\\\\frac{a}{b}\\n$$', ('math'))\"}";

export const SQL_TOOL_ARGUMENT_VALIDATOR = z.object({
  sql: z.string().trim().min(1),
}).strict();

/**
 * Read-only example lines for the split `sql_query` surface. They cover only
 * the read statements (`SHOW TABLES`, `DESCRIBE`, `SHOW COLUMNS`, `SELECT`).
 */
export const SQL_QUERY_TOOL_PROMPT_EXAMPLE_LINES = Object.freeze([
  "- sql_query => {\"sql\": \"SHOW TABLES\"}",
  "- sql_query => {\"sql\": \"DESCRIBE workspace\"}",
  "- sql_query => {\"sql\": \"SHOW COLUMNS FROM cards\"}",
  "- sql_query => {\"sql\": \"SELECT * FROM cards ORDER BY created_at DESC, card_id ASC LIMIT 20 OFFSET 0\"}",
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
  "- sql_query => {\"sql\": \"SELECT card_id, front_text, back_text, tags FROM cards WHERE tags OVERLAP ('english', 'slang') ORDER BY created_at DESC, card_id ASC LIMIT 20 OFFSET 0\"}",
]);

/**
 * Write-only example lines for the split `sql_execute` surface. They cover only
 * the mutation statements (`INSERT`, `UPDATE`, `DELETE`).
 */
export const SQL_EXECUTE_TOOL_PROMPT_EXAMPLE_LINES = Object.freeze([
  `- sql_execute => ${CARD_AUTHORING_TOOL_CALL_EXAMPLE}`,
  "- sql_execute => {\"sql\": \"INSERT INTO cards (front_text, back_text, tags) VALUES ('Q?', 'A', ('grammar', 'a1'))\"}",
  "- sql_execute => {\"sql\": \"INSERT INTO cards (front_text, back_text, tags) VALUES ('Q?', 'A', ())\"}",
  "- sql_execute => {\"sql\": \"UPDATE cards SET back_text = 'Updated answer' WHERE card_id = '00000000-0000-4000-8000-000000000000'\"}",
  "- sql_execute => {\"sql\": \"UPDATE cards SET back_text = 'First update' WHERE card_id = '00000000-0000-4000-8000-000000000000'; UPDATE cards SET back_text = 'Second update' WHERE card_id = '00000000-0000-4000-8000-000000000001'\"}",
  "- sql_execute => {\"sql\": \"DELETE FROM decks WHERE deck_id IN ('00000000-0000-4000-8000-000000000000')\"}",
  "- sql_execute => {\"sql\": \"DELETE FROM cards WHERE tags OVERLAP ('some-tag')\"}",
  "- sql_execute => {\"sql\": \"INSERT INTO cards (front_text, back_text, tags) VALUES ('Q?', 'A', ('grammar')) RETURNING card_id, front_text, back_text\"}",
  "- sql_execute => {\"sql\": \"DELETE FROM cards WHERE card_id = '00000000-0000-4000-8000-000000000000' RETURNING *\"}",
]);

/**
 * Combined read+write example lines for the internal in-app chat `sql` tool,
 * which intentionally stays a single tool. Built from the split read/write
 * lines (with the `sql` tool prefix) so all surfaces stay on one DSL.
 */
export const SQL_TOOL_PROMPT_EXAMPLE_LINES = Object.freeze([
  ...SQL_QUERY_TOOL_PROMPT_EXAMPLE_LINES,
  ...SQL_EXECUTE_TOOL_PROMPT_EXAMPLE_LINES,
].map((line) => line.replace(/^- sql_query => /, "- sql => ").replace(/^- sql_execute => /, "- sql => ")));

/**
 * Shared dialect description fragment reused by the combined and split SQL tool
 * descriptions so every surface advertises the same limits and semantics.
 */
const SQL_DIALECT_DESCRIPTION_LINES = Object.freeze([
  "This is not full PostgreSQL.",
  CARD_AUTHORING_CONTRACT,
  "Cards, decks, review_events, and workspace are already scoped to the selected workspace.",
  "Use one JSON object: {\"sql\": \"...\"}.",
  "Public docs: https://flashcards-open-source-app.com/docs/mcp-connector/ and https://flashcards-open-source-app.com/docs/api/.",
  "Published resources: workspace, cards, decks, review_events.",
  "Resource semantics: cards have no deck_id column and no deck membership.",
  "A deck is a saved tag filter whose tags column defines the filter, so the only association between a card and a deck is matching tags.",
  "Decks expose deck_id, name, tags, created_at, updated_at, and deleted_at, and have no description column.",
  "deleted_at exists only on cards and decks, is returned by reads, and can never appear in a WHERE clause or in ORDER BY.",
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
 * Every outcome claim here is read out of the evaluator. Do not add an intuited
 * one: it would ship a wrong mental model into the in-app and MCP SQL tool
 * descriptions.
 */
const SQL_TEXT_COLUMN_FORMS_DESCRIPTION =
  "LIKE, NOT LIKE, ILIKE, their LOWER(column) variants, and LOWER(column) = 'value' apply only to text-valued columns, meaning the string, uuid, and datetime column types; on array columns such as tags they are rejected with a clear error. LOWER(column) IN (...) and LOWER(column) NOT IN (...) compare text values only; plain column IN (...) compares the column value exactly, so pass integer and boolean literals unquoted. On an array column such as tags none of these IN forms are rejected, but they all match no rows. The negated form exists only as LOWER(column) NOT IN (...); a plain column NOT IN (...) is rejected as an unsupported predicate for every column type. Match tags with tags OVERLAP ('english') or tags = ('english', 'slang') instead. metadata is neither filterable nor sortable, so it can never appear in WHERE or ORDER BY.";

/**
 * Shared supported-forms sentence reused by the split `sql_query` description
 * and the combined in-app `sql` tool description so both surfaces advertise the
 * same SELECT grammar.
 */
const SQL_SELECT_SUPPORTED_FORMS_DESCRIPTION =
  `SELECT supports projected column lists, COUNT(*), SUM, AVG, MIN, MAX, GROUP BY, NOW(), standalone ORDER BY RANDOM(), and cards UNNEST tags AS tag. SELECT WHERE clauses support ${SQL_WHERE_SUPPORTED_FORMS_DESCRIPTION}. ${SQL_TEXT_COLUMN_FORMS_DESCRIPTION}`;

/**
 * Tag filtering on the write side. `UNNEST` only exists in `SELECT`, so `OVERLAP`
 * is the only way to target rows by tag in `UPDATE` and `DELETE`.
 */
const SQL_MUTATION_TAG_FILTER_DESCRIPTION =
  "Filter by tag in UPDATE and DELETE with tags OVERLAP ('tag'), because UNNEST is only available in SELECT.";

/**
 * Write-side result projection, shared by every write surface.
 */
export const SQL_RETURNING_DESCRIPTION =
  "INSERT, UPDATE, and DELETE accept a trailing RETURNING * or RETURNING col1, col2 clause; without it INSERT and UPDATE return only the identifier column and DELETE returns no rows. DELETE RETURNING reports each row as it was before deletion. Prefer a narrow column list over RETURNING *.";

/**
 * Write-side mirror of the WHERE grammar for the MCP `sql_execute` description,
 * composed from the same predicate guidance as the in-app `sql` description.
 * Runtime parsing lives in `apps/backend/src/aiTools/sqlDialect/predicateParser.ts`.
 */
const SQL_MUTATION_WHERE_SUPPORTED_FORMS_DESCRIPTION =
  `UPDATE and DELETE WHERE clauses support ${SQL_WHERE_SUPPORTED_FORMS_DESCRIPTION}. ${SQL_TEXT_COLUMN_FORMS_DESCRIPTION} ${SQL_MUTATION_TAG_FILTER_DESCRIPTION}`;

/**
 * Self-contained bulk-write split arithmetic for every write surface, so an
 * agent can size a batch without cross-referencing other description lines.
 *
 * Deliberately limited to the three limits the dialect actually enforces on
 * every write surface. Result-payload budgets differ per surface (`sql_query`
 * rejects an oversized payload, `sql_execute` drops the returned rows of the
 * already committed write, and the in-app `sql` tool truncates), so they are not
 * stated here.
 */
const SQL_BULK_WRITE_SPLIT_DESCRIPTION =
  `Bulk-write split arithmetic: at most ${MAX_SQL_RECORD_LIMIT} rows affected per statement, at most ${MAX_SQL_BATCH_STATEMENT_COUNT} statements per batch, and a batch must not mix read and write statements. Split larger work across separate statements or separate tool calls.`;

/**
 * Read-only contract description for the split `sql_query` surface.
 */
export const SQL_QUERY_TOOL_DESCRIPTION = [
  "Use this when you need to read from the flashcards workspace with the published SQL dialect.",
  ...SQL_DIALECT_DESCRIPTION_LINES,
  "Supported statements: SHOW TABLES, DESCRIBE <resource>, SHOW COLUMNS FROM <resource>, SELECT.",
  "This tool is read-only and rejects INSERT, UPDATE, and DELETE; use sql_execute for writes.",
  `SELECT returns at most ${MAX_SQL_RECORD_LIMIT} rows per statement.`,
  SQL_SELECT_SUPPORTED_FORMS_DESCRIPTION,
  "Examples (tool-call JSON):",
  ...SQL_QUERY_TOOL_PROMPT_EXAMPLE_LINES,
].join(" ");

/**
 * Write contract description for the split `sql_execute` surface.
 */
export const SQL_EXECUTE_TOOL_DESCRIPTION = [
  "Use this when you need to write to the flashcards workspace with the published SQL dialect.",
  ...SQL_DIALECT_DESCRIPTION_LINES,
  "Supported statements: INSERT, UPDATE, DELETE.",
  "This tool is write-only and rejects SHOW TABLES, DESCRIBE, SHOW COLUMNS, and SELECT; use sql_query for reads.",
  "Mutation batches are applied atomically: all statements succeed or the whole batch fails.",
  SQL_BULK_WRITE_SPLIT_DESCRIPTION,
  "Array columns (e.g. tags) take a parenthesized list: ('tag1', 'tag2'), or () for empty.",
  SQL_RETURNING_DESCRIPTION,
  SQL_MUTATION_WHERE_SUPPORTED_FORMS_DESCRIPTION,
  "Examples (tool-call JSON):",
  ...SQL_EXECUTE_TOOL_PROMPT_EXAMPLE_LINES,
].join(" ");

export const OPENAI_SQL_TOOL: FunctionTool = {
  type: "function",
  name: SQL_TOOL_NAME,
  description: [
    "Query and mutate the flashcards workspace with the published SQL dialect.",
    ...SQL_DIALECT_DESCRIPTION_LINES,
    "Supported statements: SHOW TABLES, DESCRIBE <resource>, SHOW COLUMNS FROM <resource>, SELECT, INSERT, UPDATE, DELETE.",
    "Mutation batches are applied atomically: all statements succeed or the whole batch fails.",
    `SELECT returns at most ${MAX_SQL_RECORD_LIMIT} rows per statement.`,
    SQL_BULK_WRITE_SPLIT_DESCRIPTION,
    SQL_SELECT_SUPPORTED_FORMS_DESCRIPTION,
    "UPDATE and DELETE WHERE clauses support the same forms as SELECT WHERE clauses.",
    SQL_MUTATION_TAG_FILTER_DESCRIPTION,
    "Array columns (e.g. tags) take a parenthesized list: ('tag1', 'tag2'), or () for empty.",
    SQL_RETURNING_DESCRIPTION,
    "Examples (tool-call JSON):",
    ...SQL_TOOL_PROMPT_EXAMPLE_LINES,
  ].join(" "),
  strict: false,
  parameters: {
    type: "object",
    properties: {
      sql: {
        type: "string",
      },
    },
    required: ["sql"],
    additionalProperties: false,
  },
};
