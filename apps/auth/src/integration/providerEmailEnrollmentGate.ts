import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import type pg from "pg";
import type { DatabaseExecutor } from "../db.js";
import type { CognitoEmailPrincipal } from "../server/cognito/cognitoAuth.js";
import { encryptAppleCredential } from "../server/social/appleCredential.js";
import { authAttemptBindingHash, authHandleHash } from "../server/social/attemptStore.js";
import { completeAuthoritativeLoginInExecutor, redeemSocialSignInInExecutor } from "../server/social/completionStore.js";
import type { ProviderEnrollmentProof } from "../server/social/principalEnrollment.js";

async function inTransaction<Result>(client: pg.Client, operation: (executor: DatabaseExecutor) => Promise<Result>): Promise<Result> {
  await client.query("BEGIN");
  try {
    const result = await operation({ query: (text, parameters) => client.query(text, [...parameters]) });
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function waitForSubjectLock(owner: pg.Client, pid: number): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await owner.query<{ waiting: boolean }>(
      "SELECT pg_backend_pid() = ANY(pg_blocking_pids($1)) AS waiting", [pid]);
    if (result.rows[0].waiting) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Email enrollment did not wait for competing provisioning subject lock");
}

async function mappingInRuntime(client: pg.Client, subject: string): Promise<string | null> {
  return (await client.query<{ user_id: string }>(
    "SELECT user_id FROM auth.user_identities WHERE provider_type = 'cognito' AND provider_subject = $1", [subject],
  )).rows[0]?.user_id ?? null;
}

// Fixtures enter the verified-proof boundary; these checks assert real PostgreSQL ownership, not provider delivery.
export async function checkProviderEmailEnrollment(runtime: pg.Client, owner: pg.Client): Promise<void> {
  const appleSubject = randomUUID();
  const account = randomUUID();
  const foreignAccount = randomUUID();
  const legacySubject = randomUUID();
  const unprovisionedSubject = randomUUID();
  const retiredEmailAccount = randomUUID();
  const extraAccounts: Array<string> = [];
  const extraSubjects: Array<string> = [];
  const appleProvider = "enrollment-apple-" + randomUUID();
  const relay = randomUUID() + "@privaterelay.appleid.com";
  const clientId = "postgres-apple-client";
  const principals = Array.from({ length: 8 }, (): CognitoEmailPrincipal => ({
    cognitoSubject: randomUUID(), cognitoUsername: randomUUID(), email: randomUUID() + "@mail.test",
  }));
  const [fresh, sameAccount, foreign, legacy, raced, rolledBack, legacyEmail, canonicalEmail] = principals;
  const attempts: Array<string> = [];
  const extraProviders: Array<string> = [];
  const previousKey = process.env.SESSION_ENCRYPTION_KEY;
  process.env.SESSION_ENCRYPTION_KEY = randomBytes(32).toString("hex");
  const binding = { client: "ios", purpose: "login", codeVerifier: randomBytes(32).toString("base64url") } as const;
  const proofFor = (email: string, privateRelay: boolean): Extract<ProviderEnrollmentProof, { provider: "apple" }> => ({
    provider: "apple", issuedAt: Math.floor(Date.now() / 1_000),
    identity: { provider: "apple", subject: appleProvider, clientId,
      email: { address: email, authority: "provider", privateRelay } },
    credential: encryptAppleCredential(appleProvider, clientId, "module-email-enrollment-credential"),
  });
  const prepare = async (proof: ProviderEnrollmentProof) => {
    const handle = randomBytes(32).toString("base64url");
    const hash = authHandleHash(handle);
    attempts.push(hash);
    await runtime.query("SELECT auth.create_social_attempt($1,'apple','ios','login',$2,NULL,NULL,NULL,NULL,'fixture',NULL,NULL,NULL,NULL)",
      [hash, authAttemptBindingHash(binding)]);
    const claimId = (await runtime.query<{ claim_id: string }>(
      "SELECT * FROM auth.claim_social_attempt($1,$2,'login','ios',NULL,'provider_ready')", [hash, authAttemptBindingHash(binding)],
    )).rows[0].claim_id;
    await runtime.query("SELECT auth.advance_social_attempt($1,$2,'provider_claimed','provider_verifying','fixture',NULL)", [hash, claimId]);
    await runtime.query("SELECT auth.record_apple_login_proof($1,$2,'fixture',$3,$4)",
      [hash, claimId, proof.identity.subject, Math.floor(Date.now() / 1_000)]);
    await runtime.query("SELECT auth.advance_social_attempt($1,$2,'provider_proved','provider_enrolling','fixture',$3)",
      [hash, claimId, proof.identity.subject]);
    return { handle, claimId, provider: "apple" as const };
  };
  const mapping = async (subject: string) => (await owner.query<{ user_id: string }>(
    "SELECT user_id FROM auth.user_identities WHERE provider_type = 'cognito' AND provider_subject = $1", [subject],
  )).rows[0]?.user_id ?? null;
  const profile = async () => (await owner.query<{ email: string | null }>(
    "SELECT email FROM org.user_settings WHERE user_id = $1", [account],
  )).rows[0].email;
  const login = async (principal: CognitoEmailPrincipal | null, proof: ProviderEnrollmentProof) => {
    const attempt = await prepare(proof);
    const completed = await inTransaction(runtime, (executor) => completeAuthoritativeLoginInExecutor(executor, attempt, proof, principal));
    assert.equal(completed.status, "completed");
    if (completed.status !== "completed") throw new Error("Expected ordinary Apple login completion");
    const redeemed = await inTransaction(runtime, (executor) => redeemSocialSignInInExecutor(executor, completed.response.completion, binding));
    assert.equal(redeemed.cognitoSubject, appleSubject);
    assert.equal(redeemed.cognitoUsername, appleSubject);
    assert.equal(redeemed.signInHint.recoveryEmail, relay);
    return completed;
  };
  try {
    await owner.query("INSERT INTO org.user_settings(user_id,email) VALUES ($1,$2),($3,$4)",
      [account, relay, foreignAccount, foreign.email]);
    await owner.query("SELECT auth.bind_cognito_account($1,$2)", [appleSubject, account]);
    await runtime.query("SELECT auth.enroll_proved_email_principal($1,$1,$2,clock_timestamp())", [appleSubject, relay]);
    await runtime.query("SELECT auth.activate_proved_provider_method('apple',$1,$2,$3)", [appleProvider, appleSubject, relay]);
    const originalMethod = (await owner.query("SELECT * FROM auth.provider_login_methods WHERE provider_subject = $1", [appleProvider])).rows[0];

    assert.equal((await login(null, proofFor(relay, true))).emailEnrollment, null);
    assert.equal(await profile(), relay);
    const unprovedEmail = proofFor(fresh.email, false);
    assert.equal((await login(null, { ...unprovedEmail, identity: { ...unprovedEmail.identity,
      email: { address: fresh.email, authority: "otp_required", privateRelay: false } } })).emailEnrollment, null);
    assert.equal(await mapping(fresh.cognitoSubject), null);
    assert.equal(await profile(), relay);
    assert.equal((await login(fresh, proofFor(fresh.email, false))).emailEnrollment, "linked");
    assert.equal(await mapping(fresh.cognitoSubject), account);
    assert.equal(await profile(), fresh.email);
    assert.deepEqual((await runtime.query("SELECT * FROM auth.account_recovery_email($1,$1,$2)",
      [appleSubject, Math.floor(Date.now() / 1_000)])).rows[0], {
      cognito_subject: fresh.cognitoSubject, cognito_username: fresh.cognitoUsername, email: fresh.email,
    });
    assert.equal((await login(fresh, proofFor(fresh.email, false))).emailEnrollment, "already_same_account");

    await owner.query("SELECT auth.bind_cognito_account($1,$2)", [sameAccount.cognitoSubject, account]);
    assert.equal((await login(sameAccount, proofFor(sameAccount.email, false))).emailEnrollment, "already_same_account");
    assert.equal(await profile(), fresh.email);
    assert.equal((await owner.query("SELECT 1 FROM auth.verified_login_emails WHERE cognito_subject = $1 AND email = $2",
      [sameAccount.cognitoSubject, sameAccount.email])).rowCount, 1);

    // A newly seen Apple identity with the same authoritative email reuses Q before product provisioning.
    const newProvider = "enrollment-unbound-" + randomUUID();
    extraProviders.push(newProvider);
    const unboundProof: ProviderEnrollmentProof = { ...proofFor(fresh.email, false),
      identity: { provider: "apple", subject: newProvider, clientId,
        email: { address: fresh.email, authority: "provider", privateRelay: false } },
      credential: encryptAppleCredential(newProvider, clientId, "module-unbound-credential") };
    const unboundAttempt = await prepare(unboundProof);
    const unbound = await inTransaction(runtime, (executor) => completeAuthoritativeLoginInExecutor(executor, unboundAttempt, unboundProof, fresh));
    assert.equal(unbound.status, "completed");
    assert.equal((await owner.query("SELECT cognito_subject FROM auth.provider_identities WHERE provider_subject = $1", [newProvider])).rows[0].cognito_subject, fresh.cognitoSubject);
    assert.equal(await mapping(fresh.cognitoSubject), account);
    assert.equal((await owner.query("SELECT 1 FROM org.user_settings WHERE user_id = $1", [fresh.cognitoSubject])).rowCount, 0);

    const historicalProvider = "enrollment-historical-" + randomUUID();
    extraProviders.push(historicalProvider);
    await runtime.query("SELECT auth.bind_provider_identity('apple',$1,$2)", [historicalProvider, appleSubject]);
    const historicalProof: ProviderEnrollmentProof = { ...proofFor(fresh.email, false),
      identity: { provider: "apple", subject: historicalProvider, clientId,
        email: { address: fresh.email, authority: "provider", privateRelay: false } },
      credential: encryptAppleCredential(historicalProvider, clientId, "module-historical-credential") };
    const historicalAttempt = await prepare(historicalProof);
    assert.deepEqual(await inTransaction(runtime, (executor) =>
      completeAuthoritativeLoginInExecutor(executor, historicalAttempt, historicalProof, fresh)), {
      status: "verification_required",
      enrollment: { status: "verification_required", reason: "historical_binding", providerEmail: fresh.email },
    });

    await owner.query("SELECT auth.bind_cognito_account($1,$2)", [foreign.cognitoSubject, foreignAccount]);
    assert.equal((await login(foreign, proofFor(foreign.email, false))).emailEnrollment, "foreign_account");
    assert.equal(await mapping(foreign.cognitoSubject), foreignAccount);
    assert.equal(await profile(), fresh.email);
    assert.equal((await owner.query("SELECT 1 FROM auth.cognito_principals WHERE cognito_subject = $1", [foreign.cognitoSubject])).rowCount, 0);
    await owner.query("INSERT INTO org.user_settings(user_id,email) VALUES ($1,$2)", [legacy.cognitoSubject, legacy.email]);
    assert.equal((await login(legacy, proofFor(legacy.email, false))).emailEnrollment, "foreign_account");
    assert.equal(await mapping(legacy.cognitoSubject), null);

    const rollbackProof = proofFor(rolledBack.email, false);
    const rollbackAttempt = await prepare(rollbackProof);
    const storedCredential = (await owner.query("SELECT ciphertext FROM auth.apple_revocation_credentials WHERE provider_subject = $1", [appleProvider])).rows[0].ciphertext;
    await owner.query("UPDATE org.user_settings SET email = NULL WHERE user_id = $1", [account]);
    await assert.rejects(inTransaction(runtime, async (executor) => {
      const completed = await completeAuthoritativeLoginInExecutor(executor, rollbackAttempt, rollbackProof, rolledBack);
      assert.equal(completed.status, "completed");
      throw new Error("rollback-email-enrollment");
    }), { message: "rollback-email-enrollment" });
    assert.equal(await mapping(rolledBack.cognitoSubject), null);
    assert.equal(await profile(), null);
    assert.equal((await owner.query("SELECT 1 FROM auth.cognito_principals WHERE cognito_subject = $1", [rolledBack.cognitoSubject])).rowCount, 0);
    assert.equal((await owner.query("SELECT ciphertext FROM auth.apple_revocation_credentials WHERE provider_subject = $1", [appleProvider])).rows[0].ciphertext, storedCredential);
    assert.equal((await owner.query("SELECT phase FROM auth.social_attempts WHERE attempt_sha256 = $1", [authHandleHash(rollbackAttempt.handle)])).rows[0].phase, "provider_enrolling");

    const retried = await inTransaction(runtime, (executor) => completeAuthoritativeLoginInExecutor(executor, rollbackAttempt, rollbackProof, rolledBack));
    assert.equal(retried.status, "completed");
    assert.equal(await profile(), rolledBack.email);
    assert.equal(await mapping(rolledBack.cognitoSubject), account);
    await owner.query("UPDATE org.user_settings SET email = $2 WHERE user_id = $1", [account, relay]);

    // Real subject/account writes compete with enrollment using the generic provisioning lock contract.
    const raceProof = proofFor(raced.email, false);
    const raceAttempt = await prepare(raceProof);
    const pid = (await runtime.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    await owner.query("BEGIN");
    await owner.query("SELECT pg_advisory_xact_lock(hashtextextended('auth.cognito_identity:' || $1::text, 2::BIGINT))", [raced.cognitoSubject]);
    const completion = inTransaction(runtime, (executor) => completeAuthoritativeLoginInExecutor(executor, raceAttempt, raceProof, raced));
    // Observe rejection immediately as well, so a failed wait cannot leave an unhandled promise.
    const observedCompletion = completion.then((result) => ({ result }), (error: unknown) => ({ error }));
    try {
      await waitForSubjectLock(owner, pid);
      await owner.query("SELECT auth.bind_cognito_account($1,$2)", [raced.cognitoSubject, foreignAccount]);
      await owner.query("COMMIT");
    } catch (error) {
      await owner.query("ROLLBACK");
      await observedCompletion;
      throw error;
    }
    const completedRace = await completion;
    assert.equal(completedRace.status, "completed");
    if (completedRace.status !== "completed") throw new Error("Expected preserved Apple login after provisioning race");
    assert.equal(completedRace.emailEnrollment, "foreign_account");
    assert.equal(await mapping(raced.cognitoSubject), foreignAccount);
    assert.equal(await profile(), relay);
    assert.equal((await owner.query("SELECT 1 FROM auth.verified_login_emails WHERE cognito_subject = $1", [raced.cognitoSubject])).rowCount, 0);
    assert.equal((await owner.query("SELECT 1 FROM auth.verified_login_emails WHERE cognito_subject = $1 AND email = ANY($2::text[])",
      [appleSubject, principals.map((principal) => principal.email)])).rowCount, 0);
    assert.deepEqual((await owner.query("SELECT * FROM auth.provider_login_methods WHERE provider_subject = $1", [appleProvider])).rows[0], originalMethod);
    assert.equal(await mapping(appleSubject), account);

    const proofForBound = (providerSubject: string, address: string): ProviderEnrollmentProof => ({
      ...proofFor(address, false),
      identity: { provider: "apple", subject: providerSubject, clientId,
        email: { address, authority: "provider", privateRelay: false } },
      credential: encryptAppleCredential(providerSubject, clientId, "module-return-credential"),
    });
    const bindApple = async (subject: string): Promise<string> => {
      const providerSubject = "enrollment-return-" + randomUUID();
      extraProviders.push(providerSubject);
      extraSubjects.push(subject);
      await runtime.query("SELECT auth.enroll_proved_email_principal($1,$1,$2,clock_timestamp())", [subject, relay]);
      await runtime.query("SELECT auth.activate_proved_provider_method('apple',$1,$2,$3)", [providerSubject, subject, relay]);
      return providerSubject;
    };
    const completeAndRedeem = async (
      subject: string, principal: CognitoEmailPrincipal, proof: ProviderEnrollmentProof,
      attempt: Awaited<ReturnType<typeof prepare>>,
    ) => {
      const completed = await inTransaction(runtime, (executor) => completeAuthoritativeLoginInExecutor(executor, attempt, proof, principal));
      assert.equal(completed.status, "completed");
      if (completed.status !== "completed") throw new Error("Expected claimed Apple return completion");
      const redeemed = await inTransaction(runtime, (executor) => redeemSocialSignInInExecutor(executor, completed.response.completion, binding));
      assert.equal(redeemed.cognitoSubject, subject);
      assert.equal(redeemed.cognitoUsername, subject);
      assert.equal(redeemed.signInHint.recoveryEmail, relay);
      assert.equal(redeemed.signInHint.providerEmail, principal.email);
      await assert.rejects(inTransaction(runtime, (executor) =>
        redeemSocialSignInInExecutor(executor, completed.response.completion, binding)), { code: "AUTH_COMPLETION_INVALID" });
      return completed;
    };
    const recovery = async (subject: string) => (await runtime.query(
      "SELECT * FROM auth.account_recovery_email($1,$1,$2)", [subject, Math.floor(Date.now() / 1_000)],
    )).rows[0];
    const newEmail = (): CognitoEmailPrincipal => {
      const principal = { cognitoSubject: randomUUID(), cognitoUsername: randomUUID(), email: randomUUID() + "@mail.test" };
      extraSubjects.push(principal.cognitoSubject);
      return principal;
    };

    for (const ownership of ["same_account", "absent_p"] as const) {
      const subject = randomUUID();
      const providerSubject = await bindApple(subject);
      const principal = newEmail();
      const selectedOwner = randomUUID();
      extraAccounts.push(selectedOwner);
      await owner.query("INSERT INTO org.user_settings(user_id,email) VALUES ($1,$2)", [selectedOwner, relay]);
      await runtime.query("SELECT auth.register_cognito_principal($1,$2)", [principal.cognitoSubject, principal.cognitoUsername]);
      await owner.query("SELECT auth.bind_cognito_account($1,$2)", [principal.cognitoSubject, selectedOwner]);
      if (ownership === "same_account") await owner.query("SELECT auth.bind_cognito_account($1,$2)", [subject, selectedOwner]);
      await runtime.query("SELECT auth.invalidate_principal_sessions($1,$2)", [principal.cognitoSubject, randomUUID()]);
      assert.equal((await runtime.query("SELECT auth.principal_session_status($1,NULL) AS status",
        [principal.cognitoSubject])).rows[0].status, "pending");
      const proof = proofForBound(providerSubject, principal.email);
      const attempt = await prepare(proof);
      const profilesBefore = (await owner.query("SELECT count(*)::int AS count FROM org.user_settings")).rows[0].count;
      await assert.rejects(inTransaction(runtime, (executor) =>
        completeAuthoritativeLoginInExecutor(executor, attempt, proof, principal)), {
        code: "55006", message: "Email principal signout is pending; retry a fresh sign-in after cleanup completes",
      });
      assert.equal(await mapping(subject), ownership === "same_account" ? selectedOwner : null);
      assert.equal(await mapping(principal.cognitoSubject), selectedOwner);
      assert.equal((await owner.query("SELECT count(*)::int AS count FROM org.user_settings")).rows[0].count, profilesBefore);
      assert.equal((await owner.query("SELECT email FROM org.user_settings WHERE user_id = $1", [selectedOwner])).rows[0].email, relay);
      assert.equal((await owner.query("SELECT 1 FROM org.user_settings WHERE user_id = $1", [subject])).rowCount, 0);
      assert.equal((await owner.query("SELECT 1 FROM auth.verified_login_emails WHERE cognito_subject = $1",
        [principal.cognitoSubject])).rowCount, 0);
      assert.equal((await owner.query("SELECT 1 FROM auth.principal_login_policies WHERE cognito_subject = $1",
        [principal.cognitoSubject])).rowCount, 0);
      assert.equal((await owner.query("SELECT 1 FROM auth.apple_revocation_credentials WHERE provider_subject = $1", [providerSubject])).rowCount, 0);
      assert.deepEqual((await owner.query("SELECT snapshot_account,phase,completion_sha256,result_ciphertext FROM auth.social_attempts WHERE attempt_sha256 = $1",
        [authHandleHash(attempt.handle)])).rows[0], {
        snapshot_account: ownership === "same_account" ? selectedOwner : null,
        phase: "provider_enrolling", completion_sha256: null, result_ciphertext: null,
      });
      // Only fixture cleanup is simulated; the next attempt obtains a fresh claimed provider proof.
      await owner.query("UPDATE auth.apple_session_revocation_jobs SET completed_at = clock_timestamp(), cognito_subject = NULL, lease_id = NULL, lease_until = NULL WHERE subject_sha256 = $1 AND completed_at IS NULL",
        [authHandleHash(principal.cognitoSubject)]);
      const freshAttempt = await prepare(proof);
      assert.equal((await completeAndRedeem(subject, principal, proof, freshAttempt)).emailEnrollment, "already_same_account");
      assert.equal(await mapping(subject), selectedOwner);
      assert.equal((await owner.query("SELECT email FROM org.user_settings WHERE user_id = $1", [selectedOwner])).rows[0].email, principal.email);
      assert.deepEqual(await recovery(subject), {
        cognito_subject: principal.cognitoSubject, cognito_username: principal.cognitoUsername, email: principal.email,
      });
    }

    // Legacy P is established even without a mapping. Its original null snapshot stays null.
    const legacyProvider = await bindApple(legacySubject);
    await owner.query("INSERT INTO org.user_settings(user_id,email) VALUES ($1,$2)", [legacySubject, relay]);
    const legacyProof = proofForBound(legacyProvider, legacyEmail.email);
    const legacyAttempt = await prepare(legacyProof);
    assert.equal((await completeAndRedeem(legacySubject, legacyEmail, legacyProof, legacyAttempt)).emailEnrollment, "linked");
    assert.equal(await mapping(legacySubject), null);
    assert.equal(await mapping(legacyEmail.cognitoSubject), legacySubject);
    assert.equal((await owner.query("SELECT snapshot_account FROM auth.social_attempts WHERE attempt_sha256 = $1",
      [authHandleHash(legacyAttempt.handle)])).rows[0].snapshot_account, null);

    // A retained raw Q owner resolves to P's live canonical owner without rebinding Q.
    await owner.query("INSERT INTO org.user_settings(user_id,email) VALUES ($1,$2)", [retiredEmailAccount, relay]);
    await owner.query("SELECT auth.bind_cognito_account($1,$2)", [canonicalEmail.cognitoSubject, retiredEmailAccount]);
    await owner.query("SELECT auth.record_account_retirement($1,$2,$3)", [retiredEmailAccount, account, randomUUID()]);
    assert.equal((await login(canonicalEmail, proofFor(canonicalEmail.email, false))).emailEnrollment, "already_same_account");
    assert.equal(await mapping(canonicalEmail.cognitoSubject), retiredEmailAccount);
    assert.equal((await owner.query("SELECT original_client_user_id FROM auth.user_identities WHERE provider_subject = $1",
      [canonicalEmail.cognitoSubject])).rows[0].original_client_user_id, retiredEmailAccount);
    assert.equal(await mapping(appleSubject), account);

    // Interrupted return: neither P nor Q owns a product account before this exact claim.
    const returnProvider = await bindApple(unprovisionedSubject);
    const returnEmail = newEmail();
    const returnProof = proofForBound(returnProvider, returnEmail.email);
    const returnAttempt = await prepare(returnProof);
    const staleAttempt = await prepare(returnProof);
    const originalSnapshot = (await owner.query("SELECT snapshot_subject,snapshot_username,snapshot_account, snapshot_provider_created_at, snapshot_principal_created_at,snapshot_method_activated_at FROM auth.social_attempts WHERE attempt_sha256 = $1",
      [authHandleHash(returnAttempt.handle)])).rows[0];
    assert.equal(originalSnapshot.snapshot_account, null);
    await assert.rejects(inTransaction(runtime, (executor) =>
      completeAuthoritativeLoginInExecutor(executor, returnAttempt, returnProof, null)), { code: "PROVIDER_ENROLLMENT_CONFLICT" });
    await assert.rejects(inTransaction(runtime, (executor) =>
      completeAuthoritativeLoginInExecutor(executor, { ...returnAttempt, claimId: randomUUID() }, returnProof, returnEmail)), { code: "55006" });
    assert.equal(await mapping(unprovisionedSubject), null);
    assert.equal(await mapping(returnEmail.cognitoSubject), null);
    assert.equal((await completeAndRedeem(unprovisionedSubject, returnEmail, returnProof, returnAttempt)).emailEnrollment, "linked");
    const mintedAccount = await mapping(unprovisionedSubject);
    assert.ok(mintedAccount);
    assert.notEqual(mintedAccount, unprovisionedSubject);
    extraAccounts.push(mintedAccount);
    assert.equal(await mapping(returnEmail.cognitoSubject), mintedAccount);
    const adoptedSnapshot = (await owner.query("SELECT snapshot_subject,snapshot_username,snapshot_account,snapshot_provider_created_at,snapshot_principal_created_at,snapshot_method_activated_at FROM auth.social_attempts WHERE attempt_sha256 = $1",
      [authHandleHash(returnAttempt.handle)])).rows[0];
    assert.deepEqual(adoptedSnapshot, { ...originalSnapshot, snapshot_account: mintedAccount });
    assert.deepEqual((await owner.query("SELECT workspace_id,email,locale,review_reaction_animations_enabled,analytics_consent,product_analytics_enabled,accent_color FROM org.user_settings WHERE user_id = $1",
      [mintedAccount])).rows[0], { workspace_id: null, email: returnEmail.email, locale: "en",
      review_reaction_animations_enabled: true, analytics_consent: null, product_analytics_enabled: null, accent_color: "#C44B2D" });
    assert.equal((await owner.query("SELECT 1 FROM org.workspace_memberships WHERE user_id = $1", [mintedAccount])).rowCount, 0);
    assert.equal((await owner.query("SELECT 1 FROM org.user_settings WHERE user_id = ANY($1::text[])",
      [[unprovisionedSubject, returnEmail.cognitoSubject]])).rowCount, 0);
    assert.deepEqual(await recovery(unprovisionedSubject), {
      cognito_subject: returnEmail.cognitoSubject, cognito_username: returnEmail.cognitoUsername, email: returnEmail.email,
    });
    await assert.rejects(inTransaction(runtime, (executor) =>
      completeAuthoritativeLoginInExecutor(executor, staleAttempt, returnProof, returnEmail)), { code: "23514" });
    assert.equal((await owner.query("SELECT snapshot_account,phase FROM auth.social_attempts WHERE attempt_sha256 = $1",
      [authHandleHash(staleAttempt.handle)])).rows[0].snapshot_account, null);

    // Existing mapped, legacy and canonical Q owners win; auth never inserts a P profile/workspace.
    for (const ownership of ["mapped", "legacy", "canonical"] as const) {
      const subject = randomUUID();
      const providerSubject = await bindApple(subject);
      const principal = newEmail();
      const rawOwner = ownership === "legacy" ? principal.cognitoSubject : randomUUID();
      const selectedOwner = ownership === "canonical" ? randomUUID() : rawOwner;
      extraAccounts.push(rawOwner);
      await owner.query("INSERT INTO org.user_settings(user_id,email) VALUES ($1,$2)", [rawOwner, relay]);
      if (ownership !== "legacy") await owner.query("SELECT auth.bind_cognito_account($1,$2)", [principal.cognitoSubject, rawOwner]);
      if (ownership === "canonical") {
        extraAccounts.push(selectedOwner);
        await owner.query("INSERT INTO org.user_settings(user_id,email) VALUES ($1,$2)", [selectedOwner, relay]);
        await owner.query("SELECT auth.record_account_retirement($1,$2,$3)", [rawOwner, selectedOwner, randomUUID()]);
      }
      const proof = proofForBound(providerSubject, principal.email);
      const attempt = await prepare(proof);
      const completed = await completeAndRedeem(subject, principal, proof, attempt);
      assert.equal(completed.emailEnrollment, ownership === "legacy" ? "linked" : "already_same_account");
      assert.equal(await mapping(subject), selectedOwner);
      assert.equal(await mapping(principal.cognitoSubject), ownership === "legacy" ? selectedOwner : rawOwner);
      assert.equal((await owner.query("SELECT 1 FROM org.user_settings WHERE user_id = $1", [subject])).rowCount, 0);
      assert.equal((await owner.query("SELECT 1 FROM org.workspace_memberships WHERE user_id = $1", [selectedOwner])).rowCount, 0);
      assert.deepEqual(await recovery(subject), {
        cognito_subject: principal.cognitoSubject, cognito_username: principal.cognitoUsername, email: principal.email,
      });
    }

    // The real completion expires AFTER profile, both bindings, enrollment and credential writes.
    const expiringSubject = randomUUID();
    const expiringProvider = await bindApple(expiringSubject);
    const expiringEmail = newEmail();
    const expiringProof = proofForBound(expiringProvider, expiringEmail.email);
    const expiringAttempt = await prepare(expiringProof);
    await owner.query("UPDATE auth.social_attempts SET expires_at = clock_timestamp() + INTERVAL '2 seconds' WHERE attempt_sha256 = $1",
      [authHandleHash(expiringAttempt.handle)]);
    await assert.rejects(inTransaction(runtime, () => completeAuthoritativeLoginInExecutor({
      query: async (text, parameters) => {
        if (text.startsWith("SELECT auth.complete_social_sign_in")) {
          const pendingOwner = await mappingInRuntime(runtime, expiringSubject);
          assert.ok(pendingOwner);
          assert.equal(await mappingInRuntime(runtime, expiringEmail.cognitoSubject), pendingOwner);
          assert.equal((await runtime.query("SELECT 1 FROM auth.verified_login_emails WHERE cognito_subject = $1",
            [expiringEmail.cognitoSubject])).rowCount, 1);
          assert.equal((await runtime.query("SELECT * FROM auth.load_apple_credentials($1)",
            [expiringSubject])).rowCount, 1);
          await runtime.query("SELECT pg_sleep(2.1)");
        }
        return runtime.query(text, [...parameters]);
      },
    }, expiringAttempt, expiringProof, expiringEmail)), { code: "55006" });
    assert.equal(await mapping(expiringSubject), null);
    assert.equal(await mapping(expiringEmail.cognitoSubject), null);
    assert.equal((await owner.query("SELECT 1 FROM org.user_settings WHERE email = $1", [expiringEmail.email])).rowCount, 0);
    assert.equal((await owner.query("SELECT 1 FROM auth.cognito_principals WHERE cognito_subject = $1", [expiringEmail.cognitoSubject])).rowCount, 0);
    assert.equal((await owner.query("SELECT 1 FROM auth.apple_revocation_credentials WHERE provider_subject = $1", [expiringProvider])).rowCount, 0);
    assert.deepEqual((await owner.query("SELECT snapshot_account,phase FROM auth.social_attempts WHERE attempt_sha256 = $1",
      [authHandleHash(expiringAttempt.handle)])).rows[0], { snapshot_account: null, phase: "provider_enrolling" });

    // Low-level retirement alone is not a completed union: a stale raw-P snapshot remains refused.
    const retiringAttempt = await prepare(proofFor(fresh.email, false));
    await owner.query("SELECT auth.record_account_retirement($1,$2,$3)", [account, foreignAccount, randomUUID()]);
    await assert.rejects(inTransaction(runtime, (executor) => completeAuthoritativeLoginInExecutor(
      executor, retiringAttempt, proofFor(fresh.email, false), fresh)), { code: "23514" });
    assert.equal(await mapping(appleSubject), account);
  } finally {
    if (previousKey === undefined) delete process.env.SESSION_ENCRYPTION_KEY;
    else process.env.SESSION_ENCRYPTION_KEY = previousKey;
    await owner.query("ROLLBACK");
    await owner.query("DELETE FROM auth.social_attempts WHERE attempt_sha256 = ANY($1::text[])", [attempts]);
    await owner.query("DELETE FROM auth.apple_revocation_credentials WHERE provider_subject = ANY($1::text[])", [[appleProvider, ...extraProviders]]);
    await owner.query("DELETE FROM auth.account_retirements WHERE retired_user_id = ANY($1::text[])",
      [[account, retiredEmailAccount, ...extraAccounts]]);
    await owner.query("DELETE FROM org.user_settings WHERE user_id = ANY($1::text[])", [[account, foreignAccount, legacy.cognitoSubject, legacySubject, retiredEmailAccount, ...extraAccounts]]);
    await owner.query("DELETE FROM auth.apple_session_revocation_jobs WHERE subject_sha256 = ANY($1::text[])", [extraSubjects.map(authHandleHash)]);
    await owner.query("DELETE FROM auth.principal_session_fences WHERE subject_sha256 = ANY($1::text[])", [extraSubjects.map(authHandleHash)]);
    await owner.query("DELETE FROM auth.cognito_principals WHERE cognito_subject = ANY($1::text[])", [[appleSubject, legacySubject, unprovisionedSubject, ...principals.map((principal) => principal.cognitoSubject), ...extraSubjects]]);
  }
}
