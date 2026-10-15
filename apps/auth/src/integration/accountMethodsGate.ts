import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";

const origins = ["https://auth.nibomo.com", "https://auth.flashcards-open-source-app.com"];

/** Demo principals cannot manage real methods or bootstrap a management CSRF context. */
export async function checkDemoAccountMethodRefusals(sessionToken: string): Promise<void> {
  for (const origin of origins) {
    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const native = { client: "ios", purpose: "reauth", provider: "google", codeChallenge: challenge };
    const request = async (path: string, body: object | null, headers: Record<string, string>) => {
      const response = await fetch(origin + path, { method: body === null ? "GET" : "POST",
        headers: { ...headers, ...(body === null ? {} : { "Content-Type": "application/json" }) },
        body: body === null ? undefined : JSON.stringify(body), redirect: "manual", signal: AbortSignal.timeout(10_000) });
      assert.ok(response.headers.get("x-request-id"));
      return response;
    };
    const refuse = async (response: Response, status: number, code: string): Promise<void> => {
      assert.equal(response.status, status);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal(response.headers.get("set-cookie"), null);
      const body = await response.json() as { code: string; error: string; requestId: string };
      assert.equal(body.code, code);
      assert.equal(typeof body.error, "string");
      assert.equal(body.requestId, response.headers.get("x-request-id"));
      assert.equal("idToken" in body, false);
    };
    const bearer = { Authorization: "Bearer " + sessionToken };
    const webHeaders = { Cookie: "session=" + sessionToken, Origin: origin };
    await refuse(await request("/api/account/login-methods?client=ios", null, webHeaders), 401, "SESSION_REQUIRED");
    await refuse(await request("/api/account/login-methods?client=web", null, bearer), 401, "SESSION_REQUIRED");
    await refuse(await request("/api/account/login-methods?client=ios", null, bearer), 409, "AUTH_ATTEMPT_RESTART_REQUIRED");
    await refuse(await request("/api/account/login-methods?client=web", null, webHeaders), 409, "AUTH_ATTEMPT_RESTART_REQUIRED");
    await refuse(await request("/api/social/attempt", native, bearer), 409, "AUTH_ATTEMPT_RESTART_REQUIRED");
    await refuse(await request("/api/social/attempt", { ...native, provider: "apple", client: "android" }, bearer),
      409, "AUTH_ATTEMPT_RESTART_REQUIRED");
    await refuse(await request("/api/account/provider-methods/link", { ...native, action: "begin" }, bearer),
      409, "AUTH_ATTEMPT_RESTART_REQUIRED");

    const completion = randomBytes(32).toString("base64url");
    const redeem = { client: "ios", purpose: "link", action: "redeem", completion, codeVerifier: verifier };
    await refuse(await request("/api/social/complete", { ...redeem, codeVerifier: "invalid" }, bearer),
      400, "AUTH_ATTEMPT_INVALID");
    await refuse(await request("/api/social/complete", redeem, bearer), 409, "AUTH_ATTEMPT_RESTART_REQUIRED");

    const webRequest = { client: "web", purpose: "reauth", action: "begin", provider: "google",
      redirectUri: origin.replace("//auth.", "//app.") + "/" };
    for (const path of ["/api/account/provider-methods/link", "/api/account/provider-methods/unlink", "/api/account/reauth/email"]) {
      await refuse(await request(path, webRequest, webHeaders), 400, "AUTH_ATTEMPT_INVALID");
      // The middleware rejects this Origin before route-level cache headers or CSRF parsing.
      const crossOrigin = await request(path, webRequest, { ...webHeaders, Origin: "https://untrusted.invalid" });
      assert.equal(crossOrigin.status, 403);
      assert.deepEqual(await crossOrigin.json(), { error: "Origin is not allowed" });
      assert.equal(crossOrigin.headers.get("set-cookie"), null);
    }
  }
}
