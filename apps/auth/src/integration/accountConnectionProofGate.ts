import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type pg from "pg";
import { authHandleHash } from "../server/social/attemptStore.js";
import { completeAuthoritativeLoginInExecutor } from "../server/social/completionStore.js";

type ConnectionSession = readonly (string | number | null)[];
type Receipt = Readonly<{ operation_sha256: string; source_account: string; target_account: string | null;
  state: string; email_claim: string; target_auth_time: string | null; expires_at: Date }>;

// Real PostgreSQL storage boundary only: supplied completion facts do not assert Cognito/provider verification.
export async function checkAccountConnectionProofs(runtime: pg.Client, owner: pg.Client, contender: pg.Client): Promise<void> {
  const source = randomUUID();
  const target = randomUUID();
  const third = randomUUID();
  const proofPrincipal = randomUUID();
  const accounts = [randomUUID(), randomUUID(), randomUUID()];
  const subjects = [source, target, third, proofPrincipal];
  const emails = subjects.map((subject) => subject + "@mail.test");
  const binding = authHandleHash(randomBytes(32).toString("base64url"));
  const operation = authHandleHash(randomBytes(32).toString("base64url"));
  const session = [operation, source, source, 1, binding, "ios", null];
  const attemptHashes: string[] = [];
  const providerSubject = "connection-google-" + randomUUID();
  const sourceApple = "connection-apple-" + randomUUID();
  const sourceGoogle = "connection-source-google-" + randomUUID();
  const providerSubjects = [providerSubject, sourceApple, sourceGoogle];
  const begin = async (receiptHash: string, completion: string) => owner.query<Receipt>(
    "SELECT * FROM auth.begin_account_connection($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    [receiptHash, source, source, 1, binding, "ios", null, completion, "canonical-account-v1"]);
  const makeSourceProof = async (): Promise<string> => {
    const attempt = authHandleHash(randomBytes(32).toString("base64url"));
    const completion = authHandleHash(randomBytes(32).toString("base64url"));
    attemptHashes.push(attempt);
    const created = await runtime.query<{ claim_id: string }>(
      "SELECT * FROM auth.create_email_auth_attempt($1,'ios',$2,NULL,$3,$3,$4,1,'encrypted-fixture',$3,$3)",
      [attempt, binding, source, emails[0]]);
    await runtime.query("SELECT auth.ready_email_auth_attempt($1,$2,'encrypted-fixture')", [attempt, created.rows[0].claim_id]);
    const claimed = await runtime.query<{ claim_id: string }>(
      "SELECT * FROM auth.claim_email_auth_attempt($1,$2,'ios',NULL,$3,$3,1)", [attempt, binding, source]);
    await runtime.query(
      "SELECT auth.complete_email_auth_attempt($1,$2,$3,$3,$4,floor(extract(epoch FROM clock_timestamp()))::bigint,$5)",
      [attempt, claimed.rows[0].claim_id, source, emails[0], completion]);
    return completion;
  };
  const makeProviderSourceProof = async (): Promise<string> => {
    const attempt = authHandleHash(randomBytes(32).toString("base64url"));
    const completion = authHandleHash(randomBytes(32).toString("base64url"));
    attemptHashes.push(attempt);
    await runtime.query("SELECT auth.create_social_attempt($1,'apple','ios','reauth',$2,NULL,NULL,$3,$4,'fixture',NULL,NULL,NULL,NULL)",
      [attempt, binding, source, accounts[0]]);
    const claim = (await runtime.query<{ claim_id: string }>(
      "SELECT * FROM auth.claim_social_attempt($1,$2,'reauth','ios',NULL,'provider_ready')", [attempt, binding])).rows[0].claim_id;
    await runtime.query("SELECT auth.advance_social_attempt($1,$2,'provider_claimed','provider_verifying','fixture',NULL)", [attempt, claim]);
    await runtime.query("SELECT auth.advance_social_attempt($1,$2,'provider_verifying','provider_proved','fixture',$3)", [attempt, claim, sourceApple]);
    await runtime.query("SELECT auth.advance_social_attempt($1,$2,'provider_proved','provider_enrolling','fixture',$3)", [attempt, claim, sourceApple]);
    await runtime.query("SELECT auth.complete_social_attempt($1,$2,$3,$3,$4)", [attempt, claim, proofPrincipal, completion]);
    return completion;
  };
  const makeProviderTargetProof = async (receiptSession: ConnectionSession): Promise<Readonly<{ attempt: string; claim: string }>> => {
    const attempt = authHandleHash(randomBytes(32).toString("base64url"));
    attemptHashes.push(attempt);
    await owner.query("SELECT auth.create_connection_provider_attempt($1,$2,$3,$4,$5,$6,$7,$8,'google',$5,NULL,'fixture')",
      [...receiptSession, attempt]);
    const claim = (await owner.query<{ claim_id: string }>(
      "SELECT * FROM auth.claim_connection_provider_attempt($1,$2,$3,$4,$5,$6,$7,$8)", [...receiptSession, attempt])).rows[0].claim_id;
    await runtime.query("SELECT auth.advance_social_attempt($1,$2,'provider_claimed','provider_verifying','fixture',NULL)", [attempt, claim]);
    await runtime.query("SELECT auth.advance_social_attempt($1,$2,'provider_verifying','provider_proved','fixture',$3)", [attempt, claim, providerSubject]);
    return { attempt, claim };
  };
  const recordProvider = async (receiptSession: ConnectionSession, proof: Readonly<{ attempt: string; claim: string }>): Promise<void> => {
    await owner.query("SELECT * FROM auth.record_connection_provider_proof($1,$2,$3,$4,$5,$6,$7,$8,$9,NULL,NULL,NULL)",
      [...receiptSession, proof.attempt, proof.claim]);
  };
  const raceCancellation = async (receiptSession: ConnectionSession, finish: () => Promise<void>): Promise<void> => {
    const ownerPid = (await owner.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    const contenderPid = (await contender.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    await owner.query("BEGIN");
    let cancellation: Promise<PromiseSettledResult<pg.QueryResult>[]> | undefined;
    try {
      // Pause the real recording/claim transaction at its attempt locks before cancellation starts.
      await owner.query(`SELECT 1 FROM auth.social_attempts WHERE attempt_sha256 IN (
        SELECT source_attempt_sha256 FROM auth.account_connection_proofs WHERE operation_sha256=$1 UNION ALL
        SELECT target_attempt_sha256 FROM auth.account_connection_proofs WHERE operation_sha256=$1)
        ORDER BY attempt_sha256 FOR UPDATE`, [receiptSession[0]]);
      cancellation = Promise.allSettled([contender.query("SELECT auth.cancel_account_connection($1,$2,$3,$4,$5,$6,$7)", [...receiptSession])]);
      let blocked = false;
      for (let poll = 0; poll < 100; poll += 1) {
        blocked = (await runtime.query<{ blocked: boolean }>("SELECT $1::int=ANY(pg_blocking_pids($2::int)) AS blocked",
          [ownerPid, contenderPid])).rows[0].blocked;
        if (blocked) break;
        await delay(10);
      }
      assert.equal(blocked, true);
      await finish();
      await owner.query("COMMIT");
    } finally {
      await owner.query("ROLLBACK");
      if (cancellation !== undefined) {
        const [finished] = await cancellation;
        if (finished.status === "rejected") throw finished.reason;
      }
    }
    const cancelled = (await owner.query<{ state: string; secret_ciphertext: string }>(`SELECT receipt.state,attempt.secret_ciphertext
      FROM auth.account_connection_proofs receipt JOIN auth.social_attempts attempt ON attempt.attempt_sha256=receipt.target_attempt_sha256
      WHERE receipt.operation_sha256=$1`, [receiptSession[0]])).rows[0];
    assert.equal(cancelled.state, "cancelled");
    assert.equal(cancelled.secret_ciphertext, "erased");
  };
  const reject = async (statement: string, parameters: readonly (string | number | null)[]): Promise<void> => {
    await assert.rejects(owner.query(statement, [...parameters]), { code: "23514" });
  };
  try {
    for (const [index, subject] of subjects.slice(0, 3).entries()) {
      await owner.query("INSERT INTO org.user_settings(user_id,email) VALUES($1,$2)", [accounts[index], emails[index]]);
      await owner.query("SELECT auth.bind_cognito_account($1,$2)", [subject, accounts[index]]);
      await runtime.query("SELECT auth.enroll_proved_email_principal($1,$1,$2,clock_timestamp())", [subject, emails[index]]);
    }
    const expiredCompletion = await makeSourceProof();
    await owner.query("UPDATE auth.social_attempts SET verified_at=clock_timestamp()-interval '121 seconds' WHERE completion_sha256=$1", [expiredCompletion]);
    await assert.rejects(begin(authHandleHash(randomBytes(32).toString("base64url")), expiredCompletion), { code: "23514" });
    const providerOperation = authHandleHash(randomBytes(32).toString("base64url"));
    const providerHandle = randomBytes(32).toString("base64url");
    const providerAttempt = authHandleHash(providerHandle);
    const providerSession = [providerOperation, source, source, 1, binding, "ios", null];
    attemptHashes.push(providerAttempt);
    await runtime.query("SELECT auth.bind_provider_identity('google',$1,$2)", [providerSubject, target]);
    await runtime.query("SELECT auth.activate_proved_provider_method('google',$1,$2,$3)", [providerSubject, target, emails[1]]);
    await begin(providerOperation, await makeSourceProof());
    await owner.query("SELECT auth.create_connection_provider_attempt($1,$2,$3,$4,$5,$6,$7,$8,'google',$5,NULL,'fixture')",
      [...providerSession, providerAttempt]);
    await assert.rejects(runtime.query("SELECT * FROM auth.claim_social_attempt($1,$2,'login','ios',NULL,'provider_ready')",
      [providerAttempt, binding]), { code: "23514" });
    const providerClaim = (await owner.query<{ claim_id: string }>(
      "SELECT * FROM auth.claim_connection_provider_attempt($1,$2,$3,$4,$5,$6,$7,$8)", [...providerSession, providerAttempt])).rows[0].claim_id;
    await reject("SELECT * FROM auth.claim_connection_provider_attempt($1,$2,$3,$4,$5,$6,$7,$8)", [...providerSession, providerAttempt]);
    // Enter the verified-provider storage boundary without claiming external verifier acceptance.
    await runtime.query("SELECT auth.advance_social_attempt($1,$2,'provider_claimed','provider_verifying','fixture',NULL)", [providerAttempt, providerClaim]);
    await runtime.query("SELECT auth.advance_social_attempt($1,$2,'provider_verifying','provider_proved','fixture',$3)", [providerAttempt, providerClaim, providerSubject]);
    await assert.rejects(runtime.query("SELECT auth.advance_social_attempt($1,$2,'provider_proved','provider_enrolling','fixture',$3)",
      [providerAttempt, providerClaim, providerSubject]), { code: "23514" });
    await assert.rejects(completeAuthoritativeLoginInExecutor({
      query: (text, parameters) => runtime.query(text, [...parameters]),
    }, { handle: providerHandle, claimId: providerClaim, provider: "google" }, {
      provider: "google", identity: { provider: "google", subject: providerSubject,
        clientId: "postgres-module-fixture", email: null },
    }, null), { code: "23514" });
    await reject("SELECT * FROM auth.record_connection_provider_proof($1,$2,$3,$4,$5,$6,$7,$8,$9,NULL,NULL,NULL)",
      [...providerSession, providerAttempt, randomUUID()]);
    await reject("SELECT * FROM auth.record_connection_provider_proof($1,$2,$3,$4,$5,$6,$7,$8,$9,NULL,NULL,NULL)",
      [...providerSession, authHandleHash("swapped-attempt"), providerClaim]);
    const providerProof = (await owner.query<Receipt>(
      "SELECT * FROM auth.record_connection_provider_proof($1,$2,$3,$4,$5,$6,$7,$8,$9,NULL,NULL,NULL)",
      [...providerSession, providerAttempt, providerClaim])).rows[0];
    assert.equal(providerProof.target_account, accounts[1]);
    assert.equal(providerProof.state, "proved");
    await owner.query("BEGIN");
    await owner.query("SELECT * FROM auth.claim_account_connection_proofs($1,$2,$3,$4,$5,$6,$7)", providerSession);
    await owner.query("ROLLBACK");
    await owner.query("SELECT * FROM auth.claim_account_connection_proofs($1,$2,$3,$4,$5,$6,$7)", providerSession);
    await owner.query("SELECT auth.cancel_account_connection($1,$2,$3,$4,$5,$6,$7)", providerSession);
    const completion = await makeSourceProof();
    // Reservation and its exclusive proof ownership roll back together.
    await owner.query("BEGIN");
    await begin(operation, completion);
    await owner.query("ROLLBACK");
    const receipt = (await begin(operation, completion)).rows[0];
    assert.equal(receipt.source_account, accounts[0]);
    assert.equal(receipt.target_account, null);
    assert.equal(receipt.state, "collecting");
    await assert.rejects(begin(authHandleHash(randomBytes(32).toString("base64url")), completion), { code: "23514" });
    await assert.rejects(runtime.query("SELECT * FROM auth.redeem_social_completion($1,$2,'reauth','ios',NULL)",
      [completion, binding]), { code: "23514" });
    await assert.rejects(runtime.query("SELECT auth.create_social_attempt($1,'google','ios','link',$2,NULL,NULL,$3,$4,'fixture',$5,$2,'ios',NULL)",
      [authHandleHash(randomBytes(32).toString("base64url")), binding, source, accounts[0], completion]), { code: "23514" });
    await assert.rejects(runtime.query("SELECT * FROM auth.claim_account_connection_proofs($1,$2,$3,$4,$5,$6,$7)", session), { code: "42501" });
    for (const changed of [
      [operation, third, source, 1, binding, "ios", null],
      [operation, source, "changed", 1, binding, "ios", null],
      [operation, source, source, 2, binding, "ios", null],
      [operation, source, source, 1, authHandleHash("wrong"), "ios", null],
      [operation, source, source, 1, binding, "android", null],
    ]) await reject("SELECT * FROM auth.load_account_connection($1,$2,$3,$4,$5,$6,$7)", changed);
    await reject("SELECT * FROM auth.begin_connection_email_proof($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [...session, source, source, emails[0]]);
    await reject("SELECT * FROM auth.begin_connection_email_proof($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [...session, target, "swapped-username", emails[1]]);
    const email = (await owner.query<Receipt>("SELECT * FROM auth.begin_connection_email_proof($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [...session, target, target, emails[1]])).rows[0];
    assert.equal(email.target_account, accounts[1]);
    await owner.query("SELECT auth.ready_connection_email_proof($1,$2,'encrypted-fixture')", [operation, email.email_claim]);
    const claimed = (await owner.query<Receipt>("SELECT * FROM auth.claim_connection_email_proof($1,$2,$3,$4,$5,$6,$7)", session)).rows[0];
    await reject("SELECT * FROM auth.claim_connection_email_proof($1,$2,$3,$4,$5,$6,$7)", session);
    const proofTime = (await owner.query<{ now: string }>("SELECT floor(extract(epoch FROM clock_timestamp()))::bigint AS now")).rows[0].now;
    await reject("SELECT * FROM auth.record_connection_email_proof($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
      [...session, claimed.email_claim, third, third, emails[1], proofTime]);
    await reject("SELECT * FROM auth.record_connection_email_proof($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
      [...session, claimed.email_claim, target, "swapped-username", emails[1], proofTime]);
    await reject("SELECT * FROM auth.record_connection_email_proof($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
      [...session, claimed.email_claim, target, target, emails[2], proofTime]);
    await reject("SELECT * FROM auth.record_connection_email_proof($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
      [...session, claimed.email_claim, target, target, emails[1], 0]);
    const proved = (await owner.query<Receipt>(
      "SELECT * FROM auth.record_connection_email_proof($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
      [...session, claimed.email_claim, target, target, emails[1], proofTime])).rows[0];
    assert.equal(proved.state, "proved");
    assert.equal(proved.target_auth_time, proofTime);
    assert.equal(proved.expires_at.getTime(), receipt.expires_at.getTime());
    await reject("SELECT * FROM auth.record_connection_email_proof($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
      [...session, claimed.email_claim, target, target, emails[1], proofTime]);
    await owner.query("UPDATE auth.verified_login_emails SET verified_at=verified_at+interval '1 second' WHERE cognito_subject=$1", [target]);
    await reject("SELECT * FROM auth.load_account_connection($1,$2,$3,$4,$5,$6,$7)", session);
    await owner.query("SELECT auth.cancel_account_connection($1,$2,$3,$4,$5,$6,$7)", session);
    await reject("SELECT * FROM auth.load_account_connection($1,$2,$3,$4,$5,$6,$7)", session);
    const recordingSession = [authHandleHash(randomBytes(32).toString("base64url")), ...session.slice(1)];
    await begin(recordingSession[0] as string, await makeSourceProof());
    const recordingProof = await makeProviderTargetProof(recordingSession);
    await raceCancellation(recordingSession, () => recordProvider(recordingSession, recordingProof));
    const claimingSession = [authHandleHash(randomBytes(32).toString("base64url")), ...session.slice(1)];
    await begin(claimingSession[0] as string, await makeSourceProof());
    await recordProvider(claimingSession, await makeProviderTargetProof(claimingSession));
    await raceCancellation(claimingSession, async () => {
      await owner.query("SELECT * FROM auth.claim_account_connection_proofs($1,$2,$3,$4,$5,$6,$7)", claimingSession);
    });

    await owner.query("SELECT auth.bind_cognito_account($1,$2)", [proofPrincipal, accounts[0]]);
    await runtime.query("SELECT auth.enroll_proved_email_principal($1,$1,$2,clock_timestamp())", [proofPrincipal, emails[3]]);
    for (const [provider, providerId] of [["apple", sourceApple], ["google", sourceGoogle]]) {
      await runtime.query("SELECT auth.bind_provider_identity($1,$2,$3)", [provider, providerId, proofPrincipal]);
      await runtime.query("SELECT auth.activate_proved_provider_method($1,$2,$3,$4)", [provider, providerId, proofPrincipal, emails[3]]);
    }
    const revokedCompletion = await makeProviderSourceProof();
    const revokedSession = [authHandleHash(randomBytes(32).toString("base64url")), ...session.slice(1)];
    await begin(revokedSession[0] as string, await makeProviderSourceProof());
    await recordProvider(revokedSession, await makeProviderTargetProof(revokedSession));
    const googleGeneration = (await owner.query<{ generation: string }>(
      "SELECT activated_at::text AS generation FROM auth.provider_login_methods WHERE provider_type='google' AND provider_subject=$1",
      [sourceGoogle])).rows[0].generation;
    await runtime.query("SELECT auth.unlink_account_provider_method($1,$1,1,'google',$2,$3,$4,$5,'ios',NULL)",
      [source, sourceGoogle, googleGeneration, await makeSourceProof(), binding]);
    const sourceProofTime = (await owner.query<{ proof_time: string }>(
      "SELECT floor(extract(epoch FROM verified_at))::bigint AS proof_time FROM auth.social_attempts WHERE completion_sha256=$1",
      [revokedCompletion])).rows[0].proof_time;
    for (const expectedStatus of ["pending", "revoked"]) {
      assert.equal((await runtime.query<{ status: string }>("SELECT auth.principal_session_status($1,1) AS status", [source])).rows[0].status, "valid");
      assert.equal((await runtime.query<{ status: string }>("SELECT auth.principal_session_status($1,$2) AS status",
        [proofPrincipal, sourceProofTime])).rows[0].status, expectedStatus);
      assert.equal((await owner.query<{ status: string }>("SELECT status FROM auth.provider_login_methods WHERE provider_type='apple' AND provider_subject=$1",
        [sourceApple])).rows[0].status, "active");
      await assert.rejects(begin(authHandleHash(randomBytes(32).toString("base64url")), revokedCompletion), { code: "23514" });
      await reject("SELECT * FROM auth.load_account_connection($1,$2,$3,$4,$5,$6,$7)", revokedSession);
      await reject("SELECT * FROM auth.claim_account_connection_proofs($1,$2,$3,$4,$5,$6,$7)", revokedSession);
      if (expectedStatus === "pending") {
        const lease = randomUUID();
        const job = (await owner.query<{ job_id: string }>(`UPDATE auth.apple_session_revocation_jobs
          SET lease_id=$2,lease_until=clock_timestamp()+interval '90 seconds'
          WHERE subject_sha256=$1 AND completed_at IS NULL RETURNING job_id`, [authHandleHash(proofPrincipal), lease])).rows[0];
        await runtime.query("SELECT auth.complete_apple_session_revocation($1,$2)", [job.job_id, lease]);
      }
    }
    await owner.query("SELECT auth.cancel_account_connection($1,$2,$3,$4,$5,$6,$7)", revokedSession);
    assert.equal((await owner.query("SELECT 1 FROM auth.account_retirements WHERE retired_user_id=ANY($1::text[])", [accounts])).rowCount, 0);
    assert.equal((await owner.query("SELECT 1 FROM org.workspace_memberships WHERE user_id=ANY($1::text[])", [accounts])).rowCount, 0);
  } finally {
    await owner.query("DELETE FROM auth.account_connection_proofs WHERE source_subject=$1", [source]);
    await owner.query("DELETE FROM auth.social_attempts WHERE attempt_sha256=ANY($1::text[])", [attemptHashes]);
    await owner.query("DELETE FROM auth.verified_login_emails WHERE cognito_subject=ANY($1::text[])", [subjects]);
    await owner.query("DELETE FROM auth.user_identities WHERE provider_type='cognito' AND provider_subject=ANY($1::text[])", [subjects]);
    await owner.query("DELETE FROM auth.provider_login_methods WHERE provider_subject=ANY($1::text[])", [providerSubjects]);
    await owner.query("DELETE FROM auth.provider_identities WHERE provider_subject=ANY($1::text[])", [providerSubjects]);
    await owner.query("DELETE FROM auth.apple_session_revocation_jobs WHERE subject_sha256=ANY($1::text[])", [subjects.map(authHandleHash)]);
    await owner.query("DELETE FROM auth.principal_session_fences WHERE subject_sha256=ANY($1::text[])", [subjects.map(authHandleHash)]);
    await owner.query("DELETE FROM auth.cognito_principals WHERE cognito_subject=ANY($1::text[])", [subjects]);
    await owner.query("DELETE FROM org.user_settings WHERE user_id=ANY($1::text[])", [accounts]);
  }
}
