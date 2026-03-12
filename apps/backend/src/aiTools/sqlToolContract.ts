import type { FunctionTool } from "openai/resources/responses/responses";
import { z } from "zod";

export const SQL_TOOL_NAME = "sql";

export const SQL_TOOL_ARGUMENT_VALIDATOR = z.object({
  sql: z.string().trim().min(1),
}).strict();

export const SQL_TOOL_PROMPT_EXAMPLE_LINES = Object.freeze([
  "- sql => {\"sql\": \"SHOW TABLES\"}",
  "- sql => {\"sql\": \"DESCRIBE workspace\"}",
  "- sql => {\"sql\": \"SELECT * FROM cards ORDER BY updated_at DESC LIMIT 20 OFFSET 0\"}",
  "- sql => {\"sql\": \"SELECT card_id, front_text, back_text, tags FROM cards WHERE LOWER(front_text) LIKE '%example%' OR LOWER(back_text) LIKE '%example%' ORDER BY updated_at DESC LIMIT 20 OFFSET 0\"}",
  "- sql => {\"sql\": \"SELECT * FROM workspace LIMIT 1 OFFSET 0\"}",
  "- sql => {\"sql\": \"SELECT * FROM review_events WHERE card_id = '00000000-0000-4000-8000-000000000000' ORDER BY reviewed_at_server DESC LIMIT 20 OFFSET 0\"}",
  "- sql => {\"sql\": \"SELECT tag, COUNT(*) AS cards_count FROM cards UNNEST tags AS tag GROUP BY tag ORDER BY cards_count DESC LIMIT 100 OFFSET 0\"}",
  "- sql => {\"sql\": \"SELECT effort_level, AVG(reps) AS avg_reps, MAX(updated_at) AS latest_update FROM cards GROUP BY effort_level ORDER BY latest_update DESC LIMIT 20 OFFSET 0\"}",
  "- sql => {\"sql\": \"SELECT * FROM cards WHERE due_at IS NULL OR due_at <= NOW() ORDER BY due_at ASC, updated_at DESC LIMIT 20 OFFSET 0\"}",
  "- sql => {\"sql\": \"INSERT INTO cards (front_text, back_text, tags, effort_level) VALUES ('Question?', 'Answer', ('tag'), 'medium')\"}",
  "- sql => {\"sql\": \"UPDATE cards SET back_text = 'Updated answer' WHERE card_id = '00000000-0000-4000-8000-000000000000'\"}",
  "- sql => {\"sql\": \"DELETE FROM decks WHERE deck_id IN ('00000000-0000-4000-8000-000000000000')\"}",
]);

export const OPENAI_SQL_TOOL: FunctionTool = {
  type: "function",
  name: SQL_TOOL_NAME,
  description: [
    "Query and mutate the flashcards workspace with the published SQL dialect.",
    "This is not full PostgreSQL.",
    "Use one JSON object: {\"sql\": \"...\"}.",
    "Published resources: workspace, cards, decks, review_events.",
    "Supported statements: SHOW TABLES, DESCRIBE <resource>, SHOW COLUMNS FROM <resource>, SELECT, INSERT, UPDATE, DELETE.",
    "SELECT supports projected column lists, LIKE, COUNT(*), SUM, AVG, MIN, MAX, GROUP BY, NOW(), and cards UNNEST tags AS tag.",
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
