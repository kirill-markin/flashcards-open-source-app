import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import pg from "pg";

const opaque = (): string => randomBytes(32).toString("hex");
const hash = (value: string): string => createHash("sha256").update(value).digest("hex");
const create = "SELECT auth.create_social_attempt($1,$2,'ios',$3,$4,NULL,NULL,$5,$6,'encrypted-storage-fixture',$7,$8,$9,$10)";
const claim = "SELECT * FROM auth.claim_social_attempt($1,$2,$3,'ios',NULL,'provider_ready')";
const advance = "SELECT auth.advance_social_attempt($1,$2,$3,$4,'encrypted-storage-fixture',$5)";
const complete = "SELECT auth.complete_social_attempt($1,$2,$3,$3,$4)";
const unlink = "SELECT auth.unlink_account_provider_method($1,$1,$2,$3,$4,$5,$6,$7,$8,$9)";
const reenable = "SELECT auth.create_account_provider_reenable($1,$2,$3,$4,'ios',$5,NULL,NULL,$6,$6,$7,'encrypted-storage-fixture',$8,$9,$10,$11)";
const finishReenable = "SELECT auth.complete_account_provider_reenable($1,$1,$2,$3,$4,$5,'ios',NULL,$6,$7,$8)";
const list = "SELECT * FROM auth.list_account_provider_methods($1,$1,$2)";

test("account provider management composes PostgreSQL receipts, fences, generations and durable revocation", async () => {
  const ownerUrl = process.env.TEST_DATABASE_ADMIN_URL;
  if (ownerUrl === undefined) throw new Error("TEST_DATABASE_ADMIN_URL is required");
  const owner = new pg.Client({ connectionString: ownerUrl });
  const auth = new pg.Client({ connectionString: ownerUrl });
  const contender = new pg.Client({ connectionString: ownerUrl });
  const backend = new pg.Client({ connectionString: ownerUrl });
  const reporting = new pg.Client({ connectionString: ownerUrl });
  const account = randomUUID();
  const otherAccount = randomUUID();
  const hiddenAccount = randomUUID();
  const a = randomUUID();
  const b = randomUUID();
  const c = randomUUID();
  const other = randomUUID();
  const hidden = randomUUID();
  const newSubject = randomUUID();
  const subjects = [a, b, c, other, hidden, newSubject];
  const accounts = [account, otherAccount, hiddenAccount];
  const providerB = "method-b-" + randomUUID();
  const providerC = "method-c-" + randomUUID();
  const providerOther = "method-other-" + randomUUID();
  const providerNew = "method-new-" + randomUUID();
  const apple = "method-apple-" + randomUUID();
  const hiddenGoogle = "method-hidden-google-" + randomUUID();
  const email = randomUUID() + "@mail.test";
  const relay = randomUUID() + "@privaterelay.appleid.com";
  const binding = opaque();
  const receiptBinding = opaque();
  const origin = "https://auth.nibomo.com";
  const originalTime = Math.floor(Date.now() / 1_000) - 300;
  const attempts: Array<string> = [];
  const generation = async (provider: string, providerSubject: string): Promise<string> =>
    (await owner.query("SELECT activated_at::text AS generation FROM auth.provider_login_methods WHERE provider_type = $1 AND provider_subject = $2",
      [provider, providerSubject])).rows[0].generation as string;
  // These are storage-boundary fixtures, never fabricated JWTs or a substitute provider verifier.
  const seedMethod = async (subject: string, mailbox: string, provider: string, providerSubject: string): Promise<void> => {
    await auth.query("SELECT auth.enroll_proved_email_principal($1,$1,$2,clock_timestamp())", [subject, mailbox]);
    await auth.query("SELECT auth.activate_proved_provider_method($1,$2,$3,$4)", [provider, providerSubject, subject, mailbox]);
  };
  const providerReceipt = async (
    current: string, currentAccount: string, provider: string, providerSubject: string, proved: string,
  ): Promise<string> => {
    const handle = opaque();
    const receipt = opaque();
    attempts.push(handle);
    await auth.query(create, [handle, provider, "reauth", receiptBinding, current, currentAccount, null, null, null, null]);
    const lease = (await auth.query(claim, [handle, receiptBinding, "reauth"])).rows[0].claim_id as string;
    await auth.query(advance, [handle, lease, "provider_claimed", "provider_verifying", null]);
    await auth.query(advance, [handle, lease, "provider_verifying", "provider_proved", providerSubject]);
    await auth.query(advance, [handle, lease, "provider_proved", "provider_enrolling", providerSubject]);
    await auth.query(complete, [handle, lease, proved, receipt]);
    return receipt;
  };
  const emailReceipt = async (): Promise<string> => {
    const handle = opaque();
    const receipt = opaque();
    attempts.push(handle);
    const created = await auth.query("SELECT * FROM auth.create_email_auth_attempt($1,'web',$2,$3,$4,$4,$5,$6,'encrypted-storage-fixture')",
      [handle, receiptBinding, origin, a, email, originalTime]);
    await auth.query("SELECT auth.ready_email_auth_attempt($1,$2,'encrypted-otp-storage-fixture')", [handle, created.rows[0].claim_id]);
    const claimed = await auth.query("SELECT * FROM auth.claim_email_auth_attempt($1,$2,'web',$3,$4,$4,$5)",
      [handle, receiptBinding, origin, a, originalTime]);
    await auth.query("SELECT auth.complete_email_auth_attempt($1,$2,$3,$3,$4,$5,$6)",
      [handle, claimed.rows[0].claim_id, a, email, Math.floor(Date.now() / 1_000), receipt]);
    return receipt;
  };
  const unlinkParameters = (receipt: string, methodGeneration: string): Array<string | number | null> =>
    [a, originalTime, "google", providerC, methodGeneration, receipt, receiptBinding, "web", origin];
  const beginReenable = async (receipt: string, methodGeneration: string): Promise<string> => {
    const handle = opaque();
    attempts.push(handle);
    await auth.query(reenable, [handle, "google", providerC, methodGeneration, binding, a, originalTime,
      receipt, receiptBinding, "web", origin]);
    return handle;
  };
  const proveReenable = async (handle: string, providerSubject: string): Promise<string> => {
    const claimed = await auth.query(claim, [handle, binding, "link"]);
    const lease = claimed.rows[0].claim_id as string;
    await auth.query(advance, [handle, lease, "provider_claimed", "provider_verifying", null]);
    await auth.query(advance, [handle, lease, "provider_verifying", "provider_proved", providerSubject]);
    return lease;
  };
  const drainSessions = async (): Promise<void> => {
    for (;;) {
      const job = (await auth.query("SELECT * FROM auth.claim_apple_session_revocation()")).rows[0];
      if (job === undefined) break;
      await auth.query("SELECT auth.complete_apple_session_revocation($1,$2)", [job.job_id, job.lease_id]);
    }
    const fence = await owner.query("SELECT max(minimum_auth_time) AS minimum FROM auth.principal_session_fences WHERE subject_sha256 = ANY($1::text[])", [subjects.map(hash)]);
    const remaining = Number(fence.rows[0].minimum) * 1_000 - Date.now();
    if (remaining > 0) await delay(remaining + 10);
  };
  try {
    for (const client of [owner, auth, contender, backend, reporting]) await client.connect();
    await auth.query("SET ROLE auth_app");
    await contender.query("SET ROLE auth_app");
    await backend.query("SET ROLE backend_app");
    await reporting.query("SET ROLE reporting_readonly");
    for (const id of accounts) await owner.query("INSERT INTO org.user_settings(user_id) VALUES ($1)", [id]);
    for (const [subject, targetAccount] of [[a, account], [b, account], [c, account], [other, otherAccount], [hidden, hiddenAccount]]) {
      await owner.query("SELECT auth.bind_cognito_account($1,$2)", [subject, targetAccount]);
    }
    await auth.query("SELECT auth.enroll_proved_email_principal($1,$1,$2,clock_timestamp())", [a, email]);
    await seedMethod(b, email, "google", providerB);
    await seedMethod(c, email, "google", providerC);
    await seedMethod(other, email, "google", providerOther);
    await seedMethod(hidden, relay, "apple", apple);
    const initialGeneration = await generation("google", providerC);
    const listed = (await auth.query(list, [a, originalTime])).rows;
    assert.deepEqual(listed.map((row) => row.provider_subject).sort(), [providerB, providerC].sort());
    assert.equal(listed.find((row) => row.provider_subject === providerC)?.generation, initialGeneration);
    await assert.rejects(auth.query(list, [a, -1]), { code: "23514" });

    const receipt = await emailReceipt();
    const expected = unlinkParameters(receipt, initialGeneration);
    for (const bad of [
      [a, originalTime, "google", providerC, initialGeneration, opaque(), receiptBinding, "web", origin],
      [...expected.slice(0, 6), opaque(), "web", origin],
      [...expected.slice(0, 6), receiptBinding, "ios", null],
      [...expected.slice(0, 6), receiptBinding, "web", "https://auth.flashcards-open-source-app.com"],
      [other, originalTime, "google", providerC, initialGeneration, receipt, receiptBinding, "web", origin],
      [a, originalTime, "google", providerOther, initialGeneration, receipt, receiptBinding, "web", origin],
      [a, originalTime, "google", providerC, "2000-01-01T00:00:00Z", receipt, receiptBinding, "web", origin],
    ]) await assert.rejects(auth.query(unlink, bad), { code: "23514" });
    const unlinks = await Promise.allSettled([auth.query(unlink, expected), contender.query(unlink, expected)]);
    assert.equal(unlinks.filter((result) => result.status === "fulfilled").length, 1);
    const disabledGeneration = await generation("google", providerC);
    assert.notEqual(disabledGeneration, initialGeneration);
    assert.equal((await auth.query("SELECT auth.principal_session_status($1,$2) AS status", [c, originalTime])).rows[0].status, "pending");
    assert.equal((await auth.query("SELECT auth.principal_session_status($1,$2) AS status", [a, originalTime])).rows[0].status, "valid");
    await assert.rejects(auth.query(unlink, expected));

    const ordinary = opaque();
    attempts.push(ordinary);
    await auth.query(create, [ordinary, "google", "login", binding, null, null, null, null, null, null]);
    const ordinaryLease = (await auth.query(claim, [ordinary, binding, "login"])).rows[0].claim_id;
    await auth.query(advance, [ordinary, ordinaryLease, "provider_claimed", "provider_verifying", null]);
    await assert.rejects(auth.query(advance, [ordinary, ordinaryLease, "provider_verifying", "provider_proved", providerC]), { code: "23514" });
    await auth.query("SELECT auth.activate_proved_provider_method('google',$1,$2,$3)", [providerC, c, email]);
    assert.equal((await auth.query("SELECT * FROM auth.load_provider_login_method('google',$1)", [providerC])).rows[0].status, "disabled");
    const pendingReceipt = await emailReceipt();
    await assert.rejects(beginReenable(pendingReceipt, disabledGeneration), { code: "23514" });
    assert.equal((await auth.query(list, [a, originalTime])).rows
      .find((row) => row.provider_subject === providerC)?.revocation_pending, true);
    await drainSessions();
    assert.equal((await auth.query(list, [a, originalTime])).rows
      .find((row) => row.provider_subject === providerC)?.revocation_pending, false);
    await assert.rejects(auth.query(list, [c, originalTime]), { code: "23514" });
    const reenabling = await beginReenable(pendingReceipt, disabledGeneration);
    await assert.rejects(beginReenable(pendingReceipt, disabledGeneration), { code: "23514" });
    assert.equal((await auth.query(claim, [reenabling, opaque(), "link"])).rowCount, 0);
    const lease = (await auth.query(claim, [reenabling, binding, "link"])).rows[0].claim_id as string;
    assert.equal((await auth.query(claim, [reenabling, binding, "link"])).rowCount, 0);
    await auth.query(advance, [reenabling, lease, "provider_claimed", "provider_verifying", null]);
    await assert.rejects(auth.query(advance, [reenabling, lease, "provider_verifying", "provider_proved", providerB]), { code: "23514" });
    await auth.query(advance, [reenabling, lease, "provider_verifying", "provider_proved", providerC]);
    await assert.rejects(auth.query(complete, [reenabling, lease, c, opaque()]), { code: "23514" });
    const finish = [a, originalTime, reenabling, lease, binding, providerC, "google-client-fixture", null];
    await assert.rejects(auth.query(finishReenable, [a, originalTime, reenabling, lease, opaque(), providerC, "google-client-fixture", null]), { code: "23514" });
    await assert.rejects(auth.query(finishReenable, [other, originalTime, reenabling, lease, binding, providerC, "google-client-fixture", null]), { code: "23514" });
    const completions = await Promise.allSettled([auth.query(finishReenable, finish), contender.query(finishReenable, finish)]);
    assert.equal(completions.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal((await auth.query("SELECT * FROM auth.load_provider_login_method('google',$1)", [providerC])).rows[0].status, "active");
    assert.notEqual(await generation("google", providerC), disabledGeneration);
    await assert.rejects(auth.query(finishReenable, finish));
    assert.equal((await owner.query("SELECT phase, secret_ciphertext FROM auth.social_attempts WHERE attempt_sha256 = $1",
      [reenabling])).rows[0].secret_ciphertext, "erased");

    const compatibleLogin = opaque();
    attempts.push(compatibleLogin);
    await auth.query(create, [compatibleLogin, "google", "login", binding, null, null, null, null, null, null]);
    const loginLease = (await auth.query(claim, [compatibleLogin, binding, "login"])).rows[0].claim_id;
    await auth.query(advance, [compatibleLogin, loginLease, "provider_claimed", "provider_verifying", null]);
    await auth.query(advance, [compatibleLogin, loginLease, "provider_verifying", "provider_proved", providerC]);
    await auth.query(advance, [compatibleLogin, loginLease, "provider_proved", "provider_enrolling", providerC]);
    const loginCompletion = opaque();
    await auth.query(complete, [compatibleLogin, loginLease, c, loginCompletion]);
    assert.equal((await auth.query("SELECT * FROM auth.redeem_social_completion($1,$2,'login','ios',NULL)",
      [loginCompletion, binding])).rows[0].cognito_subject, c);

    // Current A, target C and reauthentication alias B all belong to the same stable account.
    const aliasReceipt = await providerReceipt(a, account, "google", providerB, b);
    await auth.query("SELECT auth.invalidate_principal_sessions($1,$2)", [b, randomUUID()]);
    await assert.rejects(auth.query(unlink, [a, originalTime, "google", providerC, await generation("google", providerC),
      aliasReceipt, receiptBinding, "ios", null]), { code: "23514" });
    await drainSessions();
    const expiredReceipt = await emailReceipt();
    await owner.query("UPDATE auth.social_attempts SET completion_expires_at = clock_timestamp() - INTERVAL '1 second' WHERE completion_sha256 = $1", [expiredReceipt]);
    await assert.rejects(auth.query(unlink, unlinkParameters(expiredReceipt, await generation("google", providerC))), { code: "23514" });

    const freshReceipt = await emailReceipt();
    await auth.query(unlink, unlinkParameters(freshReceipt, await generation("google", providerC)));
    await drainSessions();
    const genericLink = opaque();
    attempts.push(genericLink);
    const genericReceipt = await emailReceipt();
    await auth.query(create, [genericLink, "google", "link", binding, a, account, genericReceipt, receiptBinding, "web", origin]);
    const genericLease = (await auth.query(claim, [genericLink, binding, "link"])).rows[0].claim_id;
    await auth.query(advance, [genericLink, genericLease, "provider_claimed", "provider_verifying", null]);
    await assert.rejects(auth.query(advance, [genericLink, genericLease, "provider_verifying", "provider_proved", providerC]), { code: "23514" });
    const expiredReenable = await beginReenable(await emailReceipt(), await generation("google", providerC));
    await owner.query("UPDATE auth.social_attempts SET expires_at = clock_timestamp() - INTERVAL '1 second' WHERE attempt_sha256 = $1", [expiredReenable]);
    assert.equal((await auth.query(claim, [expiredReenable, binding, "link"])).rowCount, 0);
    const staleReenable = await beginReenable(await emailReceipt(), await generation("google", providerC));
    const staleLease = await proveReenable(staleReenable, providerC);
    await auth.query("SELECT auth.invalidate_principal_sessions($1,$2)", [c, randomUUID()]);
    await drainSessions();
    await assert.rejects(auth.query(finishReenable, [a, originalTime, staleReenable, staleLease, binding, providerC, "google-client-fixture", null]), { code: "23514" });

    const appleReceipt = await providerReceipt(hidden, hiddenAccount, "apple", apple, hidden);
    const hiddenUnlink = [hidden, originalTime, "apple", apple, await generation("apple", apple), appleReceipt, receiptBinding, "ios", null];
    await assert.rejects(auth.query(unlink, hiddenUnlink), /last usable method/);
    await seedMethod(hidden, relay, "google", hiddenGoogle);
    const ciphertext = "v1." + "A".repeat(16) + "." + "B".repeat(22) + "." + "C".repeat(20);
    await auth.query("SELECT auth.store_apple_credential($1,$2,'apple-client-fixture',$3)", [hidden, apple, ciphertext]);
    const competingReceipt = await providerReceipt(hidden, hiddenAccount, "apple", apple, hidden);
    await auth.query("BEGIN");
    await auth.query(unlink, hiddenUnlink);
    const competingUnlink = Promise.allSettled([contender.query(unlink, [hidden, originalTime, "google", hiddenGoogle,
      await generation("google", hiddenGoogle), competingReceipt, receiptBinding, "ios", null])]);
    await auth.query("COMMIT");
    assert.equal((await competingUnlink)[0]?.status, "rejected");
    assert.equal((await owner.query("SELECT status FROM auth.provider_login_methods WHERE provider_subject = $1", [hiddenGoogle])).rows[0].status, "active");
    assert.equal((await auth.query("SELECT auth.apple_revocation_pending($1) AS pending", [apple])).rows[0].pending, true);
    const revocation = (await auth.query("SELECT * FROM auth.claim_apple_revocation()")).rows[0];
    assert.equal(revocation.provider_subject, apple);
    await auth.query("SELECT auth.complete_apple_revocation($1,$2,$3)", [revocation.job_id, revocation.lease_id, ciphertext]);
    await drainSessions();
    const hiddenTime = Number((await owner.query("SELECT minimum_auth_time FROM auth.principal_session_fences WHERE subject_sha256 = $1", [hash(hidden)])).rows[0].minimum_auth_time);
    const lastGoogleReceipt = await providerReceipt(hidden, hiddenAccount, "google", hiddenGoogle, hidden);
    await assert.rejects(auth.query(unlink, [hidden, hiddenTime, "google", hiddenGoogle, await generation("google", hiddenGoogle),
      lastGoogleReceipt, receiptBinding, "ios", null]), /last usable method/);

    const appleReenable = opaque();
    attempts.push(appleReenable);
    await auth.query(reenable, [appleReenable, "apple", apple, await generation("apple", apple), binding, hidden, hiddenTime,
      lastGoogleReceipt, receiptBinding, "ios", null]);
    const appleLease = await proveReenable(appleReenable, apple);
    await assert.rejects(auth.query(finishReenable, [hidden, hiddenTime, appleReenable, appleLease, binding, apple, "apple-client-fixture", null]), { code: "23514" });
    await auth.query(finishReenable, [hidden, hiddenTime, appleReenable, appleLease, binding, apple, "apple-client-fixture", ciphertext]);
    assert.equal((await auth.query("SELECT * FROM auth.load_provider_login_method('apple',$1)", [apple])).rows[0].status, "active");

    // New metadata commits first; the existing linker owns the first identity mutation and receipt.
    await seedMethod(newSubject, email, "google", providerNew);
    const linkReceipt = await emailReceipt();
    const linking = opaque();
    const linkCompletion = opaque();
    attempts.push(linking);
    await auth.query(create, [linking, "google", "link", binding, a, account, linkReceipt, receiptBinding, "web", origin]);
    const linkLease = await proveReenable(linking, providerNew);
    await auth.query(advance, [linking, linkLease, "provider_proved", "provider_enrolling", providerNew]);
    await auth.query(complete, [linking, linkLease, newSubject, linkCompletion]);
    const redeemLink = "SELECT auth.redeem_account_provider_link($1,$1,$2,$3,$4,'ios',NULL)";
    await assert.rejects(auth.query(redeemLink, [other, originalTime, linkCompletion, binding]), { code: "23514" });
    await assert.rejects(auth.query(redeemLink, [a, originalTime, linkCompletion, opaque()]), { code: "55006" });
    await auth.query(redeemLink, [a, originalTime, linkCompletion, binding]);
    assert.equal((await owner.query("SELECT user_id FROM auth.user_identities WHERE provider_type = 'cognito' AND provider_subject = $1", [newSubject])).rows[0].user_id, account);
    await assert.rejects(auth.query(redeemLink, [a, originalTime, linkCompletion, binding]), { code: "55006" });
    const otherLink = opaque();
    attempts.push(otherLink);
    await auth.query(create, [otherLink, "google", "link", binding, a, account, await emailReceipt(), receiptBinding, "web", origin]);
    const otherLease = await proveReenable(otherLink, providerOther);
    await auth.query(advance, [otherLink, otherLease, "provider_proved", "provider_enrolling", providerOther]);
    await assert.rejects(auth.query(complete, [otherLink, otherLease, other, opaque()]), { code: "23514" });
    assert.equal((await owner.query("SELECT user_id FROM auth.user_identities WHERE provider_subject = $1", [other])).rows[0].user_id, otherAccount);

    const bReceipt = await providerReceipt(a, account, "google", providerB, b);
    const authPid = (await auth.query("SELECT pg_backend_pid() AS pid")).rows[0].pid as number;
    await contender.query("BEGIN");
    await contender.query("SET LOCAL statement_timeout = '5s'");
    await contender.query("SELECT pg_advisory_xact_lock(hashtextextended('auth.cognito_identity:' || $1,2::bigint))", [b]);
    await auth.query("BEGIN");
    await auth.query("SET LOCAL statement_timeout = '5s'");
    const awaitingB = Promise.allSettled([auth.query(unlink, [a, originalTime, "google", providerNew,
      await generation("google", providerNew), bReceipt, receiptBinding, "ios", null])]);
    let waiting = false;
    for (let poll = 0; poll < 100; poll += 1) {
      if ((await owner.query("SELECT 1 FROM pg_stat_activity WHERE pid = $1 AND wait_event = 'advisory'", [authPid])).rowCount === 1) {
        waiting = true;
        break;
      }
      await delay(10);
    }
    assert.equal(waiting, true);
    // Holding B must not prevent an independent B-first operation from acquiring the account.
    await contender.query("SELECT auth.lock_account_lifecycle($1)", [account]);
    await contender.query("COMMIT");
    assert.equal((await awaitingB)[0]?.status, "fulfilled");
    await auth.query("COMMIT");
    assert.equal((await auth.query(list, [a, originalTime])).rows.find((row) => row.provider_subject === providerNew)?.status, "disabled");
    await owner.query("INSERT INTO auth.deleted_subjects(subject_sha256) VALUES ($1)", [hash(a)]);
    await assert.rejects(auth.query(list, [a, originalTime]), { code: "23514" });
    await owner.query("DELETE FROM auth.deleted_subjects WHERE subject_sha256 = $1", [hash(a)]);

    for (const client of [backend, reporting]) {
      await assert.rejects(client.query(list, [a, originalTime]), { code: "42501" });
      await assert.rejects(client.query(unlink, expected), { code: "42501" });
      await assert.rejects(client.query(finishReenable, finish), { code: "42501" });
      await assert.rejects(client.query(redeemLink, [a, originalTime, linkCompletion, binding]), { code: "42501" });
    }
    for (const sql of [
      "SELECT * FROM auth.social_attempts",
      "SELECT auth.authorize_account_provider_action($1,$1,$2,'google',$3,$4,$5,'web',$6)",
      "SELECT auth.advance_standard_attempt($1,$2,'provider_claimed','provider_verifying','fixture',NULL)",
    ]) await assert.rejects(sql.includes("authorize_")
      ? auth.query(sql, [a, originalTime, providerC, receipt, receiptBinding, origin])
      : sql.includes("advance_") ? auth.query(sql, [reenabling, lease]) : auth.query(sql), { code: "42501" });
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
      await owner.query("DELETE FROM org.user_settings WHERE user_id = ANY($1::text[])", [accounts]);
    } finally {
      await owner.end();
    }
  }
});
