import assert from "node:assert/strict";
import test from "node:test";
import { resolveNextHotChangeId } from "./hotPull";

test("resolveNextHotChangeId advances empty opt-out pulls past invisible media-only tails", () => {
  assert.equal(resolveNextHotChangeId(7, [], 12, false), 12);
});

test("resolveNextHotChangeId uses the last visible change without an opt-out hidden tail", () => {
  assert.equal(resolveNextHotChangeId(7, [{ changeId: 9 }], null, false), 9);
});

test("resolveNextHotChangeId advances visible opt-out pulls past invisible media tails", () => {
  assert.equal(resolveNextHotChangeId(7, [{ changeId: 9 }], 12, false), 12);
});

test("resolveNextHotChangeId does not skip visible pagination for opt-out pulls", () => {
  assert.equal(resolveNextHotChangeId(7, [{ changeId: 9 }], 12, true), 9);
});

test("resolveNextHotChangeId does not advance an empty page while visible pagination remains", () => {
  assert.equal(resolveNextHotChangeId(7, [], 12, true), 7);
});

test("resolveNextHotChangeId never moves an empty-page cursor backwards", () => {
  assert.equal(resolveNextHotChangeId(7, [], 0, false), 7);
});
