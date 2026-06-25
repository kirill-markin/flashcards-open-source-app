import * as cdk from "aws-cdk-lib";
import * as apigw from "aws-cdk-lib/aws-apigateway";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as apigwv2Integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as rds from "aws-cdk-lib/aws-rds";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import { Construct } from "constructs";
import {
  createSafeApiGatewayAccessLogFormat,
  createSafeHttpApiAccessLogFormat,
} from "./api-gateway-access-log";
import { backendNodejsProjectPaths, resolveFromRepoRoot } from "../nodejs-project-paths";

export interface McpGatewayProps {
  vpc: ec2.Vpc;
  lambdaSg: ec2.SecurityGroup;
  db: rds.DatabaseInstance;
  backendDbSecret: cdk.aws_secretsmanager.Secret;
  baseDomain: string;
  siteBaseUrl: string | undefined;
  mcpCertificateArn: string | undefined;
  sentryDsnSecretArn: string | undefined;
  sentryEnvironment: string | undefined;
  sentryRelease: string | undefined;
  sentryTracesSampleRate: string | undefined;
}

export interface McpGatewayResult {
  httpApi: apigwv2.HttpApi;
  httpStage: apigwv2.HttpStage;
  mcpFn: lambdaNodejs.NodejsFunction;
  accessLogGroup: logs.LogGroup;
}

interface McpHttpApiMapping {
  constructId: string;
  apiMappingKey: string;
}

const mcpHttpApiMappings: ReadonlyArray<McpHttpApiMapping> = [
  {
    constructId: "McpHttpMcpApiMapping",
    apiMappingKey: "mcp",
  },
  {
    constructId: "McpHttpHealthApiMapping",
    apiMappingKey: "health",
  },
  {
    constructId: "McpHttpProtectedResourceApiMapping",
    apiMappingKey: ".well-known/oauth-protected-resource",
  },
  {
    constructId: "McpHttpProtectedResourceMcpApiMapping",
    apiMappingKey: ".well-known/oauth-protected-resource/mcp",
  },
];

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

function addHttpApiMapping(
  scope: Construct,
  domainName: string,
  httpApi: apigwv2.HttpApi,
  httpStage: apigwv2.HttpStage,
  mapping: McpHttpApiMapping,
  dependencies: ReadonlyArray<Construct>,
): void {
  const apiMapping = new apigwv2.CfnApiMapping(scope, mapping.constructId, {
    domainName,
    apiId: httpApi.httpApiId,
    stage: httpStage.stageName,
    apiMappingKey: mapping.apiMappingKey,
  });
  for (const dependency of dependencies) {
    apiMapping.node.addDependency(dependency);
  }
}

export function addMcpHttpApiMappings(
  scope: Construct,
  domainName: string,
  httpApi: apigwv2.HttpApi,
  httpStage: apigwv2.HttpStage,
  dependencies: ReadonlyArray<Construct>,
): void {
  for (const mapping of mcpHttpApiMappings) {
    addHttpApiMapping(scope, domainName, httpApi, httpStage, mapping, dependencies);
  }
}

export function addMcpHttpApiRoutes(
  scope: Construct,
  httpApi: apigwv2.HttpApi,
  integration: apigwv2.HttpRouteIntegration,
): void {
  // Path-specific custom-domain API mappings are stripped for HTTP API route
  // selection. The Lambda payload stays format 1.0, so Hono still sees the
  // public mapped path while this default route guarantees Lambda is invoked.
  new apigwv2.HttpRoute(scope, "McpHttpDefaultRoute", {
    httpApi,
    routeKey: apigwv2.HttpRouteKey.DEFAULT,
    integration,
  });

  // Keep explicit routes for raw execute-api/stage traffic and for readability
  // in the API Gateway console.
  httpApi.addRoutes({
    path: "/.well-known/oauth-protected-resource",
    methods: [apigwv2.HttpMethod.GET],
    integration,
  });
  httpApi.addRoutes({
    path: "/.well-known/oauth-protected-resource/mcp",
    methods: [apigwv2.HttpMethod.GET],
    integration,
  });
  httpApi.addRoutes({
    path: "/mcp",
    methods: [apigwv2.HttpMethod.ANY],
    integration,
  });
  httpApi.addRoutes({
    path: "/health",
    methods: [apigwv2.HttpMethod.GET],
    integration,
  });
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
      // The MCP sql_query and sql_execute tools return the shared agent
      // envelope; pin the docs base to the public API host so `docs.openapiUrl`
      // matches `/agent/sql/query` and `/agent/sql/execute` instead of resolving
      // against the mcp.<domain> request host.
      PUBLIC_API_BASE_URL: `https://api.${props.baseDomain}/v1`,
      // Public marketing-site origin surfaced in the MCP implementation
      // metadata (websiteUrl). Defaults to the apex domain; an optional CDK
      // `siteBaseUrl` context overrides it for self-host deployments.
      PUBLIC_SITE_BASE_URL: props.siteBaseUrl ?? `https://${props.baseDomain}`,
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

  const restIntegration = new apigw.LambdaIntegration(mcpFn);

  // Keep the existing REST API and root custom-domain mapping during the HTTP
  // API migration so CloudFormation does not create a duplicate mcp.<domain>
  // custom domain. Path-specific HTTP API mappings below take precedence for
  // the public MCP routes.
  const wellKnown = restApi.root.addResource(".well-known");
  const protectedResource = wellKnown.addResource("oauth-protected-resource");
  protectedResource.addMethod("GET", restIntegration);
  protectedResource.addResource("mcp").addMethod("GET", restIntegration);

  restApi.root.addResource("mcp").addMethod("ANY", restIntegration);
  restApi.root.addResource("health").addMethod("GET", restIntegration);

  const httpApi = new apigwv2.HttpApi(scope, "McpHttpApi", {
    apiName: "flashcards-open-source-app-mcp-http",
    description: "Public MCP API exposing OAuth Protected Resource Metadata and the MCP transport",
    createDefaultStage: false,
  });

  const integration = new apigwv2Integrations.HttpLambdaIntegration("McpHttpLambdaIntegration", mcpFn, {
    // Format 1.0 keeps the mapped custom-domain path in event.path, which the
    // Hono Lambda adapter uses to match the public /mcp and /.well-known routes.
    payloadFormatVersion: apigwv2.PayloadFormatVersion.VERSION_1_0,
    timeout: cdk.Duration.seconds(29),
  });

  addMcpHttpApiRoutes(scope, httpApi, integration);

  let customDomain: apigw.DomainName | undefined;
  if (props.mcpCertificateArn) {
    const mcpDomainName = `mcp.${props.baseDomain}`;
    const certificate = cdk.aws_certificatemanager.Certificate.fromCertificateArn(
      scope,
      "McpCertificate",
      props.mcpCertificateArn,
    );

    customDomain = restApi.addDomainName("McpCustomDomain", {
      domainName: mcpDomainName,
      certificate,
      endpointType: apigw.EndpointType.REGIONAL,
    });
  }

  const httpStage = new apigwv2.HttpStage(scope, "McpHttpApiStage", {
    httpApi,
    stageName: "v1",
    autoDeploy: true,
    throttle: {
      rateLimit: 20,
      burstLimit: 40,
    },
    detailedMetricsEnabled: true,
    accessLogSettings: {
      destination: new apigwv2.LogGroupLogDestination(accessLogGroup),
      format: createSafeHttpApiAccessLogFormat(),
    },
  });

  if (customDomain !== undefined) {
    addMcpHttpApiMappings(scope, customDomain.domainName, httpApi, httpStage, [customDomain, httpStage]);

    new cdk.CfnOutput(scope, "McpCustomDomainTarget", {
      value: customDomain.domainNameAliasDomainName,
      description: "Create a Cloudflare CNAME for mcp.<domain> to this target",
    });
  }

  return { httpApi, httpStage, mcpFn, accessLogGroup };
}
