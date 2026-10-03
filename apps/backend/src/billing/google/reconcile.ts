import { z } from "zod";
import { unsafeTransaction } from "../../database/unsafe";
import { getDatabaseErrorFields } from "../../database/transient";
import { GoogleBillingError, type GoogleEnvironment } from "./contracts";
import { GoogleProvider } from "./provider";
import { acknowledgeGoogleTransition, persistGoogleCurrentState, settleUnavailableGoogleToken } from "./service";
import { publishGoogleTransition } from "./facts";

export const googleReconciliationEventSchema = z.object({
  source: z.literal("nibomo.billing.google"),
  task: z.literal("reconcile-subscriptions"),
  version: z.literal(1),
}).strict();

type GoogleReconciliationCandidate = Readonly<{
  purchase_id: string;
  provider_purchase_id: string;
  environment: GoogleEnvironment;
}>;

async function claimGoogleCandidate(): Promise<GoogleReconciliationCandidate | null> {
  return unsafeTransaction(async (executor) => {
    // Claim time also advances failed rows, so one unavailable token cannot starve others.
    const result = await executor.query<GoogleReconciliationCandidate>(`
      WITH candidate AS (
        SELECT purchase_id FROM billing.purchases
        WHERE provider = 'google' AND google_reconcile_stopped_at IS NULL
          AND invalidated_at IS NULL AND status <> 'revoked'
          AND (google_last_attempt_at IS NULL OR google_last_attempt_at < now() - interval '15 minutes')
          AND (provider_status_raw NOT IN ('SUBSCRIPTION_STATE_EXPIRED', 'SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED')
            OR (until IS NOT NULL AND until > now() - interval '60 days')
            OR (until IS NULL AND created_at > now() - interval '60 days')
            OR provider_status_raw IS NULL)
        ORDER BY google_last_attempt_at NULLS FIRST, purchase_id
        LIMIT 1 FOR UPDATE SKIP LOCKED
      )
      UPDATE billing.purchases AS purchase SET google_last_attempt_at = now()
      FROM candidate WHERE purchase.purchase_id = candidate.purchase_id
      RETURNING purchase.purchase_id, purchase.provider_purchase_id, purchase.environment`, []);
    return result.rows[0] ?? null;
  });
}

export async function reconcileGoogleSubscriptions(remainingTimeMs: () => number): Promise<void> {
  const provider = new GoogleProvider();
  let attempted = 0;
  let failed = 0;
  let stopped = 0;
  while (attempted < 20 && remainingTimeMs() > 180_000) {
    const candidate = await claimGoogleCandidate();
    if (candidate === null) break;
    attempted += 1;
    const lookupStartedAt = new Date();
    try {
      const transition = await persistGoogleCurrentState(provider, candidate.provider_purchase_id, null);
      await acknowledgeGoogleTransition(provider, transition);
    } catch (error) {
      const diagnostic = z.string().regex(/^[A-Z0-9_]{1,64}$/).safeParse(getDatabaseErrorFields(error).errorCode);
      const code = error instanceof GoogleBillingError ? error.code
        : diagnostic.success ? diagnostic.data : "GOOGLE_RECONCILIATION_FAILED";
      const terminal = error instanceof GoogleBillingError && error.code === "GOOGLE_PROVIDER_FAILED"
        && (error.httpStatus === 404 || error.httpStatus === 410)
        ? await settleUnavailableGoogleToken(candidate.provider_purchase_id, lookupStartedAt, error.httpStatus, null) : null;
      if (terminal !== null) {
        await publishGoogleTransition(terminal);
        stopped += 1;
      } else failed += 1;
      console.warn(JSON.stringify({ event: "google_reconciliation_purchase_failed", purchaseId: candidate.purchase_id,
        environment: candidate.environment, errorCode: code,
        providerHttpStatus: error instanceof GoogleBillingError ? error.httpStatus : null }));
    }
  }
  console.info(JSON.stringify({ event: "google_reconciliation_completed", attempted, failed, stopped }));
  if (failed > 0) {
    throw new GoogleBillingError("GOOGLE_RECONCILIATION_INCOMPLETE", true, null,
      `Google reconciliation failed for ${failed} of ${attempted} purchases; check sanitized purchase diagnostics.`);
  }
}
