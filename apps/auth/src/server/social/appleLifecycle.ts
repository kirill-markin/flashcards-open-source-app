import { transaction, type DatabaseExecutor } from "../../db.js";
import { log, logWarning } from "../logger.js";
import { revokePrincipalRefreshSessions } from "./principalSessionRevocation.js";
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

// Provider work includes an 8s secret load, two 5s HTTP attempts, and a 2s completion.
// Recheck after each claim; an unexpectedly slow database leaves its durable lease recoverable.
const providerExecutionBudgetMs = 21_000;
const sessionExecutionBudgetMs = 12_000;
const claimBudgetMs = 4_000;
const maximumDrainRounds = 2;

export async function drainAppleRevocations(requestId: string, getRemainingTimeMs: () => number): Promise<AppleRevocationDrainSummary> {
  if (getRemainingTimeMs() < providerExecutionBudgetMs + claimBudgetMs) {
    throw new Error("Apple revocation drain has insufficient remaining execution time");
  }
  let summary: AppleRevocationDrainSummary = { claimed: 0, completed: 0, failed: 0 };
  for (let round = 0; round < maximumDrainRounds; round += 1) {
    if (getRemainingTimeMs() < sessionExecutionBudgetMs + claimBudgetMs) break;
    const sessions = await drainPrincipalSessionRevocation(requestId, getRemainingTimeMs);
    if (sessions !== null) summary = addDrainSummary(summary, sessions);
    // Alternate queues before claiming another session so provider work is not held behind a batch.
    if (getRemainingTimeMs() < providerExecutionBudgetMs + claimBudgetMs) break;
    const provider = await drainAppleCredentialRevocation(requestId, getRemainingTimeMs);
    if (provider !== null) summary = addDrainSummary(summary, provider);
    if (sessions === null && provider === null) break;
  }
  log({ domain: "auth", action: "apple_revocation_drain", requestId, ...summary });
  return summary;
}

function addDrainSummary(left: AppleRevocationDrainSummary, right: AppleRevocationDrainSummary): AppleRevocationDrainSummary {
  return { claimed: left.claimed + right.claimed, completed: left.completed + right.completed, failed: left.failed + right.failed };
}

async function drainAppleCredentialRevocation(
  requestId: string, getRemainingTimeMs: () => number,
): Promise<AppleRevocationDrainSummary | null> {
  const job = await lifecycleTransaction(async (executor) => {
    const result = await executor.query<AppleRevocationJob>("SELECT * FROM auth.claim_apple_revocation()", []);
    return result.rows[0] ?? null;
  });
  if (job === null) return null;
  if (getRemainingTimeMs() < providerExecutionBudgetMs) throw new Error("Apple revocation claim exhausted its execution budget; lease will be reclaimed");
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
    logWarning({ domain: "auth", action: "apple_revocation_drain", requestId, code });
    return summary;
  }
  // A failed commit leaves the lease/credential intact; a later tick repeats the idempotent provider revoke.
  await lifecycleTransaction(async (executor) => {
    await executor.query("SELECT auth.complete_apple_revocation($1, $2, $3)", [job.job_id, job.lease_id, job.ciphertext]);
  });
  const summary = { claimed: 1, completed: 1, failed: 0 };
  return summary;
}

type PrincipalSessionRevocationJob = Readonly<{ job_id: string; lease_id: string; cognito_subject: string }>;

async function drainPrincipalSessionRevocation(requestId: string, getRemainingTimeMs: () => number): Promise<AppleRevocationDrainSummary | null> {
  const job = await lifecycleTransaction(async (executor) => {
    const result = await executor.query<PrincipalSessionRevocationJob>("SELECT * FROM auth.claim_apple_session_revocation()", []);
    return result.rows[0] ?? null;
  });
  if (job === null) return null;
  if (getRemainingTimeMs() < sessionExecutionBudgetMs) throw new Error("Principal signout claim exhausted its execution budget; lease will be reclaimed");
  try {
    await revokePrincipalRefreshSessions(job.cognito_subject);
  } catch {
    await lifecycleTransaction(async (executor) => {
      await executor.query("SELECT auth.retry_apple_session_revocation($1, $2)", [job.job_id, job.lease_id]);
    });
    const summary = { claimed: 1, completed: 0, failed: 1 };
    logWarning({ domain: "auth", action: "apple_revocation_drain", requestId,
      reasonCategory: "principal_sessions", code: "PRINCIPAL_SIGNOUT_FAILED" });
    return summary;
  }
  await lifecycleTransaction(async (executor) => {
    await executor.query("SELECT auth.complete_apple_session_revocation($1, $2)", [job.job_id, job.lease_id]);
  });
  const summary = { claimed: 1, completed: 1, failed: 0 };
  return summary;
}
