import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { HttpError } from "../errors";
import { parseGlobalMetricsSnapshotJson, type GlobalMetricsSnapshot } from "./snapshot";

export type GlobalMetricsStorageConfig = Readonly<{
  bucketName: string;
  objectKey: string;
}>;

export type GlobalMetricsSnapshotWriteResult = Readonly<{
  bucketName: string;
  objectKey: string;
  snapshot: GlobalMetricsSnapshot;
}>;

type LoadGlobalMetricsSnapshotDependencies = Readonly<{
  s3Client: S3Client;
  getGlobalMetricsStorageConfigFn: typeof getGlobalMetricsStorageConfig;
  parseGlobalMetricsSnapshotJsonFn: typeof parseGlobalMetricsSnapshotJson;
}>;

type WriteGlobalMetricsSnapshotDependencies = Readonly<{
  s3Client: S3Client;
  getGlobalMetricsStorageConfigFn: typeof getGlobalMetricsStorageConfig;
}>;

const maxS3AttemptCount = 3;

let globalMetricsS3Client: S3Client | undefined;

function getGlobalMetricsS3Client(): S3Client {
  if (globalMetricsS3Client !== undefined) {
    return globalMetricsS3Client;
  }

  globalMetricsS3Client = new S3Client({});
  return globalMetricsS3Client;
}

export function isGlobalMetricsVisible(): boolean {
  return process.env.GLOBAL_METRICS_VISIBLE === "true";
}

function getRequiredGlobalMetricsEnv(envName: string): string {
  const value = process.env[envName];
  if (value === undefined || value.trim() === "") {
    throw new Error(`${envName} is required for global metrics storage.`);
  }

  return value.trim();
}

export function getGlobalMetricsStorageConfig(): GlobalMetricsStorageConfig {
  return {
    bucketName: getRequiredGlobalMetricsEnv("GLOBAL_METRICS_S3_BUCKET_NAME"),
    objectKey: getRequiredGlobalMetricsEnv("GLOBAL_METRICS_S3_OBJECT_KEY"),
  };
}

function getS3ErrorStatusCode(error: unknown): number | null {
  if (typeof error !== "object" || error === null || !("$metadata" in error)) {
    return null;
  }

  const metadata = (error as Readonly<{
    $metadata?: Readonly<{
      httpStatusCode?: unknown;
    }>;
  }>).$metadata;

  return typeof metadata?.httpStatusCode === "number" ? metadata.httpStatusCode : null;
}

function getS3ErrorName(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}

function getS3ErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatS3ErrorSummary(error: unknown): string {
  const errorName = getS3ErrorName(error);
  const errorMessage = getS3ErrorMessage(error);
  const statusCode = getS3ErrorStatusCode(error);
  const statusSuffix = statusCode === null ? "" : ` status=${statusCode}`;
  return `${errorName}${statusSuffix}: ${errorMessage}`;
}

async function runS3OperationWithRetries<Result>(params: Readonly<{
  operation: "get_object" | "put_object";
  bucketName: string;
  objectKey: string;
  run: () => Promise<Result>;
}>): Promise<Result> {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxS3AttemptCount; attempt += 1) {
    try {
      return await params.run();
    } catch (error) {
      lastError = error;
      if (attempt === maxS3AttemptCount) {
        break;
      }

      console.warn(JSON.stringify({
        domain: "backend",
        action: "global_metrics_s3_retry",
        operation: params.operation,
        attempt,
        bucketName: params.bucketName,
        objectKey: params.objectKey,
        errorName: getS3ErrorName(error),
        errorMessage: getS3ErrorMessage(error),
        statusCode: getS3ErrorStatusCode(error),
      }));
    }
  }

  if (lastError === null) {
    throw new Error(
      `S3 ${params.operation} failed without an error for s3://${params.bucketName}/${params.objectKey}.`,
    );
  }

  throw lastError;
}

function createGlobalMetricsSnapshotUnavailableError(
  config: GlobalMetricsStorageConfig | null,
  error: unknown,
): HttpError {
  const location = config === null
    ? "global metrics storage"
    : `s3://${config.bucketName}/${config.objectKey}`;
  return new HttpError(
    503,
    `Global metrics snapshot is unavailable from ${location}: ${formatS3ErrorSummary(error)}`,
    "GLOBAL_METRICS_SNAPSHOT_UNAVAILABLE",
  );
}

export async function loadGlobalMetricsSnapshotFromS3WithDependencies(
  dependencies: LoadGlobalMetricsSnapshotDependencies,
): Promise<GlobalMetricsSnapshot> {
  let config: GlobalMetricsStorageConfig | null = null;

  try {
    const resolvedConfig = dependencies.getGlobalMetricsStorageConfigFn();
    config = resolvedConfig;
    const response = await runS3OperationWithRetries({
      operation: "get_object",
      bucketName: resolvedConfig.bucketName,
      objectKey: resolvedConfig.objectKey,
      run: async () => dependencies.s3Client.send(new GetObjectCommand({
        Bucket: resolvedConfig.bucketName,
        Key: resolvedConfig.objectKey,
      })),
    });

    if (response.Body === undefined) {
      throw new Error(`S3 returned an empty body for s3://${resolvedConfig.bucketName}/${resolvedConfig.objectKey}`);
    }

    const bodyText = await response.Body.transformToString();
    return dependencies.parseGlobalMetricsSnapshotJsonFn(bodyText);
  } catch (error) {
    throw createGlobalMetricsSnapshotUnavailableError(config, error);
  }
}

export async function loadGlobalMetricsSnapshotFromS3(): Promise<GlobalMetricsSnapshot> {
  return loadGlobalMetricsSnapshotFromS3WithDependencies({
    s3Client: getGlobalMetricsS3Client(),
    getGlobalMetricsStorageConfigFn: getGlobalMetricsStorageConfig,
    parseGlobalMetricsSnapshotJsonFn: parseGlobalMetricsSnapshotJson,
  });
}

export async function writeGlobalMetricsSnapshotToS3WithDependencies(
  snapshot: GlobalMetricsSnapshot,
  dependencies: WriteGlobalMetricsSnapshotDependencies,
): Promise<GlobalMetricsSnapshotWriteResult> {
  const config = dependencies.getGlobalMetricsStorageConfigFn();

  try {
    await runS3OperationWithRetries({
      operation: "put_object",
      bucketName: config.bucketName,
      objectKey: config.objectKey,
      run: async () => dependencies.s3Client.send(new PutObjectCommand({
        Bucket: config.bucketName,
        Key: config.objectKey,
        Body: JSON.stringify(snapshot),
        ContentType: "application/json; charset=utf-8",
      })),
    });
  } catch (error) {
    throw new Error(
      `Failed to write global metrics snapshot to s3://${config.bucketName}/${config.objectKey}: ${formatS3ErrorSummary(error)}`,
    );
  }

  return {
    bucketName: config.bucketName,
    objectKey: config.objectKey,
    snapshot,
  };
}

export async function writeGlobalMetricsSnapshotToS3(
  snapshot: GlobalMetricsSnapshot,
): Promise<GlobalMetricsSnapshotWriteResult> {
  return writeGlobalMetricsSnapshotToS3WithDependencies(snapshot, {
    s3Client: getGlobalMetricsS3Client(),
    getGlobalMetricsStorageConfigFn: getGlobalMetricsStorageConfig,
  });
}
