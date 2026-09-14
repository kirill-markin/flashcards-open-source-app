import type { FunctionTool } from "openai/resources/responses/responses";
import { z } from "zod";
import { REVIEW_FLOW_INSTRUCTIONS } from "../../agent/reviewContract";
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
  "Card side contract: front_text is only a question or review prompt and must never contain the answer; back_text contains the answer, optionally with a concrete example (prefer a fenced markdown code block when helpful). Keep front_text short by default, usually one word, a term, or a brief phrase rather than a full sentence question, while back_text may still be long; write a longer front_text only when the user asks for it or when similar existing cards in the same deck, tag, or topic already use long fronts.";

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
  "- When the back side is longer than one short sentence, format it as real Markdown instead of dense plain text.",
  "- Use blank lines between paragraphs on longer back sides so the rendered card stays readable.",
  "- Use short Markdown lists when they improve scanability.",
  "- Include concrete examples by default when creating a card unless the user explicitly asks not to.",
  "- For code cards, concrete code snippets are preferred inside the card content itself, usually in fenced Markdown code blocks on the back side.",
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
  "- Before proposing or executing any new card or deck creation, you must first inspect the workspace for exact or similar items with a SELECT read.",
  "- You must summarize what you found and discuss possible duplicates or overlap with the user before proposing a creation plan.",
]);

/**
 * Style-alignment rules that keep generated cards close to the cards the user
 * already writes, shared by the chat system prompt and the MCP
 * `card_authoring` guide.
 */
export const CARD_STYLE_ALIGNMENT_RULE_LINES = Object.freeze([
  "- When creating new cards or editing existing cards, if the user did not ask for a specific format, first inspect a small set of related existing cards with a SELECT read.",
  "- Infer the user's local card style from similar cards and follow it unless it would violate the card side contract.",
  "- Preserve patterns such as one-word fronts, topic-specific examples on backs, punctuation choices, sentence length, Markdown density, and tag style.",
  "- If similar cards conflict, prefer the pattern from the closest topic or deck and keep the proposed change simple.",
]);

export const SQL_TOOL_ARGUMENT_VALIDATOR = z.object({
  sql: z.string().trim().min(1),
}).strict();

/**
 * The read examples pulled out for descriptions under a character budget: one
 * stably ordered paged read, and one tag filter, because tags are the only
 * association between a card and a deck. They stay part of the full example
 * list below, which the `sql_dialect` guide serves in full.
 */
const SQL_QUERY_PAGED_READ_EXAMPLE_LINE =
  "- sql_query => {\"sql\": \"SELECT * FROM cards ORDER BY created_at DESC, card_id ASC LIMIT 20 OFFSET 0\"}";
const SQL_QUERY_TAG_FILTER_EXAMPLE_LINE =
  "- sql_query => {\"sql\": \"SELECT card_id, front_text, back_text, tags FROM cards WHERE tags OVERLAP ('english', 'slang') ORDER BY created_at DESC, card_id ASC LIMIT 20 OFFSET 0\"}";

/**
 * The full read-only example list for the `sql_query` surface, covering only
 * the read statements (`SHOW TABLES`, `DESCRIBE`, `SHOW COLUMNS`, `SELECT`).
 * It is served in full by `SQL_DIALECT_GUIDE` and by the in-app chat system
 * prompt; descriptions under a character budget advertise only the lines pulled
 * out above.
 */
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

/**
 * The write examples pulled out for descriptions under a character budget:
 * one tagged card creation that reads its own result back through RETURNING,
 * and one tag-filtered mutation, the only way to target rows by tag on the
 * write side. They stay part of the full example list below, which the
 * `sql_dialect` guide serves in full.
 */
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
 * Rewrites a split-surface example line onto the combined in-app `sql` tool
 * name, so every surface stays on one DSL and no example is restated by hand.
 */
function toInAppSqlExampleLine(line: string): string {
  return line.replace(/^- sql_query => /, "- sql => ").replace(/^- sql_execute => /, "- sql => ");
}

/**
 * Combined read+write example lines for the internal in-app chat `sql` tool,
 * which intentionally stays a single tool. Built from the split read/write
 * lines (with the `sql` tool prefix) so all surfaces stay on one DSL.
 */
export const SQL_TOOL_PROMPT_EXAMPLE_LINES = Object.freeze([
  ...SQL_QUERY_TOOL_PROMPT_EXAMPLE_LINES,
  ...SQL_EXECUTE_TOOL_PROMPT_EXAMPLE_LINES,
].map(toInAppSqlExampleLine));

/**
 * Shared dialect description fragment. `SQL_DIALECT_GUIDE` is its only
 * consumer: no SQL tool description composes it, because every tool description
 * is metadata under a character budget and restates only the few facts a call
 * cannot get right by guessing.
 *
 * On MCP the rest is reachable through `get_guide` topic `sql_dialect`.
 * `sql_query` names that topic in its own description; `sql_execute` has no
 * room to, and relies on `GET_GUIDE_TOOL_DESCRIPTION`, `SERVER_INSTRUCTIONS`,
 * and the `QUERY_INVALID_SQL` instruction in `apps/backend/src/mcp/server.ts`
 * naming it instead.
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
 * Every outcome claim here is read out of the evaluator. Do not add an intuited
 * one: it would ship a wrong mental model into `SQL_DIALECT_GUIDE` and the
 * in-app chat system prompt. No tool description composes it, so it is not
 * under a character budget.
 */
const SQL_TEXT_COLUMN_FORMS_DESCRIPTION =
  "LIKE, NOT LIKE, ILIKE, their LOWER(column) variants, and LOWER(column) = 'value' apply only to text-valued columns, meaning the string, uuid, and datetime column types; on array columns such as tags they are rejected with a clear error. LOWER(column) IN (...) and LOWER(column) NOT IN (...) compare text values only; plain column IN (...) compares the column value exactly, so pass integer and boolean literals unquoted. On an array column such as tags none of these IN forms are rejected, but they all match no rows. The negated form exists only as LOWER(column) NOT IN (...); a plain column NOT IN (...) is rejected as an unsupported predicate for every column type. Match tags with tags OVERLAP ('english') or tags = ('english', 'slang') instead. metadata is neither filterable nor sortable, so it can never appear in WHERE or ORDER BY.";

/**
 * Shared supported-forms sentence reused by `SQL_DIALECT_GUIDE` and by the
 * in-app chat system prompt, so both advertise the same SELECT grammar. No tool
 * description carries it: the MCP `sql_query` description points at the
 * `sql_dialect` guide instead, and the in-app `sql` description points at the
 * system instructions.
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
 * Write-side result projection, shared by `SQL_DIALECT_GUIDE`, the in-app chat
 * system prompt, and the agent discovery payload in
 * `apps/backend/src/agent/discovery.ts`. Descriptions under a character budget,
 * such as the always-loaded MCP `sql_execute` description, state the same rule
 * in one shorter sentence of their own instead of composing this constant.
 */
export const SQL_RETURNING_DESCRIPTION =
  "INSERT, UPDATE, and DELETE accept a trailing RETURNING * or RETURNING col1, col2 clause; without it INSERT and UPDATE return only the identifier column and DELETE returns no rows. DELETE RETURNING reports each row as it was before deletion. Prefer a narrow column list over RETURNING *.";

/**
 * Write-side mirror of the WHERE grammar, composed from the same predicate
 * guidance as `SQL_SELECT_SUPPORTED_FORMS_DESCRIPTION`. `SQL_DIALECT_GUIDE` is
 * its only consumer: the always-loaded MCP `sql_execute` description has no room
 * for the grammar, so a caller reaches it through `get_guide` topic
 * `sql_dialect`, which `sql_execute` has no room to name either.
 * Runtime parsing lives in `apps/backend/src/aiTools/sqlDialect/predicateParser.ts`.
 */
const SQL_MUTATION_WHERE_SUPPORTED_FORMS_DESCRIPTION =
  `UPDATE and DELETE WHERE clauses support ${SQL_WHERE_SUPPORTED_FORMS_DESCRIPTION}. ${SQL_TEXT_COLUMN_FORMS_DESCRIPTION} ${SQL_MUTATION_TAG_FILTER_DESCRIPTION}`;

/**
 * Batch atomicity, shared by `SQL_DIALECT_GUIDE` and `BULK_AUTHORING_GUIDE`.
 * Descriptions under a character budget - the always-loaded MCP `sql_execute`
 * description and the in-app `sql` tool description - make the same
 * all-or-nothing promise in their own condensed words, so a change here does
 * not reach them.
 */
export const SQL_BATCH_ATOMICITY_DESCRIPTION =
  "Mutation batches are applied atomically: all statements succeed or the whole batch fails.";

/**
 * Self-contained bulk-write split arithmetic for the in-app chat system prompt,
 * `SQL_DIALECT_GUIDE`, and `BULK_AUTHORING_GUIDE`, so an agent can size a batch
 * without cross-referencing other lines. The always-loaded MCP `sql_execute`
 * description restates the same caps in one shorter sentence instead of
 * composing this constant.
 *
 * Deliberately limited to the three limits the dialect actually enforces on
 * every write surface. Result-payload budgets differ per surface (`sql_query`
 * rejects an oversized payload; `sql_execute` shrinks the already committed
 * write instead, shortening the echoed statement text first and only when that
 * makes the emitted payload smaller, then dropping the returned rows if the
 * payload is still over budget; and the in-app `sql` tool truncates its own
 * serialized result in `capSerializedEnvelope`,
 * `apps/backend/src/chat/openai/tools/tools.ts`), so they are not stated here.
 */
export const SQL_BULK_WRITE_SPLIT_DESCRIPTION =
  `Bulk-write split arithmetic: at most ${MAX_SQL_RECORD_LIMIT} rows affected per statement, at most ${MAX_SQL_BATCH_STATEMENT_COUNT} statements per batch, and a batch must not mix read and write statements. Split larger work across separate statements or separate tool calls.`;

/**
 * Read-only contract description for the split `sql_query` surface.
 *
 * Always-loaded tool metadata, so it is kept to the routing facts a caller
 * cannot guess and two examples. The grammar, the text-column rules, and the
 * rest of the examples stay in `SQL_DIALECT_GUIDE`, which `get_guide` serves on
 * demand and which this description points at by name.
 */
export const SQL_QUERY_TOOL_DESCRIPTION = [
  "Read the flashcards workspace with the published SQL dialect.",
  "Supported statements: SHOW TABLES, DESCRIBE <resource>, SHOW COLUMNS FROM <resource>, SELECT. Writes are rejected; use sql_execute.",
  "Published resources, already workspace-scoped: workspace, cards, decks, review_events. A deck is a saved tag filter, so a card has no deck_id and belongs to a deck only by matching tags.",
  `SELECT returns at most ${MAX_SQL_RECORD_LIMIT} rows per statement; page with LIMIT and OFFSET and prefer a stable ORDER BY.`,
  "Schema discovery must be its own call: a batch is composed before any statement runs.",
  "Examples:",
  SQL_QUERY_PAGED_READ_EXAMPLE_LINE,
  SQL_QUERY_TAG_FILTER_EXAMPLE_LINE,
  "Call get_guide with topic sql_dialect for the full grammar and examples.",
].join(" ");

/**
 * Write contract description for the split `sql_execute` surface.
 *
 * Always-loaded tool metadata, so it carries only the product rules a write
 * must not get wrong, the write-side limits, and two examples. The Markdown and
 * LaTeX contract, the style and duplicate procedure, and the batch-sizing rules
 * stay in `CARD_AUTHORING_GUIDE`, `SQL_DIALECT_GUIDE`, and
 * `BULK_AUTHORING_GUIDE`, which `get_guide` serves on demand.
 */
export const SQL_EXECUTE_TOOL_DESCRIPTION = [
  "Write to the flashcards workspace with the published SQL dialect.",
  "front_text is only a question and never the answer; back_text holds the answer.",
  "Every new card needs at least one tag; reuse existing workspace tags.",
  "Check for duplicates with sql_query before creating.",
  "Supported statements: INSERT, UPDATE, DELETE. Reads are rejected; use sql_query.",
  `Up to ${MAX_SQL_BATCH_STATEMENT_COUNT} semicolon-separated statements per sql string, at most ${MAX_SQL_RECORD_LIMIT} rows each; batches are atomic and must not mix reads and writes.`,
  "Array columns like tags take a parenthesized list: ('a', 'b'), or () to clear.",
  "Add RETURNING * or a column list to see the affected rows.",
  SQL_MUTATION_TAG_FILTER_DESCRIPTION,
  "Examples:",
  SQL_EXECUTE_CREATE_CARD_EXAMPLE_LINE,
  SQL_EXECUTE_TAG_FILTER_EXAMPLE_LINE,
  "Call get_guide with topic card_authoring before authoring.",
].join(" ");

/**
 * Combined read+write tool for the in-app chat, which intentionally stays a
 * single tool.
 *
 * OpenAI caps a function description at 1024 characters, so this one carries
 * only the routing facts a call cannot guess plus one read and one write
 * example. The grammar, the text-column rules, RETURNING, the batch-sizing
 * arithmetic, and the full example list live in the chat system prompt
 * (`buildSystemInstructions` in `apps/backend/src/chat/shared.ts`), which has no
 * such cap; the in-app chat has no `get_guide` tool to reach a guide with.
 */
export const OPENAI_SQL_TOOL: FunctionTool = {
  type: "function",
  name: SQL_TOOL_NAME,
  description: [
    "Query and mutate the flashcards workspace with the published SQL dialect.",
    "Supported statements: SHOW TABLES, DESCRIBE <resource>, SHOW COLUMNS FROM <resource>, SELECT, INSERT, UPDATE, DELETE.",
    "Published resources, already workspace-scoped: workspace, cards, decks, review_events. A deck is a saved tag filter, so a card has no deck_id and belongs to a deck only by matching tags.",
    `Each statement reads or affects at most ${MAX_SQL_RECORD_LIMIT} rows; up to ${MAX_SQL_BATCH_STATEMENT_COUNT} semicolon-separated statements in one sql string form one batch, and a batch is applied atomically.`,
    "Examples (tool-call JSON):",
    toInAppSqlExampleLine(SQL_QUERY_PAGED_READ_EXAMPLE_LINE),
    toInAppSqlExampleLine(SQL_EXECUTE_CREATE_CARD_EXAMPLE_LINE),
    "The full grammar and the authoring contract are in the system instructions.",
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

/**
 * On-demand guide bodies for the MCP `get_guide` tool.
 *
 * Every guide is composed from the constants above (and from
 * `REVIEW_FLOW_INSTRUCTIONS`) rather than restating them, so a rule that
 * changes in its own constant changes in the guide too. Guides are the intended
 * home for the long tail of instructions a client only needs at a specific
 * moment.
 *
 * Before trimming or editing a guide body, grep for every constant it composes:
 * a guide body is not proof the text lives only there, and several constants
 * are shared with other surfaces. The highest-risk one is `REVIEW_FLOW_GUIDE`,
 * which is `REVIEW_FLOW_INSTRUCTIONS` itself; every MCP review tool also
 * returns that block in full with each tool result, so shortening the guide
 * silently rewrites those results. The in-app chat system prompt,
 * `OPENAI_SQL_TOOL`, and the agent discovery payload compose some of the same
 * constants too, and an MCP client sees none of those.
 */
export const SQL_DIALECT_GUIDE = [
  "SQL dialect guide.",
  ...SQL_DIALECT_DESCRIPTION_LINES,
  "Supported statements: SHOW TABLES, DESCRIBE <resource>, SHOW COLUMNS FROM <resource>, and SELECT on sql_query; INSERT, UPDATE, and DELETE on sql_execute.",
  `SELECT returns at most ${MAX_SQL_RECORD_LIMIT} rows per statement, and INSERT, UPDATE, and DELETE affect at most ${MAX_SQL_RECORD_LIMIT} rows per statement.`,
  "Paginate inside the SQL string with LIMIT and OFFSET; there is no cursor and no separate pagination argument.",
  SQL_SELECT_SUPPORTED_FORMS_DESCRIPTION,
  SQL_MUTATION_WHERE_SUPPORTED_FORMS_DESCRIPTION,
  "Array columns (e.g. tags) take a parenthesized list: ('tag1', 'tag2'), or () for empty.",
  SQL_RETURNING_DESCRIPTION,
  SQL_BATCH_ATOMICITY_DESCRIPTION,
  SQL_BULK_WRITE_SPLIT_DESCRIPTION,
  "Examples (tool-call JSON):",
  ...SQL_QUERY_TOOL_PROMPT_EXAMPLE_LINES,
  ...SQL_EXECUTE_TOOL_PROMPT_EXAMPLE_LINES,
].join("\n");

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
  "Markdown and LaTeX:",
  CARD_AUTHORING_CONTRACT,
  `Example: ${CARD_AUTHORING_TOOL_CALL_EXAMPLE}`,
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
 * a failed call returns an envelope whose `error` object carries only `code`,
 * `message` and `details` (`createAgentErrorEnvelope` in
 * apps/backend/src/agent/envelope.ts): a reader of this guide never sees the
 * status an error was raised with. That same envelope also carries
 * `instructions` from `createMcpToolInstructions`
 * (apps/backend/src/mcp/server.ts), the per-code remediation text the
 * model reads next to this guide, so the recovery rules below are kept
 * consistent with it. What each rule prescribes comes from the
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
  SQL_BULK_WRITE_SPLIT_DESCRIPTION,
  SQL_BATCH_ATOMICITY_DESCRIPTION,
  "One sql_execute call also gets 15 seconds of database time. A call that spends it fails with QUERY_TIME_LIMIT_EXCEEDED: the transaction is cancelled, so nothing lands.",
  `That time follows the number of rows touched rather than the number of statements, so treat the ${MAX_SQL_RECORD_LIMIT}-row and ${MAX_SQL_BATCH_STATEMENT_COUNT}-statement caps as hard ceilings rather than sizes to aim for: a batch at both caps ends in that error instead of landing.`,
  `Plan the split before the first write: N cards need at least ceil(N / ${MAX_SQL_RECORD_LIMIT}) statements. Start with a small batch and watch how long each call takes. The 15 seconds bound the database work alone, so an observed call is always longer than the part that is budgeted; growing the next batch only while the observed time still leaves clear headroom under the 15 seconds therefore errs toward smaller batches on purpose. The first call of a job may carry cold start, so if its wall time stands out from the calls after it, judge growth from those instead.`,
  "Because a batch either lands completely or not at all, keep each batch meaningful on its own and never split one logical card across two batches.",
  "The read/write split is per call: run any SELECT you need in its own sql_query call before or after the write batch.",
  "An error does not always mean the batch rolled back, so read error.code before you retry.",
  "When the outcome is unknown - a DATABASE_COMMIT_OUTCOME_UNKNOWN error, or a run interrupted before you saw a result - the batch may already have committed: never re-send it blindly, first read it back with a SELECT to see what applied, then send only the rows that are still missing.",
  "On QUERY_TIME_LIMIT_EXCEEDED the transaction is cancelled, so nothing lands: retry the same rows in a smaller batch, because re-sending the same batch unchanged only spends the budget again.",
  "On QUERY_INVALID_SQL or QUERY_UNSUPPORTED_SYNTAX the batch was rejected, so nothing lands either: fix the sql string, because a smaller batch helps only when the rejection was one of the size caps above.",
  "When bulk creating cards you cannot choose identifiers: card_id is server-generated and INSERT rejects it. Read back on what you wrote instead, such as the tags you set or the front_text values, and keep the ids each INSERT returns as you go.",
  "When bulk updating or deleting existing cards, the card ids are the resume handle: keep the list of ids you are working through and read back which of them already changed.",
  "Verify the finished job with a read-back SELECT: count the rows you intended to write and compare that with what the workspace now holds.",
  "RETURNING reports the affected rows in the same write call, which is enough for a small batch; use a separate SELECT when the returned text would be large.",
].join("\n");

/** The review loop is already one canonical block, so the guide is that block. */
export const REVIEW_FLOW_GUIDE = REVIEW_FLOW_INSTRUCTIONS;

export const GUIDE_TOPICS = Object.freeze([
  "sql_dialect",
  "card_authoring",
  "bulk_authoring",
  "review_flow",
] as const);

export type GuideTopic = (typeof GUIDE_TOPICS)[number];

export const GUIDE_BODIES: Readonly<Record<GuideTopic, string>> = Object.freeze({
  sql_dialect: SQL_DIALECT_GUIDE,
  card_authoring: CARD_AUTHORING_GUIDE,
  bulk_authoring: BULK_AUTHORING_GUIDE,
  review_flow: REVIEW_FLOW_GUIDE,
});
