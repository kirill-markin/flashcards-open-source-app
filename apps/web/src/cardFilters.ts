import type { CardFilter, EffortLevel } from "./types";

function normalizeCardFilterTags(tags: ReadonlyArray<string>): ReadonlyArray<string> {
  return tags.reduce<Array<string>>((result, tag) => {
    const normalizedTag = tag.trim();
    const normalizedTagKey = normalizedTag.toLowerCase();
    if (normalizedTag === "" || result.some((value) => value.toLowerCase() === normalizedTagKey)) {
      return result;
    }

    result.push(normalizedTag);
    return result;
  }, []);
}

function normalizeCardFilterEffort(effort: ReadonlyArray<EffortLevel>): ReadonlyArray<EffortLevel> {
  return effort.reduce<Array<EffortLevel>>((result, effortLevel) => {
    if (result.includes(effortLevel)) {
      return result;
    }

    result.push(effortLevel);
    return result;
  }, []);
}

export function normalizeCardFilter(filter: CardFilter | null): CardFilter | null {
  if (filter === null) {
    return null;
  }

  const normalizedFilter: CardFilter = {
    tags: normalizeCardFilterTags(filter.tags),
    effort: normalizeCardFilterEffort(filter.effort),
  };

  if (normalizedFilter.tags.length === 0 && normalizedFilter.effort.length === 0) {
    return null;
  }

  return normalizedFilter;
}

export function getCardFilterActiveDimensionCount(filter: CardFilter | null): number {
  if (filter === null) {
    return 0;
  }

  return Number(filter.effort.length > 0) + Number(filter.tags.length > 0);
}

export function formatCardFilterSummary(filter: CardFilter | null): string {
  if (filter === null) {
    return "No filters";
  }

  const parts: Array<string> = [];
  if (filter.effort.length > 0) {
    parts.push(`effort in ${filter.effort.join(", ")}`);
  }

  if (filter.tags.length > 0) {
    parts.push(`tags any of ${filter.tags.join(", ")}`);
  }

  if (parts.length === 0) {
    return "No filters";
  }

  return parts.join(" AND ");
}
