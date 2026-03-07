import type { DeckFilterDefinition, DeckPredicate, EffortLevel } from "./types";

export const EFFORT_LEVELS: ReadonlyArray<EffortLevel> = ["fast", "medium", "long"];

export type DeckTagsOperator = "containsAny" | "containsAll";

function formatDeckPredicate(predicate: DeckPredicate): string {
  if (predicate.field === "effortLevel") {
    return `effort in ${predicate.values.join(", ")}`;
  }

  const operatorLabel = predicate.operator === "containsAll" ? "contains all" : "contains any";
  return `tags ${operatorLabel} ${predicate.values.join(", ")}`;
}

export function buildDeckFilterDefinition(
  effortLevels: ReadonlyArray<EffortLevel>,
  tagsOperator: DeckTagsOperator,
  tags: ReadonlyArray<string>,
): DeckFilterDefinition {
  const predicates: Array<DeckPredicate> = [];

  if (effortLevels.length > 0) {
    predicates.push({
      field: "effortLevel",
      operator: "in",
      values: effortLevels,
    });
  }

  if (tags.length > 0) {
    predicates.push({
      field: "tags",
      operator: tagsOperator,
      values: tags,
    });
  }

  return {
    version: 1,
    combineWith: "and",
    predicates,
  };
}

export function formatDeckFilterDefinition(filterDefinition: DeckFilterDefinition): string {
  if (filterDefinition.predicates.length === 0) {
    return "All cards";
  }

  const joinLabel = filterDefinition.combineWith === "or" ? " OR " : " AND ";
  return filterDefinition.predicates.map(formatDeckPredicate).join(joinLabel);
}
