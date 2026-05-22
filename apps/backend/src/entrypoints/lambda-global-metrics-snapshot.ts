import type { Handler } from "aws-lambda";
import {
  addBackendBreadcrumb,
  captureBackendException,
  createBackendObservationScope,
  initializeBackendSentry,
  normalizeCaughtError,
  type GlobalMetricsSnapshotFailureDetails,
  wrapBackendHandler,
} from "../observability/sentry";

initializeBackendSentry("global-metrics-snapshot");

type GlobalMetricsSnapshotResponse = Readonly<{
  ok: true;
  bucketName: string;
  objectKey: string;
  generatedAtUtc: string;
  asOfUtc: string;
  from: string;
  to: string;
}>;

type GlobalMetricsSnapshotRuntime = Readonly<{
  generateAndWriteGlobalMetricsSnapshot: typeof import("../globalMetrics/generation").generateAndWriteGlobalMetricsSnapshot;
}>;

let globalMetricsSnapshotRuntimePromise: Promise<GlobalMetricsSnapshotRuntime> | null = null;

async function createGlobalMetricsSnapshotRuntime(): Promise<GlobalMetricsSnapshotRuntime> {
  const [
    { initializeLangfuseTelemetry },
    { generateAndWriteGlobalMetricsSnapshot },
  ] = await Promise.all([
    import("../telemetry/langfuse"),
    import("../globalMetrics/generation"),
  ]);
  initializeLangfuseTelemetry();
  return {
    generateAndWriteGlobalMetricsSnapshot,
  };
}

function getGlobalMetricsSnapshotRuntime(): Promise<GlobalMetricsSnapshotRuntime> {
  if (globalMetricsSnapshotRuntimePromise === null) {
    globalMetricsSnapshotRuntimePromise = createGlobalMetricsSnapshotRuntime();
  }

  return globalMetricsSnapshotRuntimePromise;
}

function readOptionalTrimmedEnv(env: NodeJS.ProcessEnv, name: string): string | null {
  const value = env[name];
  if (value === undefined || value.trim() === "") {
    return null;
  }

  return value.trim();
}

function createGlobalMetricsSnapshotFailureDetails(error: Error): GlobalMetricsSnapshotFailureDetails {
  return {
    bucketName: readOptionalTrimmedEnv(process.env, "GLOBAL_METRICS_S3_BUCKET_NAME"),
    objectKey: readOptionalTrimmedEnv(process.env, "GLOBAL_METRICS_S3_OBJECT_KEY"),
    message: error.message,
  };
}

const globalMetricsSnapshotHandler: Handler<
  unknown,
  GlobalMetricsSnapshotResponse
> = async (_event, context) => {
  const observationScope = createBackendObservationScope(
    "global-metrics-snapshot",
    context.awsRequestId ?? null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
  );
  try {
    const runtime = await getGlobalMetricsSnapshotRuntime();
    const result = await runtime.generateAndWriteGlobalMetricsSnapshot(observationScope);

    addBackendBreadcrumb({
      action: "global_metrics_snapshot_generated",
      scope: observationScope,
      details: {
        bucketName: result.bucketName,
        objectKey: result.objectKey,
        generatedAtUtc: result.snapshot.generatedAtUtc,
        asOfUtc: result.snapshot.asOfUtc,
        from: result.snapshot.from,
        to: result.snapshot.to,
        uniqueReviewingUsers: result.snapshot.totals.uniqueReviewingUsers,
        reviewEvents: result.snapshot.totals.reviewEvents.total,
      },
    });

    return {
      ok: true,
      bucketName: result.bucketName,
      objectKey: result.objectKey,
      generatedAtUtc: result.snapshot.generatedAtUtc,
      asOfUtc: result.snapshot.asOfUtc,
      from: result.snapshot.from,
      to: result.snapshot.to,
    };
  } catch (error) {
    const normalizedError = normalizeCaughtError(error);
    captureBackendException({
      action: "global_metrics_snapshot_failed",
      error: normalizedError,
      scope: observationScope,
      details: createGlobalMetricsSnapshotFailureDetails(normalizedError),
    });
    throw error;
  }
};

export const handler = wrapBackendHandler(globalMetricsSnapshotHandler);
