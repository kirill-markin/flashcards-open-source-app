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
      effortLevel: "long",
    },
    {
      type: "text",
      text: "Improve this card.",
    },
  ], "Europe/Madrid");

  assert.equal(input.length, 2);
  const userMessage = input[1];
  assert.equal(userMessage.type, "message");
  assert.equal(userMessage.role, "user");
  assert.deepEqual(userMessage.content, [
    {
      type: "input_text",
      text: [
        "<attached_card>",
        "<card_id>card-1</card_id>",
        "<effort_level>long</effort_level>",
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
