import type { FunctionTool } from "openai/resources/responses/responses";
import { z } from "zod";
import {
  countUnicodeCodePoints,
  generatedImageAltTextJsonSchemaPattern,
  hasValidGeneratedImageAltTextCharactersAndLength,
  maximumGeneratedImageAltTextCodePoints,
  maximumGeneratedImagePromptCodePoints,
} from "../../cardImages/contract";

export const GENERATED_IMAGE_TOOL_NAME = "add_generated_image_to_card";

const nonWhitespacePattern = /\S/u;

function boundedText(maximumCharacters: number) {
  return z.string()
    .refine(
      (value) =>
        countUnicodeCodePoints(value) <= maximumCharacters
        && nonWhitespacePattern.test(value),
    )
    .transform((value) => value.trim());
}

export const GENERATED_IMAGE_TOOL_ARGUMENT_VALIDATOR = z.object({
  cardId: z.string().uuid(),
  targetSide: z.enum(["front", "back"]),
  imagePrompt: boundedText(maximumGeneratedImagePromptCodePoints),
  altText: z.string()
    .refine((value) =>
      hasValidGeneratedImageAltTextCharactersAndLength(value)
      && nonWhitespacePattern.test(value))
    .transform((value) => value.trim()),
}).strict();

export type GeneratedImageToolArguments = z.infer<typeof GENERATED_IMAGE_TOOL_ARGUMENT_VALIDATOR>;

export const OPENAI_GENERATED_IMAGE_TOOL: FunctionTool = {
  type: "function",
  name: GENERATED_IMAGE_TOOL_NAME,
  description: [
    "Generate one teaching-relevant image and attach it to an existing flashcard.",
    "Inspect the exact card with the sql tool first.",
    "Prefer the back unless the user requested the front.",
    "A front image and alt text must remain a recall cue and never reveal the answer.",
    "Use only for an explicit image request or delegated visual augmentation.",
  ].join(" "),
  strict: true,
  parameters: {
    type: "object",
    properties: {
      cardId: { type: "string", format: "uuid" },
      targetSide: { type: "string", enum: ["front", "back"] },
      imagePrompt: {
        type: "string",
        minLength: 1,
        maxLength: maximumGeneratedImagePromptCodePoints,
        pattern: "\\S",
      },
      altText: {
        type: "string",
        minLength: 1,
        maxLength: maximumGeneratedImageAltTextCodePoints,
        pattern: generatedImageAltTextJsonSchemaPattern,
      },
    },
    required: ["cardId", "targetSide", "imagePrompt", "altText"],
    additionalProperties: false,
  },
};
