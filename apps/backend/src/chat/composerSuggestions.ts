/**
 * Shared domain rules for AI chat composer suggestions.
 * Session rows expose only the active suggestion set, while history is stored
 * separately as append-only generations.
 */
import { z } from "zod";
import { CHAT_MODEL_ID } from "./config";
import { getOpenAIClient } from "./openai/client";
import type { ContentPart } from "./types";

export type ChatComposerSuggestionSource = "initial" | "assistant_follow_up";
export type ChatComposerSuggestionInvalidationReason =
  | "run_started"
  | "run_cancelled"
  | "run_failed"
  | "run_interrupted"
  | "new_chat_rollover";

export type ChatComposerSuggestion = Readonly<{
  id: string;
  text: string;
  source: ChatComposerSuggestionSource;
  assistantItemId: string | null;
}>;

const MAX_CHAT_COMPOSER_SUGGESTIONS = 2;

const INITIAL_CHAT_COMPOSER_SUGGESTION_TEXTS = [
  "Help me create a card",
  "What should I study next?",
] as const;

const followUpSuggestionsWireSchema = z.object({
  suggestions: z.array(z.string()),
});

const composerSuggestionWireSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  source: z.enum(["initial", "assistant_follow_up"]),
  assistantItemId: z.string().min(1).nullable(),
});

const composerSuggestionsWireSchema = z.array(composerSuggestionWireSchema);

function normalizeSuggestionText(text: string): string | null {
  const normalizedText = text.replace(/\s+/g, " ").trim();
  if (normalizedText.length === 0 || normalizedText.length > 80) {
    return null;
  }

  return normalizedText;
}

function buildSuggestionId(prefix: string, index: number): string {
  return `${prefix}-${String(index + 1)}`;
}

function deduplicateSuggestionTexts(
  texts: ReadonlyArray<string>,
): ReadonlyArray<string> {
  const normalizedTexts: string[] = [];
  const seenTexts = new Set<string>();

  for (const text of texts) {
    const normalizedText = normalizeSuggestionText(text);
    if (normalizedText === null) {
      continue;
    }

    const dedupeKey = normalizedText.toLocaleLowerCase("en-US");
    if (seenTexts.has(dedupeKey)) {
      continue;
    }

    normalizedTexts.push(normalizedText);
    seenTexts.add(dedupeKey);
    if (normalizedTexts.length >= MAX_CHAT_COMPOSER_SUGGESTIONS) {
      break;
    }
  }

  return normalizedTexts;
}

function createComposerSuggestions(
  texts: ReadonlyArray<string>,
  source: ChatComposerSuggestionSource,
  assistantItemId: string | null,
  idPrefix: string,
): ReadonlyArray<ChatComposerSuggestion> {
  return deduplicateSuggestionTexts(texts).map((text, index) => ({
    id: buildSuggestionId(idPrefix, index),
    text,
    source,
    assistantItemId,
  }));
}

function extractPlainText(parts: ReadonlyArray<ContentPart>): string {
  return parts
    .flatMap((part) => {
      if (part.type === "text") {
        return [part.text];
      }

      if (part.type === "file") {
        return [part.fileName];
      }

      if (part.type === "tool_call") {
        return [
          part.output ?? "",
          part.input ?? "",
        ];
      }

      return [];
    })
    .map((text) => text.trim())
    .filter((text) => text.length > 0)
    .join("\n");
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return null;
    }

    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  const directObject = parseJsonObject(text);
  if (directObject !== null) {
    return directObject;
  }

  const startIndex = text.indexOf("{");
  const endIndex = text.lastIndexOf("}");
  if (startIndex < 0 || endIndex <= startIndex) {
    return null;
  }

  return parseJsonObject(text.slice(startIndex, endIndex + 1));
}

function buildFollowUpSuggestionPrompt(
  userMessage: string,
  assistantReply: string,
): string {
  return [
    "Generate exactly two short follow-up messages that the user may send next.",
    "Return strict JSON only in this shape: {\"suggestions\":[\"...\",\"...\"]}.",
    "Each suggestion must be plain text, concise, and suitable for a mobile composer.",
    "Each suggestion must be under 60 characters.",
    "Do not copy the assistant reply verbatim.",
    "Do not add markdown, numbering, or explanations.",
    "",
    "Latest user message:",
    userMessage,
    "",
    "Assistant reply:",
    assistantReply,
  ].join("\n");
}

export function buildInitialChatComposerSuggestions(): ReadonlyArray<ChatComposerSuggestion> {
  return createComposerSuggestions(
    INITIAL_CHAT_COMPOSER_SUGGESTION_TEXTS,
    "initial",
    null,
    "initial",
  );
}

export function emptyChatComposerSuggestions(): ReadonlyArray<ChatComposerSuggestion> {
  return [];
}

/**
 * Normalizes persisted suggestion payloads so the runtime always sees the same
 * capped, de-duplicated structure regardless of how the JSON was stored.
 */
export function parsePersistedChatComposerSuggestions(
  value: unknown,
  context: string,
): ReadonlyArray<ChatComposerSuggestion> {
  const parsedSuggestions = composerSuggestionsWireSchema.safeParse(value);
  if (!parsedSuggestions.success) {
    throw new Error(`Invalid persisted composer suggestions for ${context}`);
  }

  return createComposerSuggestions(
    parsedSuggestions.data.map((suggestion) => suggestion.text),
    parsedSuggestions.data[0]?.source ?? "assistant_follow_up",
    parsedSuggestions.data[0]?.assistantItemId ?? null,
    parsedSuggestions.data[0]?.assistantItemId ?? parsedSuggestions.data[0]?.source ?? "persisted",
  ).map((suggestion, index) => {
    const persistedSuggestion = parsedSuggestions.data[index];
    if (persistedSuggestion === undefined) {
      return suggestion;
    }

    return {
      id: persistedSuggestion.id,
      text: suggestion.text,
      source: persistedSuggestion.source,
      assistantItemId: persistedSuggestion.assistantItemId,
    };
  });
}

/**
 * Generates follow-up suggestions from the latest completed assistant reply.
 */
export async function generateFollowUpChatComposerSuggestions(
  userContent: ReadonlyArray<ContentPart>,
  assistantContent: ReadonlyArray<ContentPart>,
  assistantItemId: string,
): Promise<ReadonlyArray<ChatComposerSuggestion>> {
  const userMessage = extractPlainText(userContent);
  const assistantReply = extractPlainText(assistantContent);
  if (userMessage.length === 0 || assistantReply.length === 0) {
    return emptyChatComposerSuggestions();
  }

  const response = await getOpenAIClient().responses.create({
    model: CHAT_MODEL_ID,
    store: false,
    input: [{
      type: "message",
      role: "system",
      content: [{
        type: "input_text",
        text: "You write short user follow-up suggestions for a mobile AI chat composer.",
      }],
    }, {
      type: "message",
      role: "user",
      content: [{
        type: "input_text",
        text: buildFollowUpSuggestionPrompt(userMessage, assistantReply),
      }],
    }],
  });

  const responseText = response.output_text.trim();
  const parsedObject = extractJsonObject(responseText);
  if (parsedObject === null) {
    throw new Error("Composer suggestions response is not valid JSON");
  }

  const parsedSuggestions = followUpSuggestionsWireSchema.safeParse(parsedObject);
  if (!parsedSuggestions.success) {
    throw new Error("Composer suggestions response has an invalid shape");
  }

  return createComposerSuggestions(
    parsedSuggestions.data.suggestions,
    "assistant_follow_up",
    assistantItemId,
    assistantItemId,
  );
}
