import type { Handler } from "aws-lambda";
import {
  createBackendObservationScope, initializeBackendSentry, wrapBackendHandler,
} from "../../observability/sentry";
import { failImportSources, runImportSource, runStoreImportJob } from "./storeImportSupport";

initializeBackendSentry("google-billing-discovery");

type DiscoveryResponse = Readonly<{ ok: true; tokensClassified: number; tokensRemaining: number }>;

const discoveryHandler: Handler<Record<string, never>, DiscoveryResponse> = async (_event, context) => {
  const scope = createBackendObservationScope("google-billing-discovery", context.awsRequestId ?? null,
    null, null, null, null, null, null, null, null, null);
  return runStoreImportJob<DiscoveryResponse>(scope, "billing.google_token_discovery", async (signal) => {
    const { discoverGoogleBillingTokens } = await import("../../billing/history/googleImport");
    const outcome = await runImportSource(scope, "google_token_discovery", () =>
      discoverGoogleBillingTokens(scope, Date.now() + 12 * 60 * 1000, signal));
    if (!outcome.ok) failImportSources([outcome]);
    return { ok: true, ...outcome.summary };
  });
};

export const handler = wrapBackendHandler(discoveryHandler);
