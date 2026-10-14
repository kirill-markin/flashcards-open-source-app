import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { DatabaseExecutor } from "../../database";
import {
  BillingHistoryError, ensureHistorySubjectInExecutor, historyEnvironmentSchema, historyScopeHash, nativeIdSchema,
  parseHistoryFields, type HistoryEnvironment, type HistoryProvider,
} from "./store";

export const historySourceSchema = z.enum([
  "apple_transactions", "google_orders", "google_subscriptions", "stripe_subscriptions",
  "stripe_invoices", "stripe_payments", "stripe_refunds",
]);
export type HistorySource = z.infer<typeof historySourceSchema>;
export type HistoryImportScope =
  | Readonly<{ kind: "provider"; key: string }>
  | Readonly<{ kind: "subject"; sourceId: string }>;
export type HistoryImportInput = Readonly<{
  source: HistorySource;
  environment: HistoryEnvironment;
  scope: HistoryImportScope;
  requestedFrom: Date;
  requestedTo: Date;
}>;
export type HistoryImportRun = Readonly<{
  run_id: string;
  status: "running" | "succeeded" | "partial" | "failed";
  requested_from: Date;
  requested_to: Date;
  covered_from: Date | null;
  covered_to: Date | null;
  record_count: string;
  checkpoint: string | null;
  failure_code: string | null;
}>;
const importInputSchema = z.object({
  source: historySourceSchema, environment: historyEnvironmentSchema,
  scope: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("provider"), key: nativeIdSchema }),
    z.object({ kind: z.literal("subject"), sourceId: nativeIdSchema }),
  ]),
  requestedFrom: z.date(), requestedTo: z.date(),
}).refine((input) => input.requestedFrom < input.requestedTo);
const pageSchema = z.object({
  runId: z.uuid(), recordCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  checkpoint: z.string().nullable(),
});
const completionSchema = z.object({
  runId: z.uuid(), status: z.enum(["succeeded", "partial"]),
  coveredFrom: z.date(), coveredTo: z.date(),
}).refine((input) => input.coveredFrom < input.coveredTo);

function sourceProvider(source: HistorySource): HistoryProvider {
  if (source.startsWith("apple_")) return "apple";
  if (source.startsWith("google_")) return "google";
  return "stripe";
}

function scopeHash(scope: HistoryImportScope): string {
  const nativeHash = historyScopeHash(scope.kind === "provider" ? scope.key : scope.sourceId);
  return historyScopeHash(scope.kind + ":" + nativeHash);
}

export async function beginHistoryImportInExecutor(
  executor: DatabaseExecutor, input: HistoryImportInput,
): Promise<string> {
  const fields = parseHistoryFields(importInputSchema, input);
  const provider = sourceProvider(fields.source);
  const subjectId = fields.scope.kind === "subject"
    ? await ensureHistorySubjectInExecutor(executor, provider, fields.environment, fields.scope.sourceId) : null;
  const runId = randomUUID();
  await executor.query(`INSERT INTO billing.history_import_runs
    (run_id, provider, environment, source, scope_hash, scope_kind, subject_id,
      requested_from, requested_to, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'running')`,
  [runId, provider, fields.environment, fields.source, scopeHash(fields.scope), fields.scope.kind,
    subjectId, fields.requestedFrom, fields.requestedTo]);
  return runId;
}

export async function loadLatestHistoryImportInExecutor(
  executor: DatabaseExecutor, input: HistoryImportInput,
): Promise<HistoryImportRun | null> {
  const fields = parseHistoryFields(importInputSchema, input);
  const result = await executor.query<HistoryImportRun>(`SELECT run_id, status, requested_from, requested_to,
    covered_from, covered_to, record_count::text, checkpoint, failure_code FROM billing.history_import_runs
    WHERE provider = $1 AND environment = $2 AND source = $3 AND scope_hash = $4
      AND requested_from = $5 AND requested_to = $6
    ORDER BY started_at DESC, run_id DESC LIMIT 1`,
  [sourceProvider(fields.source), fields.environment, fields.source, scopeHash(fields.scope),
    fields.requestedFrom, fields.requestedTo]);
  return result.rows[0] ?? null;
}

function requireRunningImport(rowCount: number | null): void {
  if (rowCount !== 1) {
    throw new BillingHistoryError("BILLING_HISTORY_IMPORT_NOT_RUNNING",
      "Billing history import is missing or already finished; begin a new attempt.");
  }
}

// Commit each page's native writes and its absolute count/checkpoint in the SAME transaction.
export async function checkpointHistoryImportInExecutor(
  executor: DatabaseExecutor, input: Readonly<{ runId: string; recordCount: number; checkpoint: string | null }>,
): Promise<void> {
  const fields = parseHistoryFields(pageSchema, input);
  const result = await executor.query(`UPDATE billing.history_import_runs
    SET record_count = $2, checkpoint = $3 WHERE run_id = $1 AND status = 'running'
      AND record_count <= $2`, [fields.runId, fields.recordCount, fields.checkpoint]);
  requireRunningImport(result.rowCount);
}

export async function completeHistoryImportInExecutor(
  executor: DatabaseExecutor,
  input: Readonly<{ runId: string; status: "succeeded" | "partial"; coveredFrom: Date; coveredTo: Date }>,
): Promise<void> {
  const fields = parseHistoryFields(completionSchema, input);
  const result = await executor.query(`UPDATE billing.history_import_runs
    SET status = $2, covered_from = $3, covered_to = $4, finished_at = now(),
      checkpoint = CASE WHEN $2 = 'succeeded' THEN NULL ELSE checkpoint END
    WHERE run_id = $1 AND status = 'running'`,
  [fields.runId, fields.status, fields.coveredFrom, fields.coveredTo]);
  requireRunningImport(result.rowCount);
}

export async function failHistoryImportInExecutor(
  executor: DatabaseExecutor, runId: string, failureCode: string,
): Promise<void> {
  const fields = parseHistoryFields(z.object({
    runId: z.uuid(), failureCode: z.string().regex(/^[A-Z0-9_]{1,100}$/),
  }), { runId, failureCode });
  const result = await executor.query(`UPDATE billing.history_import_runs
    SET status = 'failed', failure_code = $2, finished_at = now()
    WHERE run_id = $1 AND status = 'running'`, [fields.runId, fields.failureCode]);
  requireRunningImport(result.rowCount);
}
