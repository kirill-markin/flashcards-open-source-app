import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";

test("real email enrollment preserves immutable principals, provider state and the product boundary", async () => {
  const ownerUrl = process.env.TEST_DATABASE_ADMIN_URL;
  if (ownerUrl === undefined) throw new Error("TEST_DATABASE_ADMIN_URL is required");
  const owner = new pg.Pool({ connectionString: ownerUrl });
  const runtime = new pg.Client({ connectionString: ownerUrl });
  const contender = new pg.Client({ connectionString: ownerUrl });
  const backend = new pg.Client({ connectionString: ownerUrl });
  const subjects = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const [subject, otherSubject, provisionalSubject, demoSubject] = subjects;
  const email = "principal-" + randomUUID() + "@mail.test";
  const otherEmail = "principal-" + randomUUID() + "@mail.test";
  const providerSubject = "google-" + randomUUID();
  const racedProviderSubject = "google-" + randomUUID();
  const username = "immutable-" + randomUUID();
  const enroll = "SELECT auth.enroll_proved_email_principal($1, $2, $3, $4)";
  const activate = "SELECT auth.activate_proved_provider_method('google', $1, $2, $3)";
  const load = "SELECT * FROM auth.load_provider_login_method('google', $1)";
  try {
    await runtime.connect();
    await runtime.query("SET ROLE auth_app");
    await contender.connect();
    await contender.query("SET ROLE auth_app");
    await backend.connect();
    await backend.query("SET ROLE backend_app");
    await owner.query("SELECT auth.register_cognito_principal($1, $2)", [provisionalSubject, provisionalSubject]);
    await assert.rejects(runtime.query(activate, [providerSubject, provisionalSubject, email]), { code: "23514" });
    assert.equal((await owner.query("SELECT 1 FROM auth.provider_identities WHERE provider_subject = $1", [providerSubject])).rowCount, 0);
    await runtime.query(enroll, [subject, username, email, new Date()]);
    await runtime.query(enroll, [otherSubject, otherSubject, email, new Date()]);
    // Mailbox metadata is not an account key, including when two proved principals report the same email.
    assert.equal((await owner.query("SELECT 1 FROM auth.verified_login_emails WHERE email = $1", [email])).rowCount, 2);
    assert.equal((await owner.query("SELECT 1 FROM auth.user_identities WHERE provider_subject = ANY($1::text[])", [subjects])).rowCount, 0);
    assert.equal((await owner.query("SELECT 1 FROM org.user_settings WHERE user_id = ANY($1::text[])", [subjects])).rowCount, 0);
    await assert.rejects(runtime.query(enroll, [subject, email, email, new Date()]), { code: "23505" });
    await assert.rejects(runtime.query(enroll, [provisionalSubject, provisionalSubject, email, new Date(Date.now() - 660_000)]), { code: "23514" });
    await assert.rejects(runtime.query(enroll, [provisionalSubject, provisionalSubject, email, new Date(Date.now() + 60_000)]), { code: "23514" });

    await runtime.query(activate, [providerSubject, subject, email]);
    await runtime.query(activate, [providerSubject, subject, email]);
    assert.deepEqual((await runtime.query(load, [providerSubject])).rows, [{
      provider_type: "google", provider_subject: providerSubject, cognito_subject: subject,
      cognito_username: username, status: "active", recovery_email: email,
    }]);
    await runtime.query(enroll, [subject, username, otherEmail, new Date()]);
    await assert.rejects(runtime.query(activate, [providerSubject, subject, otherEmail]), { code: "23505" });
    await assert.rejects(runtime.query(activate, [providerSubject, otherSubject, email]), { code: "23505" });
    assert.equal((await runtime.query(load, [providerSubject])).rows[0].recovery_email, email);
    const raced = await Promise.allSettled([
      runtime.query(activate, [racedProviderSubject, subject, email]),
      contender.query(activate, [racedProviderSubject, otherSubject, email]),
    ]);
    assert.equal(raced.filter((result) => result.status === "fulfilled").length, 1);
    const rejected = raced.find((result) => result.status === "rejected");
    assert.equal(rejected?.status === "rejected" ? rejected.reason.code : null, "23505");
    assert.equal((await owner.query("SELECT 1 FROM auth.provider_identities WHERE provider_subject = $1", [racedProviderSubject])).rowCount, 1);

    // Simulates the later unlink lifecycle's owner-authorized transition, not email OTP disable.
    await owner.query(
      "UPDATE auth.provider_login_methods SET status = 'disabled', disabled_at = pg_catalog.clock_timestamp() WHERE provider_subject = $1",
      [providerSubject],
    );
    await Promise.all([
      runtime.query(activate, [providerSubject, subject, email]),
      contender.query(activate, [providerSubject, subject, email]),
    ]);
    assert.equal((await runtime.query(load, [providerSubject])).rows[0].status, "disabled");
    assert.equal((await owner.query("SELECT 1 FROM auth.verified_login_emails WHERE cognito_subject = $1", [subject])).rowCount, 2);

    await owner.query("SELECT auth.register_cognito_principal($1, $2)", [demoSubject, demoSubject]);
    await owner.query("INSERT INTO org.user_settings(user_id, email) VALUES ($1, $2)", [demoSubject, "demo-" + demoSubject + "@example.com"]);
    await owner.query("SELECT auth.bind_cognito_account($1, $1)", [demoSubject]);
    await assert.rejects(runtime.query(enroll, [demoSubject, demoSubject, otherEmail, new Date()]), { code: "23514" });
    await assert.rejects(runtime.query(enroll, [provisionalSubject, provisionalSubject, "demo@example.com", new Date()]), { code: "23514" });
    assert.equal((await owner.query("SELECT 1 FROM auth.principal_login_policies WHERE cognito_subject = $1", [demoSubject])).rowCount, 0);
    await owner.query("INSERT INTO auth.principal_login_policies(cognito_subject, principal_kind) VALUES ($1, 'demo')", [provisionalSubject]);
    await assert.rejects(runtime.query(enroll, [provisionalSubject, provisionalSubject, otherEmail, new Date()]), { code: "23514" });
    await assert.rejects(runtime.query("SELECT * FROM auth.provider_login_methods"), { code: "42501" });
    await assert.rejects(runtime.query("UPDATE auth.principal_login_policies SET principal_kind = 'real'"), { code: "42501" });
    await assert.rejects(backend.query(enroll, [subject, username, email, new Date()]), { code: "42501" });
    await assert.rejects(backend.query(load, [providerSubject]), { code: "42501" });

    await owner.query(
      "INSERT INTO auth.deleted_subjects(subject_sha256) VALUES (pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to($1::text, 'UTF8')), 'hex'))",
      [subject],
    );
    await assert.rejects(runtime.query(enroll, [subject, username, email, new Date()]), { code: "23514" });
    await assert.rejects(runtime.query(activate, [providerSubject, subject, email]), { code: "23514" });
    await assert.rejects(runtime.query(load, [providerSubject]), { code: "23514" });
    await owner.query("DELETE FROM auth.cognito_principals WHERE cognito_subject = $1", [subject]);
    assert.equal((await runtime.query(load, [providerSubject])).rowCount, 0);
    assert.equal((await owner.query("SELECT 1 FROM auth.principal_login_policies WHERE cognito_subject = $1", [subject])).rowCount, 0);
    assert.equal((await owner.query("SELECT 1 FROM auth.verified_login_emails WHERE cognito_subject = $1", [subject])).rowCount, 0);
  } finally {
    try {
      await Promise.all([runtime.end(), contender.end(), backend.end()]);
    } finally {
      try {
        await owner.query("DELETE FROM org.user_settings WHERE user_id = $1", [demoSubject]);
        await owner.query("DELETE FROM auth.cognito_principals WHERE cognito_subject = ANY($1::text[])", [subjects]);
        await owner.query(
          "DELETE FROM auth.deleted_subjects WHERE subject_sha256 = pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to($1::text, 'UTF8')), 'hex')",
          [subject],
        );
      } finally {
        await owner.end();
      }
    }
  }
});
