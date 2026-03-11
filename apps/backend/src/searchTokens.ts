import type { SqlValue } from "./db";

export const MAX_SEARCH_TOKEN_COUNT = 5;

export type SearchTokenClauseFactory = (paramIndex: number) => string;

export type TokenizedSearchClause = Readonly<{
  clause: string;
  params: ReadonlyArray<SqlValue>;
}>;

/**
 * Canonical text-search tokenization shared by card search features:
 * trim, lowercase, split by whitespace, and keep at most five tokens by
 * merging any overflow into the fifth token.
 */
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

function buildTokenizedLikeParts(
  searchTokens: ReadonlyArray<string>,
  startIndex: number,
  expressionFactories: ReadonlyArray<SearchTokenClauseFactory>,
): Readonly<{
  tokenClauses: ReadonlyArray<string>;
  params: ReadonlyArray<SqlValue>;
}> {
  if (expressionFactories.length < 1) {
    throw new Error("expressionFactories must contain at least one item");
  }

  if (searchTokens.length < 1) {
    return {
      tokenClauses: [],
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
    tokenClauses,
    params: searchTokens.map((token) => `%${token}%`),
  };
}

export function buildTokenizedOrLikeClause(
  searchTokens: ReadonlyArray<string>,
  startIndex: number,
  expressionFactories: ReadonlyArray<SearchTokenClauseFactory>,
): TokenizedSearchClause {
  const parts = buildTokenizedLikeParts(searchTokens, startIndex, expressionFactories);
  return {
    clause: parts.tokenClauses.join(" OR "),
    params: parts.params,
  };
}

/**
 * Canonical card-search semantics: all tokens are required (AND), while each
 * token may match any supported field expression (OR).
 */
export function buildTokenizedAndLikeClause(
  searchTokens: ReadonlyArray<string>,
  startIndex: number,
  expressionFactories: ReadonlyArray<SearchTokenClauseFactory>,
): TokenizedSearchClause {
  const parts = buildTokenizedLikeParts(searchTokens, startIndex, expressionFactories);
  return {
    clause: parts.tokenClauses.join(" AND "),
    params: parts.params,
  };
}
