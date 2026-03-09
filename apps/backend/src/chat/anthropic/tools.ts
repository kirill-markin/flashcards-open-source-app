import Anthropic from "@anthropic-ai/sdk";
import {
  runCreateCardTool,
  runGetCardTool,
  runListCardsTool,
  runListDueCardsTool,
  runListReviewHistoryTool,
  runSearchCardsTool,
  runSummarizeDeckStateTool,
  runUpdateCardTool,
} from "../shared";

export const CODE_EXECUTION_TOOL: Anthropic.Beta.Messages.BetaCodeExecutionTool20250825 = {
  type: "code_execution_20250825",
  name: "code_execution",
};

const LIST_CARDS_TOOL: Anthropic.Tool = {
  name: "list_cards",
  description: "List cards in the current workspace.",
  input_schema: {
    type: "object",
    properties: {
      limit: { type: "integer", minimum: 1, maximum: 100 },
    },
  },
};

const GET_CARD_TOOL: Anthropic.Tool = {
  name: "get_card",
  description: "Get one card by cardId.",
  input_schema: {
    type: "object",
    properties: {
      cardId: { type: "string" },
    },
    required: ["cardId"],
  },
};

const SEARCH_CARDS_TOOL: Anthropic.Tool = {
  name: "search_cards",
  description: "Search cards by front text, back text, or tags.",
  input_schema: {
    type: "object",
    properties: {
      query: { type: "string" },
      limit: { type: "integer", minimum: 1, maximum: 100 },
    },
    required: ["query"],
  },
};

const LIST_DUE_CARDS_TOOL: Anthropic.Tool = {
  name: "list_due_cards",
  description: "List cards currently due for review.",
  input_schema: {
    type: "object",
    properties: {
      limit: { type: "integer", minimum: 1, maximum: 100 },
    },
  },
};

const LIST_REVIEW_HISTORY_TOOL: Anthropic.Tool = {
  name: "list_review_history",
  description: "List recent review events, optionally filtered by cardId.",
  input_schema: {
    type: "object",
    properties: {
      limit: { type: "integer", minimum: 1, maximum: 100 },
      cardId: { type: "string" },
    },
  },
};

const SUMMARIZE_DECK_STATE_TOOL: Anthropic.Tool = {
  name: "summarize_deck_state",
  description: "Summarize deck counts and review stats for the current workspace.",
  input_schema: {
    type: "object",
    properties: {},
  },
};

const CREATE_CARD_TOOL: Anthropic.Tool = {
  name: "create_card",
  description: "Create a new card.",
  input_schema: {
    type: "object",
    properties: {
      frontText: { type: "string" },
      backText: { type: "string" },
      tags: {
        type: "array",
        items: { type: "string" },
      },
      effortLevel: {
        type: "string",
        enum: ["fast", "medium", "long"],
      },
    },
    required: ["frontText", "backText", "tags", "effortLevel"],
  },
};

const UPDATE_CARD_TOOL: Anthropic.Tool = {
  name: "update_card",
  description: "Update editable card fields.",
  input_schema: {
    type: "object",
    properties: {
      cardId: { type: "string" },
      frontText: { type: "string" },
      backText: { type: "string" },
      tags: {
        type: "array",
        items: { type: "string" },
      },
      effortLevel: {
        type: "string",
        enum: ["fast", "medium", "long"],
      },
    },
    required: ["cardId"],
  },
};

export const ANTHROPIC_FLASHCARDS_TOOLS: ReadonlyArray<Anthropic.Tool> = [
  LIST_CARDS_TOOL,
  GET_CARD_TOOL,
  SEARCH_CARDS_TOOL,
  LIST_DUE_CARDS_TOOL,
  LIST_REVIEW_HISTORY_TOOL,
  SUMMARIZE_DECK_STATE_TOOL,
  CREATE_CARD_TOOL,
  UPDATE_CARD_TOOL,
];

function getNumberValue(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function getStringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function getTagsValue(value: unknown): ReadonlyArray<string> {
  if (!Array.isArray(value)) {
    throw new Error("tags must be an array of strings");
  }

  const tags: Array<string> = [];
  for (const item of value) {
    if (typeof item !== "string") {
      throw new Error("tags must be an array of strings");
    }
    tags.push(item);
  }

  return tags;
}

export async function executeTool(
  toolUseId: string,
  toolName: string,
  toolInput: unknown,
  workspaceId: string,
  deviceId: string,
): Promise<Anthropic.ToolResultBlockParam> {
  try {
    const input = typeof toolInput === "object" && toolInput !== null ? toolInput as Record<string, unknown> : {};
    let content: string;

    switch (toolName) {
      case "list_cards":
        content = await runListCardsTool(workspaceId, getNumberValue(input.limit));
        break;
      case "get_card": {
        const cardId = getStringValue(input.cardId);
        if (cardId === undefined) {
          throw new Error("cardId is required");
        }
        content = await runGetCardTool(workspaceId, cardId);
        break;
      }
      case "search_cards": {
        const query = getStringValue(input.query);
        if (query === undefined) {
          throw new Error("query is required");
        }
        content = await runSearchCardsTool(workspaceId, query, getNumberValue(input.limit));
        break;
      }
      case "list_due_cards":
        content = await runListDueCardsTool(workspaceId, getNumberValue(input.limit));
        break;
      case "list_review_history":
        content = await runListReviewHistoryTool(
          workspaceId,
          getNumberValue(input.limit),
          getStringValue(input.cardId),
        );
        break;
      case "summarize_deck_state":
        content = await runSummarizeDeckStateTool(workspaceId);
        break;
      case "create_card": {
        const frontText = getStringValue(input.frontText);
        const backText = getStringValue(input.backText);
        const effortLevel = getStringValue(input.effortLevel);
        if (frontText === undefined || backText === undefined || effortLevel === undefined) {
          throw new Error("frontText, backText, and effortLevel are required");
        }
        content = await runCreateCardTool(
          workspaceId,
          {
            frontText,
            backText,
            tags: getTagsValue(input.tags),
            effortLevel: effortLevel as "fast" | "medium" | "long",
          },
          {
            deviceId,
          },
        );
        break;
      }
      case "update_card": {
        const cardId = getStringValue(input.cardId);
        if (cardId === undefined) {
          throw new Error("cardId is required");
        }
        content = await runUpdateCardTool(
          workspaceId,
          cardId,
          {
            frontText: getStringValue(input.frontText),
            backText: getStringValue(input.backText),
            tags: input.tags === undefined ? undefined : getTagsValue(input.tags),
            effortLevel: getStringValue(input.effortLevel) as "fast" | "medium" | "long" | undefined,
          },
          {
            deviceId,
          },
        );
        break;
      }
      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }

    return {
      type: "tool_result",
      tool_use_id: toolUseId,
      content,
    };
  } catch (error) {
    return {
      type: "tool_result",
      tool_use_id: toolUseId,
      content: error instanceof Error ? error.message : String(error),
      is_error: true,
    };
  }
}
