import type {
  Card,
  QueryCardsPage,
} from "../types";
import {
  parseArray,
  parseNullableString,
  parseNumber,
  parseObject,
  parseRequiredField,
} from "./core";
import { parseCard } from "./studyData";

function parseCardArray(value: unknown, endpoint: string, path: string): ReadonlyArray<Card> {
  return parseArray(value, endpoint, path, parseCard);
}

export function parseQueryCardsPageResponse(value: unknown, endpoint: string): QueryCardsPage {
  const objectValue = parseObject(value, endpoint, "");
  return {
    cards: parseRequiredField(objectValue, "cards", endpoint, "", parseCardArray),
    nextCursor: parseRequiredField(objectValue, "nextCursor", endpoint, "", parseNullableString),
    totalCount: parseRequiredField(objectValue, "totalCount", endpoint, "", parseNumber),
  };
}
