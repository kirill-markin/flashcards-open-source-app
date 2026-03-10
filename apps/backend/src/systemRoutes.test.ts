import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "./app";

test("root discovery matches /agent", async () => {
  process.env.PUBLIC_API_BASE_URL = "https://api.example.com/v1";
  process.env.PUBLIC_AUTH_BASE_URL = "https://auth.example.com";

  const app = createApp("");
  const rootResponse = await app.request("https://api.example.com/");
  const agentResponse = await app.request("https://api.example.com/agent");

  assert.equal(rootResponse.status, 200);
  assert.equal(agentResponse.status, 200);
  assert.deepEqual(await rootResponse.json(), await agentResponse.json());
});

test("v1 root discovery accepts a trailing slash", async () => {
  process.env.PUBLIC_API_BASE_URL = "https://api.example.com/v1";
  process.env.PUBLIC_AUTH_BASE_URL = "https://auth.example.com";

  const app = createApp("");
  const rootResponse = await app.request("https://api.example.com/v1");
  const trailingSlashResponse = await app.request("https://api.example.com/v1/");

  assert.equal(rootResponse.status, 200);
  assert.equal(trailingSlashResponse.status, 200);
  assert.deepEqual(await trailingSlashResponse.json(), await rootResponse.json());
});

test("openapi endpoints return the same JSON document", async () => {
  const app = createApp("");
  const openapiResponse = await app.request("https://api.example.com/v1/openapi.json");
  const swaggerResponse = await app.request("https://api.example.com/v1/swagger.json");

  assert.equal(openapiResponse.status, 200);
  assert.equal(swaggerResponse.status, 200);

  const openapiBody = await openapiResponse.json() as { openapi: string };
  const swaggerBody = await swaggerResponse.json();

  assert.equal(openapiBody.openapi, "3.1.0");
  assert.deepEqual(swaggerBody, openapiBody);
});
