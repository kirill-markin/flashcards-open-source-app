/**
 * Rebuild trigger for the public catalog dump artifact.
 *
 * Nothing rebuilds the artifact on a schedule, so every admin operation that
 * changes published catalog output has to trigger the builder itself. The
 * builder runs asynchronously: the admin request pays for one time-bounded
 * invoke, never for the rebuild, and never fails because of it. The state
 * change has already committed when the trigger runs, so failing would report
 * a successful publish as failed — but a dropped trigger leaves the CDN stale
 * until the next admin operation, so every failed trigger is captured.
 *
 * Import this module by its narrow path only. Do not re-export it from the
 * `catalog` or public-catalog barrels: those barrels are imported by Lambdas
 * that must not pull in the sharp-dependent authoring graph.
 */
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import {
  captureBackendException,
  createBackendObservationScope,
  normalizeCaughtError,
} from "../../../observability/sentry";

export type CatalogDumpRefreshTrigger = Readonly<{
  route: string;
  method: string;
  requestId: string | null;
}>;

const catalogDumpFunctionNameEnvName = "CATALOG_DUMP_FUNCTION_NAME";

/**
 * Hard ceiling for one trigger's invoke, retry attempt included.
 *
 * The trigger spends the calling handler's remaining time, and the tightest
 * caller is the direct image ingestion Lambda: it reserves
 * `directImageIngestionResponseMarginMs` (2 s) of its 15 s timeout for producing
 * the response, and an ingest that runs to its deadline leaves only that. A slow
 * or throttled Lambda control-plane call must therefore fail fast and be
 * captured, never run a committed admin operation out of time into a 502.
 */
const catalogDumpRefreshInvokeTimeoutMs = 1_000;

/**
 * Attempts allowed per trigger, first attempt included.
 *
 * Do not lower this back to one. The client below is a module-level singleton
 * reused across invocations, so the first invoke after an idle container can hit
 * a stale keep-alive socket and fail with `ECONNRESET` on a request the next
 * attempt would have completed — silently costing artifact freshness on a
 * surface too low-traffic for a later trigger to cover for it. Allowing the
 * retry does not widen the latency bound above: `abortSignal` is applied to the
 * whole `send` call, retries included, so both attempts share the single
 * `catalogDumpRefreshInvokeTimeoutMs` budget instead of getting one each.
 */
const catalogDumpRefreshInvokeMaxAttempts = 2;

let catalogDumpRefreshLambdaClient: LambdaClient | null = null;

function getCatalogDumpRefreshLambdaClient(): LambdaClient {
  if (catalogDumpRefreshLambdaClient === null) {
    catalogDumpRefreshLambdaClient = new LambdaClient({
      maxAttempts: catalogDumpRefreshInvokeMaxAttempts,
    });
  }

  return catalogDumpRefreshLambdaClient;
}

function getCatalogDumpFunctionName(): string {
  const functionName = process.env[catalogDumpFunctionNameEnvName];
  if (functionName === undefined || functionName.trim() === "") {
    throw new Error(`${catalogDumpFunctionNameEnvName} environment variable is not set`);
  }

  return functionName.trim();
}

/**
 * Triggers one asynchronous public catalog dump rebuild and never throws.
 *
 * Callers must await this even though the rebuild itself is not awaited: the
 * invoke call has to reach Lambda before the route handler returns, because the
 * execution environment freezes right after the response.
 */
export async function refreshPublicCatalogDump(
  trigger: CatalogDumpRefreshTrigger,
): Promise<void> {
  let functionName: string | null = null;
  try {
    functionName = getCatalogDumpFunctionName();
    await getCatalogDumpRefreshLambdaClient().send(
      new InvokeCommand({
        FunctionName: functionName,
        InvocationType: "Event",
        Payload: new TextEncoder().encode(JSON.stringify({ triggerRoute: trigger.route })),
      }),
      { abortSignal: AbortSignal.timeout(catalogDumpRefreshInvokeTimeoutMs) },
    );
  } catch (error) {
    const refreshError = normalizeCaughtError(error);
    captureBackendException({
      action: "catalog_dump_refresh_failed",
      error: refreshError,
      scope: createBackendObservationScope(
        "backend-api",
        trigger.requestId,
        trigger.route,
        trigger.method,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
      ),
      details: {
        functionName,
        route: trigger.route,
        message: refreshError.message,
      },
    });
  }
}
