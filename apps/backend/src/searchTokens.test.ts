import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTokenizedAndLikeClause,
  buildTokenizedOrLikeClause,
  MAX_SEARCH_TOKEN_COUNT,
  tokenizeSearchText,
} from "./searchTokens";

test("tokenizeSearchText trims, lowercases, and splits by whitespace", () => {
  assert.deepEqual(
    tokenizeSearchText("  OpenAPI   Swagger\nDocs  ", MAX_SEARCH_TOKEN_COUNT),
    ["openapi", "swagger", "docs"],
  );
});

test("tokenizeSearchText returns empty array for blank input", () => {
  assert.deepEqual(tokenizeSearchText("   \n\t  ", MAX_SEARCH_TOKEN_COUNT), []);
});

test("tokenizeSearchText merges tail after the fifth token", () => {
  assert.deepEqual(
    tokenizeSearchText("a b c d epsilon zeta eta", MAX_SEARCH_TOKEN_COUNT),
    ["a", "b", "c", "d", "epsilon zeta eta"],
  );
});

test("buildTokenizedOrLikeClause builds OR groups per token", () => {
  const result = buildTokenizedOrLikeClause(
    ["openapi", "swagger"],
    1,
    [
      (paramIndex) => `lower(front_text) LIKE $${paramIndex}`,
      (paramIndex) => `lower(back_text) LIKE $${paramIndex}`,
    ],
  );

  assert.equal(
    result.clause,
    "(lower(front_text) LIKE $2 OR lower(back_text) LIKE $2) OR (lower(front_text) LIKE $3 OR lower(back_text) LIKE $3)",
  );
  assert.deepEqual(result.params, ["%openapi%", "%swagger%"]);
});

test("buildTokenizedAndLikeClause requires every token while keeping OR within each token", () => {
  const result = buildTokenizedAndLikeClause(
    ["openapi", "swagger"],
    1,
    [
      (paramIndex) => `lower(front_text) LIKE $${paramIndex}`,
      (paramIndex) => `lower(back_text) LIKE $${paramIndex}`,
    ],
  );

  assert.equal(
    result.clause,
    "(lower(front_text) LIKE $2 OR lower(back_text) LIKE $2) AND (lower(front_text) LIKE $3 OR lower(back_text) LIKE $3)",
  );
  assert.deepEqual(result.params, ["%openapi%", "%swagger%"]);
});
