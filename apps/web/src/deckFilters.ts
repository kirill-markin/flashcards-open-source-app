import type { DeckFilterDefinition, EffortLevel } from "./types";

export const EFFORT_LEVELS: ReadonlyArray<EffortLevel> = ["fast", "medium", "long"];
/** Label for the synthetic system deck that aggregates every active card. */
export const ALL_CARDS_DECK_LABEL = "All cards";

export function buildDeckFilterDefinition(
  effortLevels: ReadonlyArray<EffortLevel>,
  tags: ReadonlyArray<string>,
): DeckFilterDefinition {
  return {
    version: 2,
    effortLevels,
    tags,
  };
}

export function formatDeckFilterDefinition(filterDefinition: DeckFilterDefinition): string {
  const parts: Array<string> = [];

  if (filterDefinition.effortLevels.length > 0) {
    parts.push(`effort in ${filterDefinition.effortLevels.join(", ")}`);
  }

  if (filterDefinition.tags.length > 0) {
    parts.push(`tags contain ${filterDefinition.tags.join(", ")}`);
  }

  if (parts.length === 0) {
    return ALL_CARDS_DECK_LABEL;
  }

  return parts.join(" AND ");
}
