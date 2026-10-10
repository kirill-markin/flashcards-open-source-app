import assert from "node:assert/strict";
import test from "node:test";
import { buildChatCompletionInput } from "./input";

test("buildChatCompletionInput serializes card parts into deterministic XML before user text", async () => {
  const input = await buildChatCompletionInput([], [
    {
      type: "card",
      cardId: "card-1",
      frontText: "Q < 1",
      backText: "A & 2",
      tags: ["alpha", "beta"],
    },
    {
      type: "text",
      text: "Improve this card.",
    },
  ], "session-1", "Europe/Madrid", true);

  assert.equal(input.length, 3);
  const userMessage = input[2];
  assert.equal(userMessage.type, "message");
  assert.equal(userMessage.role, "user");
  assert.deepEqual(userMessage.content, [
    {
      type: "input_text",
      text: [
        "<attached_card>",
        "<card_id>card-1</card_id>",
        "<front_text>",
        "Q &lt; 1",
        "</front_text>",
        "<back_text>",
        "A &amp; 2",
        "</back_text>",
        "<tags><tag>alpha</tag><tag>beta</tag></tags>",
        "</attached_card>",
      ].join("\n"),
    },
    {
      type: "input_text",
      text: "Improve this card.",
    },
  ]);
});

test("buildChatCompletionInput replays a file attachment as its workspace manifest", async () => {
  const input = await buildChatCompletionInput([], [
    {
      type: "file",
      fileId: "file-1",
      path: "/files/deck.csv",
      fileName: "deck.csv",
      mediaType: "text/csv",
      sizeBytes: 2048,
    },
  ], "session-1", "Europe/Madrid", true);

  assert.equal(input.length, 3);
  const userMessage = input[2];
  assert.equal(userMessage.type, "message");
  assert.equal(userMessage.role, "user");
  assert.deepEqual(userMessage.content, [
    {
      type: "input_text",
      text: "Attached file: /files/deck.csv (text/csv, 2.0 KB). It is in the chat workspace; read it with the workspace tools instead of asking the user to paste it.",
    },
  ]);
});
