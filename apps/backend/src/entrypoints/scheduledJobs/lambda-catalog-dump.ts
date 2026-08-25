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

function createCatalogDumpFailureDetails(error: Error): CatalogDumpFailureDetails {
  return {
    bucketName: readOptionalTrimmedEnv(process.env, "CATALOG_DUMP_S3_BUCKET_NAME"),
    message: error.message,
  };
}

const catalogDumpHandler: Handler<unknown, CatalogDumpResponse> = async (_event, context) => {
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
      details: createCatalogDumpFailureDetails(normalizedError),
    });
    throw error;
  }
};

export const handler = wrapBackendHandler(catalogDumpHandler);
