import type { FunctionTool } from "openai/resources/responses/responses";
import { z } from "zod";
import { maximumChatFilePathBytes } from "../../../chatSandbox/contract";

export const VIEW_FILE_TOOL_NAME = "view_file";

export const VIEW_FILE_TOOL_ARGUMENT_VALIDATOR = z.object({
  path: z.string().min(1).max(maximumChatFilePathBytes),
  page: z.number().int().positive().nullable(),
}).strict();

/** Chat-only for the same reason as `bash`: an external AI client looks at files on its own side. */
export const OPENAI_VIEW_FILE_TOOL: FunctionTool = {
  type: "function",
  name: VIEW_FILE_TOOL_NAME,
  description: [
    "Look at one image (PNG, JPEG, GIF, WebP) or one page of a PDF from /files or /work.",
    "Pass the 1-based page for a PDF and null for an image.",
    "Use it for what text does not carry, such as photos, scans, charts and layout; read text, CSV and other files with bash.",
    "You see the image or page during this turn only: later turns keep a [view_file showed ...] note, so call view_file again to look again.",
  ].join(" "),
  strict: true,
  parameters: {
    type: "object",
    properties: {
      path: { type: "string" },
      page: { type: ["integer", "null"] },
    },
    required: ["path", "page"],
    additionalProperties: false,
  },
};
