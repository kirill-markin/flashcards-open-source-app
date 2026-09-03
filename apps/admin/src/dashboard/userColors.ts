import * as d3 from "d3";
import type { ReviewEventsByDateUser } from "../adminApi";

export type UserColorScale = d3.ScaleOrdinal<string, string>;

const userColorPalette: ReadonlyArray<string> = [
  ...d3.schemeTableau10,
  ...d3.schemeSet2,
  ...d3.schemeDark2,
  "#e15759",
  "#76b7b2",
  "#f28e2b",
  "#59a14f",
];

export function getUserColorScale(userIds: ReadonlyArray<string>): UserColorScale {
  const colors = userIds.map((userId) => userColorPalette[getUserColorPaletteIndex(userId)]);

  return d3.scaleOrdinal<string, string>(userIds, colors);
}

export function getStableUserColorDomain(users: ReadonlyArray<ReviewEventsByDateUser>): ReadonlyArray<string> {
  return users.map((user) => user.userId).sort((leftUserId, rightUserId) => leftUserId.localeCompare(rightUserId));
}

function getUserColorPaletteIndex(userId: string): number {
  let hash = 0;

  for (const character of userId) {
    hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
  }

  return Math.abs(hash) % userColorPalette.length;
}
