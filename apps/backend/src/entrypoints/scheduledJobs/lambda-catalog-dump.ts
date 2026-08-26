import type { Handler } from "aws-lambda";
import {
  addBackendBreadcrumb,
  captureBackendException,
  createBackendObservationScope,
  initializeBackendSentry,
  normalizeCaughtError,
  type CatalogDumpFailureDetails,
  wrapBackendHandler,
} from "../../observability/sentry";

initializeBackendSentry("catalog-dump");

const maximumTriggerRouteLength = 200;

type CatalogDumpResponse = Readonly<{
  ok: true;
  bucketName: string;
  objectKey: string;
  sha256: string;
  generatedAt: string;
  byteLength: number;
}>;

type CatalogDumpRuntime = Readonly<{
  generateAndWriteCatalogDump: typeof import("../../catalog/distribution/public/dumpGeneration").generateAndWriteCatalogDump;
}>;

let catalogDumpRuntimePromise: Promise<CatalogDumpRuntime> | null = null;

async function createCatalogDumpRuntime(): Promise<CatalogDumpRuntime> {
  const { generateAndWriteCatalogDump } = await import("../../catalog/distribution/public/dumpGeneration");
  return {
    generateAndWriteCatalogDump,
  };
}

function getCatalogDumpRuntime(): Promise<CatalogDumpRuntime> {
  if (catalogDumpRuntimePromise === null) {
    catalogDumpRuntimePromise = createCatalogDumpRuntime();
  }

  return catalogDumpRuntimePromise;
}

function readOptionalTrimmedEnv(env: NodeJS.ProcessEnv, name: string): string | null {
  const value = env[name];
  if (value === undefined || value.trim() === "") {
    return null;
  }

  return value.trim();
}

function createCatalogDumpFailureDetails(
  error: Error,
  triggerRoute: string | null,
): CatalogDumpFailureDetails {
  return {
    bucketName: readOptionalTrimmedEnv(process.env, "CATALOG_DUMP_S3_BUCKET_NAME"),
    triggerRoute,
    message: error.message,
  };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && Array.isArray(value) === false;
}

/**
 * Reads the admin route that triggered this rebuild, so a stale artifact can be
 * traced back to the operation that should have refreshed it. The deploy-time
 * seed sends an empty payload, and a malformed payload must never fail a
 * rebuild, so both degrade to no attribution.
 */
function readTriggerRoute(event: unknown): string | null {
  if (!isRecord(event)) {
    return null;
  }

  const triggerRoute = event.triggerRoute;
  if (typeof triggerRoute !== "string" || triggerRoute.trim() === "") {
    return null;
  }

  return triggerRoute.trim().slice(0, maximumTriggerRouteLength);
}

const catalogDumpHandler: Handler<unknown, CatalogDumpResponse> = async (event, context) => {
  const triggerRoute = readTriggerRoute(event);
  const observationScope = createBackendObservationScope(
    "catalog-dump",
    context.awsRequestId ?? null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
  );
  try {
    const runtime = await getCatalogDumpRuntime();
    const result = await runtime.generateAndWriteCatalogDump(observationScope);

    addBackendBreadcrumb({
      action: "catalog_dump_generated",
      scope: observationScope,
      details: {
        bucketName: result.bucketName,
        objectKey: result.objectKey,
        sha256: result.sha256,
        generatedAt: result.generatedAt,
        byteLength: result.byteLength,
        triggerRoute,
      },
    });

    return {
      ok: true,
      bucketName: result.bucketName,
      objectKey: result.objectKey,
      sha256: result.sha256,
      generatedAt: result.generatedAt,
      byteLength: result.byteLength,
    };
  } catch (error) {
    const normalizedError = normalizeCaughtError(error);
    captureBackendException({
      action: "catalog_dump_failed",
      error: normalizedError,
      scope: observationScope,
      details: createCatalogDumpFailureDetails(normalizedError, triggerRoute),
    });
    throw error;
  }
};

export const handler = wrapBackendHandler(catalogDumpHandler);
