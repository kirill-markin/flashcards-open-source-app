import { HttpError } from "../shared/errors";
import { expectRecord } from "../server/requestParsing";
import type { LegacyEffortLevel } from "../sync/contracts/legacyEffort";
import { isLegacyEffortLevel } from "../sync/contracts/legacyEffort";
import type { CardFilter } from "./types";

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

export function normalizeCardFilter(filter: CardFilter | null): CardFilter | null {
  if (filter === null) {
    return null;
  }

  const normalizedFilter: CardFilter = {
    tags: normalizeCardFilterTags(filter.tags),
  };

  if (normalizedFilter.tags.length === 0) {
    return null;
  }

  return normalizedFilter;
}

function expectLegacyEffortLevel(value: unknown, fieldName: string): LegacyEffortLevel {
  if (isLegacyEffortLevel(value)) {
    return value;
  }

  throw new HttpError(400, `${fieldName} must be one of: fast, medium, long`);
}

function expectStringArray(value: unknown, fieldName: string): ReadonlyArray<string> {
  if (Array.isArray(value) === false) {
    throw new HttpError(400, `${fieldName} must be an array`);
  }

  return value.map((entry, index) => {
    if (typeof entry !== "string") {
      throw new HttpError(400, `${fieldName}[${index}] must be a string`);
    }

    return entry;
  });
}

function expectLegacyEffortArray(value: unknown, fieldName: string): ReadonlyArray<LegacyEffortLevel> {
  if (Array.isArray(value) === false) {
    throw new HttpError(400, `${fieldName} must be an array`);
  }

  return value.map((entry, index) => expectLegacyEffortLevel(entry, `${fieldName}[${index}]`));
}

function legacyEffortFilterToTags(effort: ReadonlyArray<LegacyEffortLevel>): ReadonlyArray<string> {
  return effort.filter((effortLevel) => effortLevel === "medium" || effortLevel === "long");
}

export function parseCardFilterInput(value: unknown, fieldName: string): CardFilter | null {
  if (value === null) {
    return null;
  }

  const record = expectRecord(value);
  for (const key of Object.keys(record)) {
    if (key !== "tags" && key !== "effort") {
      throw new HttpError(400, `${fieldName}.${key} is not supported`);
    }
  }

  // TODO(old-mobile-cutoff): Remove legacy effort filter parsing during final wire-drop cleanup.
  const legacyEffortTags = record.effort === undefined
    ? []
    : legacyEffortFilterToTags(expectLegacyEffortArray(record.effort, `${fieldName}.effort`));
  const filter = normalizeCardFilter({
    tags: [
      ...(record.tags === undefined ? [] : expectStringArray(record.tags, `${fieldName}.tags`)),
      ...legacyEffortTags,
    ],
  });

  return filter;
}
