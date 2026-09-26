import assert from "node:assert/strict";
import { createHash, createPublicKey, randomBytes, verify } from "node:crypto";

const authOrigin = process.env.FLASHCARDS_MCP_SMOKE_AUTH_BASE_URL ?? "https://auth.flashcards-open-source-app.com";
const mcpOrigin = process.env.FLASHCARDS_MCP_SMOKE_MCP_BASE_URL ?? "https://mcp.flashcards-open-source-app.com";
const email = process.env.FLASHCARDS_MCP_SMOKE_DEMO_EMAIL ?? "google-review@example.com";
assert.ok(email.endsWith("@example.com"), "OIDC smoke must use a synthetic review account");
const resource = `${mcpOrigin}/mcp`;
const redirectUri = "https://example.com/nibomo-oidc-smoke";
const runId = randomBytes(12).toString("hex");

async function request(url, init, status) {
  const response = await fetch(url, { ...init, redirect: "manual", signal: AbortSignal.timeout(25_000) });
  assert.equal(response.status, status, `${init.method ?? "GET"} ${new URL(url).pathname}: unexpected status; request ID ${response.headers.get("x-request-id")}`);
  return response;
}

async function json(url, body, headers, status) {
  const response = await request(url, {
    method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body),
  }, status);
  return response.json();
}

async function token(body, status) {
  const response = await request(`${authOrigin}/token`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body),
  }, status);
  assert.equal(response.headers.get("cache-control"), "no-store");
  return response.json();
}

const metadata = await (await request(`${authOrigin}/.well-known/openid-configuration`, {}, 200)).json();
assert.equal(metadata.issuer, authOrigin);
assert.equal(metadata.userinfo_endpoint, `${authOrigin}/userinfo`);
assert.ok(metadata.scopes_supported.includes("openid") && metadata.scopes_supported.includes("email"));
assert.deepEqual(metadata.id_token_signing_alg_values_supported, ["RS256"]);
const jwks = await (await request(metadata.jwks_uri, {}, 200)).json();
const registration = await json(`${authOrigin}/register`, {
  redirect_uris: [redirectUri], client_name: `OIDC smoke ${runId}`,
}, {}, 201);
assert.equal(typeof registration.client_id, "string");
const login = await json(`${authOrigin}/api/send-code`, { email }, {}, 200);
assert.equal(typeof login.idToken, "string");
const consentHeaders = { cookie: `session=${login.idToken}`, origin: authOrigin };

async function authorize(scope) {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const nonce = randomBytes(16).toString("base64url");
  const params = {
    client_id: registration.client_id, redirect_uri: redirectUri, state: runId,
    code_challenge: challenge, resource, nonce,
  };
  const url = new URL(`${authOrigin}/authorize`);
  url.search = new URLSearchParams({ ...params, response_type: "code", code_challenge_method: "S256", ...(scope === null ? {} : { scope }) }).toString();
  const consentPage = await request(url, {}, 200);
  assert.ok((await consentPage.text()).includes('id="approve-btn"'));
  const approved = await json(`${authOrigin}/authorize/consent`, { ...params, scope }, consentHeaders, 200);
  const redirect = new URL(approved.redirect_to);
  assert.equal(redirect.origin, new URL(redirectUri).origin);
  assert.equal(redirect.searchParams.get("state"), runId);
  assert.equal(redirect.searchParams.get("iss"), metadata.issuer);
  const code = redirect.searchParams.get("code");
  assert.equal(typeof code, "string");
  const exchange = { grant_type: "authorization_code", code, code_verifier: verifier, client_id: registration.client_id, redirect_uri: redirectUri };
  const refused = await token({ ...exchange, code_verifier: randomBytes(32).toString("base64url") }, 400);
  assert.equal(refused.error, "invalid_grant");
  const tokens = await token(exchange, 200);
  const replay = await token(exchange, 400);
  assert.equal(replay.error, "invalid_grant");
  assert.equal(typeof tokens.access_token, "string");
  return { tokens, nonce };
}

async function userInfo(accessToken, method, status) {
  const response = await request(metadata.userinfo_endpoint, {
    method, headers: { authorization: `Bearer ${accessToken}` },
  }, status);
  assert.equal(response.headers.get("cache-control"), "no-store");
  return response.json();
}

function verifyIdToken(idToken, nonce) {
  assert.equal(typeof idToken, "string");
  const parts = idToken.split(".");
  assert.equal(parts.length, 3);
  const header = JSON.parse(Buffer.from(parts[0], "base64url").toString());
  assert.equal(header.alg, "RS256");
  const jwk = jwks.keys.find((key) => key.kid === header.kid);
  assert.ok(jwk, "ID token signing key must be published");
  assert.equal(jwk.d, undefined, "JWKS must contain no private key");
  assert.ok(verify("RSA-SHA256", Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey({ key: jwk, format: "jwk" }), Buffer.from(parts[2], "base64url")), "ID token signature must verify against the published JWKS");
  const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString());
  assert.equal(claims.iss, metadata.issuer);
  assert.equal(claims.aud, registration.client_id);
  assert.equal(claims.nonce, nonce);
  assert.ok(claims.exp > Date.now() / 1000 && claims.iat <= Date.now() / 1000 + 5);
  return claims;
}

async function mcp(accessToken, status) {
  const response = await request(resource, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {
      protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "oidc-smoke", version: "1" },
    } }),
  }, status);
  await response.text();
}

const full = await authorize("flashcards openid email");
const claims = verifyIdToken(full.tokens.id_token, full.nonce);
assert.equal(claims.email, email);
assert.equal(claims.email_verified, false, "Synthetic demo accounts cannot prove mailbox ownership");
const identity = await userInfo(full.tokens.access_token, "GET", 200);
assert.deepEqual(identity, { sub: claims.sub, email, email_verified: false });
assert.deepEqual(await userInfo(full.tokens.access_token, "POST", 200), identity);
await mcp(full.tokens.access_token, 200);

const refreshed = await token({ grant_type: "refresh_token", client_id: registration.client_id, refresh_token: full.tokens.refresh_token }, 200);
assert.equal(refreshed.scope, "flashcards openid email");
assert.deepEqual(await userInfo(refreshed.access_token, "GET", 200), identity);
const refreshReplay = await token({ grant_type: "refresh_token", client_id: registration.client_id, refresh_token: full.tokens.refresh_token }, 400);
assert.equal(refreshReplay.error, "invalid_grant");

const identityOnly = await authorize("openid email");
await mcp(identityOnly.tokens.access_token, 403);
assert.deepEqual(await userInfo(identityOnly.tokens.access_token, "GET", 200), identity);
const withoutEmail = await authorize("flashcards openid");
assert.deepEqual(await userInfo(withoutEmail.tokens.access_token, "GET", 200), { sub: identity.sub });
assert.equal(verifyIdToken(withoutEmail.tokens.id_token, withoutEmail.nonce).email, undefined);
const legacy = await authorize(null);
assert.equal(legacy.tokens.id_token, undefined);
await mcp(legacy.tokens.access_token, 200);
assert.equal((await userInfo(legacy.tokens.access_token, "GET", 403)).error, "insufficient_scope");
assert.equal((await userInfo("invalid-token", "GET", 401)).error, "invalid_token");
const explicitLegacy = await authorize("flashcards");
assert.equal(explicitLegacy.tokens.id_token, undefined);
await mcp(explicitLegacy.tokens.access_token, 200);
// A narrower reauthorization must not change previously consented grants.
assert.deepEqual(await userInfo(refreshed.access_token, "GET", 200), identity);
console.log(`OIDC smoke passed: discovery, RS256, PKCE, replay, UserInfo, refresh, scope isolation and legacy grants (client ${registration.client_id})`);
