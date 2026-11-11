import type { UpdateCardInput } from "../../types";

export function areSameTags(left: ReadonlyArray<string>, right: ReadonlyArray<string>): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((tag, index) => tag === right[index]);
}

export function rebaseTagDraft(
  previousValue: ReadonlyArray<string>,
  nextValue: ReadonlyArray<string>,
  draftTags: ReadonlyArray<string>,
): ReadonlyArray<string> {
  if (areSameTags(draftTags, previousValue)) {
    return nextValue;
  }

  const previousTags = new Set(previousValue);
  const nextTags = new Set(nextValue);
  const draftTagSet = new Set(draftTags);
  const removedTags = new Set(
    previousValue.filter((tag) => draftTagSet.has(tag) === false),
  );
  const localAdditions = draftTags.filter((tag) => previousTags.has(tag) === false);
  const previousSurvivingOrder = previousValue.filter((tag) => draftTagSet.has(tag));
  const draftPreviousOrder = draftTags.filter((tag) => previousTags.has(tag));

  if (areSameTags(previousSurvivingOrder, draftPreviousOrder)) {
    const rebasedTags = nextValue.filter((tag) => removedTags.has(tag) === false);
    const rebasedTagSet = new Set(rebasedTags);
    return [
      ...rebasedTags,
      ...localAdditions.filter((tag) => rebasedTagSet.has(tag) === false),
    ];
  }

  const rebasedLocalTags = draftTags.filter((tag) => (
    nextTags.has(tag) || previousTags.has(tag) === false
  ));
  const rebasedLocalTagSet = new Set(rebasedLocalTags);
  return [
    ...rebasedLocalTags,
    ...nextValue.filter((tag) => (
      rebasedLocalTagSet.has(tag) === false
      && removedTags.has(tag) === false
    )),
  ];
}

export function buildTagEdit(
  baseline: ReadonlyArray<string>,
  draft: ReadonlyArray<string>,
): UpdateCardInput["tagEdit"] {
  return areSameTags(baseline, draft) ? undefined : { baseline, draft };
}
