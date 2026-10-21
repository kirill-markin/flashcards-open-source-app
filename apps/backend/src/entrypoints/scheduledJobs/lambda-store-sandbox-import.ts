import type { Handler } from "aws-lambda";
import {
  createBackendObservationScope, initializeBackendSentry, wrapBackendHandler,
} from "../../observability/sentry";
import type { AppleHistoryImportSummary } from "../../billing/history/appleImport";
import type { GoogleHistoryImportSummary } from "../../billing/history/googleImport";
import type { StripeHistoryImportSummary } from "../../billing/history/stripeImport";
import { failImportSources, runImportSource, runStoreImportJob } from "./storeImportSupport";

initializeBackendSentry("store-sandbox-import");

type SandboxImportResponse = Readonly<{
  ok: true;
  appleHistory: AppleHistoryImportSummary;
  googleHistory: GoogleHistoryImportSummary;
  stripe: StripeHistoryImportSummary;
}>;

const sandboxImportHandler: Handler<Record<string, never>, SandboxImportResponse> = async (_event, context) => {
  const scope = createBackendObservationScope("store-sandbox-import", context.awsRequestId ?? null,
    null, null, null, null, null, null, null, null, null);
  return runStoreImportJob<SandboxImportResponse>(scope, "billing.sandbox_history_import", async (signal) => {
    const { importAppleHistory } = await import("../../billing/history/appleImport");
    const { importGoogleBillingHistory } = await import("../../billing/history/googleImport");
    const { importStripeHistory } = await import("../../billing/history/stripeImport");
    const deadlineAtMs = Date.now() + 12 * 60 * 1000;
    const [appleHistory, googleHistory, stripe] = await Promise.all([
      runImportSource(scope, "apple_history", () => importAppleHistory(scope, "sandbox", deadlineAtMs, signal)),
      runImportSource(scope, "google_history", () => importGoogleBillingHistory(scope, "sandbox", deadlineAtMs, signal, null)),
      runImportSource(scope, "stripe_history", () => importStripeHistory(scope, "sandbox", deadlineAtMs, signal)),
    ]);
    if (!appleHistory.ok || !googleHistory.ok || !stripe.ok) {
      failImportSources([appleHistory, googleHistory, stripe]);
    }
    return { ok: true, appleHistory: appleHistory.summary, googleHistory: googleHistory.summary, stripe: stripe.summary };
  });
};

export const handler = wrapBackendHandler(sandboxImportHandler);
