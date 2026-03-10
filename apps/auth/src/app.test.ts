import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "./app.js";

function createAuthApp(): ReturnType<typeof createApp> {
  process.env.ALLOWED_REDIRECT_URIS = "https://flashcards-open-source-app.com,https://app.flashcards-open-source-app.com";
  return createApp("/");
}

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

test("agent discovery route explains the first step for terminal clients", async () => {
  const app = createAuthApp();

  const response = await app.request("http://localhost/api/agent", {
    method: "GET",
  });

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^application\/json/);
  const payload = await response.json() as {
    ok: boolean;
    data: {
      service: { name: string };
      authentication: { registerAndLogin: string };
    };
    actions: Array<{ name: string; method: string; url: string }>;
    instructions: string;
  };
  assert.equal(payload.ok, true);
  assert.equal(payload.data.service.name, "flashcards-open-source-app");
  assert.equal(payload.actions[0]?.name, "send_code");
  assert.equal(payload.actions[0]?.method, "POST");
  assert.match(payload.instructions, /Start by calling send_code/);
});
