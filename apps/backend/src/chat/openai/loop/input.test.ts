import assert from "node:assert/strict";
import test from "node:test";
import { HttpError } from "../../../shared/errors";
import {
  chatAttachmentUnsupportedTypeCode,
  chatAttachmentUnsupportedTypeMessage,
} from "../../attachmentPolicy";
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

test("buildChatCompletionInput serializes normalized CSV attachment media type in file data URLs", async () => {
  const input = await buildChatCompletionInput([], [
    {
      type: "file",
      fileName: "deck.csv",
      mediaType: "text/csv",
      base64Data: "ZnJvbnQsYmFjaw==",
    },
  ], "Europe/Madrid");

  assert.equal(input.length, 2);
  const userMessage = input[1];
  assert.equal(userMessage.type, "message");
  assert.equal(userMessage.role, "user");
  assert.deepEqual(userMessage.content, [
    {
      type: "input_file",
      filename: "deck.csv",
      file_data: "data:text/csv;base64,ZnJvbnQsYmFjaw==",
    },
  ]);
});

test("buildChatCompletionInput serializes normalized XML attachment media type in file data URLs", async () => {
  const input = await buildChatCompletionInput([], [
    {
      type: "file",
      fileName: "cards.xml",
      mediaType: "text/xml",
      base64Data: "PGNhcmRzIC8+",
    },
  ], "Europe/Madrid");

  assert.equal(input.length, 2);
  const userMessage = input[1];
  assert.equal(userMessage.type, "message");
  assert.equal(userMessage.role, "user");
  assert.deepEqual(userMessage.content, [
    {
      type: "input_file",
      filename: "cards.xml",
      file_data: "data:text/xml;base64,PGNhcmRzIC8+",
    },
  ]);
});

test("buildChatCompletionInput normalizes persisted history attachment aliases before provider replay", async () => {
  const input = await buildChatCompletionInput([
    {
      role: "user",
      content: [
        {
          type: "file",
          fileName: "deck.csv",
          mediaType: "text/comma-separated-values",
          base64Data: "ZnJvbnQsYmFjaw==",
        },
      ],
    },
  ], [
    {
      type: "text",
      text: "Continue.",
    },
  ], "Europe/Madrid");

  assert.equal(input.length, 3);
  const historyMessage = input[1];
  assert.equal(historyMessage.type, "message");
  assert.equal(historyMessage.role, "user");
  assert.deepEqual(historyMessage.content, [
    {
      type: "input_file",
      filename: "deck.csv",
      file_data: "data:text/csv;base64,ZnJvbnQsYmFjaw==",
    },
  ]);
});

test("buildChatCompletionInput rejects invalid persisted history attachments with the attachment error", async () => {
  await assert.rejects(
    () => buildChatCompletionInput([
      {
        role: "user",
        content: [
          {
            type: "file",
            fileName: "notes.pdf",
            mediaType: "application/pdf",
            base64Data: "cGxhaW4gdGV4dA==",
          },
        ],
      },
    ], [
      {
        type: "text",
        text: "Continue.",
      },
    ], "Europe/Madrid"),
    (error: unknown) => error instanceof HttpError
      && error.statusCode === 400
      && error.code === chatAttachmentUnsupportedTypeCode
      && error.message === chatAttachmentUnsupportedTypeMessage,
  );
});
