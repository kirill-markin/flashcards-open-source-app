import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";

test("Apple credentials require live binding and survive erasure until revocation", async () => {
  const ownerUrl = process.env.TEST_DATABASE_ADMIN_URL;
  if (ownerUrl === undefined) throw new Error("TEST_DATABASE_ADMIN_URL is required");
  const owner = new pg.Pool({ connectionString: ownerUrl });
  const runtime = new pg.Client({ connectionString: ownerUrl });
  const contender = new pg.Client({ connectionString: ownerUrl });
  const backend = new pg.Client({ connectionString: ownerUrl });
  const subject = randomUUID();
  const otherSubject = randomUUID();
  const providerSubject = `apple-${randomUUID()}`;
  const clientId = "com.example.auth";
  const ciphertext = `v1.${randomBytes(12).toString("base64url")}.${randomBytes(16).toString("base64url")}.${randomBytes(64).toString("base64url")}`;
  const rotated = `v1.${randomBytes(12).toString("base64url")}.${randomBytes(16).toString("base64url")}.${randomBytes(64).toString("base64url")}`;
  const store = "SELECT auth.store_apple_credential($1, $2, $3, $4)";
  const load = "SELECT * FROM auth.load_apple_credentials($1)";
  const remove = "SELECT auth.delete_apple_credential($1, $2, $3) AS deleted";
  try {
    await runtime.connect();
    await runtime.query("SET ROLE auth_app");
    await contender.connect();
    await contender.query("SET ROLE auth_app");
    await backend.connect();
    await backend.query("SET ROLE backend_app");
    await owner.query("SELECT auth.register_cognito_principal($1, $2)", [subject, subject]);
    await owner.query("SELECT auth.register_cognito_principal($1, $2)", [otherSubject, otherSubject]);
    await assert.rejects(runtime.query(store, [subject, providerSubject, clientId, ciphertext]), { code: "23514" });
    await owner.query("SELECT auth.bind_provider_identity('apple', $1, $2)", [providerSubject, subject]);
    await runtime.query(store, [subject, providerSubject, clientId, ciphertext]);
    assert.deepEqual((await runtime.query(load, [subject])).rows, [{ provider_subject: providerSubject, client_id: clientId, ciphertext }]);
    assert.equal((await runtime.query(load, [otherSubject])).rowCount, 0);
    await assert.rejects(runtime.query(store, [otherSubject, providerSubject, clientId, ciphertext]), { code: "23514" });
    await assert.rejects(runtime.query(store, [subject, providerSubject, clientId, "plaintext-refresh-token"]), { code: "23514" });
    await assert.rejects(runtime.query("SELECT * FROM auth.apple_revocation_credentials"), { code: "42501" });
    await assert.rejects(backend.query(load, [subject]), { code: "42501" });
    await assert.rejects(backend.query(store, [subject, providerSubject, clientId, ciphertext]), { code: "42501" });
    await runtime.query(store, [subject, providerSubject, clientId, rotated]);
    assert.equal((await runtime.query(remove, [providerSubject, clientId, ciphertext])).rows[0].deleted, false);
    assert.equal((await runtime.query(load, [subject])).rows[0].ciphertext, rotated);
    assert.equal((await owner.query("SELECT 1 FROM org.user_settings WHERE user_id = ANY($1::text[])", [[subject, otherSubject]])).rowCount, 0);
    await owner.query("INSERT INTO auth.deleted_subjects(subject_sha256) VALUES (pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to($1::text, 'UTF8')), 'hex'))", [subject]);
    await assert.rejects(runtime.query(store, [subject, providerSubject, clientId, ciphertext]), { code: "23514" });
    await owner.query("DELETE FROM auth.cognito_principals WHERE cognito_subject = $1", [subject]);
    assert.equal((await runtime.query(load, [subject])).rows[0].ciphertext, rotated);
    const raced = await Promise.all([
      runtime.query(remove, [providerSubject, clientId, rotated]),
      contender.query(remove, [providerSubject, clientId, rotated]),
    ]);
    assert.deepEqual(raced.map((result) => result.rows[0].deleted).sort(), [false, true]);
    assert.equal((await runtime.query(load, [subject])).rowCount, 0);
  } finally {
    try {
      await Promise.all([runtime.end(), contender.end(), backend.end()]);
    } finally {
      try {
        await owner.query("DELETE FROM auth.apple_revocation_credentials WHERE cognito_subject = $1", [subject]);
        await owner.query("DELETE FROM auth.cognito_principals WHERE cognito_subject = ANY($1::text[])", [[subject, otherSubject]]);
        await owner.query("DELETE FROM auth.deleted_subjects WHERE subject_sha256 = pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to($1::text, 'UTF8')), 'hex')", [subject]);
      } finally {
        await owner.end();
      }
    }
  }
});
