import assert from "node:assert/strict";
import test from "node:test";
import { OPENAI_LOCAL_FLASHCARDS_TOOLS, OPENAI_LOCAL_TOOL_ARGUMENT_VALIDATORS } from "./localTools";

test("get_cards validator rejects non-UUID card ids", () => {
  const result = OPENAI_LOCAL_TOOL_ARGUMENT_VALIDATORS.get_cards.safeParse({
    cardIds: ["not-a-uuid"],
  });

  assert.equal(result.success, false);
});

test("update_cards validator rejects non-UUID card ids", () => {
  const result = OPENAI_LOCAL_TOOL_ARGUMENT_VALIDATORS.update_cards.safeParse({
    updates: [{
      cardId: "not-a-uuid",
      frontText: null,
      backText: "updated back",
      tags: null,
      effortLevel: null,
    }],
  });

  assert.equal(result.success, false);
});

test("list_review_history validator rejects non-UUID card filters", () => {
  const result = OPENAI_LOCAL_TOOL_ARGUMENT_VALIDATORS.list_review_history.safeParse({
    limit: 10,
    cardId: "not-a-uuid",
  });

  assert.equal(result.success, false);
});

test("get_decks validator rejects non-UUID deck ids", () => {
  const result = OPENAI_LOCAL_TOOL_ARGUMENT_VALIDATORS.get_decks.safeParse({
    deckIds: ["not-a-uuid"],
  });

  assert.equal(result.success, false);
});

test("local OpenAI tools do not force strict schema mode for optional properties", () => {
  assert.ok(OPENAI_LOCAL_FLASHCARDS_TOOLS.every((tool) => tool.strict === false));
});

test("create_cards validator accepts omitted tags and normalizes them to an empty array", () => {
  const result = OPENAI_LOCAL_TOOL_ARGUMENT_VALIDATORS.create_cards.safeParse({
    cards: [{
      frontText: "Question",
      backText: "Answer",
      effortLevel: "medium",
    }],
  });

  assert.equal(result.success, true);
  assert.deepEqual(result.data, {
    cards: [{
      frontText: "Question",
      backText: "Answer",
      tags: [],
      effortLevel: "medium",
    }],
  });
});

test("update_cards validator accepts omitted optional fields and normalizes them to null", () => {
  const result = OPENAI_LOCAL_TOOL_ARGUMENT_VALIDATORS.update_cards.safeParse({
    updates: [{
      cardId: "123e4567-e89b-42d3-a456-426614174000",
      backText: "Updated Back",
    }],
  });

  assert.equal(result.success, true);
  assert.deepEqual(result.data, {
    updates: [{
      cardId: "123e4567-e89b-42d3-a456-426614174000",
      frontText: null,
      backText: "Updated Back",
      tags: null,
      effortLevel: null,
    }],
  });
});

test("deck validators accept omitted filter fields", () => {
  const createResult = OPENAI_LOCAL_TOOL_ARGUMENT_VALIDATORS.create_decks.safeParse({
    decks: [{
      name: "Grammar",
    }],
  });
  assert.equal(createResult.success, true);
  assert.deepEqual(createResult.data, {
    decks: [{
      name: "Grammar",
      effortLevels: [],
      tags: [],
    }],
  });

  const updateResult = OPENAI_LOCAL_TOOL_ARGUMENT_VALIDATORS.update_decks.safeParse({
    updates: [{
      deckId: "123e4567-e89b-42d3-a456-426614174001",
    }],
  });
  assert.equal(updateResult.success, true);
  assert.deepEqual(updateResult.data, {
    updates: [{
      deckId: "123e4567-e89b-42d3-a456-426614174001",
      name: null,
      effortLevels: null,
      tags: null,
    }],
  });
});
