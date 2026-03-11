import assert from "node:assert/strict";
import test from "node:test";
import {
  SHARED_AI_TOOL_ARGUMENT_VALIDATORS,
  SHARED_AI_TOOL_NAMES,
  SHARED_AI_TOOL_PROMPT_EXAMPLE_LINES,
  SHARED_EXTERNAL_AGENT_TOOL_DEFINITIONS,
  SHARED_OPENAI_LOCAL_FLASHCARDS_TOOLS,
} from "./sharedToolContracts";

test("shared AI tool exports stay aligned across names, validators, local tools, and external tools", () => {
  assert.deepEqual(
    SHARED_AI_TOOL_NAMES,
    Object.keys(SHARED_AI_TOOL_ARGUMENT_VALIDATORS),
  );
  assert.deepEqual(
    SHARED_AI_TOOL_NAMES,
    SHARED_OPENAI_LOCAL_FLASHCARDS_TOOLS.map((tool) => tool.name),
  );
  assert.deepEqual(
    SHARED_AI_TOOL_NAMES,
    SHARED_EXTERNAL_AGENT_TOOL_DEFINITIONS.map((tool) => tool.name),
  );
});

test("shared AI tool prompt examples keep the canonical JSON shapes used in local instructions", () => {
  assert.deepEqual(SHARED_AI_TOOL_PROMPT_EXAMPLE_LINES, [
    "- list_cards => {\"cursor\": null, \"limit\": 20}",
    "- get_cards => {\"cardIds\": [\"123e4567-e89b-42d3-a456-426614174000\"]}",
    "- search_cards => {\"query\": \"grammar\", \"cursor\": null, \"limit\": 20}",
    "- search_decks => {\"query\": \"grammar\", \"cursor\": null, \"limit\": 20}",
    "- get_decks => {\"deckIds\": [\"123e4567-e89b-42d3-a456-426614174001\"]}",
    "- list_review_history => {\"cursor\": null, \"limit\": 20, \"cardId\": null}",
    "- update_cards => {\"updates\": [{\"cardId\": \"123e4567-e89b-42d3-a456-426614174000\", \"frontText\": null, \"backText\": \"Updated back\", \"tags\": null, \"effortLevel\": null}]}",
    "- update_decks => {\"updates\": [{\"deckId\": \"123e4567-e89b-42d3-a456-426614174001\", \"name\": null, \"effortLevels\": [\"fast\", \"medium\"], \"tags\": [\"grammar\"]}]}",
  ]);
});
