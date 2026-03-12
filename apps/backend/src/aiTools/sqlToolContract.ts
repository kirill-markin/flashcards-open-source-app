import type { FunctionTool } from "openai/resources/responses/responses";
import { z } from "zod";

export const SQL_TOOL_NAME = "sql";

export const SQL_TOOL_ARGUMENT_VALIDATOR = z.object({
  sql: z.string().trim().min(1),
}).strict();

export const SQL_TOOL_PROMPT_EXAMPLE_LINES = Object.freeze([
  "- sql => {\"sql\": \"SHOW TABLES\"}",
  "- sql => {\"sql\": \"DESCRIBE cards\"}",
  "- sql => {\"sql\": \"SELECT * FROM cards ORDER BY updated_at DESC LIMIT 20 OFFSET 0\"}",
  "- sql => {\"sql\": \"SELECT * FROM due_cards ORDER BY due_at ASC, updated_at DESC LIMIT 20 OFFSET 0\"}",
  "- sql => {\"sql\": \"SELECT * FROM review_history WHERE card_id = '00000000-0000-4000-8000-000000000000' ORDER BY reviewed_at_server DESC LIMIT 20 OFFSET 0\"}",
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
    "Supported statements: SHOW TABLES, DESCRIBE <resource>, SHOW COLUMNS FROM <resource>, SELECT, INSERT, UPDATE, DELETE.",
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
