import Anthropic from "@anthropic-ai/sdk";
import {
  runCreateCardsTool,
  runCreateDecksTool,
  runDeleteCardsTool,
  runDeleteDecksTool,
  runGetCardsTool,
  runGetDecksTool,
  runListCardsTool,
  runListDecksTool,
  runListDueCardsTool,
  runListReviewHistoryTool,
  runSearchCardsTool,
  runSearchDecksTool,
  runSummarizeDeckStateTool,
  runUpdateCardsTool,
  runUpdateDecksTool,
} from "../shared";

export const CODE_EXECUTION_TOOL: Anthropic.Beta.Messages.BetaCodeExecutionTool20250825 = {
  type: "code_execution_20250825",
  name: "code_execution",
};

const CARD_ID_ARRAY_SCHEMA = {
  type: "array",
  items: { type: "string" },
  minItems: 1,
  maxItems: 100,
} as const;

const DECK_ID_ARRAY_SCHEMA = {
  type: "array",
  items: { type: "string" },
  minItems: 1,
  maxItems: 100,
} as const;

const CARD_INPUT_SCHEMA = {
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
} as const;

const CARD_UPDATE_SCHEMA = {
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
} as const;

const DECK_INPUT_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string" },
    effortLevels: {
      type: "array",
      items: {
        type: "string",
        enum: ["fast", "medium", "long"],
      },
    },
    tags: {
      type: "array",
      items: { type: "string" },
    },
  },
  required: ["name", "effortLevels", "tags"],
} as const;

const DECK_UPDATE_SCHEMA = {
  type: "object",
  properties: {
    deckId: { type: "string" },
    name: { type: "string" },
    effortLevels: {
      type: "array",
      items: {
        type: "string",
        enum: ["fast", "medium", "long"],
      },
    },
    tags: {
      type: "array",
      items: { type: "string" },
    },
  },
  required: ["deckId"],
} as const;

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

const GET_CARDS_TOOL: Anthropic.Tool = {
  name: "get_cards",
  description: "Get one or more cards by cardId.",
  input_schema: {
    type: "object",
    properties: {
      cardIds: CARD_ID_ARRAY_SCHEMA,
    },
    required: ["cardIds"],
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

const LIST_DECKS_TOOL: Anthropic.Tool = {
  name: "list_decks",
  description: "List decks in the current workspace.",
  input_schema: {
    type: "object",
    properties: {},
  },
};

const SEARCH_DECKS_TOOL: Anthropic.Tool = {
  name: "search_decks",
  description: "Search decks by name, tags, or effort levels.",
  input_schema: {
    type: "object",
    properties: {
      query: { type: "string" },
      limit: { type: "integer", minimum: 1, maximum: 100 },
    },
    required: ["query"],
  },
};

const GET_DECKS_TOOL: Anthropic.Tool = {
  name: "get_decks",
  description: "Get one or more decks by deckId.",
  input_schema: {
    type: "object",
    properties: {
      deckIds: DECK_ID_ARRAY_SCHEMA,
    },
    required: ["deckIds"],
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

const CREATE_CARDS_TOOL: Anthropic.Tool = {
  name: "create_cards",
  description: "Create one or more cards.",
  input_schema: {
    type: "object",
    properties: {
      cards: {
        ...CARD_ID_ARRAY_SCHEMA,
        items: CARD_INPUT_SCHEMA,
      },
    },
    required: ["cards"],
  },
};

const UPDATE_CARDS_TOOL: Anthropic.Tool = {
  name: "update_cards",
  description: "Update editable card fields for one or more cards.",
  input_schema: {
    type: "object",
    properties: {
      updates: {
        ...CARD_ID_ARRAY_SCHEMA,
        items: CARD_UPDATE_SCHEMA,
      },
    },
    required: ["updates"],
  },
};

const DELETE_CARDS_TOOL: Anthropic.Tool = {
  name: "delete_cards",
  description: "Delete one or more cards.",
  input_schema: {
    type: "object",
    properties: {
      cardIds: CARD_ID_ARRAY_SCHEMA,
    },
    required: ["cardIds"],
  },
};

const CREATE_DECKS_TOOL: Anthropic.Tool = {
  name: "create_decks",
  description: "Create one or more decks.",
  input_schema: {
    type: "object",
    properties: {
      decks: {
        ...DECK_ID_ARRAY_SCHEMA,
        items: DECK_INPUT_SCHEMA,
      },
    },
    required: ["decks"],
  },
};

const UPDATE_DECKS_TOOL: Anthropic.Tool = {
  name: "update_decks",
  description: "Update one or more decks.",
  input_schema: {
    type: "object",
    properties: {
      updates: {
        ...DECK_ID_ARRAY_SCHEMA,
        items: DECK_UPDATE_SCHEMA,
      },
    },
    required: ["updates"],
  },
};

const DELETE_DECKS_TOOL: Anthropic.Tool = {
  name: "delete_decks",
  description: "Delete one or more decks.",
  input_schema: {
    type: "object",
    properties: {
      deckIds: DECK_ID_ARRAY_SCHEMA,
    },
    required: ["deckIds"],
  },
};

export const ANTHROPIC_FLASHCARDS_TOOLS: ReadonlyArray<Anthropic.Tool> = [
  LIST_CARDS_TOOL,
  GET_CARDS_TOOL,
  SEARCH_CARDS_TOOL,
  LIST_DUE_CARDS_TOOL,
  LIST_DECKS_TOOL,
  SEARCH_DECKS_TOOL,
  GET_DECKS_TOOL,
  LIST_REVIEW_HISTORY_TOOL,
  SUMMARIZE_DECK_STATE_TOOL,
  CREATE_CARDS_TOOL,
  UPDATE_CARDS_TOOL,
  DELETE_CARDS_TOOL,
  CREATE_DECKS_TOOL,
  UPDATE_DECKS_TOOL,
  DELETE_DECKS_TOOL,
];

function getNumberValue(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function getStringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function getStringArrayValue(value: unknown, fieldName: string): ReadonlyArray<string> {
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} must be an array of strings`);
  }

  const items: Array<string> = [];
  for (const item of value) {
    if (typeof item !== "string") {
      throw new Error(`${fieldName} must be an array of strings`);
    }

    items.push(item);
  }

  return items;
}

function getTagsValue(value: unknown): ReadonlyArray<string> {
  return getStringArrayValue(value, "tags");
}

function getEffortLevelsValue(value: unknown): ReadonlyArray<"fast" | "medium" | "long"> {
  const items = getStringArrayValue(value, "effortLevels");

  for (const item of items) {
    if (item !== "fast" && item !== "medium" && item !== "long") {
      throw new Error("effortLevels must contain only fast, medium, or long");
    }
  }

  return items as ReadonlyArray<"fast" | "medium" | "long">;
}

function getCreateCardsValue(value: unknown): ReadonlyArray<Readonly<{
  frontText: string;
  backText: string;
  tags: ReadonlyArray<string>;
  effortLevel: "fast" | "medium" | "long";
}>> {
  if (!Array.isArray(value)) {
    throw new Error("cards must be an array");
  }

  return value.map((item, index) => {
    if (typeof item !== "object" || item === null) {
      throw new Error(`cards[${index}] must be an object`);
    }

    const objectItem = item as Record<string, unknown>;
    const frontText = getStringValue(objectItem.frontText);
    const backText = getStringValue(objectItem.backText);
    const effortLevel = getStringValue(objectItem.effortLevel);
    if (frontText === undefined || backText === undefined || effortLevel === undefined) {
      throw new Error("Each cards item must include frontText, backText, tags, and effortLevel");
    }

    return {
      frontText,
      backText,
      tags: getTagsValue(objectItem.tags),
      effortLevel: effortLevel as "fast" | "medium" | "long",
    };
  });
}

function getUpdateCardsValue(value: unknown): ReadonlyArray<Readonly<{
  cardId: string;
  frontText: string | undefined;
  backText: string | undefined;
  tags: ReadonlyArray<string> | undefined;
  effortLevel: "fast" | "medium" | "long" | undefined;
}>> {
  if (!Array.isArray(value)) {
    throw new Error("updates must be an array");
  }

  return value.map((item, index) => {
    if (typeof item !== "object" || item === null) {
      throw new Error(`updates[${index}] must be an object`);
    }

    const objectItem = item as Record<string, unknown>;
    const cardId = getStringValue(objectItem.cardId);
    if (cardId === undefined) {
      throw new Error("Each updates item must include cardId");
    }

    return {
      cardId,
      frontText: getStringValue(objectItem.frontText),
      backText: getStringValue(objectItem.backText),
      tags: objectItem.tags === undefined ? undefined : getTagsValue(objectItem.tags),
      effortLevel: getStringValue(objectItem.effortLevel) as "fast" | "medium" | "long" | undefined,
    };
  });
}

function getCreateDecksValue(value: unknown): ReadonlyArray<Readonly<{
  name: string;
  effortLevels: ReadonlyArray<"fast" | "medium" | "long">;
  tags: ReadonlyArray<string>;
}>> {
  if (!Array.isArray(value)) {
    throw new Error("decks must be an array");
  }

  return value.map((item, index) => {
    if (typeof item !== "object" || item === null) {
      throw new Error(`decks[${index}] must be an object`);
    }

    const objectItem = item as Record<string, unknown>;
    const name = getStringValue(objectItem.name);
    if (name === undefined) {
      throw new Error("Each decks item must include name, effortLevels, and tags");
    }

    return {
      name,
      effortLevels: getEffortLevelsValue(objectItem.effortLevels),
      tags: getTagsValue(objectItem.tags),
    };
  });
}

function getUpdateDecksValue(value: unknown): ReadonlyArray<Readonly<{
  deckId: string;
  name: string | undefined;
  effortLevels: ReadonlyArray<"fast" | "medium" | "long"> | undefined;
  tags: ReadonlyArray<string> | undefined;
}>> {
  if (!Array.isArray(value)) {
    throw new Error("updates must be an array");
  }

  return value.map((item, index) => {
    if (typeof item !== "object" || item === null) {
      throw new Error(`updates[${index}] must be an object`);
    }

    const objectItem = item as Record<string, unknown>;
    const deckId = getStringValue(objectItem.deckId);
    if (deckId === undefined) {
      throw new Error("Each updates item must include deckId");
    }

    return {
      deckId,
      name: getStringValue(objectItem.name),
      effortLevels: objectItem.effortLevels === undefined ? undefined : getEffortLevelsValue(objectItem.effortLevels),
      tags: objectItem.tags === undefined ? undefined : getTagsValue(objectItem.tags),
    };
  });
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
      case "get_cards":
        content = await runGetCardsTool(workspaceId, getStringArrayValue(input.cardIds, "cardIds"));
        break;
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
      case "list_decks":
        content = await runListDecksTool(workspaceId);
        break;
      case "search_decks": {
        const query = getStringValue(input.query);
        if (query === undefined) {
          throw new Error("query is required");
        }
        content = await runSearchDecksTool(workspaceId, query, getNumberValue(input.limit));
        break;
      }
      case "get_decks":
        content = await runGetDecksTool(workspaceId, getStringArrayValue(input.deckIds, "deckIds"));
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
      case "create_cards":
        content = await runCreateCardsTool(workspaceId, getCreateCardsValue(input.cards), { deviceId });
        break;
      case "update_cards":
        content = await runUpdateCardsTool(workspaceId, getUpdateCardsValue(input.updates), { deviceId });
        break;
      case "delete_cards":
        content = await runDeleteCardsTool(workspaceId, getStringArrayValue(input.cardIds, "cardIds"), { deviceId });
        break;
      case "create_decks":
        content = await runCreateDecksTool(workspaceId, getCreateDecksValue(input.decks), { deviceId });
        break;
      case "update_decks":
        content = await runUpdateDecksTool(workspaceId, getUpdateDecksValue(input.updates), { deviceId });
        break;
      case "delete_decks":
        content = await runDeleteDecksTool(workspaceId, getStringArrayValue(input.deckIds, "deckIds"), { deviceId });
        break;
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
