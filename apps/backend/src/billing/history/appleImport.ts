import { setTimeout } from "node:timers/promises";
import { z } from "zod";
import { unsafeTransaction } from "../../database/unsafe";
import { addBackendBreadcrumb, type BackendObservationScope } from "../../observability/sentry";
import { loadAppleSigningSecret } from "../apple/config";
import { AppleBillingError, appleBundleId, type AppleEnvironment } from "../apple/contracts";
import { AppleProvider } from "../apple/provider";
import { persistAppleTransactionInExecutor, type AppleTransactionHistory } from "./apple";
import {
  beginHistoryImportInExecutor, checkpointHistoryImportInExecutor, completeHistoryImportInExecutor,
  failHistoryImportInExecutor, type HistoryImportRun,
} from "./imports";
import { BillingHistoryError, historyScopeHash, parseHistoryFields } from "./store";

const notificationDiscoveryKey = appleBundleId + ":notification-discovery";
const discoveryScopeHash = historyScopeHash("provider:" + historyScopeHash(notificationDiscoveryKey));
const lookbackMs = 24 * 60 * 60 * 1000;
const maximumPagesPerEnvironment = 120;
const failedSubjectSchema = z.object({
  subject: z.string(), revision: z.string().nullable(), transactionIds: z.array(z.string()),
  historyComplete: z.boolean(),
});
const checkpointSchema = z.object({
  stage: z.enum(["notifications", "subjects"]),
  notificationFrom: z.iso.datetime(), notificationTo: z.iso.datetime(),
  notificationToken: z.string().nullable(), notificationTransactionIds: z.array(z.string()),
  afterSubject: z.string().nullable(), subject: z.string().nullable(),
  subjectRunId: z.uuid().nullable(), revision: z.string().nullable(),
  transactionIds: z.array(z.string()),
  historyComplete: z.boolean().optional(),
  failedSubjects: z.array(failedSubjectSchema).optional(),
}).transform((checkpoint) => ({ ...checkpoint, historyComplete: checkpoint.historyComplete ?? false,
  failedSubjects: checkpoint.failedSubjects ?? [] }));
type Checkpoint = z.infer<typeof checkpointSchema>;
type Attempt = Readonly<{ run: HistoryImportRun; checkpoint: Checkpoint }>;
type EnvironmentSummary = Readonly<{
  environment: AppleEnvironment; status: "running" | "partial";
  pages: number; subjectsCompleted: number; recordCount: number;
}>;
export type AppleHistoryImportSummary = Readonly<{ environments: ReadonlyArray<EnvironmentSummary> }>;

async function loadAttempt(environment: AppleEnvironment): Promise<Attempt> {
  return unsafeTransaction(async (executor) => {
    const result = await executor.query<HistoryImportRun>(
      `SELECT run_id, status, requested_from, requested_to, covered_from, covered_to,
        record_count::text, checkpoint, failure_code FROM billing.history_import_runs
        WHERE source = 'apple_transactions' AND environment = $1 AND scope_hash = $2
        ORDER BY started_at DESC, run_id DESC LIMIT 1`, [environment, discoveryScopeHash]);
    const previous = result.rows[0];
    if (previous?.status === "running" && previous.checkpoint !== null) {
      return { run: previous, checkpoint: parseHistoryFields(checkpointSchema, JSON.parse(previous.checkpoint)) };
    }
    const to = new Date();
    const retentionMs = (environment === "production" ? 179 : 29) * lookbackMs;
    const previousCheckpoint = previous?.checkpoint == null ? null
      : parseHistoryFields(checkpointSchema, JSON.parse(previous.checkpoint));
    const invalidEmptySandboxDiscovery = environment === "sandbox" && previous?.record_count === "0"
      && previousCheckpoint !== null && previousCheckpoint.stage === "notifications"
      && Date.parse(previousCheckpoint.notificationTo) - Date.parse(previousCheckpoint.notificationFrom) > 30 * lookbackMs
      && previousCheckpoint.notificationToken === null && previousCheckpoint.notificationTransactionIds.length === 0
      && previousCheckpoint.afterSubject === null && previousCheckpoint.subject === null
      && previousCheckpoint.subjectRunId === null && previousCheckpoint.revision === null
      && previousCheckpoint.transactionIds.length === 0 && !previousCheckpoint.historyComplete
      && previousCheckpoint.failedSubjects.length === 0;
    if (previous?.status === "failed" && previousCheckpoint !== null && !invalidEmptySandboxDiscovery) {
      let checkpoint = previousCheckpoint;
      if (checkpoint.subject !== null) {
        const subjectRunId = await beginHistoryImportInExecutor(executor, {
          source: "apple_transactions", environment, scope: { kind: "subject", sourceId: checkpoint.subject },
          requestedFrom: previous.requested_from, requestedTo: previous.requested_to,
        });
        checkpoint = { ...checkpoint, subjectRunId };
        await checkpointHistoryImportInExecutor(executor, {
          runId: subjectRunId, recordCount: checkpoint.transactionIds.length,
          checkpoint: JSON.stringify({ revision: checkpoint.revision, historyComplete: checkpoint.historyComplete }),
        });
      }
      const runId = await beginHistoryImportInExecutor(executor, {
        source: "apple_transactions", environment, scope: { kind: "provider", key: notificationDiscoveryKey },
        requestedFrom: previous.requested_from, requestedTo: previous.requested_to,
      });
      await checkpointHistoryImportInExecutor(executor, {
        runId, recordCount: Number(previous.record_count), checkpoint: JSON.stringify(checkpoint),
      });
      return { run: { ...previous, run_id: runId, status: "running", checkpoint: JSON.stringify(checkpoint),
        failure_code: null }, checkpoint };
    }
    const continuousFrom = previous?.status === "partial" && previousCheckpoint !== null
      ? Date.parse(previousCheckpoint.notificationTo) - lookbackMs : to.getTime() - retentionMs;
    const checkpoint: Checkpoint = {
      stage: "notifications", notificationFrom: new Date(Math.max(to.getTime() - retentionMs, continuousFrom)).toISOString(),
      notificationTo: to.toISOString(), notificationToken: null, notificationTransactionIds: [],
      afterSubject: null, subject: null, subjectRunId: null, revision: null, transactionIds: [],
      historyComplete: false, failedSubjects: [],
    };
    const runId = await beginHistoryImportInExecutor(executor, {
      source: "apple_transactions", environment, scope: { kind: "provider", key: notificationDiscoveryKey },
      requestedFrom: new Date(0), requestedTo: to,
    });
    await checkpointHistoryImportInExecutor(executor, { runId, recordCount: 0, checkpoint: JSON.stringify(checkpoint) });
    return { run: { run_id: runId, status: "running", requested_from: new Date(0), requested_to: to,
      covered_from: null, covered_to: null, record_count: "0", checkpoint: JSON.stringify(checkpoint), failure_code: null },
    checkpoint };
  });
}

async function nextSubject(environment: AppleEnvironment, after: string | null): Promise<string | null> {
  return unsafeTransaction(async (executor) => {
    const result = await executor.query<{ source_id: string }>(
      `SELECT source_id FROM (
        SELECT provider_purchase_id AS source_id FROM billing.purchases WHERE provider = 'apple' AND environment = $1
        UNION SELECT original_transaction_id FROM billing.apple_transactions WHERE environment = $1
        UNION SELECT provider_purchase_id FROM billing.provider_events
          WHERE provider = 'apple' AND environment = $1 AND provider_purchase_id IS NOT NULL
      ) AS subjects WHERE ($2::text IS NULL OR source_id COLLATE "C" > $2 COLLATE "C")
      ORDER BY source_id COLLATE "C" LIMIT 1`, [environment, after]);
    return result.rows[0]?.source_id ?? null;
  });
}

// The SDK transport has no per-call signal; a stalled read must still fail before the Lambda timeout.
async function boundedRead<Result>(read: () => Promise<Result>, signal: AbortSignal): Promise<Result> {
  signal.throwIfAborted();
  const timer = new AbortController();
  const expired = setTimeout(30_000, undefined, { signal: timer.signal, ref: false }).then(() => {
    throw new AppleBillingError("APPLE_HISTORY_TIMEOUT", true,
      "Apple history API read exceeded 30 seconds; verify deployed egress and provider access.");
  });
  const aborted = new Promise<never>((_resolve, reject) => {
    signal.addEventListener("abort", abort, { once: true });
    function abort(): void { reject(new AppleBillingError("APPLE_HISTORY_LOCK_LOST", true, "Apple history import lost its database lock.")); }
    timer.signal.addEventListener("abort", () => signal.removeEventListener("abort", abort), { once: true });
  });
  try {
    return await Promise.race([read(), expired, aborted]);
  } finally {
    timer.abort();
  }
}

async function writeTransactions(
  environment: AppleEnvironment, transactions: ReadonlyArray<AppleTransactionHistory>,
  runId: string, recordCount: number, checkpoint: Checkpoint,
): Promise<void> {
  const observedAt = new Date();
  await unsafeTransaction(async (executor) => {
    for (const transaction of [...transactions].sort((left, right) => left.transactionId.localeCompare(right.transactionId))) {
      await persistAppleTransactionInExecutor(executor, transaction, { environment, observedAt });
    }
    await checkpointHistoryImportInExecutor(executor, { runId, recordCount, checkpoint: JSON.stringify(checkpoint) });
    if (checkpoint.subjectRunId !== null) {
      await checkpointHistoryImportInExecutor(executor, {
        runId: checkpoint.subjectRunId, recordCount: checkpoint.transactionIds.length,
        checkpoint: JSON.stringify({ revision: checkpoint.revision, historyComplete: checkpoint.historyComplete }),
      });
    }
  });
}

function failureCode(error: Error): string {
  if (error instanceof AppleBillingError || error instanceof BillingHistoryError) return error.code;
  return "APPLE_HISTORY_IMPORT_FAILED";
}

function importFailure(error: unknown): AppleBillingError | BillingHistoryError {
  return error instanceof AppleBillingError || error instanceof BillingHistoryError ? error
    : new AppleBillingError("APPLE_HISTORY_IMPORT_FAILED", true,
      "Apple history import failed at its database or checkpoint boundary; inspect sanitized coverage and retry.");
}

async function importEnvironment(
  provider: AppleProvider, environment: AppleEnvironment, deadlineAtMs: number, signal: AbortSignal,
): Promise<EnvironmentSummary> {
  const attempt = await loadAttempt(environment);
  let checkpoint = attempt.checkpoint;
  let recordCount = Number(attempt.run.record_count);
  let pages = 0;
  let subjectsCompleted = 0;
  let firstFailure: AppleBillingError | BillingHistoryError | null = null;
  const failedThisInvocation = new Set<string>();
  try {
    while (pages < maximumPagesPerEnvironment && Date.now() < deadlineAtMs) {
      signal.throwIfAborted();
      if (checkpoint.stage === "notifications") {
        pages += 1;
        const page = await boundedRead(() => provider.notificationHistoryPage(
          environment, checkpoint.notificationToken, new Date(checkpoint.notificationFrom), new Date(checkpoint.notificationTo),
        ), signal);
        const notificationTransactionIds = [...new Set([...checkpoint.notificationTransactionIds,
          ...page.transactions.map((transaction) => transaction.transactionId)])];
        const nextRecordCount = notificationTransactionIds.length;
        const next: Checkpoint = { ...checkpoint, notificationToken: page.paginationToken, notificationTransactionIds,
          stage: page.hasMore ? "notifications" : "subjects" };
        await writeTransactions(environment, page.transactions, attempt.run.run_id, nextRecordCount, next);
        recordCount = nextRecordCount;
        checkpoint = next;
        continue;
      }
      if (checkpoint.subject === null) {
        const discoveredSubject = await nextSubject(environment, checkpoint.afterSubject);
        const retry = discoveredSubject === null
          ? checkpoint.failedSubjects.find((failed) => !failedThisInvocation.has(failed.subject)) : undefined;
        const subject = discoveredSubject ?? retry?.subject ?? null;
        if (subject === null) {
          if (checkpoint.failedSubjects.length > 0) {
            throw firstFailure ?? new AppleBillingError("APPLE_HISTORY_SUBJECTS_INCOMPLETE", true,
              "Apple history has failed subjects awaiting reconciliation; inspect failed subject coverage and retry.");
          }
          // This named inventory contains retained notifications, not every merchant purchase.
          await unsafeTransaction((executor) => completeHistoryImportInExecutor(executor, {
            runId: attempt.run.run_id, status: "partial",
            coveredFrom: new Date(checkpoint.notificationFrom), coveredTo: new Date(checkpoint.notificationTo),
          }));
          return { environment, status: "partial", pages, subjectsCompleted, recordCount };
        }
        checkpoint = await unsafeTransaction(async (executor) => {
          const subjectRunId = await beginHistoryImportInExecutor(executor, {
            source: "apple_transactions", environment, scope: { kind: "subject", sourceId: subject },
            requestedFrom: attempt.run.requested_from, requestedTo: attempt.run.requested_to,
          });
          const next = { ...checkpoint, subject, subjectRunId,
            revision: retry?.revision ?? null, transactionIds: retry?.transactionIds ?? [],
            historyComplete: retry?.historyComplete ?? false };
          await checkpointHistoryImportInExecutor(executor, {
            runId: subjectRunId, recordCount: next.transactionIds.length,
            checkpoint: JSON.stringify({ revision: next.revision, historyComplete: next.historyComplete }),
          });
          await checkpointHistoryImportInExecutor(executor, {
            runId: attempt.run.run_id, recordCount, checkpoint: JSON.stringify(next),
          });
          return next;
        });
      }
      const subject = checkpoint.subject;
      const subjectRunId = checkpoint.subjectRunId;
      if (subject === null || subjectRunId === null) {
        throw new AppleBillingError("APPLE_HISTORY_CHECKPOINT_INVALID", false, "Apple subject checkpoint is incomplete.");
      }
      if (pages >= maximumPagesPerEnvironment || Date.now() >= deadlineAtMs) break;
      try {
        if (!checkpoint.historyComplete) {
          pages += 1;
          const page = await boundedRead(() => provider.transactionHistoryPage(
            environment, subject, checkpoint.revision, attempt.run.requested_from, attempt.run.requested_to,
          ), signal);
          const transactionIds = [...new Set([...checkpoint.transactionIds,
            ...page.transactions.filter((transaction) => transaction.originalTransactionId === subject)
              .map((transaction) => transaction.transactionId)])];
          const next: Checkpoint = { ...checkpoint, revision: page.revision, transactionIds, historyComplete: !page.hasMore };
          await writeTransactions(environment, page.transactions, attempt.run.run_id, recordCount, next);
          checkpoint = next;
          if (page.hasMore) continue;
        }
        if (pages >= maximumPagesPerEnvironment || Date.now() >= deadlineAtMs) break;
        pages += 1;
        const current = await boundedRead(() => provider.currentHistoryTransaction(environment, subject), signal);
        checkpoint = await unsafeTransaction(async (executor) => {
          await persistAppleTransactionInExecutor(executor, current, { environment, observedAt: new Date() });
          await completeHistoryImportInExecutor(executor, {
            runId: subjectRunId, status: "succeeded",
            coveredFrom: attempt.run.requested_from, coveredTo: attempt.run.requested_to,
          });
          const next: Checkpoint = { ...checkpoint,
            afterSubject: checkpoint.failedSubjects.some((failed) => failed.subject === subject)
              ? checkpoint.afterSubject : subject,
            subject: null, subjectRunId: null, revision: null, transactionIds: [], historyComplete: false,
            failedSubjects: checkpoint.failedSubjects.filter((failed) => failed.subject !== subject) };
          await checkpointHistoryImportInExecutor(executor, {
            runId: attempt.run.run_id, recordCount, checkpoint: JSON.stringify(next),
          });
          return next;
        });
        subjectsCompleted += 1;
      } catch (error) {
        if (signal.aborted) throw error;
        const sanitized = importFailure(error);
        checkpoint = await unsafeTransaction(async (executor) => {
          await failHistoryImportInExecutor(executor, subjectRunId, failureCode(sanitized));
          const next: Checkpoint = { ...checkpoint,
            afterSubject: checkpoint.failedSubjects.some((failed) => failed.subject === subject)
              ? checkpoint.afterSubject : subject,
            subject: null, subjectRunId: null, revision: null, transactionIds: [], historyComplete: false,
            failedSubjects: [...checkpoint.failedSubjects.filter((failed) => failed.subject !== subject),
              { subject, revision: checkpoint.revision, transactionIds: checkpoint.transactionIds,
                historyComplete: checkpoint.historyComplete }] };
          await checkpointHistoryImportInExecutor(executor, {
            runId: attempt.run.run_id, recordCount, checkpoint: JSON.stringify(next),
          });
          return next;
        });
        failedThisInvocation.add(subject);
        firstFailure ??= sanitized;
      }
    }
    if (firstFailure !== null) throw firstFailure;
    return { environment, status: "running", pages, subjectsCompleted, recordCount };
  } catch (error) {
    const sanitized = importFailure(error);
    await unsafeTransaction(async (executor) => {
      if (checkpoint.subjectRunId !== null) {
        await failHistoryImportInExecutor(executor, checkpoint.subjectRunId, failureCode(sanitized));
      }
      await failHistoryImportInExecutor(executor, attempt.run.run_id, failureCode(sanitized));
    });
    throw sanitized;
  }
}

export async function importAppleHistory(
  scope: BackendObservationScope, environment: AppleEnvironment, deadlineAtMs: number, signal: AbortSignal,
): Promise<AppleHistoryImportSummary> {
  try {
    const provider = new AppleProvider(await loadAppleSigningSecret());
    const summary = { environments: [await importEnvironment(provider, environment, deadlineAtMs, signal)] };
    addBackendBreadcrumb({ action: "billing_history_apple_import_completed", scope, details: summary });
    return summary;
  } catch (error) {
    const sanitized = error instanceof AppleBillingError || error instanceof BillingHistoryError ? error
      : new AppleBillingError("APPLE_HISTORY_IMPORT_FAILED", true, "Apple history import failed before a checkpoint was available.");
    addBackendBreadcrumb({ action: "billing_history_apple_environment_failed", scope,
      details: { environment, failureCode: failureCode(sanitized) } });
    throw sanitized;
  }
}
