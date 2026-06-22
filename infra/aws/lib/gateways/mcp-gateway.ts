import * as cdk from "aws-cdk-lib";
import * as apigw from "aws-cdk-lib/aws-apigateway";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as rds from "aws-cdk-lib/aws-rds";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import { Construct } from "constructs";
import { createSafeApiGatewayAccessLogFormat } from "./api-gateway-access-log";
import { backendNodejsProjectPaths, resolveFromRepoRoot } from "../nodejs-project-paths";

export interface McpGatewayProps {
  vpc: ec2.Vpc;
  lambdaSg: ec2.SecurityGroup;
  db: rds.DatabaseInstance;
  backendDbSecret: cdk.aws_secretsmanager.Secret;
  baseDomain: string;
  mcpCertificateArn: string | undefined;
  sentryDsnSecretArn: string | undefined;
  sentryEnvironment: string | undefined;
  sentryRelease: string | undefined;
  sentryTracesSampleRate: string | undefined;
}

export interface McpGatewayResult {
  restApi: apigw.RestApi;
  mcpFn: lambdaNodejs.NodejsFunction;
  accessLogGroup: logs.LogGroup;
}

const lambdaBundling: lambdaNodejs.BundlingOptions = {
  minify: true,
  sourceMap: true,
  commandHooks: {
    beforeBundling: () => [],
    beforeInstall: () => [],
    afterBundling: (_inputDir: string, outputDir: string) => [
      `curl -sfo ${outputDir}/rds-global-bundle.pem https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem`,
    ],
  },
};

function hasConfiguredValue(value: string | undefined): value is string {
  return value !== undefined && value !== "";
}

function addOptionalSentryEnvironment(
  scope: Construct,
  fn: lambdaNodejs.NodejsFunction,
  props: McpGatewayProps,
): void {
  if (!hasConfiguredValue(props.sentryDsnSecretArn)) {
    return;
  }
  if (
    !hasConfiguredValue(props.sentryEnvironment) ||
    !hasConfiguredValue(props.sentryRelease) ||
    !hasConfiguredValue(props.sentryTracesSampleRate)
  ) {
    throw new Error("sentryEnvironment, sentryRelease, and sentryTracesSampleRate are required when sentryDsnSecretArn is configured");
  }

  const tracesSampleRate = Number(props.sentryTracesSampleRate);
  if (!Number.isFinite(tracesSampleRate) || tracesSampleRate < 0 || tracesSampleRate > 1) {
    throw new Error("sentryTracesSampleRate must be a number between 0 and 1");
  }

  const secret = cdk.aws_secretsmanager.Secret.fromSecretCompleteArn(
    scope,
    "McpHandlerSentryDsnSecret",
    props.sentryDsnSecretArn,
  );
  secret.grantRead(fn);
  fn.addEnvironment("SENTRY_DSN", secret.secretValue.unsafeUnwrap());
  fn.addEnvironment("SENTRY_ENVIRONMENT", props.sentryEnvironment);
  fn.addEnvironment("SENTRY_RELEASE", props.sentryRelease);
  fn.addEnvironment("SENTRY_TRACES_SAMPLE_RATE", props.sentryTracesSampleRate);
}

export function mcpGateway(scope: Construct, props: McpGatewayProps): McpGatewayResult {
  const mcpFn = new lambdaNodejs.NodejsFunction(scope, "McpHandler", {
    entry: resolveFromRepoRoot("apps", "backend", "src", "entrypoints", "lambda-mcp.ts"),
    handler: "handler",
    runtime: lambda.Runtime.NODEJS_24_X,
    timeout: cdk.Duration.seconds(30),
    memorySize: 256,
    vpc: props.vpc,
    vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
    securityGroups: [props.lambdaSg],
    ...backendNodejsProjectPaths,
    bundling: lambdaBundling,
    environment: {
      NODE_EXTRA_CA_CERTS: "/var/task/rds-global-bundle.pem",
      DB_SECRET_ARN: props.backendDbSecret.secretArn,
      DB_HOST: props.db.dbInstanceEndpointAddress,
      DB_NAME: "flashcards",
      MCP_BASE_DOMAIN: props.baseDomain,
      // The MCP sql tool returns the shared agent envelope; pin the docs base to
      // the public API host so `docs.openapiUrl` matches `/agent/sql` instead of
      // resolving against the mcp.<domain> request host.
      PUBLIC_API_BASE_URL: `https://api.${props.baseDomain}/v1`,
    },
  });

  props.backendDbSecret.grantRead(mcpFn);
  addOptionalSentryEnvironment(scope, mcpFn, props);

  const accessLogGroup = new logs.LogGroup(scope, "McpApiAccessLogGroup", {
    retention: logs.RetentionDays.ONE_WEEK,
  });

  const restApi = new apigw.RestApi(scope, "McpApi", {
    restApiName: "flashcards-open-source-app-mcp",
    description: "Public MCP API exposing OAuth Protected Resource Metadata and the MCP transport",
    deployOptions: {
      stageName: "v1",
      throttlingRateLimit: 20,
      throttlingBurstLimit: 40,
      metricsEnabled: true,
      dataTraceEnabled: false,
      tracingEnabled: false,
      accessLogDestination: new apigw.LogGroupLogDestination(accessLogGroup),
      accessLogFormat: createSafeApiGatewayAccessLogFormat(),
    },
  });

  const integration = new apigw.LambdaIntegration(mcpFn);

  // API Gateway must know each public path ahead of time, or requests will
  // fail at the edge with MissingAuthenticationTokenException before Lambda
  // runs. Keep this list aligned with the routes in lambda-mcp.ts.
  const wellKnown = restApi.root.addResource(".well-known");
  const protectedResource = wellKnown.addResource("oauth-protected-resource");
  protectedResource.addMethod("GET", integration);
  // RFC 9728 §3.1 path-aware PRM location for the `/mcp` resource path.
  protectedResource.addResource("mcp").addMethod("GET", integration);

  restApi.root.addResource("mcp").addMethod("ANY", integration);
  restApi.root.addResource("health").addMethod("GET", integration);

  if (props.mcpCertificateArn) {
    const mcpDomainName = `mcp.${props.baseDomain}`;
    const certificate = cdk.aws_certificatemanager.Certificate.fromCertificateArn(
      scope,
      "McpCertificate",
      props.mcpCertificateArn,
    );

    // No base path mapping: the canonical resource is https://mcp.<domain>/mcp
    // served directly from the custom domain root.
    const domain = restApi.addDomainName("McpCustomDomain", {
      domainName: mcpDomainName,
      certificate,
      endpointType: apigw.EndpointType.REGIONAL,
    });

    new cdk.CfnOutput(scope, "McpCustomDomainTarget", {
      value: domain.domainNameAliasDomainName,
      description: "Create a Cloudflare CNAME for mcp.<domain> to this target",
    });
  }

  return { restApi, mcpFn, accessLogGroup };
}
