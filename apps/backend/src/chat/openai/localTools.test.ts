import assert from "node:assert/strict";
import test from "node:test";
import { OPENAI_LOCAL_TOOL_ARGUMENT_VALIDATORS } from "./localTools";

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
