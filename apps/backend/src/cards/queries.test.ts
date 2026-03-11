import assert from "node:assert/strict";
import test from "node:test";
import type { CardFilter } from "./types";
import { buildCardsQueryFilterClause } from "./queries";

function makeFilter(overrides: Partial<CardFilter>): CardFilter {
  return {
    tags: [],
    effort: [],
    ...overrides,
  };
}

test("buildCardsQueryFilterClause builds a tags-only subset clause", () => {
  assert.deepEqual(
    buildCardsQueryFilterClause(makeFilter({ tags: ["grammar", "verbs"] }), 1),
    {
      clause: "AND tags @> $2::text[]",
      params: [["grammar", "verbs"]],
    },
  );
});

test("buildCardsQueryFilterClause builds an effort-only any clause", () => {
  assert.deepEqual(
    buildCardsQueryFilterClause(makeFilter({ effort: ["fast", "medium"] }), 1),
    {
      clause: "AND effort_level = ANY($2::text[])",
      params: [["fast", "medium"]],
    },
  );
});

test("buildCardsQueryFilterClause combines tags and effort with AND semantics", () => {
  assert.deepEqual(
    buildCardsQueryFilterClause(makeFilter({ tags: ["grammar"], effort: ["long"] }), 1),
    {
      clause: "AND tags @> $2::text[] AND effort_level = ANY($3::text[])",
      params: [["grammar"], ["long"]],
    },
  );
});

test("buildCardsQueryFilterClause returns an empty clause for no filter", () => {
  assert.deepEqual(
    buildCardsQueryFilterClause(null, 1),
    {
      clause: "",
      params: [],
    },
  );
});
