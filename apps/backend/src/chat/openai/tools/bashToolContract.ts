import type { FunctionTool } from "openai/resources/responses/responses";
import { z } from "zod";

export const BASH_TOOL_NAME = "bash";

export const maximumBashCommandChars = 64_000;

export const BASH_TOOL_ARGUMENT_VALIDATOR = z.object({
  command: z.string().min(1).max(maximumBashCommandChars),
}).strict();

/**
 * Chat-only, not a registry spec: an external AI client reached through MCP or the Agent REST API
 * already runs code over files on its own side, so only the in-app chat needs a sandbox of ours.
 */
export const OPENAI_BASH_TOOL: FunctionTool = {
  type: "function",
  name: BASH_TOOL_NAME,
  description: [
    "Run a bash command in this chat's sandbox and get its exit code, stdout, and stderr.",
    "/files holds the files the user attached and is read-only; /work is writable scratch space kept for this chat, and commands start there.",
    "Each call is a fresh shell: only files under /work last between calls.",
    "Tools: cat, head, tail, sed, grep, rg, awk, jq, yq, xan, sort, uniq, wc, cut, find, ls, file, diff, split, gzip, tar, python3 (standard library only), and sqlite3 (SQL only, no dot-commands).",
    "There is no network.",
  ].join(" "),
  strict: true,
  parameters: {
    type: "object",
    properties: {
      command: { type: "string" },
    },
    required: ["command"],
    additionalProperties: false,
  },
};
