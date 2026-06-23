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
]);

/**
 * Write-only example lines for the split `sql_execute` surface. They cover only
 * the mutation statements (`INSERT`, `UPDATE`, `DELETE`).
 */
export const SQL_EXECUTE_TOOL_PROMPT_EXAMPLE_LINES = Object.freeze([
  "- sql_execute => {\"sql\": \"INSERT INTO cards (front_text, back_text, tags) VALUES ('Question?', 'Answer', ('tag'))\"}",
  "- sql_execute => {\"sql\": \"INSERT INTO cards (front_text, back_text, tags) VALUES ('Q?', 'A', ('grammar', 'a1'))\"}",
  "- sql_execute => {\"sql\": \"INSERT INTO cards (front_text, back_text, tags) VALUES ('Q?', 'A', ())\"}",
  "- sql_execute => {\"sql\": \"UPDATE cards SET back_text = 'Updated answer' WHERE card_id = '00000000-0000-4000-8000-000000000000'\"}",
  "- sql_execute => {\"sql\": \"UPDATE cards SET back_text = 'First update' WHERE card_id = '00000000-0000-4000-8000-000000000000'; UPDATE cards SET back_text = 'Second update' WHERE card_id = '00000000-0000-4000-8000-000000000001'\"}",
  "- sql_execute => {\"sql\": \"DELETE FROM decks WHERE deck_id IN ('00000000-0000-4000-8000-000000000000')\"}",
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
  "Cards, decks, review_events, and workspace are already scoped to the selected workspace.",
  "Use one JSON object: {\"sql\": \"...\"}.",
  "Published resources: workspace, cards, decks, review_events.",
  "Multiple supported statements may be separated with semicolons in one sql string.",
  `A batch may contain at most ${MAX_SQL_BATCH_STATEMENT_COUNT} statements.`,
]);

/**
 * Read-only contract description for the split `sql_query` surface.
 */
export const SQL_QUERY_TOOL_DESCRIPTION = [
  "Use this when you need to read from the flashcards workspace with the published SQL dialect.",
  ...SQL_DIALECT_DESCRIPTION_LINES,
  "Supported statements: SHOW TABLES, DESCRIBE <resource>, SHOW COLUMNS FROM <resource>, SELECT.",
  "This tool is read-only and rejects INSERT, UPDATE, and DELETE; use sql_execute for writes.",
  `SELECT returns at most ${MAX_SQL_RECORD_LIMIT} rows per statement.`,
  "SELECT supports projected column lists, LIKE, LOWER(column) = 'value', LOWER(column) IN (...), and LOWER(column) NOT IN (...) for case-insensitive exact string matches, COUNT(*), SUM, AVG, MIN, MAX, GROUP BY, NOW(), standalone ORDER BY RANDOM(), and cards UNNEST tags AS tag.",
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
  `INSERT, UPDATE, and DELETE may affect at most ${MAX_SQL_RECORD_LIMIT} rows per statement.`,
  `If you need to create, update, or delete more than ${MAX_SQL_RECORD_LIMIT} records, split the work into multiple batches of at most ${MAX_SQL_RECORD_LIMIT} records across separate SQL statements or separate tool calls.`,
  "Array columns (e.g. tags) take a parenthesized list: ('tag1', 'tag2'), or () for empty.",
  "Examples (tool-call JSON):",
  ...SQL_EXECUTE_TOOL_PROMPT_EXAMPLE_LINES,
].join(" ");

export const OPENAI_SQL_TOOL: FunctionTool = {
  type: "function",
  name: SQL_TOOL_NAME,
  description: [
    "Query and mutate the flashcards workspace with the published SQL dialect.",
    "This is not full PostgreSQL.",
    "Cards, decks, review_events, and workspace are already scoped to the selected workspace.",
    "Use one JSON object: {\"sql\": \"...\"}.",
    "Published resources: workspace, cards, decks, review_events.",
    "Supported statements: SHOW TABLES, DESCRIBE <resource>, SHOW COLUMNS FROM <resource>, SELECT, INSERT, UPDATE, DELETE.",
    "Multiple supported statements may be separated with semicolons in one sql string.",
    `A batch may contain at most ${MAX_SQL_BATCH_STATEMENT_COUNT} statements.`,
    "A batch must contain only read statements or only mutation statements.",
    "Mutation batches are applied atomically: all statements succeed or the whole batch fails.",
    `SELECT returns at most ${MAX_SQL_RECORD_LIMIT} rows per statement.`,
    `INSERT, UPDATE, and DELETE may affect at most ${MAX_SQL_RECORD_LIMIT} rows per statement.`,
    `If you need to create, update, or delete more than ${MAX_SQL_RECORD_LIMIT} records, split the work into multiple batches of at most ${MAX_SQL_RECORD_LIMIT} records across separate SQL statements or separate tool calls.`,
    "SELECT supports projected column lists, LIKE, LOWER(column) = 'value', LOWER(column) IN (...), and LOWER(column) NOT IN (...) for case-insensitive exact string matches, COUNT(*), SUM, AVG, MIN, MAX, GROUP BY, NOW(), standalone ORDER BY RANDOM(), and cards UNNEST tags AS tag.",
    "Array columns (e.g. tags) take a parenthesized list: ('tag1', 'tag2'), or () for empty.",
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
