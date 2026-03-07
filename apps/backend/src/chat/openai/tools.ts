import { tool, type RunContext } from "@openai/agents";
import { z } from "zod";
import {
  runCreateCardTool,
  runGetCardTool,
  runListCardsTool,
  runListDueCardsTool,
  runListReviewHistoryTool,
  runSearchCardsTool,
  runSummarizeDeckStateTool,
  runUpdateCardTool,
  type AgentContext,
} from "../shared";

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
    limit: z.number().int().min(1).max(100).optional(),
  }),
  execute: async (input: { limit?: number }, runContext?: RunContext<AgentContext>): Promise<string> => {
    const context = expectRunContext(runContext);
    return runListCardsTool(context.workspaceId, input.limit);
  },
});

export const getCardTool = tool({
  name: "get_card",
  description: "Get one card by cardId.",
  parameters: z.object({
    cardId: z.string().min(1),
  }),
  execute: async (input: { cardId: string }, runContext?: RunContext<AgentContext>): Promise<string> => {
    const context = expectRunContext(runContext);
    return runGetCardTool(context.workspaceId, input.cardId);
  },
});

export const searchCardsTool = tool({
  name: "search_cards",
  description: "Search cards by front text, back text, or tags.",
  parameters: z.object({
    query: z.string().min(1),
    limit: z.number().int().min(1).max(100).optional(),
  }),
  execute: async (input: { query: string; limit?: number }, runContext?: RunContext<AgentContext>): Promise<string> => {
    const context = expectRunContext(runContext);
    return runSearchCardsTool(context.workspaceId, input.query, input.limit);
  },
});

export const listDueCardsTool = tool({
  name: "list_due_cards",
  description: "List cards currently due for review.",
  parameters: z.object({
    limit: z.number().int().min(1).max(100).optional(),
  }),
  execute: async (input: { limit?: number }, runContext?: RunContext<AgentContext>): Promise<string> => {
    const context = expectRunContext(runContext);
    return runListDueCardsTool(context.workspaceId, input.limit);
  },
});

export const listReviewHistoryTool = tool({
  name: "list_review_history",
  description: "List recent review events, optionally filtered by cardId.",
  parameters: z.object({
    limit: z.number().int().min(1).max(100).optional(),
    cardId: z.string().min(1).optional(),
  }),
  execute: async (input: { limit?: number; cardId?: string }, runContext?: RunContext<AgentContext>): Promise<string> => {
    const context = expectRunContext(runContext);
    return runListReviewHistoryTool(context.workspaceId, input.limit, input.cardId);
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

export const createCardTool = tool({
  name: "create_card",
  description: "Create a new card after explicit user confirmation.",
  parameters: z.object({
    frontText: z.string().min(1),
    backText: z.string().min(1),
    tags: z.array(z.string()),
    effortLevel: z.enum(["fast", "medium", "long"]),
  }),
  execute: async (
    input: { frontText: string; backText: string; tags: ReadonlyArray<string>; effortLevel: "fast" | "medium" | "long" },
    runContext?: RunContext<AgentContext>,
  ): Promise<string> => {
    const context = expectRunContext(runContext);
    return runCreateCardTool(context.workspaceId, input, { latestUserText: context.latestUserText });
  },
});

export const updateCardTool = tool({
  name: "update_card",
  description: "Update editable card fields after explicit user confirmation.",
  parameters: z.object({
    cardId: z.string().min(1),
    frontText: z.string().min(1).optional(),
    backText: z.string().min(1).optional(),
    tags: z.array(z.string()).optional(),
    effortLevel: z.enum(["fast", "medium", "long"]).optional(),
  }),
  execute: async (
    input: {
      cardId: string;
      frontText?: string;
      backText?: string;
      tags?: ReadonlyArray<string>;
      effortLevel?: "fast" | "medium" | "long";
    },
    runContext?: RunContext<AgentContext>,
  ): Promise<string> => {
    const context = expectRunContext(runContext);
    return runUpdateCardTool(
      context.workspaceId,
      input.cardId,
      {
        frontText: input.frontText,
        backText: input.backText,
        tags: input.tags,
        effortLevel: input.effortLevel,
      },
      { latestUserText: context.latestUserText },
    );
  },
});

export const OPENAI_FLASHCARDS_TOOLS = [
  listCardsTool,
  getCardTool,
  searchCardsTool,
  listDueCardsTool,
  listReviewHistoryTool,
  summarizeDeckStateTool,
  createCardTool,
  updateCardTool,
] as const;
