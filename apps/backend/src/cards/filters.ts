import { HttpError } from "../errors";
import { expectRecord } from "../server/requestParsing";
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

function expectEffortLevel(value: unknown, fieldName: string): EffortLevel {
  if (value === "fast" || value === "medium" || value === "long") {
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

function expectEffortArray(value: unknown, fieldName: string): ReadonlyArray<EffortLevel> {
  if (Array.isArray(value) === false) {
    throw new HttpError(400, `${fieldName} must be an array`);
  }

  return value.map((entry, index) => expectEffortLevel(entry, `${fieldName}[${index}]`));
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

  const filter = normalizeCardFilter({
    tags: record.tags === undefined ? [] : expectStringArray(record.tags, `${fieldName}.tags`),
    effort: record.effort === undefined ? [] : expectEffortArray(record.effort, `${fieldName}.effort`),
  });

  return filter;
}
