import { Hono } from "hono";
import { sign, verify } from "../server/crypto.js";
import { createAccountBrowserContext, preserveAccountConnectionContext } from "../routes/social/accountTransport.js";
import type { AuthAppEnv } from "../server/apiErrors.js";
import { createBrowserState, readBrowserState } from "../server/social/browserState.js";
import { connectionCallbackParameters, prepareAuthAttempt, sealAuthAttemptState } from "../server/social/attemptStore.js";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import type pg from "pg";
import type { DatabaseExecutor } from "../db.js";
import { connectionConsentInExecutor } from "../server/social/accountConnection.js";
import { completeAuthoritativeLoginInExecutor, redeemSocialSignInInExecutor } from "../server/social/completionStore.js";
import { adoptConnectionSuggestionInExecutor } from "../server/social/accountConnectionPreparation.js";
import { connectionParameters } from "../server/social/accountConnectionStore.js";
import type { ConnectionBinding, ConnectionSession } from "../server/social/accountConnectionContract.js";
import { authAttemptBindingHash, authHandleHash } from "../server/social/attemptStore.js";
import { parseAccountConnectionAction } from "../server/social/publicContract.js";
import { runWithSocialSourceIp } from "../server/social/requestSource.js";
import { createApp } from "../app.js";

function executor(client: pg.Client): DatabaseExecutor {
  return { query: (text, parameters) => client.query(text, [...parameters]) };
}
async function transaction<Result>(client: pg.Client, run: () => Promise<Result>): Promise<Result> {
  await client.query("BEGIN");
  try {
    const result = await run();
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

// Verified fixture facts enter the real coordinator/SQL boundary; no provider, JWT or inbox success is simulated.
export async function checkAccountConnection(runtime: pg.Client, owner: pg.Client, contender: pg.Client): Promise<void> {
  const accounts = [randomUUID(), randomUUID(), randomUUID()];
  const subjects = accounts.map(() => randomUUID());
  const emails = subjects.map((subject) => subject + "@mail.test");
  const workspaces = [randomUUID(), randomUUID()];
  const attempts: string[] = [];
  const binding: ConnectionBinding = { client: "ios", purpose: "reauth", codeVerifier: randomBytes(32).toString("base64url") };
  const current: ConnectionSession = { subject: subjects[0], username: subjects[0], authTime: 1, email: emails[0], emailVerified: true };
  const prepare = async (transport: ConnectionBinding): Promise<string> => {
    const transportHash = authAttemptBindingHash(transport);
    const origin = transport.client === "web" ? transport.origin : null;
    const attempt = authHandleHash(randomBytes(32).toString("base64url"));
    const completion = authHandleHash(randomBytes(32).toString("base64url"));
    attempts.push(attempt);
    const created = (await runtime.query("SELECT * FROM auth.create_email_auth_attempt($1,$2,$3,$4,$5,$5,$6,1,'fixture',$5,$5)",
      [attempt, transport.client, transportHash, origin, subjects[0], emails[0]])).rows[0];
    await runtime.query("SELECT auth.ready_email_auth_attempt($1,$2,'fixture')", [attempt, created.claim_id]);
    const claimed = (await runtime.query("SELECT * FROM auth.claim_email_auth_attempt($1,$2,$3,$4,$5,$5,1)", [attempt, transportHash, transport.client, origin, subjects[0]])).rows[0];
    await runtime.query("SELECT auth.complete_email_auth_attempt($1,$2,$3,$3,$4,floor(extract(epoch FROM clock_timestamp()))::bigint,$5)",
      [attempt, claimed.claim_id, subjects[0], emails[0], completion]);
    const operation = randomBytes(32).toString("base64url");
    await runtime.query("SELECT * FROM auth.begin_account_connection($1,$2,$3,$4,$5,$6,$7,$8,'canonical-account-v1')",
      [...connectionParameters(operation, current, transport), completion]);
    return operation;
  };
  const prove = async (operation: string): Promise<void> => {
    const parameters = connectionParameters(operation, current, binding);
    const target = (await runtime.query("SELECT * FROM auth.begin_connection_email_target($1,$2,$3,$4,$5,$6,$7,$8,$8,$9)",
      [...parameters, subjects[1], emails[1]])).rows[0];
    await runtime.query("SELECT auth.ready_connection_email_proof($1,$2,'fixture')", [authHandleHash(operation), target.email_claim]);
    const claimed = (await runtime.query("SELECT * FROM auth.claim_connection_email_proof($1,$2,$3,$4,$5,$6,$7)", parameters)).rows[0];
    await runtime.query("SELECT * FROM auth.record_connection_email_proof($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$10,floor(extract(epoch FROM clock_timestamp()))::bigint)",
      [...parameters, claimed.email_claim, subjects[1], emails[1]]);
  };
  const providerSubjects = { apple: "connection-callback-apple-" + randomUUID(), google: "connection-callback-google-" + randomUUID() };
  const callbackProof = async (transport: ConnectionBinding, authOrigin: string, sameOwner: boolean): Promise<void> => {
    const operation = await prepare(transport);
    const provider = transport.client === "android" ? "apple" : "google";
    const browser = transport.client === "web" ? { origin: transport.origin, secret: transport.browserSecret } : null;
    const prepared = prepareAuthAttempt({ purpose: "login", client: transport.client, provider,
      codeChallenge: transport.client === "web" ? null : Buffer.from(authAttemptBindingHash(transport), "hex").toString("base64url") }, browser, authOrigin);
    attempts.push(authHandleHash(prepared.handle));
    const parameters = connectionParameters(operation, current, transport);
    const expiry = (await runtime.query("SELECT auth.create_connection_provider_attempt($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) AS expiry",
      [...parameters, authHandleHash(prepared.handle), provider, prepared.binding, prepared.redirectUri,
        sealAuthAttemptState(prepared.handle, JSON.stringify(prepared.secrets))])).rows[0].expiry as Date;
    const state = { ...createBrowserState(authOrigin, provider, prepared.handle, expiry.toISOString(),
      transport.client === "web" ? { client: "web" as const, browserSecret: transport.browserSecret, redirectUri: authOrigin + "/authorize" }
        : { client: "android" as const, codeChallenge: Buffer.from(prepared.binding, "hex").toString("base64url") },
      { screen: "settings", uiLocale: null }, "login"), connectionOperation: operation };
    const callback = new Hono();
    callback.get("/callback-authority", (c) => {
      try { return c.json(connectionCallbackParameters(readBrowserState(c, state.state))); }
      catch { return c.json({ code: "AUTH_ATTEMPT_RESTART_REQUIRED" }, 409); }
    });
    const cookie = "__Host-social_callback_" + state.state + "=" + sign(JSON.stringify(state));
    const response = await callback.request(authOrigin + "/callback-authority", { headers: { Cookie: cookie } });
    assert.equal(response.status, 200);
    const authority = await response.json() as [string, string, string, string, string | null, string, string];
    const swappedHost = authOrigin === "https://auth.nibomo.com" ? "https://auth.flashcards-open-source-app.com" : "https://auth.nibomo.com";
    assert.equal((await callback.request(swappedHost + "/callback-authority", { headers: { Cookie: cookie } })).status, 409);
    await assert.rejects(runtime.query("SELECT * FROM auth.claim_social_attempt($1,$2,'login',$3,$4,'provider_ready')",
      [authHandleHash(prepared.handle), prepared.binding, transport.client, transport.client === "web" ? authOrigin : null]), { code: "23514" });
    await assert.rejects(runtime.query("SELECT * FROM auth.claim_connection_callback($1,$2,$3,$4,$5,$6,$7)",
      [authority[0], authHandleHash("swapped"), ...authority.slice(2)]), { code: "P4201" });
    const claimed = (await runtime.query("SELECT * FROM auth.claim_connection_callback($1,$2,$3,$4,$5,$6,$7)", authority)).rows[0];
    await runtime.query("SELECT auth.advance_social_attempt($1,$2,'provider_claimed','provider_verifying','fixture',NULL)",
      [authority[1], claimed.claim_id]);
    if (provider === "apple") await runtime.query("SELECT auth.record_apple_login_proof($1,$2,'fixture',$3,floor(extract(epoch FROM clock_timestamp()))::bigint)",
      [authority[1], claimed.claim_id, providerSubjects.apple]);
    else await runtime.query("SELECT auth.advance_social_attempt($1,$2,'provider_verifying','provider_proved','fixture',$3)",
      [authority[1], claimed.claim_id, providerSubjects.google]);
    const result = (await runtime.query("SELECT * FROM auth.record_connection_callback($1,$2,$3,$4,$5,$6,$7,$8,NULL,NULL,NULL)",
      [...authority, claimed.claim_id])).rows[0];
    assert.equal(result.state, sameOwner ? "cancelled" : "proved");
    assert.equal(result.terminal_outcome, sameOwner ? "already_connected" : null);
    const resumed = (await runtime.query("SELECT * FROM auth.read_account_connection($1,$2,$3,$4,$5,$6,$7)", parameters)).rows[0];
    assert.equal(resumed.state, result.state);
    assert.equal((await owner.query("SELECT phase FROM auth.social_attempts WHERE attempt_sha256=$1", [authority[1]])).rows[0].phase, "provider_proved");
    if (!sameOwner) await runtime.query("SELECT auth.cancel_account_connection($1,$2,$3,$4,$5,$6,$7)", parameters);
  };
  const adoptCollision = async (): Promise<string> => {
    const handle = randomBytes(32).toString("base64url");
    const hash = authHandleHash(handle);
    attempts.push(hash);
    const loginBinding = { ...binding, purpose: "login" } as const;
    const transportHash = authAttemptBindingHash(loginBinding);
    await runtime.query("SELECT auth.create_social_attempt($1,'google','ios','login',$2,NULL,NULL,NULL,NULL,'fixture',NULL,NULL,NULL,NULL)",
      [hash, transportHash]);
    const claim = (await runtime.query("SELECT * FROM auth.claim_social_attempt($1,$2,'login','ios',NULL,'provider_ready')", [hash, transportHash])).rows[0].claim_id;
    await runtime.query("SELECT auth.advance_social_attempt($1,$2,'provider_claimed','provider_verifying','fixture',NULL)", [hash, claim]);
    await runtime.query("SELECT auth.advance_social_attempt($1,$2,'provider_verifying','provider_proved','fixture',$3)", [hash, claim, providerSubjects.google]);
    await runtime.query("SELECT auth.advance_social_attempt($1,$2,'provider_proved','provider_enrolling','fixture',$3)", [hash, claim, providerSubjects.google]);
    const completed = await transaction(runtime, () => completeAuthoritativeLoginInExecutor(executor(runtime),
      { handle, claimId: claim, provider: "google" }, { provider: "google", identity: { provider: "google", subject: providerSubjects.google,
        clientId: "postgres-connection-client", email: { address: emails[1], authority: "provider", privateRelay: false } } },
      { cognitoSubject: subjects[1], cognitoUsername: subjects[1], email: emails[1] }));
    if (completed.status !== "completed") throw new Error("Expected ordinary successful login");
    const login = await transaction(runtime, () => redeemSocialSignInInExecutor(executor(runtime), completed.response.completion, loginBinding));
    assert.equal(login.cognitoSubject, subjects[0]);
    const suggestion = login.signInHint.connectionSuggestion;
    assert.ok(suggestion);
    const operation = randomBytes(32).toString("base64url");
    const receipt = await adoptConnectionSuggestionInExecutor(executor(runtime), operation, current, binding, suggestion.suggestion, "canonical-account-v1");
    assert.equal(receipt.state, "proved");
    assert.equal(receipt.expiresAt, suggestion.expiresAt);
    const saved = (await owner.query("SELECT email_claim,source_proof->>'purpose' AS purpose,source_proof->>'phase' AS phase FROM auth.account_connection_proofs WHERE operation_sha256=$1",
      [authHandleHash(operation)])).rows[0];
    assert.deepEqual(saved, { email_claim: null, purpose: "login", phase: "redeemed" });
    return operation;
  };
  const act = (client: pg.Client, action: Extract<Parameters<typeof connectionConsentInExecutor>[3], { action: "preview" | "confirm" }>,
    session: ConnectionSession, transport: ConnectionBinding) => transaction(client,
      () => connectionConsentInExecutor(executor(client), session, transport, action));
  try {
    for (const [index, account] of accounts.entries()) {
      await owner.query("INSERT INTO org.user_settings(user_id,email) VALUES($1,$2)", [account, emails[index]]);
      await owner.query("SELECT auth.bind_cognito_account($1,$2)", [subjects[index], account]);
      await runtime.query("SELECT auth.enroll_proved_email_principal($1,$1,$2,clock_timestamp())", [subjects[index], emails[index]]);
    }
    for (const [index, workspace] of workspaces.entries()) {
      await owner.query("INSERT INTO org.workspaces(workspace_id,name,fsrs_client_updated_at,fsrs_last_modified_by_device_id,fsrs_last_operation_id) VALUES($1,'Personal',clock_timestamp(),$2,$3)",
        [workspace, randomUUID(), randomUUID()]);
      await owner.query("INSERT INTO org.workspace_memberships(workspace_id,user_id,role) VALUES($1,$2,'owner')", [workspace, accounts[index]]);
      await owner.query("UPDATE org.user_settings SET workspace_id=$2 WHERE user_id=$1", [accounts[index], workspace]);
    }
    await runtime.query("SELECT auth.activate_proved_provider_method('apple',$1,$2,$3)", [providerSubjects.apple, subjects[1], emails[1]]);
    await runtime.query("SELECT auth.activate_proved_provider_method('google',$1,$2,$3)", [providerSubjects.google, subjects[0], emails[0]]);
    for (const authOrigin of ["https://auth.nibomo.com", "https://auth.flashcards-open-source-app.com"]) {
      await callbackProof({ client: "android", purpose: "reauth", codeVerifier: randomBytes(32).toString("base64url") }, authOrigin, false);
      await callbackProof({ client: "web", purpose: "reauth", browserSecret: randomBytes(32).toString("base64url"), origin: authOrigin }, authOrigin, true);
    }
    const cancelled = await prepare(binding);
    await runtime.query("SELECT auth.cancel_account_connection($1,$2,$3,$4,$5,$6,$7)", connectionParameters(cancelled, current, binding));
    assert.equal((await runtime.query("SELECT * FROM auth.read_account_connection($1,$2,$3,$4,$5,$6,$7)",
      connectionParameters(cancelled, current, binding))).rows[0].state, "cancelled");
    assert.equal((await owner.query("SELECT 1 FROM auth.account_retirements WHERE retired_user_id=$1", [accounts[1]])).rowCount, 0);
    const noop = await prepare(binding);
    const same = (await runtime.query("SELECT * FROM auth.begin_connection_email_target($1,$2,$3,$4,$5,$6,$7,$8,$8,$9)",
      [...connectionParameters(noop, current, binding), subjects[0], emails[0]])).rows[0];
    assert.equal(same.terminal_outcome, "already_connected");
    assert.equal(same.target_account, null);
    const emailProof = await prepare(binding);
    await prove(emailProof);
    await runtime.query("SELECT auth.cancel_account_connection($1,$2,$3,$4,$5,$6,$7)", connectionParameters(emailProof, current, binding));
    const operation = await adoptCollision();
    const preview = parseAccountConnectionAction({ action: "preview", client: "ios", operation, omittedWorkspaceIds: [] });
    assert.equal(preview.action, "preview");
    if (preview.action !== "preview") throw new Error("Expected preview action");
    const initial = await act(runtime, preview, current, binding);
    assert.equal(initial.status, "preview");
    if (initial.status !== "preview") throw new Error("Expected preview");
    const roots = initial.choices.preview as Readonly<{ workspaces: readonly Readonly<{ unusedStarter: boolean }>[] }>;
    assert.ok(roots.workspaces.every((root) => !root.unusedStarter));
    assert.deepEqual(initial.omissionCandidateWorkspaceIds, [...workspaces].sort());
    assert.deepEqual(initial.choices.omittedWorkspaceIds, []);
    assert.deepEqual(initial.choices.historicalBaselines, {});
    assert.deepEqual(initial.choices.preview.suppressedWorkspaceIds, []);
    assert.equal(Object.hasOwn(initial.choices, "omissionCandidateWorkspaceIds"), false);
    assert.deepEqual((await owner.query("SELECT choices,preview_digest FROM auth.account_connection_proofs WHERE operation_sha256=$1",
      [authHandleHash(operation)])).rows[0], { choices: initial.choices, preview_digest: initial.choices.digest });
    await owner.query("UPDATE org.workspaces SET name='Study' WHERE workspace_id=$1", [workspaces[0]]);
    const customized = await act(runtime, preview, current, binding);
    if (customized.status !== "preview") throw new Error("Expected customized preview");
    assert.deepEqual(customized.omissionCandidateWorkspaceIds, [workspaces[1]]);
    await assert.rejects(act(runtime, preview, { ...current, username: "swapped" }, binding), { code: "P4201" });
    await assert.rejects(act(runtime, preview, { ...current, subject: subjects[2] }, binding), { code: "P4201" });
    await assert.rejects(act(runtime, preview, current, { ...binding, codeVerifier: randomBytes(32).toString("base64url") }), { code: "P4201" });
    await assert.rejects(act(runtime, preview, current, { client: "android", purpose: "reauth", codeVerifier: binding.codeVerifier }), { code: "P4201" });
    await assert.rejects(runtime.query("SELECT auth.combine_proved_accounts($1,$2,$3,'{}')", [randomUUID(), accounts[1], accounts[0]]), { code: "42501" });
    await assert.rejects(runtime.query("SELECT auth.prepare_account_connection_choices($1,'{}')", [authHandleHash(operation)]), { code: "42501" });
    const chosen = await act(runtime, { ...preview, omittedWorkspaceIds: [workspaces[1], workspaces[1]] }, current, binding);
    if (chosen.status !== "preview") throw new Error("Expected historical preview");
    assert.deepEqual(chosen.choices.omittedWorkspaceIds, [workspaces[1]]);
    assert.equal((await owner.query("SELECT 1 FROM org.workspace_starter_baselines WHERE workspace_id=$1", [workspaces[1]])).rowCount, 0);
    const confirm = { action: "confirm", operation, omittedWorkspaceIds: [workspaces[1]], previewDigest: chosen.choices.digest, accepted: true } as const;
    await assert.rejects(act(runtime, { ...confirm, previewDigest: authHandleHash("changed") }, current, binding), { code: "P4202" });
    await assert.rejects(act(runtime, { ...confirm, omittedWorkspaceIds: [] }, current, binding), { code: "P4202" });
    await owner.query("UPDATE org.workspaces SET name='Changed since preview' WHERE workspace_id=$1", [workspaces[1]]);
    await assert.rejects(act(runtime, confirm, current, binding), { code: "23514" });
    const changed = await act(runtime, preview, current, binding);
    if (changed.status !== "preview") throw new Error("Expected changed preview");
    assert.deepEqual(changed.omissionCandidateWorkspaceIds, []);
    await owner.query("UPDATE org.workspaces SET name='Personal' WHERE workspace_id=$1", [workspaces[1]]);
    const refreshed = await act(runtime, { ...preview, omittedWorkspaceIds: [workspaces[1]] }, current, binding);
    if (refreshed.status !== "preview") throw new Error("Expected refreshed preview");
    const consent = { ...confirm, previewDigest: refreshed.choices.digest };
    await runtime.query("BEGIN");
    const rolledBack = await connectionConsentInExecutor(executor(runtime), current, binding, consent);
    assert.equal(rolledBack.status, "connected");
    await runtime.query("ROLLBACK");
    assert.equal((await owner.query("SELECT 1 FROM auth.account_retirements WHERE retired_user_id=$1", [accounts[1]])).rowCount, 0);
    assert.equal((await owner.query("SELECT 1 FROM org.workspace_starter_baselines WHERE workspace_id=$1", [workspaces[1]])).rowCount, 0);
    const sourceHash = (await owner.query("SELECT source_attempt_sha256 FROM auth.account_connection_proofs WHERE operation_sha256=$1", [authHandleHash(operation)])).rows[0].source_attempt_sha256;
    assert.equal((await owner.query("SELECT 1 FROM auth.social_attempts WHERE attempt_sha256=$1", [sourceHash])).rowCount, 1);
    await runtime.query("BEGIN");
    const completed = await connectionConsentInExecutor(executor(runtime), current, binding, consent);
    await contender.query("BEGIN");
    const identical = connectionConsentInExecutor(executor(contender), current, binding, consent);
    await runtime.query("COMMIT");
    const replayed = await identical;
    await contender.query("COMMIT");
    assert.deepEqual(replayed, completed);
    if (completed.status !== "connected") throw new Error("Expected committed result");
    assert.equal(completed.result.canonicalAccountId, accounts[0]);
    assert.equal(completed.result.sourceUserId, accounts[1]);
    assert.equal(completed.operationId, refreshed.choices.operationId);
    assert.equal((await owner.query("SELECT 1 FROM auth.social_attempts WHERE attempt_sha256=$1", [sourceHash])).rowCount, 0);
    assert.equal((await owner.query("SELECT count(*)::int AS count FROM org.workspaces WHERE workspace_id=ANY($1::uuid[])", [workspaces])).rows[0].count, 2);
    assert.equal((await owner.query("SELECT starter_suppressed_at IS NOT NULL AS hidden FROM org.workspaces WHERE workspace_id=$1", [workspaces[1]])).rows[0].hidden, true);
    assert.equal((await owner.query("SELECT email FROM org.user_settings WHERE user_id=$1", [accounts[0]])).rows[0].email, emails[0]);
    await owner.query("UPDATE org.workspaces SET name='Meaningful late edit' WHERE workspace_id=$1", [workspaces[1]]);
    assert.equal((await owner.query("SELECT org.workspace_is_unused_starter($1) AS unused", [workspaces[1]])).rows[0].unused, false);
    assert.deepEqual(await act(runtime, consent, current, binding), completed);
    await assert.rejects(act(runtime, { ...consent, omittedWorkspaceIds: [] }, current, binding), { code: "P4202" });
    // Age the independent receipt without relying on a two-minute wall-clock wait or transient attempts.
    await owner.query("BEGIN");
    const saved = (await owner.query("DELETE FROM auth.account_connection_proofs WHERE operation_sha256=$1 RETURNING to_jsonb(account_connection_proofs) AS row",
      [authHandleHash(operation)])).rows[0].row;
    await owner.query("INSERT INTO auth.account_connection_proofs SELECT (jsonb_populate_record(NULL::auth.account_connection_proofs,$1::jsonb||jsonb_build_object('expires_at','2000-01-01','target_expires_at','2000-01-01'))).*",
      [JSON.stringify(saved)]);
    await owner.query("COMMIT");
    assert.deepEqual(await act(runtime, consent, current, binding), completed);
    await owner.query("SELECT auth.delete_user_auth_artifacts($1,$2)", [accounts[1], emails[1]]);
    assert.equal((await owner.query("SELECT 1 FROM auth.account_connection_proofs WHERE operation_sha256=$1", [authHandleHash(operation)])).rowCount, 0);
    assert.equal((await owner.query("SELECT 1 FROM auth.account_union_receipts WHERE operation_id=$1", [completed.operationId])).rowCount, 0);
  } finally {
    await Promise.all([owner.query("ROLLBACK"), runtime.query("ROLLBACK"), contender.query("ROLLBACK")]);
    await owner.query("DELETE FROM auth.account_connection_proofs WHERE source_account=ANY($1::text[])", [accounts]);
    await owner.query("DELETE FROM auth.account_union_receipts WHERE source_user_id=ANY($1::text[]) OR target_user_id=ANY($1::text[])", [accounts]);
    await owner.query("DELETE FROM auth.account_retirements WHERE retired_user_id=ANY($1::text[]) OR canonical_user_id=ANY($1::text[])", [accounts]);
    await owner.query("DELETE FROM auth.social_attempts WHERE attempt_sha256=ANY($1::text[])", [attempts]);
    await owner.query("DELETE FROM org.workspaces WHERE workspace_id=ANY($1::uuid[])", [workspaces]);
    await owner.query("DELETE FROM auth.apple_revocation_credentials WHERE provider_subject=$1", [providerSubjects.apple]);
    await owner.query("DELETE FROM auth.provider_login_methods WHERE provider_subject=ANY($1::text[])", [Object.values(providerSubjects)]);
    await owner.query("DELETE FROM auth.provider_identities WHERE provider_subject=ANY($1::text[])", [Object.values(providerSubjects)]);
    await owner.query("DELETE FROM auth.verified_login_emails WHERE cognito_subject=ANY($1::text[])", [subjects]);
    await owner.query("DELETE FROM auth.user_identities WHERE provider_subject=ANY($1::text[]) AND provider_type='cognito'", [subjects]);
    await owner.query("DELETE FROM auth.cognito_principals WHERE cognito_subject=ANY($1::text[])", [subjects]);
    await owner.query("DELETE FROM org.user_settings WHERE user_id=ANY($1::text[])", [accounts]);
  }
}

export async function checkAccountConnectionHttp(): Promise<void> {
  const app = createApp("/");
  for (const origin of ["https://auth.nibomo.com", "https://auth.flashcards-open-source-app.com"]) {
    const post = (body: object, headers: Readonly<Record<string, string>>) => runWithSocialSourceIp("192.0.2.46", async () => app.request(origin + "/api/account/connection",
      { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }));
    const native = await post({ action: "begin", client: "ios", capability: "canonical-account-v1",
      codeVerifier: randomBytes(32).toString("base64url"), sourceCompletion: randomBytes(32).toString("base64url") }, {});
    assert.equal(native.status, 401);
    assert.equal((await native.json() as { code: string }).code, "SESSION_REQUIRED");
    const browser = await post({ action: "adopt", client: "web", suggestion: randomBytes(32).toString("base64url"), capability: "canonical-account-v1" }, {});
    assert.equal(browser.status, 400);
    assert.equal((await browser.json() as { code: string }).code, "AUTH_ATTEMPT_INVALID");
    assert.equal(browser.headers.get("set-cookie"), null);
    const contexts = new Hono<AuthAppEnv>();
    contexts.get("/context", (c) => c.json({ csrfToken: createAccountBrowserContext(c) }));
    const created = await contexts.request(origin + "/context", { headers: { Origin: origin } });
    const { csrfToken } = await created.json() as Readonly<{ csrfToken: string }>;
    assert.match(created.headers.get("set-cookie")!, /(?:^|; )Max-Age=600(?:;|$)/i);
    const initialCookie = created.headers.get("set-cookie")!.split(";")[0];
    type BrowserContext = Parameters<typeof preserveAccountConnectionContext>[1] & Readonly<{ expiresAt: number }>;
    const original = JSON.parse(verify(initialCookie.slice(initialCookie.indexOf("=") + 1))) as BrowserContext;
    contexts.get("/retain", (c) => { preserveAccountConnectionContext(c, original); return c.body(null, 204); });
    const retained = await contexts.request(origin + "/retain", { headers: { Origin: origin } });
    assert.match(retained.headers.get("set-cookie")!, /(?:^|; )Max-Age=86400(?:;|$)/i);
    const retainedCookie = retained.headers.get("set-cookie")!.split(";")[0];
    const preserved = JSON.parse(verify(retainedCookie.slice(retainedCookie.indexOf("=") + 1))) as BrowserContext;
    assert.deepEqual({ ...preserved, expiresAt: original.expiresAt }, original);
    const confirm = { action: "confirm", client: "web", csrfToken, operation: randomBytes(32).toString("base64url"),
      omittedWorkspaceIds: [], previewDigest: authHandleHash("consent"), accepted: true };
    // Signed fixture aging crosses the real HTTP expiry gate without replacing the clock or session verifier.
    const agedCookie = (context: BrowserContext, elapsed: number): string => "__Host-account_methods_" + csrfToken + "="
      + sign(JSON.stringify({ ...context, expiresAt: context.expiresAt - elapsed }));
    const expiredOriginal = await post(confirm, { Origin: origin, Cookie: agedCookie(original, 660_000) });
    assert.equal(expiredOriginal.status, 409);
    assert.equal((await expiredOriginal.json() as { code: string }).code, "AUTH_ATTEMPT_RESTART_REQUIRED");
    const retry = await post(confirm, { Origin: origin, Cookie: agedCookie(preserved, 660_000) });
    assert.equal(retry.status, 401);
    assert.equal((await retry.json() as { code: string }).code, "SESSION_REQUIRED");
    const expiredRetention = await post(confirm, { Origin: origin, Cookie: agedCookie(preserved, 86_460_000) });
    assert.equal(expiredRetention.status, 409);
    assert.equal((await expiredRetention.json() as { code: string }).code, "AUTH_ATTEMPT_RESTART_REQUIRED");
    const swappedCsrf = await post({ ...confirm, csrfToken: randomBytes(32).toString("base64url") }, { Origin: origin, Cookie: retainedCookie });
    assert.equal(swappedCsrf.status, 400);
    const swappedHost = origin === "https://auth.nibomo.com" ? "https://auth.flashcards-open-source-app.com" : "https://auth.nibomo.com";
    const wrongHost = await runWithSocialSourceIp("192.0.2.46", async () => app.request(swappedHost + "/api/account/connection",
      { method: "POST", headers: { "content-type": "application/json", Origin: swappedHost, Cookie: retainedCookie }, body: JSON.stringify(confirm) }));
    assert.equal(wrongHost.status, 409);
    const missingOrigin = await post(confirm, { Cookie: retainedCookie });
    assert.equal(missingOrigin.status, 400);
  }
}
