import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";
import { ensureCognitoUserProfile, ensureUserProfile } from "./ensureUser";
import { unsafeTransaction } from "../database/unsafe";
import { linkProvedCognitoPrincipalInExecutor } from "./userIdentities";
import { deleteAccountForAuthenticatedUser, deleteAccountConfirmationText } from "./accountDeletion";
import { hashDeletedSubject } from "./deletedSubjects";

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function credentialEnvelope(): string {
  return `v1.${randomBytes(12).toString("base64url")}.${randomBytes(16).toString("base64url")}.${randomBytes(64).toString("base64url")}`;
}

test("Apple lifecycle fences leased cleanup, survives alias erasure and orders notification effects", async () => {
  const ownerUrl = process.env.TEST_DATABASE_ADMIN_URL;
  if (ownerUrl === undefined) throw new Error("TEST_DATABASE_ADMIN_URL is required");
  const owner = new pg.Pool({ connectionString: ownerUrl });
  const auth = new pg.Client({ connectionString: ownerUrl });
  const contender = new pg.Client({ connectionString: ownerUrl });
  const backend = new pg.Client({ connectionString: ownerUrl });
  const subjects = [randomUUID(), randomUUID()];
  const providers = [`apple-${randomUUID()}`, `apple-${randomUUID()}`];
  const emails = [`${randomUUID()}@privaterelay.appleid.com`, `${randomUUID()}@private.icloud.com`];
  const accountId = randomUUID();
  const deletionId = randomUUID();
  const clientId = "com.example.apple-lifecycle";
  const envelopes = [credentialEnvelope(), credentialEnvelope()];
  const receiptIds: Array<string> = [];
  const store = "SELECT auth.store_apple_credential($1, $2, $3, $4)";
  const pending = "SELECT auth.apple_revocation_pending($1) AS pending";
  const stage = "SELECT auth.stage_apple_method_revocation($1, $2) AS queued";
  const claim = "SELECT * FROM auth.claim_apple_revocation()";
  const complete = "SELECT auth.complete_apple_revocation($1, $2, $3)";
  const delivery = "SELECT auth.apple_relay_delivery_allowed($1) AS allowed";
  const notify = "SELECT auth.apply_apple_notification($1, $2, $3, $4, $5, $6) AS outcome";
  let eventAt = new Date();
  // Internal SQL capability coverage; these fixtures do not attest Apple proofs or real token revocation.
  async function applyNotification(type: string, when: Date, email: string | null): Promise<string> {
    const receipt = digest(randomUUID());
    receiptIds.push(receipt);
    return (await auth.query(notify, [receipt, digest(receipt), providers[1], type, when, email])).rows[0].outcome;
  }
  try {
    await auth.connect();
    await auth.query("SET ROLE auth_app");
    await contender.connect();
    await contender.query("SET ROLE auth_app");
    await backend.connect();
    await backend.query("SET ROLE backend_app");
    for (let index = 0; index < subjects.length; index += 1) {
      await auth.query("SELECT auth.enroll_proved_email_principal($1, $2, $3, $4)", [subjects[index], subjects[index], emails[index], eventAt]);
      await auth.query("SELECT auth.activate_proved_provider_method('apple', $1, $2, $3)", [providers[index], subjects[index], emails[index]]);
      await auth.query(store, [subjects[index], providers[index], clientId, envelopes[index]]);
    }
    assert.equal((await owner.query("SELECT 1 FROM org.user_settings WHERE user_id = ANY($1::text[])", [subjects])).rowCount, 0);
    await owner.query("INSERT INTO org.user_settings(user_id) VALUES ($1)", [accountId]);
    for (const subject of subjects) await owner.query("SELECT auth.bind_cognito_account($1, $2)", [subject, accountId]);
    await assert.rejects(backend.query("SELECT * FROM auth.apple_revocation_credentials"), { code: "42501" });
    await assert.rejects(backend.query(claim), { code: "42501" });
    await assert.rejects(backend.query("SELECT * FROM auth.claim_apple_session_revocation()"), { code: "42501" });
    await assert.rejects(auth.query("SELECT * FROM auth.apple_revocation_jobs"), { code: "42501" });
    await assert.rejects(auth.query("SELECT auth.queue_apple_revocation($1, 'unlink')", [providers[0]]), { code: "42501" });
    await assert.rejects(auth.query("SELECT auth.delete_apple_credential($1, $2, $3)", [providers[0], clientId, envelopes[0]]), { code: "42501" });
    await assert.rejects(auth.query(stage, [subjects[1], providers[0]]), { code: "23514" });

    await auth.query("BEGIN");
    await auth.query(stage, [subjects[0], providers[0]]);
    assert.equal((await auth.query(pending, [providers[0]])).rows[0].pending, true);
    await contender.query("SET lock_timeout = '200ms'");
    await assert.rejects(contender.query(store, [subjects[0], providers[0], clientId, credentialEnvelope()]), { code: "55P03" });
    await auth.query("ROLLBACK");
    await contender.query("SET lock_timeout = '2s'");
    assert.equal((await auth.query(pending, [providers[0]])).rows[0].pending, false);
    assert.equal((await auth.query("SELECT status FROM auth.load_provider_login_method('apple', $1)", [providers[0]])).rows[0].status, "active");

    assert.equal((await auth.query(stage, [subjects[0], providers[0]])).rows[0].queued, 1);
    await assert.rejects(auth.query(store, [subjects[0], providers[0], "com.example.other", credentialEnvelope()]), { code: "55006" });
    const raced = await Promise.all([auth.query(claim), contender.query(claim)]);
    assert.equal(raced.reduce((count, result) => count + result.rowCount!, 0), 1);
    const job = raced.flatMap((result) => result.rows)[0];
    assert.equal(job.ciphertext, envelopes[0]);
    await assert.rejects(auth.query(complete, [job.job_id, null, job.ciphertext]), { code: "55006" });
    await assert.rejects(auth.query(complete, [job.job_id, randomUUID(), job.ciphertext]), { code: "55006" });
    await owner.query("UPDATE auth.apple_revocation_jobs SET lease_until = pg_catalog.now() - INTERVAL '1 second' WHERE job_id = $1", [job.job_id]);
    const reclaimed = (await contender.query(claim)).rows[0];
    assert.notEqual(reclaimed.lease_id, job.lease_id);
    await assert.rejects(auth.query(complete, [job.job_id, job.lease_id, job.ciphertext]), { code: "55006" });
    await contender.query("SELECT auth.retry_apple_revocation($1, $2, 'PROVIDER_TEMPORARILY_UNAVAILABLE')", [job.job_id, reclaimed.lease_id]);
    assert.equal((await auth.query(claim)).rowCount, 0);
    assert.equal((await owner.query("SELECT last_error_code FROM auth.apple_revocation_jobs WHERE job_id = $1", [job.job_id])).rows[0].last_error_code, "PROVIDER_TEMPORARILY_UNAVAILABLE");
    await owner.query("UPDATE auth.apple_revocation_jobs SET available_at = pg_catalog.now() WHERE job_id = $1", [job.job_id]);
    const retry = (await auth.query(claim)).rows[0];
    await assert.rejects(auth.query(complete, [retry.job_id, retry.lease_id, credentialEnvelope()]), { code: "23514" });
    await auth.query(complete, [retry.job_id, retry.lease_id, retry.ciphertext]);
    assert.equal((await auth.query("SELECT * FROM auth.load_apple_credentials($1)", [subjects[0]])).rowCount, 0);
    assert.equal((await auth.query(pending, [providers[0]])).rows[0].pending, true);
    const session = (await auth.query("SELECT * FROM auth.claim_apple_session_revocation()")).rows[0];
    assert.equal(session.cognito_subject, subjects[0]);
    await assert.rejects(auth.query("SELECT auth.complete_apple_session_revocation($1, $2)", [session.job_id, randomUUID()]), { code: "55006" });
    await auth.query("SELECT auth.retry_apple_session_revocation($1, $2)", [session.job_id, session.lease_id]);
    assert.equal((await auth.query("SELECT * FROM auth.claim_apple_session_revocation()")).rowCount, 0);
    await owner.query("UPDATE auth.apple_session_revocation_jobs SET available_at = pg_catalog.now() WHERE job_id = $1", [session.job_id]);
    const sessionRetry = (await auth.query("SELECT * FROM auth.claim_apple_session_revocation()")).rows[0];
    await auth.query("SELECT auth.complete_apple_session_revocation($1, $2)", [sessionRetry.job_id, sessionRetry.lease_id]);
    assert.equal((await auth.query(pending, [providers[0]])).rows[0].pending, false);
    await auth.query(stage, [subjects[0], providers[0]]);
    assert.equal((await auth.query("SELECT * FROM auth.claim_apple_session_revocation()")).rowCount, 0);
    assert.equal((await owner.query("SELECT cognito_subject FROM auth.apple_session_revocation_jobs WHERE job_id = $1", [session.job_id])).rows[0].cognito_subject, null);

    // Only an explicitly authorized later method-management flow may enable a disabled method.
    await owner.query("UPDATE auth.provider_login_methods SET status = 'active', disabled_at = NULL WHERE provider_type = 'apple' AND provider_subject = $1", [providers[0]]);
    await auth.query(store, [subjects[0], providers[0], clientId, envelopes[0]]);
    assert.equal((await owner.query("SELECT 1 FROM auth.apple_session_revocation_jobs WHERE job_id = $1", [session.job_id])).rowCount, 0);

    eventAt = new Date();
    const older = new Date(eventAt.getTime() - 1_000);
    assert.equal(await applyNotification("email-disabled", eventAt, emails[1]), "applied");
    assert.equal((await auth.query(delivery, [emails[1]])).rows[0].allowed, false);
    assert.equal(await applyNotification("email-enabled", older, emails[1]), "ignored_stale");
    assert.equal((await auth.query(delivery, [emails[1]])).rows[0].allowed, false);
    const newer = new Date(eventAt.getTime() + 1_000);
    assert.equal(await applyNotification("email-enabled", newer, emails[1]), "applied");
    assert.equal((await auth.query(delivery, [emails[1]])).rows[0].allowed, true);
    assert.equal(await applyNotification("email-disabled", newer, emails[1]), "applied");
    assert.equal((await auth.query(delivery, [emails[1]])).rows[0].allowed, false);
    assert.equal((await auth.query("SELECT count(*)::int AS count FROM auth.verified_login_emails WHERE cognito_subject = $1", [subjects[1]])).rows[0].count, 1);

    assert.equal(await applyNotification("consent-revoked", new Date(eventAt.getTime() - 60_000), null), "ignored_stale");
    const receipt = digest(randomUUID());
    receiptIds.push(receipt);
    const params = [receipt, digest(receipt), providers[1], "consent-revoked", newer, null];
    const deliveries = await Promise.all([auth.query(notify, params), contender.query(notify, params)]);
    assert.deepEqual(deliveries.map((result) => result.rows[0].outcome), ["applied", "applied"]);
    assert.equal((await owner.query("SELECT count(*)::int AS count FROM auth.apple_revocation_jobs WHERE provider_subject = $1", [providers[1]])).rows[0].count, 1);
    await assert.rejects(auth.query(notify, [receipt, digest("different"), providers[1], "consent-revoked", newer, null]), { code: "23505" });
    assert.equal(await applyNotification("account-deleted", newer, null), "applied");
    assert.equal((await owner.query("SELECT 1 FROM org.user_settings WHERE user_id = $1", [accountId])).rowCount, 1);

    await backend.query("BEGIN");
    await backend.query("SELECT auth.lock_account_lifecycle($1)", [accountId]);
    for (const subject of subjects) {
      await backend.query("INSERT INTO auth.deleted_subjects(subject_sha256, deletion_id) VALUES ($1, $2)", [digest(subject), deletionId]);
      await backend.query("INSERT INTO auth.cognito_deletion_jobs(deletion_id, cognito_subject) VALUES ($1, $2)", [deletionId, subject]);
    }
    await backend.query("SELECT auth.stage_deleted_apple_revocations($1)", [deletionId]);
    await backend.query("DELETE FROM auth.cognito_principals WHERE cognito_subject = ANY($1::text[])", [subjects]);
    await backend.query("COMMIT");
    assert.equal((await owner.query("SELECT 1 FROM auth.provider_identities WHERE provider_subject = ANY($1::text[])", [providers])).rowCount, 0);
    assert.equal((await owner.query("SELECT 1 FROM auth.apple_revocation_jobs WHERE provider_subject = ANY($1::text[])", [providers])).rowCount, 2);
    assert.equal((await owner.query("SELECT 1 FROM auth.apple_revocation_credentials WHERE cognito_subject = ANY($1::text[])", [subjects])).rowCount, 2);
    const afterDeletion = (await auth.query(claim)).rows[0];
    assert.ok(afterDeletion);
    await auth.query(complete, [afterDeletion.job_id, afterDeletion.lease_id, afterDeletion.ciphertext]);
    assert.equal((await owner.query("SELECT 1 FROM auth.cognito_deletion_jobs WHERE deletion_id = $1", [deletionId])).rowCount, 2);
    await assert.rejects(auth.query(store, [subjects[0], providers[0], clientId, envelopes[0]]), { code: "23514" });
  } finally {
    await Promise.all([auth.end(), contender.end(), backend.end()]);
    try {
      await owner.query("DELETE FROM auth.apple_revocation_jobs WHERE provider_subject = ANY($1::text[])", [providers]);
      await owner.query("DELETE FROM auth.apple_session_revocation_jobs WHERE provider_subject_sha256 = ANY($1::text[])", [providers.map(digest)]);
      await owner.query("DELETE FROM auth.apple_revocation_credentials WHERE cognito_subject = ANY($1::text[])", [subjects]);
      await owner.query("DELETE FROM auth.apple_notification_receipts WHERE notification_sha256 = ANY($1::text[])", [receiptIds]);
      await owner.query("DELETE FROM auth.apple_relay_delivery WHERE email_sha256 = ANY($1::text[])", [emails.map(digest)]);
      await owner.query("DELETE FROM auth.cognito_deletion_jobs WHERE deletion_id = $1", [deletionId]);
      await owner.query("DELETE FROM auth.cognito_principals WHERE cognito_subject = ANY($1::text[])", [subjects]);
      await owner.query("DELETE FROM org.user_settings WHERE user_id = $1", [accountId]);
      await owner.query("DELETE FROM auth.deleted_subjects WHERE subject_sha256 = ANY($1::text[])", [subjects.map(digest)]);
    } finally {
      await owner.end();
    }
  }
});

test("old backend deletion after migration stages retained Apple credentials atomically", async () => {
  const ownerUrl = process.env.TEST_DATABASE_ADMIN_URL;
  if (ownerUrl === undefined) throw new Error("TEST_DATABASE_ADMIN_URL is required");
  const owner = new pg.Pool({ connectionString: ownerUrl });
  const auth = new pg.Client({ connectionString: ownerUrl });
  const backend = new pg.Client({ connectionString: ownerUrl });
  const subject = randomUUID();
  const provider = `apple-${randomUUID()}`;
  const email = `${randomUUID()}@privaterelay.appleid.com`;
  const accountId = randomUUID();
  const deletionId = randomUUID();
  const clientIds = ["com.example.apple-rollout", "com.example.apple-rollout.web"];
  const envelopes = [credentialEnvelope(), credentialEnvelope()];
  try {
    await auth.connect();
    await auth.query("SET ROLE auth_app");
    await backend.connect();
    await backend.query("SET ROLE backend_app");
    // This principal and its credentials are created after the migration's one-time orphan scan.
    await auth.query("SELECT auth.enroll_proved_email_principal($1, $2, $3, $4)", [subject, subject, email, new Date()]);
    await auth.query("SELECT auth.activate_proved_provider_method('apple', $1, $2, $3)", [provider, subject, email]);
    for (let index = 0; index < clientIds.length; index += 1) {
      await auth.query("SELECT auth.store_apple_credential($1, $2, $3, $4)", [subject, provider, clientIds[index], envelopes[index]]);
    }
    await owner.query("INSERT INTO org.user_settings(user_id) VALUES ($1)", [accountId]);
    await owner.query("SELECT auth.bind_cognito_account($1, $2)", [subject, accountId]);
    assert.equal((await auth.query("SELECT auth.apple_revocation_pending($1) AS pending", [provider])).rows[0].pending, false);

    await backend.query("BEGIN");
    await backend.query("SELECT auth.lock_account_lifecycle($1)", [accountId]);
    await backend.query("DELETE FROM auth.cognito_principals WHERE cognito_subject = $1", [subject]);
    await backend.query("ROLLBACK");
    assert.equal((await auth.query("SELECT auth.apple_revocation_pending($1) AS pending", [provider])).rows[0].pending, false);
    assert.equal((await owner.query("SELECT 1 FROM auth.cognito_principals WHERE cognito_subject = $1", [subject])).rowCount, 1);

    // The deployed backend persists deletion inventory and erases principals without the new staging call.
    await backend.query("BEGIN");
    await backend.query("SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('auth.cognito_identity:' || $1, 2::bigint))", [subject]);
    await backend.query("SELECT auth.lock_account_lifecycle($1)", [accountId]);
    await backend.query("SELECT pg_catalog.set_config('app.user_id', $1, true)", [accountId]);
    await backend.query("INSERT INTO auth.deleted_subjects(subject_sha256, deletion_id) VALUES ($1, $2)", [digest(subject), deletionId]);
    await backend.query("INSERT INTO auth.cognito_deletion_jobs(deletion_id, cognito_subject) VALUES ($1, $2)", [deletionId, subject]);
    await backend.query("DELETE FROM auth.cognito_principals WHERE cognito_subject = $1", [subject]);
    assert.equal((await backend.query("DELETE FROM org.user_settings WHERE user_id = $1", [accountId])).rowCount, 1);
    await backend.query("COMMIT");
    assert.equal((await owner.query("SELECT 1 FROM auth.provider_identities WHERE provider_subject = $1", [provider])).rowCount, 0);
    const jobs = await owner.query("SELECT client_id, reason FROM auth.apple_revocation_jobs WHERE provider_subject = $1 ORDER BY client_id", [provider]);
    assert.deepEqual(jobs.rows, clientIds.map((clientId) => ({ client_id: clientId, reason: "account_deleted" })));
    for (let index = 0; index < clientIds.length; index += 1) {
      const job = (await auth.query("SELECT * FROM auth.claim_apple_revocation()")).rows[0];
      assert.equal(job.provider_subject, provider);
      assert.equal(job.ciphertext, envelopes[clientIds.indexOf(job.client_id)]);
      await auth.query("SELECT auth.complete_apple_revocation($1, $2, $3)", [job.job_id, job.lease_id, job.ciphertext]);
    }
    const session = (await auth.query("SELECT * FROM auth.claim_apple_session_revocation()")).rows[0];
    assert.equal(session.cognito_subject, subject);
    await auth.query("SELECT auth.complete_apple_session_revocation($1, $2)", [session.job_id, session.lease_id]);
    assert.equal((await auth.query("SELECT auth.apple_revocation_pending($1) AS pending", [provider])).rows[0].pending, false);
    assert.equal((await owner.query("SELECT 1 FROM auth.apple_revocation_credentials WHERE cognito_subject = $1", [subject])).rowCount, 0);
  } finally {
    await Promise.all([auth.end(), backend.end()]);
    try {
      await owner.query("DELETE FROM auth.apple_revocation_credentials WHERE cognito_subject = $1", [subject]);
      await owner.query("DELETE FROM auth.cognito_principals WHERE cognito_subject = $1", [subject]);
      await owner.query("DELETE FROM auth.apple_revocation_jobs WHERE provider_subject = $1", [provider]);
      await owner.query("DELETE FROM auth.apple_session_revocation_jobs WHERE provider_subject_sha256 = $1", [digest(provider)]);
      await owner.query("DELETE FROM org.user_settings WHERE user_id = $1", [accountId]);
      await owner.query("DELETE FROM auth.cognito_deletion_jobs WHERE deletion_id = $1", [deletionId]);
      await owner.query("DELETE FROM auth.deleted_subjects WHERE subject_sha256 = $1", [digest(subject)]);
    } finally {
      await owner.end();
    }
  }
});

test("proved principals stay unprovisioned until bootstrap, share an immutable account, and delete/retry together", async () => {
  const ownerUrl = process.env.TEST_DATABASE_ADMIN_URL;
  if (ownerUrl === undefined) throw new Error("TEST_DATABASE_ADMIN_URL is required");
  const ownerPool = new pg.Pool({ connectionString: ownerUrl });
  const countUserSettingsRows = async (pool: pg.Pool, userIds: ReadonlyArray<string>): Promise<number> =>
    (await pool.query("SELECT user_id FROM org.user_settings WHERE user_id = ANY($1::text[])", [[...userIds]])).rows.length;
  const readMappedUserIds = async (pool: pg.Pool, subject: string): Promise<ReadonlyArray<string>> => {
    const result = await pool.query<Readonly<{ user_id: string }>>(
      "SELECT user_id FROM auth.user_identities WHERE provider_type = 'cognito' AND provider_subject = $1", [subject],
    );
    return result.rows.map((row) => row.user_id);
  };
  const removeAccounts = async (pool: pg.Pool, userIds: ReadonlyArray<string>, workspaceIds: ReadonlyArray<string>): Promise<void> => {
    await pool.query("DELETE FROM org.workspaces WHERE workspace_id = ANY($1::uuid[])", [[...workspaceIds]]);
    await pool.query("DELETE FROM org.user_settings WHERE user_id = ANY($1::text[])", [[...userIds]]);
  };
  const primary = randomUUID();
  const alias = randomUUID();
  const outsider = randomUUID();
  const subjects = [primary, alias, outsider];
  const userIds: Array<string> = [];
  const workspaceIds: Array<string> = [];
  const email = `identity-lifecycle-${randomUUID()}@example.com`;
  try {
    const authClient = await ownerPool.connect();
    try {
      await authClient.query("BEGIN");
      await authClient.query("SET LOCAL ROLE auth_app");
      for (const subject of subjects) {
        await authClient.query("SELECT auth.register_cognito_principal($1, $2)", [subject, subject]);
      }
      await authClient.query("SELECT auth.bind_provider_identity('apple', $1, $2)", [primary, primary]);
      await authClient.query("SELECT auth.record_verified_login_email($1, $2, now())", [alias, email]);
      await authClient.query("COMMIT");
    } catch (error) {
      await authClient.query("ROLLBACK");
      throw error;
    } finally {
      authClient.release();
    }
    assert.equal(await countUserSettingsRows(ownerPool, subjects), 0);
    assert.deepEqual(await readMappedUserIds(ownerPool, primary), []);
    const account = await ensureCognitoUserProfile(primary, email);
    const other = await ensureCognitoUserProfile(outsider, email);
    userIds.push(account.userId, other.userId);
    for (const profile of [account, other]) {
      if (profile.selectedWorkspaceId !== null) workspaceIds.push(profile.selectedWorkspaceId);
    }
    assert.notEqual(other.userId, account.userId);
    await unsafeTransaction(async (executor) => {
      const linked = await linkProvedCognitoPrincipalInExecutor(executor, primary, alias);
      assert.equal(linked.userId, account.userId);
    });
    assert.equal((await ensureCognitoUserProfile(alias, email)).userId, account.userId);
    await assert.rejects(unsafeTransaction(async (executor) => {
      await linkProvedCognitoPrincipalInExecutor(executor, primary, outsider);
    }), { code: "23505" });
    await assert.rejects(unsafeTransaction(async (executor) => {
      await executor.query("SELECT auth.bind_provider_identity('apple', $1, $2)", [primary, outsider]);
    }), { code: "23505" });
    assert.deepEqual(await readMappedUserIds(ownerPool, outsider), [other.userId]);

    let failCleanup = true;
    const cleanedSubjects: Array<string> = [];
    const dependencies = {
      unsafeTransaction,
      isConfiguredDemoEmail: () => false,
      deleteCognitoUser: async (subject: string): Promise<void> => {
        if (failCleanup) throw new Error("Simulated unavailable Cognito cleanup transport");
        cleanedSubjects.push(subject);
      },
    };
    const deletion = {
      authSubjectUserId: primary, email, cognitoUsername: primary,
      confirmationText: deleteAccountConfirmationText,
    };
    const [provisioning, deleting] = await Promise.allSettled([
      ensureCognitoUserProfile(alias, email),
      deleteAccountForAuthenticatedUser(deletion, dependencies),
    ]);
    if (provisioning.status === "fulfilled") assert.equal(provisioning.value.userId, account.userId);
    else assert.equal((provisioning.reason as Error & { code: string }).code, "ACCOUNT_DELETED");
    assert.equal(deleting.status, "rejected");
    if (deleting.status === "rejected") assert.equal(deleting.reason.code, "ACCOUNT_DELETE_IDENTITY_DELETE_FAILED");
    assert.equal(await countUserSettingsRows(ownerPool, [account.userId]), 0);
    for (const subject of [primary, alias]) {
      await assert.rejects(ensureCognitoUserProfile(subject, email), { code: "ACCOUNT_DELETED" });
    }
    await assert.rejects(ensureUserProfile(account.userId, email), { code: "23514" });
    const bindings = await ownerPool.query(
      "SELECT cognito_subject FROM auth.provider_identities WHERE cognito_subject = ANY($1::text[]) UNION ALL SELECT cognito_subject FROM auth.verified_login_emails WHERE cognito_subject = ANY($1::text[])", [[primary, alias]],
    );
    assert.equal(bindings.rowCount, 0);
    failCleanup = false;
    await deleteAccountForAuthenticatedUser({ ...deletion, authSubjectUserId: alias, cognitoUsername: alias }, dependencies);
    assert.deepEqual(cleanedSubjects.sort(), [primary, alias].sort());
    const pending = await ownerPool.query(
      "SELECT 1 FROM auth.cognito_deletion_jobs WHERE deletion_id IN (SELECT deletion_id FROM auth.deleted_subjects WHERE subject_sha256 = ANY($1::text[]))",
      [[primary, alias].map(hashDeletedSubject)],
    );
    assert.equal(pending.rowCount, 0);
  } finally {
    try {
      await removeAccounts(ownerPool, userIds, workspaceIds);
      await ownerPool.query("DELETE FROM auth.apple_session_revocation_jobs WHERE provider_subject_sha256 = ANY($1::text[])", [subjects.map(digest)]);
      await ownerPool.query("DELETE FROM auth.cognito_principals WHERE cognito_subject = ANY($1::text[])", [subjects]);
      await ownerPool.query("DELETE FROM auth.cognito_deletion_jobs WHERE deletion_id IN (SELECT deletion_id FROM auth.deleted_subjects WHERE subject_sha256 = ANY($1::text[]))", [subjects.map(hashDeletedSubject)]);
      await ownerPool.query("DELETE FROM auth.deleted_subjects WHERE subject_sha256 = ANY($1::text[])", [subjects.map(hashDeletedSubject)]);
      await ownerPool.query("DELETE FROM auth.deleted_accounts WHERE user_id_sha256 = ANY($1::text[])", [userIds.map(hashDeletedSubject)]);
    } finally {
      await ownerPool.end();
    }
  }
});
