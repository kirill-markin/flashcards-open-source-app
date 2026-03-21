import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "./app.js";
import { resetDemoEmailAccessConfigForTests } from "./server/demoEmailAccess.js";

const originalDemoEmailDostip = process.env.DEMO_EMAIL_DOSTIP;
const originalDemoPasswordDostip = process.env.DEMO_PASSWORD_DOSTIP;
const originalDemoPasswordSecretArn = process.env.DEMO_PASSWORD_SECRET_ARN;

function createAuthApp(): ReturnType<typeof createApp> {
  process.env.ALLOWED_REDIRECT_URIS = "https://flashcards-open-source-app.com,https://app.flashcards-open-source-app.com";
  return createApp("/");
}

test.afterEach(() => {
  if (originalDemoEmailDostip === undefined) {
    delete process.env.DEMO_EMAIL_DOSTIP;
  } else {
    process.env.DEMO_EMAIL_DOSTIP = originalDemoEmailDostip;
  }

  if (originalDemoPasswordDostip === undefined) {
    delete process.env.DEMO_PASSWORD_DOSTIP;
  } else {
    process.env.DEMO_PASSWORD_DOSTIP = originalDemoPasswordDostip;
  }

  if (originalDemoPasswordSecretArn === undefined) {
    delete process.env.DEMO_PASSWORD_SECRET_ARN;
  } else {
    process.env.DEMO_PASSWORD_SECRET_ARN = originalDemoPasswordSecretArn;
  }

  resetDemoEmailAccessConfigForTests();
});

test("OPTIONS preflight from the app origin returns credentialed CORS headers", async () => {
  const app = createAuthApp();

  const response = await app.request("http://localhost/api/refresh-session", {
    method: "OPTIONS",
    headers: {
      Origin: "https://app.flashcards-open-source-app.com",
      "Access-Control-Request-Method": "POST",
    },
  });

  assert.equal(response.status, 204);
  assert.equal(
    response.headers.get("Access-Control-Allow-Origin"),
    "https://app.flashcards-open-source-app.com",
  );
  assert.equal(response.headers.get("Access-Control-Allow-Credentials"), "true");
});

test("same-site refresh requests from the app origin stay allowed", async () => {
  const app = createAuthApp();

  const response = await app.request("http://localhost/api/refresh-session", {
    method: "POST",
    headers: {
      Origin: "https://app.flashcards-open-source-app.com",
      "Sec-Fetch-Site": "same-site",
    },
  });

  assert.equal(response.status, 401);
  assert.equal(
    response.headers.get("Access-Control-Allow-Origin"),
    "https://app.flashcards-open-source-app.com",
  );
  assert.equal(response.headers.get("Access-Control-Allow-Credentials"), "true");
});

test("same-origin auth requests stay allowed even when auth origin is absent in redirect allowlist", async () => {
  const app = createAuthApp();

  const response = await app.request("https://auth.flashcards-open-source-app.com/api/refresh-session", {
    method: "POST",
    headers: {
      Origin: "https://auth.flashcards-open-source-app.com",
      "Sec-Fetch-Site": "same-origin",
    },
  });

  assert.equal(response.status, 401);
  assert.equal(
    response.headers.get("Access-Control-Allow-Origin"),
    "https://auth.flashcards-open-source-app.com",
  );
  assert.equal(response.headers.get("Access-Control-Allow-Credentials"), "true");
});

test("foreign origins stay blocked", async () => {
  const app = createAuthApp();

  const response = await app.request("http://localhost/api/refresh-session", {
    method: "POST",
    headers: {
      Origin: "https://evil.example.com",
      "Sec-Fetch-Site": "cross-site",
    },
  });

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "Origin is not allowed" });
});

test("logout-local clears the browser session and redirects back with account-deleted markers", async () => {
  const app = createAuthApp();

  const response = await app.request(
    "https://auth.flashcards-open-source-app.com/logout-local?redirect_uri=https%3A%2F%2Fapp.flashcards-open-source-app.com%2Faccount",
  );

  assert.equal(response.status, 302);
  assert.equal(
    response.headers.get("Location"),
    "https://app.flashcards-open-source-app.com/account?logged_out=1&account_deleted=1",
  );
  assert.match(response.headers.get("Set-Cookie") ?? "", /refresh=;/);
});

test("app startup fails when demo emails are configured without the shared demo password", () => {
  process.env.DEMO_EMAIL_DOSTIP = "apple-for-review@example.com";
  delete process.env.DEMO_PASSWORD_DOSTIP;
  delete process.env.DEMO_PASSWORD_SECRET_ARN;

  assert.throws(
    () => createAuthApp(),
    /DEMO_PASSWORD_DOSTIP or DEMO_PASSWORD_SECRET_ARN is required when DEMO_EMAIL_DOSTIP is configured/,
  );
});
