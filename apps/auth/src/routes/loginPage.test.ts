import assert from "node:assert/strict";
import test from "node:test";
import { buildWebsiteHomeUrl } from "./loginPage.js";

test("buildWebsiteHomeUrl strips app subdomain to apex domain", () => {
  const websiteHomeUrl = buildWebsiteHomeUrl("https://app.flashcards-open-source-app.com/decks?tab=due");
  assert.equal(websiteHomeUrl, "https://flashcards-open-source-app.com/");
});

test("buildWebsiteHomeUrl strips auth subdomain to apex domain", () => {
  const websiteHomeUrl = buildWebsiteHomeUrl("https://auth.flashcards-open-source-app.com/login-complete");
  assert.equal(websiteHomeUrl, "https://flashcards-open-source-app.com/");
});

test("buildWebsiteHomeUrl keeps non-app origins unchanged", () => {
  const websiteHomeUrl = buildWebsiteHomeUrl("http://localhost:3000/welcome");
  assert.equal(websiteHomeUrl, "http://localhost:3000/");
});

test("buildWebsiteHomeUrl preserves custom ports after stripping app subdomain", () => {
  const websiteHomeUrl = buildWebsiteHomeUrl("http://app.localhost:8787/path");
  assert.equal(websiteHomeUrl, "http://localhost:8787/");
});
