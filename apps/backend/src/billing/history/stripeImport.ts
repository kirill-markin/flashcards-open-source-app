import { z } from "zod";
import type { DatabaseExecutor } from "../../database";
import { withSessionAdvisoryLock } from "../../database";
import { unsafeTransaction } from "../../database/unsafe";
import { captureBackendException, type BackendObservationScope } from "../../observability/sentry";
import { markCapturedBackendException } from "../../observability/reportedErrors";
import { stripeCatalog } from "../stripe/catalog";
import { StripeBillingError, type StripeEnvironment } from "../stripe/contracts";
import { loadStripeProvider } from "../stripe/provider";
import {
  beginHistoryImportInExecutor, checkpointHistoryImportInExecutor, completeHistoryImportInExecutor,
  failHistoryImportInExecutor, loadLatestHistoryImportInExecutor, type HistoryImportInput,
  type HistoryImportRun,
} from "./imports";
import { BillingHistoryError, historyScopeHash, type HistoryObservation } from "./store";
import {
  persistStripeInvoiceInExecutor, persistStripePaymentInExecutor,
  persistStripeRefundInExecutor, persistStripeSubscriptionInExecutor,
} from "./stripe";
import {
  StripeHistoryBudgetExhausted, type StripeHistoryPage, type StripeHistoryProvider, type StripeHistoryRefund,
} from "./stripeProvider";

const stripeHistorySources = ["stripe_subscriptions", "stripe_invoices", "stripe_payments", "stripe_refunds"] as const;
type StripeHistorySource = typeof stripeHistorySources[number];
type StripeSourceSummary = Readonly<{
  source: StripeHistorySource;
  runId: string;
  status: "succeeded" | "running" | "failed";
  recordCount: number;
}>;
export type StripeHistoryEnvironmentSummary = Readonly<{
  environment: StripeEnvironment;
  scope: "catalog_global_lists_without_test_clocks";
  requestedTo: string;
  sources: ReadonlyArray<StripeSourceSummary>;
}>;
export type StripeHistoryImportSummary = Readonly<{
  environments: ReadonlyArray<StripeHistoryEnvironmentSummary>;
  remaining: boolean;
}>;
type Inventory<Item> = Readonly<{
  source: StripeHistorySource;
  page: (cursor: string | null, requestedTo: Date) => Promise<StripeHistoryPage<Item>>;
  persist: (executor: DatabaseExecutor, item: Item, observation: HistoryObservation) => Promise<void>;
}>;
type SourceAttempt = Readonly<{ input: HistoryImportInput; run: HistoryImportRun }>;
type SourceResult = Readonly<{ summary: StripeSourceSummary; error: Error | null }>;
export type StripeHistoryImportStage = "checkpoint_read" | "page_read" | "page_transaction"
  | "native_persistence" | "checkpoint_write" | "completion" | "page_commit";
const checkpointSchema = z.object({ version: z.literal(1), cursor: z.string().min(1).nullable() });

function inventoryKey(environment: StripeEnvironment): string {
  const catalog = stripeCatalog[environment];
  const priceIds = catalog.knownPrices.map((price) => price.priceId).sort().join(",");
  return `nibomo:${catalog.accountId}:${catalog.productId}:${priceIds}:global_lists_without_test_clocks`;
}

function importFailure(error: Error): string {
  return error instanceof StripeBillingError || error instanceof BillingHistoryError
    ? error.code : "STRIPE_HISTORY_IMPORT_FAILED";
}

async function beginAttempts(environment: StripeEnvironment): Promise<ReadonlyMap<StripeHistorySource, SourceAttempt>> {
  const key = inventoryKey(environment);
  return unsafeTransaction(async (executor) => {
    const running = await executor.query<{ requested_to: Date }>(`SELECT requested_to
      FROM billing.history_import_runs WHERE provider = 'stripe' AND environment = $1
        AND scope_hash = $2 AND status = 'running'
      ORDER BY started_at, run_id LIMIT 1`, [environment, historyScopeHash("provider:" + historyScopeHash(key))]);
    // Resume the entire inventory cohort with its original upper bound, across hourly invocations.
    const requestedTo = running.rows[0]?.requested_to ?? new Date(Math.floor(Date.now() / 1000) * 1000);
    const attempts = new Map<StripeHistorySource, SourceAttempt>();
    for (const source of stripeHistorySources) {
      const input: HistoryImportInput = { source, environment, scope: { kind: "provider", key },
        requestedFrom: new Date(0), requestedTo };
      const previous = await loadLatestHistoryImportInExecutor(executor, input);
      if (previous !== null && (previous.status === "running" || previous.status === "succeeded")) {
        attempts.set(source, { input, run: previous });
      } else {
        const runId = await beginHistoryImportInExecutor(executor, input);
        attempts.set(source, { input, run: { run_id: runId, status: "running", requested_from: input.requestedFrom,
          requested_to: requestedTo, covered_from: null, covered_to: null, record_count: "0",
          checkpoint: null, failure_code: null } });
      }
    }
    return attempts;
  });
}

function requireAttempt(attempts: ReadonlyMap<StripeHistorySource, SourceAttempt>, source: StripeHistorySource): SourceAttempt {
  const attempt = attempts.get(source);
  if (attempt === undefined) throw new BillingHistoryError("BILLING_HISTORY_IMPORT_NOT_RUNNING",
    "Stripe history source attempt was not initialized.");
  return attempt;
}

function pendingSummary(source: StripeHistorySource, attempt: SourceAttempt): StripeSourceSummary {
  const recordCount = Number(attempt.run.record_count);
  if (!Number.isSafeInteger(recordCount) || recordCount < 0) throw new BillingHistoryError("BILLING_HISTORY_INVALID",
    "Stripe history checkpoint has an invalid record count.");
  return { source, runId: attempt.run.run_id,
    status: attempt.run.status === "succeeded" ? "succeeded" : "running", recordCount };
}

async function collectInventory<Item>(
  scope: BackendObservationScope, reader: StripeHistoryProvider, attempt: SourceAttempt, inventory: Inventory<Item>,
): Promise<SourceResult> {
  let summary = pendingSummary(inventory.source, attempt);
  if (summary.status === "succeeded") return { summary, error: null };
  let stage: StripeHistoryImportStage = "checkpoint_read";
  try {
    let cursor: string | null = null;
    if (attempt.run.checkpoint !== null) {
      let parsedCheckpoint: z.infer<typeof checkpointSchema>;
      try {
        parsedCheckpoint = checkpointSchema.parse(JSON.parse(attempt.run.checkpoint));
      } catch {
        throw new BillingHistoryError("BILLING_HISTORY_INVALID", "Stripe history pagination checkpoint is invalid.");
      }
      cursor = parsedCheckpoint.cursor;
    }
    do {
      stage = "page_read";
      reader.requireBudget();
      const page = await inventory.page(cursor, attempt.input.requestedTo);
      const observation: HistoryObservation = { environment: reader.environment, observedAt: new Date() };
      const recordCount = summary.recordCount + page.data.length;
      stage = "page_transaction";
      await unsafeTransaction(async (executor) => {
        stage = "native_persistence";
        for (const item of page.data) {
          reader.requireBudget();
          await inventory.persist(executor, item, observation);
        }
        stage = "checkpoint_write";
        await checkpointHistoryImportInExecutor(executor, { runId: attempt.run.run_id, recordCount,
          checkpoint: JSON.stringify({ version: 1, cursor: page.nextCursor }) });
        if (page.nextCursor === null) {
          stage = "completion";
          await completeHistoryImportInExecutor(executor, {
            runId: attempt.run.run_id, status: "succeeded",
            coveredFrom: attempt.input.requestedFrom, coveredTo: attempt.input.requestedTo,
          });
        }
        stage = "page_commit";
      });
      summary = { ...summary, recordCount, status: page.nextCursor === null ? "succeeded" : "running" };
      cursor = page.nextCursor;
    } while (cursor !== null);
    return { summary, error: null };
  } catch (error) {
    if (error instanceof StripeHistoryBudgetExhausted) return { summary, error: null };
    const failureCode = error instanceof Error ? importFailure(error) : "STRIPE_HISTORY_IMPORT_FAILED";
    // These validators expose only fixed text and schema field paths, never provider values.
    const validationCause = error instanceof BillingHistoryError && error.code === "BILLING_HISTORY_INVALID"
      ? error.message.slice(0, 2048) : null;
    await unsafeTransaction((executor) => failHistoryImportInExecutor(executor, attempt.run.run_id, failureCode));
    const failure = new Error(`Stripe ${reader.environment} ${inventory.source} import failed (${failureCode}) at ${stage}. `
      + (validationCause === null ? "" : validationCause + ". ")
      + "Check the restricted key read permissions, catalog and import checkpoint before retrying.");
    const details = { environment: reader.environment, source: inventory.source, failureCode,
      runId: attempt.run.run_id, stage, validationCause };
    captureBackendException({ action: "stripe_history_import_failed", scope, error: failure,
      details });
    console.warn(JSON.stringify({ event: "stripe_history_import_failed", ...details }));
    return { summary: { ...summary, status: "failed" }, error: failure };
  }
}

async function directPaymentIds(refundCharge: string | Readonly<{ id: string }> | null, environment: StripeEnvironment): Promise<ReadonlyArray<string>> {
  const chargeId = typeof refundCharge === "string" ? refundCharge : refundCharge?.id ?? null;
  if (chargeId === null) return [];
  return unsafeTransaction(async (executor) => {
    const result = await executor.query<{ payment_id: string }>(`SELECT payment_id
      FROM billing.stripe_payments WHERE environment = $1
        AND native_fields->'payment'->>'type' = 'charge'
        AND native_fields->'payment'->>'charge' = $2 ORDER BY payment_id`, [environment, chargeId]);
    return result.rows.map((row) => row.payment_id);
  });
}

async function collectEnvironment(
  scope: BackendObservationScope, environment: StripeEnvironment,
  attempts: ReadonlyMap<StripeHistorySource, SourceAttempt>, deadlineAtMs: number, signal: AbortSignal,
): Promise<Readonly<{ summary: StripeHistoryEnvironmentSummary; errors: ReadonlyArray<Error> }>> {
  const summaries: Array<StripeSourceSummary> = [];
  const errors: Array<Error> = [];
  let reader: StripeHistoryProvider;
  try {
    reader = (await loadStripeProvider(environment)).historyReader(deadlineAtMs, signal);
  } catch (error) {
    const failureCode = error instanceof Error ? importFailure(error) : "STRIPE_HISTORY_IMPORT_FAILED";
    await unsafeTransaction(async (executor) => {
      for (const source of stripeHistorySources) {
        const attempt = requireAttempt(attempts, source);
        if (attempt.run.status === "running") await failHistoryImportInExecutor(executor, attempt.run.run_id, failureCode);
      }
    });
    throw new Error(`Stripe ${environment} history provider initialization failed (${failureCode}). `
      + "Configure its existing restricted runtime key and read permissions on the importer.");
  }
  const subscriptions = await collectInventory(scope, reader, requireAttempt(attempts, "stripe_subscriptions"), {
    source: "stripe_subscriptions", page: (cursor, to) => reader.subscriptionsPage(cursor, to),
    persist: async (executor, item, observation) => { await persistStripeSubscriptionInExecutor(executor, item, observation); },
  });
  const invoices = await collectInventory(scope, reader, requireAttempt(attempts, "stripe_invoices"), {
    source: "stripe_invoices", page: (cursor, to) => reader.invoicesPage(cursor, to),
    persist: async (executor, item, observation) => { await persistStripeInvoiceInExecutor(executor, item, observation); },
  });
  const payments = await collectInventory(scope, reader, requireAttempt(attempts, "stripe_payments"), {
    source: "stripe_payments", page: (cursor, to) => reader.paymentsPage(cursor, to),
    persist: async (executor, item, observation) => {
      await persistStripeInvoiceInExecutor(executor, item.invoice, observation);
      await persistStripePaymentInExecutor(executor, item.invoice, item.payment, observation);
    },
  });
  for (const result of [subscriptions, invoices, payments]) {
    summaries.push(result.summary);
    if (result.error !== null) errors.push(result.error);
  }
  // Direct-charge refunds rely on a completed native payment inventory of this same window.
  if (payments.summary.status !== "succeeded") {
    summaries.push(pendingSummary("stripe_refunds", requireAttempt(attempts, "stripe_refunds")));
  } else {
    const refunds = await collectInventory(scope, reader, requireAttempt(attempts, "stripe_refunds"), {
      source: "stripe_refunds",
      page: async (cursor, to) => {
        const page = await reader.refundsPage(cursor, to);
        const data: Array<StripeHistoryRefund> = [];
        for (const item of page.data) {
          const refund = await reader.refundContext(item, await directPaymentIds(item.charge, environment));
          if (refund !== null) data.push(refund);
        }
        return { data, nextCursor: page.nextCursor };
      },
      persist: async (executor, item, observation) => { await persistStripeRefundInExecutor(executor, item.charge, item.refund, observation); },
    });
    summaries.push(refunds.summary);
    if (refunds.error !== null) errors.push(refunds.error);
  }
  const summary: StripeHistoryEnvironmentSummary = { environment,
    scope: "catalog_global_lists_without_test_clocks",
    requestedTo: requireAttempt(attempts, "stripe_subscriptions").input.requestedTo.toISOString(), sources: summaries };
  console.info(JSON.stringify({ event: "stripe_history_environment_import_completed", ...summary }));
  return { summary, errors };
}

function environmentImportFailure(
  scope: BackendObservationScope, environment: StripeEnvironment, failureCode: string,
): Error {
  const failure = new Error(`Stripe ${environment} history environment import failed (${failureCode}). `
    + "Inspect source coverage and the runtime provider configuration before retrying.");
  captureBackendException({ action: "stripe_history_import_failed", scope, error: failure,
    details: { environment } });
  return failure;
}

export async function importStripeHistory(
  scope: BackendObservationScope, environment: StripeEnvironment, deadlineAtMs: number, signal: AbortSignal,
): Promise<StripeHistoryImportSummary> {
  return withSessionAdvisoryLock({ lockName: `stripe-history-import-${environment}`,
    lockKey: environment === "production" ? "billing.stripe_history_import" : "billing.stripe_history_import.sandbox",
    timeoutMs: 10_000, pollIntervalMs: 1_000, signal }, async (lockSignal) => {
    const environments: Array<StripeHistoryEnvironmentSummary> = [];
    const errors: Array<Error> = [];
    if (Date.now() + 30_000 < deadlineAtMs) {
      lockSignal.throwIfAborted();
      try {
        const attempts = await beginAttempts(environment);
        const result = await collectEnvironment(scope, environment, attempts, deadlineAtMs, lockSignal);
        environments.push(result.summary);
        errors.push(...result.errors);
      } catch (error) {
        const failureCode = error instanceof Error ? importFailure(error) : "STRIPE_HISTORY_IMPORT_FAILED";
        errors.push(environmentImportFailure(scope, environment, failureCode));
      }
    }
    if (errors.length > 0) {
      const failure = new AggregateError(errors, "Stripe history import failed; inspect source coverage and sanitized failure codes.");
      markCapturedBackendException(failure);
      throw failure;
    }
    const summary: StripeHistoryImportSummary = { environments, remaining: environments.length === 0
      || environments.some((environment) => environment.sources.some((source) => source.status === "running")) };
    console.info(JSON.stringify({ event: "stripe_history_import_completed", ...summary }));
    return summary;
  });
}
