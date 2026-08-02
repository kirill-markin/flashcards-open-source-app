import { normalizeIsoTimestamp } from "../sync/conflicts/lww";

export type CardImportTagOptions = Readonly<{
  addImportTag: boolean;
  importTag: string;
  removeTags: ReadonlyArray<string>;
}>;

export type CardImportTagSource = Readonly<{
  tags: ReadonlyArray<string>;
}>;

export type CardImportTagCount = Readonly<{
  tag: string;
  cardsCount: number;
}>;

export type CardImportTagPlan = Readonly<{
  cardTags: ReadonlyArray<ReadonlyArray<string>>;
  sourceTagCounts: ReadonlyArray<CardImportTagCount>;
  keptTags: ReadonlyArray<string>;
  removedTags: ReadonlyArray<string>;
  importTag: string | null;
}>;

function createCardImportTagInputError(message: string): TypeError {
  return new TypeError(`Invalid card import tag input: ${message}`);
}

function normalizeRequiredText(value: string, fieldName: string): string {
  if (typeof value !== "string") {
    throw createCardImportTagInputError(`${fieldName} must be a string`);
  }

  const normalizedValue = value.trim();
  if (normalizedValue === "") {
    throw createCardImportTagInputError(`${fieldName} must not be empty`);
  }

  return normalizedValue;
}

function normalizeUniqueTextValues(
  values: ReadonlyArray<string>,
  fieldName: string,
): ReadonlyArray<string> {
  if (Array.isArray(values) === false) {
    throw createCardImportTagInputError(`${fieldName} must be an array`);
  }

  const normalizedValues: Array<string> = [];
  const seenValues = new Set<string>();

  values.forEach((value, index) => {
    const normalizedValue = normalizeRequiredText(value, `${fieldName}[${index}]`);
    if (seenValues.has(normalizedValue)) {
      throw createCardImportTagInputError(`${fieldName} must not contain duplicates`);
    }

    seenValues.add(normalizedValue);
    normalizedValues.push(normalizedValue);
  });

  return normalizedValues;
}

function validateStringValues(
  values: ReadonlyArray<string>,
  fieldName: string,
): ReadonlyArray<string> {
  if (Array.isArray(values) === false) {
    throw createCardImportTagInputError(`${fieldName} must be an array`);
  }

  return values.map((value, index) => {
    if (typeof value !== "string") {
      throw createCardImportTagInputError(`${fieldName}[${index}] must be a string`);
    }

    return value;
  });
}

function normalizeCardTags(
  tags: ReadonlyArray<string>,
  cardIndex: number,
): ReadonlyArray<string> {
  if (Array.isArray(tags) === false) {
    throw createCardImportTagInputError(`cards[${cardIndex}].tags must be an array`);
  }

  return tags.map((tag, tagIndex) => (
    normalizeRequiredText(tag, `cards[${cardIndex}].tags[${tagIndex}]`)
  ));
}

export function normalizeCardImportTagOptions(options: CardImportTagOptions): CardImportTagOptions {
  if (typeof options.addImportTag !== "boolean") {
    throw createCardImportTagInputError("options.addImportTag must be a boolean");
  }
  if (typeof options.importTag !== "string") {
    throw createCardImportTagInputError("options.importTag must be a string");
  }

  return {
    addImportTag: options.addImportTag,
    importTag: options.addImportTag
      ? normalizeRequiredText(options.importTag, "options.importTag")
      : options.importTag.trim(),
    removeTags: normalizeUniqueTextValues(options.removeTags, "options.removeTags"),
  };
}

function dedupeTags(tags: ReadonlyArray<string>): ReadonlyArray<string> {
  const dedupedTags: Array<string> = [];
  const seenTags = new Set<string>();

  for (const tag of tags) {
    if (seenTags.has(tag)) {
      continue;
    }

    seenTags.add(tag);
    dedupedTags.push(tag);
  }

  return dedupedTags;
}

function compareTagCounts(left: CardImportTagCount, right: CardImportTagCount): number {
  const countDifference = right.cardsCount - left.cardsCount;
  if (countDifference !== 0) {
    return countDifference;
  }

  const normalizedTagDifference = left.tag.toLowerCase().localeCompare(right.tag.toLowerCase());
  if (normalizedTagDifference !== 0) {
    return normalizedTagDifference;
  }

  return left.tag.localeCompare(right.tag);
}

function buildSourceTagCounts(
  cardTags: ReadonlyArray<ReadonlyArray<string>>,
): ReadonlyArray<CardImportTagCount> {
  const tagCounts = new Map<string, number>();

  for (const tags of cardTags) {
    for (const tag of tags) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
  }

  return [...tagCounts.entries()]
    .map(([tag, cardsCount]) => ({ tag, cardsCount }))
    .sort(compareTagCounts);
}

export function buildSuggestedCardImportTag(
  generatedAt: string,
  existingWorkspaceTags: ReadonlyArray<string>,
): string {
  const normalizedGeneratedAt = normalizeIsoTimestamp(
    normalizeRequiredText(generatedAt, "generatedAt"),
    "generatedAt",
  );
  const existingTagValues = validateStringValues(
    existingWorkspaceTags,
    "existingWorkspaceTags",
  );
  const existingTags = new Set(existingTagValues);
  const importDate = normalizedGeneratedAt.slice(0, 10);
  let suffix = 0;
  let suggestedImportTag = `import:${importDate}-${suffix}`;

  while (existingTags.has(suggestedImportTag)) {
    suffix += 1;
    suggestedImportTag = `import:${importDate}-${suffix}`;
  }

  return suggestedImportTag;
}

export function planCardImportTags(
  cards: ReadonlyArray<CardImportTagSource>,
  options: CardImportTagOptions,
): CardImportTagPlan {
  if (Array.isArray(cards) === false) {
    throw createCardImportTagInputError("cards must be an array");
  }

  const normalizedOptions = normalizeCardImportTagOptions(options);
  const sourceCardTags = cards.map((card, cardIndex) => normalizeCardTags(card.tags, cardIndex));
  const sourceTagCounts = buildSourceTagCounts(sourceCardTags);
  const sourceTags = sourceTagCounts.map((tagCount) => tagCount.tag);
  const sourceTagSet = new Set(sourceTags);
  const unknownRemovedTags = normalizedOptions.removeTags.filter((tag) => sourceTagSet.has(tag) === false);
  if (unknownRemovedTags.length !== 0) {
    throw createCardImportTagInputError(
      `options.removeTags must contain only exact package tag values. unknownTags=${unknownRemovedTags.join(",")}`,
    );
  }

  const removedTagSet = new Set(normalizedOptions.removeTags);
  const keptTags = sourceTags.filter((tag) => removedTagSet.has(tag) === false);
  const cardTags = sourceCardTags.map((tags) => {
    const keptCardTags = tags.filter((tag) => removedTagSet.has(tag) === false);
    const finalTags = normalizedOptions.addImportTag
      ? [...keptCardTags, normalizedOptions.importTag]
      : keptCardTags;
    return dedupeTags(finalTags);
  });

  return {
    cardTags,
    sourceTagCounts,
    keptTags,
    removedTags: normalizedOptions.removeTags,
    importTag: normalizedOptions.addImportTag ? normalizedOptions.importTag : null,
  };
}
