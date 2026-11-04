import type { FunctionTool } from "openai/resources/responses/responses";
import { z } from "zod";
import {
  generatedImageAltTextJsonSchemaPattern,
  hasValidGeneratedImageAltTextCharactersAndLength,
  maximumGeneratedImageAltTextCodePoints,
} from "../../cardImages/contract";

export const CARD_COLLAGE_TOOL_NAME = "add_image_collage_to_card";

const minimumCollageSourceImages = 2;
const maximumCollageSourceImages = 9;
const nonWhitespacePattern = /\S/u;

export const CARD_COLLAGE_TOOL_ARGUMENT_VALIDATOR = z.object({
  cardId: z.string().uuid(),
  targetSide: z.enum(["front", "back"]),
  sourceMediaAssetIds: z.array(z.string().uuid().transform((value) => value.toLowerCase()))
    .min(minimumCollageSourceImages)
    .max(maximumCollageSourceImages)
    .refine((ids) => new Set(ids).size === ids.length, "sourceMediaAssetIds must not repeat an id."),
  altText: z.string()
    .refine((value) =>
      hasValidGeneratedImageAltTextCharactersAndLength(value)
      && nonWhitespacePattern.test(value))
    .transform((value) => value.trim()),
}).strict();

/**
 * Chat-only by decision, like `add_generated_image_to_card`: an external assistant composes images on
 * its own side, while the chat's sandbox has no image library, so the chat composes on the server.
 */
export const OPENAI_CARD_COLLAGE_TOOL: FunctionTool = {
  type: "function",
  name: CARD_COLLAGE_TOOL_NAME,
  description: [
    `Combine ${minimumCollageSourceImages} to ${maximumCollageSourceImages} images already on one side of a card into one collage image and append it to that side; the originals stay.`,
    "Read that side with sql_query first and pass the <id> of each chosen fcasset:<id> image destination without ?state=, in collage order.",
    "Works only on cards in the workspace the user has open.",
    "To replace the originals, confirm with the user first, then remove their references with sql_execute: a removed reference cannot be restored.",
  ].join(" "),
  strict: true,
  parameters: {
    type: "object",
    properties: {
      cardId: { type: "string", format: "uuid" },
      targetSide: { type: "string", enum: ["front", "back"] },
      sourceMediaAssetIds: {
        type: "array",
        items: { type: "string", format: "uuid" },
        minItems: minimumCollageSourceImages,
        maxItems: maximumCollageSourceImages,
      },
      altText: {
        type: "string",
        minLength: 1,
        maxLength: maximumGeneratedImageAltTextCodePoints,
        pattern: generatedImageAltTextJsonSchemaPattern,
      },
    },
    required: ["cardId", "targetSide", "sourceMediaAssetIds", "altText"],
    additionalProperties: false,
  },
};
