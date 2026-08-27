import * as cdk from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as scheduler from "aws-cdk-lib/aws-scheduler";
import { Construct } from "constructs";
import * as path from "path";
import { infraAwsNodejsProjectPaths } from "../nodejs-project-paths";

export interface PublicEndpointHeartbeatProps {
  baseDomain: string;
}

export interface PublicEndpointHeartbeatResult {
  heartbeatFunction: lambdaNodejs.NodejsFunction;
}

export interface PublicEndpointHeartbeatTarget {
  // Construct-id fragment shared by this host's schedule-side and alarm-side constructs.
  readonly id: string;
  readonly host: string;
  readonly probeUrl: string;
}

export const publicEndpointHeartbeatMetricNamespace = "FlashcardsOpenSourceApp/PublicEndpointHeartbeat";
export const publicEndpointHeartbeatMetricName = "PublicEndpointReachable";
export const publicEndpointHeartbeatMetricHostDimensionName = "Host";
export const publicEndpointHeartbeatIntervalMinutes = 5;
// Sized for the slowest target rather than the fastest: `https://api.<domain>/v1/health` runs a
// real query against RDS from a VPC-attached Lambda, so a cold start there loads a Secrets
// Manager secret and opens a TLS Postgres connection before answering, which a tighter bound
// would score as unreachable. The probes run concurrently, so the whole invocation still costs
// about this timeout plus the CloudWatch publish, far inside the 30 second function timeout and
// the five minute cadence.
export const publicEndpointHeartbeatRequestTimeoutSeconds = 10;

const publicEndpointHeartbeatScheduleExpression = `rate(${publicEndpointHeartbeatIntervalMinutes} minutes)`;

const heartbeatBundling: lambdaNodejs.BundlingOptions = {
  minify: true,
  sourceMap: true,
};

// Each probe URL is the unauthenticated GET the post-deploy checks already treat as proof that
// the host is serving: `scripts/checks/check-public-endpoints.sh` for the api and auth hosts,
// and `scripts/checks/check-mcp-smoke.sh` for the mcp host. All three answer HTTP 200.
export function createPublicEndpointHeartbeatTargets(
  baseDomain: string,
): ReadonlyArray<PublicEndpointHeartbeatTarget> {
  return [
    { id: "Api", host: `api.${baseDomain}`, probeUrl: `https://api.${baseDomain}/v1/health` },
    { id: "Auth", host: `auth.${baseDomain}`, probeUrl: `https://auth.${baseDomain}/health` },
    { id: "Mcp", host: `mcp.${baseDomain}`, probeUrl: `https://mcp.${baseDomain}/health` },
  ];
}

// Deliberately outside the VPC: the probes have to leave through the public internet and reach
// the same Cloudflare CNAME, TLS certificate and API Gateway custom domain a real client uses,
// and the private subnets have no NAT path.
export function publicEndpointHeartbeat(
  scope: Construct,
  props: PublicEndpointHeartbeatProps,
): PublicEndpointHeartbeatResult {
  const targets = createPublicEndpointHeartbeatTargets(props.baseDomain);

  const heartbeatFunction = new lambdaNodejs.NodejsFunction(scope, "PublicEndpointHeartbeatHandler", {
    entry: path.join(__dirname, "../../lambda/public-endpoint-heartbeat/index.ts"),
    handler: "handler",
    runtime: lambda.Runtime.NODEJS_24_X,
    timeout: cdk.Duration.seconds(30),
    memorySize: 256,
    bundling: heartbeatBundling,
    environment: {
      PUBLIC_ENDPOINT_HEARTBEAT_TARGETS: JSON.stringify(
        targets.map((target) => ({ host: target.host, probeUrl: target.probeUrl })),
      ),
      PUBLIC_ENDPOINT_HEARTBEAT_METRIC_NAMESPACE: publicEndpointHeartbeatMetricNamespace,
      PUBLIC_ENDPOINT_HEARTBEAT_METRIC_NAME: publicEndpointHeartbeatMetricName,
      PUBLIC_ENDPOINT_HEARTBEAT_METRIC_HOST_DIMENSION_NAME: publicEndpointHeartbeatMetricHostDimensionName,
      PUBLIC_ENDPOINT_HEARTBEAT_REQUEST_TIMEOUT_SECONDS: publicEndpointHeartbeatRequestTimeoutSeconds.toString(),
    },
    ...infraAwsNodejsProjectPaths,
  });

  heartbeatFunction.addToRolePolicy(new iam.PolicyStatement({
    actions: ["cloudwatch:PutMetricData"],
    resources: ["*"],
  }));

  const heartbeatInvokeRole = new iam.Role(scope, "PublicEndpointHeartbeatSchedulerRole", {
    assumedBy: new iam.ServicePrincipal("scheduler.amazonaws.com"),
  });
  heartbeatInvokeRole.addToPolicy(new iam.PolicyStatement({
    actions: ["lambda:InvokeFunction"],
    resources: [heartbeatFunction.functionArn],
  }));

  new scheduler.CfnSchedule(scope, "PublicEndpointHeartbeatSchedule", {
    description: `Probe the public api, auth and mcp hosts every ${publicEndpointHeartbeatIntervalMinutes} minutes`,
    flexibleTimeWindow: { mode: "OFF" },
    scheduleExpression: publicEndpointHeartbeatScheduleExpression,
    scheduleExpressionTimezone: "UTC",
    state: "ENABLED",
    target: {
      arn: heartbeatFunction.functionArn,
      input: "{}",
      roleArn: heartbeatInvokeRole.roleArn,
    },
  });

  return { heartbeatFunction };
}
