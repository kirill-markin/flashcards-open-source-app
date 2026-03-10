import assert from "node:assert/strict";
import test from "node:test";
import {
  appendStreamedMessageText,
  completeStreamedMessageText,
  type StreamedMessageTextState,
} from "./agent";

test("completeStreamedMessageText resets per-message progress after a completed assistant message", () => {
  const initialState: StreamedMessageTextState = {
    currentMessageText: "",
    emittedTextLength: 0,
  };

  const firstMessageState = appendStreamedMessageText(initialState, "I will create the cards.");
  const firstCompletion = completeStreamedMessageText(firstMessageState, "I will create the cards.");

  assert.equal(firstCompletion.unsentText, "");
  assert.deepEqual(firstCompletion.state, {
    currentMessageText: "",
    emittedTextLength: "I will create the cards.".length,
  });

  const secondMessageState = appendStreamedMessageText(firstCompletion.state, "Created 25 cards.");
  const secondCompletion = completeStreamedMessageText(secondMessageState, "Created 25 cards.");

  assert.equal(secondCompletion.unsentText, "");
  assert.deepEqual(secondCompletion.state, {
    currentMessageText: "",
    emittedTextLength: "I will create the cards.Created 25 cards.".length,
  });
});

test("completeStreamedMessageText emits only the missing tail for the current assistant message", () => {
  const state: StreamedMessageTextState = {
    currentMessageText: "Created ",
    emittedTextLength: "Created ".length,
  };

  const completion = completeStreamedMessageText(state, "Created 25 cards.");

  assert.equal(completion.unsentText, "25 cards.");
  assert.deepEqual(completion.state, {
    currentMessageText: "",
    emittedTextLength: "Created 25 cards.".length,
  });
});
