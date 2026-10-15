import { transaction, type DatabaseExecutor } from "../../db.js";
import { log, logWarning } from "../logger.js";
import { revokeApplePrincipalRefreshSessions } from "./appleSessionRevocation.js";
import { revokeAppleCredential } from "./apple.js";
import type { EncryptedAppleCredential } from "./appleCredential.js";
import { SocialProofError } from "./providers.js";

/** Caller has freshly authorized the unlink; staging and disabling share its transaction. */
export async function stageAppleMethodRevocationInExecutor(
  executor: DatabaseExecutor, cognitoSubject: string, providerSubject: string,
): Promise<number> {
  const result = await executor.query<Readonly<{ queued: number }>>(
    "SELECT auth.stage_apple_method_revocation($1, $2) AS queued", [cognitoSubject, providerSubject],
  );
  if (result.rows[0] === undefined) throw new Error("Apple method revocation staging returned no result");
  return result.rows[0].queued;
}

type AppleRevocationJob = Readonly<{
  job_id: string;
  lease_id: string;
  provider_subject: string;
  client_id: string;
  ciphertext: string;
  attempts: number;
}>;

async function lifecycleTransaction<Result>(callback: (executor: DatabaseExecutor) => Promise<Result>): Promise<Result> {
  return transaction(async (executor) => {
    await executor.query("SET LOCAL lock_timeout = '1s'", []);
    await executor.query("SET LOCAL statement_timeout = '2s'", []);
    return callback(executor);
  });
}

export type AppleRevocationDrainSummary = Readonly<{
  claimed: number;
  completed: number;
  failed: number;
}>;

/** One external revocation per 30s Lambda invocation; expired leases are reclaimed on later ticks. */
export async function drainAppleRevocations(requestId: string, getRemainingTimeMs: () => number): Promise<AppleRevocationDrainSummary> {
  if (getRemainingTimeMs() < 25_000) throw new Error("Apple revocation tick has insufficient remaining execution time");
  const sessionSummary = await drainAppleSessionRevocation(requestId, getRemainingTimeMs);
  if (sessionSummary !== null) return sessionSummary;
  const job = await lifecycleTransaction(async (executor) => {
    const result = await executor.query<AppleRevocationJob>("SELECT * FROM auth.claim_apple_revocation()", []);
    return result.rows[0] ?? null;
  });
  if (job === null) {
    const summary = { claimed: 0, completed: 0, failed: 0 };
    log({ domain: "auth", action: "apple_revocation_drain", requestId, ...summary });
    return summary;
  }
  if (getRemainingTimeMs() < 21_000) throw new Error("Apple revocation claim exhausted its execution budget; lease will be reclaimed");
  const credential: EncryptedAppleCredential = {
    providerSubject: job.provider_subject, clientId: job.client_id, ciphertext: job.ciphertext,
  };
  try {
    await revokeAppleCredential(credential);
  } catch (error) {
    const code = error instanceof SocialProofError ? error.code : "APPLE_REVOCATION_FAILED";
    await lifecycleTransaction(async (executor) => {
      await executor.query("SELECT auth.retry_apple_revocation($1, $2, $3)", [job.job_id, job.lease_id, code]);
    });
    const summary = { claimed: 1, completed: 0, failed: 1 };
    logWarning({ domain: "auth", action: "apple_revocation_drain", requestId, code, ...summary });
    return summary;
  }
  // A failed commit leaves the lease/credential intact; a later tick repeats the idempotent provider revoke.
  await lifecycleTransaction(async (executor) => {
    await executor.query("SELECT auth.complete_apple_revocation($1, $2, $3)", [job.job_id, job.lease_id, job.ciphertext]);
  });
  const summary = { claimed: 1, completed: 1, failed: 0 };
  log({ domain: "auth", action: "apple_revocation_drain", requestId, ...summary });
  return summary;
}

type AppleSessionRevocationJob = Readonly<{ job_id: string; lease_id: string; cognito_subject: string }>;

async function drainAppleSessionRevocation(requestId: string, getRemainingTimeMs: () => number): Promise<AppleRevocationDrainSummary | null> {
  const job = await lifecycleTransaction(async (executor) => {
    const result = await executor.query<AppleSessionRevocationJob>("SELECT * FROM auth.claim_apple_session_revocation()", []);
    return result.rows[0] ?? null;
  });
  if (job === null) return null;
  if (getRemainingTimeMs() < 12_000) throw new Error("Apple session revocation claim exhausted its execution budget; lease will be reclaimed");
  try {
    await revokeApplePrincipalRefreshSessions(job.cognito_subject);
  } catch {
    await lifecycleTransaction(async (executor) => {
      await executor.query("SELECT auth.retry_apple_session_revocation($1, $2)", [job.job_id, job.lease_id]);
    });
    const summary = { claimed: 1, completed: 0, failed: 1 };
    logWarning({ domain: "auth", action: "apple_revocation_drain", requestId,
      reasonCategory: "refresh_sessions", code: "APPLE_SESSION_REVOCATION_FAILED", ...summary });
    return summary;
  }
  await lifecycleTransaction(async (executor) => {
    await executor.query("SELECT auth.complete_apple_session_revocation($1, $2)", [job.job_id, job.lease_id]);
  });
  const summary = { claimed: 1, completed: 1, failed: 0 };
  log({ domain: "auth", action: "apple_revocation_drain", requestId, reasonCategory: "refresh_sessions", ...summary });
  return summary;
}
