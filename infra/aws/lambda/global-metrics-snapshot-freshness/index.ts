import { CloudWatchClient, PutMetricDataCommand } from "@aws-sdk/client-cloudwatch";
import { HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";

type FreshnessCheckerConfig = Readonly<{
  bucketName: string;
  objectKey: string;
  metricNamespace: string;
  metricName: string;
  metricDimensionName: string;
  metricDimensionValue: string;
  maxAgeHours: number;
}>;

type FreshnessCheckResult = Readonly<{
  ok: true;
  bucketName: string;
  objectKey: string;
  lastModifiedUtc: string;
  snapshotAgeHours: number;
  maxAgeHours: number;
}>;

const millisecondsPerHour = 60 * 60 * 1000;
const s3Client = new S3Client({});
const cloudWatchClient = new CloudWatchClient({});

function getRequiredEnv(envName: string): string {
  const value = process.env[envName];
  if (value === undefined || value.trim() === "") {
    throw new Error(`${envName} is required for the global metrics snapshot freshness checker.`);
  }

  return value.trim();
}

function parseRequiredPositiveNumber(value: string, envName: string): number {
  const parsedValue = Number(value);
  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    throw new Error(`${envName} must be a positive number, received ${value}.`);
  }

  return parsedValue;
}

function loadFreshnessCheckerConfig(): FreshnessCheckerConfig {
  return {
    bucketName: getRequiredEnv("GLOBAL_METRICS_S3_BUCKET_NAME"),
    objectKey: getRequiredEnv("GLOBAL_METRICS_S3_OBJECT_KEY"),
    metricNamespace: getRequiredEnv("GLOBAL_METRICS_FRESHNESS_METRIC_NAMESPACE"),
    metricName: getRequiredEnv("GLOBAL_METRICS_FRESHNESS_METRIC_NAME"),
    metricDimensionName: getRequiredEnv("GLOBAL_METRICS_FRESHNESS_METRIC_STACK_DIMENSION_NAME"),
    metricDimensionValue: getRequiredEnv("GLOBAL_METRICS_FRESHNESS_METRIC_STACK_DIMENSION_VALUE"),
    maxAgeHours: parseRequiredPositiveNumber(
      getRequiredEnv("GLOBAL_METRICS_FRESHNESS_MAX_AGE_HOURS"),
      "GLOBAL_METRICS_FRESHNESS_MAX_AGE_HOURS",
    ),
  };
}

function roundToThreeDecimalPlaces(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function toIsoTimestamp(value: Date): string {
  return value.toISOString();
}

function formatErrorSummary(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }

  return String(error);
}

async function loadSnapshotLastModifiedUtc(config: FreshnessCheckerConfig): Promise<Date> {
  try {
    const response = await s3Client.send(new HeadObjectCommand({
      Bucket: config.bucketName,
      Key: config.objectKey,
    }));

    const lastModified = response.LastModified;
    if (!(lastModified instanceof Date) || Number.isNaN(lastModified.getTime())) {
      throw new Error(
        `S3 did not return a valid LastModified value for s3://${config.bucketName}/${config.objectKey}.`,
      );
    }

    return lastModified;
  } catch (error) {
    throw new Error(
      `Failed to read metadata for s3://${config.bucketName}/${config.objectKey}: ${formatErrorSummary(error)}`,
    );
  }
}

async function publishSnapshotAgeMetric(
  config: FreshnessCheckerConfig,
  snapshotAgeHours: number,
): Promise<void> {
  try {
    await cloudWatchClient.send(new PutMetricDataCommand({
      Namespace: config.metricNamespace,
      MetricData: [{
        MetricName: config.metricName,
        Dimensions: [{
          Name: config.metricDimensionName,
          Value: config.metricDimensionValue,
        }],
        Timestamp: new Date(),
        Value: snapshotAgeHours,
      }],
    }));
  } catch (error) {
    throw new Error(
      `Failed to publish CloudWatch metric ${config.metricNamespace}/${config.metricName} ` +
      `for ${config.metricDimensionName}=${config.metricDimensionValue}: ${formatErrorSummary(error)}`,
    );
  }
}

function calculateSnapshotAgeHours(lastModifiedUtc: Date, nowUtc: Date): number {
  const ageMilliseconds = nowUtc.getTime() - lastModifiedUtc.getTime();
  return roundToThreeDecimalPlaces(ageMilliseconds / millisecondsPerHour);
}

export async function handler(): Promise<FreshnessCheckResult> {
  const config = loadFreshnessCheckerConfig();
  const lastModifiedUtc = await loadSnapshotLastModifiedUtc(config);
  const snapshotAgeHours = calculateSnapshotAgeHours(lastModifiedUtc, new Date());

  await publishSnapshotAgeMetric(config, snapshotAgeHours);

  console.log(JSON.stringify({
    domain: "infra",
    action: "global_metrics_snapshot_freshness_checked",
    bucketName: config.bucketName,
    objectKey: config.objectKey,
    lastModifiedUtc: toIsoTimestamp(lastModifiedUtc),
    snapshotAgeHours,
    maxAgeHours: config.maxAgeHours,
    metricNamespace: config.metricNamespace,
    metricName: config.metricName,
    metricDimensionName: config.metricDimensionName,
    metricDimensionValue: config.metricDimensionValue,
  }));

  return {
    ok: true,
    bucketName: config.bucketName,
    objectKey: config.objectKey,
    lastModifiedUtc: toIsoTimestamp(lastModifiedUtc),
    snapshotAgeHours,
    maxAgeHours: config.maxAgeHours,
  };
}
