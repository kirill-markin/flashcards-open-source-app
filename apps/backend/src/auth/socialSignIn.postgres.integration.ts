import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";

const opaque = (): string => randomBytes(32).toString("hex");
const encryptedResultFixture = (): string => ["v1", randomBytes(12).toString("base64url"),
  randomBytes(16).toString("base64url"), randomBytes(128).toString("base64url")].join(".");

test("unbound provider proof storage enrolls, completes and redeems a one-use encrypted login result", async () => {
  const ownerUrl = process.env.TEST_DATABASE_ADMIN_URL;
  if (ownerUrl === undefined) throw new Error("TEST_DATABASE_ADMIN_URL is required");
  const owner = new pg.Client({ connectionString: ownerUrl });
  const runtime = new pg.Client({ connectionString: ownerUrl });
  const contender = new pg.Client({ connectionString: ownerUrl });
  const backend = new pg.Client({ connectionString: ownerUrl });
  const subject = randomUUID();
  const provider = "unbound-google-" + randomUUID();
  const email = "unbound-" + randomUUID() + "@mail.test";
  const binding = opaque();
  const attempts: Array<string> = [];
  const create = "SELECT auth.create_social_attempt($1,'google','ios','login',$2,NULL,NULL,NULL,NULL,'encrypted-storage-fixture',NULL,NULL,NULL,NULL)";
  const advance = "SELECT auth.advance_social_attempt($1,$2,$3,$4,'encrypted-storage-fixture',$5)";
  const complete = "SELECT auth.complete_social_sign_in($1,$2,$3,$3,$4,$5)";
  const redeem = "SELECT * FROM auth.redeem_social_sign_in($1,$2,$3,$4)";
  const proveStorage = async (): Promise<Readonly<{ attempt: string; claim: string }>> => {
    const attempt = opaque();
    attempts.push(attempt);
    await runtime.query(create, [attempt, binding]);
    const claimed = await runtime.query("SELECT * FROM auth.claim_social_attempt($1,$2,'login','ios',NULL,'provider_ready')", [attempt, binding]);
    const claim = claimed.rows[0].claim_id as string;
    await runtime.query(advance, [attempt, claim, "provider_claimed", "provider_verifying", null]);
    await runtime.query(advance, [attempt, claim, "provider_verifying", "provider_proved", provider]);
    return { attempt, claim };
  };
  try {
    await owner.connect();
    await runtime.connect();
    await runtime.query("SET ROLE auth_app");
    await contender.connect();
    await contender.query("SET ROLE auth_app");
    await backend.connect();
    await backend.query("SET ROLE backend_app");
    const moduleUrl = pathToFileURL(resolve(__dirname, "../../../auth/src/integration/principalEnrollmentGate.ts")).href;
    const gate = await import(moduleUrl) as Readonly<{
      checkAtomicAuthoritativeLogin: (runtime: pg.Client, owner: pg.Client | pg.Pool) => Promise<void>;
    }>;
    await gate.checkAtomicAuthoritativeLogin(runtime, owner);
    // Exercise real storage authority, without supplying fabricated tokens to a provider verifier.
    const fresh = await proveStorage();
    const snapshot = await owner.query("SELECT snapshot_subject, snapshot_username, snapshot_account, snapshot_method_activated_at FROM auth.social_attempts WHERE attempt_sha256 = $1", [fresh.attempt]);
    assert.deepEqual(snapshot.rows[0], { snapshot_subject: null, snapshot_username: null, snapshot_account: null, snapshot_method_activated_at: null });
    assert.equal((await owner.query("SELECT 1 FROM auth.provider_identities WHERE provider_subject = $1", [provider])).rowCount, 0);
    assert.equal((await owner.query("SELECT 1 FROM auth.cognito_principals WHERE cognito_subject = $1", [subject])).rowCount, 0);
    assert.equal((await owner.query("SELECT 1 FROM auth.provider_login_methods WHERE provider_subject = $1", [provider])).rowCount, 0);
    await runtime.query(advance, [fresh.attempt, fresh.claim, "provider_proved", "provider_enrolling", provider]);
    await runtime.query("SELECT auth.enroll_proved_email_principal($1,$1,$2,clock_timestamp())", [subject, email]);
    await runtime.query("SELECT auth.activate_proved_provider_method('google',$1,$2,$3)", [provider, subject, email]);
    const receipt = opaque();
    const ciphertext = encryptedResultFixture();
    await runtime.query(complete, [fresh.attempt, fresh.claim, subject, receipt, ciphertext]);
    await assert.rejects(runtime.query(complete, [fresh.attempt, fresh.claim, subject, opaque(), ciphertext]), { code: "55006" });
    assert.equal((await runtime.query(redeem, [receipt, opaque(), "ios", null])).rowCount, 0);
    assert.equal((await runtime.query(redeem, [receipt, binding, "android", null])).rowCount, 0);
    assert.equal((await runtime.query(redeem, [receipt, binding, "ios", "https://auth.nibomo.com"])).rowCount, 0);
    assert.equal((await owner.query("SELECT result_ciphertext FROM auth.social_attempts WHERE attempt_sha256 = $1", [fresh.attempt])).rows[0].result_ciphertext, ciphertext);
    const race = await Promise.all([
      runtime.query(redeem, [receipt, binding, "ios", null]),
      contender.query(redeem, [receipt, binding, "ios", null]),
    ]);
    assert.deepEqual(race.map((result) => result.rowCount).sort(), [0, 1]);
    assert.deepEqual(race.find((result) => result.rowCount === 1)?.rows[0], {
      cognito_subject: subject, cognito_username: subject, result_ciphertext: ciphertext,
    });
    assert.deepEqual((await owner.query("SELECT phase, secret_ciphertext, result_ciphertext FROM auth.social_attempts WHERE attempt_sha256 = $1", [fresh.attempt])).rows[0], {
      phase: "redeemed", secret_ciphertext: "erased", result_ciphertext: null,
    });
    assert.equal((await runtime.query(redeem, [receipt, binding, "ios", null])).rowCount, 0);
    assert.equal((await owner.query("SELECT 1 FROM org.user_settings WHERE user_id = $1", [subject])).rowCount, 0);
    assert.equal((await owner.query("SELECT 1 FROM auth.user_identities WHERE provider_subject = $1", [subject])).rowCount, 0);

    const expired = await proveStorage();
    await runtime.query(advance, [expired.attempt, expired.claim, "provider_proved", "provider_enrolling", provider]);
    const expiredReceipt = opaque();
    await runtime.query(complete, [expired.attempt, expired.claim, subject, expiredReceipt, ciphertext]);
    await owner.query("UPDATE auth.social_attempts SET completion_expires_at = clock_timestamp() - INTERVAL '1 second' WHERE attempt_sha256 = $1", [expired.attempt]);
    const expiredResult = await runtime.query(redeem, [expiredReceipt, binding, "ios", null]);
    assert.equal(expiredResult.rowCount, 0);
    assert.deepEqual(expiredResult.rows, []);

    const generic = await proveStorage();
    await runtime.query(advance, [generic.attempt, generic.claim, "provider_proved", "provider_enrolling", provider]);
    const genericReceipt = opaque();
    await assert.rejects(runtime.query(complete, [generic.attempt, generic.claim, subject, genericReceipt, ciphertext + "x".repeat(2048)]), { code: "23514" });
    await runtime.query(complete, [generic.attempt, generic.claim, subject, genericReceipt, ciphertext]);
    assert.equal((await runtime.query("SELECT * FROM auth.redeem_social_completion($1,$2,'login','ios',NULL)", [genericReceipt, binding])).rowCount, 1);
    assert.equal((await owner.query("SELECT result_ciphertext FROM auth.social_attempts WHERE attempt_sha256 = $1", [generic.attempt])).rows[0].result_ciphertext, null);
    await assert.rejects(runtime.query("SELECT result_ciphertext FROM auth.social_attempts"), { code: "42501" });
    await assert.rejects(backend.query(complete, [fresh.attempt, fresh.claim, subject, receipt, ciphertext]), { code: "42501" });
    await assert.rejects(backend.query(redeem, [receipt, binding, "ios", null]), { code: "42501" });
  } finally {
    try {
      await Promise.all([runtime.end(), contender.end(), backend.end()]);
    } finally {
      try {
        await owner.query("DELETE FROM auth.social_attempts WHERE attempt_sha256 = ANY($1::text[])", [attempts]);
        await owner.query("DELETE FROM auth.cognito_principals WHERE cognito_subject = $1", [subject]);
      } finally {
        await owner.end();
      }
    }
  }
});
