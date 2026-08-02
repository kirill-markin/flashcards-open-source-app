import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { parsePublicOrigin } from "./public-origin";

test("stack passes the raw site origin context into strict parsing", () => {
  const stackSource = readFileSync(resolve(process.cwd(), "lib/stack.ts"), "utf8");

  assert.match(
    stackSource,
    /const configuredSiteBaseUrl = getOptionalRawContextValue\(this, "siteBaseUrl"\);/,
  );
  assert.match(
    stackSource,
    /parsePublicOrigin\(configuredSiteBaseUrl, "siteBaseUrl"\)/,
  );
});

test("public origin parsing accepts production, self-hosted, and localhost origins", () => {
  assert.equal(
    parsePublicOrigin("https://flashcards-open-source-app.com", "siteBaseUrl"),
    "https://flashcards-open-source-app.com",
  );
  assert.equal(
    parsePublicOrigin("https://cards.example.test", "siteBaseUrl"),
    "https://cards.example.test",
  );
  assert.equal(
    parsePublicOrigin("http://localhost:3000", "siteBaseUrl"),
    "http://localhost:3000",
  );
  assert.equal(
    parsePublicOrigin("https://[2001:db8::1]", "siteBaseUrl"),
    "https://[2001:db8::1]",
  );
  assert.equal(
    parsePublicOrigin("https://192.0.2.1", "siteBaseUrl"),
    "https://192.0.2.1",
  );
});

const invalidPublicOrigins = [
  "*",
  "cards.example.test",
  "ftp://cards.example.test",
  "https://user:password@cards.example.test",
  "https://cards.example.test/catalog",
  "https://cards.example.test?source=catalog",
  "https://cards.example.test#catalog",
  "https://cards.example.test/a/..",
  "https://cards.example.test/%2e",
  "https://cards.example.test/?",
  "https://exa\nmple.test",
  "https://exa\u0085mple.test",
  "https://cards.example.test\\",
  "https://*.example.test",
  "https://*",
  "https://%2a.example.test",
  "https://%2A",
  "https://user@example.test",
  "https://@example.test",
  "https://:@example.test",
  " https://cards.example.test",
  "https://cards.example.test ",
  "https://cards.example.test/",
  "HTTPS://CARDS.EXAMPLE.TEST",
  "https://cards.example.test:443",
  "https://cards.example.test:",
  "https://cards.example.test:0443",
  "https://%63ards.example.test",
] as const;

for (const value of invalidPublicOrigins) {
  test(`public origin parsing rejects ${value}`, () => {
    assert.throws(
      () => parsePublicOrigin(value, "siteBaseUrl"),
      /siteBaseUrl must be an absolute HTTP or HTTPS origin/,
    );
  });
}

const invalidConfiguredLocalOrigins = [
  "http://localhost:3001",
  "https://localhost:3000",
  "http://app.localhost:3000",
  "http://127.0.0.1:3000",
  "http://127.1:3000",
  "http://2130706433:3000",
  "http://0x7f000001:3000",
  "http://[::1]:3000",
  "http://[0:0:0:0:0:0:0:1]:3000",
  "http://[::ffff:127.0.0.1]:3000",
  "HTTP://LOCALHOST:3000",
  "http://localhost:03000",
  "http://%6cocalhost:3000",
] as const;

for (const value of invalidConfiguredLocalOrigins) {
  test(`public origin parsing rejects non-canonical local origin ${value}`, () => {
    assert.throws(
      () => parsePublicOrigin(value, "siteBaseUrl"),
      /local or loopback origin must be exactly http:\/\/localhost:3000/,
    );
  });
}
