import * as d3 from "d3";

export type UserColorScale = d3.ScaleOrdinal<string, string, string>;

const userColorPalette: ReadonlyArray<string> = [
  ...d3.schemeTableau10,
  ...d3.schemeSet2,
  ...d3.schemeDark2,
  "#e15759",
  "#76b7b2",
  "#f28e2b",
  "#59a14f",
];

// The scale is shared by every dashboard section, so it must not be mutated by being read. A
// `d3.scaleOrdinal` defaults its unknown behavior to `implicit`, which appends an id that is not in
// the domain and hands back a wrapped palette colour, making one person's colour depend on which
// section rendered first. An explicit unknown value makes that impossible; a user reaching it means
// the domain missed a section's user list rather than that the person has no colour of their own.
const unknownUserColor = "#8c8c8c";

export function getUserColorScale(userIds: ReadonlyArray<string>): UserColorScale {
  const colors = userIds.map((userId) => userColorPalette[getUserColorPaletteIndex(userId)]);

  return d3.scaleOrdinal<string, string>(userIds, colors).unknown(unknownUserColor);
}

/**
 * The colour domain over every section's users. Deduplicated because sections share people, and
 * because `d3.scaleOrdinal` drops a repeated domain entry while keeping every range entry, which
 * would shift the colours of everyone after the first duplicate.
 */
export function getStableUserColorDomain(
  users: ReadonlyArray<Readonly<{ userId: string }>>,
): ReadonlyArray<string> {
  return Array.from(new Set(users.map((user) => user.userId)))
    .sort((leftUserId, rightUserId) => leftUserId.localeCompare(rightUserId));
}

function getUserColorPaletteIndex(userId: string): number {
  let hash = 0;

  for (const character of userId) {
    hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
  }

  return Math.abs(hash) % userColorPalette.length;
}
