import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as rds from "aws-cdk-lib/aws-rds";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as apigw from "aws-cdk-lib/aws-apigateway";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";
import { backendNodejsProjectPaths, resolveFromRepoRoot } from "../nodejs-project-paths";
import { parsePublicOrigin } from "../public-origin";
import { createSafeApiGatewayAccessLogFormat } from "./api-gateway-access-log";
import { createSentrySourceMapUploadCommand } from "../sentry-source-maps";

export interface ApiGatewayProps {
  vpc: ec2.Vpc;
  lambdaSg: ec2.SecurityGroup;
  db: rds.DatabaseInstance;
  backendDbSecret: cdk.aws_secretsmanager.Secret;
  reportingDbSecret: cdk.aws_secretsmanager.ISecret;
  baseDomain: string;
  siteBaseUrl: string | undefined;
  apiCertificateArn: string | undefined;
  openAiApiKeySecretArn: string | undefined;
  langfusePublicKeySecretArn: string | undefined;
  langfuseSecretKeySecretArn: string | undefined;
  langfuseBaseUrl: string | undefined;
  sentryDsnSecretArn: string | undefined;
  sentryEnvironment: string | undefined;
  sentryRelease: string | undefined;
  sentryTracesSampleRate: string | undefined;
  resendApiKeySecretArn: string | undefined;
  resendSenderEmail: string | undefined;
  demoEmailDostip: string | undefined;
  guestAiWeightedMonthlyTokenCap: string | undefined;
  globalMetricsVisible: boolean;
  globalMetricsSnapshotBucket: s3.IBucket;
  globalMetricsSnapshotObjectKey: string;
  mediaAssetsBucket: s3.IBucket;
  userPoolId: string;
  userPoolArn: string;
  userPoolClientId: string;
}

export interface ApiGatewayResult {
  restApi: apigw.RestApi;
  backendFn: lambdaNodejs.NodejsFunction;
  directImageIngestionFn: lambdaNodejs.NodejsFunction;
  chatWorkerFn: lambdaNodejs.NodejsFunction;
  chatLiveFn: lambdaNodejs.NodejsFunction;
  chatLiveFunctionUrl: lambda.FunctionUrl;
}

interface BackendFunctionProps {
  constructId: string;
  entry: string;
  baseDomain: string;
  publicAppOrigin: string;
  publicSiteOrigin: string;
  vpc: ec2.Vpc;
  lambdaSg: ec2.SecurityGroup;
  db: rds.DatabaseInstance;
  backendDbSecret: cdk.aws_secretsmanager.Secret;
  reportingDbSecret: cdk.aws_secretsmanager.ISecret;
  backendCsrfSecret: cdk.aws_secretsmanager.Secret;
  backendChatLiveAuthSecret: cdk.aws_secretsmanager.Secret;
  allowedOrigins: string[];
  userPoolId: string;
  userPoolArn: string;
  userPoolClientId: string;
  openAiApiKeySecretArn: string | undefined;
  langfusePublicKeySecretArn: string | undefined;
  langfuseSecretKeySecretArn: string | undefined;
  langfuseBaseUrl: string | undefined;
  sentryConfig: BackendSentryConfig;
  resendApiKeySecretArn: string | undefined;
  resendSenderEmail: string | undefined;
  demoEmailDostip: string | undefined;
  guestAiWeightedMonthlyTokenCap: string | undefined;
  globalMetricsConfig: GlobalMetricsConfig | undefined;
  mediaAssetsBucket: s3.IBucket | undefined;
  memorySize: number;
  architecture: lambda.Architecture;
  bundling: lambdaNodejs.BundlingOptions;
}

interface DirectImageIngestionFunctionProps {
  baseDomain: string;
  publicSiteOrigin: string;
  vpc: ec2.Vpc;
  lambdaSg: ec2.SecurityGroup;
  db: rds.DatabaseInstance;
  backendDbSecret: cdk.aws_secretsmanager.Secret;
  backendCsrfSecret: cdk.aws_secretsmanager.Secret;
  allowedOrigins: string[];
  userPoolId: string;
  userPoolClientId: string;
  demoEmailDostip: string | undefined;
  guestAiWeightedMonthlyTokenCap: string | undefined;
  mediaAssetsBucket: s3.IBucket;
}

export const publicRestApiDefaultIntegrationTimeoutSeconds = 29;
export const directImageIngestionMaximumOnDemandInitSeconds = 10;
export const directImageIngestionLambdaTimeoutSeconds = 15;

export function addDirectImageIngestionApiRoutes(
  restApi: apigw.RestApi,
  sharedIntegration: apigw.Integration,
  directIntegration: apigw.Integration,
): apigw.Resource {
  const workspaces = restApi.root.addResource("workspaces");
  workspaces.addMethod("ANY", sharedIntegration);
  const workspace = workspaces.addResource("{workspaceId}");
  workspace.addMethod("ANY", sharedIntegration);
  workspace.addResource("{proxy+}").addMethod("ANY", sharedIntegration);
  const mediaAssets = workspace.addResource("media-assets");
  mediaAssets.addMethod("ANY", sharedIntegration);
  mediaAssets.addResource("{proxy+}").addMethod("ANY", sharedIntegration);
  const directImages = mediaAssets.addResource("images");
  directImages.addMethod("ANY", sharedIntegration);
  directImages.addMethod("POST", directIntegration);
  return directImages;
}

interface GlobalMetricsConfig {
  visible: boolean;
  snapshotBucket: s3.IBucket;
  snapshotObjectKey: string;
}

export interface BackendSentryConfig {
  dsnSecretArn: string | undefined;
  environment: string | undefined;
  release: string | undefined;
  tracesSampleRate: string | undefined;
}

interface ResolvedBackendSentryConfig {
  dsnSecretArn: string;
  environment: string;
  release: string;
  tracesSampleRate: string;
}

export interface GatewayErrorResponseHeaders {
  readonly [headerName: string]: string;
  readonly "Access-Control-Allow-Origin": string;
  readonly Vary: string;
  readonly "Access-Control-Allow-Headers": string;
  readonly "Access-Control-Allow-Methods": string;
  readonly "Access-Control-Allow-Credentials": string;
  readonly "Access-Control-Expose-Headers": string;
  readonly "X-Request-Id": string;
}

const browserCorsAllowHeaders = [
  "content-type",
  "authorization",
  "x-csrf-token",
  "sentry-trace",
  "baggage",
  "x-chat-request-id",
  "x-chat-resume-attempt-id",
  "x-client-platform",
  "x-client-version",
  "x-media-asset-id",
  "x-media-source-url",
  "x-media-created-at",
  "x-media-client-updated-at",
  "x-media-last-modified-by-replica-id",
  "x-media-last-operation-id",
] as const;

const browserCorsExposeHeaders = [
  "content-disposition",
  "x-request-id",
] as const;
const dockerBundlingRepoRootPath = "/asset-repo-root";
type DockerBundlingEnvironmentVariableName =
  | "GITHUB_ACTIONS"
  | "SENTRY_AUTH_TOKEN"
  | "SENTRY_BACKEND_CLI_PATH"
  | "SENTRY_ORG"
  | "SENTRY_PROJECT"
  | "SENTRY_RELEASE"
  | "SENTRY_UPLOAD_BACKEND_SOURCEMAPS";

const gatewayErrorCorsExposeHeaders = [
  ...browserCorsExposeHeaders,
  "x-amzn-requestid",
  "x-amz-apigw-id",
] as const;

export const globalMetricsCorsPreflightOptions: apigw.CorsOptions = {
  allowOrigins: ["*"],
  allowMethods: ["GET", "OPTIONS"],
  allowHeaders: ["content-type", "authorization", "sentry-trace", "baggage"],
};

function createBrowserCorsPreflightOptions(allowedOrigins: string[]): apigw.CorsOptions {
  return {
    allowOrigins: allowedOrigins,
    allowMethods: ["GET", "POST", "PUT", "PATCH", "OPTIONS"],
    allowHeaders: [...browserCorsAllowHeaders],
    allowCredentials: true,
  };
}

function createPublicCatalogCorsPreflightOptions(allowedOrigins: string[]): apigw.CorsOptions {
  return {
    allowOrigins: allowedOrigins,
    allowMethods: ["GET", "OPTIONS"],
    allowHeaders: ["content-type", "sentry-trace", "baggage", "x-client-platform", "x-client-version"],
  };
}

export function createChatLiveFunctionUrlCorsOptions(
  allowedOrigins: readonly string[],
): lambda.FunctionUrlCorsOptions {
  return {
    allowedOrigins: [...allowedOrigins],
    allowedMethods: [lambda.HttpMethod.GET],
    allowedHeaders: [...browserCorsAllowHeaders],
    exposedHeaders: [...browserCorsExposeHeaders],
    allowCredentials: true,
  };
}

export function createGatewayErrorResponseHeaders(): GatewayErrorResponseHeaders {
  return {
    "Access-Control-Allow-Origin": "method.request.header.Origin",
    "Vary": "'Origin'",
    "Access-Control-Allow-Headers": `'${browserCorsAllowHeaders.join(",")}'`,
    "Access-Control-Allow-Methods": "'GET,POST,PUT,PATCH,OPTIONS'",
    "Access-Control-Allow-Credentials": "'true'",
    "Access-Control-Expose-Headers": `'${gatewayErrorCorsExposeHeaders.join(",")}'`,
    "X-Request-Id": "context.requestId",
  };
}

function isConcreteIntegration(
  integration: apigw.CfnMethod.IntegrationProperty | cdk.IResolvable | undefined,
): integration is apigw.CfnMethod.IntegrationProperty {
  return integration !== undefined && !cdk.Token.isUnresolved(integration);
}

function isConcreteIntegrationResponse(
  response: apigw.CfnMethod.IntegrationResponseProperty | cdk.IResolvable,
): response is apigw.CfnMethod.IntegrationResponseProperty {
  return !cdk.Token.isUnresolved(response);
}

function addTextContentHandlingToIntegrationResponses(
  responses: Array<apigw.CfnMethod.IntegrationResponseProperty | cdk.IResolvable> | cdk.IResolvable | undefined,
  methodNodePath: string,
): Array<apigw.CfnMethod.IntegrationResponseProperty | cdk.IResolvable> {
  if (!Array.isArray(responses)) {
    throw new Error(`Expected API Gateway mock integration responses to be concrete for ${methodNodePath}`);
  }

  return responses.map((response) => {
    if (!isConcreteIntegrationResponse(response)) {
      throw new Error(`Expected API Gateway mock integration response to be concrete for ${methodNodePath}`);
    }

    return {
      ...response,
      contentHandling: apigw.ContentHandling.CONVERT_TO_TEXT,
    };
  });
}

export function addTextContentHandlingToMockOptionsMethods(restApi: apigw.RestApi): void {
  const latestDeployment = restApi.latestDeployment;

  if (latestDeployment === undefined) {
    throw new Error("API Gateway mock content handling requires a deployed RestApi so the stage is redeployed");
  }

  for (const node of restApi.node.findAll()) {
    if (!apigw.CfnMethod.isCfnMethod(node) || node.httpMethod !== "OPTIONS") {
      continue;
    }

    const integration = node.integration;

    if (!isConcreteIntegration(integration) || integration.type !== apigw.IntegrationType.MOCK) {
      continue;
    }

    node.integration = {
      ...integration,
      contentHandling: apigw.ContentHandling.CONVERT_TO_TEXT,
      integrationResponses: addTextContentHandlingToIntegrationResponses(integration.integrationResponses, node.node.path),
    };
  }

  latestDeployment.addToLogicalId({
    apiGatewayMockOptionsContentHandling: apigw.ContentHandling.CONVERT_TO_TEXT,
  });
}

export function createLegacyAuthNotFoundIntegration(): apigw.MockIntegration {
  return new apigw.MockIntegration({
    contentHandling: apigw.ContentHandling.CONVERT_TO_TEXT,
    requestTemplates: {
      "application/json": '{"statusCode": 404}',
    },
    integrationResponses: [
      {
        statusCode: "404",
        contentHandling: apigw.ContentHandling.CONVERT_TO_TEXT,
        responseTemplates: {
          "application/json": '{"error":"Not found"}',
        },
      },
    ],
  });
}

function createDockerBundlingEnvironment(): Record<DockerBundlingEnvironmentVariableName, string> {
  return {
    GITHUB_ACTIONS: process.env.GITHUB_ACTIONS ?? "",
    SENTRY_AUTH_TOKEN: process.env.SENTRY_AUTH_TOKEN ?? "",
    SENTRY_BACKEND_CLI_PATH: `${dockerBundlingRepoRootPath}/apps/backend/node_modules/.bin/sentry-cli`,
    SENTRY_ORG: process.env.SENTRY_ORG ?? "",
    SENTRY_PROJECT: process.env.SENTRY_PROJECT ?? "",
    SENTRY_RELEASE: process.env.SENTRY_RELEASE ?? "",
    SENTRY_UPLOAD_BACKEND_SOURCEMAPS: process.env.SENTRY_UPLOAD_BACKEND_SOURCEMAPS ?? "",
  };
}

function createLambdaBundling(
  input: Readonly<{
    nodeModules: ReadonlyArray<string>;
    forceDockerBundling: boolean;
  }>,
): lambdaNodejs.BundlingOptions {
  return {
    minify: true,
    sourceMap: true,
    ...(input.nodeModules.length === 0 ? {} : { nodeModules: [...input.nodeModules] }),
    ...(input.forceDockerBundling
      ? {
          forceDockerBundling: true,
          volumes: [
            {
              hostPath: resolveFromRepoRoot(),
              containerPath: dockerBundlingRepoRootPath,
              consistency: cdk.DockerVolumeConsistency.CONSISTENT,
            },
          ],
          environment: createDockerBundlingEnvironment(),
        }
      : {}),
    commandHooks: {
      beforeBundling: () => [],
      beforeInstall: () => [],
      afterBundling: (_inputDir: string, outputDir: string) => [
        `curl -sfo ${outputDir}/rds-global-bundle.pem https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem`,
        createSentrySourceMapUploadCommand(outputDir),
      ],
    },
  };
}

function getLangfuseSecretConfig(
  props: Readonly<{
    langfusePublicKeySecretArn: string | undefined;
    langfuseSecretKeySecretArn: string | undefined;
    langfuseBaseUrl: string | undefined;
  }>,
): Readonly<{
  publicKeySecretArn: string;
  secretKeySecretArn: string;
  baseUrl: string;
}> | null {
  const hasPublicKeySecret = props.langfusePublicKeySecretArn !== undefined && props.langfusePublicKeySecretArn !== "";
  const hasSecretKeySecret = props.langfuseSecretKeySecretArn !== undefined && props.langfuseSecretKeySecretArn !== "";

  if (!hasPublicKeySecret && !hasSecretKeySecret) {
    return null;
  }

  if (!hasPublicKeySecret || !hasSecretKeySecret) {
    throw new Error("langfusePublicKeySecretArn and langfuseSecretKeySecretArn must both be set when Langfuse is configured");
  }

  return {
    publicKeySecretArn: props.langfusePublicKeySecretArn as string,
    secretKeySecretArn: props.langfuseSecretKeySecretArn as string,
    baseUrl: props.langfuseBaseUrl ?? "https://cloud.langfuse.com",
  };
}

function addLambdaSecretEnvironment(
  scope: Construct,
  fn: lambdaNodejs.NodejsFunction,
  secretArn: string | undefined,
  constructId: string,
  environmentVariableName: string,
): void {
  if (secretArn === undefined || secretArn === "") {
    return;
  }

  const secret = cdk.aws_secretsmanager.Secret.fromSecretCompleteArn(scope, constructId, secretArn);
  secret.grantRead(fn);
  fn.addEnvironment(environmentVariableName, secret.secretValue.unsafeUnwrap());
}

function addGlobalMetricsEnvironment(
  fn: lambdaNodejs.NodejsFunction,
  config: GlobalMetricsConfig,
): void {
  fn.addEnvironment("GLOBAL_METRICS_VISIBLE", config.visible ? "true" : "false");
  fn.addEnvironment("GLOBAL_METRICS_S3_BUCKET_NAME", config.snapshotBucket.bucketName);
  fn.addEnvironment("GLOBAL_METRICS_S3_OBJECT_KEY", config.snapshotObjectKey);
  fn.addToRolePolicy(new cdk.aws_iam.PolicyStatement({
    actions: ["s3:GetObject"],
    resources: [config.snapshotBucket.arnForObjects(config.snapshotObjectKey)],
  }));
}

export function createMediaAssetsObjectPolicyStatement(bucket: s3.IBucket): cdk.aws_iam.PolicyStatement {
  return new cdk.aws_iam.PolicyStatement({
    actions: [
      "s3:AbortMultipartUpload",
      "s3:GetObject",
      "s3:ListMultipartUploadParts",
      "s3:PutObject",
    ],
    resources: [
      bucket.arnForObjects("media/blobs/*"),
      bucket.arnForObjects("media/uploads/*"),
    ],
  });
}

export function createDirectImageIngestionObjectPolicyStatement(
  bucket: s3.IBucket,
): cdk.aws_iam.PolicyStatement {
  return new cdk.aws_iam.PolicyStatement({
    actions: [
      "s3:GetObject",
      "s3:PutObject",
    ],
    resources: [bucket.arnForObjects("media/blobs/*")],
  });
}

function addMediaAssetsEnvironment(
  fn: lambdaNodejs.NodejsFunction,
  bucket: s3.IBucket,
): void {
  fn.addEnvironment("MEDIA_ASSETS_S3_BUCKET_NAME", bucket.bucketName);
  fn.addToRolePolicy(createMediaAssetsObjectPolicyStatement(bucket));
}

function hasConfiguredValue(value: string | undefined): value is string {
  return value !== undefined && value !== "";
}

function getResolvedBackendSentryConfig(config: BackendSentryConfig): ResolvedBackendSentryConfig | null {
  if (!hasConfiguredValue(config.dsnSecretArn)) {
    return null;
  }

  if (!hasConfiguredValue(config.environment)) {
    throw new Error("sentryEnvironment is required when sentryDsnSecretArn is configured");
  }
  if (!hasConfiguredValue(config.release)) {
    throw new Error("sentryRelease is required when sentryDsnSecretArn is configured");
  }
  if (!hasConfiguredValue(config.tracesSampleRate)) {
    throw new Error("sentryTracesSampleRate is required when sentryDsnSecretArn is configured");
  }

  const tracesSampleRate = Number(config.tracesSampleRate);
  if (!Number.isFinite(tracesSampleRate) || tracesSampleRate < 0 || tracesSampleRate > 1) {
    throw new Error("sentryTracesSampleRate must be a number between 0 and 1");
  }

  return {
    dsnSecretArn: config.dsnSecretArn,
    environment: config.environment,
    release: config.release,
    tracesSampleRate: config.tracesSampleRate,
  };
}

function addBackendSentryEnvironment(
  scope: Construct,
  fn: lambdaNodejs.NodejsFunction,
  config: BackendSentryConfig,
  constructId: string,
): void {
  const resolvedConfig = getResolvedBackendSentryConfig(config);
  if (resolvedConfig === null) {
    return;
  }

  addLambdaSecretEnvironment(scope, fn, resolvedConfig.dsnSecretArn, `${constructId}SentryDsnSecret`, "SENTRY_DSN");
  fn.addEnvironment("SENTRY_ENVIRONMENT", resolvedConfig.environment);
  fn.addEnvironment("SENTRY_RELEASE", resolvedConfig.release);
  fn.addEnvironment("SENTRY_TRACES_SAMPLE_RATE", resolvedConfig.tracesSampleRate);
}

/**
 * Creates a backend Lambda with the shared network, database, auth, and model
 * secret configuration used by the public backend handler and detached worker.
 */
function createBackendFunction(scope: Construct, props: BackendFunctionProps): lambdaNodejs.NodejsFunction {
  const langfuseConfig = getLangfuseSecretConfig(props);
  const fn = new lambdaNodejs.NodejsFunction(scope, props.constructId, {
    entry: props.entry,
    handler: "handler",
    runtime: lambda.Runtime.NODEJS_24_X,
    architecture: props.architecture,
    timeout: cdk.Duration.minutes(15),
    memorySize: props.memorySize,
    vpc: props.vpc,
    vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
    securityGroups: [props.lambdaSg],
    ...backendNodejsProjectPaths,
    bundling: props.bundling,
    environment: {
      NODE_EXTRA_CA_CERTS: "/var/task/rds-global-bundle.pem",
      DB_SECRET_ARN: props.backendDbSecret.secretArn,
      REPORTING_DB_SECRET_ARN: props.reportingDbSecret.secretArn,
      DB_HOST: props.db.dbInstanceEndpointAddress,
      DB_NAME: "flashcards",
      AUTH_MODE: "cognito",
      COGNITO_USER_POOL_ID: props.userPoolId,
      COGNITO_CLIENT_ID: props.userPoolClientId,
      COGNITO_REGION: cdk.Stack.of(scope).region,
      BACKEND_ALLOWED_ORIGINS: props.allowedOrigins.join(","),
      BACKEND_CSRF_SECRET_ARN: props.backendCsrfSecret.secretArn,
      BACKEND_CHAT_LIVE_AUTH_SECRET_ARN: props.backendChatLiveAuthSecret.secretArn,
      PUBLIC_API_BASE_URL: `https://api.${props.baseDomain}/v1`,
      PUBLIC_AUTH_BASE_URL: `https://auth.${props.baseDomain}`,
      PUBLIC_APP_BASE_URL: props.publicAppOrigin,
      // Public marketing-site origin for the discovery legal links. Defaults to
      // the apex domain; an optional CDK `siteBaseUrl` context overrides it.
      PUBLIC_SITE_BASE_URL: props.publicSiteOrigin,
      GUEST_AI_WEIGHTED_MONTHLY_TOKEN_CAP: props.guestAiWeightedMonthlyTokenCap ?? "0",
      ...(langfuseConfig === null
        ? {}
        : { LANGFUSE_BASE_URL: langfuseConfig.baseUrl }),
    },
  });

  props.backendDbSecret.grantRead(fn);
  props.reportingDbSecret.grantRead(fn);
  props.backendCsrfSecret.grantRead(fn);
  props.backendChatLiveAuthSecret.grantRead(fn);
  fn.addToRolePolicy(new cdk.aws_iam.PolicyStatement({
    actions: ["cognito-idp:AdminDeleteUser"],
    resources: [props.userPoolArn],
  }));
  addLambdaSecretEnvironment(
    scope,
    fn,
    props.openAiApiKeySecretArn,
    `${props.constructId}OpenAiApiKeySecret`,
    "OPENAI_API_KEY",
  );
  if (langfuseConfig !== null) {
    addLambdaSecretEnvironment(
      scope,
      fn,
      langfuseConfig.publicKeySecretArn,
      `${props.constructId}LangfusePublicKeySecret`,
      "LANGFUSE_PUBLIC_KEY",
    );
    addLambdaSecretEnvironment(
      scope,
      fn,
      langfuseConfig.secretKeySecretArn,
      `${props.constructId}LangfuseSecretKeySecret`,
      "LANGFUSE_SECRET_KEY",
    );
  }
  addBackendSentryEnvironment(scope, fn, props.sentryConfig, props.constructId);
  addLambdaSecretEnvironment(
    scope,
    fn,
    props.resendApiKeySecretArn,
    `${props.constructId}ResendApiKeySecret`,
    "RESEND_API_KEY",
  );
  if (hasConfiguredValue(props.resendSenderEmail)) {
    fn.addEnvironment("RESEND_FROM_EMAIL", props.resendSenderEmail);
  }
  if (props.demoEmailDostip !== undefined && props.demoEmailDostip !== "") {
    fn.addEnvironment("DEMO_EMAIL_DOSTIP", props.demoEmailDostip);
  }

  if (props.globalMetricsConfig !== undefined) {
    addGlobalMetricsEnvironment(fn, props.globalMetricsConfig);
  }
  if (props.mediaAssetsBucket !== undefined) {
    addMediaAssetsEnvironment(fn, props.mediaAssetsBucket);
  }

  return fn;
}

function createDirectImageIngestionFunction(
  scope: Construct,
  props: DirectImageIngestionFunctionProps,
): lambdaNodejs.NodejsFunction {
  if (
    directImageIngestionMaximumOnDemandInitSeconds
      + directImageIngestionLambdaTimeoutSeconds
      >= publicRestApiDefaultIntegrationTimeoutSeconds
  ) {
    throw new Error("Direct image ingestion Lambda timing margins are invalid.");
  }

  const fn = new lambdaNodejs.NodejsFunction(scope, "DirectImageIngestionHandler", {
    entry: resolveFromRepoRoot(
      "apps",
      "backend",
      "src",
      "entrypoints",
      "lambda-direct-image-ingestion.ts",
    ),
    handler: "handler",
    runtime: lambda.Runtime.NODEJS_24_X,
    architecture: lambda.Architecture.ARM_64,
    timeout: cdk.Duration.seconds(directImageIngestionLambdaTimeoutSeconds),
    memorySize: 1024,
    loggingFormat: lambda.LoggingFormat.JSON,
    vpc: props.vpc,
    vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
    securityGroups: [props.lambdaSg],
    ...backendNodejsProjectPaths,
    bundling: createLambdaBundling({
      nodeModules: ["sharp"],
      forceDockerBundling: true,
    }),
    environment: {
      NODE_EXTRA_CA_CERTS: "/var/task/rds-global-bundle.pem",
      DB_SECRET_ARN: props.backendDbSecret.secretArn,
      DB_HOST: props.db.dbInstanceEndpointAddress,
      DB_NAME: "flashcards",
      AUTH_MODE: "cognito",
      COGNITO_USER_POOL_ID: props.userPoolId,
      COGNITO_CLIENT_ID: props.userPoolClientId,
      COGNITO_REGION: cdk.Stack.of(scope).region,
      BACKEND_ALLOWED_ORIGINS: props.allowedOrigins.join(","),
      BACKEND_CSRF_SECRET_ARN: props.backendCsrfSecret.secretArn,
      PUBLIC_API_BASE_URL: `https://api.${props.baseDomain}/v1`,
      PUBLIC_AUTH_BASE_URL: `https://auth.${props.baseDomain}`,
      PUBLIC_SITE_BASE_URL: props.publicSiteOrigin,
      GUEST_AI_WEIGHTED_MONTHLY_TOKEN_CAP:
        props.guestAiWeightedMonthlyTokenCap ?? "0",
      MEDIA_ASSETS_S3_BUCKET_NAME: props.mediaAssetsBucket.bucketName,
      ...(props.demoEmailDostip === undefined || props.demoEmailDostip === ""
        ? {}
        : { DEMO_EMAIL_DOSTIP: props.demoEmailDostip }),
    },
  });

  props.backendDbSecret.grantRead(fn);
  props.backendCsrfSecret.grantRead(fn);
  fn.addToRolePolicy(
    createDirectImageIngestionObjectPolicyStatement(props.mediaAssetsBucket),
  );
  return fn;
}

/**
 * Builds the public REST API edge. The backend Hono app remains the route
 * source of truth behind a greedy proxy, with direct image ingestion mapped
 * explicitly to its bounded Lambda runtime.
 */
export function apiGateway(scope: Construct, props: ApiGatewayProps): ApiGatewayResult {
  const publicSiteOrigin = parsePublicOrigin(
    props.siteBaseUrl ?? `https://${props.baseDomain}`,
    "siteBaseUrl",
  );
  const publicAppOrigin = parsePublicOrigin(
    `https://app.${props.baseDomain}`,
    "appBaseUrl",
  );
  const publicCatalogAllowedOrigins = [
    publicSiteOrigin,
    publicAppOrigin,
    "http://localhost:3000",
  ];
  const allowedOrigins = [
    publicAppOrigin,
    `https://admin.${props.baseDomain}`,
    "http://localhost:3000",
    "http://localhost:3001",
  ];
  const backendCsrfSecret = new cdk.aws_secretsmanager.Secret(scope, "BackendCsrfSecret", {
    secretName: "flashcards-open-source-app/backend-csrf-secret",
    generateSecretString: {
      passwordLength: 64,
      includeSpace: false,
      excludeUppercase: true,
      excludePunctuation: true,
      excludeCharacters: "ghijklmnopqrstuvwxyz",
      requireEachIncludedType: false,
    },
  });
  const backendChatLiveAuthSecret = new cdk.aws_secretsmanager.Secret(scope, "BackendChatLiveAuthSecret", {
    secretName: "flashcards-open-source-app/backend-chat-live-auth-secret",
    generateSecretString: {
      passwordLength: 64,
      includeSpace: false,
      excludeUppercase: true,
      excludePunctuation: true,
      excludeCharacters: "ghijklmnopqrstuvwxyz",
      requireEachIncludedType: false,
    },
  });

  const backendFn = createBackendFunction(scope, {
    constructId: "BackendHandler",
    entry: resolveFromRepoRoot("apps", "backend", "src", "entrypoints", "lambda.ts"),
    baseDomain: props.baseDomain,
    publicAppOrigin,
    publicSiteOrigin,
    vpc: props.vpc,
    lambdaSg: props.lambdaSg,
    db: props.db,
    backendDbSecret: props.backendDbSecret,
    reportingDbSecret: props.reportingDbSecret,
    backendCsrfSecret,
    backendChatLiveAuthSecret,
    allowedOrigins,
    userPoolId: props.userPoolId,
    userPoolArn: props.userPoolArn,
    userPoolClientId: props.userPoolClientId,
    openAiApiKeySecretArn: props.openAiApiKeySecretArn,
    langfusePublicKeySecretArn: props.langfusePublicKeySecretArn,
    langfuseSecretKeySecretArn: props.langfuseSecretKeySecretArn,
    langfuseBaseUrl: props.langfuseBaseUrl,
    sentryConfig: {
      dsnSecretArn: props.sentryDsnSecretArn,
      environment: props.sentryEnvironment,
      release: props.sentryRelease,
      tracesSampleRate: props.sentryTracesSampleRate,
    },
    resendApiKeySecretArn: props.resendApiKeySecretArn,
    resendSenderEmail: props.resendSenderEmail,
    demoEmailDostip: props.demoEmailDostip,
    guestAiWeightedMonthlyTokenCap: props.guestAiWeightedMonthlyTokenCap,
    globalMetricsConfig: {
      visible: props.globalMetricsVisible,
      snapshotBucket: props.globalMetricsSnapshotBucket,
      snapshotObjectKey: props.globalMetricsSnapshotObjectKey,
    },
    mediaAssetsBucket: props.mediaAssetsBucket,
    memorySize: 1024,
    architecture: lambda.Architecture.ARM_64,
    bundling: createLambdaBundling({
      nodeModules: ["sharp"],
      forceDockerBundling: true,
    }),
  });
  const directImageIngestionFn = createDirectImageIngestionFunction(scope, {
    baseDomain: props.baseDomain,
    publicSiteOrigin,
    vpc: props.vpc,
    lambdaSg: props.lambdaSg,
    db: props.db,
    backendDbSecret: props.backendDbSecret,
    backendCsrfSecret,
    allowedOrigins,
    userPoolId: props.userPoolId,
    userPoolClientId: props.userPoolClientId,
    demoEmailDostip: props.demoEmailDostip,
    guestAiWeightedMonthlyTokenCap: props.guestAiWeightedMonthlyTokenCap,
    mediaAssetsBucket: props.mediaAssetsBucket,
  });
  const chatWorkerFn = createBackendFunction(scope, {
    constructId: "ChatRunWorkerHandler",
    entry: resolveFromRepoRoot("apps", "backend", "src", "entrypoints", "lambda-chat-worker.ts"),
    baseDomain: props.baseDomain,
    publicAppOrigin,
    publicSiteOrigin,
    vpc: props.vpc,
    lambdaSg: props.lambdaSg,
    db: props.db,
    backendDbSecret: props.backendDbSecret,
    reportingDbSecret: props.reportingDbSecret,
    backendCsrfSecret,
    backendChatLiveAuthSecret,
    allowedOrigins,
    userPoolId: props.userPoolId,
    userPoolArn: props.userPoolArn,
    userPoolClientId: props.userPoolClientId,
    openAiApiKeySecretArn: props.openAiApiKeySecretArn,
    langfusePublicKeySecretArn: props.langfusePublicKeySecretArn,
    langfuseSecretKeySecretArn: props.langfuseSecretKeySecretArn,
    langfuseBaseUrl: props.langfuseBaseUrl,
    sentryConfig: {
      dsnSecretArn: props.sentryDsnSecretArn,
      environment: props.sentryEnvironment,
      release: props.sentryRelease,
      tracesSampleRate: props.sentryTracesSampleRate,
    },
    resendApiKeySecretArn: undefined,
    resendSenderEmail: undefined,
    demoEmailDostip: props.demoEmailDostip,
    guestAiWeightedMonthlyTokenCap: props.guestAiWeightedMonthlyTokenCap,
    globalMetricsConfig: undefined,
    mediaAssetsBucket: props.mediaAssetsBucket,
    memorySize: 1024,
    architecture: lambda.Architecture.ARM_64,
    bundling: createLambdaBundling({
      nodeModules: ["sharp"],
      forceDockerBundling: true,
    }),
  });
  const chatLiveFn = createBackendFunction(scope, {
    constructId: "ChatLiveHandler",
    entry: resolveFromRepoRoot("apps", "backend", "src", "entrypoints", "lambda-chat-live.ts"),
    baseDomain: props.baseDomain,
    publicAppOrigin,
    publicSiteOrigin,
    vpc: props.vpc,
    lambdaSg: props.lambdaSg,
    db: props.db,
    backendDbSecret: props.backendDbSecret,
    reportingDbSecret: props.reportingDbSecret,
    backendCsrfSecret,
    backendChatLiveAuthSecret,
    allowedOrigins,
    userPoolId: props.userPoolId,
    userPoolArn: props.userPoolArn,
    userPoolClientId: props.userPoolClientId,
    openAiApiKeySecretArn: props.openAiApiKeySecretArn,
    langfusePublicKeySecretArn: props.langfusePublicKeySecretArn,
    langfuseSecretKeySecretArn: props.langfuseSecretKeySecretArn,
    langfuseBaseUrl: props.langfuseBaseUrl,
    sentryConfig: {
      dsnSecretArn: props.sentryDsnSecretArn,
      environment: props.sentryEnvironment,
      release: props.sentryRelease,
      tracesSampleRate: props.sentryTracesSampleRate,
    },
    resendApiKeySecretArn: undefined,
    resendSenderEmail: undefined,
    demoEmailDostip: props.demoEmailDostip,
    guestAiWeightedMonthlyTokenCap: props.guestAiWeightedMonthlyTokenCap,
    globalMetricsConfig: undefined,
    mediaAssetsBucket: undefined,
    memorySize: 256,
    architecture: lambda.Architecture.X86_64,
    bundling: createLambdaBundling({
      nodeModules: [],
      forceDockerBundling: false,
    }),
  });
  const chatLiveFunctionUrl = chatLiveFn.addFunctionUrl({
    authType: lambda.FunctionUrlAuthType.NONE,
    invokeMode: lambda.InvokeMode.RESPONSE_STREAM,
    cors: createChatLiveFunctionUrlCorsOptions(allowedOrigins),
  });

  // Update the worker before the API can persist runs with a new model
  // configuration. The worker resolves execution settings from the stable
  // ai_cost_mode role, so it can claim runs prepared by the previous API build.
  backendFn.node.addDependency(chatWorkerFn);
  backendFn.addEnvironment("CHAT_WORKER_FUNCTION_NAME", chatWorkerFn.functionName);
  backendFn.addEnvironment("CHAT_LIVE_URL", chatLiveFunctionUrl.url);
  chatWorkerFn.grantInvoke(backendFn);
  const accessLogGroup = new logs.LogGroup(scope, "ApiAccessLogGroup", {
    retention: logs.RetentionDays.ONE_WEEK,
  });

  const restApi = new apigw.RestApi(scope, "Api", {
    restApiName: "flashcards-open-source-app-api",
    description: "Public API for flashcards mobile clients",
    binaryMediaTypes: ["*/*"],
    deployOptions: {
      stageName: "v1",
      throttlingRateLimit: 50,
      throttlingBurstLimit: 100,
      metricsEnabled: true,
      dataTraceEnabled: false,
      tracingEnabled: false,
      accessLogDestination: new apigw.LogGroupLogDestination(accessLogGroup),
      accessLogFormat: createSafeApiGatewayAccessLogFormat(),
    },
    defaultCorsPreflightOptions: createBrowserCorsPreflightOptions(allowedOrigins),
  });
  const gatewayErrorResponseHeaders = createGatewayErrorResponseHeaders();

  new apigw.GatewayResponse(scope, "ApiDefault4xxGatewayResponse", {
    restApi,
    type: apigw.ResponseType.DEFAULT_4XX,
    responseHeaders: gatewayErrorResponseHeaders,
  });

  new apigw.GatewayResponse(scope, "ApiDefault5xxGatewayResponse", {
    restApi,
    type: apigw.ResponseType.DEFAULT_5XX,
    responseHeaders: gatewayErrorResponseHeaders,
  });

  /**
   * Keeps the existing buffered Lambda proxy behavior for JSON-style endpoints.
   * Those routes only return complete payloads, so streaming would add no value
   * and would widen the blast radius of the chat-specific transport change.
   *
   * Permission scoping is intentionally API-wide instead of method-wide. The
   * backend now has enough public resources that per-method Lambda permissions
   * exceed the Lambda resource-policy size limit during deployment.
   */
  const integration = new apigw.LambdaIntegration(backendFn, {
    scopePermissionToMethod: false,
  });
  const directImageIngestionIntegration = new apigw.LambdaIntegration(
    directImageIngestionFn,
    {
      timeout: cdk.Duration.seconds(
        publicRestApiDefaultIntegrationTimeoutSeconds,
      ),
    },
  );

  const notFoundIntegration = createLegacyAuthNotFoundIntegration();
  const notFoundMethodOptions: apigw.MethodOptions = {
    methodResponses: [
      {
        statusCode: "404",
      },
    ],
  };

  const global = restApi.root.addResource("global");
  const globalSnapshot = global.addResource("snapshot", {
    defaultCorsPreflightOptions: globalMetricsCorsPreflightOptions,
  });
  globalSnapshot.addMethod("GET", integration);

  const catalog = restApi.root.addResource("catalog", {
    defaultCorsPreflightOptions: createPublicCatalogCorsPreflightOptions(publicCatalogAllowedOrigins),
  });
  catalog.addMethod("GET", integration);
  catalog
    .addResource("{proxy+}", {
      defaultCorsPreflightOptions: createPublicCatalogCorsPreflightOptions(publicCatalogAllowedOrigins),
    })
    .addMethod("GET", integration);

  const legacyAuth = restApi.root.addResource("auth");
  legacyAuth.addMethod("ANY", notFoundIntegration, notFoundMethodOptions);
  legacyAuth.addResource("{proxy+}").addMethod("ANY", notFoundIntegration, notFoundMethodOptions);

  addDirectImageIngestionApiRoutes(
    restApi,
    integration,
    directImageIngestionIntegration,
  );

  restApi.root.addMethod("GET", integration);
  restApi.root.addResource("{proxy+}").addMethod("ANY", integration);
  addTextContentHandlingToMockOptionsMethods(restApi);

  if (props.apiCertificateArn) {
    const apiDomainName = `api.${props.baseDomain}`;
    const certificate = cdk.aws_certificatemanager.Certificate.fromCertificateArn(
      scope,
      "ApiCertificate",
      props.apiCertificateArn,
    );

    const domain = restApi.addDomainName("ApiCustomDomain", {
      domainName: apiDomainName,
      certificate,
      endpointType: apigw.EndpointType.REGIONAL,
      basePath: "v1",
    });

    new cdk.CfnOutput(scope, "ApiCustomDomainTarget", {
      value: domain.domainNameAliasDomainName,
      description: "Create a Cloudflare CNAME for api.<domain> to this target",
    });
  }

  new cdk.CfnOutput(scope, "ChatLiveFunctionUrl", {
    value: chatLiveFunctionUrl.url,
    description: "Lambda Function URL for the SSE live chat stream",
  });

  return {
    restApi,
    backendFn,
    directImageIngestionFn,
    chatWorkerFn,
    chatLiveFn,
    chatLiveFunctionUrl,
  };
}
