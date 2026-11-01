import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import pg from "pg";
import { applyUserDatabaseScopeInExecutor, transactionWithUserScope, type DatabaseExecutor } from "../database";
import { loadCognitoIdentityMappingInExecutor } from "./userIdentities";
import { ensureCognitoUserProfile, ensureUserProfile } from "./ensureUser";


function executorFor(client: pg.Client): DatabaseExecutor {
  return { query: (text, params) => client.query(text, [...params]) };
}

const retire = "SELECT auth.record_account_retirement($1, $2, $3)";
const lockRetirement = "SELECT auth.lock_account_retirement($1, $2)";
const subjectLock = "SELECT pg_advisory_xact_lock(hashtextextended('auth.cognito_identity:' || $1::text, 2::bigint))";
const hash = (value: string): string => createHash("sha256").update(value).digest("hex");

test("account retirement fences real scoped writers, flattens receipts and preserves principal session authority", async () => {
  const ownerUrl = process.env.TEST_DATABASE_ADMIN_URL;
  if (ownerUrl === undefined) throw new Error("TEST_DATABASE_ADMIN_URL is required");
  const owner = new pg.Client({ connectionString: ownerUrl });
  const writer = new pg.Client({ connectionString: ownerUrl });
  const auth = new pg.Client({ connectionString: ownerUrl });
  const [source, target, later] = [randomUUID(), randomUUID(), randomUUID()].sort();
  const [subject, otherSubject] = [randomUUID(), randomUUID()];
  const sources = [source, target, later];
  const subjects = [subject, otherSubject];
  const receipts = [randomUUID(), randomUUID()];
  const workspaceIds: Array<string> = [];
  try {
    await Promise.all([owner.connect(), writer.connect(), auth.connect()]);
    await writer.query("SET ROLE backend_app");
    await auth.query("SET ROLE auth_app");
    for (const client of [owner, writer, auth]) await client.query("SET statement_timeout = '3s'");
    for (const account of sources) await owner.query("INSERT INTO org.user_settings(user_id) VALUES ($1)", [account]);
    await owner.query("SELECT auth.bind_cognito_account($1,$2)", [subject, source]);
    await owner.query("SELECT auth.bind_cognito_account($1,$2)", [otherSubject, target]);
    await owner.query("INSERT INTO auth.cognito_principals(cognito_subject,cognito_username) VALUES ($1,$1),($2,$2)", subjects);

    for (const client of [writer, auth]) {
      await assert.rejects(client.query(retire, [source, target, receipts[0]]), { code: "42501" });
      await assert.rejects(client.query(lockRetirement, [source, target]), { code: "42501" });
      await assert.rejects(client.query("INSERT INTO auth.account_retirements VALUES ($1,$2,$3,now())", [source, target, receipts[0]]), { code: "42501" });
    }
    await transactionWithUserScope({ userId: source }, async (executor) => {
      await executor.query("UPDATE org.user_settings SET email = $2 WHERE user_id = $1", [source, "ordinary@mail.test"]);
    });
    assert.equal((await owner.query("SELECT email FROM org.user_settings WHERE user_id = $1", [source])).rows[0].email, "ordinary@mail.test");

    // Two ordinary scopes can still take the pre-existing exclusive account lock in turn.
    await writer.query("BEGIN");
    await applyUserDatabaseScopeInExecutor(executorFor(writer), { userId: source });
    await auth.query("BEGIN");
    await applyUserDatabaseScopeInExecutor(executorFor(auth), { userId: source });
    await writer.query("SELECT auth.lock_account_lifecycle($1)", [source]);
    await writer.query("COMMIT");
    await auth.query("SELECT auth.lock_account_lifecycle($1)", [source]);
    await auth.query("ROLLBACK");

    // A scope can precede a later subject lock (Stripe). Retirement must refuse instead of waiting
    // on its writer fence while it owns the subject that this writer needs.
    await writer.query("BEGIN");
    await applyUserDatabaseScopeInExecutor(executorFor(writer), { userId: source });
    await owner.query("BEGIN");
    await owner.query(subjectLock, [subject]);
    const waitingWriter = writer.query(subjectLock, [subject]);
    await assert.rejects(owner.query(retire, [source, target, receipts[0]]), { code: "P0A01" });
    await owner.query("ROLLBACK");
    await waitingWriter;
    await writer.query("COMMIT");
    assert.equal((await owner.query("SELECT count(*)::int AS count FROM auth.account_retirements WHERE retired_user_id = $1", [source])).rows[0].count, 0);

    // A scope starting after the exclusive fence must also fail without waiting for retirement.
    await owner.query("BEGIN");
    await owner.query(lockRetirement, [source, target]);
    let callbackRan = false;
    await assert.rejects(transactionWithUserScope({ userId: source }, async () => {
      callbackRan = true;
    }), { code: "ACCOUNT_SCOPE_CHANGED", statusCode: 409 });
    assert.equal(callbackRan, false);
    await owner.query("ROLLBACK");

    // Snapshot established before retirement but scope applied afterwards: MVCC cannot hide it.
    await writer.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    await writer.query("SELECT email FROM org.user_settings WHERE user_id = $1", [source]);
    await owner.query(retire, [source, target, receipts[0]]);
    await assert.rejects(applyUserDatabaseScopeInExecutor(executorFor(writer), { userId: source }), { code: "P0A01" });
    await writer.query("ROLLBACK");
    await assert.rejects(transactionWithUserScope({ userId: source }, async (executor) => {
      await executor.query("UPDATE org.user_settings SET email = 'stale@mail.test' WHERE user_id = $1", [source]);
    }), { code: "ACCOUNT_SCOPE_CHANGED", statusCode: 409 });
    assert.equal((await owner.query("SELECT email FROM org.user_settings WHERE user_id = $1", [source])).rows[0].email, "ordinary@mail.test");
    await assert.rejects(owner.query("INSERT INTO org.user_settings(user_id) VALUES ($1) ON CONFLICT DO NOTHING", [source]), { code: "P0A01" });

    // A retained mapping must not let nested enrollment helpers acquire source after target.
    // Hold source as the live-token reader, and observe the principal operation waiting before
    // asking that same reader for target: the reverse order would deadlock here.
    const writerPid = (await writer.query("SELECT pg_backend_pid() AS pid")).rows[0].pid as number;
    const authPid = (await auth.query("SELECT pg_backend_pid() AS pid")).rows[0].pid as number;
    const providerSubject = randomUUID();
    const principalOperations: ReadonlyArray<Readonly<{ sql: string; params: ReadonlyArray<string> }>> = [
      { sql: "SELECT auth.enroll_proved_email_principal($1,$1,$2,clock_timestamp())", params: [subject, "ordinary@mail.test"] },
      { sql: "SELECT auth.activate_proved_provider_method('google',$1,$2,$3)", params: [providerSubject, subject, "ordinary@mail.test"] },
      { sql: "SELECT auth.principal_session_status($1,NULL)", params: [subject] },
    ];
    for (const operation of principalOperations) {
      await writer.query("BEGIN");
      await writer.query("SELECT auth.lock_account_lifecycle($1)", [source]);
      const pending = Promise.allSettled([auth.query(operation.sql, [...operation.params])]);
      try {
        let blocked = false;
        for (let poll = 0; poll < 100; poll += 1) {
          blocked = (await owner.query("SELECT $1::int = ANY(pg_blocking_pids($2::int)) AS blocked", [writerPid, authPid])).rows[0].blocked as boolean;
          if (blocked) break;
          await delay(10);
        }
        assert.equal(blocked, true, operation.sql + " must wait for the original account lock");
        assert.equal((await writer.query("SELECT auth.account_live_session_status($1,NULL) AS status", [source])).rows[0].status, "valid");
      } finally {
        await writer.query("ROLLBACK");
      }
      const [result] = await pending;
      if (result.status === "rejected") throw result.reason;
    }
    assert.equal((await owner.query("SELECT email FROM auth.verified_login_emails WHERE cognito_subject = $1", [subject])).rows[0].email, "ordinary@mail.test");
    assert.equal((await owner.query("SELECT status FROM auth.provider_login_methods WHERE provider_type = 'google' AND provider_subject = $1", [providerSubject])).rows[0].status, "active");

    const mapping = await loadCognitoIdentityMappingInExecutor(executorFor(writer), subject);
    assert.equal(mapping?.userId, target);
    assert.equal(mapping?.originalClientUserId, source);
    const freshProfile = await ensureCognitoUserProfile(subject, "ordinary@mail.test");
    if (freshProfile.selectedWorkspaceId !== null) workspaceIds.push(freshProfile.selectedWorkspaceId);
    assert.equal(freshProfile.userId, target);
    assert.equal(freshProfile.clientAccountIdentity?.originalClientUserId, source);
    assert.equal((await ensureUserProfile(source, null)).userId, target);
    await assert.rejects(owner.query("UPDATE auth.user_identities SET original_client_user_id = $2 WHERE provider_subject = $1", [subject, target]), { code: "23514" });
    await writer.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await applyUserDatabaseScopeInExecutor(executorFor(writer), { userId: target });
    const linkedIds = (await writer.query("SELECT auth.linked_client_account_ids() AS ids")).rows[0].ids;
    assert.deepEqual(linkedIds, [source, target].sort());
    await assert.rejects(writer.query("UPDATE org.user_settings SET email = NULL WHERE user_id = $1", [target]), { code: "25006" });
    await writer.query("ROLLBACK");

    // Existing proofs keep their literal account snapshot and must restart after retirement.
    const attempt = randomUUID();
    await owner.query(`INSERT INTO auth.social_attempts(attempt_sha256,provider_type,client_type,purpose,binding_sha256,
      current_subject,current_account,secret_ciphertext) VALUES ($1,'google','ios','reauth',$2,$3,$4,'storage-fixture')`,
    [hash(attempt), hash(randomUUID()), subject, source]);
    await assert.rejects(auth.query("SELECT auth.assert_social_attempt_live(attempt) FROM auth.social_attempts AS attempt WHERE attempt_sha256 = $1", [hash(attempt)]), { code: "42501" });
    await assert.rejects(owner.query("SELECT auth.assert_social_attempt_live(attempt) FROM auth.social_attempts AS attempt WHERE attempt_sha256 = $1", [hash(attempt)]), { code: "23514" });
    await owner.query("DELETE FROM auth.social_attempts WHERE attempt_sha256 = $1", [hash(attempt)]);

    assert.equal((await writer.query("SELECT auth.principal_session_status($1, NULL) AS status", [subject])).rows[0].status, "valid");
    await owner.query("INSERT INTO auth.principal_session_fences(subject_sha256,minimum_auth_time) VALUES ($1,100)", [hash(subject)]);
    assert.equal((await writer.query("SELECT auth.principal_session_status($1,99) AS status", [subject])).rows[0].status, "revoked");
    assert.equal((await writer.query("SELECT auth.principal_session_status($1,NULL) AS status", [subject])).rows[0].status, "revoked");
    assert.equal((await writer.query("SELECT auth.principal_session_status($1,100) AS status", [subject])).rows[0].status, "valid");
    assert.equal((await writer.query("SELECT auth.principal_session_status($1,99) AS status", [otherSubject])).rows[0].status, "valid");
    for (const account of [source, target]) {
      assert.equal((await writer.query("SELECT auth.account_live_session_status($1,99) AS status", [account])).rows[0].status, "revoked");
    }

    await owner.query(retire, [target, later, receipts[1]]);
    const redirects = await owner.query("SELECT retired_user_id,canonical_user_id FROM auth.account_retirements WHERE retired_user_id = ANY($1::text[]) ORDER BY retired_user_id", [[source, target]]);
    assert.deepEqual(redirects.rows, [source, target].sort().map((id) => ({ retired_user_id: id, canonical_user_id: later })));
    assert.equal((await loadCognitoIdentityMappingInExecutor(executorFor(writer), subject))?.originalClientUserId, source);
    assert.equal((await loadCognitoIdentityMappingInExecutor(executorFor(writer), subject))?.userId, later);
    await assert.rejects(owner.query(retire, [later, source, randomUUID()]), { code: "P0A01" });
    await assert.rejects(owner.query(retire, [source, later, randomUUID()]), { code: "P0A01" });
    await assert.rejects(owner.query(retire, [later, later, randomUUID()]), { code: "23514" });
    await assert.rejects(owner.query("INSERT INTO auth.account_retirements(retired_user_id,canonical_user_id,retirement_id) VALUES ($1,$2,$3)", [later, source, randomUUID()]), { code: "23514" });
    await transactionWithUserScope({ userId: later }, async (executor) => {
      await executor.query("UPDATE org.user_settings SET email = $2 WHERE user_id = $1", [later, "canonical@mail.test"]);
    });
    assert.equal((await owner.query("SELECT count(*)::int AS count FROM org.user_settings WHERE user_id = ANY($1::text[])", [sources])).rows[0].count, 3);
    assert.equal((await owner.query("SELECT count(*)::int AS count FROM auth.deleted_subjects WHERE subject_sha256 = ANY($1::text[])", [subjects.map(hash)])).rows[0].count, 0);
    assert.equal((await owner.query("SELECT count(*)::int AS count FROM auth.apple_session_revocation_jobs WHERE subject_sha256 = ANY($1::text[])", [subjects.map(hash)])).rows[0].count, 0);
  } finally {
    try {
      await Promise.all([owner.query("ROLLBACK"), writer.query("ROLLBACK"), auth.query("ROLLBACK")]);
      await owner.query("DELETE FROM auth.account_retirements WHERE retired_user_id = ANY($1::text[])", [sources]);
      await owner.query("DELETE FROM org.workspaces WHERE workspace_id = ANY($1::uuid[])", [workspaceIds]);
      await owner.query("DELETE FROM org.user_settings WHERE user_id = ANY($1::text[])", [sources]);
      await owner.query("DELETE FROM auth.cognito_principals WHERE cognito_subject = ANY($1::text[])", [subjects]);
      await owner.query("DELETE FROM auth.principal_session_fences WHERE subject_sha256 = ANY($1::text[])", [subjects.map(hash)]);
    } finally {
      await Promise.all([owner.end(), writer.end(), auth.end()]);
    }
  }
});

test("account retirement keeps the later last and periodic paywall appearances", async () => {
  const ownerUrl = process.env.TEST_DATABASE_ADMIN_URL;
  if (ownerUrl === undefined) throw new Error("TEST_DATABASE_ADMIN_URL is required");
  const owner = new pg.Client({ connectionString: ownerUrl });
  const [source, target] = [randomUUID(), randomUUID()];
  try {
    await owner.connect();
    await owner.query(`INSERT INTO org.user_settings(user_id, paywall_last_shown_at, paywall_periodic_shown_at)
      VALUES ($1, '2026-10-02T00:00:00Z', '2026-10-02T00:00:00Z'), ($2, '2026-10-03T00:00:00Z', NULL)`, [source, target]);
    await owner.query(retire, [source, target, randomUUID()]);
    const row = (await owner.query(`SELECT paywall_last_shown_at, paywall_periodic_shown_at
      FROM org.user_settings WHERE user_id = $1`, [target])).rows[0];
    assert.equal(new Date(row.paywall_last_shown_at).toISOString(), "2026-10-03T00:00:00.000Z");
    assert.equal(new Date(row.paywall_periodic_shown_at).toISOString(), "2026-10-02T00:00:00.000Z");
  } finally {
    try {
      await owner.query("DELETE FROM auth.account_retirements WHERE retired_user_id = $1", [source]);
      await owner.query("DELETE FROM org.user_settings WHERE user_id = ANY($1::text[])", [[source, target]]);
    } finally {
      await owner.end();
    }
  }
});
