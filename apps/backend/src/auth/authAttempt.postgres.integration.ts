import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import pg from "pg";

const hash = (value: string): string => createHash("sha256").update(value).digest("hex");
const opaque = (): string => randomBytes(32).toString("hex");
const create = "SELECT auth.create_social_attempt($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)";
const claim = "SELECT * FROM auth.claim_social_attempt($1,$2,$3,$4,$5,$6)";
const advance = "SELECT auth.advance_social_attempt($1,$2,$3,$4,$5,$6)";
const complete = "SELECT auth.complete_social_attempt($1,$2,$3,$4,$5)";
const loadMailbox = "SELECT * FROM auth.load_social_mailbox_attempt($1,$2,$3,$4,$5)";
const linkRedeem = "SELECT * FROM auth.link_and_redeem_social_completion($1,$2,$3,$4)";
const redeem = "SELECT * FROM auth.redeem_social_completion($1,$2,$3,$4,$5)";

test("auth attempts enforce real PostgreSQL claims, purpose, lifecycle, one-use receipts and privileges", async () => {
  const ownerUrl = process.env.TEST_DATABASE_ADMIN_URL;
  if (ownerUrl === undefined) throw new Error("TEST_DATABASE_ADMIN_URL is required");
  const owner = new pg.Pool({ connectionString: ownerUrl });
  const runtime = new pg.Client({ connectionString: ownerUrl });
  const contender = new pg.Client({ connectionString: ownerUrl });
  const backend = new pg.Client({ connectionString: ownerUrl });
  const reporting = new pg.Client({ connectionString: ownerUrl });
  const subject = randomUUID();
  const other = randomUUID();
  const account = randomUUID();
  const linkedSubject = randomUUID();
  const deletedSubject = randomUUID();
  const replacementSubject = randomUUID();
  const deletedAccount = randomUUID();
  const aliasProvider = "storage-alias-" + randomUUID();
  const linkedProvider = "storage-linked-" + randomUUID();
  const recycledProvider = "storage-recycled-" + randomUUID();
  const providerSubject = "storage-google-" + randomUUID();
  const appleSubject = "storage-apple-" + randomUUID();
  const attempts: Array<string> = [];
  const bucket = opaque();
  const binding = hash(randomBytes(32).toString("base64url"));
  const email = "storage-" + randomUUID() + "@mail.test";
  const seed = async (purpose: "login" | "reauth" | "link", reauth: string | null, client: pg.Client): Promise<string> => {
    const attempt = opaque();
    attempts.push(attempt);
    await client.query(create, [attempt, "google", "ios", purpose, binding, null, null,
      purpose === "login" ? null : subject, purpose === "login" ? null : account, "encrypted-storage-fixture", reauth, purpose === "link" ? binding : null, purpose === "link" ? "ios" : null, null]);
    return attempt;
  };
  // SQL fixtures exercise storage authority only; no fake token is passed to a provider verifier.
  const prove = async (
    attempt: string, purpose: string, provider: string, attemptBinding: string, client: string, origin: string | null,
  ): Promise<string> => {
    const row = (await runtime.query(claim, [attempt, attemptBinding, purpose, client, origin, "provider_ready"])).rows[0];
    assert.ok(row);
    await runtime.query(advance, [attempt, row.claim_id, "provider_claimed", "provider_verifying", "encrypted-fixture", null]);
    await runtime.query(advance, [attempt, row.claim_id, "provider_verifying", "provider_proved", "encrypted-fixture", provider]);
    return row.claim_id as string;
  };
  const finish = async (attempt: string, purpose: string): Promise<string> => {
    const claimId = await prove(attempt, purpose, providerSubject, binding, "ios", null);
    await runtime.query(advance, [attempt, claimId, "provider_proved", "provider_enrolling", "encrypted-fixture", providerSubject]);
    const receipt = opaque();
    await runtime.query(complete, [attempt, claimId, subject, subject, receipt]);
    return receipt;
  };
  try {
    await runtime.connect();
    await runtime.query("SET ROLE auth_app");
    await contender.connect();
    await contender.query("SET ROLE auth_app");
    await backend.connect();
    await backend.query("SET ROLE backend_app");
    await reporting.connect();
    await reporting.query("SET ROLE reporting_readonly");
    for (const principal of [subject, other, linkedSubject, deletedSubject, replacementSubject]) {
      await runtime.query("SELECT auth.enroll_proved_email_principal($1,$1,$2,$3)", [principal, email, new Date()]);
    }
    await runtime.query("SELECT auth.activate_proved_provider_method('google',$1,$2,$3)", [providerSubject, subject, email]);
    await runtime.query("SELECT auth.activate_proved_provider_method('apple',$1,$2,$3)", [appleSubject, subject, email]);
    assert.equal((await owner.query("SELECT 1 FROM org.user_settings WHERE user_id = ANY($1::text[])", [[subject, other]])).rowCount, 0);

    const raced = await seed("login", null, runtime);
    for (const wrong of [
      [raced, opaque(), "login", "ios", null, "provider_ready"],
      [raced, binding, "reauth", "ios", null, "provider_ready"],
      [raced, binding, "login", "android", null, "provider_ready"],
      [raced, binding, "login", "ios", "https://auth.nibomo.com", "provider_ready"],
    ]) assert.equal((await runtime.query(claim, wrong)).rowCount, 0);
    const claims = await Promise.all([
      runtime.query(claim, [raced, binding, "login", "ios", null, "provider_ready"]),
      contender.query(claim, [raced, binding, "login", "ios", null, "provider_ready"]),
    ]);
    assert.deepEqual(claims.map((result) => result.rowCount).sort(), [0, 1]);
    const lease = claims.find((result) => result.rowCount === 1)?.rows[0].claim_id;
    assert.ok(lease);
    await assert.rejects(runtime.query(complete, [raced, lease, subject, subject, opaque()]), { code: "55006" });
    const external = await Promise.allSettled([
      runtime.query(advance, [raced, lease, "provider_claimed", "provider_verifying", "encrypted-fixture", null]),
      contender.query(advance, [raced, lease, "provider_claimed", "provider_verifying", "encrypted-fixture", null]),
    ]);
    assert.equal(external.filter((result) => result.status === "fulfilled").length, 1);
    // A consumed external step is never reclaimed after an ambiguous success/DB failure.
    assert.equal((await runtime.query(claim, [raced, binding, "login", "ios", null, "provider_ready"])).rowCount, 0);
    await assert.rejects(runtime.query(advance, [raced, lease, "provider_verifying", "provider_ready", "encrypted-fixture", null]), { code: "23514" });

    await runtime.query(advance, [raced, lease, "provider_verifying", "provider_proved", "encrypted-fixture", providerSubject]);
    await runtime.query(advance, [raced, lease, "provider_proved", "provider_enrolling", "encrypted-fixture", providerSubject]);
    assert.equal((await runtime.query(loadMailbox, [raced, binding, "login", "ios", null])).rowCount, 0);
    await assert.rejects(runtime.query(advance, [raced, lease, "provider_enrolling", "mailbox_sending", "encrypted-fixture", providerSubject]), { code: "23514" });
    const completions = await Promise.allSettled([
      runtime.query(complete, [raced, lease, subject, subject, opaque()]),
      contender.query(complete, [raced, lease, subject, subject, opaque()]),
    ]);
    assert.equal(completions.filter((result) => result.status === "fulfilled").length, 1);

    const expired = await seed("login", null, runtime);
    await owner.query("UPDATE auth.social_attempts SET expires_at = clock_timestamp() - INTERVAL '1 second' WHERE attempt_sha256 = $1", [expired]);
    assert.equal((await runtime.query(claim, [expired, binding, "login", "ios", null, "provider_ready"])).rowCount, 0);
    const issued = await seed("login", null, runtime);
    const receipt = await finish(issued, "login");
    assert.equal((await runtime.query(redeem, [receipt, opaque(), "login", "ios", null])).rowCount, 0);
    assert.equal((await runtime.query(redeem, [receipt, binding, "link", "ios", null])).rowCount, 0);
    const redemptions = await Promise.all([
      runtime.query(redeem, [receipt, binding, "login", "ios", null]),
      contender.query(redeem, [receipt, binding, "login", "ios", null]),
    ]);
    assert.deepEqual(redemptions.map((result) => result.rowCount).sort(), [0, 1]);
    assert.equal(redemptions.find((result) => result.rowCount === 1)?.rows[0].cognito_subject, subject);
    assert.equal((await owner.query("SELECT secret_ciphertext FROM auth.social_attempts WHERE attempt_sha256 = $1", [issued])).rows[0].secret_ciphertext, "erased");

    const mailbox = await seed("login", null, runtime);
    const mailboxClaim = (await runtime.query(claim, [mailbox, binding, "login", "ios", null, "provider_ready"])).rows[0].claim_id;
    for (const [from, to, provider] of [
      ["provider_claimed", "provider_verifying", null], ["provider_verifying", "provider_proved", providerSubject],
      ["provider_proved", "provider_enrolling", providerSubject], ["provider_enrolling", "mailbox_required", providerSubject],
      ["mailbox_required", "mailbox_sending", providerSubject], ["mailbox_sending", "mailbox_ready", providerSubject],
    ]) await runtime.query(advance, [mailbox, mailboxClaim, from, to, "encrypted-fixture", provider]);
    const otpClaims = await Promise.all([
      runtime.query(claim, [mailbox, binding, "login", "ios", null, "mailbox_ready"]),
      contender.query(claim, [mailbox, binding, "login", "ios", null, "mailbox_ready"]),
    ]);
    assert.deepEqual(otpClaims.map((result) => result.rowCount).sort(), [0, 1]);
    const otpLease = otpClaims.find((result) => result.rowCount === 1)?.rows[0].claim_id;
    await runtime.query(advance, [mailbox, otpLease, "mailbox_claimed", "mailbox_verifying", "encrypted-fixture", providerSubject]);
    await assert.rejects(runtime.query(advance, [mailbox, otpLease, "mailbox_claimed", "mailbox_verifying", "encrypted-fixture", providerSubject]), { code: "55006" });

    const definitive = await seed("login", null, runtime);
    const definitiveClaim = await prove(definitive, "login", providerSubject, binding, "ios", null);
    await runtime.query(advance, [definitive, definitiveClaim, "provider_proved", "provider_enrolling", "encrypted-fixture", providerSubject]);
    await runtime.query(advance, [definitive, definitiveClaim, "provider_enrolling", "mailbox_required", "encrypted-fixture", providerSubject]);
    assert.equal((await runtime.query(loadMailbox, [definitive, binding, "login", "ios", null])).rowCount, 1);
    await assert.rejects(runtime.query(complete, [definitive, definitiveClaim, subject, subject, opaque()]), { code: "55006" });
    await assert.rejects(runtime.query(advance, [definitive, definitiveClaim, "mailbox_required", "provider_enrolling", "encrypted-fixture", providerSubject]), { code: "23514" });

    const generationAttempt = await seed("login", null, runtime);
    const generationClaim = await prove(generationAttempt, "login", providerSubject, binding, "ios", null);
    await runtime.query(advance, [generationAttempt, generationClaim, "provider_proved", "provider_enrolling", "encrypted-fixture", providerSubject]);
    await owner.query("UPDATE auth.provider_login_methods SET activated_at = activated_at + INTERVAL '1 second' WHERE provider_subject = $1", [providerSubject]);
    await assert.rejects(runtime.query(complete, [generationAttempt, generationClaim, subject, subject, opaque()]), { code: "23514" });
    await assert.rejects(runtime.query(advance, [generationAttempt, generationClaim, "provider_enrolling", "mailbox_required", "encrypted-fixture", providerSubject]), { code: "23514" });

    await owner.query("INSERT INTO org.user_settings(user_id) VALUES ($1)", [deletedAccount]);
    await owner.query("SELECT auth.bind_cognito_account($1,$2)", [deletedSubject, deletedAccount]);
    await runtime.query("SELECT auth.activate_proved_provider_method('google',$1,$2,$3)", [recycledProvider, deletedSubject, email]);
    const deletedBeforeEnrollment = await seed("login", null, runtime);
    const deletedBeforeClaim = await prove(deletedBeforeEnrollment, "login", recycledProvider, binding, "ios", null);
    const deletedDuringEnrollment = await seed("login", null, runtime);
    const deletedDuringClaim = await prove(deletedDuringEnrollment, "login", recycledProvider, binding, "ios", null);
    await runtime.query(advance, [deletedDuringEnrollment, deletedDuringClaim, "provider_proved", "provider_enrolling", "encrypted-fixture", recycledProvider]);
    const snapshot = (await owner.query("SELECT snapshot_subject, snapshot_username, snapshot_account, snapshot_method_activated_at FROM auth.social_attempts WHERE attempt_sha256 = $1", [deletedBeforeEnrollment])).rows[0];
    assert.equal(snapshot.snapshot_subject, deletedSubject);
    assert.equal(snapshot.snapshot_username, deletedSubject);
    assert.equal(snapshot.snapshot_account, deletedAccount);
    assert.ok(snapshot.snapshot_method_activated_at instanceof Date);
    await backend.query("BEGIN");
    await backend.query("SELECT auth.lock_account_lifecycle($1)", [deletedAccount]);
    await backend.query("INSERT INTO auth.deleted_subjects(subject_sha256) VALUES ($1)", [hash(deletedSubject)]);
    await backend.query("DELETE FROM org.user_settings WHERE user_id = $1", [deletedAccount]);
    await backend.query("DELETE FROM auth.cognito_principals WHERE cognito_subject = $1", [deletedSubject]);
    await backend.query("COMMIT");
    await runtime.query("SELECT auth.activate_proved_provider_method('google',$1,$2,$3)", [recycledProvider, replacementSubject, email]);
    await assert.rejects(runtime.query(advance, [deletedBeforeEnrollment, deletedBeforeClaim, "provider_proved", "provider_enrolling", "encrypted-fixture", recycledProvider]), { code: "23514" });
    await assert.rejects(runtime.query(complete, [deletedDuringEnrollment, deletedDuringClaim, replacementSubject, replacementSubject, opaque()]), { code: "23514" });
    await assert.rejects(runtime.query(complete, [deletedDuringEnrollment, deletedDuringClaim, deletedSubject, deletedSubject, opaque()]), { code: "23514" });

    const disabledReceipt = await finish(await seed("login", null, runtime), "login");
    await owner.query("UPDATE auth.provider_login_methods SET status = 'disabled', disabled_at = clock_timestamp() WHERE provider_subject = $1", [providerSubject]);
    await assert.rejects(runtime.query(redeem, [disabledReceipt, binding, "login", "ios", null]), { code: "23514" });
    await owner.query("UPDATE auth.provider_login_methods SET status = 'active', disabled_at = NULL, activated_at = activated_at + INTERVAL '1 second' WHERE provider_subject = $1", [providerSubject]);
    await assert.rejects(runtime.query(redeem, [disabledReceipt, binding, "login", "ios", null]), { code: "23514" });

    await owner.query("INSERT INTO org.user_settings(user_id) VALUES ($1)", [account]);
    await owner.query("SELECT auth.bind_cognito_account($1,$2)", [subject, account]);
    await assert.rejects(seed("link", null, runtime), { code: "23514" });
    const reauth = await finish(await seed("reauth", null, runtime), "reauth");
    const newLinkBinding = opaque();
    const createBoundLink = async (receiptBinding: string, receiptClient: string, receiptOrigin: string | null): Promise<string> => {
      const attempt = opaque();
      attempts.push(attempt);
      await runtime.query(create, [attempt, "google", "ios", "link", newLinkBinding, null, null, subject, account,
        "encrypted-fixture", reauth, receiptBinding, receiptClient, receiptOrigin]);
      return attempt;
    };
    await assert.rejects(createBoundLink(newLinkBinding, "ios", null), { code: "23514" });
    await assert.rejects(createBoundLink(binding, "android", null), { code: "23514" });
    await assert.rejects(createBoundLink(binding, "ios", "https://nibomo.com"), { code: "23514" });
    const links = await Promise.allSettled([seed("link", reauth, runtime), seed("link", reauth, contender)]);
    assert.equal(links.filter((result) => result.status === "fulfilled").length, 1);
    await assert.rejects(seed("link", reauth, runtime), { code: "23514" });

    const link = links.find((result) => result.status === "fulfilled");
    assert.ok(link?.status === "fulfilled");
    await owner.query("UPDATE auth.provider_login_methods SET status = 'disabled', disabled_at = clock_timestamp() WHERE provider_subject = $1", [providerSubject]);
    await assert.rejects(runtime.query(claim, [link.value, binding, "link", "ios", null, "provider_ready"]), { code: "23514" });
    await owner.query("UPDATE auth.provider_login_methods SET status = 'active', disabled_at = NULL WHERE provider_subject = $1", [providerSubject]);

    const webAttempt = opaque();
    attempts.push(webAttempt);
    const webOrigin = "https://nibomo.com";
    const webBinding = hash(JSON.stringify(["browser", webOrigin, randomBytes(32).toString("base64url")]));
    await runtime.query(create, [webAttempt, "google", "web", "reauth", webBinding, webOrigin,
      "https://auth.nibomo.com/api/social/google/callback", subject, account, "encrypted-fixture", null, null, null, null]);
    const webClaim = await prove(webAttempt, "reauth", providerSubject, webBinding, "web", webOrigin);
    await runtime.query(advance, [webAttempt, webClaim, "provider_proved", "provider_enrolling", "encrypted-fixture", providerSubject]);
    const webReceipt = opaque();
    await runtime.query(complete, [webAttempt, webClaim, subject, subject, webReceipt]);
    const webLink = opaque();
    attempts.push(webLink);
    const webLinkParameters = [webLink, "google", "ios", "link", newLinkBinding, null, null, subject, account,
      "encrypted-fixture", webReceipt, webBinding, "web", webOrigin];
    await assert.rejects(runtime.query(create, [...webLinkParameters.slice(0, 11), opaque(), "web", webOrigin]), { code: "23514" });
    await assert.rejects(runtime.query(create, [...webLinkParameters.slice(0, 11), webBinding, "web", "https://app.nibomo.com"]), { code: "23514" });
    await assert.rejects(runtime.query(create, [...webLinkParameters.slice(0, 11), webBinding, "ios", null]), { code: "23514" });
    await runtime.query(create, webLinkParameters);
    assert.equal((await runtime.query(claim, [webLink, binding, "link", "ios", null, "provider_ready"])).rowCount, 0);
    assert.equal((await runtime.query(claim, [webLink, newLinkBinding, "link", "ios", null, "provider_ready"])).rowCount, 1);

    await owner.query("SELECT auth.bind_cognito_account($1,$2)", [other, account]);
    await runtime.query("SELECT auth.activate_proved_provider_method('google',$1,$2,$3)", [aliasProvider, other, email]);
    await runtime.query("SELECT auth.activate_proved_provider_method('google',$1,$2,$3)", [linkedProvider, linkedSubject, email]);
    const aliasReauth = await seed("reauth", null, runtime);
    const aliasClaim = await prove(aliasReauth, "reauth", aliasProvider, binding, "ios", null);
    await runtime.query(advance, [aliasReauth, aliasClaim, "provider_proved", "provider_enrolling", "encrypted-fixture", aliasProvider]);
    const aliasReceipt = opaque();
    await runtime.query(complete, [aliasReauth, aliasClaim, other, other, aliasReceipt]);
    const aliasLink = await seed("link", aliasReceipt, runtime);
    const aliasLinkClaim = await prove(aliasLink, "link", linkedProvider, binding, "ios", null);
    await runtime.query(advance, [aliasLink, aliasLinkClaim, "provider_proved", "provider_enrolling", "encrypted-fixture", linkedProvider]);
    const aliasLinkReceipt = opaque();
    await runtime.query(complete, [aliasLink, aliasLinkClaim, linkedSubject, linkedSubject, aliasLinkReceipt]);
    assert.equal((await runtime.query(redeem, [aliasLinkReceipt, binding, "link", "ios", null])).rowCount, 0);
    assert.equal((await runtime.query(linkRedeem, [aliasLinkReceipt, opaque(), "ios", null])).rowCount, 0);
    const runtimePid = (await runtime.query("SELECT pg_backend_pid() AS pid")).rows[0].pid as number;
    await contender.query("BEGIN");
    await contender.query("SET LOCAL statement_timeout = '5s'");
    await contender.query("SELECT pg_advisory_xact_lock(hashtextextended('auth.cognito_identity:' || $1, 2::bigint))", [other]);
    await runtime.query("BEGIN");
    await runtime.query("SET LOCAL statement_timeout = '5s'");
    const linking = Promise.allSettled([runtime.query(linkRedeem, [aliasLinkReceipt, binding, "ios", null])]);
    let waitingOnSubject = false;
    for (let poll = 0; poll < 100; poll += 1) {
      const state = await owner.query("SELECT 1 FROM pg_stat_activity WHERE pid = $1 AND wait_event = 'advisory'", [runtimePid]);
      if (state.rowCount === 1) { waitingOnSubject = true; break; }
      await delay(10);
    }
    assert.equal(waitingOnSubject, true);
    // A B-first operation can still take the account: linking has not acquired it while waiting for B.
    await contender.query("SELECT auth.lock_account_lifecycle($1)", [account]);
    await contender.query("COMMIT");
    const linked = (await linking)[0];
    assert.ok(linked?.status === "fulfilled");
    assert.equal(linked.value.rows[0].cognito_subject, linkedSubject);
    await runtime.query("COMMIT");
    assert.equal((await runtime.query(linkRedeem, [aliasLinkReceipt, binding, "ios", null])).rowCount, 0);
    assert.equal((await owner.query("SELECT user_id FROM auth.user_identities WHERE provider_type = 'cognito' AND provider_subject = $1", [linkedSubject])).rows[0].user_id, account);

    const expiredCompletion = await finish(await seed("login", null, runtime), "login");
    await owner.query("UPDATE auth.social_attempts SET completion_expires_at = clock_timestamp() - INTERVAL '1 second' WHERE completion_sha256 = $1", [expiredCompletion]);
    assert.equal((await runtime.query(redeem, [expiredCompletion, binding, "login", "ios", null])).rowCount, 0);

    const deletedReceipt = await finish(await seed("login", null, runtime), "login");
    await owner.query("INSERT INTO auth.deleted_subjects(subject_sha256) VALUES ($1)", [hash(subject)]);
    await assert.rejects(runtime.query(redeem, [deletedReceipt, binding, "login", "ios", null]), { code: "23514" });
    await owner.query("DELETE FROM auth.deleted_subjects WHERE subject_sha256 = $1", [hash(subject)]);

    const appleAttempt = opaque();
    attempts.push(appleAttempt);
    await runtime.query(create, [appleAttempt, "apple", "ios", "login", binding, null, null, null, null, "encrypted-fixture", null, null, null, null]);
    const appleClaim = (await runtime.query(claim, [appleAttempt, binding, "login", "ios", null, "provider_ready"])).rows[0].claim_id;
    await runtime.query(advance, [appleAttempt, appleClaim, "provider_claimed", "provider_verifying", "encrypted-fixture", null]);
    await runtime.query(advance, [appleAttempt, appleClaim, "provider_verifying", "provider_proved", "encrypted-fixture", appleSubject]);
    await runtime.query(advance, [appleAttempt, appleClaim, "provider_proved", "provider_enrolling", "encrypted-fixture", appleSubject]);
    const appleReceipt = opaque();
    await runtime.query(complete, [appleAttempt, appleClaim, subject, subject, appleReceipt]);
    await runtime.query("SELECT auth.stage_apple_method_revocation($1,$2)", [subject, appleSubject]);
    await assert.rejects(runtime.query(redeem, [appleReceipt, binding, "login", "ios", null]), { code: "23514" });
    // Restoring a row alone cannot bypass a pending provider/session revocation.
    await owner.query("UPDATE auth.provider_login_methods SET status = 'active', disabled_at = NULL WHERE provider_subject = $1", [appleSubject]);
    await assert.rejects(runtime.query(redeem, [appleReceipt, binding, "login", "ios", null]), { code: "55006" });

    const quotas = await Promise.all([
      runtime.query("SELECT auth.consume_social_rate_bucket($1,1) AS allowed", [bucket]),
      contender.query("SELECT auth.consume_social_rate_bucket($1,1) AS allowed", [bucket]),
    ]);
    assert.deepEqual(quotas.map((result) => result.rows[0].allowed).sort(), [false, true]);
    for (const client of [runtime, backend, reporting]) {
      await assert.rejects(client.query("SELECT * FROM auth.social_attempts"), { code: "42501" });
      await assert.rejects(client.query("DELETE FROM auth.social_rate_buckets"), { code: "42501" });
    }
    for (const client of [backend, reporting]) {
      await assert.rejects(client.query(claim, [issued, binding, "login", "ios", null, "provider_ready"]), { code: "42501" });
      await assert.rejects(client.query("SELECT auth.consume_social_rate_bucket($1,1)", [bucket]), { code: "42501" });
      await assert.rejects(client.query(linkRedeem, [aliasLinkReceipt, binding, "ios", null]), { code: "42501" });
    }
  } finally {
    try {
      await Promise.all([runtime.end(), contender.end(), backend.end(), reporting.end()]);
    } finally {
      try {
        await owner.query("DELETE FROM auth.social_attempts WHERE attempt_sha256 = ANY($1::text[])", [attempts]);
        await owner.query("DELETE FROM auth.social_rate_buckets WHERE bucket_sha256 = $1", [bucket]);
        await owner.query("DELETE FROM auth.apple_session_revocation_jobs WHERE provider_subject_sha256 = $1", [hash(appleSubject)]);
        await owner.query("DELETE FROM org.user_settings WHERE user_id = ANY($1::text[])", [[account, deletedAccount]]);
        await owner.query("DELETE FROM auth.cognito_principals WHERE cognito_subject = ANY($1::text[])", [[subject, other, linkedSubject, deletedSubject, replacementSubject]]);
        await owner.query("DELETE FROM auth.deleted_subjects WHERE subject_sha256 = ANY($1::text[])", [[hash(subject), hash(deletedSubject)]]);
      } finally {
        await owner.end();
      }
    }
  }
});
