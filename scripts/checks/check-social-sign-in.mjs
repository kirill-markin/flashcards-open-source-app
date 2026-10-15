import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";

const origins = ["https://auth.nibomo.com", "https://auth.flashcards-open-source-app.com"];
const clients = ["web", "android", "ios", "ios-development", "macos", "macos-development"];

async function request(origin, path, body) {
  const response = await fetch(origin + path, {
    method: body === null ? "GET" : "POST",
    headers: body === null ? {} : { "Content-Type": "application/json" },
    body: body === null ? undefined : JSON.stringify(body),
    redirect: "error", signal: AbortSignal.timeout(10_000),
  });
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.ok(response.headers.get("x-request-id"));
  assert.equal(response.headers.get("set-cookie"), null);
  return { status: response.status, body: await response.json() };
}

for (const origin of origins) {
  for (const client of clients) {
    const metadata = await request(origin, `/api/auth-methods?client=${client}`, null);
    assert.equal(metadata.status, 200);
    assert.equal(metadata.body.client, client);
    assert.deepEqual(metadata.body.authOrigins, origins);
    assert.equal(metadata.body.methods.email.available, true);
    assert.equal(metadata.body.methods.google.available, client !== "web");
    assert.equal(metadata.body.methods.apple.available, client !== "web" && client !== "android");
    assert.equal(metadata.body.completion.productAccountProvisioned, false);
    assert.equal(/privateKey|clientSecret|secretArn|ciphertext/.test(JSON.stringify(metadata.body)), false);
  }
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const parameters = { client: "ios", purpose: "login", provider: "google", codeChallenge: challenge };
  const attempt = await request(origin, "/api/social/attempt", parameters);
  assert.equal(attempt.status, 200);
  assert.match(attempt.body.attempt, /^[A-Za-z0-9_-]{43}$/);
  assert.match(attempt.body.nonce, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(attempt.body.redirectUri, null);
  assert.equal(Number.isFinite(Date.parse(attempt.body.expiresAt)), true);
  for (const purpose of ["link", "reauth"]) {
    assert.equal((await request(origin, "/api/social/attempt", { ...parameters, purpose })).status, 400);
  }
  assert.equal((await request(origin, "/api/social/attempt", { ...parameters, provider: "apple", client: "android" })).status, 409);
  assert.equal((await request(origin, "/api/social/complete", {
    action: "mailbox_send", attempt: attempt.body.attempt, client: "ios", purpose: "login",
    codeVerifier: verifier, email: "unproved@mail.test",
  })).status, 409);
  const refused = await request(origin, "/api/social/complete", {
    action: "redeem", completion: randomBytes(32).toString("base64url"),
    client: "ios", purpose: "login", codeVerifier: verifier,
  });
  assert.equal(refused.status, 409);
  assert.equal(refused.body.code, "AUTH_COMPLETION_INVALID");
  assert.equal("idToken" in refused.body, false);
  const blockedOrigin = await fetch(origin + "/api/social/attempt", {
    method: "POST", headers: { "Content-Type": "application/json", Origin: "https://untrusted.invalid" },
    body: JSON.stringify(parameters), redirect: "error", signal: AbortSignal.timeout(10_000),
  });
  assert.equal(blockedOrigin.status, 403);
}
console.log("Native auth public API gate passed on both permanent hosts: metadata, configured native attempts, unsupported transports/purposes, unproved mailbox refusal, one-use receipt refusal, and origin denial. No provider authentication or mailbox delivery was simulated.");
