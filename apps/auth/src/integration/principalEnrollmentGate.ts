import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import type pg from "pg";
import type { DatabaseExecutor } from "../db.js";
import type { CognitoEmailPrincipal } from "../server/cognito/cognitoAuth.js";
import { enrollAuthoritativeLoginPrincipalInExecutor, type ProviderEnrollmentProof } from "../server/social/principalEnrollment.js";
import { completeAuthoritativeLoginInExecutor, redeemSocialSignInInExecutor } from "../server/social/completionStore.js";
import { authAttemptBindingHash, authHandleHash } from "../server/social/attemptStore.js";
import { encryptAppleCredential } from "../server/social/appleCredential.js";

function executorFor(client: pg.Client): DatabaseExecutor {
  return { query: (text, parameters) => client.query(text, [...parameters]) };
}

async function inTransaction<Result>(client: pg.Client, operation: (executor: DatabaseExecutor) => Promise<Result>): Promise<Result> {
  await client.query("BEGIN");
  try {
    const result = await operation(executorFor(client));
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

// Fixtures enter the verified-proof module boundary; no Cognito lookup, JWT or provider acceptance is asserted.
function googleProof(subject: string, email: string): ProviderEnrollmentProof {
  return { provider: "google", identity: { provider: "google", subject, clientId: "postgres-module-fixture",
    email: { address: email, authority: "provider", privateRelay: false } } };
}

export async function checkAuthoritativePrincipalEnrollment(runtime: pg.Client, owner: pg.Client | pg.Pool): Promise<void> {
  const subject = randomUUID();
  const duplicate = randomUUID();
  const demo = randomUUID();
  const deleted = randomUUID();
  const account = randomUUID();
  const duplicateAccount = randomUUID();
  const demoAccount = randomUUID();
  const username = "canonical-" + randomUUID();
  const email = randomUUID() + "@mail.test";
  const principal: CognitoEmailPrincipal = { cognitoSubject: subject, cognitoUsername: username, email };
  const proof = googleProof("module-google-" + randomUUID(), email);
  const enroll = (nextProof: ProviderEnrollmentProof, candidate: CognitoEmailPrincipal | null) =>
    inTransaction(runtime, (executor) => enrollAuthoritativeLoginPrincipalInExecutor(executor, nextProof, candidate));
  const mappedAccount = async (): Promise<string> => (await owner.query<{ user_id: string }>(
    "SELECT user_id FROM auth.user_identities WHERE provider_type = 'cognito' AND provider_subject = $1", [subject],
  )).rows[0].user_id;
  try {
    for (const id of [account, duplicateAccount, demoAccount]) {
      await owner.query("INSERT INTO org.user_settings(user_id, email) VALUES ($1,$2)",
        [id, id === demoAccount ? "module-demo@example.com" : "profile-" + id + "@mail.test"]);
    }
    for (const [id, product] of [[subject, account], [duplicate, duplicateAccount], [demo, demoAccount]]) {
      await owner.query("SELECT auth.bind_cognito_account($1,$2)", [id, product]);
    }
    assert.equal((await owner.query("SELECT 1 FROM auth.cognito_principals WHERE cognito_subject = $1", [subject])).rowCount, 0);
    assert.equal((await owner.query("SELECT 1 FROM auth.verified_login_emails WHERE cognito_subject = $1", [subject])).rowCount, 0);
    await runtime.query("SELECT auth.enroll_proved_email_principal($1,$1,$2,clock_timestamp())", [duplicate, email]);
    const enrolled = await enroll(proof, principal);
    assert.equal(enrolled.status, "enrolled");
    if (enrolled.status !== "enrolled") throw new Error("Expected canonical principal enrollment");
    assert.deepEqual(enrolled.principal, principal);
    assert.equal(await mappedAccount(), account);
    assert.equal((await owner.query("SELECT 1 FROM auth.verified_login_emails WHERE email = $1", [email])).rowCount, 2);
    assert.equal((await owner.query("SELECT 1 FROM org.user_settings WHERE user_id = $1", [subject])).rowCount, 0);
    assert.equal((await owner.query("SELECT user_id FROM auth.user_identities WHERE provider_subject = $1", [duplicate])).rows[0].user_id, duplicateAccount);

    const conflict = { code: "PROVIDER_ENROLLMENT_CONFLICT" };
    await assert.rejects(enroll(proof, { ...principal, cognitoSubject: duplicate, cognitoUsername: duplicate }), conflict);
    await assert.rejects(enroll(googleProof(randomUUID(), email), { ...principal, cognitoUsername: "changed" }), conflict);
    await assert.rejects(enroll(proof, { ...principal, email: "different-" + email }), conflict);
    await assert.rejects(enroll(googleProof(proof.identity.subject, "different-" + email),
      { ...principal, email: "different-" + email }), conflict);
    const nonAuthoritative: ProviderEnrollmentProof = { ...proof,
      identity: { ...proof.identity, subject: randomUUID(), email: { address: email, authority: "otp_required", privateRelay: false } } };
    await assert.rejects(enroll(nonAuthoritative, principal), conflict);
    assert.deepEqual(await enroll(nonAuthoritative, null), { status: "verification_required", reason: "mailbox_required", providerEmail: email });
    const missing: ProviderEnrollmentProof = { ...proof, identity: { ...proof.identity, subject: randomUUID(), email: null } };
    assert.deepEqual(await enroll(missing, null), { status: "verification_required", reason: "mailbox_required", providerEmail: null });

    const historical = googleProof("historical-" + randomUUID(), email);
    await runtime.query("SELECT auth.bind_provider_identity('google',$1,$2)", [historical.identity.subject, subject]);
    assert.deepEqual(await enroll(historical, principal), { status: "verification_required", reason: "historical_binding", providerEmail: email });
    const foreignHistorical = googleProof("foreign-" + randomUUID(), email);
    await runtime.query("SELECT auth.bind_provider_identity('google',$1,$2)", [foreignHistorical.identity.subject, duplicate]);
    await assert.rejects(enroll(foreignHistorical, principal), conflict);
    assert.equal((await owner.query("SELECT 1 FROM auth.provider_login_methods WHERE provider_subject = ANY($1::text[])",
      [[historical.identity.subject, foreignHistorical.identity.subject]])).rowCount, 0);
    await owner.query("UPDATE auth.provider_login_methods SET status = 'disabled', disabled_at = clock_timestamp() WHERE provider_subject = $1",
      [proof.identity.subject]);
    await assert.rejects(enroll(proof, principal), { code: "PROVIDER_METHOD_DISABLED" });
    await assert.rejects(enroll(proof, null), { code: "PROVIDER_METHOD_DISABLED" });
    assert.equal((await owner.query("SELECT status FROM auth.provider_login_methods WHERE provider_subject = $1", [proof.identity.subject])).rows[0].status, "disabled");

    await assert.rejects(enroll(googleProof(randomUUID(), email), { ...principal, cognitoSubject: demo, cognitoUsername: demo }), { code: "23514" });
    await owner.query("INSERT INTO auth.deleted_subjects(subject_sha256) VALUES ($1)", [authHandleHash(deleted)]);
    await assert.rejects(enroll(googleProof(randomUUID(), email), { ...principal, cognitoSubject: deleted, cognitoUsername: deleted }), { code: "23514" });
    await owner.query("INSERT INTO auth.deleted_accounts(user_id_sha256) VALUES ($1)", [authHandleHash(account)]);
    await assert.rejects(enroll(googleProof(randomUUID(), email), principal), { code: "23514" });
    assert.equal(await mappedAccount(), account);
    assert.equal((await owner.query("SELECT cognito_username FROM auth.cognito_principals WHERE cognito_subject = $1", [subject])).rows[0].cognito_username, username);
  } finally {
    await owner.query("DELETE FROM org.user_settings WHERE user_id = ANY($1::text[])", [[account, duplicateAccount, demoAccount]]);
    await owner.query("DELETE FROM auth.cognito_principals WHERE cognito_subject = ANY($1::text[])", [[subject, duplicate, demo, deleted]]);
    await owner.query("DELETE FROM auth.deleted_subjects WHERE subject_sha256 = $1", [authHandleHash(deleted)]);
    await owner.query("DELETE FROM auth.deleted_accounts WHERE user_id_sha256 = $1", [authHandleHash(account)]);
  }
}

export async function checkAtomicAuthoritativeLogin(runtime: pg.Client, owner: pg.Client): Promise<void> {
  const subject = randomUUID();
  const failedSubject = randomUUID();
  const appleSubject = randomUUID();
  const account = randomUUID();
  const appleAccount = randomUUID();
  const username = "canonical-" + randomUUID();
  const email = randomUUID() + "@mail.test";
  const principal: CognitoEmailPrincipal = { cognitoSubject: subject, cognitoUsername: username, email };
  const verifier = randomBytes(32).toString("base64url");
  const binding = { client: "ios", purpose: "login", codeVerifier: verifier } as const;
  const attempts: Array<string> = [];
  const notificationReceipts: Array<string> = [];
  const previousKey = process.env.SESSION_ENCRYPTION_KEY;
  process.env.SESSION_ENCRYPTION_KEY = randomBytes(32).toString("hex");
  const beginVerifying = async (provider: "google" | "apple") => {
    const handle = randomBytes(32).toString("base64url");
    const hash = authHandleHash(handle);
    attempts.push(hash);
    await runtime.query("SELECT auth.create_social_attempt($1,$2,'ios','login',$3,NULL,NULL,NULL,NULL,'module-fixture',NULL,NULL,NULL,NULL)",
      [hash, provider, authAttemptBindingHash(binding)]);
    const claim = (await runtime.query("SELECT * FROM auth.claim_social_attempt($1,$2,'login','ios',NULL,'provider_ready')",
      [hash, authAttemptBindingHash(binding)])).rows[0].claim_id as string;
    const advance = "SELECT auth.advance_social_attempt($1,$2,$3,$4,'module-fixture',$5)";
    await runtime.query(advance, [hash, claim, "provider_claimed", "provider_verifying", null]);
    return { handle, claimId: claim, provider };
  };
  const prepare = async (provider: "google" | "apple", providerSubject: string) => {
    const attempt = await beginVerifying(provider);
    const advance = "SELECT auth.advance_social_attempt($1,$2,$3,$4,'module-fixture',$5)";
    await runtime.query(advance, [authHandleHash(attempt.handle), attempt.claimId, "provider_verifying", "provider_proved", providerSubject]);
    await runtime.query(advance, [authHandleHash(attempt.handle), attempt.claimId, "provider_proved", "provider_enrolling", providerSubject]);
    return attempt;
  };
  try {
    await owner.query("INSERT INTO org.user_settings(user_id,email) VALUES ($1,$2)", [account, email]);
    await owner.query("SELECT auth.bind_cognito_account($1,$2)", [subject, account]);
    const proof = googleProof("atomic-" + randomUUID(), email);
    const attempt = await prepare("google", proof.identity.subject);
    assert.equal((await owner.query("SELECT 1 FROM auth.verified_login_emails WHERE cognito_subject = $1", [subject])).rowCount, 0);
    const completed = await inTransaction(runtime, (executor) => completeAuthoritativeLoginInExecutor(executor, attempt, proof, principal));
    assert.equal(completed.status, "completed");
    if (completed.status !== "completed") throw new Error("Expected atomic login completion");
    const redeemed = await inTransaction(runtime, (executor) => redeemSocialSignInInExecutor(executor, completed.response.completion, binding));
    assert.equal(redeemed.cognitoSubject, subject);
    assert.equal(redeemed.cognitoUsername, username);
    assert.equal(redeemed.signInHint.recoveryEmail, email);
    assert.equal((await owner.query("SELECT user_id FROM auth.user_identities WHERE provider_subject = $1", [redeemed.cognitoSubject])).rows[0].user_id, account);
    await assert.rejects(inTransaction(runtime, (executor) => redeemSocialSignInInExecutor(executor, completed.response.completion, binding)),
      { code: "AUTH_COMPLETION_INVALID" });

    const expiringProof = googleProof("expiring-" + randomUUID(), email);
    const expiring = await prepare("google", expiringProof.identity.subject);
    // Expire the real persisted attempt while enrollment holds only the principal lifecycle lock.
    await assert.rejects(inTransaction(runtime, async (executor) => {
      const enrolled = await enrollAuthoritativeLoginPrincipalInExecutor(executor, expiringProof, principal);
      assert.equal(enrolled.status, "enrolled");
      await owner.query("UPDATE auth.social_attempts SET expires_at = clock_timestamp() - INTERVAL '1 second' WHERE attempt_sha256 = $1",
        [authHandleHash(expiring.handle)]);
      return completeAuthoritativeLoginInExecutor(executor, expiring, expiringProof, principal);
    }), { code: "55006" });
    assert.equal((await owner.query("SELECT 1 FROM auth.provider_identities WHERE provider_subject = $1", [expiringProof.identity.subject])).rowCount, 0);
    assert.equal((await owner.query("SELECT 1 FROM auth.provider_login_methods WHERE provider_subject = $1", [expiringProof.identity.subject])).rowCount, 0);

    const failedProof = googleProof("failed-completion-" + randomUUID(), email);
    const failed = await prepare("google", failedProof.identity.subject);
    const failedPrincipal = { ...principal, cognitoSubject: failedSubject, cognitoUsername: failedSubject };
    await assert.rejects(inTransaction(runtime, (executor) => completeAuthoritativeLoginInExecutor(executor,
      { ...failed, claimId: randomUUID() }, failedProof, failedPrincipal)), { code: "55006" });
    assert.equal((await owner.query("SELECT 1 FROM auth.provider_identities WHERE provider_subject = $1", [failedProof.identity.subject])).rowCount, 0);
    assert.equal((await owner.query("SELECT 1 FROM auth.provider_login_methods WHERE provider_subject = $1", [failedProof.identity.subject])).rowCount, 0);
    assert.equal((await owner.query("SELECT 1 FROM auth.cognito_principals WHERE cognito_subject = $1", [failedSubject])).rowCount, 0);
    assert.equal((await owner.query("SELECT 1 FROM auth.verified_login_emails WHERE cognito_subject = $1", [failedSubject])).rowCount, 0);
    assert.equal((await owner.query("SELECT count(*)::int AS count FROM org.user_settings WHERE user_id = ANY($1::text[])", [[subject, account]])).rows[0].count, 1);

    const relay = randomUUID() + "@privaterelay.appleid.com";
    const appleProvider = "apple-module-" + randomUUID();
    const appleClientId = "postgres-apple-client";
    const appleProof: ProviderEnrollmentProof = { provider: "apple", issuedAt: Math.floor(Date.now() / 1_000), identity: {
      provider: "apple", subject: appleProvider, clientId: appleClientId,
      email: { address: relay, authority: "provider", privateRelay: true },
    }, credential: encryptAppleCredential(appleProvider, appleClientId, "module-credential-fixture") };
    const applePrincipal = { cognitoSubject: appleSubject, cognitoUsername: appleSubject, email: relay };
    await owner.query("INSERT INTO org.user_settings(user_id,email) VALUES ($1,$2)", [appleAccount, relay]);
    await owner.query("SELECT auth.bind_cognito_account($1,$2)", [appleSubject, appleAccount]);
    const appleAttempt = await prepare("apple", appleProvider);
    const appleCompleted = await inTransaction(runtime, (executor) =>
      completeAuthoritativeLoginInExecutor(executor, appleAttempt, appleProof, applePrincipal));
    assert.equal(appleCompleted.status, "completed");
    if (appleCompleted.status !== "completed") throw new Error("Expected Apple relay completion");
    const appleRedeemed = await inTransaction(runtime, (executor) =>
      redeemSocialSignInInExecutor(executor, appleCompleted.response.completion, binding));
    assert.equal(appleRedeemed.cognitoSubject, appleSubject);
    assert.equal(appleRedeemed.signInHint.providerEmail, relay);
    assert.equal(appleRedeemed.signInHint.recoveryEmail, relay);
    assert.equal((await owner.query("SELECT user_id FROM auth.user_identities WHERE provider_subject = $1", [appleSubject])).rows[0].user_id, appleAccount);
    const credential = (await owner.query("SELECT ciphertext FROM auth.apple_revocation_credentials WHERE provider_subject = $1", [appleProvider])).rows[0].ciphertext as string;
    await owner.query("INSERT INTO auth.apple_revocation_jobs(provider_subject,client_id,credential_sha256,reason) VALUES ($1,$2,$3,'unlink')",
      [appleProvider, appleClientId, authHandleHash(credential)]);
    await assert.rejects(inTransaction(runtime, (executor) =>
      enrollAuthoritativeLoginPrincipalInExecutor(executor, appleProof, applePrincipal)), { code: "APPLE_REVOCATION_PENDING" });
    assert.equal((await owner.query("SELECT ciphertext FROM auth.apple_revocation_credentials WHERE provider_subject = $1", [appleProvider])).rows[0].ciphertext, credential);

    await owner.query("DELETE FROM auth.apple_revocation_jobs WHERE provider_subject = $1", [appleProvider]);
    await owner.query("UPDATE auth.provider_login_methods SET activated_at = clock_timestamp() - INTERVAL '2 minutes' WHERE provider_subject = $1", [appleProvider]);
    const revokedAt = new Date(Date.now() - 60_000);
    const notification = async (type: "consent-revoked" | "account-deleted", eventAt: Date) => {
      const receipt = authHandleHash(randomUUID());
      notificationReceipts.push(receipt);
      const parameters = [receipt, authHandleHash(receipt), appleProvider, type, eventAt];
      const apply = () => runtime.query<{ outcome: string }>(
        "SELECT auth.apply_apple_notification($1,$2,$3,$4,$5,NULL) AS outcome", parameters);
      return { outcome: (await apply()).rows[0].outcome, replay: apply };
    };
    assert.equal((await notification("consent-revoked", revokedAt)).outcome, "applied");
    const record = (attempt: Awaited<ReturnType<typeof beginVerifying>>, issuedAt: number) => runtime.query(
      "SELECT auth.record_apple_login_proof($1,$2,'module-fixture',$3,$4)",
      [authHandleHash(attempt.handle), attempt.claimId, appleProvider, issuedAt]);
    const pending = await beginVerifying("apple");
    await assert.rejects(record(pending, Math.floor(Date.now() / 1_000) + 2), { code: "P4102" });
    // Only fixture cleanup is simulated; provider revocation/signout acceptance remains a real-device check.
    const finishCleanup = async () => {
      await owner.query("DELETE FROM auth.apple_revocation_jobs WHERE provider_subject = $1", [appleProvider]);
      await owner.query("DELETE FROM auth.apple_revocation_credentials WHERE provider_subject = $1", [appleProvider]);
      await owner.query("UPDATE auth.apple_session_revocation_jobs SET completed_at = clock_timestamp(), cognito_subject = NULL, lease_id = NULL, lease_until = NULL WHERE subject_sha256 = $1 AND completed_at IS NULL", [authHandleHash(appleSubject)]);
    };
    await finishCleanup();
    const stale = await beginVerifying("apple");
    await assert.rejects(record(stale, Math.floor(revokedAt.getTime() / 1_000)), { code: "P4103" });
    const freshIssuedAt = Math.floor(Date.now() / 1_000) + 2;
    const reconnectProof: ProviderEnrollmentProof = { ...appleProof, issuedAt: freshIssuedAt,
      identity: { ...appleProof.identity, email: { address: email, authority: "provider", privateRelay: false } } };
    const prepareReconnect = async () => {
      const attempt = await beginVerifying("apple");
      await record(attempt, freshIssuedAt);
      await runtime.query("SELECT auth.advance_social_attempt($1,$2,'provider_proved','provider_enrolling','module-fixture',$3)",
        [authHandleHash(attempt.handle), attempt.claimId, appleProvider]);
      return attempt;
    };
    const failedReconnect = await prepareReconnect();
    await assert.rejects(inTransaction(runtime, async (executor) => {
      const result = await completeAuthoritativeLoginInExecutor(executor, failedReconnect, reconnectProof, null);
      assert.equal(result.status, "completed");
      throw new Error("module-reconnect-rollback");
    }), { message: "module-reconnect-rollback" });
    assert.equal((await owner.query("SELECT status FROM auth.provider_login_methods WHERE provider_subject = $1", [appleProvider])).rows[0].status, "disabled");
    assert.equal((await owner.query("SELECT 1 FROM auth.apple_revocation_credentials WHERE provider_subject = $1", [appleProvider])).rowCount, 0);
    assert.equal((await owner.query("SELECT phase FROM auth.social_attempts WHERE attempt_sha256 = $1", [authHandleHash(failedReconnect.handle)])).rows[0].phase, "provider_enrolling");

    const reconnectAttempt = await prepareReconnect();
    const reconnected = await inTransaction(runtime, (executor) =>
      completeAuthoritativeLoginInExecutor(executor, reconnectAttempt, reconnectProof, null));
    assert.equal(reconnected.status, "completed");
    if (reconnected.status !== "completed") throw new Error("Expected Apple reconnection completion");
    assert.equal(reconnected.reconnected, true);
    const recovered = await inTransaction(runtime, (executor) =>
      redeemSocialSignInInExecutor(executor, reconnected.response.completion, binding));
    assert.equal(recovered.cognitoSubject, appleSubject);
    assert.equal(recovered.cognitoUsername, appleSubject);
    assert.equal(recovered.signInHint.recoveryEmail, relay);
    assert.equal(recovered.signInHint.providerEmail, email);
    assert.equal((await owner.query("SELECT user_id FROM auth.user_identities WHERE provider_subject = $1", [appleSubject])).rows[0].user_id, appleAccount);
    assert.equal((await owner.query("SELECT user_id FROM auth.user_identities WHERE provider_subject = $1", [subject])).rows[0].user_id, account);
    assert.equal((await owner.query("SELECT 1 FROM auth.verified_login_emails WHERE cognito_subject = $1 AND email = $2", [appleSubject, email])).rowCount, 0);
    await assert.rejects(inTransaction(runtime, (executor) =>
      redeemSocialSignInInExecutor(executor, reconnected.response.completion, binding)), { code: "AUTH_COMPLETION_INVALID" });
    await assert.rejects(inTransaction(runtime, (executor) =>
      completeAuthoritativeLoginInExecutor(executor, failedReconnect, reconnectProof, null)), { code: "P4103" });
    const delayed = await notification("consent-revoked", new Date(freshIssuedAt * 1_000));
    assert.equal(delayed.outcome, "ignored_stale");
    assert.equal((await delayed.replay()).rows[0].outcome, "ignored_stale");
    assert.equal((await owner.query("SELECT status FROM auth.provider_login_methods WHERE provider_subject = $1", [appleProvider])).rows[0].status, "active");

    await runtime.query("SELECT auth.stage_apple_method_revocation($1,$2)", [appleSubject, appleProvider]);
    await finishCleanup();
    const unlinked = await beginVerifying("apple");
    await assert.rejects(record(unlinked, freshIssuedAt + 2), { code: "P4101" });
    await owner.query("UPDATE auth.provider_login_methods SET disabled_reason = NULL WHERE provider_subject = $1", [appleProvider]);
    const unknown = await beginVerifying("apple");
    await assert.rejects(record(unknown, freshIssuedAt + 2), { code: "P4101" });
    assert.equal((await notification("account-deleted", new Date((freshIssuedAt + 2) * 1_000))).outcome, "applied");
    await finishCleanup();
    const appleDeleted = await beginVerifying("apple");
    await assert.rejects(record(appleDeleted, freshIssuedAt + 3), { code: "P4101" });
    await owner.query("INSERT INTO auth.deleted_accounts(user_id_sha256) VALUES ($1)", [authHandleHash(appleAccount)]);
    const appDeleted = await beginVerifying("apple");
    await assert.rejects(record(appDeleted, freshIssuedAt + 3), { code: "23514" });
    await owner.query("DELETE FROM auth.deleted_accounts WHERE user_id_sha256 = $1", [authHandleHash(appleAccount)]);

  } finally {
    if (previousKey === undefined) delete process.env.SESSION_ENCRYPTION_KEY;
    else process.env.SESSION_ENCRYPTION_KEY = previousKey;
    await owner.query("DELETE FROM auth.social_attempts WHERE attempt_sha256 = ANY($1::text[])", [attempts]);
    await owner.query("DELETE FROM auth.apple_notification_receipts WHERE notification_sha256 = ANY($1::text[])", [notificationReceipts]);
    await owner.query("DELETE FROM auth.apple_session_revocation_jobs WHERE subject_sha256 = $1", [authHandleHash(appleSubject)]);
    await owner.query("DELETE FROM auth.principal_session_fences WHERE subject_sha256 = $1", [authHandleHash(appleSubject)]);
    await owner.query("DELETE FROM auth.deleted_accounts WHERE user_id_sha256 = $1", [authHandleHash(appleAccount)]);
    await owner.query("DELETE FROM auth.apple_revocation_jobs WHERE provider_subject IN (SELECT provider_subject FROM auth.provider_identities WHERE cognito_subject = $1)", [appleSubject]);
    await owner.query("DELETE FROM auth.apple_revocation_credentials WHERE cognito_subject = $1", [appleSubject]);
    await owner.query("DELETE FROM org.user_settings WHERE user_id = ANY($1::text[])", [[account, appleAccount]]);
    await owner.query("DELETE FROM auth.cognito_principals WHERE cognito_subject = ANY($1::text[])", [[subject, failedSubject, appleSubject]]);
  }
}
