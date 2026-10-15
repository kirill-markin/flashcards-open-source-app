import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";
import { assertAccountLiveSession, assertVerifiedAccountDeletionSession, assertVerifiedPrincipalSession } from "./principalSessions";

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function credentialEnvelope(): string {
  return `v1.${randomBytes(12).toString("base64url")}.${randomBytes(16).toString("base64url")}.${randomBytes(64).toString("base64url")}`;
}

test("principal fence, original authentication time and shared durable signout obey real role/lifecycle boundaries", async () => {
  const ownerUrl = process.env.TEST_DATABASE_ADMIN_URL;
  if (ownerUrl === undefined) throw new Error("TEST_DATABASE_ADMIN_URL is required");
  const owner = new pg.Client({ connectionString: ownerUrl });
  const auth = new pg.Client({ connectionString: ownerUrl });
  const contender = new pg.Client({ connectionString: ownerUrl });
  const backend = new pg.Client({ connectionString: ownerUrl });
  const subjects = [randomUUID(), randomUUID(), randomUUID()];
  const [subject, alias, unrelated] = subjects;
  const accountId = randomUUID();
  const operation = randomUUID();
  const secondOperation = randomUUID();
  const deletionId = randomUUID();
  const appleProvider = `apple-${randomUUID()}`;
  const googleProvider = `google-${randomUUID()}`;
  const relayEmail = `${randomUUID()}@privaterelay.appleid.com`;
  const email = `${randomUUID()}@mail.test`;
  const sessionHash = digest(subject);
  const statusSql = "SELECT auth.principal_session_status($1, $2) AS status";
  const claimSql = "SELECT * FROM auth.claim_apple_session_revocation()";
  const invalidateSql = "SELECT auth.invalidate_principal_sessions($1, $2)";
  const completeSql = "SELECT auth.complete_apple_session_revocation($1, $2)";
  const fenceSql = "SELECT minimum_auth_time FROM auth.principal_session_fences WHERE subject_sha256 = $1";
  const notificationHash = digest(randomUUID());
  const credential = credentialEnvelope();
  const oldAuthTime = Math.floor(Date.now() / 1_000) - 300;
  try {
    await owner.connect();
    await auth.connect();
    await auth.query("SET ROLE auth_app");
    await contender.connect();
    await contender.query("SET ROLE auth_app");
    await backend.connect();
    await backend.query("SET ROLE backend_app");
    for (const principal of subjects) {
      await auth.query("SELECT auth.enroll_proved_email_principal($1, $1, $2, clock_timestamp())", [principal, principal === alias ? relayEmail : email]);
    }
    await auth.query("SELECT auth.activate_proved_provider_method('google', $1, $2, $3)", [googleProvider, subject, email]);
    await auth.query("SELECT auth.activate_proved_provider_method('apple', $1, $2, $3)", [appleProvider, alias, relayEmail]);
    await auth.query("SELECT auth.store_apple_credential($1, $2, 'com.example.session-fence', $3)", [alias, appleProvider, credential]);
    assert.equal((await owner.query("SELECT 1 FROM org.user_settings WHERE user_id = ANY($1::text[])", [subjects])).rowCount, 0);
    await owner.query("INSERT INTO org.user_settings(user_id) VALUES ($1)", [accountId]);
    await owner.query("SELECT auth.bind_cognito_account($1, $2)", [subject, accountId]);
    await owner.query("SELECT auth.bind_cognito_account($1, $2)", [alias, accountId]);

    // These are internal storage capabilities, not fabricated JWTs or provider proofs.
    assert.equal((await backend.query(statusSql, [subject, null])).rows[0].status, "valid");
    await assertVerifiedPrincipalSession({ sub: subject });
    await assertVerifiedPrincipalSession({ sub: subject, auth_time: "legacy-missing-original-time" });
    await assert.rejects(backend.query(invalidateSql, [subject, operation]), { code: "42501" });
    await assert.rejects(backend.query(claimSql), { code: "42501" });
    await assert.rejects(auth.query("SELECT * FROM auth.principal_session_fences"), { code: "42501" });
    await assert.rejects(backend.query("SELECT * FROM auth.principal_session_fences"), { code: "42501" });
    await assert.rejects(auth.query("INSERT INTO auth.apple_session_revocation_jobs(provider_subject_sha256,cognito_subject) VALUES ($1,$2)", [digest(operation), subject]), { code: "42501" });
    await assert.rejects(auth.query(invalidateSql, [subject, null]), { code: "23514" });

    await auth.query("BEGIN");
    await auth.query(invalidateSql, [subject, operation]);
    await contender.query("SET lock_timeout = '200ms'");
    await assert.rejects(contender.query(statusSql, [subject, oldAuthTime]), { code: "55P03" });
    await auth.query("ROLLBACK");
    await contender.query("SET lock_timeout = '2s'");
    assert.equal((await backend.query(statusSql, [subject, oldAuthTime])).rows[0].status, "valid");
    assert.equal((await owner.query(fenceSql, [sessionHash])).rowCount, 0);

    await backend.query("BEGIN");
    await backend.query("SELECT auth.lock_account_lifecycle($1)", [accountId]);
    await contender.query("SET lock_timeout = '200ms'");
    await assert.rejects(contender.query(invalidateSql, [subject, operation]), { code: "55P03" });
    await backend.query("ROLLBACK");
    await contender.query("SET lock_timeout = '2s'");
    await auth.query(invalidateSql, [subject, operation]);
    const firstFence = (await owner.query(fenceSql, [sessionHash])).rows[0].minimum_auth_time;
    await auth.query(invalidateSql, [subject, operation]);
    assert.equal((await owner.query(fenceSql, [sessionHash])).rows[0].minimum_auth_time, firstFence);
    await assert.rejects(auth.query(invalidateSql, [alias, operation]), { code: "23505" });
    assert.equal((await owner.query("SELECT 1 FROM auth.apple_session_revocation_jobs WHERE subject_sha256 = $1", [sessionHash])).rowCount, 1);
    assert.equal((await backend.query(statusSql, [subject, oldAuthTime])).rows[0].status, "pending");
    await assert.rejects(assertVerifiedPrincipalSession({ sub: subject, auth_time: Math.floor(Date.now() / 1_000) }), { code: "PRINCIPAL_SIGNOUT_PENDING" });
    await assert.rejects(assertVerifiedAccountDeletionSession({ sub: subject, auth_time: oldAuthTime }), { code: "PRINCIPAL_SIGNOUT_PENDING" });
    await assert.rejects(assertAccountLiveSession(accountId, oldAuthTime), { code: "PRINCIPAL_SIGNOUT_PENDING" });
    // Other Cognito principals keep their session policy, even when linked to the same account.
    await assertVerifiedPrincipalSession({ sub: alias, auth_time: oldAuthTime });
    await assertVerifiedPrincipalSession({ sub: unrelated, auth_time: oldAuthTime });
    await assert.rejects(auth.query("SELECT auth.account_live_session_status($1,$2)", [accountId, oldAuthTime]), { code: "42501" });

    const race = await Promise.all([auth.query(claimSql), contender.query(claimSql)]);
    assert.equal(race.reduce((total, result) => total + result.rowCount!, 0), 1);
    const job = race.flatMap((result) => result.rows)[0];
    assert.equal(job.cognito_subject, subject);
    await assert.rejects(auth.query(completeSql, [job.job_id, null]), { code: "55006" });
    await assert.rejects(auth.query(completeSql, [job.job_id, randomUUID()]), { code: "55006" });
    await owner.query("UPDATE auth.apple_session_revocation_jobs SET lease_until = clock_timestamp() - INTERVAL '1 second' WHERE job_id = $1", [job.job_id]);
    const reclaimed = (await contender.query(claimSql)).rows[0];
    assert.notEqual(reclaimed.lease_id, job.lease_id);
    await assert.rejects(auth.query(completeSql, [job.job_id, job.lease_id]), { code: "55006" });
    await contender.query("SELECT auth.retry_apple_session_revocation($1, $2)", [reclaimed.job_id, reclaimed.lease_id]);
    assert.equal((await auth.query(claimSql)).rowCount, 0);
    await owner.query("UPDATE auth.apple_session_revocation_jobs SET available_at = clock_timestamp() WHERE job_id = $1", [job.job_id]);
    const retry = (await auth.query(claimSql)).rows[0];
    await auth.query(completeSql, [retry.job_id, retry.lease_id]);
    const minimumTime = Number((await owner.query(fenceSql, [sessionHash])).rows[0].minimum_auth_time);
    assert.ok(minimumTime >= Number(firstFence));
    assert.equal((await owner.query("SELECT cognito_subject FROM auth.apple_session_revocation_jobs WHERE job_id = $1", [job.job_id])).rows[0].cognito_subject, null);
    await assert.rejects(auth.query(completeSql, [retry.job_id, retry.lease_id]), { code: "55006" });
    await auth.query(invalidateSql, [subject, operation]);
    assert.equal((await auth.query(claimSql)).rowCount, 0);
    assert.equal(Number((await owner.query(fenceSql, [sessionHash])).rows[0].minimum_auth_time), minimumTime);

    // A refresh may issue a new JWT now; only its original auth_time is passed to the fence.
    const refreshedSession = { sub: subject, auth_time: oldAuthTime, iat: Math.floor(Date.now() / 1_000) };
    await assert.rejects(assertVerifiedPrincipalSession(refreshedSession), { code: "SESSION_REVOKED" });
    assert.equal((await backend.query(statusSql, [subject, oldAuthTime])).rows[0].status, "revoked");
    await assert.rejects(assertVerifiedPrincipalSession({ sub: subject, auth_time: oldAuthTime }), { code: "SESSION_REVOKED" });
    await assert.rejects(assertVerifiedPrincipalSession({ sub: subject }), { code: "SESSION_REVOKED" });
    await assert.rejects(assertVerifiedPrincipalSession({ sub: subject, auth_time: "invalid" }), { code: "SESSION_REVOKED" });
    await assert.rejects(assertVerifiedPrincipalSession({ sub: subject, auth_time: Math.floor(Date.now() / 1_000) + 60 }), { code: "SESSION_REVOKED" });
    await assert.rejects(assertVerifiedAccountDeletionSession({ sub: subject, auth_time: oldAuthTime }), { code: "SESSION_REVOKED" });
    await assertVerifiedPrincipalSession({ sub: subject, auth_time: minimumTime });
    await assertAccountLiveSession(accountId, minimumTime);
    await assert.rejects(assertAccountLiveSession(accountId, oldAuthTime), { code: "SESSION_REVOKED" });
    assert.equal((await auth.query("SELECT * FROM auth.load_provider_login_method('google', $1)", [googleProvider])).rows[0].status, "active");
    assert.equal((await auth.query("SELECT email FROM auth.verified_login_emails WHERE cognito_subject = $1", [subject])).rows[0].email, email);

    // Existing Apple notification and credential queues stage the same principal fence atomically.
    const notification = [notificationHash, digest(notificationHash), appleProvider, "consent-revoked", new Date(), null];
    await auth.query("SELECT auth.apply_apple_notification($1,$2,$3,$4,$5,$6)", notification);
    assert.equal((await backend.query(statusSql, [alias, oldAuthTime])).rows[0].status, "pending");
    const apple = (await auth.query(claimSql)).rows[0];
    assert.equal(apple.cognito_subject, alias);
    await auth.query(completeSql, [apple.job_id, apple.lease_id]);
    const appleFence = (await owner.query(fenceSql, [digest(alias)])).rows[0].minimum_auth_time;
    await auth.query("SELECT auth.apply_apple_notification($1,$2,$3,$4,$5,$6)", notification);
    await auth.query("SELECT auth.stage_apple_method_revocation($1,$2)", [alias, appleProvider]);
    assert.equal((await auth.query(claimSql)).rowCount, 0);
    assert.equal((await owner.query(fenceSql, [digest(alias)])).rows[0].minimum_auth_time, appleFence);
    assert.equal((await auth.query("SELECT * FROM auth.load_apple_credentials($1)", [alias])).rows[0].ciphertext, credential);
    assert.equal((await owner.query("SELECT 1 FROM auth.apple_revocation_jobs WHERE provider_subject = $1", [appleProvider])).rowCount, 1);

    // A separate action has its own durable signout; all pending actions must finish before login.
    await auth.query(invalidateSql, [subject, secondOperation]);
    await auth.query("BEGIN");
    const active = (await auth.query(claimSql)).rows[0];
    assert.equal(active.cognito_subject, subject);
    await auth.query("ROLLBACK");
    // Model the existing backend deletion transaction, including old-code rollout behavior.
    await backend.query("BEGIN");
    await backend.query("SELECT pg_advisory_xact_lock(hashtextextended('auth.cognito_identity:' || $1,2::bigint))", [subject]);
    await backend.query("SELECT auth.lock_account_lifecycle($1)", [accountId]);
    for (const principal of [subject, alias]) {
      await backend.query("INSERT INTO auth.deleted_subjects(subject_sha256,deletion_id) VALUES ($1,$2)", [digest(principal), deletionId]);
      await backend.query("INSERT INTO auth.cognito_deletion_jobs(deletion_id,cognito_subject) VALUES ($1,$2)", [deletionId, principal]);
    }
    await backend.query("DELETE FROM auth.cognito_principals WHERE cognito_subject = ANY($1::text[])", [[subject, alias]]);
    await backend.query("INSERT INTO auth.deleted_accounts(user_id_sha256) VALUES ($1)", [digest(accountId)]);
    await backend.query("COMMIT");
    await assert.rejects(assertVerifiedPrincipalSession({ sub: subject, auth_time: minimumTime }), { code: "ACCOUNT_DELETED" });
    await assertVerifiedAccountDeletionSession({ sub: subject, auth_time: oldAuthTime });
    await assert.rejects(assertAccountLiveSession(accountId, minimumTime), { code: "ACCOUNT_DELETED" });
    await assert.rejects(auth.query(invalidateSql, [subject, randomUUID()]), { code: "23514" });
    const afterDelete = (await auth.query(claimSql)).rows[0];
    assert.equal(afterDelete.cognito_subject, subject);
    await auth.query(completeSql, [afterDelete.job_id, afterDelete.lease_id]);
    assert.equal((await backend.query(statusSql, [subject, minimumTime])).rows[0].status, "deleted");
    assert.equal((await owner.query("SELECT 1 FROM auth.cognito_deletion_jobs WHERE deletion_id = $1", [deletionId])).rowCount, 2);
  } finally {
    await Promise.all([auth.end(), contender.end(), backend.end()]);
    try {
      await owner.query("DELETE FROM auth.apple_revocation_jobs WHERE provider_subject = $1", [appleProvider]);
      await owner.query("DELETE FROM auth.apple_revocation_credentials WHERE cognito_subject = ANY($1::text[])", [subjects]);
      await owner.query("DELETE FROM auth.cognito_principals WHERE cognito_subject = ANY($1::text[])", [subjects]);
      await owner.query("DELETE FROM auth.apple_session_revocation_jobs WHERE subject_sha256 = ANY($1::text[])", [subjects.map(digest)]);
      await owner.query("DELETE FROM auth.principal_session_fences WHERE subject_sha256 = ANY($1::text[])", [subjects.map(digest)]);
      await owner.query("DELETE FROM auth.apple_notification_receipts WHERE notification_sha256 = $1", [notificationHash]);
      await owner.query("DELETE FROM auth.cognito_deletion_jobs WHERE deletion_id = $1", [deletionId]);
      await owner.query("DELETE FROM org.user_settings WHERE user_id = $1", [accountId]);
      await owner.query("DELETE FROM auth.deleted_subjects WHERE subject_sha256 = ANY($1::text[])", [subjects.map(digest)]);
      await owner.query("DELETE FROM auth.deleted_accounts WHERE user_id_sha256 = $1", [digest(accountId)]);
    } finally {
      await owner.end();
    }
  }
});
