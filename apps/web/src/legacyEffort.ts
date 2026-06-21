import type { LegacyEffortLevel } from "./types/sync";

function hasTag(tags: ReadonlyArray<string>, requestedTag: string): boolean {
  const requestedTagKey = requestedTag.trim().toLowerCase();
  return tags.some((tag) => tag.trim().toLowerCase() === requestedTagKey);
}

// TODO: Delete this helper when the backend wire contract drops legacy effort fields.
export function appendLegacyEffortTag(
  tags: ReadonlyArray<string>,
  effortLevel: LegacyEffortLevel | undefined,
): ReadonlyArray<string> {
  if (effortLevel === undefined || effortLevel === "fast") {
    return tags;
  }

  if (hasTag(tags, effortLevel)) {
    return tags;
  }

  return [...tags, effortLevel];
}
