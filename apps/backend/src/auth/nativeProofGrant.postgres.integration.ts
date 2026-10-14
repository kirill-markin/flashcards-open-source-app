import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";

test("native proof grants enforce exact binding, expiry, one-use races and SQL privileges", async () => {
  const ownerUrl = process.env.TEST_DATABASE_ADMIN_URL;
  if (ownerUrl === undefined) throw new Error("TEST_DATABASE_ADMIN_URL is required");
  const owner = new pg.Pool({ connectionString: ownerUrl });
  const runtime = new pg.Client({ connectionString: ownerUrl });
  const contender = new pg.Client({ connectionString: ownerUrl });
  const backend = new pg.Client({ connectionString: ownerUrl });
  const subject = randomUUID();
  const otherSubject = randomUUID();
  const username = `native-proof-${subject}`;
  const client = randomUUID();
  const nonce = randomBytes(32).toString("hex");
  const proofHash = randomBytes(32).toString("hex");
  const issue = "SELECT auth.issue_native_proof_grant($1, $2, $3, $4, $5, $6)";
  const redeem = "SELECT auth.redeem_native_proof_grant($1, $2, $3, $4, $5) AS redeemed";
  const binding = [subject, username, client, nonce, proofHash];
  try {
    await runtime.connect();
    await runtime.query("SET ROLE auth_app");
    await contender.connect();
    await contender.query("SET ROLE auth_app");
    await backend.connect();
    await backend.query("SET ROLE backend_app");
    await owner.query("SELECT auth.register_cognito_principal($1, $2)", [subject, username]);
    await owner.query("SELECT auth.register_cognito_principal($1, $2)", [otherSubject, otherSubject]);
    await runtime.query(issue, [...binding, new Date(Date.now() + 60_000)]);
    for (const mismatched of [
      [otherSubject, username, client, nonce, proofHash],
      [subject, otherSubject, client, nonce, proofHash],
      [subject, username, "wrong-client", nonce, proofHash],
      [subject, username, client, randomBytes(32).toString("hex"), proofHash],
      [subject, username, client, nonce, randomBytes(32).toString("hex")],
    ]) {
      assert.equal((await runtime.query(redeem, mismatched)).rows[0].redeemed, false);
    }
    const raced = await Promise.all([
      runtime.query(redeem, binding), contender.query(redeem, binding),
    ]);
    assert.deepEqual(raced.map((result) => result.rows[0].redeemed).sort(), [false, true]);
    assert.equal((await runtime.query(redeem, binding)).rows[0].redeemed, false);
    await runtime.query(issue, [...binding, new Date(Date.now() + 60_000)]);
    await owner.query("UPDATE auth.native_proof_grants SET expires_at = pg_catalog.clock_timestamp() - INTERVAL '1 second' WHERE proof_sha256 = $1", [proofHash]);
    assert.equal((await runtime.query(redeem, binding)).rows[0].redeemed, false);
    await assert.rejects(runtime.query(issue, [...binding, new Date(Date.now() + 180_000)]), { code: "23514" });
    await assert.rejects(runtime.query("SELECT * FROM auth.native_proof_grants"), { code: "42501" });
    await assert.rejects(backend.query(issue, [...binding, new Date(Date.now() + 60_000)]), { code: "42501" });
    assert.equal((await owner.query("SELECT 1 FROM org.user_settings WHERE user_id = ANY($1::text[])", [[subject, otherSubject]])).rowCount, 0);
    await owner.query("INSERT INTO auth.deleted_subjects(subject_sha256) VALUES (pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to($1::text, 'UTF8')), 'hex'))", [subject]);
    await assert.rejects(runtime.query(issue, [...binding, new Date(Date.now() + 60_000)]), { code: "23514" });
    assert.equal((await runtime.query(redeem, binding)).rows[0].redeemed, false);
  } finally {
    try {
      await Promise.all([runtime.end(), contender.end(), backend.end()]);
    } finally {
      try {
        await owner.query("DELETE FROM auth.cognito_principals WHERE cognito_subject = ANY($1::text[])", [[subject, otherSubject]]);
        await owner.query("DELETE FROM auth.deleted_subjects WHERE subject_sha256 = pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to($1::text, 'UTF8')), 'hex')", [subject]);
      } finally {
        await owner.end();
      }
    }
  }
});
