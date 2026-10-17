import { createHash } from "node:crypto";
import { z } from "zod";
import type { DatabaseExecutor, SqlValue } from "../../database";

export const historyEnvironmentSchema = z.enum(["production", "sandbox"]);
export type HistoryEnvironment = z.infer<typeof historyEnvironmentSchema>;
export type HistoryProvider = "apple" | "google" | "stripe";
export type HistoryWriteResult = "stored" | "stale";
// `observedAt` is the authoritative read time, or the original provider time for a webhook snapshot,
// never a replay time: a stale observation must lose to the newer one it would otherwise overwrite.
export type HistoryObservation = Readonly<{ environment: HistoryEnvironment; observedAt: Date }>;

export class BillingHistoryError extends Error {
  constructor(readonly code: "BILLING_HISTORY_INVALID" | "BILLING_HISTORY_IDENTITY_CONFLICT"
    | "BILLING_HISTORY_IMPORT_NOT_RUNNING", message: string) {
    super(message);
    this.name = "BillingHistoryError";
  }
}

export const nativeIdSchema = z.string().min(1).max(4096);
export const epochSchema = z.number().int().nonnegative().max(8_640_000_000_000);
export const providerTimestampSchema = z.iso.datetime({ offset: true })
  .refine((value) => Number.isFinite(Date.parse(value)));

export function parseHistoryFields<Schema extends z.ZodType>(
  schema: Schema, input: z.input<Schema>,
): z.output<Schema> {
  const result = schema.safeParse(input);
  if (!result.success) {
    // Validation diagnostics name fields only: SDK objects may contain personal data or secrets.
    throw new BillingHistoryError("BILLING_HISTORY_INVALID",
      "Billing history fields are invalid: " + result.error.issues.map((issue) => issue.path.join(".")).join(", "));
  }
  return result.data;
}

export function historyScopeHash(value: string): string {
  nativeIdSchema.parse(value);
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function requireHistoryObservation(input: HistoryObservation): void {
  if (!historyEnvironmentSchema.safeParse(input.environment).success
    || !z.date().safeParse(input.observedAt).success) {
    throw new BillingHistoryError("BILLING_HISTORY_INVALID", "History environment and observation time are required.");
  }
}

export async function ensureHistorySubjectInExecutor(
  executor: DatabaseExecutor, provider: HistoryProvider, environment: HistoryEnvironment, sourceId: string,
): Promise<string> {
  const hash = historyScopeHash(sourceId);
  // Ownership is populated exclusively by the migration's existing-billing lifecycle triggers.
  // An unattributed native record must still be countable; collector input cannot attach a person.
  await executor.query(`INSERT INTO billing.history_subjects (provider, environment, subject_hash)
    VALUES ($1, $2, $3) ON CONFLICT (provider, environment, subject_hash) DO NOTHING`,
  [provider, environment, hash]);
  const result = await executor.query<{ subject_id: string }>(`SELECT subject_id
    FROM billing.history_subjects WHERE provider = $1 AND environment = $2 AND subject_hash = $3`,
  [provider, environment, hash]);
  const subject = result.rows[0];
  if (subject === undefined) {
    throw new BillingHistoryError("BILLING_HISTORY_IDENTITY_CONFLICT", "Billing history subject was not persisted.");
  }
  return subject.subject_id;
}

type NativeTable = "apple_transactions" | "google_orders" | "google_subscription_observations"
  | "stripe_subscriptions" | "stripe_invoices" | "stripe_payments" | "stripe_refunds";
type NativeRecord = Readonly<{
  table: NativeTable;
  keyColumn: string;
  id: string;
  subjectId: string;
  observation: HistoryObservation;
  columns: ReadonlyArray<string>;
  values: ReadonlyArray<SqlValue>;
  freshnessColumn: string;
}>;

// Only source modules construct the SQL identifiers; never pass client/provider field names here.
export async function persistNativeRecordInExecutor(
  executor: DatabaseExecutor, record: NativeRecord,
): Promise<HistoryWriteResult> {
  requireHistoryObservation(record.observation);
  const columns = ["environment", record.keyColumn, "subject_id", ...record.columns, "observed_at"];
  const values: ReadonlyArray<SqlValue> = [
    record.observation.environment, record.id, record.subjectId, ...record.values, record.observation.observedAt,
  ];
  const assignments = [...record.columns, "observed_at"]
    .map((column) => column + " = EXCLUDED." + column).join(", ");
  const placeholders = values.map((_, index) => "$" + (index + 1)).join(", ");
  const result = await executor.query<{ subject_id: string }>(
    `INSERT INTO billing.${record.table} AS stored (${columns.join(", ")})
    VALUES (${placeholders}) ON CONFLICT (environment, ${record.keyColumn}) DO UPDATE SET
    ${assignments}, updated_at = now()
    WHERE stored.subject_id = EXCLUDED.subject_id
      AND stored.${record.freshnessColumn} <= EXCLUDED.${record.freshnessColumn}
    RETURNING subject_id`, values);
  if (result.rows.length > 0) return "stored";
  const existing = await executor.query<{ subject_id: string }>(
    `SELECT subject_id FROM billing.${record.table} WHERE environment = $1 AND ${record.keyColumn} = $2`,
    [record.observation.environment, record.id]);
  if (existing.rows[0]?.subject_id !== record.subjectId) {
    throw new BillingHistoryError("BILLING_HISTORY_IDENTITY_CONFLICT",
      "A native billing object already belongs to a different provider subject.");
  }
  return "stale";
}
