import assert from "node:assert/strict";
import test from "node:test";
import type OpenAI from "openai";
import {
  generateFollowUpChatComposerSuggestionsWithDependencies,
  type ChatComposerSuggestionsDependencies,
} from "./composerSuggestions";
import { buildOpenAISafetyIdentifier } from "./openai/safetyIdentifier";

test("generateFollowUpChatComposerSuggestions sends the hashed safety identifier to OpenAI", async () => {
  const capturedRequests: Array<OpenAI.Responses.ResponseCreateParams> = [];
  const dependencies: ChatComposerSuggestionsDependencies = {
    getOpenAIClient: () => ({
      responses: {
        create: async (request: OpenAI.Responses.ResponseCreateParams): Promise<OpenAI.Responses.Response> => {
          capturedRequests.push(request);
          return {
            output_text: "{\"suggestions\":[\"Review this card\",\"Show an example\"]}",
          } as OpenAI.Responses.Response;
        },
      },
    } as unknown as OpenAI),
  };

  const suggestions = await generateFollowUpChatComposerSuggestionsWithDependencies(
    "user-1",
    [{ type: "text", text: "What is spaced repetition?" }],
    [{ type: "text", text: "A scheduling method for durable memory." }],
    "assistant-item-1",
    "en-US",
    dependencies,
  );

  assert.equal(capturedRequests.length, 1);
  assert.equal(capturedRequests[0].safety_identifier, buildOpenAISafetyIdentifier("user-1"));
  assert.equal(Object.hasOwn(capturedRequests[0], "user"), false);
  assert.deepEqual(
    suggestions.map((suggestion) => suggestion.text),
    ["Review this card", "Show an example"],
  );
});
