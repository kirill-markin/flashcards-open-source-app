import type { Handler } from "aws-lambda";
import { z } from "zod";
import { withTransientDatabaseRetry } from "../../database/transient";
import {
  addBackendBreadcrumb,
  captureBackendException,
  createBackendObservationScope,
  initializeBackendSentry,
  normalizeCaughtError,
  wrapBackendHandler,
} from "../../observability/sentry";

initializeBackendSentry("card-addition-reconciliation");

const reconciliationEventSchema = z.object({
  batchSize: z.number().int().min(1).max(500).optional(),
  maxBatches: z.number().int().min(1).max(20).optional(),
});

type ReconciliationRequest = Readonly<{
  batchSize: number;
  maxBatches: number;
}>;
type ReconciliationRuntime = Readonly<{
  reconcileCardAdditions: typeof import("../../productAnalytics/cardAdditionRecovery").reconcileCardAdditions;
}>;
type ReconciliationResponse = Readonly<{
  ok: true;
  batchSize: number;
  maxBatches: number;
  scannedCount: number;
  recoveredCount: number;
  batchCount: number;
  finished: boolean;
}>;

let runtimePromise: Promise<ReconciliationRuntime> | null = null;

async function getRuntime(): Promise<ReconciliationRuntime> {
  if (runtimePromise === null) {
    runtimePromise = import("../../productAnalytics/cardAdditionRecovery");
  }
  return runtimePromise;
}

const cardAdditionReconciliationHandler: Handler<unknown, ReconciliationResponse> = async (event, context) => {
  const scope = createBackendObservationScope(
    "card-addition-reconciliation", context.awsRequestId, null, null, null, null, null, null, null, null, null,
  );
  let request: ReconciliationRequest | null = null;
  try {
    const input = reconciliationEventSchema.parse(event);
    const boundedRequest: ReconciliationRequest = {
      batchSize: input.batchSize ?? 100,
      maxBatches: input.maxBatches ?? 10,
    };
    request = boundedRequest;
    const runtime = await getRuntime();
    const result = await withTransientDatabaseRetry(
      () => runtime.reconcileCardAdditions(boundedRequest, scope),
      () => scope,
    );
    addBackendBreadcrumb({
      action: "card_addition_reconciliation_completed",
      scope,
      details: {
        ...boundedRequest,
        scannedCount: result.scannedCount,
        recoveredCount: result.recoveredCount,
        batchCount: result.batchCount,
        finished: result.finished,
      },
    });
    return {
      ok: true,
      ...boundedRequest,
      scannedCount: result.scannedCount,
      recoveredCount: result.recoveredCount,
      batchCount: result.batchCount,
      finished: result.finished,
    };
  } catch (error) {
    const normalizedError = normalizeCaughtError(error);
    captureBackendException({
      action: "card_addition_reconciliation_failed",
      scope,
      error: normalizedError,
      details: {
        batchSize: request?.batchSize ?? null,
        maxBatches: request?.maxBatches ?? null,
        message: normalizedError.message,
      },
    });
    throw error;
  }
};

export const handler = wrapBackendHandler(cardAdditionReconciliationHandler);
