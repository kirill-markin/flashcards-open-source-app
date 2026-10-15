import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";

const opaque = (): string => randomBytes(32).toString("hex");
const hash = (value: string): string => createHash("sha256").update(value).digest("hex");
const create = "SELECT * FROM auth.create_email_auth_attempt($1,$2,$3,$4,$5,$6,$7,$8,$9)";
const ready = "SELECT auth.ready_email_auth_attempt($1,$2,'encrypted-otp-session-storage-fixture')";
const claim = "SELECT * FROM auth.claim_email_auth_attempt($1,$2,$3,$4,$5,$6,$7)";
const complete = "SELECT auth.complete_email_auth_attempt($1,$2,$3,$4,$5,$6,$7)";
const redeem = "SELECT * FROM auth.redeem_social_completion($1,$2,'reauth',$3,$4)";
const createLink = "SELECT auth.create_social_attempt($1,'google','ios','link',$2,NULL,NULL,$3,$4,'encrypted-storage-fixture',$5,$6,$7,$8)";

test("current email reauthentication shares real PostgreSQL one-use receipts and provider lifecycle locks", async () => {
  const ownerUrl = process.env.TEST_DATABASE_ADMIN_URL;
  if (ownerUrl === undefined) throw new Error("TEST_DATABASE_ADMIN_URL is required");
  const owner = new pg.Client({ connectionString: ownerUrl });
  const auth = new pg.Client({ connectionString: ownerUrl });
  const contender = new pg.Client({ connectionString: ownerUrl });
  const backend = new pg.Client({ connectionString: ownerUrl });
  const reporting = new pg.Client({ connectionString: ownerUrl });
  const subject = randomUUID();
  const alias = randomUUID();
  const newSubject = randomUUID();
  const unattached = randomUUID();
  const account = randomUUID();
  const username = "immutable-" + randomUUID();
  const email = randomUUID() + "@mail.test";
  const origin = "https://auth.nibomo.com";
  const binding = opaque();
  const newBinding = opaque();
  const provider = "email-reauth-storage-" + randomUUID();
  const authTime = Math.floor(Date.now() / 1_000) - 300;
  const attempts: Array<string> = [];
  const begin = async (originalTime: number | null): Promise<Readonly<{ handle: string; lease: string }>> => {
    const handle = opaque();
    attempts.push(handle);
    const result = await auth.query(create, [handle, "web", binding, origin, subject, username, email, originalTime, "encrypted-initial-state"]);
    const lease = result.rows[0].claim_id as string;
    assert.equal(result.rows[0].provider_type, null);
    assert.equal(result.rows[0].current_account, account);
    await auth.query(ready, [handle, lease]);
    return { handle, lease };
  };
  const claimParameters = (handle: string, originalTime: number | null): Array<string | number | null> =>
    [handle, binding, "web", origin, subject, username, originalTime];
  const finish = async (originalTime: number | null): Promise<Readonly<{ handle: string; receipt: string }>> => {
    const attempt = await begin(originalTime);
    const lease = (await auth.query(claim, claimParameters(attempt.handle, originalTime))).rows[0].claim_id as string;
    const receipt = opaque();
    await auth.query(complete, [attempt.handle, lease, subject, username, email, Math.floor(Date.now() / 1_000), receipt]);
    return { handle: attempt.handle, receipt };
  };
  try {
    for (const client of [owner, auth, contender, backend, reporting]) await client.connect();
    await auth.query("SET ROLE auth_app");
    await contender.query("SET ROLE auth_app");
    await backend.query("SET ROLE backend_app");
    await reporting.query("SET ROLE reporting_readonly");
    await owner.query("INSERT INTO org.user_settings(user_id) VALUES ($1)", [account]);
    await owner.query("SELECT auth.bind_cognito_account($1,$2)", [subject, account]);
    // Internal storage fixtures exercise no fabricated Cognito token or public proof bypass.
    // Legacy email-only accounts need not have provider enrollment or principal metadata yet.
    assert.equal((await owner.query("SELECT 1 FROM auth.cognito_principals WHERE cognito_subject = $1", [subject])).rowCount, 0);
    const pending = await begin(null);
    assert.equal((await owner.query("SELECT 1 FROM auth.cognito_principals WHERE cognito_subject = $1", [subject])).rowCount, 1);
    await assert.rejects(auth.query(ready, [pending.handle, pending.lease]), { code: "55006" });
    const expected = claimParameters(pending.handle, null);
    for (const wrong of [
      [pending.handle, opaque(), "web", origin, subject, username, null],
      [pending.handle, binding, "ios", null, subject, username, null],
      [pending.handle, binding, "web", "https://auth.flashcards-open-source-app.com", subject, username, null],
      [pending.handle, binding, "web", origin, alias, username, null],
      [pending.handle, binding, "web", origin, subject, "wrong-username", null],
      [pending.handle, binding, "web", origin, subject, username, authTime],
    ]) assert.equal((await auth.query(claim, wrong)).rowCount, 0);
    const claims = await Promise.all([auth.query(claim, expected), contender.query(claim, expected)]);
    assert.deepEqual(claims.map((result) => result.rowCount).sort(), [0, 1]);
    const lease = claims.find((result) => result.rowCount === 1)?.rows[0].claim_id as string;
    assert.ok(lease);
    assert.equal((await auth.query(claim, expected)).rowCount, 0);
    await assert.rejects(auth.query("SELECT auth.complete_social_attempt($1,$2,$3,$4,$5)",
      [pending.handle, lease, subject, username, opaque()]), { code: "23514" });
    for (const invalid of [
      [pending.handle, lease, alias, username, email, Math.floor(Date.now() / 1_000), opaque()],
      [pending.handle, lease, subject, "wrong-username", email, Math.floor(Date.now() / 1_000), opaque()],
      [pending.handle, lease, subject, username, "new@" + email, Math.floor(Date.now() / 1_000), opaque()],
      [pending.handle, lease, subject, username, email, authTime, opaque()],
    ]) await assert.rejects(auth.query(complete, invalid), { code: "23514" });
    const receipt = opaque();
    await auth.query(complete, [pending.handle, lease, subject, username, email, Math.floor(Date.now() / 1_000), receipt]);
    await assert.rejects(auth.query(complete, [pending.handle, lease, subject, username, email, Math.floor(Date.now() / 1_000), opaque()]), { code: "55006" });
    assert.equal((await auth.query(redeem, [receipt, newBinding, "web", origin])).rowCount, 0);
    assert.equal((await auth.query(redeem, [receipt, binding, "ios", null])).rowCount, 0);
    const redeemed = await Promise.all([
      auth.query(redeem, [receipt, binding, "web", origin]),
      contender.query(redeem, [receipt, binding, "web", origin]),
    ]);
    assert.deepEqual(redeemed.map((result) => result.rowCount).sort(), [0, 1]);
    const accepted = redeemed.find((result) => result.rowCount === 1)?.rows[0];
    assert.deepEqual(accepted, { cognito_subject: subject, cognito_username: username,
      current_subject: subject, current_account: account, purpose: "reauth" });
    assert.equal((await owner.query("SELECT secret_ciphertext FROM auth.social_attempts WHERE attempt_sha256 = $1", [pending.handle])).rows[0].secret_ciphertext, "erased");

    const expired = await begin(authTime);
    await owner.query("UPDATE auth.social_attempts SET expires_at = clock_timestamp() - INTERVAL '1 second' WHERE attempt_sha256 = $1", [expired.handle]);
    assert.equal((await auth.query(claim, claimParameters(expired.handle, authTime))).rowCount, 0);
    const expiredReceipt = await finish(authTime);
    await owner.query("UPDATE auth.social_attempts SET completion_expires_at = clock_timestamp() - INTERVAL '1 second' WHERE attempt_sha256 = $1", [expiredReceipt.handle]);
    assert.equal((await auth.query(redeem, [expiredReceipt.receipt, binding, "web", origin])).rowCount, 0);

    const linkReceipt = await finish(authTime);
    const link = opaque();
    attempts.push(link);
    const linkParameters = [link, newBinding, subject, account, linkReceipt.receipt, binding, "web", origin];
    await assert.rejects(auth.query(createLink, [...linkParameters.slice(0, 5), newBinding, "web", origin]), { code: "23514" });
    await assert.rejects(auth.query(createLink, [...linkParameters.slice(0, 5), binding, "ios", null]), { code: "23514" });
    await assert.rejects(auth.query(createLink, [...linkParameters.slice(0, 5), binding, "web", "https://app.nibomo.com"]), { code: "23514" });
    await auth.query(createLink, linkParameters);
    await assert.rejects(auth.query(createLink, [opaque(), ...linkParameters.slice(1)]), { code: "23514" });
    // Metadata registration commits before the existing link function's first identity mutation.
    await auth.query("SELECT auth.enroll_proved_email_principal($1,$1,$2,clock_timestamp())", [newSubject, email]);
    await auth.query("SELECT auth.activate_proved_provider_method('google',$1,$2,$3)", [provider, newSubject, email]);
    const linkLease = (await auth.query("SELECT * FROM auth.claim_social_attempt($1,$2,'link','ios',NULL,'provider_ready')", [link, newBinding])).rows[0].claim_id;
    for (const [from, to, providerSubject] of [
      ["provider_claimed", "provider_verifying", null],
      ["provider_verifying", "provider_proved", provider],
      ["provider_proved", "provider_enrolling", provider],
    ]) await auth.query("SELECT auth.advance_social_attempt($1,$2,$3,$4,'encrypted-storage-fixture',$5)", [link, linkLease, from, to, providerSubject]);
    const linkCompletion = opaque();
    await auth.query("SELECT auth.complete_social_attempt($1,$2,$3,$3,$4)", [link, linkLease, newSubject, linkCompletion]);
    assert.equal((await auth.query("SELECT * FROM auth.redeem_social_completion($1,$2,'link','ios',NULL)", [linkCompletion, newBinding])).rowCount, 0);
    await auth.query("BEGIN");
    const linked = await auth.query("SELECT * FROM auth.link_and_redeem_social_completion($1,$2,'ios',NULL)", [linkCompletion, newBinding]);
    await auth.query("COMMIT");
    assert.equal(linked.rows[0].current_account, account);
    assert.equal((await owner.query("SELECT user_id FROM auth.user_identities WHERE provider_type = 'cognito' AND provider_subject = $1", [newSubject])).rows[0].user_id, account);
    assert.equal((await owner.query("SELECT 1 FROM org.user_settings WHERE user_id = $1", [newSubject])).rowCount, 0);

    const staleGeneration = await begin(authTime);
    await owner.query("UPDATE auth.cognito_principals SET created_at = created_at + INTERVAL '1 second' WHERE cognito_subject = $1", [subject]);
    await assert.rejects(auth.query(claim, claimParameters(staleGeneration.handle, authTime)), { code: "23514" });
    const changedAccount = await begin(authTime);
    await owner.query("UPDATE auth.social_attempts SET current_account = $1, snapshot_account = $1 WHERE attempt_sha256 = $2", [randomUUID(), changedAccount.handle]);
    await assert.rejects(auth.query(claim, claimParameters(changedAccount.handle, authTime)), { code: "23514" });
    const staleClaim = await begin(authTime);
    const staleReceipt = await finish(authTime);
    await auth.query("SELECT auth.invalidate_principal_sessions($1,$2)", [subject, randomUUID()]);
    await assert.rejects(auth.query(claim, claimParameters(staleClaim.handle, authTime)), { code: "23514" });
    await assert.rejects(auth.query(redeem, [staleReceipt.receipt, binding, "web", origin]), { code: "23514" });
    await assert.rejects(begin(null), { code: "23514" });
    const job = (await auth.query("SELECT * FROM auth.claim_apple_session_revocation()")).rows[0];
    await auth.query("SELECT auth.complete_apple_session_revocation($1,$2)", [job.job_id, job.lease_id]);
    await assert.rejects(begin(authTime), { code: "23514" });
    const minimum = Number((await owner.query("SELECT minimum_auth_time FROM auth.principal_session_fences WHERE subject_sha256 = $1", [hash(subject)])).rows[0].minimum_auth_time);
    const freshAfterFence = await begin(minimum);
    assert.equal((await auth.query(claim, claimParameters(freshAfterFence.handle, minimum))).rowCount, 1);
    await owner.query("INSERT INTO auth.deleted_subjects(subject_sha256) VALUES ($1)", [hash(subject)]);
    await assert.rejects(auth.query(complete, [freshAfterFence.handle, (await owner.query("SELECT claim_id FROM auth.social_attempts WHERE attempt_sha256 = $1", [freshAfterFence.handle])).rows[0].claim_id,
      subject, username, email, minimum, opaque()]), { code: "23514" });

    await assert.rejects(auth.query(create, [opaque(), "ios", binding, null, unattached, unattached, email, null, "encrypted-fixture"]), { code: "23514" });
    await assert.rejects(backend.query(create, [opaque(), "ios", binding, null, subject, username, email, null, "encrypted-fixture"]), { code: "42501" });
    await assert.rejects(backend.query(complete, [pending.handle, lease, subject, username, email, minimum, opaque()]), { code: "42501" });
    await assert.rejects(reporting.query(claim, expected), { code: "42501" });
    await assert.rejects(auth.query("SELECT * FROM auth.social_attempts"), { code: "42501" });
    await assert.rejects(auth.query("SELECT auth.complete_provider_attempt($1,$2,$3,$4,$5)",
      [pending.handle, lease, subject, username, opaque()]), { code: "42501" });
    assert.equal((await owner.query("SELECT 1 FROM auth.provider_identities WHERE cognito_subject = $1", [subject])).rowCount, 0);
    assert.equal((await owner.query("SELECT 1 FROM auth.provider_login_methods WHERE cognito_subject = $1", [subject])).rowCount, 0);
    assert.equal((await owner.query("SELECT 1 FROM auth.verified_login_emails WHERE cognito_subject = $1", [subject])).rowCount, 0);
  } finally {
    await Promise.all([auth.end(), contender.end(), backend.end(), reporting.end()]);
    try {
      await owner.query("DELETE FROM auth.social_attempts WHERE attempt_sha256 = ANY($1::text[])", [attempts]);
      await owner.query("DELETE FROM auth.cognito_principals WHERE cognito_subject = ANY($1::text[])", [[subject, alias, newSubject, unattached]]);
      await owner.query("DELETE FROM auth.apple_session_revocation_jobs WHERE subject_sha256 = $1", [hash(subject)]);
      await owner.query("DELETE FROM auth.principal_session_fences WHERE subject_sha256 = $1", [hash(subject)]);
      await owner.query("DELETE FROM auth.deleted_subjects WHERE subject_sha256 = $1", [hash(subject)]);
      await owner.query("DELETE FROM org.user_settings WHERE user_id = $1", [account]);
    } finally {
      await owner.end();
    }
  }
});
