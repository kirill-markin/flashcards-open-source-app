import { tool, type RunContext } from "@openai/agents";
import { z } from "zod";
import {
  runCreateCardsTool,
  runDeleteCardsTool,
  runGetCardsTool,
  runListCardsTool,
  runListDueCardsTool,
  runListReviewHistoryTool,
  runSearchCardsTool,
  runSummarizeDeckStateTool,
  runUpdateCardsTool,
  type AgentContext,
} from "../shared";

const CARD_ID_ARRAY_SCHEMA = z.array(z.string().min(1)).min(1).max(100);
const CARD_INPUT_SCHEMA = z.object({
  frontText: z.string().min(1),
  backText: z.string(),
  tags: z.array(z.string()),
  effortLevel: z.enum(["fast", "medium", "long"]),
});
const CARD_UPDATE_SCHEMA = z.object({
  cardId: z.string().min(1),
  frontText: z.string().min(1).nullable(),
  backText: z.string().nullable(),
  tags: z.array(z.string()).nullable(),
  effortLevel: z.enum(["fast", "medium", "long"]).nullable(),
});

function expectRunContext(runContext: RunContext<AgentContext> | undefined): AgentContext {
  if (runContext === undefined) {
    throw new Error("Missing run context");
  }

  return runContext.context;
}

export const listCardsTool = tool({
  name: "list_cards",
  description: "List cards in the current workspace.",
  parameters: z.object({
    limit: z.number().int().min(1).max(100).nullable(),
  }),
  execute: async (input: { limit: number | null }, runContext?: RunContext<AgentContext>): Promise<string> => {
    const context = expectRunContext(runContext);
    return runListCardsTool(context.workspaceId, input.limit ?? undefined);
  },
});

export const getCardsTool = tool({
  name: "get_cards",
  description: "Get one or more cards by cardId.",
  parameters: z.object({
    cardIds: CARD_ID_ARRAY_SCHEMA,
  }),
  execute: async (input: { cardIds: ReadonlyArray<string> }, runContext?: RunContext<AgentContext>): Promise<string> => {
    const context = expectRunContext(runContext);
    return runGetCardsTool(context.workspaceId, input.cardIds);
  },
});

export const searchCardsTool = tool({
  name: "search_cards",
  description: "Search cards by front text, back text, or tags.",
  parameters: z.object({
    query: z.string().min(1),
    limit: z.number().int().min(1).max(100).nullable(),
  }),
  execute: async (
    input: { query: string; limit: number | null },
    runContext?: RunContext<AgentContext>,
  ): Promise<string> => {
    const context = expectRunContext(runContext);
    return runSearchCardsTool(context.workspaceId, input.query, input.limit ?? undefined);
  },
});

export const listDueCardsTool = tool({
  name: "list_due_cards",
  description: "List cards currently due for review.",
  parameters: z.object({
    limit: z.number().int().min(1).max(100).nullable(),
  }),
  execute: async (input: { limit: number | null }, runContext?: RunContext<AgentContext>): Promise<string> => {
    const context = expectRunContext(runContext);
    return runListDueCardsTool(context.workspaceId, input.limit ?? undefined);
  },
});

export const listReviewHistoryTool = tool({
  name: "list_review_history",
  description: "List recent review events, optionally filtered by cardId.",
  parameters: z.object({
    limit: z.number().int().min(1).max(100).nullable(),
    cardId: z.string().min(1).nullable(),
  }),
  execute: async (
    input: { limit: number | null; cardId: string | null },
    runContext?: RunContext<AgentContext>,
  ): Promise<string> => {
    const context = expectRunContext(runContext);
    return runListReviewHistoryTool(context.workspaceId, input.limit ?? undefined, input.cardId ?? undefined);
  },
});

export const summarizeDeckStateTool = tool({
  name: "summarize_deck_state",
  description: "Summarize deck counts and review stats for the current workspace.",
  parameters: z.object({}),
  execute: async (_input: Record<string, never>, runContext?: RunContext<AgentContext>): Promise<string> => {
    const context = expectRunContext(runContext);
    return runSummarizeDeckStateTool(context.workspaceId);
  },
});

export const createCardsTool = tool({
  name: "create_cards",
  description: "Create one or more cards.",
  parameters: z.object({
    cards: z.array(CARD_INPUT_SCHEMA).min(1).max(100),
  }),
  execute: async (
    input: { cards: ReadonlyArray<{
      frontText: string;
      backText: string;
      tags: ReadonlyArray<string>;
      effortLevel: "fast" | "medium" | "long";
    }> },
    runContext?: RunContext<AgentContext>,
  ): Promise<string> => {
    const context = expectRunContext(runContext);
    return runCreateCardsTool(context.workspaceId, input.cards, {
      deviceId: context.deviceId,
    });
  },
});

export const updateCardsTool = tool({
  name: "update_cards",
  description: "Update one or more cards.",
  parameters: z.object({
    updates: z.array(CARD_UPDATE_SCHEMA).min(1).max(100),
  }),
  execute: async (
    input: {
      updates: ReadonlyArray<{
        cardId: string;
        frontText: string | null;
        backText: string | null;
        tags: ReadonlyArray<string> | null;
        effortLevel: "fast" | "medium" | "long" | null;
      }>;
    },
    runContext?: RunContext<AgentContext>,
  ): Promise<string> => {
    const context = expectRunContext(runContext);
    return runUpdateCardsTool(
      context.workspaceId,
      input.updates.map((update) => ({
        cardId: update.cardId,
        frontText: update.frontText ?? undefined,
        backText: update.backText ?? undefined,
        tags: update.tags ?? undefined,
        effortLevel: update.effortLevel ?? undefined,
      })),
      {
        deviceId: context.deviceId,
      },
    );
  },
});

export const deleteCardsTool = tool({
  name: "delete_cards",
  description: "Delete one or more cards.",
  parameters: z.object({
    cardIds: CARD_ID_ARRAY_SCHEMA,
  }),
  execute: async (
    input: { cardIds: ReadonlyArray<string> },
    runContext?: RunContext<AgentContext>,
  ): Promise<string> => {
    const context = expectRunContext(runContext);
    return runDeleteCardsTool(context.workspaceId, input.cardIds, {
      deviceId: context.deviceId,
    });
  },
});

export const OPENAI_FLASHCARDS_TOOLS = [
  listCardsTool,
  getCardsTool,
  searchCardsTool,
  listDueCardsTool,
  listReviewHistoryTool,
  summarizeDeckStateTool,
  createCardsTool,
  updateCardsTool,
  deleteCardsTool,
] as const;
