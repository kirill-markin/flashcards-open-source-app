import { CloudWatchClient, MetricDatum, PutMetricDataCommand } from "@aws-sdk/client-cloudwatch";

type HeartbeatTarget = Readonly<{
  host: string;
  probeUrl: string;
}>;

type HeartbeatConfig = Readonly<{
  targets: ReadonlyArray<HeartbeatTarget>;
  metricNamespace: string;
  metricName: string;
  metricHostDimensionName: string;
  requestTimeoutMilliseconds: number;
}>;

type HeartbeatProbeResult = Readonly<{
  host: string;
  probeUrl: string;
  reachable: boolean;
  statusCode: number | undefined;
  durationMilliseconds: number;
  failureReason: string | undefined;
}>;

type PublicEndpointHeartbeatResult = Readonly<{
  ok: true;
  probes: ReadonlyArray<HeartbeatProbeResult>;
}>;

const expectedStatusCode = 200;
const reachableMetricValue = 1;
const unreachableMetricValue = 0;
const millisecondsPerSecond = 1000;
const cloudWatchClient = new CloudWatchClient({});

function getRequiredEnv(envName: string): string {
  const value = process.env[envName];
  if (value === undefined || value.trim() === "") {
    throw new Error(`${envName} is required for the public endpoint heartbeat.`);
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

function parseRequiredString(value: unknown, fieldPath: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${fieldPath} must be a non-empty string, received ${JSON.stringify(value)}.`);
  }

  return value.trim();
}

function parseHeartbeatTargets(rawTargets: string, envName: string): ReadonlyArray<HeartbeatTarget> {
  let parsedTargets: unknown;
  try {
    parsedTargets = JSON.parse(rawTargets);
  } catch (error) {
    throw new Error(`${envName} must be valid JSON, received ${rawTargets}: ${formatErrorSummary(error)}`);
  }

  if (!Array.isArray(parsedTargets) || parsedTargets.length === 0) {
    throw new Error(`${envName} must be a non-empty JSON array, received ${rawTargets}.`);
  }

  return parsedTargets.map((entry: unknown, index: number): HeartbeatTarget => {
    if (typeof entry !== "object" || entry === null) {
      throw new Error(`${envName}[${index}] must be an object, received ${JSON.stringify(entry)}.`);
    }

    const target = entry as Record<string, unknown>;
    const probeUrl = parseRequiredString(target.probeUrl, `${envName}[${index}].probeUrl`);
    if (!probeUrl.startsWith("https://")) {
      throw new Error(`${envName}[${index}].probeUrl must be an https URL, received ${probeUrl}.`);
    }

    return {
      host: parseRequiredString(target.host, `${envName}[${index}].host`),
      probeUrl,
    };
  });
}

function loadHeartbeatConfig(): HeartbeatConfig {
  return {
    targets: parseHeartbeatTargets(
      getRequiredEnv("PUBLIC_ENDPOINT_HEARTBEAT_TARGETS"),
      "PUBLIC_ENDPOINT_HEARTBEAT_TARGETS",
    ),
    metricNamespace: getRequiredEnv("PUBLIC_ENDPOINT_HEARTBEAT_METRIC_NAMESPACE"),
    metricName: getRequiredEnv("PUBLIC_ENDPOINT_HEARTBEAT_METRIC_NAME"),
    metricHostDimensionName: getRequiredEnv("PUBLIC_ENDPOINT_HEARTBEAT_METRIC_HOST_DIMENSION_NAME"),
    requestTimeoutMilliseconds: parseRequiredPositiveNumber(
      getRequiredEnv("PUBLIC_ENDPOINT_HEARTBEAT_REQUEST_TIMEOUT_SECONDS"),
      "PUBLIC_ENDPOINT_HEARTBEAT_REQUEST_TIMEOUT_SECONDS",
    ) * millisecondsPerSecond,
  };
}

function formatErrorSummary(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }

  return String(error);
}

// Every transport, TLS, DNS and timeout failure is the exact signal this heartbeat exists to
// report, so it is turned into an unreachable result instead of an exception: an outage on one
// host must still leave the other hosts with a published datapoint.
// Redirects are not followed, matching the repository's own curl checks against these paths, so
// anything other than the host itself answering HTTP 200 counts as unreachable.
async function probeTarget(
  target: HeartbeatTarget,
  requestTimeoutMilliseconds: number,
): Promise<HeartbeatProbeResult> {
  const startedAtMilliseconds = Date.now();

  try {
    const response = await fetch(target.probeUrl, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(requestTimeoutMilliseconds),
    });
    await response.arrayBuffer();

    return {
      host: target.host,
      probeUrl: target.probeUrl,
      reachable: response.status === expectedStatusCode,
      statusCode: response.status,
      durationMilliseconds: Date.now() - startedAtMilliseconds,
      failureReason: response.status === expectedStatusCode
        ? undefined
        : `Expected HTTP ${expectedStatusCode}, received HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      host: target.host,
      probeUrl: target.probeUrl,
      reachable: false,
      statusCode: undefined,
      durationMilliseconds: Date.now() - startedAtMilliseconds,
      failureReason: formatErrorSummary(error),
    };
  }
}

function createMetricDatum(
  config: HeartbeatConfig,
  probe: HeartbeatProbeResult,
  timestamp: Date,
): MetricDatum {
  return {
    MetricName: config.metricName,
    Dimensions: [{
      Name: config.metricHostDimensionName,
      Value: probe.host,
    }],
    Timestamp: timestamp,
    Value: probe.reachable ? reachableMetricValue : unreachableMetricValue,
  };
}

async function publishReachabilityMetrics(
  config: HeartbeatConfig,
  probes: ReadonlyArray<HeartbeatProbeResult>,
): Promise<void> {
  const timestamp = new Date();

  try {
    await cloudWatchClient.send(new PutMetricDataCommand({
      Namespace: config.metricNamespace,
      MetricData: probes.map((probe) => createMetricDatum(config, probe, timestamp)),
    }));
  } catch (error) {
    throw new Error(
      `Failed to publish CloudWatch metric ${config.metricNamespace}/${config.metricName} ` +
      `for hosts ${probes.map((probe) => probe.host).join(", ")}: ${formatErrorSummary(error)}`,
    );
  }
}

export async function handler(): Promise<PublicEndpointHeartbeatResult> {
  const config = loadHeartbeatConfig();
  const probes = await Promise.all(
    config.targets.map((target) => probeTarget(target, config.requestTimeoutMilliseconds)),
  );

  await publishReachabilityMetrics(config, probes);

  console.log(JSON.stringify({
    domain: "infra",
    action: "public_endpoint_heartbeat_checked",
    metricNamespace: config.metricNamespace,
    metricName: config.metricName,
    metricHostDimensionName: config.metricHostDimensionName,
    requestTimeoutMilliseconds: config.requestTimeoutMilliseconds,
    probes,
  }));

  return { ok: true, probes };
}
