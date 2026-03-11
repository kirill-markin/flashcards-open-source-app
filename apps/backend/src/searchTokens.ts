import type { SqlValue } from "./db";

export const MAX_SEARCH_TOKEN_COUNT = 5;

export type SearchTokenClauseFactory = (paramIndex: number) => string;

export type TokenizedSearchClause = Readonly<{
  clause: string;
  params: ReadonlyArray<SqlValue>;
}>;

export function tokenizeSearchText(
  searchText: string,
  maximumTokenCount: number,
): ReadonlyArray<string> {
  if (maximumTokenCount < 1) {
    throw new Error("maximumTokenCount must be at least 1");
  }

  const normalizedSearchText = searchText.trim().toLowerCase();
  if (normalizedSearchText === "") {
    return [];
  }

  const tokens = normalizedSearchText.split(/\s+/);
  if (tokens.length <= maximumTokenCount) {
    return tokens;
  }

  return [
    ...tokens.slice(0, maximumTokenCount - 1),
    tokens.slice(maximumTokenCount - 1).join(" "),
  ];
}

export function buildTokenizedOrLikeClause(
  searchTokens: ReadonlyArray<string>,
  startIndex: number,
  expressionFactories: ReadonlyArray<SearchTokenClauseFactory>,
): TokenizedSearchClause {
  if (expressionFactories.length < 1) {
    throw new Error("expressionFactories must contain at least one item");
  }

  if (searchTokens.length < 1) {
    return {
      clause: "",
      params: [],
    };
  }

  const tokenClauses = searchTokens.map((_, tokenIndex) => {
    const paramIndex = startIndex + tokenIndex + 1;
    const expressionClause = expressionFactories
      .map((factory) => factory(paramIndex))
      .join(" OR ");
    return `(${expressionClause})`;
  });

  return {
    clause: tokenClauses.join(" OR "),
    params: searchTokens.map((token) => `%${token}%`),
  };
}
