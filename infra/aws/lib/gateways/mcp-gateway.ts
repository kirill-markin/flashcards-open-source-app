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
import { backendStructuredLoggingProps } from "../backend-lambda-logging";
import {
  databasePoolMaxConnectionsEnvName,
  databasePoolMaxConnectionsEnvValue,
  mcpHandlerReservedConcurrency,
} from "../lambda-database-capacity";
import { resolveMcpAlternateHost } from "../mcp-alternate-host";
import { parsePublicOrigin } from "../public-origin";
import { createRdsCaBundleDownloadCommand } from "../rds-ca-bundle";

export interface McpGatewayProps {
  vpc: ec2.Vpc;
  lambdaSg: ec2.SecurityGroup;
  db: rds.DatabaseInstance;
  backendDbSecret: cdk.aws_secretsmanager.Secret;
  baseDomain: string;
  siteBaseUrl: string | undefined;
  // Where backend-generated links to the web app point, resolved once by the
  // stack so no consumer derives a host of its own. The card_authoring guide
  // that get_guide serves names it in the card web link it hands the agent.
  publicAppOrigin: string;
  // Optional per-deploy override for the API origin the MCP tools advertise.
  // Unset means api.<baseDomain>, exactly as before it was settable.
  apiBaseUrl: string | undefined;
  mcpCertificateArn: string | undefined;
  // Optional second public MCP host, served by the same API. Both values must be
  // set together; with either one missing the stack stays exactly as it is today.
  mcpAlternateDomainName: string | undefined;
  mcpAlternateCertificateArn: string | undefined;
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
  constructIdSuffix: string;
  apiMappingKey: string;
}

// Each custom domain needs its own mapping construct ids. The primary prefix
// reproduces the already deployed ids byte for byte, so adding a second host
// never renames or replaces an existing mapping.
export const primaryMcpHttpApiMappingConstructIdPrefix = "McpHttp";
export const alternateMcpHttpApiMappingConstructIdPrefix = "McpAlternateHttp";

const mcpHttpApiMappings: ReadonlyArray<McpHttpApiMapping> = [
  {
    constructIdSuffix: "McpApiMapping",
    apiMappingKey: "mcp",
  },
  {
    constructIdSuffix: "HealthApiMapping",
    apiMappingKey: "health",
  },
  {
    constructIdSuffix: "RobotsApiMapping",
    apiMappingKey: "robots.txt",
  },
  {
    constructIdSuffix: "ProtectedResourceApiMapping",
    apiMappingKey: ".well-known/oauth-protected-resource",
  },
  {
    constructIdSuffix: "ProtectedResourceMcpApiMapping",
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
      createRdsCaBundleDownloadCommand(outputDir),
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
  constructIdPrefix: string,
): void {
  const apiMapping = new apigwv2.CfnApiMapping(scope, `${constructIdPrefix}${mapping.constructIdSuffix}`, {
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
  constructIdPrefix: string,
  publicHost: string,
): void {
  for (const mapping of mcpHttpApiMappings) {
    addHttpApiMapping(scope, domainName, httpApi, httpStage, mapping, dependencies, constructIdPrefix);
  }
  // domainName is a CloudFormation Ref; select the proof using the configured public hostname.
  if (publicHost === "mcp.nibomo.com") {
    addHttpApiMapping(scope, domainName, httpApi, httpStage, {
      constructIdSuffix: "OpenAiAppsChallengeApiMapping",
      apiMappingKey: ".well-known/openai-apps-challenge",
    }, dependencies, constructIdPrefix);
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
  httpApi.addRoutes({
    path: "/robots.txt",
    methods: [apigwv2.HttpMethod.GET],
    integration,
  });
}

export function mcpGateway(scope: Construct, props: McpGatewayProps): McpGatewayResult {
  // Resolved once here: the same host is the custom domain below, the host the
  // handler accepts, and the host it names in its protected-resource metadata.
  // Throws AlternateHostConflictError at synth time when it names a host this
  // stack already serves.
  const mcpAlternateHost = resolveMcpAlternateHost(
    props.baseDomain,
    props.mcpAlternateDomainName,
    props.mcpAlternateCertificateArn,
  );
  const publicApiOrigin = parsePublicOrigin(
    props.apiBaseUrl ?? `https://api.${props.baseDomain}`,
    "apiBaseUrl",
  );

  const mcpFn = new lambdaNodejs.NodejsFunction(scope, "McpHandler", {
    entry: resolveFromRepoRoot("apps", "backend", "src", "entrypoints", "lambda-mcp.ts"),
    handler: "handler",
    runtime: lambda.Runtime.NODEJS_24_X,
    timeout: cdk.Duration.seconds(30),
    memorySize: 256,
    // Share of the Postgres connection budget documented in ../lambda-database-capacity.ts.
    reservedConcurrentExecutions: mcpHandlerReservedConcurrency,
    ...backendStructuredLoggingProps,
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
      [databasePoolMaxConnectionsEnvName]: databasePoolMaxConnectionsEnvValue,
      MCP_BASE_DOMAIN: props.baseDomain,
      // The MCP sql_query and sql_execute tools return the shared agent
      // envelope; pin `docs.discoveryUrl` to the public API host instead of
      // resolving it against the mcp.<domain> request host.
      PUBLIC_API_BASE_URL: `${publicApiOrigin}/v1`,
      // Public marketing-site origin surfaced in the MCP implementation
      // metadata (websiteUrl). Defaults to the apex domain; an optional CDK
      // `siteBaseUrl` context overrides it for self-host deployments.
      PUBLIC_SITE_BASE_URL: props.siteBaseUrl ?? `https://${props.baseDomain}`,
      // Origin of the card web link stated in the card_authoring guide that
      // get_guide serves.
      PUBLIC_APP_BASE_URL: props.publicAppOrigin,
      // Second public MCP host the handler may answer as. Absent unless both
      // alternate context values are set, so the deployed environment of every
      // other deployment is unchanged.
      ...(mcpAlternateHost === undefined ? {} : { MCP_ALTERNATE_HOST: mcpAlternateHost }),
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

  // Second public host for the same MCP API. It is additive: the primary
  // mcp.<baseDomain> domain above is created and mapped regardless.
  let alternateCustomDomain: apigw.DomainName | undefined;
  if (mcpAlternateHost !== undefined && hasConfiguredValue(props.mcpAlternateCertificateArn)) {
    const alternateCertificate = cdk.aws_certificatemanager.Certificate.fromCertificateArn(
      scope,
      "McpAlternateCertificate",
      props.mcpAlternateCertificateArn,
    );

    alternateCustomDomain = restApi.addDomainName("McpAlternateCustomDomain", {
      domainName: mcpAlternateHost,
      certificate: alternateCertificate,
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
    addMcpHttpApiMappings(scope, customDomain.domainName, httpApi, httpStage, [customDomain, httpStage], primaryMcpHttpApiMappingConstructIdPrefix, `mcp.${props.baseDomain}`);

    new cdk.CfnOutput(scope, "McpCustomDomainTarget", {
      value: customDomain.domainNameAliasDomainName,
      description: "Create a Cloudflare CNAME for mcp.<domain> to this target",
    });
  }

  if (alternateCustomDomain !== undefined && mcpAlternateHost !== undefined) {
    addMcpHttpApiMappings(scope, alternateCustomDomain.domainName, httpApi, httpStage, [alternateCustomDomain, httpStage], alternateMcpHttpApiMappingConstructIdPrefix, mcpAlternateHost);

    new cdk.CfnOutput(scope, "McpAlternateCustomDomainTarget", {
      value: alternateCustomDomain.domainNameAliasDomainName,
      description: "Create a Cloudflare CNAME for the alternate MCP host to this target",
    });
  }

  return { httpApi, httpStage, mcpFn, accessLogGroup };
}
