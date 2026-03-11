export type ExternalAgentToolName =
  | "get_workspace_context"
  | "list_cards"
  | "get_cards"
  | "search_cards"
  | "list_due_cards"
  | "list_decks"
  | "get_decks"
  | "search_decks"
  | "list_review_history"
  | "get_scheduler_settings"
  | "create_cards"
  | "update_cards"
  | "delete_cards"
  | "create_decks"
  | "update_decks"
  | "delete_decks";

export type ExternalAgentToolDefinition = Readonly<{
  name: ExternalAgentToolName;
  description: string;
}>;

export const EXTERNAL_AGENT_TOOL_MAX_RESULT_COUNT = 100;

/**
 * Canonical external AI-agent tool catalog. This list intentionally mirrors
 * the public cloud-facing capabilities and omits first-party internals such as
 * sync transport, local chat runtime endpoints, cloud settings, and outbox.
 */
export const EXTERNAL_AGENT_TOOL_DEFINITIONS: ReadonlyArray<ExternalAgentToolDefinition> = [
  {
    name: "get_workspace_context",
    description: "Load the selected workspace summary, deck summary, and scheduler settings.",
  },
  {
    name: "list_cards",
    description: "List cards from the selected workspace.",
  },
  {
    name: "get_cards",
    description: "Load one or more cards by cardId from the selected workspace.",
  },
  {
    name: "search_cards",
    description: "Search cards by front text, back text, tags, or effort level.",
  },
  {
    name: "list_due_cards",
    description: "List cards currently due for review in the selected workspace.",
  },
  {
    name: "list_decks",
    description: "List decks from the selected workspace.",
  },
  {
    name: "get_decks",
    description: "Load one or more decks by deckId from the selected workspace.",
  },
  {
    name: "search_decks",
    description: "Search decks by name, tags, or effort levels.",
  },
  {
    name: "list_review_history",
    description: "List recent review events, optionally filtered by cardId.",
  },
  {
    name: "get_scheduler_settings",
    description: "Load the selected workspace scheduler settings.",
  },
  {
    name: "create_cards",
    description: "Create one or more cards in the selected workspace. Use the flashcard side contract: frontText is a question-only recall prompt (no answer), and backText contains the answer with an optional concrete example.",
  },
  {
    name: "update_cards",
    description: "Update one or more cards in the selected workspace. For provided text fields, use the flashcard side contract: frontText is a question-only recall prompt (no answer), and backText contains the answer with an optional concrete example.",
  },
  {
    name: "delete_cards",
    description: "Delete one or more cards in the selected workspace.",
  },
  {
    name: "create_decks",
    description: "Create one or more decks in the selected workspace.",
  },
  {
    name: "update_decks",
    description: "Update one or more decks in the selected workspace.",
  },
  {
    name: "delete_decks",
    description: "Delete one or more decks in the selected workspace.",
  },
] as const;
