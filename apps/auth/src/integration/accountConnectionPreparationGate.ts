import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import type pg from "pg";
import type { DatabaseExecutor } from "../db.js";
import type { CognitoEmailPrincipal } from "../server/cognito/cognitoAuth.js";
import { encryptAppleCredential } from "../server/social/appleCredential.js";
import { authAttemptBindingHash, authHandleHash } from "../server/social/attemptStore.js";
import { completeAuthoritativeLoginInExecutor, redeemSocialSignInInExecutor } from "../server/social/completionStore.js";
import { adoptConnectionSuggestionInExecutor } from "../server/social/accountConnectionPreparation.js";
import { prepareAccountConnectionChoicesInExecutor, replayAccountConnectionInExecutor } from "../server/social/accountConnectionStore.js";
import type { ConnectionSession, ConnectionSuggestion } from "../server/social/accountConnectionContract.js";
import type { ProviderEnrollmentProof } from "../server/social/principalEnrollment.js";

function executor(client: pg.Client): DatabaseExecutor {
  return { query: (text, parameters) => client.query(text, [...parameters]) };
}

async function transaction<Result>(client: pg.Client, run: () => Promise<Result>): Promise<Result> {
  await client.query("BEGIN");
  try {
    const value = await run();
    await client.query("COMMIT");
    return value;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

// Real module/PostgreSQL boundary: supplied verified facts do not claim provider or inbox acceptance.
export async function checkAccountConnectionPreparation(runtime: pg.Client, owner: pg.Client): Promise<void> {
  const accounts = [randomUUID(), randomUUID()];
  const sharedAccount = randomUUID();
  const subjects = [randomUUID(), randomUUID()];
  const emails = subjects.map((subject) => subject + "@mail.test");
  const workspaces = [randomUUID(), randomUUID(), randomUUID()];
  const providers = { google: "readiness-google-" + randomUUID(), apple: "readiness-apple-" + randomUUID() };
  const binding = { purpose: "login", client: "ios", codeVerifier: randomBytes(32).toString("base64url") } as const;
  const connectionBinding = { ...binding, purpose: "reauth" } as const;
  const current: ConnectionSession = { subject: subjects[0], username: subjects[0], email: emails[0], emailVerified: true, authTime: 1 };
  const attempts: string[] = [];
  const operations: string[] = [];
  const previousKey = process.env.SESSION_ENCRYPTION_KEY;
  process.env.SESSION_ENCRYPTION_KEY = randomBytes(32).toString("hex");
  const completeLogin = async (provider: "google" | "apple", principal: CognitoEmailPrincipal | null): Promise<Readonly<{
    suggestion: ConnectionSuggestion | undefined; attempt: string; completion: string;
  }>> => {
    const handle = randomBytes(32).toString("base64url");
    const hash = authHandleHash(handle);
    attempts.push(hash);
    const identity = { provider, subject: providers[provider], clientId: "postgres-readiness-client",
      email: { address: emails[1], authority: "provider", privateRelay: false } } as const;
    const proof: ProviderEnrollmentProof = provider === "google" ? { provider, identity }
      : { provider, identity, issuedAt: Math.floor(Date.now() / 1000),
        credential: encryptAppleCredential(providers.apple, identity.clientId, "fixture-apple-refresh") };
    await runtime.query("SELECT auth.create_social_attempt($1,$2,'ios','login',$3,NULL,NULL,NULL,NULL,'fixture',NULL,NULL,NULL,NULL)",
      [hash, provider, authAttemptBindingHash(binding)]);
    const claimId = (await runtime.query<{ claim_id: string }>(
      "SELECT * FROM auth.claim_social_attempt($1,$2,'login','ios',NULL,'provider_ready')",
      [hash, authAttemptBindingHash(binding)])).rows[0].claim_id;
    await runtime.query("SELECT auth.advance_social_attempt($1,$2,'provider_claimed','provider_verifying','fixture',NULL)", [hash, claimId]);
    if (provider === "apple") {
      await runtime.query("SELECT auth.record_apple_login_proof($1,$2,'fixture',$3,$4)",
        [hash, claimId, providers.apple, Math.floor(Date.now() / 1000)]);
    } else {
      await runtime.query("SELECT auth.advance_social_attempt($1,$2,'provider_verifying','provider_proved','fixture',$3)",
        [hash, claimId, providers.google]);
    }
    await runtime.query("SELECT auth.advance_social_attempt($1,$2,'provider_proved','provider_enrolling','fixture',$3)",
      [hash, claimId, providers[provider]]);
    const completed = await transaction(runtime, () => completeAuthoritativeLoginInExecutor(executor(runtime),
      { handle, claimId, provider }, proof, principal));
    assert.equal(completed.status, "completed");
    if (completed.status !== "completed") throw new Error("Expected ordinary collision login");
    assert.equal(completed.emailEnrollment, provider === "apple" ? "foreign_account" : null);
    const captured = (await owner.query<{ suggestion_sha256: string }>(
      "SELECT suggestion_sha256 FROM auth.account_connection_suggestions WHERE attempt_sha256=$1", [hash])).rows[0];
    if (captured !== undefined) {
      await assert.rejects(owner.query("SELECT * FROM auth.adopt_account_connection_suggestion($1,$2,$2,1,$3,'ios',NULL,$4,'canonical-account-v1')",
        [authHandleHash(randomBytes(32).toString("base64url")), subjects[0], authAttemptBindingHash(binding), captured.suggestion_sha256]), { code: "23514" });
    }
    const redeemed = await transaction(runtime, () => redeemSocialSignInInExecutor(executor(runtime), completed.response.completion, binding));
    assert.equal(redeemed.cognitoSubject, subjects[0]);
    assert.equal(redeemed.signInHint.recoveryEmail, emails[0]);
    assert.equal((await owner.query("SELECT phase,secret_ciphertext,result_ciphertext FROM auth.social_attempts WHERE attempt_sha256=$1", [hash])).rows[0].phase, "redeemed");
    return { suggestion: redeemed.signInHint.connectionSuggestion, attempt: hash, completion: completed.response.completion };
  };
  const login = (provider: "google" | "apple") => completeLogin(provider,
    { cognitoSubject: subjects[1], cognitoUsername: subjects[1], email: emails[1] });
  const adopt = async (suggestion: ConnectionSuggestion, changed: ConnectionSession, verifier: string) => {
    const operation = randomBytes(32).toString("base64url");
    operations.push(authHandleHash(operation));
    return adoptConnectionSuggestionInExecutor(executor(owner), operation, changed,
      { ...connectionBinding, codeVerifier: verifier }, suggestion.suggestion, "canonical-account-v1");
  };
  try {
    for (let index = 0; index < 2; index += 1) {
      await owner.query("INSERT INTO org.user_settings(user_id,email) VALUES($1,$2)", [accounts[index], emails[index]]);
      await owner.query("SELECT auth.bind_cognito_account($1,$2)", [subjects[index], accounts[index]]);
      await runtime.query("SELECT auth.enroll_proved_email_principal($1,$1,$2,clock_timestamp())", [subjects[index], emails[index]]);
    }
    for (const provider of ["google", "apple"] as const) {
      await runtime.query("SELECT auth.activate_proved_provider_method($1,$2,$3,$4)", [provider, providers[provider], subjects[0], emails[0]]);
    }
    const unavailableMailbox = await completeLogin("google", null);
    assert.equal(unavailableMailbox.suggestion, undefined);
    assert.equal((await owner.query("SELECT 1 FROM auth.account_connection_suggestions WHERE attempt_sha256=$1",
      [unavailableMailbox.attempt])).rowCount, 0);
    const apple = await login("apple");
    assert.ok(apple.suggestion);
    const appleReceipt = await adopt(apple.suggestion, current, binding.codeVerifier);
    assert.equal(appleReceipt.account, accounts[0]);
    assert.equal(appleReceipt.targetAccount, accounts[1]);
    const google = await login("google");
    assert.ok(google.suggestion);
    await assert.rejects(adopt(google.suggestion, { ...current, subject: subjects[1] }, binding.codeVerifier), { code: "23514" });
    await assert.rejects(adopt(google.suggestion, { ...current, username: "swapped" }, binding.codeVerifier), { code: "23514" });
    await assert.rejects(adopt(google.suggestion, current, randomBytes(32).toString("base64url")), { code: "23514" });
    await assert.rejects(runtime.query("SELECT * FROM auth.adopt_account_connection_suggestion($1,$2,$2,1,$3,'ios',NULL,$4,'canonical-account-v1')",
      [authHandleHash("denied"), subjects[0], authAttemptBindingHash(binding), authHandleHash(google.suggestion.suggestion)]), { code: "42501" });
    await owner.query("BEGIN");
    const rolledBack = await adopt(google.suggestion, current, binding.codeVerifier);
    await owner.query("ROLLBACK");
    const receipt = await adopt(google.suggestion, current, binding.codeVerifier);
    assert.notEqual(receipt.operationId, rolledBack.operationId);
    assert.equal(receipt.state, "proved");
    assert.equal(receipt.expiresAt, google.suggestion.expiresAt);
    await assert.rejects(adopt(google.suggestion, current, binding.codeVerifier), { code: "23514" });
    await assert.rejects(owner.query("UPDATE auth.account_connection_proofs SET operation_id=$2 WHERE operation_sha256=$1",
      [authHandleHash(receipt.operation), randomUUID()]), { code: "23514" });
    const expired = await login("google");
    assert.ok(expired.suggestion);
    await owner.query("UPDATE auth.account_connection_suggestions SET expires_at=clock_timestamp()-interval '1 second' WHERE suggestion_sha256=$1",
      [authHandleHash(expired.suggestion.suggestion)]);
    await assert.rejects(adopt(expired.suggestion, current, binding.codeVerifier), { code: "23514" });
    const generation = await login("google");
    assert.ok(generation.suggestion);
    const originalGeneration = (await owner.query("SELECT verified_at::text AS verified_at FROM auth.verified_login_emails WHERE cognito_subject=$1", [subjects[1]])).rows[0].verified_at;
    await owner.query("UPDATE auth.verified_login_emails SET verified_at=verified_at+interval '1 second' WHERE cognito_subject=$1", [subjects[1]]);
    await assert.rejects(adopt(generation.suggestion, current, binding.codeVerifier), { code: "23514" });
    await owner.query("UPDATE auth.verified_login_emails SET verified_at=$2 WHERE cognito_subject=$1", [subjects[1], originalGeneration]);

    const fenced = await login("google");
    assert.ok(fenced.suggestion);
    await owner.query("INSERT INTO auth.principal_session_fences(subject_sha256,minimum_auth_time) VALUES($1,$2)",
      [authHandleHash(subjects[0]), Math.floor(Date.now() / 1000) + 1]);
    await assert.rejects(adopt(fenced.suggestion, current, binding.codeVerifier), { code: "23514" });
    await owner.query("DELETE FROM auth.principal_session_fences WHERE subject_sha256=$1", [authHandleHash(subjects[0])]);
    const changedMethod = await login("google");
    assert.ok(changedMethod.suggestion);
    const methodGeneration = (await owner.query("SELECT activated_at::text AS activated_at FROM auth.provider_login_methods WHERE provider_subject=$1", [providers.google])).rows[0].activated_at;
    await owner.query("UPDATE auth.provider_login_methods SET activated_at=activated_at+interval '1 second' WHERE provider_subject=$1", [providers.google]);
    await assert.rejects(adopt(changedMethod.suggestion, current, binding.codeVerifier), { code: "23514" });
    await owner.query("UPDATE auth.provider_login_methods SET activated_at=$2 WHERE provider_subject=$1", [providers.google, methodGeneration]);

    for (const [index, workspace] of workspaces.entries()) {
      await transaction(owner, async () => {
        await owner.query(`INSERT INTO org.workspaces(workspace_id,name,fsrs_client_updated_at,
          fsrs_last_modified_by_replica_id,fsrs_last_operation_id) VALUES($1,'Personal',now(),$1,'seed')`, [workspace]);
        await owner.query(`INSERT INTO sync.workspace_replicas(replica_id,workspace_id,user_id,actor_kind,actor_key,platform)
          VALUES($1,$1,$2,'workspace_seed','seed','system')`, [workspace, accounts[index === 1 ? 1 : 0]]);
        await owner.query("INSERT INTO org.workspace_memberships(workspace_id,user_id,role) VALUES($1,$2,'owner')", [workspace, accounts[index === 1 ? 1 : 0]]);
      });
    }
    await owner.query("UPDATE org.user_settings SET workspace_id=$2 WHERE user_id=$1", [accounts[0], workspaces[0]]);
    await owner.query("UPDATE org.user_settings SET workspace_id=$2 WHERE user_id=$1", [accounts[1], workspaces[1]]);
    const draft = await transaction(owner, async () => {
      await owner.query("SELECT auth.lock_account_retirement($1,$2)", [accounts[1], accounts[0]]);
      return prepareAccountConnectionChoicesInExecutor(executor(owner), receipt.operation, current, connectionBinding, [workspaces[1]]);
    });
    assert.deepEqual(draft.omittedWorkspaceIds, [workspaces[1]]);
    assert.equal((await owner.query("SELECT org.workspace_is_unused_starter($1) AS unused", [workspaces[1]])).rows[0].unused, false);
    assert.equal((await owner.query("SELECT count(*)::int AS count FROM org.workspace_starter_baselines WHERE workspace_id=ANY($1::uuid[])", [workspaces])).rows[0].count, 0);
    const unionResult = await transaction(owner, async () => {
      await owner.query("SELECT auth.lock_account_retirement($1,$2)", [accounts[1], accounts[0]]);
      // Owner fixture simulates later explicit consent; no production activation writer exists yet.
      await owner.query("INSERT INTO org.workspace_starter_baselines VALUES($1,$2,$3::jsonb)",
        [workspaces[1], receipt.operationId, JSON.stringify(draft.historicalBaselines[workspaces[1]])]);
      const preview = (await owner.query("SELECT auth.preview_account_union($1,$2,50000,256) AS preview", [accounts[1], accounts[0]])).rows[0].preview;
      assert.deepEqual(preview, draft.preview);
      return (await owner.query("SELECT auth.combine_proved_accounts($1,$2,$3,$4::jsonb) AS result",
        [receipt.operationId, accounts[1], accounts[0], JSON.stringify(draft.preview)])).rows[0].result;
    });
    assert.equal((await owner.query("SELECT org.workspace_is_unused_starter($1) AS unused", [workspaces[1]])).rows[0].unused, true);
    assert.equal((await owner.query("SELECT starter_suppressed_at IS NOT NULL AS hidden FROM org.workspaces WHERE workspace_id=$1", [workspaces[1]])).rows[0].hidden, true);
    await owner.query("UPDATE org.workspaces SET name='Late meaningful edit' WHERE workspace_id=$1", [workspaces[1]]);
    assert.equal((await owner.query("SELECT org.workspace_is_unused_starter($1) AS unused", [workspaces[1]])).rows[0].unused, false);
    assert.equal((await owner.query("SELECT 1 FROM org.workspaces WHERE workspace_id=$1", [workspaces[1]])).rowCount, 1);

    const digest = authHandleHash("fixture-explicit-consent");
    await owner.query("UPDATE auth.account_connection_proofs SET state='committed',consent_digest=$2,committed_result=$3 WHERE operation_sha256=$1",
      [authHandleHash(receipt.operation), digest, JSON.stringify(unionResult)]);
    assert.deepEqual(await replayAccountConnectionInExecutor(executor(owner), receipt.operation, current, connectionBinding, digest),
      { consentDigest: digest, result: JSON.stringify(unionResult) });
    await assert.rejects(replayAccountConnectionInExecutor(executor(owner), receipt.operation, current, connectionBinding, authHandleHash("changed-consent")), { code: "23514" });
    const expiredReplay = randomBytes(32).toString("base64url");
    const retainedReplay = randomBytes(32).toString("base64url");
    const reservedHash = authHandleHash(randomBytes(32).toString("base64url"));
    const cleanupTrigger = authHandleHash(randomBytes(32).toString("base64url"));
    attempts.push(reservedHash, cleanupTrigger);
    const createCleanupAttempt = (hash: string) => runtime.query(
      "SELECT auth.create_social_attempt($1,'google','ios','login',$2,NULL,NULL,NULL,NULL,'fixture',NULL,NULL,NULL,NULL)",
      [hash, authAttemptBindingHash(binding)]);
    await createCleanupAttempt(reservedHash);
    const reservedOperation = authHandleHash(randomBytes(32).toString("base64url"));
    for (const [operation, sourceHash, retention] of [
      [authHandleHash(expiredReplay), authHandleHash(randomBytes(32).toString("base64url")), "2000-01-01"],
      [authHandleHash(retainedReplay), authHandleHash(randomBytes(32).toString("base64url")), "2099-01-01"],
      [reservedOperation, reservedHash, "2000-01-01"],
    ]) {
      operations.push(operation);
      await owner.query(`INSERT INTO auth.account_connection_proofs
        SELECT (jsonb_populate_record(NULL::auth.account_connection_proofs,to_jsonb(r)||jsonb_build_object(
          'operation_sha256',$2::text,'operation_id',$3::uuid,'source_attempt_sha256',$4::text,
          'expires_at','2000-01-01','target_expires_at','2000-01-01','retain_until',$5::text,
          'source_proof',r.source_proof||jsonb_build_object('expires_at','2000-01-01'),
          'provider_snapshot',r.provider_snapshot||jsonb_build_object('expires_at','2000-01-01')))).*
        FROM auth.account_connection_proofs r WHERE operation_sha256=$1`,
        [authHandleHash(receipt.operation), operation, randomUUID(), sourceHash, retention]);
    }
    assert.equal(await replayAccountConnectionInExecutor(executor(owner), expiredReplay, current, connectionBinding, digest), null);
    assert.deepEqual(await replayAccountConnectionInExecutor(executor(owner), retainedReplay, current, connectionBinding, digest),
      { consentDigest: digest, result: JSON.stringify(unionResult) });
    await owner.query("BEGIN");
    try {
      await owner.query("SELECT 1 FROM auth.account_connection_proofs WHERE operation_sha256=$1 FOR UPDATE", [authHandleHash(expiredReplay)]);
      await createCleanupAttempt(cleanupTrigger);
      assert.equal((await owner.query("SELECT 1 FROM auth.account_connection_proofs WHERE operation_sha256=$1", [authHandleHash(expiredReplay)])).rowCount, 1);
      await owner.query("COMMIT");
    } finally {
      await owner.query("ROLLBACK");
    }
    const unlockedCleanupTrigger = authHandleHash(randomBytes(32).toString("base64url"));
    attempts.push(unlockedCleanupTrigger);
    await createCleanupAttempt(unlockedCleanupTrigger);
    assert.equal((await owner.query("SELECT 1 FROM auth.account_connection_proofs WHERE operation_sha256=$1", [authHandleHash(expiredReplay)])).rowCount, 0);
    assert.equal((await owner.query("SELECT 1 FROM auth.account_connection_proofs WHERE operation_sha256=$1", [authHandleHash(retainedReplay)])).rowCount, 1);
    await assert.rejects(runtime.query("SELECT auth.assert_unreserved_auth_attempt($1)", [reservedHash]), { code: "23514" });
    await owner.query("UPDATE auth.social_attempts SET expires_at='2000-01-01' WHERE attempt_sha256=$1", [reservedHash]);
    const finalCleanupTrigger = authHandleHash(randomBytes(32).toString("base64url"));
    attempts.push(finalCleanupTrigger);
    await createCleanupAttempt(finalCleanupTrigger);
    assert.equal((await owner.query("SELECT 1 FROM auth.account_connection_proofs WHERE operation_sha256=$1", [reservedOperation])).rowCount, 0);
    assert.equal((await owner.query("SELECT 1 FROM org.workspace_starter_baselines WHERE workspace_id=$1", [workspaces[1]])).rowCount, 1);
    await owner.query("INSERT INTO org.user_settings(user_id) VALUES($1)", [sharedAccount]);
    await owner.query("INSERT INTO org.workspace_memberships(workspace_id,user_id,role) VALUES($1,$2,'owner')", [workspaces[2], sharedAccount]);
    await owner.query("INSERT INTO org.workspace_starter_baselines VALUES($1,$2,org.workspace_starter_baseline($1))", [workspaces[2], randomUUID()]);
    // Retired aliases reach the same helper; neither pass erases unrelated shared roots.
    await owner.query("SELECT auth.delete_user_auth_artifacts($1,$2)", [accounts[1], emails[1]]);
    await owner.query("SELECT auth.delete_user_auth_artifacts($1,$2)", [accounts[0], emails[0]]);
    assert.equal((await owner.query("SELECT 1 FROM auth.account_connection_proofs WHERE source_account=$1", [accounts[0]])).rowCount, 0);
    assert.equal((await owner.query("SELECT 1 FROM auth.account_union_receipts WHERE operation_id=$1", [receipt.operationId])).rowCount, 0);
    assert.equal((await owner.query("SELECT 1 FROM org.workspace_starter_baselines WHERE workspace_id=$1", [workspaces[1]])).rowCount, 0);
    assert.equal((await owner.query("SELECT 1 FROM org.workspace_starter_baselines WHERE workspace_id=$1", [workspaces[2]])).rowCount, 1);
    assert.equal((await owner.query("SELECT 1 FROM org.workspaces WHERE workspace_id=$1", [workspaces[2]])).rowCount, 1);
  } finally {
    await owner.query("ROLLBACK");
    await runtime.query("ROLLBACK");
    await owner.query("DELETE FROM auth.account_connection_suggestions WHERE attempt_sha256=ANY($1::text[])", [attempts]);
    await owner.query("DELETE FROM auth.account_connection_proofs WHERE source_account=ANY($1::text[])", [accounts]);
    await owner.query("DELETE FROM auth.account_union_receipts WHERE source_user_id=ANY($1::text[]) OR target_user_id=ANY($1::text[])", [accounts]);
    await owner.query("DELETE FROM auth.account_retirements WHERE retired_user_id=ANY($1::text[]) OR canonical_user_id=ANY($1::text[])", [accounts]);
    await owner.query("DELETE FROM auth.social_attempts WHERE attempt_sha256=ANY($1::text[])", [attempts]);
    await owner.query("DELETE FROM org.workspaces WHERE workspace_id=ANY($1::uuid[])", [workspaces]);
    await owner.query("DELETE FROM auth.apple_revocation_credentials WHERE provider_subject=$1", [providers.apple]);
    await owner.query("DELETE FROM auth.provider_login_methods WHERE provider_subject=ANY($1::text[])", [Object.values(providers)]);
    await owner.query("DELETE FROM auth.provider_identities WHERE provider_subject=ANY($1::text[])", [Object.values(providers)]);
    await owner.query("DELETE FROM auth.verified_login_emails WHERE cognito_subject=ANY($1::text[])", [subjects]);
    await owner.query("DELETE FROM auth.user_identities WHERE provider_type='cognito' AND provider_subject=ANY($1::text[])", [subjects]);
    await owner.query("DELETE FROM auth.principal_session_fences WHERE subject_sha256=ANY($1::text[])", [subjects.map(authHandleHash)]);
    await owner.query("DELETE FROM auth.cognito_principals WHERE cognito_subject=ANY($1::text[])", [subjects]);
    await owner.query("DELETE FROM org.user_settings WHERE user_id=ANY($1::text[])", [[...accounts, sharedAccount]]);
    if (previousKey === undefined) delete process.env.SESSION_ENCRYPTION_KEY;
    else process.env.SESSION_ENCRYPTION_KEY = previousKey;
  }
}
