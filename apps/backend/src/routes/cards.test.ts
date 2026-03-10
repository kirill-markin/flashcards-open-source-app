import assert from "node:assert/strict";
import test from "node:test";
import { parseQueryCardsRequestBody } from "./cards";

test("parseQueryCardsRequestBody normalizes optional empty fields to null", () => {
  assert.deepEqual(
    parseQueryCardsRequestBody({
      limit: 50,
      sorts: [],
    }),
    {
      searchText: null,
      cursor: null,
      limit: 50,
      sorts: [],
    },
  );
});

test("parseQueryCardsRequestBody rejects unsupported sort keys", () => {
  assert.throws(
    () => parseQueryCardsRequestBody({
      limit: 50,
      sorts: [{ key: "unknown", direction: "asc" }],
    }),
    /sorts key is unsupported/,
  );
});

test("parseQueryCardsRequestBody rejects non-integer limits", () => {
  assert.throws(
    () => parseQueryCardsRequestBody({
      limit: 10.5,
      sorts: [],
    }),
    /limit must be an integer/,
  );
});

test("parseQueryCardsRequestBody preserves valid sorts and cursor", () => {
  assert.deepEqual(
    parseQueryCardsRequestBody({
      searchText: "hola",
      cursor: "cursor-1",
      limit: 25,
      sorts: [{ key: "updatedAt", direction: "desc" }],
    }),
    {
      searchText: "hola",
      cursor: "cursor-1",
      limit: 25,
      sorts: [{ key: "updatedAt", direction: "desc" }],
    },
  );
});
