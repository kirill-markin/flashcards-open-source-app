import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";

const opaque = (): string => randomBytes(32).toString("hex");
const hash = (value: string): string => createHash("sha256").update(value).digest("hex");
const launch = "SELECT * FROM auth.load_account_provider_browser_launch($1,$2)";
const resume = "SELECT * FROM auth.load_proved_account_provider_reenable($1,$2,$3,$4,$5,$5,$6)";
const claim = "SELECT * FROM auth.claim_social_attempt($1,$2,$3,$4,NULL,'provider_ready')";
const advance = "SELECT auth.advance_social_attempt($1,$2,$3,$4,'encrypted-storage-fixture',$5)";
const create = "SELECT auth.create_social_attempt($1,$2,$3,$4,$5,NULL,$6,$7,$8,'encrypted-storage-fixture',$9,$10,'ios',NULL)";
const finish = "SELECT auth.complete_account_provider_reenable($1,$1,$2,$3,$4,$5,'android',NULL,$6,'apple-client-storage-fixture',$7)";

test("account browser handoffs retain persisted intent, native binding and the one-use re-enable boundary", async () => {
  const ownerUrl = process.env.TEST_DATABASE_ADMIN_URL;
  if (ownerUrl === undefined) throw new Error("TEST_DATABASE_ADMIN_URL is required");
  const owner = new pg.Client({ connectionString: ownerUrl });
  const auth = new pg.Client({ connectionString: ownerUrl });
  const contender = new pg.Client({ connectionString: ownerUrl });
  const backend = new pg.Client({ connectionString: ownerUrl });
  const reporting = new pg.Client({ connectionString: ownerUrl });
  const current = randomUUID();
  const disabledSubject = randomUUID();
  const other = randomUUID();
  const account = randomUUID();
  const otherAccount = randomUUID();
  const subjects = [current, disabledSubject, other];
  const accounts = [account, otherAccount];
  const apple = "browser-apple-" + randomUUID();
  const google = "browser-google-" + randomUUID();
  const email = randomUUID() + "@mail.test";
  const binding = opaque();
  const receiptBinding = opaque();
  const authTime = Math.floor(Date.now() / 1_000) - 300;
  const origin = "https://auth.nibomo.com";
  const legacyOrigin = "https://auth.flashcards-open-source-app.com";
  const callback = origin + "/api/social/apple/callback";
  const credential = "v1." + "A".repeat(16) + "." + "B".repeat(22) + "." + "C".repeat(20);
  const attempts: Array<string> = [];
  // These fixtures exercise storage contracts; they are never provider or native-SDK acceptance proof.
  const receipt = async (): Promise<string> => {
    const handle = opaque();
    const completion = opaque();
    attempts.push(handle);
    await auth.query(create, [handle, "google", "ios", "reauth", receiptBinding, null,
      current, account, null, null]);
    const lease = (await auth.query(claim, [handle, receiptBinding, "reauth", "ios"])).rows[0].claim_id as string;
    await auth.query(advance, [handle, lease, "provider_claimed", "provider_verifying", null]);
    await auth.query(advance, [handle, lease, "provider_verifying", "provider_proved", google]);
    await auth.query(advance, [handle, lease, "provider_proved", "provider_enrolling", google]);
    await auth.query("SELECT auth.complete_social_attempt($1,$2,$3,$3,$4)", [handle, lease, current, completion]);
    return completion;
  };
  const createOrdinary = async (provider: string, client: string, purpose: string, redirect: string | null): Promise<string> => {
    const handle = opaque();
    attempts.push(handle);
    await auth.query(create, [handle, provider, client, purpose, binding, redirect,
      purpose === "login" ? null : current, purpose === "login" ? null : account,
      purpose === "link" ? await receipt() : null, purpose === "link" ? receiptBinding : null]);
    return handle;
  };
  const beginReenable = async (): Promise<string> => {
    const handle = opaque();
    attempts.push(handle);
    const generation = (await owner.query("SELECT activated_at::text AS generation FROM auth.provider_login_methods WHERE provider_subject = $1", [apple])).rows[0].generation as string;
    await auth.query("SELECT auth.create_account_provider_reenable($1,'apple',$2,$3,'android',$4,NULL,$5,$6,$6,$7,'encrypted-storage-fixture',$8,$9,'ios',NULL)",
      [handle, apple, generation, binding, callback, current, authTime, await receipt(), receiptBinding]);
    return handle;
  };
  const prove = async (handle: string): Promise<string> => {
    const lease = (await auth.query(claim, [handle, binding, "link", "android"])).rows[0].claim_id as string;
    await auth.query(advance, [handle, lease, "provider_claimed", "provider_verifying", null]);
    await auth.query(advance, [handle, lease, "provider_verifying", "provider_proved", apple]);
    return lease;
  };
  const changedStorage = async (
    sql: string, values: Array<string | number | null>, inspect: () => Promise<void>,
  ): Promise<void> => {
    await owner.query("BEGIN");
    try {
      await owner.query(sql, values);
      await owner.query("SET LOCAL ROLE auth_app");
      await inspect();
    } finally {
      await owner.query("ROLLBACK");
    }
  };
  try {
    for (const client of [owner, auth, contender, backend, reporting]) await client.connect();
    for (const client of [auth, contender]) await client.query("SET ROLE auth_app");
    await backend.query("SET ROLE backend_app");
    await reporting.query("SET ROLE reporting_readonly");
    for (const id of accounts) await owner.query("INSERT INTO org.user_settings(user_id) VALUES ($1)", [id]);
    for (const [subject, id] of [[current, account], [disabledSubject, account], [other, otherAccount]]) {
      await owner.query("SELECT auth.bind_cognito_account($1,$2)", [subject, id]);
      await auth.query("SELECT auth.enroll_proved_email_principal($1,$1,$2,clock_timestamp())", [subject, email]);
    }
    await auth.query("SELECT auth.activate_proved_provider_method('google',$1,$2,$3)", [google, current, email]);
    await auth.query("SELECT auth.activate_proved_provider_method('apple',$1,$2,$3)", [apple, disabledSubject, email]);

    for (const targetOrigin of [origin, legacyOrigin]) {
      const handle = await createOrdinary("apple", "android", "reauth", targetOrigin + "/api/social/apple/callback");
      const first = (await auth.query(launch, [handle, targetOrigin])).rows[0];
      assert.equal(first.purpose, "reauth");
      assert.equal(first.explicit_reenable, false);
      assert.equal(first.binding_sha256, binding);
      assert.equal(first.redirect_uri, targetOrigin + "/api/social/apple/callback");
      assert.deepEqual((await auth.query(launch, [handle, targetOrigin])).rows[0], first);
      assert.equal((await owner.query("SELECT phase, claim_id FROM auth.social_attempts WHERE attempt_sha256 = $1", [handle])).rows[0].phase, "provider_ready");
      for (const badOrigin of [targetOrigin === origin ? legacyOrigin : origin, "https://evil.test", targetOrigin + "/"]) {
        assert.equal((await auth.query(launch, [handle, badOrigin])).rowCount, 0);
      }
      await auth.query(claim, [handle, binding, "reauth", "android"]);
      assert.equal((await auth.query(launch, [handle, targetOrigin])).rowCount, 0);
    }
    const ordinaryLink = await createOrdinary("apple", "android", "link", callback);
    assert.equal((await auth.query(launch, [ordinaryLink, origin])).rows[0].purpose, "link");
    assert.equal((await auth.query(launch, [ordinaryLink, origin])).rows[0].explicit_reenable, false);
    for (const [provider, client, purpose, redirect] of [
      ["apple", "android", "login", callback], ["apple", "ios", "reauth", null], ["google", "android", "reauth", null],
    ] as const) {
      const handle = await createOrdinary(provider, client, purpose, redirect);
      assert.equal((await auth.query(launch, [handle, origin])).rowCount, 0);
    }
    await changedStorage("UPDATE auth.social_attempts SET expires_at = clock_timestamp() - INTERVAL '1 second' WHERE attempt_sha256 = $1",
      [ordinaryLink], async () => { assert.equal((await owner.query(launch, [ordinaryLink, origin])).rowCount, 0); });
    await changedStorage("UPDATE auth.social_attempts SET current_account = $2 WHERE attempt_sha256 = $1",
      [ordinaryLink, otherAccount], async () => { await assert.rejects(owner.query(launch, [ordinaryLink, origin]), { code: "23514" }); });

    const generation = (await owner.query("SELECT activated_at::text AS generation FROM auth.provider_login_methods WHERE provider_subject = $1", [apple])).rows[0].generation;
    await auth.query("SELECT auth.unlink_account_provider_method($1,$1,$2,'apple',$3,$4,$5,$6,'ios',NULL)",
      [current, authTime, apple, generation, await receipt(), receiptBinding]);
    const job = (await auth.query("SELECT * FROM auth.claim_apple_session_revocation()")).rows[0];
    assert.equal(job.cognito_subject, disabledSubject);
    await auth.query("SELECT auth.complete_apple_session_revocation($1,$2)", [job.job_id, job.lease_id]);
    const handle = await beginReenable();
    const resumed = [handle, binding, "android", null, current, authTime];
    const ready = (await auth.query(launch, [handle, origin])).rows[0];
    assert.equal(ready.explicit_reenable, true);
    assert.equal(ready.purpose, "link");
    assert.equal((await auth.query(resume, resumed)).rowCount, 0);
    const lease = await prove(handle);
    assert.equal((await auth.query(launch, [handle, origin])).rowCount, 0);
    assert.equal((await auth.query(claim, [handle, binding, "link", "android"])).rowCount, 0);
    assert.equal((await auth.query("SELECT * FROM auth.load_social_mailbox_attempt($1,$2,'link','android',NULL)", [handle, binding])).rowCount, 0);
    for (const bad of [
      [handle, opaque(), "android", null, current, authTime],
      [handle, binding, "ios", null, current, authTime],
      [handle, binding, "android", origin, current, authTime],
      [handle, binding, "android", null, other, authTime],
    ]) assert.equal((await auth.query(resume, bad)).rowCount, 0);
    await assert.rejects(auth.query("SELECT * FROM auth.load_proved_account_provider_reenable($1,$2,'android',NULL,$3,$4,$5)",
      [handle, binding, current, other, authTime]), { code: "23514" });
    const proved = (await auth.query(resume, resumed)).rows[0];
    assert.equal(proved.claim_id, lease);
    assert.equal(proved.phase, "provider_proved");
    assert.equal(proved.secret_ciphertext, "encrypted-storage-fixture");
    assert.deepEqual((await auth.query(resume, resumed)).rows[0], proved);

    for (const assignment of [
      "expires_at = clock_timestamp() - INTERVAL '1 second'",
      "verified_at = clock_timestamp() - INTERVAL '121 seconds'",
      "claim_id = NULL", "reenable_disabled_at = NULL", "purpose = 'reauth'", "client_type = 'ios', redirect_uri = NULL",
    ]) await changedStorage("UPDATE auth.social_attempts SET " + assignment + " WHERE attempt_sha256 = $1", [handle],
      async () => { assert.equal((await owner.query(resume, resumed)).rowCount, 0); });
    for (const assignment of [
      "current_account = '" + otherAccount + "'",
      "snapshot_method_activated_at = snapshot_method_activated_at + INTERVAL '1 microsecond'",
      "reenable_disabled_at = reenable_disabled_at + INTERVAL '1 microsecond'",
      "reenable_minimum_auth_time = reenable_minimum_auth_time + 1",
      "snapshot_principal_created_at = snapshot_principal_created_at + INTERVAL '1 microsecond'",
      "snapshot_provider_created_at = snapshot_provider_created_at + INTERVAL '1 microsecond'",
    ]) await changedStorage("UPDATE auth.social_attempts SET " + assignment + " WHERE attempt_sha256 = $1", [handle],
      async () => { await assert.rejects(owner.query(resume, resumed), { code: "23514" }); });
    for (const subject of [current, disabledSubject]) {
      await changedStorage("INSERT INTO auth.deleted_subjects(subject_sha256) VALUES ($1)", [hash(subject)],
        async () => { await assert.rejects(owner.query(resume, resumed), { code: "23514" }); });
    }
    await changedStorage("INSERT INTO auth.deleted_accounts(user_id_sha256) VALUES ($1)", [hash(account)],
      async () => { await assert.rejects(owner.query(resume, resumed), { code: "23514" }); });
    await changedStorage("INSERT INTO auth.principal_session_fences(subject_sha256, minimum_auth_time) VALUES ($1,$2)",
      [hash(current), authTime + 1], async () => { await assert.rejects(owner.query(resume, resumed), { code: "23514" }); });
    await changedStorage("UPDATE auth.principal_session_fences SET minimum_auth_time = minimum_auth_time + 1 WHERE subject_sha256 = $1",
      [hash(disabledSubject)], async () => { await assert.rejects(owner.query(resume, resumed), { code: "23514" }); });
    await changedStorage("INSERT INTO auth.apple_session_revocation_jobs(provider_subject_sha256, cognito_subject) VALUES ($1,$2)",
      [opaque(), disabledSubject], async () => { await assert.rejects(owner.query(resume, resumed), { code: "23514" }); });
    await changedStorage("INSERT INTO auth.apple_revocation_jobs(provider_subject, client_id, credential_sha256, reason) VALUES ($1,'storage-fixture',$2,'unlink')",
      [apple, opaque()], async () => { await assert.rejects(owner.query(resume, resumed), { code: "55006" }); });
    for (const reader of [backend, reporting]) {
      await assert.rejects(reader.query(launch, [handle, origin]), { code: "42501" });
      await assert.rejects(reader.query(resume, resumed), { code: "42501" });
    }
    await assert.rejects(auth.query("SELECT * FROM auth.social_attempts"), { code: "42501" });
    const privileges = await owner.query("SELECT proacl::text FROM pg_catalog.pg_proc WHERE oid IN ('auth.load_account_provider_browser_launch(text,text)'::regprocedure, 'auth.load_proved_account_provider_reenable(text,text,text,text,text,text,bigint)'::regprocedure)");
    assert.equal(privileges.rowCount, 2);
    for (const row of privileges.rows) assert.doesNotMatch(row.proacl as string, /[,{]=X/);

    const finalization = [current, authTime, handle, lease, binding, apple, credential];
    const completions = await Promise.allSettled([auth.query(finish, finalization), contender.query(finish, finalization)]);
    assert.equal(completions.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal((await auth.query(resume, resumed)).rowCount, 0);
    await assert.rejects(auth.query(finish, finalization));
    const terminal = (await owner.query("SELECT phase, secret_ciphertext FROM auth.social_attempts WHERE attempt_sha256 = $1", [handle])).rows[0];
    assert.deepEqual(terminal, { phase: "redeemed", secret_ciphertext: "erased" });
    assert.equal((await auth.query("SELECT * FROM auth.load_provider_login_method('apple',$1)", [apple])).rows[0].status, "active");
  } finally {
    await Promise.all([auth.end(), contender.end(), backend.end(), reporting.end()]);
    try {
      await owner.query("DELETE FROM auth.social_attempts WHERE attempt_sha256 = ANY($1::text[])", [attempts]);
      await owner.query("DELETE FROM auth.apple_revocation_jobs WHERE provider_subject = $1", [apple]);
      await owner.query("DELETE FROM auth.apple_revocation_credentials WHERE cognito_subject = ANY($1::text[])", [subjects]);
      await owner.query("DELETE FROM auth.cognito_principals WHERE cognito_subject = ANY($1::text[])", [subjects]);
      await owner.query("DELETE FROM auth.apple_session_revocation_jobs WHERE subject_sha256 = ANY($1::text[])", [subjects.map(hash)]);
      await owner.query("DELETE FROM auth.principal_session_fences WHERE subject_sha256 = ANY($1::text[])", [subjects.map(hash)]);
      await owner.query("DELETE FROM auth.deleted_subjects WHERE subject_sha256 = ANY($1::text[])", [subjects.map(hash)]);
      await owner.query("DELETE FROM auth.deleted_accounts WHERE user_id_sha256 = ANY($1::text[])", [accounts.map(hash)]);
      await owner.query("DELETE FROM org.user_settings WHERE user_id = ANY($1::text[])", [accounts]);
    } finally {
      await owner.end();
    }
  }
});
