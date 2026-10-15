import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type pg from "pg";
import type { DatabaseExecutor } from "../db.js";
import { listAccountLoginMethodsInExecutor } from "../server/social/accountMethods.js";

const origins = ["https://auth.nibomo.com", "https://auth.flashcards-open-source-app.com"];

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

// Storage-boundary fixtures exercise the production projection as auth_app, without fabricated JWTs.
export async function checkAccountRecoveryEmailProjection(runtime: pg.Client, owner: pg.Client): Promise<void> {
  const account = randomUUID();
  const otherAccount = randomUUID();
  const current = randomUUID();
  const alias = randomUUID();
  const deleted = randomUUID();
  const unproved = randomUUID();
  const other = randomUUID();
  const subjects = [current, alias, deleted, unproved, other];
  const username = "current-" + randomUUID();
  const suffix = randomUUID() + "@mail.test";
  const first = "a-" + suffix;
  const last = "z-" + suffix;
  const foreign = "foreign-" + suffix;
  const originalTime = Math.floor(Date.now() / 1_000) - 300;
  const executor: DatabaseExecutor = { query: (text, parameters) => runtime.query(text, [...parameters]) };
  const load = async (subject: string, immutableUsername: string, authTime: number | null) => {
    await runtime.query("BEGIN");
    try {
      const result = await listAccountLoginMethodsInExecutor(executor, subject, immutableUsername, authTime);
      await runtime.query("COMMIT");
      return result;
    } catch (error) {
      await runtime.query("ROLLBACK");
      throw error;
    }
  };
  const record = (subject: string, email: string) =>
    runtime.query("SELECT auth.record_verified_login_email($1,$2,clock_timestamp())", [subject, email]);
  try {
    for (const id of [account, otherAccount]) {
      await owner.query("INSERT INTO org.user_settings(user_id,email) VALUES ($1,$2)", [id, "unproved-profile-" + suffix]);
    }
    for (const subject of subjects) {
      await runtime.query("SELECT auth.register_cognito_principal($1,$2)", [subject, subject === current ? username : subject]);
      await owner.query("SELECT auth.bind_cognito_account($1,$2)", [subject, subject === other ? otherAccount : account]);
    }
    await runtime.query("SELECT auth.bind_provider_identity('google',$1,$2)", ["unproved-provider-" + randomUUID(), unproved]);
    await record(other, foreign);
    assert.deepEqual(await load(current, username, originalTime), { methods: [], verifiedRecoveryEmails: [] });
    assert.deepEqual((await load(other, other, originalTime)).verifiedRecoveryEmails, [foreign]);

    await record(alias, last);
    await record(alias, first);
    await record(current, first);
    await record(other, first);
    await record(alias, randomUUID() + "@privaterelay.appleid.com");
    await record(alias, randomUUID() + "@private.icloud.com");
    await record(alias, randomUUID() + "@example.com");
    await record(deleted, "deleted-" + suffix);
    await owner.query("INSERT INTO auth.deleted_subjects(subject_sha256) VALUES ($1)", [createHash("sha256").update(deleted).digest("hex")]);
    assert.deepEqual((await load(current, username, originalTime)).verifiedRecoveryEmails, [first, last]);
    assert.deepEqual((await load(other, other, originalTime)).verifiedRecoveryEmails, [first, foreign]);
    await assert.rejects(load(current, current, originalTime), { code: "23505" });
    await assert.rejects(load(current, username, -1), { code: "23514" });

    const minimum = Math.floor(Date.now() / 1_000);
    await owner.query("INSERT INTO auth.principal_session_fences(subject_sha256,minimum_auth_time) VALUES ($1,$2)",
      [createHash("sha256").update(current).digest("hex"), minimum]);
    await assert.rejects(load(current, username, originalTime), { code: "23514" });
    await assert.rejects(load(current, username, null), { code: "23514" });
    assert.deepEqual((await load(current, username, minimum)).verifiedRecoveryEmails, [first, last]);
    await owner.query("INSERT INTO auth.deleted_subjects(subject_sha256) VALUES ($1)", [createHash("sha256").update(current).digest("hex")]);
    await assert.rejects(load(current, username, minimum), { code: "23514" });
  } finally {
    await owner.query("DELETE FROM auth.cognito_principals WHERE cognito_subject = ANY($1::text[])", [subjects]);
    await owner.query("DELETE FROM auth.principal_session_fences WHERE subject_sha256 = ANY($1::text[])",
      [subjects.map((subject) => createHash("sha256").update(subject).digest("hex"))]);
    await owner.query("DELETE FROM auth.deleted_subjects WHERE subject_sha256 = ANY($1::text[])",
      [subjects.map((subject) => createHash("sha256").update(subject).digest("hex"))]);
    await owner.query("DELETE FROM org.user_settings WHERE user_id = ANY($1::text[])", [[account, otherAccount]]);
  }
}
