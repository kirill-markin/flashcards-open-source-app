import assert from "node:assert/strict";
import test from "node:test";
import { renderLoginPage } from "./login.js";

test("renderLoginPage includes top-left link to website home", () => {
  const html = renderLoginPage(
    "https://app.flashcards-open-source-app.com/decks",
    "https://flashcards-open-source-app.com/",
  );

  assert.match(html, /class="login-back-link"/);
  assert.match(html, /href="https:\/\/flashcards-open-source-app\.com\/"/);
  assert.match(html, />Back to website</);
});

test("renderLoginPage keeps website style tokens for auth screen", () => {
  const html = renderLoginPage(
    "https://app.flashcards-open-source-app.com/decks",
    "https://flashcards-open-source-app.com/",
  );

  assert.match(html, /--bg: #050505;/);
  assert.match(html, /--accent: #c44b2d;/);
  assert.match(html, /radial-gradient\(circle at top, rgba\(196, 75, 45, 0\.12\)/);
});
