import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { request as httpsRequest } from "node:https";

const origins = ["https://auth.nibomo.com", "https://auth.flashcards-open-source-app.com"];
const clients = ["web", "android", "ios", "ios-development", "macos", "macos-development"];
const navigationHeaders = { "Sec-Fetch-Site": "cross-site", "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Dest": "document" };

// Send Fetch Metadata verbatim without fetch's request-mode handling.
async function browserHeaderRequest(url, method, headers) {
  return new Promise((resolve, reject) => {
    const request = httpsRequest(url, { method, headers, signal: AbortSignal.timeout(10_000) }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("error", reject);
      response.on("end", () => {
        const responseHeaders = new Headers();
        for (let index = 0; index < response.rawHeaders.length; index += 2) {
          responseHeaders.append(response.rawHeaders[index], response.rawHeaders[index + 1]);
        }
        resolve(new Response(Buffer.concat(chunks), { status: response.statusCode, headers: responseHeaders }));
      });
    });
    request.on("error", reject);
    request.end();
  });
}

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

async function browserTransport(origin, provider, parameters) {
  const startPath = `/api/social/${provider}/start`;
  const startUrl = `${origin}${startPath}?${new URLSearchParams(parameters)}`;
  if (parameters.client !== "android") {
    for (const [url, method, headers] of [
      [startUrl, "GET", { "Sec-Fetch-Mode": "cors", "Sec-Fetch-Dest": "empty" }],
      [startUrl, "GET", { "Sec-Fetch-Mode": "cors" }],
      [startUrl, "GET", { "Sec-Fetch-Mode": "no-cors", "Sec-Fetch-Dest": "image" }],
      [startUrl, "GET", { "Sec-Fetch-Dest": "iframe" }],
      [startUrl, "GET", { Origin: "https://untrusted.invalid" }],
      [startUrl, "POST", {}],
      [`${origin}${startPath}/?${new URLSearchParams(parameters)}`, "GET", {}],
      [`${origin}/api/auth-methods?client=web`, "GET", {}],
    ]) {
      const refused = await browserHeaderRequest(url, method, { ...navigationHeaders, ...headers });
      assert.equal(refused.status, 403, `${method} ${url} ${JSON.stringify(headers)}`);
      assert.equal((await refused.json()).error, headers.Origin === undefined ? "Cross-origin requests not allowed" : "Origin is not allowed");
      assert.ok(refused.headers.get("x-request-id"));
      assert.equal(refused.headers.get("set-cookie"), null);
      assert.equal(refused.headers.get("location"), null);
      assert.equal(refused.headers.get("access-control-allow-origin"), null);
    }
  }
  const response = await browserHeaderRequest(startUrl, "GET", navigationHeaders);
  assert.equal(response.status, 302);
  assert.ok(response.headers.get("x-request-id"));
  assert.equal(response.headers.get("access-control-allow-origin"), null);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  const authorization = new URL(response.headers.get("location"));
  assert.equal(authorization.origin, provider === "apple" ? "https://appleid.apple.com" : "https://accounts.google.com");
  assert.equal(authorization.searchParams.get("redirect_uri"), `${origin}/api/social/${provider}/callback`);
  assert.equal(authorization.searchParams.get("response_type"), "code");
  assert.match(authorization.searchParams.get("state"), /^[A-Za-z0-9_-]{43}$/);
  assert.match(authorization.searchParams.get("nonce"), provider === "apple" ? /^[0-9a-f]{64}$/ : /^[A-Za-z0-9_-]{43}$/);
  if (provider === "google") {
    assert.equal(authorization.searchParams.get("code_challenge_method"), "S256");
    assert.match(authorization.searchParams.get("code_challenge"), /^[A-Za-z0-9_-]{43}$/);
  } else assert.equal(authorization.searchParams.get("response_mode"), "form_post");
  const state = authorization.searchParams.get("state");
  const cookieName = `__Host-social_callback_${state}`;
  const setCookie = response.headers.get("set-cookie") ?? "";
  assert.equal(setCookie.startsWith(`${cookieName}=`), true);
  assert.equal(/; Secure/i.test(setCookie) && /; HttpOnly/i.test(setCookie) && /; SameSite=None/i.test(setCookie), true);
  assert.equal(/; Domain=/i.test(setCookie), false);
  let cookie = setCookie.split(";")[0];
  let newerCookieName = null;
  const callback = async (state, boundCookie) => {
    const fields = new URLSearchParams({ state, error: "access_denied" });
    return fetch(`${origin}/api/social/${provider}/callback${provider === "google" ? `?${fields}` : ""}`, {
      method: provider === "apple" ? "POST" : "GET",
      headers: { ...(provider === "apple" ? { "Content-Type": "application/x-www-form-urlencoded", Origin: "https://appleid.apple.com" } : {}),
        "Sec-Fetch-Site": "cross-site", ...(boundCookie === null ? {} : { Cookie: boundCookie }) },
      body: provider === "apple" ? fields : undefined, redirect: "manual", signal: AbortSignal.timeout(10_000),
    });
  };
  const otherOrigin = origins.find((candidate) => candidate !== origin);
  const denialFields = new URLSearchParams({ state, error: "access_denied" });
  if (provider === "google") {
    const crossHost = await fetch(`${otherOrigin}/api/social/google/callback?${denialFields}`, {
      headers: { Cookie: cookie, "Sec-Fetch-Site": "cross-site" }, redirect: "manual", signal: AbortSignal.timeout(10_000),
    });
    assert.equal(crossHost.status, 409);
    assert.equal(crossHost.headers.get("set-cookie"), null);
    for (const refused of [await callback(state, null), await callback(randomBytes(32).toString("base64url"), cookie)]) {
      assert.equal(refused.status, 409);
      assert.equal(refused.headers.get("set-cookie"), null);
    }
    const mismatch = await fetch(`${origin}/api/social/apple/callback`, {
      method: "POST", headers: { Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded",
        Origin: "https://appleid.apple.com", "Sec-Fetch-Site": "cross-site" },
      body: denialFields, redirect: "manual", signal: AbortSignal.timeout(10_000),
    });
    assert.equal(mismatch.status, 400);
    assert.equal(mismatch.headers.get("set-cookie"), null);
    const newer = await fetch(`${origin}/api/social/google/start?${new URLSearchParams(parameters)}`, {
      redirect: "manual", signal: AbortSignal.timeout(10_000),
    });
    assert.equal(newer.status, 302);
    const newerState = new URL(newer.headers.get("location")).searchParams.get("state");
    newerCookieName = `__Host-social_callback_${newerState}`;
    assert.notEqual(newerCookieName, cookieName);
    const newerCookie = newer.headers.get("set-cookie");
    assert.ok(newerCookie.startsWith(`${newerCookieName}=`));
    cookie += `; ${newerCookie.split(";")[0]}`;
  }
  let denied = await callback(state, cookie);
  const continueApple = (fields, requestOrigin) => fetch(`${origin}/api/social/apple/continue`, {
    method: "POST", headers: { Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded",
      "Sec-Fetch-Site": "same-origin", ...(requestOrigin === null ? {} : { Origin: requestOrigin }) },
    body: fields, redirect: "manual", signal: AbortSignal.timeout(10_000),
  });
  if (provider === "apple") {
    assert.equal(denied.status, 200);
    assert.equal(denied.headers.get("set-cookie"), null);
    assert.equal(denied.headers.get("cache-control"), "no-store");
    assert.equal(denied.headers.get("referrer-policy"), "same-origin");
    assert.match(denied.headers.get("content-type"), /^text\/html/);
    const policy = denied.headers.get("content-security-policy");
    assert.match(policy, /default-src 'none'/);
    const formActions = policy.split(";").map((directive) => directive.trim()).filter((directive) => directive.startsWith("form-action "));
    const returnSource = parameters.client === "android" ? "com.nibomo.app:" : new URL(parameters.redirect_uri).origin;
    assert.deepEqual(formActions, [`form-action 'self' ${returnSource}`]);
    assert.match(policy, /base-uri 'none'/);
    assert.match(policy, /frame-ancestors 'none'/);
    const nonce = /script-src 'nonce-([A-Za-z0-9_-]{43})'/.exec(policy)?.[1];
    assert.ok(nonce);
    const document = await denied.text();
    assert.match(document, /method="post" action="\/api\/social\/apple\/continue"/);
    assert.ok(document.includes(`<script nonce="${nonce}">`));
    const fields = new URLSearchParams([...document.matchAll(/<input type="hidden" name="([a-z_]+)" value="([A-Za-z0-9_-]+)">/g)]
      .map((match) => [match[1], match[2]]));
    assert.deepEqual([...fields], [...denialFields]);
    if (parameters.client !== "android") {
      for (const refused of [await continueApple(fields, null), await continueApple(fields, "null"), await continueApple(fields, otherOrigin)]) {
        assert.ok([400, 403].includes(refused.status));
        assert.equal(refused.headers.get("set-cookie"), null);
      }
    }
    denied = await continueApple(fields, origin);
  }
  if (parameters.client === "android") {
    assert.equal(denied.status, 303);
    const returned = new URL(denied.headers.get("location"));
    assert.equal(returned.protocol, "com.nibomo.app:");
    assert.equal(returned.host, "");
    assert.equal(returned.pathname, "/auth/social/apple");
    assert.equal(returned.search, "");
    const fields = new URLSearchParams(returned.hash.slice(1));
    assert.deepEqual([...fields.keys()].sort(), ["attempt", "status"]);
    assert.equal(fields.get("status"), "denied");
    assert.match(fields.get("attempt"), /^[A-Za-z0-9_-]{43}$/);
  } else {
    assert.equal(denied.status, 400);
    assert.equal((await denied.json()).code, "PROVIDER_SIGN_IN_DENIED");
  }
  assert.equal(denied.headers.get("access-control-allow-origin"), provider === "apple" ? origin : null);
  assert.equal(/(?:^|,\s*)(?:session|refresh|logged_in)=/.test(denied.headers.get("set-cookie") ?? ""), false);
  assert.equal(denied.headers.get("set-cookie").startsWith(`${cookieName}=`), true);
  if (newerCookieName !== null) assert.equal(denied.headers.get("set-cookie").includes(newerCookieName), false);
  const replay = provider === "apple" ? await continueApple(denialFields, origin) : await callback(state, cookie);
  assert.equal(replay.status, 409);
  assert.equal(replay.headers.get("set-cookie"), null);
  const wrongPhase = await fetch(`${origin}/api/social/browser/complete`, {
    method: "POST", headers: { Cookie: cookie, Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ csrfToken: state, action: "mailbox_verify", code: "123456" }),
    redirect: "manual", signal: AbortSignal.timeout(10_000),
  });
  assert.equal(wrongPhase.status, 400);
  assert.equal(wrongPhase.headers.get("set-cookie"), null);
}

for (const origin of origins) {
  for (const client of clients) {
    const metadata = await request(origin, `/api/auth-methods?client=${client}`, null);
    assert.equal(metadata.status, 200);
    assert.equal(metadata.body.client, client);
    assert.deepEqual(metadata.body.authOrigins, origins);
    assert.equal(metadata.body.methods.email.available, true);
    assert.equal(metadata.body.methods.google.available, true);
    assert.equal(metadata.body.methods.apple.available, true);
    assert.equal(metadata.body.methods.google.transport, client === "web" ? "browser" : "native");
    assert.equal(metadata.body.methods.apple.transport, client === "web" || client === "android" ? "browser" : "native");
    if (client === "android") assert.equal(metadata.body.methods.apple.nativeReturnUri, "com.nibomo.app:/auth/social/apple");
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
    assert.equal((await request(origin, "/api/social/attempt", { ...parameters, purpose })).status, 401);
  }
  assert.equal((await request(origin, "/api/social/attempt", { ...parameters, provider: "apple", client: "android" })).status, 409);
  const redirectUri = `${origin.replace("//auth.", "//app.")}/`;
  await browserTransport(origin, "google", { redirect_uri: redirectUri });
  await browserTransport(origin, "apple", { redirect_uri: redirectUri });
  await browserTransport(origin, "apple", { client: "android", codeChallenge: challenge });
  const invalidRedirect = await fetch(`${origin}/api/social/google/start?redirect_uri=https%3A%2F%2Funtrusted.invalid`, {
    redirect: "manual", signal: AbortSignal.timeout(10_000),
  });
  assert.equal(invalidRedirect.status, 400);
  assert.equal(invalidRedirect.headers.get("set-cookie"), null);
  const notification = await request(origin, "/api/social/apple/notifications", { payload: "invalid" });
  assert.equal(notification.status, 400);
  assert.equal(notification.body.code, "APPLE_NOTIFICATION_INVALID");
  const blockedCallback = await fetch(`${origin}/api/social/apple/callback`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: "https://untrusted.invalid", "Sec-Fetch-Site": "cross-site" },
    body: new URLSearchParams({ state: randomBytes(32).toString("base64url"), error: "access_denied" }),
    redirect: "manual", signal: AbortSignal.timeout(10_000),
  });
  assert.equal(blockedCallback.status, 403);
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
console.log("Social auth public API gate passed on both permanent hosts: configured metadata, native attempts, browser top-level navigation and fetch/subresource/origin/method/path guards, browser authorization/PKCE/cookies, browser and Android callback state binding/one-use claims, invalid notification refusal, unsupported native transports and unsigned account purposes, unproved mailbox refusal, receipt refusal and origin denial. No provider authentication or mailbox delivery was simulated.");
