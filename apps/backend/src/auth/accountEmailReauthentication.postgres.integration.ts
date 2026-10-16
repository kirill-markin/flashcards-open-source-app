import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";

const opaque = (): string => randomBytes(32).toString("hex");
const hash = (value: string): string => createHash("sha256").update(value).digest("hex");
const create = "SELECT * FROM auth.create_email_auth_attempt($1,'ios',$2,NULL,$3,$4,$5,$6,'encrypted-state',$7,$8)";
const claim = "SELECT * FROM auth.claim_email_auth_attempt($1,$2,'ios',NULL,$3,$4,$5)";
const complete = "SELECT auth.complete_email_auth_attempt($1,$2,$3,$4,$5,$6,$7)";

test("enrolled email proof keeps the initiating session distinct across real PostgreSQL lifecycle boundaries", async () => {
  const ownerUrl = process.env.TEST_DATABASE_ADMIN_URL;
  if (ownerUrl === undefined) throw new Error("TEST_DATABASE_ADMIN_URL is required");
  const owner = new pg.Client({ connectionString: ownerUrl });
  const auth = new pg.Client({ connectionString: ownerUrl });
  const contender = new pg.Client({ connectionString: ownerUrl });
  const p = randomUUID();
  const q = randomUUID();
  const foreign = randomUUID();
  const methodPrincipal = randomUUID();
  const subjects = [p, q, foreign, methodPrincipal];
  const usernames = subjects.map((subject) => "immutable-" + subject);
  const account = randomUUID();
  const foreignAccount = randomUUID();
  const retiredAccount = randomUUID();
  const accounts = [account, foreignAccount, retiredAccount];
  const email = randomUUID() + "@mail.test";
  const foreignEmail = randomUUID() + "@mail.test";
  const provider = "email-action-" + randomUUID();
  const binding = opaque();
  const originalTime = Math.floor(Date.now() / 1_000) - 300;
  const attempts: Array<string> = [];
  const begin = async (): Promise<string> => {
    const handle = opaque();
    attempts.push(handle);
    const created = (await auth.query(create, [handle, binding, p, usernames[0], email, originalTime, q, usernames[1]])).rows[0];
    assert.equal(created.current_subject, p);
    assert.equal(created.snapshot_subject, q);
    assert.equal(created.email_current_username, usernames[0]);
    assert.equal(created.snapshot_username, usernames[1]);
    assert.equal(created.current_account, account);
    await auth.query("SELECT auth.ready_email_auth_attempt($1,$2,'encrypted-otp-state')", [handle, created.claim_id]);
    return handle;
  };
  const claimParameters = (handle: string): Array<string | number> => [handle, binding, p, usernames[0], originalTime];
  const finish = async (): Promise<Readonly<{ handle: string; receipt: string }>> => {
    const handle = await begin();
    const claimed = (await auth.query(claim, claimParameters(handle))).rows[0];
    const receipt = opaque();
    await auth.query(complete, [handle, claimed.claim_id, q, usernames[1], email, Math.floor(Date.now() / 1_000), receipt]);
    return { handle, receipt };
  };
  const refuseAfter = async (mutation: () => Promise<void>, restore: () => Promise<void>): Promise<void> => {
    const handle = await begin();
    const proved = await finish();
    const verifying = await begin();
    const lease = (await auth.query(claim, claimParameters(verifying))).rows[0].claim_id;
    const method = (await owner.query<{ activated_at: string }>("SELECT activated_at::text AS activated_at FROM auth.provider_login_methods WHERE provider_subject = $1", [provider])).rows[0];
    await mutation();
    try {
      await assert.rejects(auth.query(claim, claimParameters(handle)), { code: "23514" });
      await assert.rejects(auth.query(complete, [verifying, lease, q, usernames[1], email, Math.floor(Date.now() / 1_000), opaque()]), { code: "23514" });
      await assert.rejects(auth.query("SELECT auth.unlink_account_provider_method($1,$2,$3,'google',$4,$5,$6,$7,'ios',NULL)",
        [p, usernames[0], originalTime, provider, method.activated_at, proved.receipt, binding]), { code: "23514" });
      await assert.rejects(auth.query("SELECT * FROM auth.redeem_social_completion($1,$2,'reauth','ios',NULL)",
        [proved.receipt, binding]), { code: "23514" });
    } finally {
      await restore();
    }
  };
  try {
    for (const client of [owner, auth, contender]) await client.connect();
    await auth.query("SET ROLE auth_app");
    await contender.query("SET ROLE auth_app");
    await owner.query("INSERT INTO org.user_settings(user_id,email) VALUES ($1,$2),($3,$4),($5,NULL)",
      [account, email, foreignAccount, foreignEmail, retiredAccount]);
    for (let index = 0; index < subjects.length; index += 1) {
      const subject = subjects[index];
      if (subject !== p) await owner.query("SELECT auth.register_cognito_principal($1,$2)", [subject, usernames[index]]);
      await owner.query("SELECT auth.bind_cognito_account($1,$2)", [subject, subject === foreign ? foreignAccount : subject === q ? retiredAccount : account]);
    }
    // Storage inputs stand for verified server claims; this boundary creates no fake provider tokens.
    const legacy = opaque();
    const legacyReceipt = opaque();
    attempts.push(legacy);
    assert.equal((await owner.query("SELECT 1 FROM auth.cognito_principals WHERE cognito_subject = $1", [p])).rowCount, 0);
    const legacyCreated = (await auth.query(
      "SELECT * FROM auth.create_email_auth_attempt($1,'ios',$2,NULL,$3,$4,$5,$6,'encrypted-legacy-state')",
      [legacy, binding, p, usernames[0], email, originalTime])).rows[0];
    await auth.query("SELECT auth.ready_email_auth_attempt($1,$2,'encrypted-legacy-otp')", [legacy, legacyCreated.claim_id]);
    const legacyClaim = (await auth.query(claim, claimParameters(legacy))).rows[0];
    await auth.query(complete, [legacy, legacyClaim.claim_id, p, usernames[0], email, Math.floor(Date.now() / 1_000), legacyReceipt]);
    assert.equal((await auth.query("SELECT * FROM auth.redeem_social_completion($1,$2,'reauth','ios',NULL)",
      [legacyReceipt, binding])).rows[0].cognito_subject, p);
    assert.equal((await owner.query("SELECT 1 FROM auth.verified_login_emails WHERE cognito_subject = $1", [p])).rowCount, 0);
    await auth.query("SELECT auth.enroll_proved_email_principal($1,$2,$3,clock_timestamp())", [q, usernames[1], email]);
    await owner.query("SELECT auth.record_account_retirement($1,$2,$3)", [retiredAccount, account, randomUUID()]);
    const retiredLegacy = opaque();
    const retiredLegacyReceipt = opaque();
    attempts.push(retiredLegacy);
    const retiredLegacyCreated = (await auth.query(
      "SELECT * FROM auth.create_email_auth_attempt($1,'ios',$2,NULL,$3,$4,$5,$6,'encrypted-legacy-state')",
      [retiredLegacy, binding, q, usernames[1], email, originalTime])).rows[0];
    assert.equal(retiredLegacyCreated.current_account, account);
    await auth.query("SELECT auth.ready_email_auth_attempt($1,$2,'encrypted-legacy-otp')", [retiredLegacy, retiredLegacyCreated.claim_id]);
    const retiredLegacyClaim = (await auth.query(claim, [retiredLegacy, binding, q, usernames[1], originalTime])).rows[0];
    await auth.query(complete, [retiredLegacy, retiredLegacyClaim.claim_id, q, usernames[1], email,
      Math.floor(Date.now() / 1_000), retiredLegacyReceipt]);
    assert.equal((await auth.query("SELECT * FROM auth.redeem_social_completion($1,$2,'reauth','ios',NULL)",
      [retiredLegacyReceipt, binding])).rows[0].cognito_subject, q);
    await auth.query("SELECT auth.enroll_proved_email_principal($1,$2,$3,clock_timestamp())", [foreign, usernames[2], foreignEmail]);
    await auth.query("SELECT auth.enroll_proved_email_principal($1,$2,$3,clock_timestamp())", [methodPrincipal, usernames[3], email]);
    await auth.query("SELECT auth.activate_proved_provider_method('google',$1,$2,$3)", [provider, methodPrincipal, email]);
    assert.deepEqual((await auth.query("SELECT * FROM auth.account_recovery_email($1,$2,$3)", [p, usernames[0], originalTime])).rows,
      [{ cognito_subject: q < methodPrincipal ? q : methodPrincipal,
        cognito_username: q < methodPrincipal ? usernames[1] : usernames[3], email }]);
    await assert.rejects(auth.query(create, [opaque(), binding, p, usernames[0], foreignEmail, originalTime, foreign, usernames[2]]), { code: "23514" });
    await assert.rejects(auth.query(create, [opaque(), binding, p, usernames[0], "contact@" + email, originalTime, q, usernames[1]]), { code: "23514" });
    const handle = await begin();
    for (const wrong of [
      [handle, binding, q, usernames[1], originalTime],
      [handle, binding, p, usernames[0], originalTime + 1],
      [handle, opaque(), p, usernames[0], originalTime],
    ]) assert.equal((await auth.query(claim, wrong)).rowCount, 0);
    const claimed = await Promise.all([auth.query(claim, claimParameters(handle)), contender.query(claim, claimParameters(handle))]);
    assert.deepEqual(claimed.map((result) => result.rowCount).sort(), [0, 1]);
    const lease = claimed.find((result) => result.rowCount === 1)?.rows[0].claim_id as string;
    for (const wrong of [
      [p, usernames[0], email, Math.floor(Date.now() / 1_000)],
      [q, usernames[0], email, Math.floor(Date.now() / 1_000)],
      [q, usernames[1], foreignEmail, Math.floor(Date.now() / 1_000)],
      [q, usernames[1], email, originalTime],
    ]) await assert.rejects(auth.query(complete, [handle, lease, ...wrong, opaque()]), { code: "23514" });
    const receipt = opaque();
    await auth.query(complete, [handle, lease, q, usernames[1], email, Math.floor(Date.now() / 1_000), receipt]);
    const generation = (await owner.query<{ activated_at: string }>("SELECT activated_at::text AS activated_at FROM auth.provider_login_methods WHERE provider_subject = $1", [provider])).rows[0].activated_at;
    const action = "SELECT auth.unlink_account_provider_method($1,$2,$3,'google',$4,$5,$6,$7,'ios',NULL)";
    await assert.rejects(auth.query(action, [p, usernames[0], originalTime + 1, provider, generation, receipt, binding]), { code: "23514" });
    await auth.query(action, [p, usernames[0], originalTime, provider, generation, receipt, binding]);
    assert.equal((await owner.query("SELECT status FROM auth.provider_login_methods WHERE provider_subject = $1", [provider])).rows[0].status, "disabled");
    await assert.rejects(auth.query(action, [p, usernames[0], originalTime, provider, generation, receipt, binding]), { code: "23514" });
    await refuseAfter(async () => { await owner.query("UPDATE auth.verified_login_emails SET verified_at = verified_at + INTERVAL '1 second' WHERE cognito_subject = $1", [q]); },
      async () => { await owner.query("UPDATE auth.verified_login_emails SET verified_at = verified_at - INTERVAL '1 second' WHERE cognito_subject = $1", [q]); });
    for (const subject of [p, q]) {
      await refuseAfter(async () => { await owner.query("UPDATE auth.cognito_principals SET created_at = created_at + INTERVAL '1 second' WHERE cognito_subject = $1", [subject]); },
        async () => { await owner.query("UPDATE auth.cognito_principals SET created_at = created_at - INTERVAL '1 second' WHERE cognito_subject = $1", [subject]); });
      await refuseAfter(async () => { await owner.query("INSERT INTO auth.deleted_subjects(subject_sha256) VALUES ($1)", [hash(subject)]); },
        async () => { await owner.query("DELETE FROM auth.deleted_subjects WHERE subject_sha256 = $1", [hash(subject)]); });
      await refuseAfter(async () => { await owner.query("INSERT INTO auth.principal_session_fences(subject_sha256,minimum_auth_time) VALUES ($1,$2)", [hash(subject), Math.floor(Date.now() / 1_000) + 1]); },
        async () => { await owner.query("DELETE FROM auth.principal_session_fences WHERE subject_sha256 = $1", [hash(subject)]); });
    }
    await refuseAfter(async () => { await owner.query("UPDATE auth.user_identities SET user_id = $1 WHERE provider_type = 'cognito' AND provider_subject = $2", [foreignAccount, q]); },
      async () => { await owner.query("UPDATE auth.user_identities SET user_id = $1 WHERE provider_type = 'cognito' AND provider_subject = $2", [retiredAccount, q]); });
    await refuseAfter(async () => { await owner.query("INSERT INTO auth.deleted_accounts(user_id_sha256) VALUES ($1)", [hash(account)]); },
      async () => { await owner.query("DELETE FROM auth.deleted_accounts WHERE user_id_sha256 = $1", [hash(account)]); });
    for (const subject of [p, q]) {
      await refuseAfter(async () => { await auth.query("SELECT auth.invalidate_principal_sessions($1,$2)", [subject, randomUUID()]); },
        async () => {
          await owner.query("DELETE FROM auth.apple_session_revocation_jobs WHERE subject_sha256 = $1", [hash(subject)]);
          await owner.query("DELETE FROM auth.principal_session_fences WHERE subject_sha256 = $1", [hash(subject)]);
        });
    }
    const busy = await begin();
    await owner.query("BEGIN");
    await owner.query("SELECT pg_advisory_xact_lock(hashtextextended('auth.account_writer:' || $1,2::bigint))", [account]);
    await assert.rejects(auth.query(claim, claimParameters(busy)), { code: "23514" });
    await owner.query("ROLLBACK");
  } finally {
    await Promise.all([auth.end(), contender.end()]);
    try {
      await owner.query("ROLLBACK");
      await owner.query("DELETE FROM auth.social_attempts WHERE attempt_sha256 = ANY($1::text[])", [attempts]);
      await owner.query("DELETE FROM auth.apple_session_revocation_jobs WHERE subject_sha256 = ANY($1::text[])", [subjects.map(hash)]);
      await owner.query("DELETE FROM auth.principal_session_fences WHERE subject_sha256 = ANY($1::text[])", [subjects.map(hash)]);
      await owner.query("DELETE FROM auth.deleted_subjects WHERE subject_sha256 = ANY($1::text[])", [subjects.map(hash)]);
      await owner.query("DELETE FROM auth.cognito_principals WHERE cognito_subject = ANY($1::text[])", [subjects]);
      await owner.query("DELETE FROM auth.account_retirements WHERE retired_user_id = $1", [retiredAccount]);
      await owner.query("DELETE FROM auth.deleted_accounts WHERE user_id_sha256 = ANY($1::text[])", [accounts.map(hash)]);
      await owner.query("DELETE FROM org.user_settings WHERE user_id = ANY($1::text[])", [accounts]);
    } finally {
      await owner.end();
    }
  }
});
