import type { DeckFilterDefinition } from "./types";

/** Label for the synthetic system deck that aggregates every active card. */
export const ALL_CARDS_DECK_LABEL = "All cards";
export const ALL_CARDS_DECK_SLUG = "all-cards";

export function buildDeckFilterDefinition(
  tags: ReadonlyArray<string>,
): DeckFilterDefinition {
  return {
    version: 2,
    tags,
  };
}

export function formatDeckFilterDefinition(filterDefinition: DeckFilterDefinition): string {
  const parts: Array<string> = [];

  if (filterDefinition.tags.length > 0) {
    parts.push(`tags any of ${filterDefinition.tags.join(", ")}`);
  }

  if (parts.length === 0) {
    return ALL_CARDS_DECK_LABEL;
  }

  return parts.join(" AND ");
}
