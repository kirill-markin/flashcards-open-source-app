import { randomUUID } from "node:crypto";
import { z } from "zod";
import { unsafeQuery, unsafeTransaction } from "../../database/unsafe";
import { addBackendBreadcrumb, type BackendObservationScope } from "../../observability/sentry";
import type { PlayImportSummary } from "../../storeAnalytics/playImport";
import { googlePackageName } from "../google/contracts";
import { GoogleHistoryApiError, GoogleHistoryClient, type VerifiedGoogleSubscription } from "./googleClient";
import { persistGoogleOrderInExecutor, persistGoogleSubscriptionObservationInExecutor } from "./google";
import { beginHistoryImportInExecutor, checkpointHistoryImportInExecutor, completeHistoryImportInExecutor,
  failHistoryImportInExecutor, loadLatestHistoryImportInExecutor, type HistoryImportInput,
  type HistorySource } from "./imports";
import { historyScopeHash, type HistoryEnvironment } from "./store";

const maximumInventorySize = 10_000;
const inventoryKey = `nibomo:${googlePackageName}:discoverable-orders-v1`;
const subscriptionInventoryKey = `nibomo:${googlePackageName}:retained-token-snapshots-v1`;
const orderPattern = /^GPA\.\d{4}-\d{4}-\d{4}-\d{5}(?:\.\.(\d+))?$/;
const orderTaskSchema = z.object({ orderId: z.string().regex(orderPattern),
  purchaseToken: z.string().nullable(), salesEvidence: z.boolean(), verifiedEnvironment: z.boolean() });
const subscriptionTaskSchema = z.object({ purchaseToken: z.string().min(1), observationId: z.string().min(1) });
const checkpointSchema = z.object({
  orders: z.array(orderTaskSchema).max(maximumInventorySize),
  subscriptions: z.array(subscriptionTaskSchema).max(maximumInventorySize),
  handledOrderIds: z.array(z.string()).max(maximumInventorySize),
  unavailableSubscriptions: z.number().int().nonnegative(),
  unavailableOrders: z.number().int().nonnegative(),
});
type OrderTask = z.infer<typeof orderTaskSchema>;
type SubscriptionTask = z.infer<typeof subscriptionTaskSchema>;
type Checkpoint = z.infer<typeof checkpointSchema>;
type InventoryRow = Readonly<{ environment: HistoryEnvironment; purchase_token: string | null;
  order_id: string | null; sales_evidence: boolean; verified_environment: boolean }>;
type ImportAttempt = Readonly<{ runId: string; input: HistoryImportInput; count: number; checkpoint: Checkpoint }>;
type SalesInventory = Pick<PlayImportSummary, "salesInventoryComplete"> | null;
export type GoogleHistoryImportSummary = Readonly<{
  ordersHandled: number; subscriptionsObserved: number; unfinishedSources: number;
  failedSources: number; tokenLookupsUnavailable: number;
}>;

function requireInventoryBound(size: number): void {
  if (size > maximumInventorySize) {
    throw new GoogleHistoryApiError("GOOGLE_HISTORY_INVENTORY_LIMIT", null, "inventory exceeds 10000 records; split collection scope before retrying");
  }
}

function expandOrder(task: OrderTask): ReadonlyArray<OrderTask> {
  const match = orderPattern.exec(task.orderId);
  if (match === null) throw new GoogleHistoryApiError("GOOGLE_HISTORY_ORDER_ID_INVALID", null, "order identifier validation");
  const root = task.orderId.split("..")[0];
  const suffix = match[1] === undefined ? -1 : Number(match[1]);
  requireInventoryBound(suffix + 2);
  const ids = [root, ...Array.from({ length: suffix + 1 }, (_value, index) => `${root}..${index}`)];
  // Sales establish production only for their exact order; other periods need token evidence.
  return ids.map((orderId) => ({ orderId, purchaseToken: task.purchaseToken,
    salesEvidence: orderId === task.orderId && task.salesEvidence, verifiedEnvironment: task.verifiedEnvironment }));
}

function mergeOrders(tasks: ReadonlyArray<OrderTask>): Array<OrderTask> {
  const merged = new Map<string, OrderTask>();
  for (const task of tasks) {
    const previous = merged.get(task.orderId);
    if (previous?.purchaseToken !== null && previous?.purchaseToken !== undefined
      && task.purchaseToken !== null && previous.purchaseToken !== task.purchaseToken) {
      throw new GoogleHistoryApiError("GOOGLE_HISTORY_TOKEN_CONFLICT", null, "order token linkage validation");
    }
    merged.set(task.orderId, { ...task, purchaseToken: previous?.purchaseToken ?? task.purchaseToken,
      salesEvidence: previous?.salesEvidence === true || task.salesEvidence,
      verifiedEnvironment: previous?.verifiedEnvironment === true || task.verifiedEnvironment });
  }
  requireInventoryBound(merged.size);
  return [...merged.values()].sort((left, right) => Number(right.salesEvidence) - Number(left.salesEvidence)
    || left.orderId.localeCompare(right.orderId));
}

function expandInventory(tasks: ReadonlyArray<OrderTask>): ReadonlyArray<OrderTask> {
  const roots = new Map<string, OrderTask>();
  const salesIds = new Set(tasks.filter((task) => task.salesEvidence).map((task) => task.orderId));
  for (const task of tasks) {
    const root = task.orderId.split("..")[0];
    const previous = roots.get(root);
    const previousSuffix = previous?.orderId.split("..")[1];
    const suffix = task.orderId.split("..")[1];
    const combined = mergeOrders([
      ...(previous === undefined ? [] : [{ ...previous, orderId: root }]), { ...task, orderId: root },
    ])[0];
    const highestOrderId = Number(previousSuffix ?? -1) > Number(suffix ?? -1) ? previous!.orderId : task.orderId;
    roots.set(root, { ...combined, orderId: highestOrderId, salesEvidence: false });
  }
  const expanded: Array<OrderTask> = [];
  for (const root of roots.values()) {
    const periods = expandOrder(root);
    requireInventoryBound(expanded.length + periods.length);
    expanded.push(...periods.map((task) => ({ ...task, salesEvidence: salesIds.has(task.orderId) })));
  }
  return mergeOrders(expanded);
}

async function readInventory(environment: HistoryEnvironment): Promise<ReadonlyArray<InventoryRow>> {
  const result = await unsafeQuery<InventoryRow>(`WITH inventory AS (
    SELECT environment, provider_purchase_id AS purchase_token, google_latest_order_id AS order_id,
      false AS sales_evidence FROM billing.purchases WHERE provider = 'google' AND environment = $3
    UNION SELECT environment, provider_purchase_id, google_last_paid_order_id, false
      FROM billing.purchases WHERE provider = 'google' AND environment = $3
    UNION SELECT environment, provider_purchase_id, payload->>'revokedOrderId', false
      FROM billing.provider_events WHERE provider = 'google' AND environment = $3
    UNION SELECT environment, NULL, order_id, false FROM billing.google_orders WHERE environment = $3
    UNION SELECT 'production', NULL, columns->>'Order Number', true
      FROM store_analytics.play_other_report_rows
      WHERE report_name = 'sales' AND package_name = $1 AND $3 = 'production'
  ), observed AS (SELECT observation.environment, NULL::text AS purchase_token, item->>'latestSuccessfulOrderId' AS order_id,
    false AS sales_evidence FROM billing.google_subscription_observations AS observation
    CROSS JOIN LATERAL jsonb_array_elements(observation.native_fields->'lineItems') AS item
    WHERE observation.environment = $3)
  SELECT environment, purchase_token, order_id, bool_or(sales_evidence) AS sales_evidence,
    bool_or(NOT sales_evidence) AS verified_environment
    FROM (SELECT * FROM inventory UNION SELECT * FROM observed) AS combined
    GROUP BY environment, purchase_token, order_id LIMIT $2`,
  [googlePackageName, maximumInventorySize + 1, environment]);
  requireInventoryBound(result.rows.length);
  return result.rows;
}

async function openAttempt(
  source: HistorySource, environment: HistoryEnvironment, key: string, checkpoint: Checkpoint,
): Promise<ImportAttempt> {
  const scopeHash = historyScopeHash("provider:" + historyScopeHash(key));
  const unfinished = await unsafeQuery<Readonly<{ requested_from: Date; requested_to: Date }>>(
    `SELECT requested_from, requested_to FROM billing.history_import_runs
      WHERE provider = 'google' AND source = $1 AND environment = $2 AND scope_hash = $3
        AND status = 'running' ORDER BY started_at DESC LIMIT 1`, [source, environment, scopeHash]);
  const dates = unfinished.rows[0];
  const snapshotAt = new Date();
  // The one-millisecond snapshot window only identifies this poll; it never claims historical state coverage.
  const input: HistoryImportInput = { source, environment, scope: { kind: "provider", key },
    requestedFrom: dates?.requested_from ?? (source === "google_orders" ? new Date(0) : snapshotAt),
    requestedTo: dates?.requested_to ?? (source === "google_orders" ? snapshotAt : new Date(snapshotAt.getTime() + 1)) };
  return unsafeTransaction(async (executor) => {
    const latest = await loadLatestHistoryImportInExecutor(executor, input);
    if (latest?.status === "running") {
      if (latest.checkpoint === null) throw new GoogleHistoryApiError("GOOGLE_HISTORY_CHECKPOINT_INVALID", null, "resume");
      let storedCheckpoint: unknown;
      try { storedCheckpoint = JSON.parse(latest.checkpoint); }
      catch { throw new GoogleHistoryApiError("GOOGLE_HISTORY_CHECKPOINT_INVALID", null, "resume JSON"); }
      const resumed = checkpointSchema.safeParse(storedCheckpoint);
      if (!resumed.success) throw new GoogleHistoryApiError("GOOGLE_HISTORY_CHECKPOINT_INVALID", null, "resume");
      const count = Number(latest.record_count);
      const resumedCheckpoint: Checkpoint = source === "google_orders" ? { ...resumed.data,
        orders: mergeOrders([...resumed.data.orders, ...checkpoint.orders]
          .filter((task) => !resumed.data.handledOrderIds.includes(task.orderId))) } : resumed.data;
      if (source === "google_orders") {
        requireInventoryBound(resumedCheckpoint.handledOrderIds.length + resumedCheckpoint.orders.length);
        await checkpointHistoryImportInExecutor(executor,
          { runId: latest.run_id, recordCount: count, checkpoint: JSON.stringify(resumedCheckpoint) });
      }
      return { runId: latest.run_id, input, count, checkpoint: resumedCheckpoint };
    }
    const runId = await beginHistoryImportInExecutor(executor, input);
    await checkpointHistoryImportInExecutor(executor, { runId, recordCount: 0, checkpoint: JSON.stringify(checkpoint) });
    return { runId, input, count: 0, checkpoint };
  });
}

function environmentOf(read: VerifiedGoogleSubscription): HistoryEnvironment {
  return read.subscription.testPurchase === undefined ? "production" : "sandbox";
}

function deadlineReached(deadlineAtMs: number, signal: AbortSignal): boolean {
  return signal.aborted || Date.now() >= deadlineAtMs;
}

async function finishAttempt(attempt: ImportAttempt): Promise<void> {
  await unsafeTransaction((executor) => completeHistoryImportInExecutor(executor,
    { runId: attempt.runId, status: "succeeded", coveredFrom: attempt.input.requestedFrom,
      coveredTo: attempt.input.requestedTo }));
}

async function failAttempt(attempt: ImportAttempt, error: unknown): Promise<void> {
  const code = error instanceof GoogleHistoryApiError ? error.code : "GOOGLE_HISTORY_IMPORT_FAILED";
  await unsafeTransaction((executor) => failHistoryImportInExecutor(executor, attempt.runId, code));
}

async function collectSubscriptions(
  client: GoogleHistoryClient, attempt: ImportAttempt, deadlineAtMs: number, signal: AbortSignal,
): Promise<Readonly<{ handled: number; unfinished: boolean }>> {
  let count = attempt.count;
  let checkpoint = attempt.checkpoint;
  let handled = 0;
  while (checkpoint.subscriptions.length > 0) {
    if (deadlineReached(deadlineAtMs, signal)) return { handled, unfinished: true };
    const task = checkpoint.subscriptions[0];
    let read: VerifiedGoogleSubscription;
    try {
      read = await client.subscription(task.purchaseToken);
    } catch (error) {
      if (!(error instanceof GoogleHistoryApiError) || (error.httpStatus !== 404 && error.httpStatus !== 410)) throw error;
      checkpoint = { ...checkpoint, subscriptions: checkpoint.subscriptions.slice(1),
        handledOrderIds: [...checkpoint.handledOrderIds, task.purchaseToken],
        unavailableSubscriptions: checkpoint.unavailableSubscriptions + 1 };
      await unsafeTransaction((executor) => checkpointHistoryImportInExecutor(executor,
        { runId: attempt.runId, recordCount: count, checkpoint: JSON.stringify(checkpoint) }));
      continue;
    }
    if (environmentOf(read) !== attempt.input.environment) {
      throw new GoogleHistoryApiError("GOOGLE_HISTORY_ENVIRONMENT_CONFLICT", null, "subscription environment validation");
    }
    if (read.linkedPurchaseToken === task.purchaseToken) {
      throw new GoogleHistoryApiError("GOOGLE_HISTORY_TOKEN_CONFLICT", null, "subscription cannot be its own predecessor");
    }
    const remaining = checkpoint.subscriptions.slice(1);
    // Predecessors may be unknown to current billing rows; retain their native observations too.
    if (read.linkedPurchaseToken !== null && !remaining.some((item) => item.purchaseToken === read.linkedPurchaseToken)
      && !checkpoint.handledOrderIds.includes(read.linkedPurchaseToken)) {
      remaining.push({ purchaseToken: read.linkedPurchaseToken, observationId: randomUUID() });
    }
    const next: Checkpoint = { ...checkpoint, subscriptions: remaining,
      handledOrderIds: [...checkpoint.handledOrderIds, task.purchaseToken] };
    requireInventoryBound(next.handledOrderIds.length + next.subscriptions.length);
    await unsafeTransaction(async (executor) => {
      await persistGoogleSubscriptionObservationInExecutor(executor, task.purchaseToken, task.observationId,
        read.subscription, { environment: attempt.input.environment, observedAt: read.observedAt });
      await checkpointHistoryImportInExecutor(executor,
        { runId: attempt.runId, recordCount: count + 1, checkpoint: JSON.stringify(next) });
    });
    count += 1;
    handled += 1;
    checkpoint = next;
  }
  if (checkpoint.unavailableSubscriptions > 0) {
    throw new GoogleHistoryApiError("GOOGLE_HISTORY_TOKEN_EXPIRED", null,
      "retained token history is outside the provider lookup window");
  }
  await finishAttempt(attempt);
  return { handled, unfinished: false };
}

async function readSubscriptionForOrder(
  client: GoogleHistoryClient, token: string,
): Promise<VerifiedGoogleSubscription | null> {
  try {
    return await client.subscription(token);
  } catch (error) {
    if (!(error instanceof GoogleHistoryApiError) || (error.httpStatus !== 404 && error.httpStatus !== 410)) throw error;
    // Orders survive the token lookup window. This establishes no subscription observation/coverage.
    return null;
  }
}

async function collectOrders(
  client: GoogleHistoryClient, attempt: ImportAttempt, deadlineAtMs: number, signal: AbortSignal,
  reports: SalesInventory,
): Promise<Readonly<{ handled: number; unfinished: boolean; unavailable: number }>> {
  let count = attempt.count;
  let checkpoint = attempt.checkpoint;
  let handled = 0;
  const cache = new Map<string, VerifiedGoogleSubscription | null>();
  while (checkpoint.orders.length > 0) {
    if (deadlineReached(deadlineAtMs, signal)) return { handled, unfinished: true,
      unavailable: [...cache.values()].filter((item) => item === null).length };
    const task = checkpoint.orders[0];
    let read: Awaited<ReturnType<GoogleHistoryClient["order"]>>;
    try {
      read = await client.order(task.orderId);
    } catch (error) {
      if (!(error instanceof GoogleHistoryApiError) || (error.httpStatus !== 404 && error.httpStatus !== 410)) throw error;
      checkpoint = { ...checkpoint, orders: checkpoint.orders.slice(1),
        handledOrderIds: [...checkpoint.handledOrderIds, task.orderId],
        unavailableOrders: checkpoint.unavailableOrders + 1 };
      await unsafeTransaction((executor) => checkpointHistoryImportInExecutor(executor,
        { runId: attempt.runId, recordCount: count, checkpoint: JSON.stringify(checkpoint) }));
      continue;
    }
    if (task.purchaseToken !== null && task.purchaseToken !== read.purchaseToken) {
      throw new GoogleHistoryApiError("GOOGLE_HISTORY_TOKEN_CONFLICT", null, "order token linkage validation");
    }
    const subscription = cache.has(read.purchaseToken) ? cache.get(read.purchaseToken) ?? null
      : await readSubscriptionForOrder(client, read.purchaseToken);
    cache.set(read.purchaseToken, subscription);
    if (subscription !== null && environmentOf(subscription) !== attempt.input.environment) {
      throw new GoogleHistoryApiError("GOOGLE_HISTORY_ENVIRONMENT_CONFLICT", null, "order environment validation");
    }
    if (subscription === null && !task.salesEvidence && !task.verifiedEnvironment && task.purchaseToken === null) {
      throw new GoogleHistoryApiError("GOOGLE_HISTORY_ENVIRONMENT_UNAVAILABLE", null, "order has no subscription or sales environment evidence");
    }
    const orderIds = subscription?.subscription.lineItems.flatMap((item) =>
      item.latestSuccessfulOrderId === undefined ? [] : [item.latestSuccessfulOrderId]) ?? [];
    const additions = [...expandOrder({ ...task, purchaseToken: read.purchaseToken }),
      ...orderIds.flatMap((orderId) => expandOrder({ orderId, purchaseToken: read.purchaseToken,
        salesEvidence: false, verifiedEnvironment: true }))];
    const handledOrderIds = [...checkpoint.handledOrderIds, task.orderId];
    const next: Checkpoint = { ...checkpoint, handledOrderIds,
      orders: mergeOrders([...checkpoint.orders.slice(1), ...additions])
        .filter((item) => !handledOrderIds.includes(item.orderId)) };
    requireInventoryBound(handledOrderIds.length + next.orders.length);
    const observation = { environment: attempt.input.environment, observedAt: new Date() };
    await unsafeTransaction(async (executor) => {
      await persistGoogleOrderInExecutor(executor, read.purchaseToken, read.order, observation);
      if (subscription !== null) {
        await persistGoogleSubscriptionObservationInExecutor(executor, read.purchaseToken,
          subscription.observationId,
          subscription.subscription, { environment: attempt.input.environment, observedAt: subscription.observedAt });
      }
      await checkpointHistoryImportInExecutor(executor,
        { runId: attempt.runId, recordCount: count + 1, checkpoint: JSON.stringify(next) });
    });
    count += 1;
    handled += 1;
    checkpoint = next;
  }
  if (attempt.input.environment === "production" && reports?.salesInventoryComplete !== true) {
    throw new GoogleHistoryApiError("GOOGLE_HISTORY_SALES_INVENTORY_INCOMPLETE", null, "sales inventory collection");
  }
  if (checkpoint.unavailableOrders > 0) {
    throw new GoogleHistoryApiError("GOOGLE_HISTORY_ORDER_UNAVAILABLE", null,
      "one or more discovered order periods are unavailable; accessible orders were preserved");
  }
  await finishAttempt(attempt);
  return { handled, unfinished: false, unavailable: [...cache.values()].filter((item) => item === null).length };
}

export async function discoverGoogleBillingTokens(
  scope: BackendObservationScope, deadlineAtMs: number, signal: AbortSignal,
): Promise<Readonly<{ tokensClassified: number; tokensRemaining: number }>> {
  const client = new GoogleHistoryClient((retry) =>
    addBackendBreadcrumb({ action: "google_history_retry", scope, details: retry }));
  const unknown = await unsafeQuery<Readonly<{ purchase_token: string }>>(`SELECT DISTINCT provider_purchase_id AS purchase_token
    FROM billing.provider_events WHERE provider = 'google' AND environment IS NULL
      AND provider_purchase_id IS NOT NULL LIMIT $1`, [maximumInventorySize + 1]);
  requireInventoryBound(unknown.rows.length);
  const failures: Array<GoogleHistoryApiError> = [];
  let tokensClassified = 0;
  for (const row of unknown.rows) {
    if (deadlineReached(deadlineAtMs, signal)) break;
    try {
      const read = await client.subscription(row.purchase_token);
      const environment = environmentOf(read);
      await unsafeTransaction(async (executor) => {
        await persistGoogleSubscriptionObservationInExecutor(executor, row.purchase_token, read.observationId,
          read.subscription, { environment, observedAt: read.observedAt });
        await executor.query(`UPDATE billing.provider_events SET environment = $1
          WHERE provider = 'google' AND provider_purchase_id = $2 AND environment IS NULL`,
        [environment, row.purchase_token]);
      });
      tokensClassified += 1;
    } catch (error) {
      const failure = error instanceof GoogleHistoryApiError ? error
        : new GoogleHistoryApiError("GOOGLE_HISTORY_DISCOVERY_FAILED", null, "unclassified RTDN token discovery");
      failures.push(failure);
      addBackendBreadcrumb({ action: "google_history_source_failed", scope,
        details: { source: "unclassified_rtdn_tokens", environment: null, code: failure.code, httpStatus: failure.httpStatus } });
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, "Google token classification failed; inspect google_history_source_failed.");
  }
  return { tokensClassified, tokensRemaining: unknown.rows.length - tokensClassified };
}

export async function importGoogleBillingHistory(
  scope: BackendObservationScope, environment: HistoryEnvironment, deadlineAtMs: number, signal: AbortSignal, reports: SalesInventory,
): Promise<GoogleHistoryImportSummary> {
  if (deadlineReached(deadlineAtMs, signal)) {
    return { ordersHandled: 0, subscriptionsObserved: 0, unfinishedSources: 2, failedSources: 0, tokenLookupsUnavailable: 0 };
  }
  const client = new GoogleHistoryClient((retry) =>
    addBackendBreadcrumb({ action: "google_history_retry", scope, details: retry }));
  const inventory = await readInventory(environment);
  let ordersHandled = 0;
  let subscriptionsObserved = 0;
  let unfinishedSources = 0;
  let tokenLookupsUnavailable = 0;
  let failedScopedSources = 0;
  const failures: Array<Error> = [];
  const rows = inventory;
  const tokens = [...new Set(rows.flatMap((row) => row.purchase_token === null ? [] : [row.purchase_token]))].sort();
  for (const source of ["google_subscriptions", "google_orders"] as const) {
    if (deadlineReached(deadlineAtMs, signal)) { unfinishedSources += 1; continue; }
    const currentRows = source === "google_orders"
      ? await readInventory(environment) : rows;
    const orders = expandInventory(currentRows.flatMap((row) => row.order_id === null ? [] : [{
      orderId: row.order_id, purchaseToken: row.purchase_token, salesEvidence: row.sales_evidence,
      verifiedEnvironment: row.verified_environment }]));
    const attempt = await openAttempt(source, environment,
      source === "google_orders" ? inventoryKey : subscriptionInventoryKey,
      { orders: source === "google_orders" ? [...orders] : [], subscriptions: source === "google_subscriptions"
        ? tokens.map((purchaseToken) => ({ purchaseToken, observationId: randomUUID() })) : [],
        handledOrderIds: [], unavailableSubscriptions: 0, unavailableOrders: 0 });
    try {
      if (source === "google_subscriptions") {
        const result = await collectSubscriptions(client, attempt, deadlineAtMs, signal);
        subscriptionsObserved += result.handled;
        unfinishedSources += Number(result.unfinished);
      } else {
        const result = await collectOrders(client, attempt, deadlineAtMs, signal, reports);
        ordersHandled += result.handled;
        tokenLookupsUnavailable += result.unavailable;
        unfinishedSources += Number(result.unfinished);
      }
    } catch (error) {
      await failAttempt(attempt, error);
      failedScopedSources += 1;
      const progress = await unsafeQuery<Readonly<{ record_count: string }>>(
        "SELECT record_count::text FROM billing.history_import_runs WHERE run_id = $1", [attempt.runId]);
      const handledBeforeFailure = Number(progress.rows[0].record_count) - attempt.count;
      if (source === "google_orders") ordersHandled += handledBeforeFailure;
      else subscriptionsObserved += handledBeforeFailure;
      // Retain only boundary errors; database/SDK causes must not leak checkpoints or tokens.
      const failure = error instanceof GoogleHistoryApiError ? error
        : new GoogleHistoryApiError("GOOGLE_HISTORY_IMPORT_FAILED", null, "persistence; inspect database diagnostics");
      failures.push(failure);
      addBackendBreadcrumb({ action: "google_history_source_failed", scope,
        details: { source, environment, code: failure.code, httpStatus: failure.httpStatus } });
    }
  }
  const summary = { ordersHandled, subscriptionsObserved, unfinishedSources,
    failedSources: failedScopedSources, tokenLookupsUnavailable };
  addBackendBreadcrumb({ action: "google_history_import_completed", scope, details: summary });
  if (failures.length > 0) throw new AggregateError(failures, "Google native history collection failed; inspect google_history_source_failed.");
  return summary;
}
